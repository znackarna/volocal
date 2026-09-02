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

/// The reader says which second language the recording holds — or, with an
/// empty `language`, that they no longer say so.
///
/// It is written on the recording, where it stands like the language choice
/// beside it: every later transcription writes that language in without
/// asking. And when the recording already has a transcript, the fill starts
/// now, through the same queue as everything else that runs whisper. That is
/// the by-hand way in for a transcript that detection did not catch, or that
/// was made with detection off.
#[tauri::command]
pub async fn set_second_language_choice(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    language: String,
) -> Reported<()> {
    let has_transcript = {
        let running = app.bezici.is_running(&id);
        let db = app.db.lock().unwrap();
        let recording = reported(db::recording(&db, &id))?;
        if crate::commands::folders::recording_is_busy(running, &recording.status) {
            return Err(UserMessage::new("transcription.still_running"));
        }
        reported(db::set_second_language_choice(&db, &id, &language))?;
        let chosen = language.trim();
        if chosen.is_empty() {
            return Ok(());
        }
        // The row the fill reads, so the screen shows it as pending from now.
        reported(db::save_second_language(
            &db,
            &db::SecondLanguage {
                recording_id: id.clone(),
                language: chosen.to_ascii_lowercase(),
                share: 0.0,
                state: db::second_language_state::OFFERED.to_string(),
                filled_at: None,
            },
        ))?;
        let starts = recording.status == db::status::DONE && recording.segment_count > 0;
        if starts {
            // The archive draws a progress bar only on a recording that is
            // transcribing, and this is a run in every sense the reader can
            // see. Speaker recognition does the same for its length.
            reported(db::set_status(&db, &id, db::status::TRANSCRIBING, None))?;
        }
        starts
    };
    if has_transcript {
        run_fill(window, app.db_path.clone(), app.bezici.clone(), id);
    }
    Ok(())
}

/// One fill, on its own thread, through the queue, announced like a run.
///
/// Shared by the two ways a fill can start — the offer's button and naming a
/// language on a finished transcript — so the two cannot drift apart in how
/// they queue, cancel or report.
fn run_fill(
    window: tauri::AppHandle,
    db_path: std::path::PathBuf,
    task: transcription::TranscriptionTask,
    id: String,
) {
    task.enqueue(&id);
    task.begin(&id);
    std::thread::spawn(move || {
        let ours = task.wait_for_turn(&id);
        let done = if ours {
            transcription::fill_second_language_in(&window, &db_path, &id, &task)
        } else {
            Err(UserMessage::new("transcription.cancelled"))
        };
        let cancelled = task.was_cancelled(&id);
        task.leave_queue(&id);
        task.cleanup(&id);
        back_to_done(&db_path, &id);
        match (&done, cancelled) {
            (_, true) => {
                let _ = window.emit(
                    "transcription:status",
                    transcription::TranscriptionProgress {
                        recording_id: id.clone(),
                        phase: "cancelled".into(),
                        percent: 0,
                        description: UserMessage::new("transcription.cancelled"),
                    },
                );
            }
            (Err(error), false) => {
                let _ = window.emit(
                    "transcription:status",
                    transcription::TranscriptionProgress {
                        recording_id: id.clone(),
                        phase: "error".into(),
                        percent: 0,
                        description: error.clone(),
                    },
                );
                let _ = window.emit("transcription:error", (id.clone(), error.clone()));
            }
            (Ok(added), false) => announce_done(&window, &id, *added),
        }
        let _ = window.emit("transcription:complete", id.clone());
    });
}

/// The transcript is there whatever the fill did, so the recording is `done`
/// again whichever way it ended. The fill never touched the text on failure
/// or cancellation — it writes in one transaction at the end — so `done` is
/// simply the truth about the row.
fn back_to_done(db_path: &std::path::Path, id: &str) {
    match db::open(db_path).and_then(|db| db::set_status(&db, id, db::status::DONE, None)) {
        Ok(()) => {}
        Err(error) => {
            crate::note!("second language: the recording could not be marked done: {error}")
        }
    }
}

/// The terminal report a finished fill owes the screens.
///
/// **Without it the run never ends on screen.** The last thing the fill says
/// is `second_language` at 100 %, and the screens read any phase that is not
/// `complete`, `error` or `cancelled` as *still going*: the bubble stays up at
/// a hundred, the transcript screen hides the player because something is
/// running, and nothing can be closed. `transcription:complete` on its own
/// does not clear it — that event reloads, it does not end a phase. A run
/// says `complete` before it; so does this.
fn announce_done(window: &tauri::AppHandle, id: &str, added: usize) {
    let _ = window.emit(
        "transcription:status",
        transcription::TranscriptionProgress {
            recording_id: id.to_string(),
            phase: "complete".into(),
            percent: 100,
            description: UserMessage::new("second_language.done").with("count", added),
        },
    );
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
        // Drawn in the archive as the run it is; see `set_second_language_choice`.
        reported(db::set_status(&db, &id, db::status::TRANSCRIBING, None))?;
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
        back_to_done(&db_path, &id);
        match (&done, cancelled) {
            (Ok(added), false) => announce_done(&window, &id, *added),
            (Err(error), false) => {
                let _ = window.emit(
                    "transcription:status",
                    transcription::TranscriptionProgress {
                        recording_id: id.clone(),
                        phase: "error".into(),
                        percent: 0,
                        description: error.clone(),
                    },
                );
            }
            (_, true) => {
                let _ = window.emit(
                    "transcription:status",
                    transcription::TranscriptionProgress {
                        recording_id: id.clone(),
                        phase: "cancelled".into(),
                        percent: 0,
                        description: UserMessage::new("transcription.cancelled"),
                    },
                );
            }
        }
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
