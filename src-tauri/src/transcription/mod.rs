//! Transcription pipeline: ffmpeg -> whisper.cpp with VAD -> sherpa-onnx
//! diarization -> database.
//!
//! Work runs on a dedicated thread and emits incremental events so the UI can
//! display live text instead of only a percentage.

use anyhow::{anyhow, Result};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{AppHandle, Emitter};

use crate::db::{self, Segment, Settings};
use crate::tools::{self, command};
use crate::user_message::UserMessage;

/// Result of anything that can end up in front of the user.
type Reported<T> = std::result::Result<T, UserMessage>;

// ------------------------------------------------------------------ events

#[derive(Serialize, Clone)]
pub struct TranscriptionProgress {
    pub recording_id: String,
    /// preparation | playback | transcription | diarization | saving | complete | error
    pub phase: String,
    pub percent: u32,
    /// What is happening right now, or what went wrong. The window turns the
    /// code into a sentence in the language it is running in.
    pub description: UserMessage,
}

#[derive(Serialize, Clone)]
pub struct LiveSegment {
    pub recording_id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

fn status(app: &AppHandle, id: &str, phase: &str, percent: u32, description: UserMessage) {
    let _ = app.emit(
        "transcription:status",
        TranscriptionProgress {
            recording_id: id.to_string(),
            phase: phase.to_string(),
            percent,
            description,
        },
    );
}

/// The phase caption for a code that needs no values of its own.
fn step(code: &str) -> UserMessage {
    UserMessage::new(code)
}

// Percentages reported by whisper-cli describe only the transcription phase.
// Map them into the shared end-to-end progress bar so changing phases can
// never make the bar jump backwards.
const TRANSCRIPTION_START_PERCENT: u32 = 10;
const TRANSCRIPTION_END_PERCENT: u32 = 90;

fn overall_transcription_percent(whisper_percent: u32) -> u32 {
    TRANSCRIPTION_START_PERCENT
        + whisper_percent.min(100) * (TRANSCRIPTION_END_PERCENT - TRANSCRIPTION_START_PERCENT) / 100
}

mod jobs;
mod languages;
mod speakers;

/// The sweep for a second language over a transcript that is already stored.
/// Re-exported here because `commands` reaches the pipeline through this
/// module and never through its parts.
pub use languages::sweep_existing as sweep_existing_recording;

/// Transcribing the second language and merging it into the transcript.
pub use languages::fill as fill_second_language_in;
mod text;
mod whisper;

pub(crate) use jobs::*;
pub(crate) use speakers::*;
pub(crate) use text::*;
pub(crate) use whisper::*;

// ---------------------------------------------------------------- entry point

/// Runs a job and turns a panic into a failure the interface can show.
///
/// A worker thread that panics prints to a console nobody has open and then
/// simply stops: no progress, no error, no row written. That is indisputably
/// the worst way for this application to fail, because the person watching
/// has nothing to report but "it does not work". A panic is still a bug, but
/// now it is a visible one.
fn without_panicking<F>(work: F) -> Reported<usize>
where
    F: FnOnce() -> Reported<usize>,
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)) {
        Ok(result) => result,
        Err(panic) => {
            let text = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic".to_string());
            crate::note!("worker thread panicked: {text}");
            Err(UserMessage::new("unknown").detail(text))
        }
    }
}

pub fn start_in_thread(
    app: AppHandle,
    db_path: PathBuf,
    recording_id: String,
    task: TranscriptionTask,
    // How many people speak in this recording, when the user knows. It is asked
    // per recording rather than kept in settings, because the answer belongs to
    // the recording and not to the machine.
    speaker_count: Option<i64>,
) {
    // The place in the queue is taken here rather than inside the thread, so
    // that a batch keeps the order it was started in and `is_running` answers
    // for a waiting recording as well as for a working one.
    let waiting = task.enqueue(&recording_id);
    task.begin(&recording_id);
    if waiting {
        status(
            &app,
            &recording_id,
            "queued",
            0,
            step("transcription.queued"),
        );
    }
    std::thread::spawn(move || {
        let ours = task.wait_for_turn(&recording_id);
        let result = if ours {
            without_panicking(|| run(&app, &db_path, &recording_id, &task, speaker_count))
        } else {
            Err(UserMessage::new("transcription.cancelled"))
        };
        let connection = db::open(&db_path).ok();
        let cancelled = task.was_cancelled(&recording_id);
        task.leave_queue(&recording_id);
        task.cleanup(&recording_id);

        if cancelled {
            // Cancelling is not a failure; the recording reverts to its
            // initial state.
            if let Some(s) = &connection {
                let _ = db::delete_segments(s, &recording_id);
                let _ = db::set_status(s, &recording_id, db::status::NEW, None);
            }
            status(
                &app,
                &recording_id,
                "cancelled",
                0,
                step("transcription.cancelled"),
            );
            let _ = app.emit("transcription:complete", recording_id.clone());
            return;
        }

        match result {
            Ok(count) => {
                // The work is already written; this only records that it is.
                // Failing quietly leaves the row on `prepisuje`, and the next
                // start reads that as an interrupted run. Retried on its own
                // connection; `recover_interrupted` catches the rest.
                let stored = connection
                    .as_ref()
                    .map(|s| db::set_status(s, &recording_id, db::status::DONE, None));
                if !matches!(stored, Some(Ok(_))) {
                    if let Ok(second) = db::open(&db_path) {
                        if let Err(error) =
                            db::set_status(&second, &recording_id, db::status::DONE, None)
                        {
                            crate::note!("finished but not marked as such: {error}");
                        }
                    }
                }
                status(
                    &app,
                    &recording_id,
                    "complete",
                    100,
                    UserMessage::new("transcription.complete").with("count", count),
                );
                let _ = app.emit("transcription:complete", recording_id.clone());
            }
            Err(message) => {
                if let Some(s) = &connection {
                    let _ = db::set_status(
                        s,
                        &recording_id,
                        db::status::FAILED,
                        Some(&message.to_stored()),
                    );
                }
                status(&app, &recording_id, "error", 0, message.clone());
                let _ = app.emit("transcription:error", (recording_id.clone(), message));
            }
        }
    });
}

