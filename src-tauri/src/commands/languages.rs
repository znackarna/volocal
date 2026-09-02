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
    // The standing choice goes with it, or the next transcription would write
    // in the very language the reader has just declined.
    reported(db::set_second_language_choice(&db, &id, "", true))?;
    reported(db::set_second_language_state(
        &db,
        &id,
        db::second_language_state::REFUSED,
    ))
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
        let chosen = language.trim();
        /* **A second language the same as the first is not a second one.** The
        fill would run, find one language, write nothing new, and the archive
        would say `Čeština, Čeština`. Refused here rather than filtered out of
        the menu alone, because the menu is not the only way in. */
        if !chosen.is_empty()
            && chosen.eq_ignore_ascii_case(&crate::ai_edit::effective_language(&recording))
        {
            return Err(UserMessage::new("second_language.same_as_first"));
        }
        /* `auto` is an instruction, not a language: *work it out on this
        recording*. It is written down like any other choice so the fill can
        read it, and the fill replaces it with what it actually found. */
        reported(db::set_second_language_choice(&db, &id, chosen, true))?;
        let has_transcript = recording.status == db::status::DONE && recording.segment_count > 0;
        if !chosen.is_empty() && !has_transcript {
            /* Named before there is a transcript — the ordinary way to say it,
            on a recording just added. The choice is written and that is all:
            the run that transcribes it reads the choice and fills the language
            in at its end. An offer row here would draw a bar offering to fill
            a transcript that does not exist, and its button would fail. */
            return Ok(());
        }
        if chosen.is_empty() {
            /* *None* answers a standing offer as well: a bar still asking to
            fill in a language the reader has just said is not there would be
            the archive disagreeing with itself. Only a standing offer, mind:
            a row saying `filled` describes a transcript that really does hold
            that language, and saying no to a future one does not take it out. */
            let standing = reported(db::second_language(&db, &id))?
                .is_some_and(|offer| offer.state == db::second_language_state::OFFERED);
            if standing {
                reported(db::set_second_language_state(
                    &db,
                    &id,
                    db::second_language_state::REFUSED,
                ))?;
            }
            return Ok(());
        }
        /* **Nothing is written about the transcript here.** Only the choice,
        which is what the reader actually made; the row that says what the
        archive holds is written by the fill, in the transaction that puts the
        blocks there. */
        let starts = has_transcript;
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
        /* **Through the net, like every other worker.** A panic in here used
        to skip everything below it: the row stayed on `transcribing`, the
        recording kept its place at the head of the queue, and every job behind
        it waited on a thread that had already died. There has been a real
        panic in this very work. */
        let done = if ours {
            transcription::without_panicking(|| {
                transcription::fill_second_language_in(&window, &db_path, &id, &task)
            })
        } else {
            Err(UserMessage::new("transcription.cancelled"))
        };
        let cancelled = task.was_cancelled(&id);
        /* `done` is written *before* the job is forgotten. `cancel_transcription`
        answers a click that lands after the work finished by setting a
        still-transcribing row to `new`; with the order the other way round
        there was a moment where the job was gone and the row still said
        transcribing, and a finished transcript would have become `new`. */
        back_to_done(&db_path, &id);
        task.leave_queue(&id);
        task.cleanup(&id);
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
        /* **Through the net, like every other worker.** A panic in here used
        to skip everything below it: the row stayed on `transcribing`, the
        recording kept its place at the head of the queue, and every job behind
        it waited on a thread that had already died. There has been a real
        panic in this very work. */
        let done = if ours {
            transcription::without_panicking(|| {
                transcription::fill_second_language_in(&window, &db_path, &id, &task)
            })
        } else {
            Err(UserMessage::new("transcription.cancelled"))
        };
        let cancelled = task.was_cancelled(&id);
        /* `done` is written *before* the job is forgotten. `cancel_transcription`
        answers a click that lands after the work finished by setting a
        still-transcribing row to `new`; with the order the other way round
        there was a moment where the job was gone and the row still said
        transcribing, and a finished transcript would have become `new`. */
        back_to_done(&db_path, &id);
        task.leave_queue(&id);
        task.cleanup(&id);
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
    .map_err(|error| UserMessage::new("second_language.interrupted").detail(error))?;
    outcome
}
