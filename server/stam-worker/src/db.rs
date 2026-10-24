//! Every D1 query, in one place (workers-rs marks D1 as alpha; if its API breaks, only this file
//! changes).

use serde::{Deserialize, Serialize};
use worker::wasm_bindgen::JsValue;
use worker::{D1Database, Result};

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeRow {
    pub id: String,
    pub name: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

/// Creates the user for this Google account, or refreshes their name and email; returns the id.
pub async fn upsert_user(
    db: &D1Database,
    new_id: &str,
    google_sub: &str,
    email: &str,
    name: &str,
    now: &str,
) -> Result<String> {
    db.prepare(
        "INSERT INTO user (id, google_sub, email, name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name",
    )
    .bind(&[
        text(new_id),
        text(google_sub),
        text(email),
        text(name),
        text(now),
    ])?
    .run()
    .await?;
    let id = db
        .prepare("SELECT id FROM user WHERE google_sub = ?1")
        .bind(&[text(google_sub)])?
        .first::<String>(Some("id"))
        .await?;
    id.ok_or_else(|| worker::Error::RustError("user missing after upsert".into()))
}

pub async fn create_session(
    db: &D1Database,
    token_hash: &str,
    user_id: &str,
    now: &str,
    expires_at: &str,
) -> Result<()> {
    db.prepare(
        "INSERT INTO session (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&[text(token_hash), text(user_id), text(now), text(expires_at)])?
    .run()
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct SessionRow {
    id: String,
    name: String,
    email: String,
    expires_at: String,
}

/// The user of an unexpired session, and when it expires.
pub async fn session_user(
    db: &D1Database,
    token_hash: &str,
    now: &str,
) -> Result<Option<(User, String)>> {
    let row = db
        .prepare(
            "SELECT user.id, user.name, user.email, session.expires_at FROM session
             JOIN user ON user.id = session.user_id
             WHERE session.token_hash = ?1 AND session.expires_at > ?2",
        )
        .bind(&[text(token_hash), text(now)])?
        .first::<SessionRow>(None)
        .await?;
    Ok(row.map(|r| {
        (
            User {
                id: r.id,
                name: r.name,
                email: r.email,
            },
            r.expires_at,
        )
    }))
}

pub async fn extend_session(db: &D1Database, token_hash: &str, expires_at: &str) -> Result<()> {
    db.prepare("UPDATE session SET expires_at = ?2 WHERE token_hash = ?1")
        .bind(&[text(token_hash), text(expires_at)])?
        .run()
        .await?;
    Ok(())
}

pub async fn delete_session(db: &D1Database, token_hash: &str) -> Result<()> {
    db.prepare("DELETE FROM session WHERE token_hash = ?1")
        .bind(&[text(token_hash)])?
        .run()
        .await?;
    Ok(())
}

/// The user's shared trees, newest first.
pub async fn user_trees(db: &D1Database, user_id: &str) -> Result<Vec<TreeRow>> {
    db.prepare(
        "SELECT id, name, created_at FROM tree WHERE owner_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at DESC",
    )
    .bind(&[text(user_id)])?
    .all()
    .await?
    .results::<TreeRow>()
}
