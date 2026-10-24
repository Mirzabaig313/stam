//! HTTP routing: the REST API (spec §7) under `/api`. The app itself is served elsewhere (Cloudflare
//! Pages at `SITE_ORIGIN`) and calls this Worker cross-site, so every answer carries CORS headers
//! for the app's origin.

use serde_json::json;
use worker::{Env, Headers, Method, Request, Response, Result, Router};

use crate::{auth, ratelimit, trees};

/// A JSON error body: `{"error": code}`.
pub fn error(status: u16, code: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({ "error": code }))?.with_status(status))
}

pub async fn handle(req: Request, env: Env) -> Result<Response> {
    let origin = req.headers().get("origin")?;
    let cors_origin = origin.filter(|o| auth::is_app_origin(&req, &env, o));
    // Preflights are the browser's, not the app's requests: they never count against a limit (a
    // refused preflight would hide the real answer from the app).
    let res = if req.method() == Method::Options {
        preflight(cors_origin.is_some())?
    } else if let Some(limited) = ratelimit::check(&req, &env).await? {
        limited
    } else {
        // A handler that fails still answers (with CORS), so the app can tell it from offline.
        match route(req, env).await {
            Ok(res) => res,
            Err(_) => error(500, "INTERNAL")?,
        }
    };
    // A socket's answer (101) carries no CORS headers, and its headers cannot change.
    if res.status_code() == 101 {
        return Ok(res);
    }
    // Answers fetched from a room have read-only headers: copy them into a fresh set.
    let headers = Headers::new();
    for (name, value) in res.headers().entries() {
        headers.append(&name, &value)?;
    }
    // Every answer varies by Origin, so a cached one without CORS never serves a CORS request.
    headers.append("Vary", "Origin")?;
    if let Some(origin) = cors_origin {
        headers.set("Access-Control-Allow-Origin", &origin)?;
        headers.set("Access-Control-Expose-Headers", "Retry-After")?;
    }
    Ok(res.with_headers(headers))
}

/// The browser's question before a cross-site request with a token or a JSON body. Answers are
/// cached for a day (Chrome keeps them 2 hours), so most requests skip it.
fn preflight(allowed: bool) -> Result<Response> {
    if !allowed {
        return error(403, "FORBIDDEN");
    }
    let res = Response::empty()?.with_status(204);
    let headers = res.headers();
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")?;
    headers.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
    )?;
    headers.set("Access-Control-Max-Age", "86400")?;
    Ok(res)
}

async fn route(req: Request, env: Env) -> Result<Response> {
    Router::new()
        .get("/api/health", |_, _| {
            Response::from_json(&json!({ "ok": true }))
        })
        .get_async("/api/auth/google", auth::sign_in)
        .get_async("/api/auth/google/callback", auth::callback)
        .post_async("/api/auth/exchange", auth::exchange)
        .post_async("/api/auth/signout", auth::sign_out)
        .get_async("/api/me", auth::me)
        .post_async("/api/trees", trees::create)
        .delete_async("/api/trees/:id", trees::delete)
        .get_async("/api/trees/:id/links", trees::list_links)
        .post_async("/api/trees/:id/links", trees::create_link)
        .delete_async("/api/trees/:id/links/:linkId", trees::delete_link)
        .get_async("/api/trees/:id/ws", trees::socket)
        .get_async("/api/trees/:id/photos/:photoId", trees::photo)
        .put_async("/api/trees/:id/photos/:photoId", trees::photo)
        .get_async("/api/s/:token", trees::resolve)
        .post_async("/api/__test/evict/:id", trees::evict)
        .or_else_any_method("/*path", |_, _| error(404, "NOT_FOUND"))
        .run(req, env)
        .await
}
