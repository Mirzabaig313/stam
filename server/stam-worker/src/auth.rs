//! Google sign-in (authorization code + PKCE) and sessions (spec §7.1). Only owners sign in. The
//! app runs on another site than this API, so a session is a random bearer token the app keeps
//! (cross-site cookies are blocked by Safari); its SHA-256 is the database key. Sign-in hands the
//! token over in two steps: the callback sends the browser back to the app with a one-time code
//! in the URL fragment, which the app trades for the token (`POST /api/auth/exchange`).

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

const OAUTH_COOKIE: &str = "stam_oauth";
/// The WebSocket subprotocol the app asks for; a second one carries the token (browsers cannot set
/// headers on a WebSocket, and a URL would end up in logs).
pub const WS_PROTOCOL: &str = "stam";
const WS_TOKEN_PREFIX: &str = "stam-auth.";
/// A one-time sign-in code lives 2 minutes. It is stored under a hash no bearer token can have
/// (tokens are checked for their form, see `is_token`), so it never works as a session itself.
const HANDOFF_MS: f64 = 2.0 * 60.0 * 1000.0;
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

/// In production the OAuth cookie carries the `__Host-` prefix, so no other subdomain can set it;
/// a `__Host-` cookie needs `Secure`, which plain-http development cannot have.
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

/// A page of the app to come back to after sign-in (`/app...` or a share link `/s/...`, the pages
/// that take the sign-in code out of the address); anything else goes to `/app`. Only plain URL
/// characters pass: browsers drop tabs and newlines and read `\` as `/`, which would turn
/// `/<tab>/evil.com` into `//evil.com`.
fn safe_return(path: Option<&str>) -> String {
    let plain = |c: char| c.is_ascii_alphanumeric() || "/-._~%?=&+,:@!$'()*;#".contains(c);
    let app_page = |p: &str| {
        p == "/app"
            || ["/app/", "/app?", "/app#", "/s/"]
                .iter()
                .any(|s| p.starts_with(s))
    };
    match path {
        Some(p) if app_page(p) && p.chars().all(plain) => p.to_owned(),
        _ => "/app".to_owned(),
    }
}

