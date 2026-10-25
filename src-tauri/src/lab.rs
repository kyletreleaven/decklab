//! Lab mode: the app on a throwaway copy of the database.
//!
//! `DECKLAB_LAB=1` (`npm run lab`) opens `lab.db` instead of `decklab.db`, and
//! every launch starts it over. The webview asks `prepare_lab_db` first, which
//! deletes the last lab database and says where the new one goes; the webview
//! then copies the real database there with `VACUUM INTO` (`src/lib/db.ts`).
//! The real file is only ever read. See `docs/lab.md` → *Lab mode*.

use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_sql::Migration;

pub fn enabled() -> bool {
    std::env::var_os("DECKLAB_LAB").is_some_and(|v| !v.is_empty() && v != "0")
}

/// Experimental migrations, applied to `lab.db` only, after the real ones.
///
/// Number them from 1000 so they never collide with the real list. One that
/// graduates is rewritten as the next real migration; one that loses is
/// deleted, and the next launch's fresh copy has never heard of it.
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

/// Outside lab mode, `None`. In it, delete the last lab database and return
/// the path for the new one.
#[tauri::command]
pub fn prepare_lab_db(app: AppHandle) -> Result<Option<String>, String> {
    if !enabled() {
        return Ok(None);
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("lab.db");

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
    Ok(Some(path.to_string_lossy().into_owned()))
}
