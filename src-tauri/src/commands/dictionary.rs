//! The dictionary of corrections, and full-text search across transcripts.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::db;
use crate::db::{DictionaryEntry, SearchResult};
use crate::{reported, AppState, Reported};
use tauri::State;
// ------------------------------------------------------------- dictionary

#[tauri::command]
pub fn dictionary(app: State<'_, AppState>) -> Reported<Vec<DictionaryEntry>> {
    let db = app.db.lock().unwrap();
    reported(db::dictionary(&db))
}

#[tauri::command]
pub fn add_dictionary_entry(
    app: State<'_, AppState>,
    find: String,
    replace: String,
) -> Reported<DictionaryEntry> {
    let db = app.db.lock().unwrap();
    let p = DictionaryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        find,
        replace,
    };
    reported(db::add_dictionary_entry(&db, &p))?;
    Ok(p)
}

#[tauri::command]
pub fn update_dictionary_entry(
    app: State<'_, AppState>,
    id: String,
    find: String,
    replace: String,
) -> Reported<DictionaryEntry> {
    let db = app.db.lock().unwrap();
    let entry = DictionaryEntry { id, find, replace };
    reported(db::update_dictionary_entry(&db, &entry))?;
    Ok(entry)
}

#[tauri::command]
pub fn delete_dictionary_entry(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_dictionary_entry(&db, &id))
}

// ----------------------------------------------------------------- search

#[tauri::command]
pub fn search(app: State<'_, AppState>, query: String) -> Reported<Vec<SearchResult>> {
    let db = app.db.lock().unwrap();
    reported(db::search(&db, &query))
}