/// Runs diarization over an already finished transcript. No need to
/// transcribe again — Whisper has done its part; this only fills in who
/// said what.
pub fn start_diarization_in_thread(
    app: AppHandle,
    db_path: PathBuf,
    recording_id: String,
    task: TranscriptionTask,
    // Same as for a transcription: the count belongs to the recording, and
    // sherpa ignores its distance threshold entirely once it has one.
    speaker_count: Option<i64>,
) {
    // Speaker recognition is as heavy as a transcription and runs on the same
    // machine, so it stands in the same queue rather than beside it.
    let waiting = task.enqueue(&recording_id);
    task.begin(&recording_id);
    if waiting {
        status(
            &app,
            &recording_id,
            "queued",
            0,
            step("transcription.queued"),
        );
    }
    std::thread::spawn(move || {
        let ours = task.wait_for_turn(&recording_id);
        let result = if ours {
            without_panicking(|| {
                run_diarization(&app, &db_path, &recording_id, &task, speaker_count)
            })
        } else {
            Err(UserMessage::new("transcription.cancelled"))
        };
        let connection = db::open(&db_path).ok();
        let cancelled = task.was_cancelled(&recording_id);
        task.leave_queue(&recording_id);
        task.cleanup(&recording_id);

        if cancelled {
            // The transcript itself was never in danger — recognising speakers
            // only rewrites who said what, and it writes at the very end. So a
            // cancelled run leaves the recording exactly as it found it.
            if let Some(s) = &connection {
                let _ = db::set_status(s, &recording_id, db::status::DONE, None);
            }
            status(
                &app,
                &recording_id,
                "cancelled",
                0,
                step("transcription.cancelled"),
            );
            let _ = app.emit("transcription:complete", recording_id.clone());
            return;
        }

        match result {
            Ok(count) => {
                // The work is already written; this only records that it is.
                // Failing quietly leaves the row on `prepisuje`, and the next
                // start reads that as an interrupted run. Retried on its own
                // connection; `recover_interrupted` catches the rest.
                let stored = connection
                    .as_ref()
                    .map(|s| db::set_status(s, &recording_id, db::status::DONE, None));
                if !matches!(stored, Some(Ok(_))) {
                    if let Ok(second) = db::open(&db_path) {
                        if let Err(error) =
                            db::set_status(&second, &recording_id, db::status::DONE, None)
                        {
                            crate::note!("finished but not marked as such: {error}");
                        }
                    }
                }
                status(
                    &app,
                    &recording_id,
                    "complete",
                    100,
                    UserMessage::new("diarization.complete").with("count", count),
                );
                let _ = app.emit("transcription:complete", recording_id.clone());
            }
            Err(message) => {
                if let Some(s) = &connection {
                    let _ = db::set_status(s, &recording_id, db::status::DONE, None);
                }
                status(&app, &recording_id, "error", 0, message.clone());
                let _ = app.emit("transcription:error", (recording_id.clone(), message));
            }
        }
    });
}

