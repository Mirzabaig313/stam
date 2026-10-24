//! HTTP routing. `/api/*` is the REST API (spec §7); `/app`, `/app/*` and `/s/*` are the app's
//! client-side routes, all served `app.html`.

use serde_json::json;
use worker::{Env, Request, Response, Result, RouteContext, Router};

use crate::headers::{is_dev, security_headers};
use crate::{auth, ratelimit, trees};

/// A JSON error body: `{"error": code}`.
pub fn error(status: u16, code: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({ "error": code }))?.with_status(status))
}

pub async fn handle(req: Request, env: Env) -> Result<Response> {
    if let Some(limited) = ratelimit::check(&req, &env).await? {
        return Ok(limited);
    }
    Router::new()
        .get("/api/health", |_, _| {
            Response::from_json(&json!({ "ok": true }))
        })
        .get_async("/api/auth/google", auth::sign_in)
        .get_async("/api/auth/google/callback", auth::callback)
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
        .get_async("/app", serve_app)
        .get_async("/app/*path", serve_app)
        .get_async("/s/*path", serve_app)
        .or_else_any_method("/api/*path", |_, _| error(404, "NOT_FOUND"))
        .run(req, env)
        .await
}

/// The app's page for any of its routes, with the security headers.
async fn serve_app(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    // Static assets serve `app.html` at `/app` (the `.html` is dropped).
    let page = ctx
        .env
        .assets("ASSETS")?
        .fetch("https://assets.local/app", None)
        .await?;
    let status = page.status_code();
    let mut page = page;
    let html = page.text().await?;
    let res = Response::from_html(html)?.with_status(status);
    security_headers(res.headers(), is_dev(&ctx.env))?;
    Ok(res)
}
