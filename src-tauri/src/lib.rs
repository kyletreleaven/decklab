use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

/// Scryfall asks that clients identify themselves.
/// See https://scryfall.com/docs/api
const USER_AGENT: &str = concat!("DeckLab/", env!("CARGO_PKG_VERSION"), " (desktop)");

/// Download a card image into the app data directory and return its absolute path.
///
/// Images are content-addressed by `key` (typically the Scryfall printing id plus a
/// face suffix), so a second call for the same card is a cheap existence check.
/// Downloading here rather than in the webview keeps the bytes off the JS bridge
/// and gives us a real file on disk for offline use.
#[tauri::command]
async fn cache_card_image(app: AppHandle, key: String, url: String) -> Result<String, String> {
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

    let path = dir.join(format!("{safe}.jpg"));
    if tokio::fs::try_exists(&path).await.unwrap_or(false) {
        return Ok(path.to_string_lossy().into_owned());
    }

    let response = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("image request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("image request returned {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("could not read image body: {e}"))?;

    // Write to a temporary file first so an interrupted download never leaves a
    // truncated image that later calls would treat as cached.
    let tmp = dir.join(format!("{safe}.part"));
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|e| format!("could not write image: {e}"))?;
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| format!("could not finalise image: {e}"))?;

    Ok(path.to_string_lossy().into_owned())
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
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:decklab.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![cache_card_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
