mod api;
mod card_store;
mod lab;
mod library;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Scryfall asks that clients identify themselves.
/// See https://scryfall.com/docs/api
const USER_AGENT: &str = concat!("DeckLab/", env!("CARGO_PKG_VERSION"), " (desktop)");

/// Where a card image lives in the app data directory, creating the folder.
///
/// Images are content-addressed by `key` (typically the Scryfall printing id plus a
/// face suffix). Downloading in Rust rather than in the webview keeps the bytes off
/// the JS bridge and gives us a real file on disk for offline use.
async fn image_path(app: &AppHandle, key: &str) -> Result<(PathBuf, PathBuf), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("images");

    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("could not create image cache dir: {e}"))?;

    // `key` reaches us from the frontend, so keep it to characters that cannot
    // escape the cache directory.
    let safe: String = key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    if safe.is_empty() {
        return Err("empty image key".into());
    }

    Ok((dir.join(format!("{safe}.jpg")), dir.join(format!("{safe}.part"))))
}

/// The cached image's absolute path, if it is on disk. Never touches the network.
#[tauri::command]
async fn cached_card_image(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let (path, _) = image_path(&app, &key).await?;
    Ok(tokio::fs::try_exists(&path)
        .await
        .unwrap_or(false)
        .then(|| path.to_string_lossy().into_owned()))
}

/// What one image download came back with: the status, so a 429 reaches the
/// channel, and the path once the image is on disk.
#[derive(serde::Serialize)]
struct ImageDownload {
    status: u16,
    retry_after: Option<String>,
    path: Option<String>,
}

/// Download one card image: exactly one request to Scryfall's image servers.
///
/// Only ever called through the channel to Scryfall (`scheduledCall` in
/// `src/lib/images.ts`), which decides when it may run. A response that is not
/// a success is returned, not raised, so the caller sees a 429 and its
/// `Retry-After`.
#[tauri::command]
async fn download_card_image(
    app: AppHandle,
    key: String,
    url: String,
) -> Result<ImageDownload, String> {
    let (path, tmp) = image_path(&app, &key).await?;

    let response = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("image request failed: {e}"))?;

    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    if !status.is_success() {
        return Ok(ImageDownload {
            status: status.as_u16(),
            retry_after,
            path: None,
        });
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("could not read image body: {e}"))?;

    // Write to a temporary file first so an interrupted download never leaves a
    // truncated image that later calls would treat as cached.
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|e| format!("could not write image: {e}"))?;
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| format!("could not finalise image: {e}"))?;

    Ok(ImageDownload {
        status: status.as_u16(),
        retry_after,
        path: Some(path.to_string_lossy().into_owned()),
    })
}

/// Read a user-chosen text file.
///
/// The path always comes from a native file dialog, so the user has already
/// consented to this exact file. Doing the read here rather than through the
/// JS fs plugin avoids having to grant the frontend a broad filesystem scope.
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("could not read {path}: {e}"))
}

/// Write exported text to a user-chosen path, for the same reason.
#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    tokio::fs::write(&path, contents)
        .await
        .map_err(|e| format!("could not write {path}: {e}"))
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "deck piles",
            sql: include_str!("../migrations/002_piles.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "oracle fetch stamps",
            sql: include_str!("../migrations/003_oracle_fetches.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "collection quantity kind",
            sql: include_str!("../migrations/004_quantity_kind.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:decklab.db", migrations())
                .add_migrations(
                    "sqlite:lab.db",
                    migrations().into_iter().chain(lab::migrations()).collect(),
                )
                .add_migrations("sqlite:card-cache.db", card_store::migrations())
                .build(),
        )
        .setup(|app| {
            if lab::enabled() {
                lab::setup(app.handle())?;
            }
            Ok(())
        })
        .manage(api::ApiBridge::default())
        .menu(|app| {
            let menu = api::menu(app)?;
            library::add_to(app, &menu)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if !library::on_menu_event(app, &event) {
                api::on_menu_event(app, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            cached_card_image,
            download_card_image,
            read_text_file,
            write_text_file,
            lab::prepare_lab_db,
            lab::lab_seed,
            card_store::prepare_card_store,
            card_store::finish_card_store,
            api::api_token,
            api::api_reply
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