fn run_diarization(
    app: &AppHandle,
    db_path: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
    speaker_count: Option<i64>,
) -> Reported<usize> {
    let connection = db::open(db_path)?;
    let mut settings = db::load_settings(&connection)?;
    if let Some(count) = speaker_count {
        settings.speaker_count = count.max(0);
    }
    let recording = db::recording(&connection, recording_id)?;

    let check = tools::check(&settings);
    if let Some(issue) = check.issues_diarization.first() {
        return Err(issue.clone());
    }
    let ffmpeg = check
        .ffmpeg
        .clone()
        .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;

    db::set_status(&connection, recording_id, db::status::TRANSCRIBING, None)?;
    status(
        app,
        recording_id,
        "diarization",
        5,
        step("diarization.preparing_audio"),
    );

    let working_directory = std::env::temp_dir()
        .join("whisp-speakers")
        .join(recording_id);
    std::fs::create_dir_all(&working_directory)?;
    let wav = working_directory.join("zvuk.wav");
    tools::convert_to_wav(
        Path::new(&ffmpeg),
        Path::new(&recording.path),
        &wav,
        &JobRunner { task, recording_id },
    )?;

    // The blocks are read before the work rather than after it: they are what
    // says where speech is, so they are the input now, not just the thing the
    // answer is written onto.
    let segments = db::segments(&connection, recording_id)?;
    if segments.is_empty() {
        return Err(UserMessage::new("diarization.not_transcribed"));
    }

    status(
        app,
        recording_id,
        "diarization",
        10,
        step("diarization.running"),
    );
    let turns = diarize(
        &settings,
        &check,
        &wav,
        &segments,
        task,
        recording_id,
        Some((app, recording_id, 10.0, 90.0)),
    )?;
    stop_if_cancelled(task, recording_id)?;

    let mut segments = assign_speakers(segments, &turns);
    /* The language rule runs first now. It moves blocks between voices, and
    until it has, the neighbours of an unidentified block may not agree — so
    bridging first left blocks unclaimed that bridging afterwards can close. */
    keep_voices_to_one_language(&mut segments);
    bridge_unknown(&mut segments);

    status(app, recording_id, "saving", 90, step("saving"));

    let mut key: Vec<String> = segments.iter().filter_map(|s| s.speakers.clone()).collect();
    key.sort_by_key(|k| order_key(k));
    key.dedup();

    // Segments are rewritten whole, not just the speaker column: diarization
    // may have cut a sentence where the speech changes hands, so there can be
    // more of them now. Text, edits and signed-off spots travel along.
    //
    // All of it in one transaction. Diarization is a bonus — it would be cruel
    // for a finished transcript to vanish because a write failed midway.
    connection.execute_batch("BEGIN")?;
    let save_result = (|| -> Reported<()> {
        db::delete_speakers(&connection, recording_id)?;
        for (i, k) in key.iter().enumerate() {
            db::insert_speaker(
                &connection,
                &db::Speaker {
                    key: k.clone(),
                    recording_id: recording_id.to_string(),
                    name: format!("Mluvčí {}", i + 1),
                    color: db::COLORS[i % db::COLORS.len()].to_string(),
                },
            )?;
        }
        db::delete_segments(&connection, recording_id)?;
        for s in &segments {
            db::insert_segment(&connection, s)?;
        }
        Ok(())
    })();
    if let Err(e) = save_result {
        let _ = connection.execute_batch("ROLLBACK");
        return Err(e);
    }
    connection.execute_batch("COMMIT")?;

    let _ = std::fs::remove_dir_all(&working_directory);
    Ok(key.len())
}

/// What a recording says it was made with.
///
/// **The answer, never the wish.** `settings.model` is what was asked for;
/// `check.model_whisper_id` is the file that will actually be handed to
/// `whisper-cli`, and the two part company whenever the wish names a model that
/// is not on the disk — `resolve_transcription_model` then falls back to
/// whatever is, deliberately, because a transcription has to run.
///
/// The owner met the difference on 31 August. An uninstall keeps the archive,
/// so a settings record naming `large-v3` outlived the installation that wrote
/// it; the reinstalled copy held only the fast model, transcribed with it
/// correctly, and the card over the result said `Přesný`.
///
/// The wish is left alone in the settings — this only corrects the recording's
/// own note of what produced it. The fallback is unreachable in practice, a
/// missing model being an issue that stops the run before this line; it is here
/// because nothing in the type says so.
fn model_to_record(check: &tools::ToolCheck, settings: &crate::db::Settings) -> String {
    check
        .model_whisper_id
        .clone()
        .unwrap_or_else(|| settings.model.clone())
}

