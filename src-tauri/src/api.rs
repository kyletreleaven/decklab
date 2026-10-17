//! A localhost HTTP API for agents and the CLI.
//!
//! The app's logic lives in TypeScript in the webview, and a webview cannot
//! listen on a port. So Rust holds the listener and nothing else: each request
//! is forwarded to the webview nearly untouched, the TypeScript router (Hono)
//! answers it — token check included — and the reply comes back through the
//! `api_reply` command. Rust is a pipe; what the API *does* is decided in
//! `src/api/`, so it moves with the TypeScript if the backend ever leaves the
//! webview.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::response::Response;
use axum::Router;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// Overridable with `DECKLAB_API_PORT`.
const DEFAULT_PORT: u16 = 47_474;

/// How long a request waits for the webview. A hidden webview may be throttled,
/// and one that is mid-reload is not listening at all; either way the caller
/// gets a 504 rather than hanging.
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);

pub struct ApiBridge {
    /// Fresh each launch: restarting the app revokes every token handed out.
    token: String,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<ApiReply>>>,
}

impl ApiBridge {
    pub fn new() -> Self {
        Self {
            token: uuid::Uuid::new_v4().simple().to_string(),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct ApiRequest {
    id: u64,
    method: String,
    /// Path and query, e.g. `/decks?sort=name`.
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
}

#[derive(Deserialize)]
pub struct ApiReply {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// The webview reads the token to check requests against it.
#[tauri::command]
pub fn api_token(bridge: State<'_, ApiBridge>) -> String {
    bridge.token.clone()
}

/// The webview's answer to an `api-request` event. A reply for an id nobody is
/// waiting on (timed out, or answered twice after a hot reload) is dropped.
#[tauri::command]
pub fn api_reply(bridge: State<'_, ApiBridge>, id: u64, reply: ApiReply) {
    if let Some(tx) = bridge.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

/// Bind the listener and serve until the app exits. A taken port is reported
/// and the app carries on without an API.
pub fn start(app: AppHandle) {
    let port = std::env::var("DECKLAB_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("DeckLab API: could not listen on 127.0.0.1:{port}: {e}");
                return;
            }
        };
        let token = app.state::<ApiBridge>().token.clone();
        eprintln!("DeckLab API: http://127.0.0.1:{port}  token: {token}");

        let router = Router::new().fallback(move |method, uri, headers, body| {
            forward(app.clone(), method, uri, headers, body)
        });
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("DeckLab API stopped: {e}");
        }
    });
}

async fn forward(
    app: AppHandle,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let bridge = app.state::<ApiBridge>();
    let id = bridge.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    bridge.pending.lock().unwrap().insert(id, tx);

    let request = ApiRequest {
        id,
        method: method.to_string(),
        url: uri
            .path_and_query()
            .map(|pq| pq.to_string())
            .unwrap_or_else(|| "/".into()),
        headers: headers
            .iter()
            .filter_map(|(k, v)| Some((k.to_string(), v.to_str().ok()?.to_string())))
            .collect(),
        body: (!body.is_empty()).then(|| String::from_utf8_lossy(&body).into_owned()),
    };

    if let Err(e) = app.emit("api-request", request) {
        bridge.pending.lock().unwrap().remove(&id);
        return plain(StatusCode::SERVICE_UNAVAILABLE, format!("could not reach the app: {e}"));
    }

    match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
        Ok(Ok(reply)) => {
            let mut response = Response::new(Body::from(reply.body));
            *response.status_mut() =
                StatusCode::from_u16(reply.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            for (k, v) in reply.headers {
                if let (Ok(k), Ok(v)) = (HeaderName::try_from(k), HeaderValue::try_from(v)) {
                    response.headers_mut().append(k, v);
                }
            }
            response
        }
        _ => {
            bridge.pending.lock().unwrap().remove(&id);
            plain(StatusCode::GATEWAY_TIMEOUT, "the app did not answer in time".into())
        }
    }
}

fn plain(status: StatusCode, message: String) -> Response {
    let mut response = Response::new(Body::from(message));
    *response.status_mut() = status;
    response
}
