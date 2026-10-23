//! File → Export Library… and Import Library….
//!
//! The library file is written and read in TypeScript (`src/lib/library/`),
//! alongside the rest of the app's logic. Rust only puts the items in the menu
//! and tells the webview which one was chosen.

use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter};

const MENU_EXPORT: &str = "library-export";
const MENU_IMPORT: &str = "library-import";

/// Add the items to the File menu, making one where the platform has none.
///
/// On macOS the default menu already has File (Close Window); elsewhere the
/// menu holds only what `api::menu` put there.
pub fn add_to(app: &AppHandle, menu: &Menu<tauri::Wry>) -> tauri::Result<()> {
    let export = MenuItem::with_id(app, MENU_EXPORT, "Export Library…", true, None::<&str>)?;
    let import = MenuItem::with_id(app, MENU_IMPORT, "Import Library…", true, None::<&str>)?;

    let file = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(s) if s.text().ok().as_deref() == Some("File") => Some(s),
        _ => None,
    });

    match file {
        Some(file) => {
            file.prepend_items(&[&export, &import, &PredefinedMenuItem::separator(app)?])?
        }
        None => menu.prepend(&Submenu::with_items(app, "File", true, &[&export, &import])?)?,
    }
    Ok(())
}

/// Forward a library item to the webview. False when the event is not ours.
pub fn on_menu_event(app: &AppHandle, event: &MenuEvent) -> bool {
    let id = event.id().as_ref();
    if id != MENU_EXPORT && id != MENU_IMPORT {
        return false;
    }
    let _ = app.emit(id, ());
    true
}
