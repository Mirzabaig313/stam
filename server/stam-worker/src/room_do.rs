//! The `TreeRoom` Durable Object: one per shared tree (filled in by Task 10).

use worker::{DurableObject, Env, Request, Response, Result, State, durable_object, wasm_bindgen};

#[durable_object]
pub struct TreeRoom {
    _state: State,
}

impl DurableObject for TreeRoom {
    fn new(state: State, _env: Env) -> Self {
        Self { _state: state }
    }

    async fn fetch(&self, _req: Request) -> Result<Response> {
        Response::error("Not ready", 501)
    }
}
