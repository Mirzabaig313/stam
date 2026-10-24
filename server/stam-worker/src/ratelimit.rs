//! Per-IP rate limits (Cloudflare's rate-limit bindings, counted per location per 60 s). They stop
//! loops and casual abuse from using up the free plan's daily requests for everyone; a request
//! over its limit gets 429 `RATE_LIMITED`. The limits live in `wrangler.jsonc`.

use worker::{Env, Request, Response, Result};

use crate::headers::is_dev;
use crate::routes::error;

/// Which limit a request counts against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bucket {
    /// Everything not below: the API, and the app's pages the Worker serves.
    Api,
    /// Photo downloads and uploads (a tree can show hundreds at once).
    Photos,
    /// Opening share links, and link users' sockets: the routes anyone with a URL can reach.
    Links,
    /// Starting or finishing Google sign-in.
    Auth,
}

impl Bucket {
    fn binding(self) -> &'static str {
        match self {
            Bucket::Api => "LIMIT_API",
            Bucket::Photos => "LIMIT_PHOTOS",
            Bucket::Links => "LIMIT_LINKS",
            Bucket::Auth => "LIMIT_AUTH",
        }
    }
}

/// The limit for a request to `path` (`has_token`: a `?t=` link token); none for the health check.
pub fn bucket(path: &str, has_token: bool) -> Option<Bucket> {
    if path == "/api/health" {
        return None;
    }
    if path.starts_with("/api/auth/") {
        return Some(Bucket::Auth);
    }
    if path.starts_with("/api/s/") || path.starts_with("/s/") {
        return Some(Bucket::Links);
    }
    if path.starts_with("/api/trees/") {
        if path.contains("/photos/") {
            return Some(Bucket::Photos);
        }
        if path.ends_with("/ws") && has_token {
            return Some(Bucket::Links);
        }
    }
    Some(Bucket::Api)
}

/// Who is asking: the client's IP as Cloudflare saw it. Local tests name their own (each test gets
/// its own address, so the suite never trips the limits it does not test).
fn client_key(req: &Request, dev: bool) -> String {
    let header = |name: &str| req.headers().get(name).ok().flatten();
    (if dev { header("x-stam-test-ip") } else { None })
        .or_else(|| header("cf-connecting-ip"))
        .unwrap_or_else(|| "unknown".to_owned())
}

/// A 429 when the request is over its limit. A missing binding or a failing check lets the request
/// through: the limits protect the quota, they must never take the app down.
pub async fn check(req: &Request, env: &Env) -> Result<Option<Response>> {
    let url = req.url()?;
    let has_token = url.query_pairs().any(|(k, _)| k == "t");
    let Some(bucket) = bucket(url.path(), has_token) else {
        return Ok(None);
    };
    let Ok(limiter) = env.rate_limiter(bucket.binding()) else {
        return Ok(None);
    };
    match limiter.limit(client_key(req, is_dev(env))).await {
        Ok(outcome) if !outcome.success => {
            let res = error(429, "RATE_LIMITED")?;
            res.headers().set("Retry-After", "60")?;
            Ok(Some(res))
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_route_counts_against_its_limit() {
        assert_eq!(bucket("/api/health", false), None);
        assert_eq!(bucket("/api/auth/google", false), Some(Bucket::Auth));
        assert_eq!(
            bucket("/api/auth/google/callback", false),
            Some(Bucket::Auth)
        );
        assert_eq!(bucket("/api/s/abc", false), Some(Bucket::Links));
        assert_eq!(bucket("/s/abc", false), Some(Bucket::Links));
        assert_eq!(
            bucket("/api/trees/t1/photos/p1", true),
            Some(Bucket::Photos)
        );
        assert_eq!(
            bucket("/api/trees/t1/photos/p1", false),
            Some(Bucket::Photos)
        );
        assert_eq!(bucket("/api/trees/t1/ws", true), Some(Bucket::Links));
        assert_eq!(bucket("/api/trees/t1/ws", false), Some(Bucket::Api));
        assert_eq!(bucket("/api/me", false), Some(Bucket::Api));
        assert_eq!(bucket("/api/trees", false), Some(Bucket::Api));
        assert_eq!(bucket("/app/t/x", false), Some(Bucket::Api));
    }
}
