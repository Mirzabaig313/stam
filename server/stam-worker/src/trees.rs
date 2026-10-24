//! Shared trees, view links, the WebSocket upgrade and photos (spec §6, §7.2). The Worker decides
//! who someone is (session or link) and forwards to the tree's `TreeRoom` with that attachment.

use serde::Deserialize;
use serde_json::{Value, json};
use stam_core::parse_tree_value;
use stam_room::{Attachment, Author, AuthorKind, MAX_PEOPLE, Role};
use worker::wasm_bindgen::JsValue;
use worker::{Env, Headers, Method, Request, RequestInit, Response, Result, RouteContext, Stub};

use crate::auth::{current_user, iso, now_ms, same_origin, secret};
use crate::crypto::{decrypt, encrypt, random_id, random_token, sha256_b64};
use crate::db::{self, User};
use crate::room_do::ATTACHMENT_HEADER;
use crate::routes::error;

fn room(env: &Env, tree_id: &str) -> Result<Stub> {
    env.durable_object("TREE_ROOM")?
        .id_from_name(tree_id)?
        .get_stub()
}

/// A request to the tree's room. Only these headers reach it, never the client's.
async fn to_room(
    env: &Env,
    tree_id: &str,
    method: Method,
    path: &str,
    headers: Headers,
    body: Option<JsValue>,
) -> Result<Response> {
    let mut init = RequestInit::new();
    init.with_method(method)
        .with_headers(headers)
        .with_body(body);
    room(env, tree_id)?
        .fetch_with_request(Request::new_with_init(
            &format!("https://room{path}"),
            &init,
        )?)
        .await
}

async fn room_json(env: &Env, tree_id: &str, path: &str, body: &Value) -> Result<Response> {
    let headers = Headers::new();
    headers.set("content-type", "application/json")?;
    to_room(
        env,
        tree_id,
        Method::Post,
        path,
        headers,
        Some(JsValue::from_str(&body.to_string())),
    )
    .await
}

/// State-changing JSON requests come from the site (CSRF) and say they are JSON.
fn check_json_request(req: &Request) -> Option<Result<Response>> {
    if !same_origin(req) {
        return Some(error(403, "FORBIDDEN"));
    }
    let json = req
        .headers()
        .get("content-type")
        .ok()
        .flatten()
        .is_some_and(|t| t.starts_with("application/json"));
    (!json).then(|| error(415, "JSON_ONLY"))
}

fn param<'a>(ctx: &'a RouteContext<()>, name: &str) -> &'a str {
    ctx.param(name).map_or("", String::as_str)
}

/// The signed-in owner of a live tree, or the response to send instead (401, or 404 for anyone
/// else, so tree ids are not confirmed to strangers).
async fn owner_of(
    req: &Request,
    env: &Env,
    tree_id: &str,
) -> Result<std::result::Result<User, Response>> {
    let Some(user) = current_user(req, env).await? else {
        return Ok(Err(error(401, "SIGNED_OUT")?));
    };
    match db::tree_owner(&env.d1("DB")?, tree_id).await? {
        Some(t) if t.owner_id == user.id && t.deleted_at.is_none() => Ok(Ok(user)),
        _ => Ok(Err(error(404, "NOT_FOUND")?)),
    }
}

/// `POST /api/trees` `{doc}`: upload a tree and create its room.
pub async fn create(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if let Some(refused) = check_json_request(&req) {
        return refused;
    }
    let env = &ctx.env;
    let Some(user) = current_user(&req, env).await? else {
        return error(401, "SIGNED_OUT");
    };
    let body: Value = match req.json().await {
        Ok(v) => v,
        Err(_) => return error(400, "INVALID_TREE"),
    };
    let Ok(doc) = parse_tree_value(&body["doc"]) else {
        return error(400, "INVALID_TREE");
    };
    if doc.persons.len() > MAX_PEOPLE {
        return error(413, "TOO_LARGE");
    }
    let db = env.d1("DB")?;
    match db::tree_owner(&db, &doc.id).await? {
        Some(t) if t.owner_id != user.id => return error(409, "TREE_ID_TAKEN"),
        Some(t) if t.deleted_at.is_none() => return error(409, "ALREADY_SHARED"),
        _ => {}
    }
    let now = iso(now_ms());
    db::put_tree(&db, &doc.id, &user.id, &doc.name, &now).await?;
    let author = Author {
        kind: AuthorKind::Owner,
        id: user.id.clone(),
        name: user.name.clone(),
    };
    let init = room_json(
        env,
        &doc.id,
        "/init",
        &json!({ "doc": doc, "author": author, "treeId": doc.id }),
    )
    .await?;
    if init.status_code() != 201 {
        return error(500, "ROOM_FAILED");
    }
    Ok(Response::from_json(&json!({ "id": doc.id, "version": 0 }))?.with_status(201))
}

