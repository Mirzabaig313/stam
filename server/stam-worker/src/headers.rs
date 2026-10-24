//! Environment helpers.

use worker::Env;

pub fn is_dev(env: &Env) -> bool {
    env.var("ENVIRONMENT").is_ok_and(|v| v.to_string() == "dev")
}
