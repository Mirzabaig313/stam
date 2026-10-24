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

/// Deletes an unexpired session and returns its user: whoever deletes it first gets it.
pub async fn take_session(db: &D1Database, token_hash: &str, now: &str) -> Result<Option<String>> {
    #[derive(Deserialize)]
    struct Taken {
        user_id: String,
    }
    let row = db
        .prepare("DELETE FROM session WHERE token_hash = ?1 AND expires_at > ?2 RETURNING user_id")
        .bind(&[text(token_hash), text(now)])?
        .first::<Taken>(None)
        .await?;
    Ok(row.map(|r| r.user_id))
}

pub async fn delete_session(db: &D1Database, token_hash: &str) -> Result<()> {
    db.prepare("DELETE FROM session WHERE token_hash = ?1")
        .bind(&[text(token_hash)])?
        .run()
        .await?;
    Ok(())
}

/// The user's saved app settings (JSON), if any.
pub async fn user_settings(db: &D1Database, user_id: &str) -> Result<Option<String>> {
    #[derive(Deserialize)]
    struct Row {
        settings: Option<String>,
    }
    let row = db
        .prepare("SELECT settings FROM user WHERE id = ?1")
        .bind(&[text(user_id)])?
        .first::<Row>(None)
        .await?;
    Ok(row.and_then(|r| r.settings))
}

pub async fn set_user_settings(db: &D1Database, user_id: &str, settings: &str) -> Result<()> {
    db.prepare("UPDATE user SET settings = ?2 WHERE id = ?1")
        .bind(&[text(user_id), text(settings)])?
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

#[derive(Clone, Debug, Deserialize)]
pub struct TreeOwner {
    pub owner_id: String,
    pub deleted_at: Option<String>,
}

pub async fn tree_owner(db: &D1Database, tree_id: &str) -> Result<Option<TreeOwner>> {
    db.prepare("SELECT owner_id, deleted_at FROM tree WHERE id = ?1")
        .bind(&[text(tree_id)])?
        .first::<TreeOwner>(None)
        .await
}

/// A new shared tree, or a deleted one of the same owner shared again.
pub async fn put_tree(
    db: &D1Database,
    id: &str,
    owner_id: &str,
    name: &str,
    now: &str,
) -> Result<()> {
    db.prepare(
        "INSERT INTO tree (id, owner_id, name, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at,
           deleted_at = NULL
         WHERE tree.owner_id = excluded.owner_id",
    )
    .bind(&[text(id), text(owner_id), text(name), text(now)])?
    .run()
    .await?;
    Ok(())
}

/// Marks the tree deleted and turns every link off.
pub async fn delete_tree(db: &D1Database, id: &str, now: &str) -> Result<()> {
    db.batch(vec![
        db.prepare("UPDATE tree SET deleted_at = ?2 WHERE id = ?1")
            .bind(&[text(id), text(now)])?,
        db.prepare(
            "UPDATE share_link SET revoked_at = ?2 WHERE tree_id = ?1 AND revoked_at IS NULL",
        )
        .bind(&[text(id), text(now)])?,
    ])
    .await?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
pub struct LinkRow {
    pub id: String,
    pub role: String,
    pub hide_living: i64,
    pub token_cipher: String,
    pub created_at: String,
}

pub async fn active_links(db: &D1Database, tree_id: &str) -> Result<Vec<LinkRow>> {
    db.prepare(
        "SELECT id, role, hide_living, token_cipher, created_at FROM share_link
         WHERE tree_id = ?1 AND revoked_at IS NULL ORDER BY created_at",
    )
    .bind(&[text(tree_id)])?
    .all()
    .await?
    .results::<LinkRow>()
}

/// Turns off the active link of this role (if any); returns its id.
pub async fn revoke_role(
    db: &D1Database,
    tree_id: &str,
    role: &str,
    now: &str,
) -> Result<Option<String>> {
    let old = db
        .prepare(
            "SELECT id FROM share_link WHERE tree_id = ?1 AND role = ?2 AND revoked_at IS NULL",
        )
        .bind(&[text(tree_id), text(role)])?
        .first::<String>(Some("id"))
        .await?;
    if let Some(id) = &old {
        revoke_link(db, tree_id, id, now).await?;
    }
    Ok(old)
}

/// Turns a link off; false when the tree has no such active link.
pub async fn revoke_link(db: &D1Database, tree_id: &str, link_id: &str, now: &str) -> Result<bool> {
    let changed = db
        .prepare("UPDATE share_link SET revoked_at = ?3 WHERE id = ?1 AND tree_id = ?2 AND revoked_at IS NULL")
        .bind(&[text(link_id), text(tree_id), text(now)])?
        .run()
        .await?
        .meta()?
        .and_then(|m| m.changes)
        .unwrap_or(0);
    Ok(changed > 0)
}

#[allow(clippy::too_many_arguments)]
pub async fn create_link(
    db: &D1Database,
    id: &str,
    tree_id: &str,
    role: &str,
    hide_living: bool,
    token_hash: &str,
    token_cipher: &str,
    now: &str,
) -> Result<()> {
    db.prepare(
        "INSERT INTO share_link (id, tree_id, role, hide_living, token_hash, token_cipher, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&[
        text(id),
        text(tree_id),
        text(role),
        JsValue::from_f64(if hide_living { 1.0 } else { 0.0 }),
        text(token_hash),
        text(token_cipher),
        text(now),
    ])?
    .run()
    .await?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
pub struct ResolvedLink {
    pub id: String,
    pub tree_id: String,
    pub role: String,
    pub hide_living: i64,
    pub name: String,
}

/// An active link of a live tree, by token hash.
pub async fn resolve_link(db: &D1Database, token_hash: &str) -> Result<Option<ResolvedLink>> {
    db.prepare(
        "SELECT share_link.id, share_link.tree_id, share_link.role, share_link.hide_living, tree.name
         FROM share_link JOIN tree ON tree.id = share_link.tree_id
         WHERE share_link.token_hash = ?1 AND share_link.revoked_at IS NULL AND tree.deleted_at IS NULL",
    )
    .bind(&[text(token_hash)])?
    .first::<ResolvedLink>(None)
    .await
}
