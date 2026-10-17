//! A localhost HTTP API for agents and the CLI, switched on from the menu.
//!
//! The app's logic lives in TypeScript in the webview, and a webview cannot
//! listen on a port. So Rust holds the listener and nothing else: each request
//! is forwarded to the webview nearly untouched, the TypeScript router (Hono)
//! answers it — token check included — and the reply comes back through the
//! `api_reply` command. Rust is a pipe; what the API *does* is decided in
//! `src/api/`, so it moves with the TypeScript if the backend ever leaves the
//! webview.
//!
//! **Off until asked.** Tools → Agent API → Enable binds the port with a fresh
//! token; nothing listens before that, and nothing is remembered across
//! launches. The token never appears on screen: Copy Token is the only way to
//! get it, and New Token revokes the old one.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::response::Response;
use axum::Router;
use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::sync::oneshot;

/// Overridable with `DECKLAB_API_PORT`.
const DEFAULT_PORT: u16 = 47_474;

/// How long a request waits for the webview. A hidden webview may be throttled,
/// and one that is mid-reload is not listening at all; either way the caller
/// gets a 504 rather than hanging.
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);

const MENU_ENABLE: &str = "api-enable";
const MENU_COPY: &str = "api-copy-token";
const MENU_ROTATE: &str = "api-new-token";

#[derive(Default)]
pub struct ApiBridge {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<ApiReply>>>,
    /// `Some` exactly while the port is bound.
    listening: Mutex<Option<Listening>>,
}

struct Listening {
    token: String,
    shutdown: oneshot::Sender<()>,
}

/// Handles to the items whose state follows the listener's.
struct ApiMenu {
    enable: CheckMenuItem<tauri::Wry>,
    status: MenuItem<tauri::Wry>,
    copy: MenuItem<tauri::Wry>,
    rotate: MenuItem<tauri::Wry>,
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

fn port() -> u16 {
    std::env::var("DECKLAB_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// The current token, or `None` while the API is off. Read per request, so a
/// rotation takes effect on the very next one.
#[tauri::command]
pub fn api_token(bridge: State<'_, ApiBridge>) -> Option<String> {
    bridge.listening.lock().unwrap().as_ref().map(|l| l.token.clone())
}

/// The webview's answer to an `api-request` event. A reply for an id nobody is
/// waiting on (timed out, or answered twice after a hot reload) is dropped.
#[tauri::command]
pub fn api_reply(bridge: State<'_, ApiBridge>, id: u64, reply: ApiReply) {
    if let Some(tx) = bridge.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

/// Tools → Agent API, added to whatever menu the platform would otherwise have.
///
/// On macOS that is Tauri's default menu, and starting from it matters:
/// replacing it would lose Edit, and with it ⌘C/⌘V in text fields. Elsewhere
/// Tauri sets no menu at all and text editing works without one, so the menu
/// bar — drawn inside the window there — holds Tools and nothing else.
pub fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let enable = CheckMenuItem::with_id(app, MENU_ENABLE, "Enable Agent API", true, false, None::<&str>)?;
    let status = MenuItem::new(app, "Off", false, None::<&str>)?;
    let copy = MenuItem::with_id(app, MENU_COPY, "Copy Token", false, None::<&str>)?;
    let rotate = MenuItem::with_id(app, MENU_ROTATE, "New Token", false, None::<&str>)?;

    let agent = Submenu::with_items(
        app,
        "Agent API",
        true,
        &[&enable, &status, &PredefinedMenuItem::separator(app)?, &copy, &rotate],
    )?;
    let tools = Submenu::with_items(app, "Tools", true, &[&agent])?;

    #[cfg(target_os = "macos")]
    let menu = {
        // The default always ends Window, Help; Tools goes before Window.
        let menu = Menu::default(app)?;
        let at = menu.items()?.len().saturating_sub(2);
        menu.insert(&tools, at)?;
        menu
    };
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&tools])?;

    app.manage(ApiMenu { enable, status, copy, rotate });
    Ok(menu)
}

pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        // The check mark has already flipped by the time we hear about it.
        MENU_ENABLE => {
            let on = app.state::<ApiMenu>().enable.is_checked().unwrap_or(false);
            if on {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { start(app).await });
            } else {
                stop(app);
            }
        }
        MENU_COPY => {
            if let Some(token) = api_token(app.state()) {
                let _ = app.clipboard().write_text(token);
            }
        }
        MENU_ROTATE => {
            if let Some(l) = app.state::<ApiBridge>().listening.lock().unwrap().as_mut() {
                l.token = new_token();
            }
        }
        _ => {}
    }
}

fn reflect(app: &AppHandle, on: bool) {
    let items = app.state::<ApiMenu>();
    let _ = items.enable.set_checked(on);
    let _ = items.copy.set_enabled(on);
    let _ = items.rotate.set_enabled(on);
    let _ = items.status.set_text(if on {
        format!("Listening on 127.0.0.1:{}", port())
    } else {
        "Off".into()
    });
}

async fn start(app: AppHandle) {
    let port = port();
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
        Ok(l) => l,
        Err(e) => {
            reflect(&app, false);
            app.dialog()
                .message(format!("Could not listen on 127.0.0.1:{port}: {e}"))
                .title("Agent API")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
            return;
        }
    };

    let (shutdown, stopped) = oneshot::channel::<()>();
    *app.state::<ApiBridge>().listening.lock().unwrap() =
        Some(Listening { token: new_token(), shutdown });
    reflect(&app, true);

    let forwarder = app.clone();
    let router = Router::new().fallback(move |method, uri, headers, body| {
        forward(forwarder.clone(), method, uri, headers, body)
    });
    let served = axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = stopped.await;
        })
        .await;
    if let Err(e) = served {
        eprintln!("Agent API stopped: {e}");
        stop(&app);
    }
}

/// Close the port and abandon anything in flight; those callers get a 503.
fn stop(app: &AppHandle) {
    let bridge = app.state::<ApiBridge>();
    if let Some(l) = bridge.listening.lock().unwrap().take() {
        let _ = l.shutdown.send(());
    }
    bridge.pending.lock().unwrap().clear();
    reflect(app, false);
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
        // The sender was dropped: the API was switched off mid-request.
        Ok(Err(_)) => plain(StatusCode::SERVICE_UNAVAILABLE, "the agent API was switched off".into()),
        Err(_) => {
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