fn run(
    app: &AppHandle,
    db_path: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
    speaker_count: Option<i64>,
) -> Reported<usize> {
    // A connection of this thread's own, so the main thread does not wait
    // minutes on the lock.
    let connection = db::open(db_path)?;
    let mut settings = db::load_settings(&connection)?;
    // An answer given for this recording wins over the stored default without
    // changing it: the next recording asks again.
    if let Some(count) = speaker_count {
        settings.speaker_count = count.max(0);
    }
    let recording = db::recording(&connection, recording_id)?;
    let dictionary = db::dictionary(&connection)?;

    db::set_status(&connection, recording_id, db::status::TRANSCRIBING, None)?;

    let check = tools::check(&settings);
    if let Some(issue) = check.issues.first() {
        return Err(issue.clone());
    }
    /* **What ran, not what was asked for.** `settings.model` is a wish;
    `resolve_transcription_model` answers it with a file that exists, falling
    back to whatever is on the disk when the wish is not there — deliberately,
    because a transcription has to run. Recording the wish meant the card
    could say `Přesný` over a transcript the fast model wrote, and the owner
    met exactly that on 31 August: a settings record surviving an uninstall
    named a model his reinstalled copy no longer had.

    The wish stays untouched in the settings; only the recording's own note
    of what produced it is corrected. `model_whisper_id` is always `Some`
    here, because a missing model is an issue and the line above returns on
    it — but nothing in the type says so, so the wish is the fallback rather
    than a panic. */
    db::set_model(
        &connection,
        recording_id,
        &model_to_record(&check, &settings),
    )?;
    stop_if_cancelled(task, recording_id)?;

    // --------------------------------------------------------- preparation
    status(
        app,
        recording_id,
        "preparation",
        0,
        step("preparation.converting_audio"),
    );

    let working_directory = std::env::temp_dir().join("whisp").join(recording_id);
    std::fs::create_dir_all(&working_directory)?;
    let wav = working_directory.join("zvuk.wav");

    let runner = JobRunner { task, recording_id };
    tools::convert_to_wav(
        Path::new(check.ffmpeg.as_ref().unwrap()),
        Path::new(&recording.path),
        &wav,
        &runner,
    )?;
    stop_if_cancelled(task, recording_id)?;

    // Long VBR MP3 files need an indexed M4A playback copy for precise
    // word-level seeking. Build it while the recording is already being
    // prepared, not when the user later presses Play in a finished transcript.
    // Playback preparation is deliberately best-effort: losing the cache must
    // never throw away a transcription that can otherwise proceed normally.
    if Path::new(&recording.path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"))
    {
        status(app, recording_id, "playback", 5, step("playback.preparing"));
        if let Err(error) = tools::ensure_seekable_playback(
            Path::new(check.ffmpeg.as_ref().unwrap()),
            db_path,
            recording_id,
            Path::new(&recording.path),
            &runner,
        ) {
            crate::note!("playback preparation failed for {recording_id}: {error:#}");
        }
    }
    // This is the longest of the preparation steps on a long MP3, and its own
    // caption names it, so it is the one somebody cancels during. Losing the
    // playback cache is deliberately not an error; being cancelled is.
    stop_if_cancelled(task, recording_id)?;

    // Generate both the timeline waveform and frequency peaks while the
    // normalized WAV file is already available.
    let visualization_missing = db::waveform(&connection, recording_id)
        .map(|data| data.points.is_empty() || data.equalizer.is_empty())
        .unwrap_or(true);
    if visualization_missing {
        if let Ok(data) = waveform_from_wav(&check, &wav, recording.duration) {
            let _ = db::save_waveform(&connection, recording_id, &data);
        }
    }

    // ------------------------------------------------------------ transcript
    // Whisper is the expensive one. Starting it after a cancellation that
    // arrived during preparation is how `Zrušit` used to look like it did
    // nothing at all: the request was noted and the run went on for minutes.
    stop_if_cancelled(task, recording_id)?;

    /* **A recording in two languages is transcribed in two from the start.**
    The second language on its row — named by the reader, or written there by
    the fill that once found it — means the single-language pass would only
    be thrown away and replaced. So it is skipped: the multilingual pass does
    the whole transcript, speakers and all, and writes it itself. Its failure
    is the run's here, because there is no other transcript to fall back on.

    Asked for on 2026-09-02, the morning the pass was rebuilt: a transcript
    that was once bilingual has to come back bilingual without being asked,
    and without the two minutes of a pass nobody will read. */
    let named = recording.second_language_choice.trim().to_ascii_lowercase();
    if !named.is_empty() {
        db::save_second_language(
            &connection,
            &db::SecondLanguage {
                recording_id: recording_id.to_string(),
                language: named.clone(),
                share: 0.0,
                state: db::second_language_state::OFFERED.to_string(),
                filled_at: None,
            },
        )?;
        let written = languages::fill_with_audio(
            app,
            &connection,
            &check,
            &settings,
            &recording,
            &named,
            &wav,
            &working_directory,
            task,
            None,
        )?;
        let _ = std::fs::remove_dir_all(&working_directory);
        return Ok(written.blocks);
    }

    /* **The question is asked before the transcript, not after it.** Until
    today a recording with detection switched on was transcribed whole in one
    language, then swept, then transcribed again in two — and the first
    transcript, minutes of work, was thrown away unread. The voices answer it
    for the price of a few questions to whisper, so the recording goes down one
    road or the other and never both.

    A failure to ask is not a failure to transcribe: the ordinary pass below
    still runs, and the recording is then simply a recording in one language. */
    if settings.detect_second_language {
        status(
            app,
            recording_id,
            "second_language",
            2,
            step("second_language.listening"),
        );
        let asking = Run {
            app,
            recording_id,
            task,
        };
        let found = languages::two_languages_heard(
            &asking,
            &settings,
            &check,
            &wav,
            &working_directory,
            &|percent, code| status(app, recording_id, "second_language", percent, step(code)),
        );
        stop_if_cancelled(task, recording_id)?;
        match found {
            Ok((Some((own, second)), already)) => {
                // Both go on the recording: the second language so that the
                // next transcription of it is bilingual from its first second,
                // and its own so the archive card says what it is in.
                db::set_language(&connection, recording_id, &own)?;
                db::set_second_language_choice(&connection, recording_id, &second)?;
                db::save_second_language(
                    &connection,
                    &db::SecondLanguage {
                        recording_id: recording_id.to_string(),
                        language: second.clone(),
                        share: 0.0,
                        state: db::second_language_state::OFFERED.to_string(),
                        filled_at: None,
                    },
                )?;
                let fresh = db::recording(&connection, recording_id)?;
                let written = languages::fill_with_audio(
                    app,
                    &connection,
                    &check,
                    &settings,
                    &fresh,
                    &second,
                    &wav,
                    &working_directory,
                    task,
                    already,
                )?;
                let _ = std::fs::remove_dir_all(&working_directory);
                return Ok(written.blocks);
            }
            Ok((None, _)) => {
                if let Err(error) = db::clear_second_language(&connection, recording_id) {
                    crate::note!("second language: the old offer could not be cleared: {error}");
                }
            }
            Err(error) => {
                crate::note!("second language: could not be asked about beforehand: {error}");
            }
        }
    }

    status(
        app,
        recording_id,
        "transcription",
        TRANSCRIPTION_START_PERCENT,
        step("transcription.running"),
    );

    let prefix = working_directory.join("vystup");

    // A per-recording choice beats the global setting.
    let language = if recording.language_choice.is_empty() {
        settings.language.clone()
    } else {
        recording.language_choice.clone()
    };

    let run = Run {
        app,
        recording_id,
        task,
    };
    start_whisper(
        &run,
        &settings,
        &Ask {
            language: &language,
            max_context: CONTEXT_FOR_A_RUN,
        },
        &check,
        &wav,
        &prefix,
    )?;

    let json_file = prefix.with_extension("json");
    // With automatic detection the real language is only known from the output.
    let detected = language_from_json(&json_file);
    if let Some(j) = &detected {
        db::set_language(&connection, recording_id, j)?;
    }
    let mut segments = load_segments_from_json(&json_file, recording_id).map_err(|error| {
        // Report what whisper actually left behind; otherwise this is guesswork
        let remaining_files: Vec<String> = std::fs::read_dir(&working_directory)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        let message = if remaining_files.is_empty() {
            UserMessage::new("transcription.no_output_file_empty")
        } else {
            UserMessage::new("transcription.no_output_file")
                .with("contents", remaining_files.join(", "))
        };
        message.detail(format!("{error:#}"))
    })?;

    if segments.is_empty() {
        return Err(UserMessage::new("transcription.empty_result"));
    }

    // ------------------------------------------------------- sentences
    segments = rebuild_sentences(segments);

    // ---------------------------------------- the start against the audio
    // After the blocks are final, because it is the first word of a block
    // that lights up. The 16 kHz copy whisper was given is still on disk.
    snap_starts_to_sound(&mut segments, &wav);

    // --------------------------------------------------------- dictionary
    apply_dictionary(&mut segments, &dictionary);

    // ---------------------------------------------------------- diarisation
    if settings.diarization {
        if let Some(issue) = check.issues_diarization.first() {
            status(
                app,
                recording_id,
                "diarization",
                TRANSCRIPTION_END_PERCENT,
                issue.clone(),
            );
        } else {
            status(
                app,
                recording_id,
                "diarization",
                TRANSCRIPTION_END_PERCENT,
                step("diarization.running"),
            );
            match diarize(
                &settings,
                &check,
                &wav,
                &segments,
                task,
                recording_id,
                // Diarization owns 90..95; saving takes it from there.
                Some((app, recording_id, TRANSCRIPTION_END_PERCENT as f64, 95.0)),
            ) {
                Ok(turns) => {
                    segments = assign_speakers(segments, &turns);
                    keep_voices_to_one_language(&mut segments);
                    bridge_unknown(&mut segments);
                }
                Err(error) => {
                    // Diarization is a bonus. If it fails, the transcript is
                    // not thrown away over it.
                    // The reason itself is the caption: it is one finished
                    // sentence, and the phase already says what was running.
                    status(
                        app,
                        recording_id,
                        "diarization",
                        TRANSCRIPTION_END_PERCENT,
                        error,
                    );
                }
            }
        }
    }

    // ------------------------------------------------------------- saving
    stop_if_cancelled(task, recording_id)?;
    status(app, recording_id, "saving", 95, step("saving"));

    let mut key: Vec<String> = segments.iter().filter_map(|s| s.speakers.clone()).collect();
    key.sort_by_key(|k| order_key(k));
    key.dedup();
    // One transaction: either the whole transcript is stored or none of it.
    // A write failing midway must not leave half a text in the archive.
    //
    // The previous transcript is deleted here rather than at the start of the
    // run. Deleting it up front meant that a missing model, a moved recording
    // or a failing ffmpeg — the ordinary failures of this pipeline, all of
    // them checked a few lines further down — destroyed a finished, corrected
    // text before anything had been verified, and nothing was kept.
    connection.execute_batch("BEGIN")?;
    let save_result = (|| -> Reported<()> {
        db::delete_segments(&connection, recording_id)?;
        for s in &segments {
            db::insert_segment(&connection, s)?;
        }
        /* **The speakers belong in here too.** They were written before the
        transaction opened and never cleaned up: a run that then failed left
        the new speaker rows behind after the segments rolled back, and a run
        that succeeded left the *previous* run's speakers standing - named
        people with nothing in the transcript they had said.

        `keep_only_speakers` takes away what this transcript has no use for and
        leaves the rest untouched, which is what keeps a name somebody typed
        across a second transcription. */
        db::keep_only_speakers(&connection, recording_id, &key)?;
        for (i, k) in key.iter().enumerate() {
            db::insert_speaker(
                &connection,
                &db::Speaker {
                    key: k.clone(),
                    recording_id: recording_id.to_string(),
                    // "Mluvčí", not "Řečník" — matching the wording used in the UI
                    name: format!("Mluvčí {}", i + 1),
                    color: db::COLORS[i % db::COLORS.len()].to_string(),
                },
            )?;
        }
        Ok(())
    })();
    if let Err(e) = save_result {
        let _ = connection.execute_batch("ROLLBACK");
        return Err(e);
    }
    connection.execute_batch("COMMIT")?;

    /* **Does this recording hold a language the transcript does not?**
    whisper is given one language for the whole file, so a recording where
    two people speak two languages comes back as one of them with the other
    silently absent — and the text still looks complete, which is worse than
    a visible failure. A recording with the language already on its row never
    reaches this point — see the multilingual branch above the
    single-language pass. What arrives here is a recording nobody has named a
    second language for, with detection switched on: a short sweep listens
    for one, and a language it finds is written in and stays on the row, so
    the next run is bilingual from the start. `languages.rs` carries the
    measurements.

    After the commit rather than inside it, and its failure is not the run's:
    a finished, saved transcript must never be held up or rolled back over a
    question about it. Before the working directory goes, because the 16 kHz
    copy whisper was given is in there and re-decoding the audio to ask would
    cost more than the asking.

    The offer is written afresh every run, so a refusal recorded against a
    transcript that has since been replaced is not carried over — a new text
    is a new question. */
    if let Err(error) = db::clear_second_language(&connection, recording_id) {
        crate::note!("second language: the old offer could not be cleared: {error}");
    }

    let _ = std::fs::remove_dir_all(&working_directory);
    Ok(segments.len())
}

// ----------------------------------------------- the start against the audio

/// A word must not light up while nothing can be heard.
///
/// Speech detection pads every region it finds by `--vad-speech-pad-ms` — 250
/// of them — so that it does not bite off a first syllable. Whisper then places
/// the block's first word at the beginning of that padded region, and a quarter
/// second of silence is attributed to a word nobody has said yet. It is not a
/// rare case: it is every block of every recording.
///
/// A loud noise before the speech makes it much worse. Measured on the user's
/// own seven-second take, which opens with a whistle: the stored time of the
/// first word was 0.52 s while the file is silent until 0.75, and the words
/// were spread across the whistle — about a second early at the start, shrinking
/// to a tenth by the end. The whistle itself this cannot repair, because it is
/// louder than the speech; the silence in front of it, it can.
///
/// Nothing new is needed for it. The 16 kHz copy made for whisper is still on
/// disk, and where sound begins is a question energy can answer.
mod onset {
    /// Envelope step. Fine enough that the correction is not itself visible,
    /// coarse enough that one loud sample cannot pass for an onset.
    pub const FRAME_SECONDS: f64 = 0.02;
    /// How far below the block's own peak still counts as silence. Chosen by
    /// measurement rather than taste: between -26 and -40 dB the answer on the
    /// reference take does not move (0.24 to 0.26 s), so the rule does not
    /// balance on this number. -32 dB sits in the middle of that plateau.
    const QUIET_RATIO: f32 = 0.025_118_864; // 10^(-32/20)
    /// Below this the correction is not worth making — and a block that begins
    /// mid-speech legitimately has no silence to skip.
    pub const MIN_SHIFT: f64 = 0.05;

    /// Root-mean-square per frame. Loudness, not waveform: what is wanted is
    /// whether a stretch carries energy, not what shape it has.
    pub fn envelope(samples: &[i16], sample_rate: u32) -> Vec<f32> {
        let hop = (sample_rate as f64 * FRAME_SECONDS) as usize;
        if hop == 0 {
            return Vec::new();
        }
        samples
            .chunks(hop)
            .map(|frame| {
                let sum: f64 = frame
                    .iter()
                    .map(|s| {
                        let v = f64::from(*s) / 32768.0;
                        v * v
                    })
                    .sum();
                (sum / frame.len() as f64).sqrt() as f32
            })
            .collect()
    }

    /// First moment in `from..to` that is not silence, measured against the
    /// loudest thing in that same stretch. Relative rather than absolute,
    /// because a quiet recording and a loud one must be judged by their own
    /// speech, not by a fixed number of decibels.
    pub fn first_audible(env: &[f32], from: f64, to: f64) -> Option<f64> {
        let start = (from.max(0.0) / FRAME_SECONDS).floor() as usize;
        let end = ((to.max(0.0) / FRAME_SECONDS).ceil() as usize).min(env.len());
        if start >= end {
            return None;
        }
        let peak = env[start..end].iter().copied().fold(0.0_f32, f32::max);
        if peak <= 0.0 {
            return None;
        }
        let threshold = peak * QUIET_RATIO;
        (start..end)
            .find(|i| env[*i] >= threshold)
            .map(|i| i as f64 * FRAME_SECONDS)
    }
}

/// Reads the 16-bit PCM that ffmpeg wrote. Deliberately not a crate: this is
/// our own file, made by our own command, and the chunk walk is shorter than
/// the dependency would be.
fn read_pcm16(file: &Path) -> Option<(Vec<i16>, u32)> {
    let bytes = std::fs::read(file).ok()?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut sample_rate = 0_u32;
    let mut samples: Vec<i16> = Vec::new();
    let mut cursor = 12_usize;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32::from_le_bytes([
            bytes[cursor + 4],
            bytes[cursor + 5],
            bytes[cursor + 6],
            bytes[cursor + 7],
        ]) as usize;
        let body = cursor + 8;
        let end = body.saturating_add(size).min(bytes.len());
        if id == b"fmt " && size >= 16 && end >= body + 8 {
            sample_rate = u32::from_le_bytes([
                bytes[body + 4],
                bytes[body + 5],
                bytes[body + 6],
                bytes[body + 7],
            ]);
        } else if id == b"data" {
            // `as_chunks` rather than `chunks_exact(2)`: same pairs of bytes,
            // typed as `[u8; 2]` so nothing indexes them. Clippy on stable
            // began refusing the older spelling on 20 August 2026.
            samples = bytes[body..end]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| i16::from_le_bytes(*pair))
                .collect();
        }
        // chunks are word-aligned, so an odd size carries a pad byte
        cursor = body + size + (size & 1);
    }
    if sample_rate == 0 || samples.is_empty() {
        return None;
    }
    Some((samples, sample_rate))
}

