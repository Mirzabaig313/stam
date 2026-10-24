//! Security headers for pages the Worker serves. `public/_headers` covers plain static files, but
//! Cloudflare does not apply it to responses the Worker produces, so they are set here.

use worker::{Env, Headers, Result};

const PRODUCTION_CONNECT: &str = "'self' wss://stam.mirzalabs.in";
/// The local Worker runs on its own port (8787 in dev, 8788 in tests).
const DEV_CONNECT: &str = "'self' ws://localhost:*";

pub fn is_dev(env: &Env) -> bool {
    env.var("ENVIRONMENT").is_ok_and(|v| v.to_string() == "dev")
}

pub fn content_security_policy(dev: bool) -> String {
    let connect = if dev { DEV_CONNECT } else { PRODUCTION_CONNECT };
    format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' blob: data:; font-src 'self'; connect-src {connect}; object-src 'none'; \
         base-uri 'self'; frame-ancestors 'none'"
    )
}

pub fn security_headers(headers: &Headers, dev: bool) -> Result<()> {
    headers.set("Content-Security-Policy", &content_security_policy(dev))?;
    headers.set("Referrer-Policy", "no-referrer")?;
    headers.set("X-Content-Type-Options", "nosniff")?;
    headers.set(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
    )?;
    Ok(())
}
