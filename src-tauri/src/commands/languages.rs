//! The second language a recording holds, and what the reader decides about it.
//!
//! Two commands and nothing more. Finding the language is not here — that
//! happens at the end of a transcription, where the prepared audio still
//! exists; see `transcription/languages.rs`. What is left for the window is
//! reading the answer and refusing it.

use crate::db;
use crate::{reported, AppState, Reported};
use tauri::State;

/// What the sweep found for one recording, or nothing.
///
/// Nothing is the ordinary answer: it is every recording spoken in one
/// language, and every transcript written before the sweep existed.
#[tauri::command]
pub fn second_language(
    app: State<'_, AppState>,
    id: String,
) -> Reported<Option<db::SecondLanguage>> {
    let db = app.db.lock().unwrap();
    reported(db::second_language(&db, &id))
}

/// The reader said no.
///
/// It is remembered rather than forgotten, so the offer does not come back on
/// the next visit to the transcript — and it keeps what was found, so a later
/// change of mind has something to act on. Transcribing the recording again
/// writes a fresh offer over it: a new text is a new question.
#[tauri::command]
pub fn refuse_second_language(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::set_second_language_state(
        &db,
        &id,
        db::second_language_state::REFUSED,
    ))
}
