//! The card store: `card-cache.db`, Scryfall's data in a file of its own,
//! shared by the real app and lab mode. See `docs/card-fetching.md` →
//! *The card store*.
//!
//! The first launch without one starts it from the user database's cached
//! cards: the webview copies `decklab.db` to a staging file with `VACUUM INTO`,
//! drops the user's tables and migration records from the copy, and asks
//! `finish_card_store` to move it into place (`src/lib/db.ts`). Only then is
//! `card-cache.db` opened, so its own migrations see a database they can run on.

use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

const STORE: &str = "card-cache.db";
const STAGING: &str = "card-cache.staging.db";

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "card store",
        sql: include_str!("../migrations/cache/001_store.sql"),
        kind: MigrationKind::Up,
    }]
}

/// Where the SQL plugin keeps its databases: it resolves `sqlite:<name>`
/// against the app *config* directory.
pub fn database_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))
}

/// Delete a database and its journal files, if present.
pub fn remove_database(path: &Path) -> Result<(), String> {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut name = OsString::from(path.as_os_str());
        name.push(suffix);
        let file = PathBuf::from(name);
        match std::fs::remove_file(&file) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(format!("could not remove {}: {e}", file.display())),
        }
    }
    Ok(())
}

/// `None` when the store exists. Otherwise clear any staging file a failed
/// start left behind, and return the path to copy into.
#[tauri::command]
pub fn prepare_card_store(app: AppHandle) -> Result<Option<String>, String> {
    let dir = database_dir(&app)?;
    if dir.join(STORE).exists() {
        return Ok(None);
    }
    let staging = dir.join(STAGING);
    remove_database(&staging)?;
    Ok(Some(staging.to_string_lossy().into_owned()))
}

/// Move the finished staging copy into place as the store.
#[tauri::command]
pub fn finish_card_store(app: AppHandle) -> Result<(), String> {
    let dir = database_dir(&app)?;
    let staging = dir.join(STAGING);
    std::fs::rename(&staging, dir.join(STORE))
        .map_err(|e| format!("could not move {} into place: {e}", staging.display()))?;
    remove_database(&staging)
}
