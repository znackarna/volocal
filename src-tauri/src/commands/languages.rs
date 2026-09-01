//! The second language a recording holds, and what the reader decides about it.
//!
//! Two commands and nothing more. Finding the language is not here — that
//! happens at the end of a transcription, where the prepared audio still
//! exists; see `transcription/languages.rs`. What is left for the window is
//! reading the answer and refusing it.

use crate::user_message::UserMessage;
use crate::{db, transcription};
use crate::{reported, AppState, Reported};
use tauri::{Emitter, State};

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

/// Asks the question again about a transcript that is already in the archive.
///
/// **Why this is a command and not something done on sight.** The sweep inside
/// a transcription is free — the prepared audio is already there. This one has
/// to make it again, which costs as long as decoding the recording, so it is
/// asked for rather than run over everybody's archive uninvited.
///
/// It is also the only way an older archive is ever told. Every recording
/// transcribed before the sweep existed would otherwise go on looking complete,
/// and somebody with a back catalogue of interpreted recordings is exactly who
/// this feature is for.
///
/// Answers with what it found, so the screen that asked does not have to go
/// looking. `None` means one language, which is the ordinary answer.
#[tauri::command]
pub async fn sweep_second_language(
    app: State<'_, AppState>,
    id: String,
) -> Reported<Option<db::SecondLanguage>> {
    // Two workers on one recording is the defect this guard exists for; the
    // database row is not a reliable answer on its own, because a run reaches
    // it a moment later.
    {
        let running = app.bezici.is_running(&id);
        let db = app.db.lock().unwrap();
        let recording = reported(db::recording(&db, &id))?;
        if crate::commands::folders::recording_is_busy(running, &recording.status) {
            return Err(UserMessage::new("transcription.still_running"));
        }
    }

    let db_path = app.db_path.clone();
    let task = app.bezici.clone();
    tauri::async_runtime::spawn_blocking(move || {
        /* The same queue a transcription stands in. Not because twenty seconds
        is heavy, but because it runs whisper, and two of those on one
        graphics card take memory from each other and both finish later
        than either would alone. */
        task.enqueue(&id);
        task.begin(&id);
        let ours = task.wait_for_turn(&id);
        let outcome = if ours {
            transcription::sweep_existing_recording(&db_path, &id, &task)
        } else {
            Err(UserMessage::new("transcription.cancelled"))
        };
        task.leave_queue(&id);
        task.cleanup(&id);
        outcome
    })
    .await
    .map_err(|error| UserMessage::new("second_language.sweep_interrupted").detail(error))?
}

/// Transcribes the language the transcript is missing and merges it in.
///
/// The long one of the three: it decodes the recording, runs whisper over the
/// stretches the first pass left empty, and rewrites the transcript in one
/// transaction. Progress goes out on `transcription:status` under a phase of
/// its own, and it can be cancelled like any other run.
///
/// Answers with how many blocks it added, which is what the screen says
/// afterwards.
#[tauri::command]
pub async fn fill_second_language(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
) -> Reported<usize> {
    {
        let running = app.bezici.is_running(&id);
        let db = app.db.lock().unwrap();
        let recording = reported(db::recording(&db, &id))?;
        if crate::commands::folders::recording_is_busy(running, &recording.status) {
            return Err(UserMessage::new("transcription.still_running"));
        }
    }

    let db_path = app.db_path.clone();
    let task = app.bezici.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        task.enqueue(&id);
        task.begin(&id);
        let ours = task.wait_for_turn(&id);
        let done = if ours {
            transcription::fill_second_language_in(&window, &db_path, &id, &task)
        } else {
            Err(UserMessage::new("transcription.cancelled"))
        };
        let cancelled = task.was_cancelled(&id);
        task.leave_queue(&id);
        task.cleanup(&id);
        let _ = window.emit("transcription:complete", id.clone());
        if cancelled {
            return Err(UserMessage::new("transcription.cancelled"));
        }
        done
    })
    .await
    .map_err(|error| UserMessage::new("second_language.sweep_interrupted").detail(error))?;
    outcome
}