/// Moves a block's start, and the time of its first word, forward to the moment
/// sound actually begins. Returns how many blocks were moved.
///
/// Only the leading edge. The words inside a block were aligned by whisper's
/// DTW against real audio and are not ours to second-guess; what is demonstrably
/// wrong is the silence in front of the first one.
fn snap_starts_to_sound(segments: &mut [Segment], wav: &Path) -> usize {
    let Some((samples, sample_rate)) = read_pcm16(wav) else {
        // Losing the correction is not worth failing a finished transcript over.
        crate::note!(
            "onset: {} unreadable, word times left as they are",
            wav.display()
        );
        return 0;
    };
    snap_to_sound(segments, &onset::envelope(&samples, sample_rate))
}

/// The decision itself, kept apart from reading the file so it can be tested
/// against an envelope built in memory.
fn snap_to_sound(segments: &mut [Segment], env: &[f32]) -> usize {
    let mut moved = 0;
    for segment in segments.iter_mut() {
        let Some(sound) = onset::first_audible(env, segment.start, segment.end) else {
            continue;
        };
        let words: Option<Vec<serde_json::Value>> = segment
            .words
            .as_ref()
            .and_then(|w| serde_json::from_str(w).ok());
        // Never past the word that follows: a block whose first two words share
        // one timestamp must not end up with them out of order.
        let mut limit = segment.end;
        if let Some(list) = &words {
            if let Some(next) = list.get(1).and_then(|w| w["t"].as_f64()) {
                limit = limit.min(next - onset::FRAME_SECONDS);
            }
        }
        let target = sound.min(limit);
        if target - segment.start < onset::MIN_SHIFT {
            continue;
        }
        segment.start = target;
        if let Some(mut list) = words {
            if let Some(first) = list.get_mut(0) {
                first["t"] = serde_json::json!(target);
            }
            if let Ok(text) = serde_json::to_string(&list) {
                segment.words = Some(text);
            }
        }
        moved += 1;
    }
    moved
}

