//! Reading and writing the application settings.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::db::Settings;
use crate::{db, tools};
use crate::{reported, AppState, Reported};
use tauri::State;
// ---------------------------------------------------------------- settings

#[tauri::command]
pub fn load_settings(app: State<'_, AppState>) -> Reported<Settings> {
    let db = app.db.lock().unwrap();
    let mut settings = reported(db::load_settings(&db))?;
    if !settings.editor_model.is_empty() {
        if let Some((resolved, _)) = tools::resolve_editor_model(&settings) {
            if resolved != settings.editor_model {
                settings.editor_model = resolved;
                reported(db::save_settings(&db, &settings))?;
            }
        }
    }
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: State<'_, AppState>, settings: Settings) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::save_settings(&db, &settings))
}

#[tauri::command]
pub fn check_tools(app: State<'_, AppState>) -> Reported<tools::ToolCheck> {
    let db = app.db.lock().unwrap();
    let n = reported(db::load_settings(&db))?;
    Ok(tools::check(&n))
}
