//! Lab mode: the app on a throwaway database.
//!
//! `DECKLAB_LAB=1` (`npm run lab`) opens `lab.db` instead of `decklab.db`, and
//! every launch starts it over, empty. The webview asks `prepare_lab_db`
//! first, which deletes the last lab database (`src/lib/db.ts`). Card data
//! comes from the card store, which every mode shares (`card_store.rs`), so
//! loading a library into the lab fetches nothing the store already has. See
//! `docs/lab.md` → *Lab mode*.
//!
//! `DECKLAB_LAB_SEED=<file>` names a library file to load into the new lab at
//! launch; the webview asks `lab_seed` for it before showing anything.
//!
//! Both happen once per launch, not once per page load: reloading the window
//! keeps the lab as it is.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::Migration;

use crate::card_store::{database_dir, remove_database};

static PREPARED: AtomicBool = AtomicBool::new(false);
static SEED_TAKEN: AtomicBool = AtomicBool::new(false);

pub fn enabled() -> bool {
    std::env::var_os("DECKLAB_LAB").is_some_and(|v| !v.is_empty() && v != "0")
}

/// Experimental migrations, applied to `lab.db` only, after the real ones.
///
/// Number them from 1000 so they never collide with the real list. One that
/// graduates is rewritten as the next real migration; one that loses is
/// deleted, and the next launch's fresh database has never heard of it.
pub fn migrations() -> Vec<Migration> {
    vec![]
}

/// Mark the window, so a lab session is never mistaken for the real one.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_title("DeckLab — LAB")?;
    }
    Ok(())
}

/// Whether this is lab mode; if so, and this launch has not yet, delete the
/// last lab database.
#[tauri::command]
pub fn prepare_lab_db(app: AppHandle) -> Result<bool, String> {
    if !enabled() {
        return Ok(false);
    }
    if !PREPARED.swap(true, Ordering::SeqCst) {
        remove_database(&database_dir(&app)?.join("lab.db"))?;
    }
    Ok(true)
}

#[derive(Serialize)]
pub struct Seed {
    path: String,
    text: String,
}

/// The library file to load into the lab, the first time this launch asks.
///
/// A relative path is taken from where the command was typed: npm records
/// that as `INIT_CWD`, while `tauri dev` runs the app from `src-tauri/`.
#[tauri::command]
pub fn lab_seed() -> Result<Option<Seed>, String> {
    if !enabled() || SEED_TAKEN.swap(true, Ordering::SeqCst) {
        return Ok(None);
    }
    let Some(raw) = std::env::var_os("DECKLAB_LAB_SEED").filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let mut path = PathBuf::from(raw);
    if path.is_relative() {
        if let Some(cwd) = std::env::var_os("INIT_CWD") {
            path = PathBuf::from(cwd).join(path);
        }
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;
    Ok(Some(Seed {
        path: path.to_string_lossy().into_owned(),
        text,
    }))
}