/// `DELETE /api/trees/:id`: stop sharing and delete the cloud copy.
pub async fn delete(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if !same_origin(&req) {
        return error(403, "FORBIDDEN");
    }
    let id = param(&ctx, "id").to_owned();
    if let Err(refused) = owner_of(&req, &ctx.env, &id).await? {
        return Ok(refused);
    }
    room_json(&ctx.env, &id, "/destroy", &json!({})).await?;
    db::delete_tree(&ctx.env.d1("DB")?, &id, &iso(now_ms())).await?;
    Ok(Response::empty()?.with_status(204))
}

/// The link as people open it, on the site's configured origin (`wrangler dev` rewrites the
/// request's own host to the production route).
fn link_url(env: &Env, token: &str) -> Result<String> {
    Ok(format!("{}/s/{token}", env.var("SITE_ORIGIN")?))
}

fn link_json(env: &Env, link: &db::LinkRow) -> Result<Value> {
    let token = decrypt(&link.token_cipher, &secret(env, "LINK_KEY")?).unwrap_or_default();
    Ok(json!({
        "id": link.id,
        "role": link.role,
        "hideLiving": link.hide_living != 0,
        "url": link_url(env, &token)?,
        "createdAt": link.created_at,
    }))
}

/// `GET /api/trees/:id/links`: the active links, with their URLs (decrypted for the owner).
pub async fn list_links(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = param(&ctx, "id").to_owned();
    if let Err(refused) = owner_of(&req, &ctx.env, &id).await? {
        return Ok(refused);
    }
    let links = db::active_links(&ctx.env.d1("DB")?, &id).await?;
    let out = links
        .iter()
        .map(|l| link_json(&ctx.env, l))
        .collect::<Result<Vec<_>>>()?;
    Response::from_json(&out)
}