/// Built from the recording that reported this: a seven-second take opening
/// with a whistle, whose first word was stored at 0.52 s while the file is
/// silent until 0.75.
#[cfg(test)]
mod onset_tests {
    use super::*;

    const RATE: u32 = 16_000;

    /// `seconds` of silence, then a loud tone until the end.
    fn silence_then_sound(silent: f64, total: f64) -> Vec<i16> {
        let count = (total * RATE as f64) as usize;
        let quiet = (silent * RATE as f64) as usize;
        (0..count)
            .map(|i| {
                if i < quiet {
                    0
                } else {
                    // a tone at a third of full scale
                    let phase = i as f64 / RATE as f64 * 440.0 * std::f64::consts::TAU;
                    (phase.sin() * 10_000.0) as i16
                }
            })
            .collect()
    }

    fn block(start: f64, end: f64, words: &[(&str, f64)]) -> Segment {
        let list: Vec<serde_json::Value> = words
            .iter()
            .map(|(s, t)| serde_json::json!({ "t": t, "s": s }))
            .collect();
        Segment {
            id: "s".into(),
            recording_id: "r".into(),
            order: 0,
            start,
            end,
            text: words.iter().map(|(s, _)| *s).collect::<Vec<_>>().join(" "),
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            original: None,
            words: Some(serde_json::to_string(&list).unwrap()),
            language: None,
        }
    }