/// Whether `s` has the form of our tokens and nonces: 32 random bytes, base64url (43 characters).
pub fn is_token(s: &str) -> bool {
    s.len() == 43
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn redirect(location: &str) -> Result<Response> {
    let res = Response::empty()?.with_status(302);
    res.headers().set("Location", location)?;
    Ok(res)
}

/// Whether `origin` is the app: `SITE_ORIGIN`; in development also the origin the request arrived
/// on (`wrangler dev` may rewrite Host and Origin to its own host).
pub fn is_app_origin(req: &Request, env: &Env, origin: &str) -> bool {
    if var(env, "SITE_ORIGIN").is_ok_and(|site| site == origin) {
        return true;
    }
    is_dev(env)
        && req
            .url()
            .is_ok_and(|u| u.origin().ascii_serialization() == origin)
}

/// Every state-changing request and every socket must come from the app: its `Origin` header must
/// be the app's. Tokens are not sent by other sites on their own, so this is defence in depth.
pub fn from_app(req: &Request, env: &Env) -> bool {
    req.headers()
        .get("origin")
        .ok()
        .flatten()
        .is_some_and(|origin| is_app_origin(req, env, &origin))
}

/// The session token: `Authorization: Bearer <token>`, or on a WebSocket upgrade the
/// `stam-auth.<token>` subprotocol. Only the form our tokens have counts.
pub fn bearer_token(req: &Request) -> Option<String> {
    let header = |name: &str| req.headers().get(name).ok().flatten();
    let token = match header("authorization") {
        Some(h) => h.strip_prefix("Bearer ").map(|t| t.trim().to_owned()),
        None => header("sec-websocket-protocol").and_then(|list| {
            list.split(',')
                .map(str::trim)
                .find_map(|p| p.strip_prefix(WS_TOKEN_PREFIX))
                .map(str::to_owned)
        }),
    };
    token.filter(|t| is_token(t))
}

/// Whether the client asked for the app's WebSocket subprotocol (the room must then name it).
pub fn wants_ws_protocol(req: &Request) -> bool {
    req.headers()
        .get("sec-websocket-protocol")
        .ok()
        .flatten()
        .is_some_and(|list| list.split(',').any(|p| p.trim() == WS_PROTOCOL))
}

/// Where a one-time sign-in code is stored: a hash no session token can have, bound to the nonce
/// of the browser tab that started the sign-in (so a code sent to another browser is useless).
fn handoff_hash(code: &str, nonce: &str) -> String {
    sha256_b64(&format!("handoff:{nonce}:{code}"))
}

#[derive(Serialize, Deserialize)]
struct OAuthState {
    state: String,
    verifier: String,
    /// The app tab's sign-in nonce (see `handoff_hash`).
    nonce: String,
    #[serde(rename = "return")]
    return_to: String,
}

/// `GET /api/auth/google?return=<path>&nonce=<nonce>`: off to Google, with state and a PKCE
/// challenge.
pub async fn sign_in(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let env = &ctx.env;
    let url = req.url()?;
    let query = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    let return_to = query("return");
    let Some(nonce) = query("nonce").filter(|n| is_token(n)) else {
        return error(400, "BAD_SIGN_IN");
    };
    let (verifier, challenge) = pkce_pair();
    let state = random_token();
    let payload = OAuthState {
        state: state.clone(),
        verifier,
        nonce,
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
            &format!("{}/api/auth/google/callback", var(env, "API_ORIGIN")?),
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
            &format!("{}/api/auth/google/callback", var(env, "API_ORIGIN")?),
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
    // A one-time code for the app, which trades it for the session token (`exchange`).
    let code = random_token();
    db::create_session(
        &db,
        &handoff_hash(&code, &stored.nonce),
        &user_id,
        &iso(now),
        &iso(now + HANDOFF_MS),
    )
    .await?;

    // The fragment never reaches a server, and the app removes it from the address at once.
    let path = stored.return_to.split('#').next().unwrap_or("/app");
    let res = redirect(&format!(
        "{}{path}#stamSignIn={code}",
        var(env, "SITE_ORIGIN")?
    ))?;
    res.headers()
        .append("Set-Cookie", &set_cookie(env, OAUTH_COOKIE, "", 0))?;
    Ok(res)
}

#[derive(Deserialize)]
struct ExchangeBody {
    nonce: String,
}

/// Bearer-token answers are never cached anywhere.
fn no_store(res: Response) -> Result<Response> {
    res.headers().set("Cache-Control", "no-store")?;
    Ok(res)
}

/// `POST /api/auth/exchange` `{nonce}` with `Authorization: Bearer <one-time code>`: the session
/// token. The code is deleted as it is read, so it works once, and only with the nonce of the tab
/// that started the sign-in.
pub async fn exchange(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let env = &ctx.env;
    if !from_app(&req, env) {
        return error(403, "FORBIDDEN");
    }
    let code = bearer_token(&req);
    let nonce = req
        .json::<ExchangeBody>()
        .await
        .ok()
        .map(|b| b.nonce)
        .filter(|n| is_token(n));
    let (Some(code), Some(nonce)) = (code, nonce) else {
        return error(401, "BAD_SIGN_IN");
    };
    let db = env.d1("DB")?;
    let now = now_ms();
    let Some(user_id) = db::take_session(&db, &handoff_hash(&code, &nonce), &iso(now)).await?
    else {
        return error(401, "BAD_SIGN_IN");
    };
    let token = random_token();
    db::create_session(
        &db,
        &sha256_b64(&token),
        &user_id,
        &iso(now),
        &iso(now + SESSION_DAYS * DAY_MS),
    )
    .await?;
    no_store(Response::from_json(&json!({ "token": token }))?)
}

/// The signed-in user, renewing the session when it has fewer than 15 days left.
pub async fn current_user(req: &Request, env: &Env) -> Result<Option<User>> {
    let Some(token) = bearer_token(req) else {
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
    if !from_app(&req, &ctx.env) {
        return error(403, "FORBIDDEN");
    }
    if let Some(token) = bearer_token(&req) {
        db::delete_session(&ctx.env.d1("DB")?, &sha256_b64(&token)).await?;
    }
    Response::empty().map(|r| r.with_status(204))
}

/// `GET /api/me`: the user and their shared trees (the session slides in `current_user`).
pub async fn me(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Some(user) = current_user(&req, &ctx.env).await? else {
        return error(401, "SIGNED_OUT");
    };
    let trees = db::user_trees(&ctx.env.d1("DB")?, &user.id).await?;
    no_store(Response::from_json(
        &json!({ "user": user, "trees": trees }),
    )?)
}
