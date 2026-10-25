//! Lab mode: the app on a throwaway database.
//!
//! `DECKLAB_LAB=1` (`npm run lab`) opens `lab.db` instead of `decklab.db`, and
//! every launch starts it over, empty. The webview asks `prepare_lab_db`
//! first, which deletes the last lab database (`src/lib/db.ts`). Card data
//! comes from the card store, which every mode shares (`card_store.rs`), so
//! loading a library into the lab fetches nothing the store already has. See
//! `docs/lab.md` → *Lab mode*.

use tauri::{AppHandle, Manager};
use tauri_plugin_sql::Migration;

use crate::card_store::{database_dir, remove_database};

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

/// Whether this is lab mode; if so, delete the last lab database first.
#[tauri::command]
pub fn prepare_lab_db(app: AppHandle) -> Result<bool, String> {
    if !enabled() {
        return Ok(false);
    }
    remove_database(&database_dir(&app)?.join("lab.db"))?;
    Ok(true)
}
