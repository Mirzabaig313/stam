//! The Stam Worker: serves the built site and the API on one origin (spec §3). Shared trees live in
//! `TreeRoom` Durable Objects; accounts and links in D1; photos in R2.

use worker::{Context, Env, Request, Response, Result, event};

mod auth;
mod crypto;
mod db;
mod headers;
mod ratelimit;
mod room_do;
mod routes;
mod trees;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    routes::handle(req, env).await
}
