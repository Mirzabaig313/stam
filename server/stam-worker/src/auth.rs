//! Google sign-in (authorization code + PKCE) and sessions (spec §7.1). Only owners sign in; the
//! session cookie holds a random token whose SHA-256 is the database key.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use serde_json::json;
use worker::wasm_bindgen::JsValue;
use worker::{Env, Fetch, Headers, Method, Request, RequestInit, Response, Result, RouteContext};

use crate::crypto::{pkce_pair, random_id, random_token, sha256_b64, sign, verify};
use crate::db::{self, User};
use crate::headers::is_dev;
use crate::routes::error;

const SESSION_COOKIE: &str = "stam_session";
const OAUTH_COOKIE: &str = "stam_oauth";
/// Secrets that sign or encrypt must be long enough to resist guessing.
const MIN_SECRET_BYTES: usize = 32;
const DAY_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;
/// Sessions last 30 days, renewed when fewer than 15 remain.
const SESSION_DAYS: f64 = 30.0;
const RENEW_BELOW_DAYS: f64 = 15.0;
const OAUTH_SECONDS: u32 = 600;

pub fn now_ms() -> f64 {
    js_sys::Date::now()
}

/// JS `toISOString`, so stored times compare as strings.
pub fn iso(ms: f64) -> String {
    js_sys::Date::new(&JsValue::from_f64(ms))
        .to_iso_string()
        .into()
}

fn var(env: &Env, name: &str) -> Result<String> {
    Ok(env.var(name)?.to_string())
}

pub fn secret(env: &Env, name: &str) -> Result<String> {
    Ok(env.secret(name).or_else(|_| env.var(name))?.to_string())
}

/// The key that signs the OAuth cookie: refused when missing or short, never used weak.
fn signing_secret(env: &Env) -> Result<String> {
    let key = secret(env, "SESSION_SECRET")?;
    if key.len() < MIN_SECRET_BYTES {
        return Err(worker::Error::RustError(
            "SESSION_SECRET is too short".into(),
        ));
    }
    Ok(key)
}

/// In production cookies carry the `__Host-` prefix, so no other subdomain can set them; a
/// `__Host-` cookie needs `Secure`, which plain-http development cannot have.
fn cookie_name(env: &Env, base: &str) -> String {
    if is_dev(env) {
        base.to_owned()
    } else {
        format!("__Host-{base}")
    }
}

/// A cookie's value from the request.
pub fn read_cookie(req: &Request, name: &str) -> Option<String> {
    let header = req.headers().get("cookie").ok()??;
    header.split(';').find_map(|pair| {
        let (k, v) = pair.trim().split_once('=')?;
        (k == name).then(|| v.to_owned())
    })
}

fn set_cookie(env: &Env, base: &str, value: &str, max_age: u32) -> String {
    let name = cookie_name(env, base);
    let secure = if is_dev(env) { "" } else { "; Secure" };
    format!("{name}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}")
}

/// A path on this site to come back to after sign-in; anything else goes to `/app`. Only plain
/// URL characters pass: browsers drop tabs and newlines and read `\` as `/`, which would turn
/// `/<tab>/evil.com` into `//evil.com`.
fn safe_return(path: Option<&str>) -> String {
    let plain = |c: char| c.is_ascii_alphanumeric() || "/-._~%?=&+,:@!$'()*;#".contains(c);
    match path {
        Some(p) if p.starts_with('/') && !p.starts_with("//") && p.chars().all(plain) => {
            p.to_owned()
        }
        _ => "/app".to_owned(),
    }
}

fn redirect(location: &str) -> Result<Response> {
    let res = Response::empty()?.with_status(302);
    res.headers().set("Location", location)?;
    Ok(res)
}

/// Every state-changing request must come from the site itself (CSRF): its `Origin` header must be
/// the origin the request arrived on. (`wrangler dev` rewrites both to the route's host, so this
/// holds locally too, where a fixed `SITE_ORIGIN` would not.)
pub fn same_origin(req: &Request) -> bool {
    let origin = req.headers().get("origin").ok().flatten();
    let arrived = req.url().ok().map(|u| u.origin().ascii_serialization());
    origin.is_some() && origin == arrived
}

#[derive(Serialize, Deserialize)]
struct OAuthState {
    state: String,
    verifier: String,
    #[serde(rename = "return")]
    return_to: String,
}

/// `GET /api/auth/google?return=<path>`: off to Google, with state and a PKCE challenge.
pub async fn sign_in(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let env = &ctx.env;
    let url = req.url()?;
    let return_to = url
        .query_pairs()
        .find(|(k, _)| k == "return")
        .map(|(_, v)| v.into_owned());
    let (verifier, challenge) = pkce_pair();
    let state = random_token();
    let payload = OAuthState {
        state: state.clone(),
        verifier,
        return_to: safe_return(return_to.as_deref()),
    };
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload)?);
    let cookie_value = sign(&encoded, &signing_secret(env)?);

    let mut google = worker::Url::parse(&var(env, "GOOGLE_AUTH_URL")?)?;
    google
        .query_pairs_mut()
        .append_pair("client_id", &secret(env, "GOOGLE_CLIENT_ID")?)
        .append_pair(
            "redirect_uri",
            &format!("{}/api/auth/google/callback", var(env, "SITE_ORIGIN")?),
        )
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    let res = redirect(google.as_str())?;
    res.headers().append(
        "Set-Cookie",
        &set_cookie(env, OAUTH_COOKIE, &cookie_value, OAUTH_SECONDS),
    )?;
    Ok(res)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GoogleUser {
    sub: String,
    email: String,
    name: Option<String>,
}