/// `POST /api/trees/:id/links` `{role, hideLiving?}`: a new link (resetting the old one of that role).
pub async fn create_link(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if let Some(refused) = check_json_request(&req) {
        return refused;
    }
    let env = &ctx.env;
    let id = param(&ctx, "id").to_owned();
    if let Err(refused) = owner_of(&req, env, &id).await? {
        return Ok(refused);
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct NewLink {
        role: String,
        #[serde(default)]
        hide_living: bool,
    }
    let Ok(body) = req.json::<NewLink>().await else {
        return error(400, "BAD_REQUEST");
    };
    // P1 shares view links only; comment and edit links come with P3 and P2.
    if body.role != "view" {
        return error(400, "NOT_AVAILABLE");
    }
    let db = env.d1("DB")?;
    let now = iso(now_ms());
    if let Some(old) = db::revoke_role(&db, &id, &body.role, &now).await? {
        room_json(env, &id, "/close-link", &json!({ "linkId": old })).await?;
    }
    let token = random_token();
    let Some(cipher) = encrypt(&token, &secret(env, "LINK_KEY")?) else {
        return error(500, "LINK_KEY");
    };
    let link_id = random_id();
    db::create_link(
        &db,
        &link_id,
        &id,
        &body.role,
        body.hide_living,
        &sha256_b64(&token),
        &cipher,
        &now,
    )
    .await?;
    let out = json!({
        "id": link_id,
        "role": body.role,
        "hideLiving": body.hide_living,
        "url": link_url(env, &token)?,
        "createdAt": now,
    });
    Ok(Response::from_json(&out)?.with_status(201))
}

/// `DELETE /api/trees/:id/links/:linkId`: turn a link off; its sockets close with 4401.
pub async fn delete_link(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    if !same_origin(&req) {
        return error(403, "FORBIDDEN");
    }
    let (id, link_id) = (
        param(&ctx, "id").to_owned(),
        param(&ctx, "linkId").to_owned(),
    );
    if let Err(refused) = owner_of(&req, &ctx.env, &id).await? {
        return Ok(refused);
    }
    if !db::revoke_link(&ctx.env.d1("DB")?, &id, &link_id, &iso(now_ms())).await? {
        return error(404, "NOT_FOUND");
    }
    room_json(&ctx.env, &id, "/close-link", &json!({ "linkId": link_id })).await?;
    Ok(Response::empty()?.with_status(204))
}

/// `GET /api/s/:token`: what a link opens.
pub async fn resolve(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let token = param(&ctx, "token");
    match db::resolve_link(&ctx.env.d1("DB")?, &sha256_b64(token)).await? {
        Some(link) => Response::from_json(&json!({
            "treeId": link.tree_id,
            "role": link.role,
            "hideLiving": link.hide_living != 0,
            "name": link.name,
        })),
        None => error(404, "LINK_OFF"),
    }
}

fn role_of(name: &str) -> Option<Role> {
    serde_json::from_value(Value::String(name.to_owned())).ok()
}

/// Who is asking about this tree: a link (`?t=`) or the owner's session. None: nobody it allows.
async fn attachment_for(req: &Request, env: &Env, tree_id: &str) -> Result<Option<Attachment>> {
    let token = req
        .url()?
        .query_pairs()
        .find(|(k, _)| k == "t")
        .map(|(_, v)| v.into_owned());
    if let Some(token) = token {
        let link = db::resolve_link(&env.d1("DB")?, &sha256_b64(&token)).await?;
        return Ok(link.filter(|l| l.tree_id == tree_id).and_then(|l| {
            Some(Attachment {
                socket_id: random_id(),
                role: role_of(&l.role)?,
                link_id: Some(l.id),
                hide_living: l.hide_living != 0,
                author: Author {
                    kind: AuthorKind::Link,
                    id: String::new(),
                    name: String::new(),
                },
            })
        }));
    }
    Ok(owner_of(req, env, tree_id)
        .await?
        .ok()
        .map(|user| Attachment {
            socket_id: random_id(),
            role: Role::Owner,
            link_id: None,
            hide_living: false,
            author: Author {
                kind: AuthorKind::Owner,
                id: user.id,
                name: user.name,
            },
        }))
}

fn attachment_headers(att: &Attachment) -> Result<Headers> {
    let headers = Headers::new();
    headers.set(ATTACHMENT_HEADER, &serde_json::to_string(att)?)?;
    Ok(headers)
}

/// `GET /api/trees/:id/ws`: the WebSocket into the tree's room.
pub async fn socket(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let upgrade = req.headers().get("upgrade").ok().flatten();
    if !upgrade.is_some_and(|u| u.eq_ignore_ascii_case("websocket")) {
        return error(426, "WEBSOCKET_ONLY");
    }
    let id = param(&ctx, "id").to_owned();
    let Some(att) = attachment_for(&req, &ctx.env, &id).await? else {
        return error(401, "NO_ACCESS");
    };
    let headers = attachment_headers(&att)?;
    headers.set("Upgrade", "websocket")?;
    to_room(&ctx.env, &id, Method::Get, "/ws", headers, None).await
}

/// `GET|PUT /api/trees/:id/photos/:photoId`: photos through the room's access check.
pub async fn photo(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let put = req.method() == Method::Put;
    if put && !same_origin(&req) {
        return error(403, "FORBIDDEN");
    }
    let (id, photo_id) = (
        param(&ctx, "id").to_owned(),
        param(&ctx, "photoId").to_owned(),
    );
    if !stam_core::is_safe_id(&photo_id) {
        return error(404, "NOT_FOUND");
    }
    let Some(att) = attachment_for(&req, &ctx.env, &id).await? else {
        return error(401, "NO_ACCESS");
    };
    let body = if put {
        let bytes = req.bytes().await?;
        Some(js_sys::Uint8Array::from(bytes.as_slice()).into())
    } else {
        None
    };
    to_room(
        &ctx.env,
        &id,
        req.method(),
        &format!("/photo/{photo_id}"),
        attachment_headers(&att)?,
        body,
    )
    .await
}