    fn first_word_time(segment: &Segment) -> f64 {
        let list: Vec<serde_json::Value> =
            serde_json::from_str(segment.words.as_ref().unwrap()).unwrap();
        list[0]["t"].as_f64().unwrap()
    }

    /// The envelope is built in 20 ms frames, so the frame that *contains* the
    /// first sound begins up to one frame before it. One frame is the accuracy
    /// this rule can offer, and the assertions say so rather than naming a
    /// number that happens to fall out of one particular signal.
    const TOLERANCE: f64 = onset::FRAME_SECONDS;

    #[test]
    fn silence_is_skipped_and_the_onset_is_found() {
        let env = onset::envelope(&silence_then_sound(0.75, 2.0), RATE);
        let found = onset::first_audible(&env, 0.52, 2.0).expect("there is sound in this stretch");
        assert!(
            (found - 0.75).abs() <= TOLERANCE,
            "expected the onset within a frame of 0.75 s, got {found}"
        );
    }

    /// The reported case. Whisper says the word starts at 0.52; nothing is
    /// audible until 0.75, so the word must not light up before then.
    #[test]
    fn a_word_does_not_light_up_while_nothing_can_be_heard() {
        let mut segments = vec![block(
            0.52,
            5.57,
            &[("Včera", 0.52), ("jsem", 1.42), ("snědl", 2.24)],
        )];
        let env = onset::envelope(&silence_then_sound(0.75, 5.57), RATE);

        let moved = snap_to_sound(&mut segments, &env);

        assert_eq!(moved, 1);
        assert!(
            (segments[0].start - 0.75).abs() <= TOLERANCE,
            "the block should begin where the sound does, got {}",
            segments[0].start
        );
        assert!(
            (first_word_time(&segments[0]) - segments[0].start).abs() < 1e-9,
            "the first word must move with its block"
        );
        assert!(
            (first_word_time(&segments[0]) - 1.42).abs() > 0.5,
            "the words after it are whisper's own alignment and stay put"
        );
    }

