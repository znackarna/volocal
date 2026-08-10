//! Writing a transcript or its audio to a file the user chooses.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::user_message::UserMessage;
use crate::{db, export};
use crate::{reported, AppState, Reported};
use tauri::State;
// ---------------------------------------------------------------- export

#[tauri::command]
pub fn export_preview(app: State<'_, AppState>, id: String, format: String) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let segments = reported(db::segments(&db, &id))?;
    let speakers = reported(db::speakers(&db, &id))?;
    Ok(export::create(&format, &recording, &segments, &speakers))
}

#[tauri::command]
pub fn save_export(
    app: State<'_, AppState>,
    id: String,
    format: String,
    path: String,
) -> Reported<String> {
    let contents = export_preview(app, id, format)?;
    std::fs::write(&path, contents)
        .map_err(|error| UserMessage::new("file.write_failed").detail(error))?;
    Ok(path)
}

#[tauri::command]
pub fn suggested_name(app: State<'_, AppState>, id: String, format: String) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let n = reported(db::recording(&db, &id))?;
    let cisty: String = n
        .title
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
        .collect();
    Ok(format!("{}.{}", cisty, export::extension(&format)))
}