async fn google_user(env: &Env, code: &str, verifier: &str) -> Result<Option<GoogleUser>> {
    let body = form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "authorization_code")
        .append_pair("code", code)
        .append_pair("client_id", &secret(env, "GOOGLE_CLIENT_ID")?)
        .append_pair("client_secret", &secret(env, "GOOGLE_CLIENT_SECRET")?)
        .append_pair(
            "redirect_uri",
            &format!("{}/api/auth/google/callback", var(env, "SITE_ORIGIN")?),
        )
        .append_pair("code_verifier", verifier)
        .finish();
    let headers = Headers::new();
    headers.set("content-type", "application/x-www-form-urlencoded")?;
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(JsValue::from_str(&body)));
    let mut token = Fetch::Request(Request::new_with_init(
        &var(env, "GOOGLE_TOKEN_URL")?,
        &init,
    )?)
    .send()
    .await?;
    if token.status_code() != 200 {
        return Ok(None);
    }
    let token: TokenResponse = token.json().await?;

    let headers = Headers::new();
    headers.set("authorization", &format!("Bearer {}", token.access_token))?;
    let mut init = RequestInit::new();
    init.with_headers(headers);
    let mut info = Fetch::Request(Request::new_with_init(
        &var(env, "GOOGLE_USERINFO_URL")?,
        &init,
    )?)
    .send()
    .await?;
    if info.status_code() != 200 {
        return Ok(None);
    }
    Ok(Some(info.json().await?))
}

/// `GET /api/auth/google/callback`: check state, trade the code, create the user and a session.
pub async fn callback(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let env = &ctx.env;
    let url = req.url()?;
    let query = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    let stored = read_cookie(&req, &cookie_name(env, OAUTH_COOKIE))
        .and_then(|c| verify(&c, &signing_secret(env).ok()?))
        .and_then(|encoded| URL_SAFE_NO_PAD.decode(encoded).ok())
        .and_then(|bytes| serde_json::from_slice::<OAuthState>(&bytes).ok());
    let (Some(stored), Some(code), Some(state)) = (stored, query("code"), query("state")) else {
        return error(400, "BAD_SIGN_IN");
    };
    if state != stored.state {
        return error(400, "BAD_SIGN_IN");
    }
    let Some(google) = google_user(env, &code, &stored.verifier).await? else {
        return error(502, "GOOGLE_REFUSED");
    };

    let db = env.d1("DB")?;
    let now = now_ms();
    let name = google.name.unwrap_or_else(|| google.email.clone());
    let user_id = db::upsert_user(
        &db,
        &random_id(),
        &google.sub,
        &google.email,
        &name,
        &iso(now),
    )
    .await?;
    let token = random_token();
    db::create_session(
        &db,
        &sha256_b64(&token),
        &user_id,
        &iso(now),
        &iso(now + SESSION_DAYS * DAY_MS),
    )
    .await?;

    let separator = if stored.return_to.contains('?') {
        '&'
    } else {
        '?'
    };
    let res = redirect(&format!("{}{separator}signedIn=1", stored.return_to))?;
    let max_age = (SESSION_DAYS * 24.0 * 3600.0) as u32;
    res.headers().append(
        "Set-Cookie",
        &set_cookie(env, SESSION_COOKIE, &token, max_age),
    )?;
    res.headers()
        .append("Set-Cookie", &set_cookie(env, OAUTH_COOKIE, "", 0))?;
    Ok(res)
}

/// The signed-in user, renewing the session when it has fewer than 15 days left.
pub async fn current_user(req: &Request, env: &Env) -> Result<Option<User>> {
    let Some(token) = read_cookie(req, &cookie_name(env, SESSION_COOKIE)) else {
        return Ok(None);
    };
    let db = env.d1("DB")?;
    let hash = sha256_b64(&token);
    let now = now_ms();
    let Some((user, expires_at)) = db::session_user(&db, &hash, &iso(now)).await? else {
        return Ok(None);
    };
    if expires_at < iso(now + RENEW_BELOW_DAYS * DAY_MS) {
        db::extend_session(&db, &hash, &iso(now + SESSION_DAYS * DAY_MS)).await?;
    }
    Ok(Some(user))
}

/// `POST /api/auth/signout`.
pub async fn sign_out(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if !same_origin(&req) {
        return error(403, "FORBIDDEN");
    }
    if let Some(token) = read_cookie(&req, &cookie_name(&ctx.env, SESSION_COOKIE)) {
        db::delete_session(&ctx.env.d1("DB")?, &sha256_b64(&token)).await?;
    }
    let res = Response::empty()?.with_status(204);
    res.headers()
        .append("Set-Cookie", &set_cookie(&ctx.env, SESSION_COOKIE, "", 0))?;
    Ok(res)
}

/// `GET /api/me`: the user and their shared trees.
pub async fn me(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Some(user) = current_user(&req, &ctx.env).await? else {
        return error(401, "SIGNED_OUT");
    };
    let trees = db::user_trees(&ctx.env.d1("DB")?, &user.id).await?;
    let res = Response::from_json(&json!({ "user": user, "trees": trees }))?;
    // The app asks this on every start: renew the cookie too, or the browser would drop it 30
    // days after sign-in however active the user is (the server side slides in current_user).
    if let Some(token) = read_cookie(&req, &cookie_name(&ctx.env, SESSION_COOKIE)) {
        let max_age = (SESSION_DAYS * 24.0 * 3600.0) as u32;
        res.headers().append(
            "Set-Cookie",
            &set_cookie(&ctx.env, SESSION_COOKIE, &token, max_age),
        )?;
    }
    Ok(res)
}