    /// The ordinary case, and the one that must not be touched: a block that
    /// begins on speech has no silence to skip.
    #[test]
    fn a_block_that_begins_on_speech_is_left_alone() {
        let mut segments = vec![block(0.0, 2.0, &[("Ano", 0.0), ("jistě", 0.6)])];
        let env = onset::envelope(&silence_then_sound(0.0, 2.0), RATE);

        assert_eq!(snap_to_sound(&mut segments, &env), 0);
        assert_eq!(segments[0].start, 0.0);
        assert_eq!(first_word_time(&segments[0]), 0.0);
    }

    /// Whisper sometimes gives two adjacent words one timestamp. Moving the
    /// first past the second would put them out of order.
    #[test]
    fn the_first_word_never_moves_past_the_second() {
        let mut segments = vec![block(0.10, 3.0, &[("Tak", 0.10), ("jo", 0.30)])];
        // silent for a whole second, far beyond where the second word sits
        let env = onset::envelope(&silence_then_sound(1.0, 3.0), RATE);

        snap_to_sound(&mut segments, &env);

        assert!(
            first_word_time(&segments[0]) < 0.30,
            "got {}, which is not before the word that follows",
            first_word_time(&segments[0])
        );
    }

    /// A quiet recording must be judged by its own speech, not by a fixed
    /// number of decibels — otherwise the whole of it reads as silence.
    #[test]
    fn a_quiet_recording_is_measured_against_itself() {
        let count = (2.0 * RATE as f64) as usize;
        let quiet = (0.75 * RATE as f64) as usize;
        let samples: Vec<i16> = (0..count)
            .map(|i| {
                if i < quiet {
                    0
                } else {
                    let phase = i as f64 / RATE as f64 * 440.0 * std::f64::consts::TAU;
                    // a hundredth of the level the test above uses
                    (phase.sin() * 100.0) as i16
                }
            })
            .collect();
        let env = onset::envelope(&samples, RATE);

        let found = onset::first_audible(&env, 0.0, 2.0).expect("quiet is still sound");
        assert!(
            (found - 0.75).abs() <= TOLERANCE,
            "expected the onset within a frame of 0.75 s, got {found}"
        );
    }

    /// **The fault of 31 August, at the line that caused it.** An uninstall
    /// keeps the archive, so a settings record naming `large-v3` outlived the
    /// installation that wrote it. The reinstalled copy had only the fast model,
    /// ran on it — correctly — and the card over the transcript said `Přesný`.
    ///
    /// Pinned here rather than in `tools.rs`, where a test of the resolving
    /// alone passes with this line put back the way it was. What has to hold is
    /// the choice this file makes about what to write down.
    #[test]
    fn a_recording_records_the_model_that_ran_not_the_one_that_was_wished_for() {
        let settings = crate::db::Settings {
            model: "large-v3".into(),
            ..Default::default()
        };
        let check = tools::ToolCheck {
            model_whisper_id: Some("large-v3-turbo-q5_0".into()),
            ..Default::default()
        };

        assert_eq!(model_to_record(&check, &settings), "large-v3-turbo-q5_0");
    }

    /// With nothing resolved there is nothing better to say than what was asked
    /// for. Unreachable through `run`, which stops on a missing model before
    /// this — kept because the type allows it.
    #[test]
    fn with_no_model_resolved_the_wish_is_all_there_is() {
        let settings = crate::db::Settings {
            model: "large-v3".into(),
            ..Default::default()
        };
        let check = tools::ToolCheck::default();

        assert_eq!(model_to_record(&check, &settings), "large-v3");
    }
}
