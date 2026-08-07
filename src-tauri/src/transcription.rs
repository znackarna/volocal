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

// ---------------------------------------------------------------- udalosti

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

// ---------------------------------------------------------------- bezici prace

/// Work in progress: which recordings have a worker, and what each one has
/// running right now.
///
/// Cancelling used to be answered by the process registry — whether a `Child`
/// happened to be sitting in a map. Only whisper was ever put there, so
/// pressing `Zrušit` during preparation or during speaker recognition found
/// nothing, reported that nothing was running, and *cleared its own request*,
/// while the run carried on and finished. The registry now answers a different
/// question than the one cancellation asks: `running` says whether there is a
/// job, `processes` says what to kill.
#[derive(Default, Clone)]
pub struct TranscriptionTask {
    /// Children spawned for a recording, newest last. A run passes through
    /// several programs, so this is a list rather than one handle: replacing
    /// a stored `Child` used to drop the previous one without killing it.
    processes: Arc<Mutex<HashMap<String, Vec<std::process::Child>>>>,
    /// Recordings with a live worker thread, whether it is transcribing or
    /// only recognising speakers.
    running: Arc<Mutex<HashSet<String>>>,
    cancellations: Arc<Mutex<HashSet<String>>>,
    /// The heavy runs wait for each other here, in the order they arrived.
    gate: Arc<Gate>,
}

/// One whisper (or sherpa) at a time.
///
/// Two of them on one graphics card do not share it, they take memory from
/// each other and both finish later than either would alone — and a batch
/// from the watched folder used to start every file at once. The queue is
/// arrival order, so ten dropped files are transcribed in the order they were
/// dropped.
#[derive(Default)]
struct Gate {
    order: Mutex<VecDeque<String>>,
    turn: Condvar,
}

impl TranscriptionTask {
    fn begin(&self, id: &str) {
        self.running.lock().unwrap().insert(id.to_string());
    }

    /// Takes a place in the queue. True means somebody is ahead of it, which
    /// is what the interface needs in order to say so.
    fn enqueue(&self, id: &str) -> bool {
        let mut order = self.gate.order.lock().unwrap();
        order.push_back(id.to_string());
        order.len() > 1
    }

    /// Blocks until this recording stands at the front. `false` means it was
    /// taken out of the queue while it waited — cancelled — and must not run.
    fn wait_for_turn(&self, id: &str) -> bool {
        let mut order = self.gate.order.lock().unwrap();
        loop {
            match order.front() {
                Some(front) if front == id => return true,
                _ if !order.iter().any(|waiting| waiting == id) => return false,
                _ => order = self.gate.turn.wait(order).unwrap(),
            }
        }
    }

    /// Leaves the queue and wakes whoever is next. Called by the worker once
    /// its own run is over, whatever the outcome.
    fn leave_queue(&self, id: &str) {
        self.gate
            .order
            .lock()
            .unwrap()
            .retain(|waiting| waiting != id);
        self.gate.turn.notify_all();
    }

    /// Takes a *waiting* recording out of the queue. The one at the front is
    /// left alone on purpose: it is the run that is happening, and removing it
    /// would let the next one start beside it rather than after it.
    fn leave_queue_if_waiting(&self, id: &str) {
        let mut order = self.gate.order.lock().unwrap();
        if order.front().map(|front| front.as_str()) == Some(id) {
            return;
        }
        order.retain(|waiting| waiting != id);
        drop(order);
        self.gate.turn.notify_all();
    }
    /// Is a worker already busy with this recording? Asked before a second one
    /// is started: the database row is not a reliable answer on its own,
    /// because a run only reaches it a moment later.
    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains(id)
    }
    /// Kills every registered child, for when the window is closing.
    ///
    /// `std::process::Child` does not kill on `Drop`, and the worker threads
    /// are detached — so closing the window during a transcription left
    /// `whisper-cli` (or `sherpa-onnx`) running, holding the graphics card and
    /// writing into `%TEMP%\whisp\<id>`, which the next start deletes from
    /// under it. Nothing on screen said the work was still going, because
    /// there was no screen.
    ///
    /// Returns how many it had to kill, which is what the test asserts on.
    pub fn kill_all(&self) -> usize {
        let mut processes = self.processes.lock().unwrap();
        let mut killed = 0;
        for (_, children) in processes.iter_mut() {
            for child in children.iter_mut() {
                // Already gone is the ordinary case, not a failure: a run that
                // finished cleanly leaves its handle here until `cleanup`.
                if child.try_wait().ok().flatten().is_none() && child.kill().is_ok() {
                    let _ = child.wait();
                    killed += 1;
                }
            }
        }
        processes.clear();
        killed
    }
    fn record_process(&self, id: &str, child: std::process::Child) {
        self.processes
            .lock()
            .unwrap()
            .entry(id.to_string())
            .or_default()
            .push(child);
    }
    /// Takes back the most recently recorded child, to wait on it. Nothing is
    /// there if cancellation already killed and removed it.
    fn take_process(&self, id: &str) -> Option<std::process::Child> {
        self.processes.lock().unwrap().get_mut(id)?.pop()
    }
    fn was_cancelled(&self, id: &str) -> bool {
        self.cancellations.lock().unwrap().contains(id)
    }

    /// Stops a running job. Returns whether there was one.
    ///
    /// The flag is what stops the run; killing the child only saves the wait.
    /// The flag is therefore never cleared here — only `cleanup` does that,
    /// when the worker itself has finished.
    pub fn cancel(&self, id: &str) -> bool {
        self.cancellations.lock().unwrap().insert(id.to_string());
        // A run that has not started yet is stopped by leaving the queue; its
        // worker wakes, finds itself gone, and reports the cancellation.
        self.leave_queue_if_waiting(id);
        if let Some(children) = self.processes.lock().unwrap().remove(id) {
            for mut child in children {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.is_running(id)
    }

    /// Clears the cancel flag without stopping anything.
    pub fn forget_cancellation(&self, id: &str) {
        self.cancellations.lock().unwrap().remove(id);
    }

    fn cleanup(&self, id: &str) {
        self.forget_cancellation(id);
        self.processes.lock().unwrap().remove(id);
        self.running.lock().unwrap().remove(id);
    }
}

/// A `CommandRunner` that puts each child into the job's registry, so that
/// `Zrušit` reaches the preparation programs and not only whisper.
///
/// Waiting is done by reading stderr to its end rather than by holding the
/// child: the pipe closes when the process does, whether it finished or was
/// killed, and only then is the child taken back out of the registry. If it
/// is no longer there, cancellation took it — the same handshake
/// `start_whisper` has always used.
struct JobRunner<'a> {
    task: &'a TranscriptionTask,
    recording_id: &'a str,
}

impl tools::CommandRunner for JobRunner<'_> {
    fn run(
        &self,
        mut command: std::process::Command,
    ) -> std::io::Result<Option<(std::process::ExitStatus, String)>> {
        let mut child = command
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()?;
        let stderr = child.stderr.take().unwrap();
        self.task.record_process(self.recording_id, child);
        let mut text = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut text);
        match self.task.take_process(self.recording_id) {
            Some(mut child) => Ok(Some((child.wait()?, text.trim().to_string()))),
            None => Ok(None),
        }
    }
}

/// Give up between stages when the run has been cancelled.
///
/// The message is never read: the worker checks the cancel flag before it
/// looks at the result, and reports the run as cancelled rather than failed.
fn stop_if_cancelled(task: &TranscriptionTask, id: &str) -> Reported<()> {
    if task.was_cancelled(id) {
        return Err(UserMessage::new("transcription.cancelled"));
    }
    Ok(())
}

// ---------------------------------------------------------------- vstupni bod

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
                let _ = db::set_status(s, &recording_id, "nova", None);
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
                    .map(|s| db::set_status(s, &recording_id, "hotova", None));
                if !matches!(stored, Some(Ok(_))) {
                    if let Ok(second) = db::open(&db_path) {
                        if let Err(error) = db::set_status(&second, &recording_id, "hotova", None) {
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
                    let _ = db::set_status(s, &recording_id, "chyba", Some(&message.to_stored()));
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
                let _ = db::set_status(s, &recording_id, "hotova", None);
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
                    .map(|s| db::set_status(s, &recording_id, "hotova", None));
                if !matches!(stored, Some(Ok(_))) {
                    if let Ok(second) = db::open(&db_path) {
                        if let Err(error) = db::set_status(&second, &recording_id, "hotova", None) {
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
                    let _ = db::set_status(s, &recording_id, "hotova", None);
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

    db::set_status(&connection, recording_id, "prepisuje", None)?;
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

    // No fixed percentage here: sherpa reports its own and `diarize` passes
    // it straight through. Ten per cent is where the audio conversion ended.
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
        task,
        recording_id,
        Some((app, recording_id, 10.0, 90.0)),
    )?;
    stop_if_cancelled(task, recording_id)?;

    let segments = db::segments(&connection, recording_id)?;
    if segments.is_empty() {
        return Err(UserMessage::new("diarization.not_transcribed"));
    }
    let segments = assign_speakers(segments, &turns);

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

fn run(
    app: &AppHandle,
    db_path: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
    speaker_count: Option<i64>,
) -> Reported<usize> {
    // Vlastni spojeni pro toto vlakno - hlavni vlakno tak neceka minuty na zamek.
    let connection = db::open(db_path)?;
    let mut settings = db::load_settings(&connection)?;
    // An answer given for this recording wins over the stored default without
    // changing it: the next recording asks again.
    if let Some(count) = speaker_count {
        settings.speaker_count = count.max(0);
    }
    let recording = db::recording(&connection, recording_id)?;
    let dictionary = db::dictionary(&connection)?;

    db::set_status(&connection, recording_id, "prepisuje", None)?;
    db::set_model(&connection, recording_id, &settings.model)?;

    let check = tools::check(&settings);
    if let Some(issue) = check.issues.first() {
        return Err(issue.clone());
    }
    stop_if_cancelled(task, recording_id)?;

    // ------------------------------------------------------------ priprava
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

    // ------------------------------------------------------------ prepis
    // Whisper is the expensive one. Starting it after a cancellation that
    // arrived during preparation is how `Zrušit` used to look like it did
    // nothing at all: the request was noted and the run went on for minutes.
    stop_if_cancelled(task, recording_id)?;
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

    start_whisper(
        app,
        recording_id,
        &settings,
        &language,
        &check,
        &wav,
        &prefix,
        task,
    )?;

    let json_file = prefix.with_extension("json");
    // With automatic detection the real language is only known from the output.
    if let Some(j) = language_from_json(&json_file) {
        db::set_language(&connection, recording_id, &j)?;
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

    // ------------------------------------------------------------ vety
    segments = rebuild_sentences(segments);

    // ------------------------------------------------ zacatek proti zvuku
    // After the blocks are final, because it is the first word of a block
    // that lights up. The 16 kHz copy whisper was given is still on disk.
    snap_starts_to_sound(&mut segments, &wav);

    // ------------------------------------------------------------ slovnik
    apply_dictionary(&mut segments, &dictionary);

    // ------------------------------------------------------------ diarizace
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
                task,
                recording_id,
                // Diarization owns 90..95; saving takes it from there.
                Some((app, recording_id, TRANSCRIPTION_END_PERCENT as f64, 95.0)),
            ) {
                Ok(turns) => segments = assign_speakers(segments, &turns),
                Err(error) => {
                    // Diarizace je bonus. Kdyz selze, prepis prece nezahodime.
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

    // ------------------------------------------------------------ ulozeni
    stop_if_cancelled(task, recording_id)?;
    status(app, recording_id, "saving", 95, step("saving"));

    let mut key: Vec<String> = segments.iter().filter_map(|s| s.speakers.clone()).collect();
    key.sort_by_key(|k| order_key(k));
    key.dedup();
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
        Ok(())
    })();
    if let Err(e) = save_result {
        let _ = connection.execute_batch("ROLLBACK");
        return Err(e);
    }
    connection.execute_batch("COMMIT")?;

    let _ = std::fs::remove_dir_all(&working_directory);
    Ok(segments.len())
}

// ---------------------------------------------------------------- whisper

/// Name of the alignment preset for `--dtw`. whisper.cpp names them after
/// the models, only with dots instead of hyphens.
fn dtw_preset(model: &str) -> Option<&'static str> {
    let m = model.to_lowercase();
    if m.contains("large") && m.contains("turbo") {
        Some("large.v3.turbo")
    } else if m.contains("large-v3") || m.contains("large.v3") {
        Some("large.v3")
    } else if m.contains("large-v2") {
        Some("large.v2")
    } else if m.contains("medium") {
        Some("medium")
    } else if m.contains("small") {
        Some("small")
    } else if m.contains("base") {
        Some("base")
    } else {
        None
    }
}

/// Pulls the program's own help text so we know which flags it accepts.
fn program_help(program: &Path) -> String {
    match command(program)
        .arg("--help")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => format!(
            "{}{}",
            String::from_utf8_lossy(&o.stdout),
            String::from_utf8_lossy(&o.stderr)
        ),
        Err(_) => String::new(),
    }
}

// Vychozi hodnoty samotneho whisper.cpp (examples/cli/cli.cpp). Co se jim
// rovna, se na prikazovou radku vubec neposila. Entropii mame jinou uz
// odjakziva — viz `vychozi_prah_entropie` v db.rs.
const WHISPER_NO_SPEECH_THRESHOLD: f64 = 0.6;
const WHISPER_LOGPROB_THRESHOLD: f64 = -1.0;
const WHISPER_ENTROPY_THRESHOLD: f64 = 2.4;
const WHISPER_TEMPERATURE_INCREMENT: f64 = 0.2;

fn start_whisper(
    app: &AppHandle,
    recording_id: &str,
    settings: &Settings,
    language: &str,
    check: &tools::ToolCheck,
    wav: &Path,
    prefix: &Path,
    task: &TranscriptionTask,
) -> Reported<()> {
    let program = Path::new(check.whisper_cli.as_ref().unwrap());

    // Find out what this particular build supports. whisper.cpp versions
    // differ, and on an unknown flag the program prints its help and **exits
    // with zero** — it looks like success, only there is no output after it.
    let available = program_help(program);
    let supports = |argument: &str| available.is_empty() || available.contains(argument);

    let mut cmd: Command = command(program);

    cmd.arg("-m")
        .arg(check.model_whisper.as_ref().unwrap())
        .arg("-f")
        .arg(wav)
        .args(["-l", language]);

    if supports("--output-json-full") {
        cmd.arg("--output-json-full");
    } else {
        cmd.arg("--output-json");
    }
    cmd.arg("--output-file").arg(prefix).arg("--print-progress");

    if settings.beam > 1 {
        cmd.args(["--beam-size", &settings.beam.to_string()]);
    }

    // Whisper can get stuck in a loop and repeat one sentence a hundred
    // times over. The safeguard is to limit how much of its own previous
    // output it carries forward.
    //
    // Turning context off entirely (`--no-context`) breaks the loop reliably,
    // but the model then starts every window from scratch and stops producing
    // capitals and punctuation — both of which it decides from the preceding
    // sentence. A short context is the compromise: enough for typesetting the
    // text, not enough to entrench a loop.
    if supports("--max-context") {
        cmd.args(["--max-context", "64"]);
    }
    // Thresholds whisper.cpp uses to decide whether it transcribed a segment
    // properly or should try again. Only those differing from the program's
    // own defaults are passed: a shorter command is easier to read from a log
    // when something goes wrong, and it shows at a glance what was tweaked.
    let differs = |a: f64, b: f64| (a - b).abs() > f64::EPSILON;

    // When the output is suspiciously monotonous, have it retry differently.
    if supports("--entropy-thold") && differs(settings.entropy_threshold, WHISPER_ENTROPY_THRESHOLD)
    {
        cmd.args(["--entropy-thold", &settings.entropy_threshold.to_string()]);
    }
    if supports("--no-speech-thold")
        && differs(settings.threshold_silence, WHISPER_NO_SPEECH_THRESHOLD)
    {
        cmd.args(["--no-speech-thold", &settings.threshold_silence.to_string()]);
    }
    if supports("--logprob-thold")
        && differs(settings.threshold_confidence, WHISPER_LOGPROB_THRESHOLD)
    {
        cmd.args([
            "--logprob-thold",
            &settings.threshold_confidence.to_string(),
        ]);
    }
    if supports("--temperature") && differs(settings.temperature, 0.0) {
        cmd.args(["--temperature", &settings.temperature.to_string()]);
    }
    if supports("--temperature-inc")
        && differs(
            settings.temperature_increment,
            WHISPER_TEMPERATURE_INCREMENT,
        )
    {
        cmd.args([
            "--temperature-inc",
            &settings.temperature_increment.to_string(),
        ]);
    }
    // Without alignment (DTW) the token times are a rough guess and word
    // highlighting drifts towards the end of a segment.
    if supports("--dtw") {
        if let Some(preset) = dtw_preset(&settings.model) {
            cmd.args(["--dtw", preset]);
        }
    }
    if settings.threads > 0 {
        cmd.args(["-t", &settings.threads.to_string()]);
    }
    // VAD: bez ni Whisper na tichu opakuje jeden token dokola a spolkne zacatek reci.
    if settings.vad && supports("--vad ") {
        if let Some(vad) = &check.model_vad {
            cmd.arg("--vad").arg("--vad-model").arg(vad);
            if supports("--vad-threshold") {
                cmd.args(["--vad-threshold", &settings.vad_threshold.to_string()]);
            }
            if supports("--vad-min-speech-duration-ms") {
                cmd.args(["--vad-min-speech-duration-ms", "250"]);
            }
            if supports("--vad-min-silence-duration-ms") {
                cmd.args(["--vad-min-silence-duration-ms", "500"]);
            }
            // bez odsazeni VAD ukusuje prvni slabiky
            if supports("--vad-speech-pad-ms") {
                cmd.args(["--vad-speech-pad-ms", "250"]);
            }
            if supports("--suppress-nst") {
                cmd.arg("--suppress-nst");
            }
        }
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| UserMessage::new("transcription.whisper_launch_failed").detail(error))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // From here the transcription can be cancelled. Without a stored handle
    // there would be no way to kill the process and whisper would run to the
    // end regardless.
    task.record_process(recording_id, child);

    // stderr = postup v procentech
    let app2 = app.clone();
    let id2 = recording_id.to_string();
    let progress_thread = std::thread::spawn(move || {
        let re = Regex::new(r"progress\s*=\s*(\d+)\s*%").unwrap();
        let mut last = TRANSCRIPTION_START_PERCENT;
        for row in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(c) = re.captures(&row) {
                if let Ok(p) = c[1].parse::<u32>() {
                    let overall = overall_transcription_percent(p);
                    if overall != last {
                        last = overall;
                        status(
                            &app2,
                            &id2,
                            "transcription",
                            overall,
                            step("transcription.running"),
                        );
                    }
                }
            }
        }
    });

    // stdout = segmenty, jak vznikaji
    let re_segment =
        Regex::new(r"^\[(\d+):(\d+):(\d+)\.(\d+)\s*-->\s*(\d+):(\d+):(\d+)\.(\d+)\]\s*(.*)$")
            .unwrap();
    for row in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(c) = re_segment.captures(row.trim()) {
            let time = |h: &str, m: &str, s: &str, ms: &str| -> f64 {
                h.parse::<f64>().unwrap_or(0.0) * 3600.0
                    + m.parse::<f64>().unwrap_or(0.0) * 60.0
                    + s.parse::<f64>().unwrap_or(0.0)
                    + ms.parse::<f64>().unwrap_or(0.0) / 1000.0
            };
            let _ = app.emit(
                "transcription:segment",
                LiveSegment {
                    recording_id: recording_id.to_string(),
                    start: time(&c[1], &c[2], &c[3], &c[4]),
                    end: time(&c[5], &c[6], &c[7], &c[8]),
                    text: c[9].trim().to_string(),
                },
            );
        }
    }

    let _ = progress_thread.join();
    // take the process back out of the registry; if someone killed it in the
    // meantime it is gone from there, and we read that as a cancellation
    let process_status = match task.take_process(recording_id) {
        Some(mut child) => child.wait()?,
        None => return Ok(()),
    };

    if !process_status.success() {
        return Err(UserMessage::new("transcription.whisper_failed")
            .with("code", process_status.code().unwrap_or(-1)));
    }
    Ok(())
}

/// The language the transcript ran in. Whisper always writes it into the
/// output, including when it detected the language itself.
fn language_from_json(file: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&contents).ok()?;
    json["result"]["language"].as_str().map(|s| s.to_string())
}

/// Streamovany stdout je hezky pro oko, ale zavazny zdroj dat je JSON -
/// obsahuje i jistotu jednotlivych tokenu.
fn load_segments_from_json(file: &Path, recording_id: &str) -> Result<Vec<Segment>> {
    let contents = std::fs::read_to_string(file)?;
    let json: serde_json::Value = serde_json::from_str(&contents)?;
    let fields = json["transcription"]
        .as_array()
        .ok_or_else(|| anyhow!("V JSON chybí pole 'transcription'"))?;

    let mut result: Vec<Segment> = Vec::new();
    for (i, s) in fields.iter().enumerate() {
        let text = s["text"].as_str().unwrap_or("").trim().to_string();
        if text.is_empty() {
            continue;
        }
        let from = s["offsets"]["from"].as_f64().unwrap_or(0.0) / 1000.0;
        let segment_end = s["offsets"]["to"].as_f64().unwrap_or(0.0) / 1000.0;

        // VAD keeps an overlap between segments (--vad-samples-overlap), so
        // a whole sentence is occasionally repeated at a boundary. The same
        // text at the same time is always a duplicate, never said twice.
        if let Some(p) = result.last() {
            if p.text == text && (p.start - from).abs() < 0.5 {
                continue;
            }
        }

        // Looping: Whisper sometimes repeats one sentence over and over to
        // the end of the recording. A couple of repeats can be rhetoric; ten
        // cannot.
        let repetition_count = result.iter().rev().take_while(|p| p.text == text).count();
        if repetition_count >= 2 {
            continue;
        }

        // prumerna pravdepodobnost tokenu = miru jistoty, kterou v editoru
        // podtrhneme, aby uzivatel vedel, kam se divat
        let confidence = s["tokens"].as_array().map(|t| {
            let values: Vec<f64> = t.iter().filter_map(|x| x["p"].as_f64()).collect();
            if values.is_empty() {
                1.0
            } else {
                values.iter().sum::<f64>() / values.len() as f64
            }
        });

        // Real word timings. Whisper returns them per token, and tokens are
        // often word fragments — glue them back together and take the time
        // from the first fragment.
        let words = s["tokens"].as_array().and_then(|t| {
            let mut output: Vec<serde_json::Value> = Vec::new();
            for tok in t {
                let Some(chunk) = tok["text"].as_str() else {
                    continue;
                };
                // technical markers such as [_BEG_] do not belong in the text
                if chunk.starts_with("[_") {
                    continue;
                }
                let time = tok["offsets"]["from"].as_f64().unwrap_or(0.0) / 1000.0;
                if chunk.starts_with(' ') || output.is_empty() {
                    output.push(serde_json::json!({ "t": time, "s": chunk.trim_start() }));
                } else if let Some(p) = output.last_mut() {
                    // continuation of a split word
                    let joined = format!("{}{}", p["s"].as_str().unwrap_or(""), chunk);
                    p["s"] = serde_json::Value::String(joined);
                }
            }
            output.retain(|x| !x["s"].as_str().unwrap_or("").trim().is_empty());
            if output.len() < 2 {
                None
            } else {
                serde_json::to_string(&output).ok()
            }
        });

        let mut segment = Segment {
            id: uuid::Uuid::new_v4().to_string(),
            recording_id: recording_id.to_string(),
            order: i as i64,
            start: from,
            end: segment_end,
            text,
            speakers: None,
            confidence,
            edited: false,
            verified: false,
            original: None,
            words,
        };
        db::align_word_timestamps(&mut segment);
        result.push(segment);
    }
    Ok(result)
}

// ------------------------------------------------------- zacatek proti zvuku

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
            samples = bytes[body..end]
                .chunks_exact(2)
                .map(|c| i16::from_le_bytes([c[0], c[1]]))
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

// ---------------------------------------------------------------- slovnik

/// Applies the dictionary to an already stored transcript. Returns the number
/// of changed segments. Used when someone adds a term afterwards — otherwise
/// the correction would only show up in the next transcription.
pub fn apply_dictionary_to_recording(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<usize> {
    let dictionary = db::dictionary(connection)?;
    let mut segments = db::segments(connection, recording_id)?;
    let original: Vec<(String, Option<String>)> = segments
        .iter()
        .map(|s| (s.text.clone(), s.words.clone()))
        .collect();

    apply_dictionary(&mut segments, &dictionary);

    let mut changes_applied = 0;
    for (segment, (old_text, old_words)) in segments.iter().zip(original) {
        if segment.text != old_text || segment.words != old_words {
            db::save_segment_text(
                connection,
                &segment.id,
                &segment.text,
                segment.words.as_deref(),
            )?;
            changes_applied += 1;
        }
    }
    Ok(changes_applied)
}

/// Abbreviations after which a full stop does not end the sentence.
const ABBREVIATIONS: &[&str] = &[
    "tzv.", "tzn.", "např.", "resp.", "atd.", "apod.", "mj.", "tj.", "č.", "str.", "kap.", "obr.",
    "sv.", "st.", "mgr.", "ing.", "phdr.", "mudr.", "prof.", "doc.", "mr.", "mrs.", "ms.", "dr.",
    "vs.", "etc.", "e.g.", "i.e.",
];

/// A sentence end is recognised from punctuation, but not every full stop
/// ends a sentence.
fn ends_sentence(word: &str, next: Option<&str>) -> bool {
    let ocesane = word.trim_end_matches(|z: char| z == '"' || z == '»' || z == '“' || z == ')');
    if !ocesane.ends_with(['.', '!', '?', '…']) {
        return false;
    }
    // Question and exclamation marks are unambiguous; a full stop needs care.
    if ocesane.ends_with(['!', '?', '…']) {
        return true;
    }

    let male = ocesane.to_lowercase();
    if ABBREVIATIONS.contains(&male.as_str()) {
        return false;
    }
    // Neither an initial ("J. A. Komenský") nor an ordinal ("3. kapitola").
    let jadro = male.trim_end_matches('.');
    if jadro.chars().count() <= 1 || jadro.chars().all(|z| z.is_ascii_digit()) {
        return false;
    }
    // A sentence end is followed by a capital letter or by nothing.
    match next {
        None => true,
        Some(d) => d
            .chars()
            .find(|z| z.is_alphanumeric())
            .map(|z| z.is_uppercase())
            .unwrap_or(false),
    }
}

/// A natural sentence may run this long without being touched. Beyond this
/// point a comma, clause mark or audible pause becomes a useful visual break.
const SOFT_SENTENCE_SECONDS: f64 = 18.0;

/// Even speech with no punctuation must not produce a block longer than this.
const MAX_SENTENCE_SECONDS: f64 = 28.0;

/// Avoid solving one long block by leaving an unreadable one-line remainder.
const MIN_REMAINDER_SECONDS: f64 = 6.0;

/// A forced split should not create a tiny leading fragment either.
const MIN_BLOCK_SECONDS: f64 = 8.0;

/// Word timestamps mark word starts rather than silence exactly. These values
/// therefore describe unusually wide start-to-start gaps, not literal pauses.
const NOTICEABLE_WORD_GAP_SECONDS: f64 = 0.75;
const LONG_WORD_GAP_SECONDS: f64 = 1.1;

/// Longest silence across which two segments are still treated as one
/// sentence.
///
/// Deliberately generous. The first attempt used two seconds, on the reasoning
/// that a longer pause means the sentence ended and nobody wrote the full stop
/// down. Real recordings said otherwise: a phrase as tight as "That'll mess |
/// with them" came back split by 2.3 seconds, and eight such joins in a single
/// ten-minute conversation would have been missed. Speakers pause mid-sentence
/// for breath and for effect, and VAD widens the gap further by cutting the
/// silence out.
///
/// So the text decides, not the clock: an unfinished sentence continuing in
/// lower case is one sentence however long the pause. This is only a backstop
/// against a genuinely dropped full stop.
const MAX_JOIN_GAP: f64 = 10.0;

/// Stored segment layout is derived data. Incrementing this version rebuilds
/// completed transcripts once from their preserved word timestamps without
/// running Whisper again.
const SENTENCE_LAYOUT_KEY: &str = "sentence-layout-version";
const SENTENCE_LAYOUT_VERSION: &str = "2";

/// One word with the time it is spoken at.
struct TimedWord {
    text: String,
    time: f64,
}

/// How suitable the boundary after `word` is for a visual block break.
/// Natural sentence endings are handled before this function; these are the
/// softer places available when Whisper punctuates a long thought with commas.
fn boundary_strength(word: &str, next: &str, gap: f64) -> u8 {
    let trimmed = word
        .trim_end_matches(|character: char| matches!(character, '"' | '»' | '“' | '”' | ')' | ']'));
    let clause_mark = trimmed.ends_with([';', ':', '—', '–']);
    let comma = trimmed.ends_with(',');
    let next_core = next
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase();
    let next_core_length = next_core.chars().count();
    // A block beginning with one of these words almost always continues the
    // preceding verb, noun or list item. The short cross-language core also
    // covers common equivalents such as "of", "to", "in", "on" and "zu".
    const DEPENDENT_OPENERS: &[&str] = &[
        "v", "ve", "na", "do", "od", "z", "ze", "s", "se", "k", "ke", "o", "u", "po", "pro",
        "před", "za", "pod", "nad", "mezi", "přes", "bez", "kvůli", "of", "to", "in", "on", "at",
        "from", "with", "for", "by", "into", "zu", "im", "am", "an", "von", "mit", "für",
    ];
    let dependent_opener = next_core_length <= 2 || DEPENDENT_OPENERS.contains(&next_core.as_str());

    // Written structure is more dependable than a pause. Speakers regularly
    // pause before a prepositional complement ("soustředíme | na ty malé"),
    // while a comma remains a useful clause boundary even when spoken without
    // silence. A pause or comma before a dependent opener is especially
    // likely to sit inside one grammatical phrase or list, so it is demoted.
    if clause_mark {
        4
    } else if comma && dependent_opener {
        1
    } else if comma {
        3
    } else if dependent_opener
        && next
            .chars()
            .find(|character| character.is_alphanumeric())
            .is_some_and(|character| character.is_lowercase())
    {
        0
    } else if gap >= LONG_WORD_GAP_SECONDS {
        2
    } else if gap >= NOTICEABLE_WORD_GAP_SECONDS {
        1
    } else {
        0
    }
}

/// Picks a readable boundary inside an over-long run of words.
///
/// Once the soft limit is reached, a real clause boundary may end the block.
/// If no such boundary appears before the hard limit, the best earlier comma
/// or pause wins; with no linguistic clue at all, cut nearest the soft target.
fn readable_cut(words: &[TimedWord]) -> Option<usize> {
    if words.len() < 2 {
        return None;
    }

    let start = words.first()?.time;
    let last = words.last()?.time;
    let span = last - start;
    if span < SOFT_SENTENCE_SECONDS {
        return None;
    }

    let target = start + SOFT_SENTENCE_SECONDS;
    let hard_end = start + MAX_SENTENCE_SECONDS;
    let latest_with_remainder = last - MIN_REMAINDER_SECONDS;

    let score = |index: usize| {
        let boundary = words[index + 1].time;
        let gap = boundary - words[index].time;
        let strength = boundary_strength(&words[index].text, &words[index + 1].text, gap) as f64;
        // One quality step is worth ten seconds of distance from the target.
        strength * 10.0 - (boundary - target).abs()
    };

    // A preferred break happens only after the soft limit and leaves enough
    // speech for the next block. This prevents a comma near the beginning or
    // end from creating a runt.
    let preferred = (0..words.len() - 1)
        .filter(|&index| {
            let boundary = words[index + 1].time;
            boundary >= target
                && boundary <= hard_end
                && boundary <= latest_with_remainder
                // Soft splitting is deliberately limited to written clause
                // boundaries. Choosing a pause as soon as it has six seconds
                // of trailing context is greedy: a better comma can be the
                // very next word but not yet have enough remainder itself.
                && boundary_strength(
                    &words[index].text,
                    &words[index + 1].text,
                    boundary - words[index].time,
                ) >= 3
        })
        .max_by(|&left, &right| score(left).total_cmp(&score(right)));
    if preferred.is_some() || span <= MAX_SENTENCE_SECONDS {
        return preferred;
    }

    // The hard limit was crossed. Reconsider useful boundaries before the
    // soft target as well, because a slightly short clause is better than a
    // mechanical cut through the middle of one.
    let forced_candidates: Vec<usize> = (0..words.len() - 1)
        .filter(|&index| {
            let boundary = words[index + 1].time;
            boundary >= start + MIN_BLOCK_SECONDS && boundary <= hard_end
        })
        .collect();
    if forced_candidates.is_empty() {
        return Some(0);
    }

    forced_candidates
        .iter()
        .copied()
        .filter(|&index| {
            let boundary = words[index + 1].time;
            boundary_strength(
                &words[index].text,
                &words[index + 1].text,
                boundary - words[index].time,
            ) > 0
        })
        .max_by(|&left, &right| score(left).total_cmp(&score(right)))
        .or_else(|| {
            forced_candidates.into_iter().min_by(|&left, &right| {
                let left_distance = (words[left + 1].time - target).abs();
                let right_distance = (words[right + 1].time - target).abs();
                left_distance.total_cmp(&right_distance)
            })
        })
}

/// Rebuilds the transcript into sentences.
///
/// Whisper divides text by its own thirty-second window, not by meaning. Two
/// things follow from that, and both need fixing:
///
/// * a stretch of speech with no pauses arrives as one long block, awkward to
///   work with in the editor and hard to follow when highlighted;
/// * a sentence that happens to straddle the end of a window is torn in two,
///   so its last words appear at the start of the next segment.
///
/// Splitting alone fixed the first and left the second. So the words are put
/// back into one stream and cut afresh at sentence ends. Times come from the
/// stored word timings, so nothing moves.
fn rebuild_sentences(segments: Vec<Segment>) -> Vec<Segment> {
    let mut output: Vec<Segment> = Vec::with_capacity(segments.len());
    let mut buffer: Vec<TimedWord> = Vec::new();
    // The segment the buffered words started in — it lends its identity and
    // its confidence to the sentences that come out.
    let mut origin: Option<Segment> = None;
    // Where the last segment that fed the buffer ended. Needed because a word
    // timing marks a beginning, so the final word of a sentence would
    // otherwise have no duration at all.
    let mut collected_end = 0.0f64;

    for s in segments {
        let words: Vec<serde_json::Value> = s
            .words
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();

        // Without word timings there is nothing to cut by. A hand-edited or
        // explicitly verified segment is user-owned and must keep its exact
        // boundaries during a later layout upgrade. All three act as barriers.
        if words.is_empty() || s.edited || s.verified {
            flush(&mut buffer, &mut origin, &mut output, collected_end);
            output.push(s);
            continue;
        }

        let incoming: Vec<TimedWord> = words
            .iter()
            .filter_map(|w| {
                Some(TimedWord {
                    text: w["s"].as_str()?.to_string(),
                    time: w["t"].as_f64().unwrap_or(s.start),
                })
            })
            .collect();
        if incoming.is_empty() {
            flush(&mut buffer, &mut origin, &mut output, collected_end);
            output.push(s);
            continue;
        }

        // Does this segment continue the sentence being collected, or start
        // its own? Whisper's source chunks are implementation windows, not
        // grammatical units. In particular, their first token may be
        // capitalised even when the window starts mid-sentence, so capital
        // letters must not become hard barriers here.
        //
        // A change of speaker always ends the collection, whatever the
        // wording says. Two people finishing each other's sentence is still
        // two segments — merging them would credit one person's words to the
        // other. Matters when this runs over an already diarized transcript;
        // straight after transcription nobody has a speaker yet.
        let different_speaker = origin
            .as_ref()
            .map(|o| o.speakers != s.speakers)
            .unwrap_or(false);

        if let (Some(last), Some(first_word)) = (buffer.last(), incoming.first()) {
            let gap = first_word.time - last.time;

            if different_speaker || gap > MAX_JOIN_GAP {
                flush(&mut buffer, &mut origin, &mut output, collected_end);
            }
        }

        if origin.is_none() {
            origin = Some(s.clone());
        }
        buffer.extend(incoming);
        collected_end = s.end;

        // Everything up to the last complete sentence can be emitted now; the
        // tail waits for the next segment to finish it.
        emit_complete_sentences(&mut buffer, &mut origin, &mut output, s.end);
    }
    flush(&mut buffer, &mut origin, &mut output, collected_end);

    // The ordering was only ever provisional. Renumber from scratch.
    for (i, s) in output.iter_mut().enumerate() {
        s.order = i as i64;
    }
    output
}

/// Emits every finished sentence from the buffer and keeps the rest.
fn emit_complete_sentences(
    buffer: &mut Vec<TimedWord>,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
    fallback_end: f64,
) {
    let mut last_cut = 0usize;
    let mut cuts: Vec<usize> = Vec::new();
    for i in 0..buffer.len().saturating_sub(1) {
        if ends_sentence(&buffer[i].text, Some(&buffer[i + 1].text)) {
            cuts.push(i);
        }
    }
    for cut in cuts {
        push_readable_run(
            &buffer[last_cut..=cut],
            buffer.get(cut + 1).map(|w| w.time).unwrap_or(fallback_end),
            origin,
            output,
        );
        last_cut = cut + 1;
    }
    if last_cut > 0 {
        buffer.drain(0..last_cut);
    }
    // Once the buffer is empty, the next source segment must lend its own id
    // and metadata. Previously the capital-letter barrier happened to reset
    // this state; sentence completion now does so explicitly.
    if buffer.is_empty() {
        *origin = None;
    }
}

/// Emits one complete sentence or barrier-delimited run, splitting it only
/// when the adaptive readability limits require it.
fn push_readable_run(
    words: &[TimedWord],
    end: f64,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
) {
    let mut from = 0usize;
    while let Some(relative_cut) = readable_cut(&words[from..]) {
        let cut = from + relative_cut;
        let boundary = words.get(cut + 1).map(|word| word.time).unwrap_or(end);
        push_sentence(&words[from..=cut], boundary, origin, output);
        from = cut + 1;
    }
    if from < words.len() {
        push_sentence(&words[from..], end, origin, output);
    }
}

/// Emits whatever is left, sentence end or not, and empties the buffer.
fn flush(
    buffer: &mut Vec<TimedWord>,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
    collected_end: f64,
) {
    if buffer.is_empty() {
        *origin = None;
        return;
    }
    // The end of the last segment that contributed, not the last word's own
    // time. A word timing says when the word *starts*; using it as the end
    // cut the final word off — the highlight never reached it and a subtitle
    // disappeared while it was still being said.
    let last_word = buffer.last().map(|w| w.time).unwrap_or(0.0);
    push_readable_run(&buffer[..], collected_end.max(last_word), origin, output);
    buffer.clear();
    *origin = None;
}

/// Turns a run of words into one segment.
fn push_sentence(
    words: &[TimedWord],
    end: f64,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
) {
    let text = words
        .iter()
        .map(|w| w.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if text.is_empty() {
        return;
    }
    let Some(template) = origin.as_mut() else {
        return;
    };

    let start = words[0].time;
    let word_data: Vec<serde_json::Value> = words
        .iter()
        .map(|w| serde_json::json!({ "t": w.time, "s": w.text }))
        .collect();

    // The first sentence out of a segment inherits its identity, so anything
    // pointing at it still resolves; the rest get fresh ones. The identity is
    // handed over exactly once — taking it empties it, which is cheaper and
    // safer than searching the output for it every time.
    let id = if template.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        std::mem::take(&mut template.id)
    };

    output.push(Segment {
        id,
        recording_id: template.recording_id.clone(),
        order: output.len() as i64,
        start,
        end: end.max(start),
        text,
        speakers: template.speakers.clone(),
        confidence: template.confidence,
        edited: template.edited,
        verified: template.verified,
        words: serde_json::to_string(&word_data).ok(),
        original: template.original.clone(),
    });
}

fn same_sentence_layout(before: &[Segment], after: &[Segment]) -> bool {
    before.len() == after.len()
        && before.iter().zip(after).all(|(left, right)| {
            (left.start - right.start).abs() < 0.001
                && (left.end - right.end).abs() < 0.001
                && left.text == right.text
                && left.speakers == right.speakers
                && left.edited == right.edited
                && left.verified == right.verified
        })
}

/// Whether the archive still contains segment layout produced by an older
/// version of the sentence builder.
pub fn sentence_layout_upgrade_needed(connection: &rusqlite::Connection) -> Result<bool> {
    Ok(
        db::metadata_value(connection, SENTENCE_LAYOUT_KEY)?.as_deref()
            != Some(SENTENCE_LAYOUT_VERSION),
    )
}

/// Rebuilds visual transcript blocks from already stored word timestamps.
///
/// This is intentionally one atomic transaction. The words, their times and
/// the recording are not re-transcribed; only derived segment boundaries are
/// replaced. Edited and verified segments remain hard barriers.
pub fn upgrade_sentence_layout(connection: &mut rusqlite::Connection) -> Result<usize> {
    if !sentence_layout_upgrade_needed(connection)? {
        return Ok(0);
    }

    let transaction = connection.transaction()?;
    let recording_ids = db::completed_recording_ids_with_segments(&transaction)?;
    let mut changed = 0usize;

    for recording_id in recording_ids {
        let before = db::segments(&transaction, &recording_id)?;
        let after = rebuild_sentences(before.clone());
        if same_sentence_layout(&before, &after) {
            continue;
        }

        db::delete_segments(&transaction, &recording_id)?;
        for segment in &after {
            db::insert_segment(&transaction, segment)?;
        }
        changed += 1;
    }

    db::save_metadata_value(&transaction, SENTENCE_LAYOUT_KEY, SENTENCE_LAYOUT_VERSION)?;
    transaction.commit()?;
    Ok(changed)
}

#[cfg(test)]
mod sentence_block_tests {
    use super::*;

    fn segment(id: &str, speaker: Option<&str>, words: Vec<(f64, String)>, end: f64) -> Segment {
        let start = words.first().map(|word| word.0).unwrap_or(0.0);
        let text = words
            .iter()
            .map(|word| word.1.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let word_data: Vec<serde_json::Value> = words
            .iter()
            .map(|(time, text)| serde_json::json!({ "t": time, "s": text }))
            .collect();
        Segment {
            id: id.to_string(),
            recording_id: "recording".to_string(),
            order: 0,
            start,
            end,
            text,
            speakers: speaker.map(str::to_string),
            confidence: Some(0.9),
            edited: false,
            verified: false,
            words: serde_json::to_string(&word_data).ok(),
            original: None,
        }
    }

    fn plain_words(count: usize, comma_after: Option<usize>) -> Vec<(f64, String)> {
        (0..count)
            .map(|index| {
                let suffix = if comma_after == Some(index) { "," } else { "" };
                (index as f64, format!("slovo{index}{suffix}"))
            })
            .collect()
    }

    #[test]
    fn keeps_short_natural_sentences_as_sentences() {
        let input = segment(
            "one",
            None,
            vec![
                (0.0, "První".into()),
                (1.0, "věta.".into()),
                (2.0, "Druhá".into()),
                (3.0, "věta.".into()),
            ],
            4.0,
        );

        let output = rebuild_sentences(vec![input]);

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].text, "První věta.");
        assert_eq!(output[1].text, "Druhá věta.");
    }

    #[test]
    fn splits_a_long_comma_joined_thought_at_the_clause() {
        let input = segment("one", None, plain_words(41, Some(19)), 41.0);

        let output = rebuild_sentences(vec![input]);

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].end, 20.0);
        assert_eq!(output[1].start, 20.0);
        assert!(output
            .iter()
            .all(|block| block.end - block.start <= MAX_SENTENCE_SECONDS));
    }

    #[test]
    fn hard_limit_handles_speech_without_any_punctuation() {
        let input = segment("one", None, plain_words(61, None), 61.0);

        let output = rebuild_sentences(vec![input]);

        assert!(output.len() >= 3);
        assert!(output
            .iter()
            .all(|block| block.end - block.start <= MAX_SENTENCE_SECONDS));
        let word_count: usize = output
            .iter()
            .map(|block| {
                block
                    .words
                    .as_deref()
                    .and_then(|words| serde_json::from_str::<Vec<serde_json::Value>>(words).ok())
                    .map(|words| words.len())
                    .unwrap_or(0)
            })
            .sum();
        assert_eq!(word_count, 61);
    }

    #[test]
    fn does_not_leave_a_tiny_remainder_after_a_soft_split() {
        let input = segment("one", None, plain_words(23, Some(19)), 23.0);

        let output = rebuild_sentences(vec![input]);

        assert_eq!(output.len(), 1);
    }

    #[test]
    fn waits_for_a_comma_instead_of_cutting_the_phrase_before_it() {
        let mut words = vec![
            TimedWord {
                text: "začátek".into(),
                time: 0.0,
            },
            TimedWord {
                text: "pokračuje".into(),
                time: 8.0,
            },
            TimedWord {
                text: "z".into(),
                time: 17.5,
            },
            TimedWord {
                text: "jednoho".into(),
                time: 18.0,
            },
            TimedWord {
                text: "prostého".into(),
                time: 18.5,
            },
            TimedWord {
                text: "důvodu,".into(),
                time: 19.6,
            },
            TimedWord {
                text: "protože".into(),
                time: 20.2,
            },
            TimedWord {
                text: "pokračování".into(),
                time: 25.7,
            },
        ];

        // At this point only the pause before "důvodu" has enough following
        // context. It must not win merely because the comma one word later is
        // not eligible yet.
        assert_eq!(readable_cut(&words), None);

        words.push(TimedWord {
            text: "dál".into(),
            time: 26.3,
        });
        let cut = readable_cut(&words).expect("the comma should now be eligible");
        assert_eq!(words[cut].text, "důvodu,");
    }

    #[test]
    fn comma_outranks_a_pause_inside_a_prepositional_phrase() {
        let words = vec![
            TimedWord {
                text: "začátek".into(),
                time: 0.0,
            },
            TimedWord {
                text: "pokračuje".into(),
                time: 9.0,
            },
            TimedWord {
                text: "boji,".into(),
                time: 18.0,
            },
            TimedWord {
                text: "o".into(),
                time: 18.5,
            },
            TimedWord {
                text: "čase,".into(),
                time: 19.0,
            },
            TimedWord {
                text: "o".into(),
                time: 19.5,
            },
            TimedWord {
                text: "tom,".into(),
                time: 20.0,
            },
            TimedWord {
                text: "že".into(),
                time: 20.5,
            },
            TimedWord {
                text: "to".into(),
                time: 20.8,
            },
            TimedWord {
                text: "nejde".into(),
                time: 21.2,
            },
            TimedWord {
                text: "hned,".into(),
                time: 21.5,
            },
            TimedWord {
                text: "ale".into(),
                time: 22.0,
            },
            TimedWord {
                text: "když".into(),
                time: 22.5,
            },
            TimedWord {
                text: "se".into(),
                time: 23.0,
            },
            TimedWord {
                text: "soustředíme".into(),
                time: 24.0,
            },
            TimedWord {
                text: "na".into(),
                time: 25.2,
            },
            TimedWord {
                text: "ty".into(),
                time: 25.4,
            },
            TimedWord {
                text: "malé,".into(),
                time: 26.0,
            },
            TimedWord {
                text: "tak".into(),
                time: 26.4,
            },
            TimedWord {
                text: "pokračujeme".into(),
                time: 31.5,
            },
        ];

        let cut = readable_cut(&words).expect("the long run needs a readable split");
        assert_eq!(words[cut].text, "hned,");
        assert_ne!(words[cut].text, "boji,");
        assert_ne!(words[cut].text, "soustředíme");
    }

    #[test]
    fn source_window_capitalization_does_not_break_an_unfinished_sentence() {
        let first = segment(
            "one",
            None,
            vec![
                (0.0, "Tohle".into()),
                (1.0, "je".into()),
                (2.0, "nedokončené".into()),
            ],
            3.0,
        );
        let second = segment(
            "two",
            None,
            vec![(3.1, "Pokračování".into()), (4.0, "věty.".into())],
            5.0,
        );

        let output = rebuild_sentences(vec![first, second]);

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].text, "Tohle je nedokončené Pokračování věty.");
    }

    #[test]
    fn layout_upgrade_rebuilds_existing_segments_once() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE nahravky (
                    id TEXT PRIMARY KEY, stav TEXT NOT NULL, vytvoreno TEXT NOT NULL
                 );
                 CREATE TABLE segmenty (
                    id TEXT PRIMARY KEY, nahravka_id TEXT NOT NULL, poradi INTEGER NOT NULL,
                    zacatek REAL NOT NULL, konec REAL NOT NULL, text TEXT NOT NULL,
                    mluvci TEXT, jistota REAL, upraveno INTEGER NOT NULL DEFAULT 0,
                    slova TEXT, overeno INTEGER NOT NULL DEFAULT 0, puvodni TEXT
                 );
                 CREATE VIRTUAL TABLE segmenty_fts USING fts5(
                    text, segment_id UNINDEXED, nahravka_id UNINDEXED
                 );
                 CREATE TABLE klice (klic TEXT PRIMARY KEY, hodnota TEXT NOT NULL);
                 INSERT INTO nahravky (id, stav, vytvoreno)
                 VALUES ('recording', 'hotova', '2026-08-02 00:00:00');",
            )
            .unwrap();

        let first = segment(
            "one",
            None,
            vec![
                (0.0, "začátek".into()),
                (8.0, "pokračuje".into()),
                (17.5, "z".into()),
                (18.0, "jednoho".into()),
                (18.5, "prostého".into()),
            ],
            19.6,
        );
        let second = segment(
            "two",
            None,
            vec![
                (19.6, "důvodu,".into()),
                (20.2, "protože".into()),
                (25.7, "pokračování".into()),
                (26.3, "jde".into()),
                (30.5, "dál.".into()),
            ],
            31.0,
        );
        db::insert_segment(&connection, &first).unwrap();
        db::insert_segment(&connection, &second).unwrap();

        assert_eq!(upgrade_sentence_layout(&mut connection).unwrap(), 1);
        let upgraded = db::segments(&connection, "recording").unwrap();
        assert_eq!(upgraded.len(), 2);
        assert!(upgraded[0].text.ends_with("prostého důvodu,"));
        assert!(upgraded[1].text.starts_with("protože"));
        assert_eq!(upgrade_sentence_layout(&mut connection).unwrap(), 0);
    }

    #[test]
    fn a_speaker_change_remains_a_hard_boundary() {
        let first = segment("one", Some("A"), plain_words(5, None), 5.0);
        let second_words = plain_words(5, None)
            .into_iter()
            .map(|(time, text)| (time + 5.0, text))
            .collect();
        let second = segment("two", Some("B"), second_words, 10.0);

        let output = rebuild_sentences(vec![first, second]);

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].speakers.as_deref(), Some("A"));
        assert_eq!(output[1].speakers.as_deref(), Some("B"));
    }
}

fn apply_dictionary(segments: &mut [Segment], dictionary: &[db::DictionaryEntry]) {
    let rules: Vec<(Regex, String)> = dictionary
        .iter()
        .filter(|p| !p.find.trim().is_empty())
        .filter_map(|p| {
            let pattern = format!(r"(?i)\b{}\b", regex::escape(p.find.trim()));
            Regex::new(&pattern)
                .ok()
                .map(|regex| (regex, p.replace.clone()))
        })
        .collect();

    if rules.is_empty() {
        return;
    }
    for s in segments.iter_mut() {
        for (re, replacement) in &rules {
            // `NoExpand`: the replacement is what the person typed, not a
            // template. Without it `$` starts a capture-group reference, so a
            // dictionary entry replacing something with `cena $5` writes
            // `cena ` — and this runs over every transcript, including one
            // already corrected by hand.
            s.text = re
                .replace_all(&s.text, regex::NoExpand(replacement.as_str()))
                .to_string();
        }

        // Word timings carry the word text too. Without this, highlighting
        // would keep lighting up the old wording.
        let Some(json) = s.words.as_deref() else {
            continue;
        };
        let Ok(mut chunks) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
            continue;
        };
        let mut change = false;
        for chunk in chunks.iter_mut() {
            let Some(text) = chunk["s"].as_str() else {
                continue;
            };
            let mut new = text.to_string();
            for (re, replacement) in &rules {
                new = re
                    .replace_all(&new, regex::NoExpand(replacement.as_str()))
                    .to_string();
            }
            if new != text {
                chunk["s"] = serde_json::Value::String(new);
                change = true;
            }
        }
        if change {
            if let Ok(t) = serde_json::to_string(&chunks) {
                s.words = Some(t);
            }
        }
    }
}

/// Sample density of the waveform. Twelve per second is enough for lively
/// bars; on a very long recording it drops so the total stays under thirty
/// thousand.
/// Must match what the waveform command in main.rs computes, or the same
/// recording would get a different envelope depending on which path made it.
pub const MAX_WAVEFORM_POINTS: f64 = 30_000.0;
pub const EQUALIZER_BAND_COUNT: usize = 24;
pub const EQUALIZER_POINTS_PER_SECOND: usize = 10;

pub fn waveform_density(duration: f64) -> (f64, usize) {
    let points_per_second = if duration > 0.0 {
        (MAX_WAVEFORM_POINTS / duration).min(12.0)
    } else {
        12.0
    };
    let count =
        ((duration * points_per_second).ceil() as usize).clamp(1, MAX_WAVEFORM_POINTS as usize);
    (points_per_second, count)
}

fn waveform_from_wav(
    check: &tools::ToolCheck,
    wav: &Path,
    duration: f64,
) -> Reported<db::WaveformData> {
    let ffmpeg = check
        .ffmpeg
        .as_ref()
        .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;
    let (points_per_second, count) = waveform_density(duration);
    let points = tools::waveform_amplitude(Path::new(ffmpeg), wav, count)?;
    let equalizer = tools::equalizer_peaks(
        Path::new(ffmpeg),
        wav,
        EQUALIZER_BAND_COUNT,
        EQUALIZER_POINTS_PER_SECOND,
    )?;
    Ok(db::WaveformData {
        points,
        points_per_second,
        equalizer,
        equalizer_points_per_second: EQUALIZER_POINTS_PER_SECOND as f64,
        equalizer_band_count: EQUALIZER_BAND_COUNT,
    })
}

// ---------------------------------------------------------------- diarizace

struct SpeakerTurn {
    start: f64,
    end: f64,
    key: String,
}

/// Runs speaker diarization over a converted WAV.
///
/// `report` is the app handle, the recording id, and the percentage band this
/// run occupies in whatever pipeline it belongs to. Sherpa's own 0–100 is
/// mapped into that band, so the same function serves a standalone run and one
/// inside a full transcription without either inventing numbers.
fn diarize(
    settings: &Settings,
    check: &tools::ToolCheck,
    wav: &Path,
    task: &TranscriptionTask,
    recording_id: &str,
    report: Option<(&AppHandle, &str, f64, f64)>,
) -> Reported<Vec<SpeakerTurn>> {
    let program = Path::new(check.sherpa_diarization.as_ref().unwrap());

    // Sherpa is built on the Kaldi option parser: an unknown flag is not an
    // error, the program simply prints its help and exits with zero. So ask it
    // up front what it supports and pass only that.
    let available = program_help(program);
    let supports = |argument: &str| available.is_empty() || available.contains(argument);

    let mut cmd = command(program);
    cmd.arg(format!(
        "--segmentation.pyannote-model={}",
        check.segmentation_model.as_ref().unwrap()
    ))
    .arg(format!(
        "--embedding.model={}",
        check.embedding_model.as_ref().unwrap()
    ));

    if settings.speaker_count > 0 {
        cmd.arg(format!(
            "--clustering.num-clusters={}",
            settings.speaker_count
        ));
    } else if supports("--clustering.cluster-threshold") {
        cmd.arg(format!(
            "--clustering.cluster-threshold={}",
            settings.cluster_threshold
        ));
    } else if supports("--clustering.threshold") {
        cmd.arg(format!(
            "--clustering.threshold={}",
            settings.cluster_threshold
        ));
    }

    // How densely the segmentation windows follow one another. Sherpa
    // defaults to a tenth, i.e. ninety per cent overlap — the slowest setting
    // there is. The user chooses in settings; here we only keep the value
    // inside the range the program accepts, since outside (0, 1] it errors.
    if supports("--segmentation.pyannote-window-shift-ratio") {
        let shift = settings.segmentation_window_shift.clamp(0.05, 1.0);
        cmd.arg(format!(
            "--segmentation.pyannote-window-shift-ratio={shift}"
        ));
    }

    // `--min-duration-on` and `--min-duration-off` are deliberately absent.
    //
    // Raising them is tempting as a cure for fragmentation: a segment shorter
    // than `on` is dropped, a gap shorter than `off` is glued. But what counts
    // as noise in a sermon is content in an interview or a phone recording —
    // a one-word "mhm" or "jasně" belongs to the other person, and dropping it
    // credits their speech to the first speaker. The app serves both, so
    // sherpa's defaults (0.3 and 0.5) stay as the compromise between genres.
    // Fragmentation is handled on our side instead, by smoothing short runs
    // of words.

    // Thread counts are set per model; this program has no shared
    // --num-threads flag.
    //
    // Automatic used to mean a flat four, on any machine. That is not a
    // neutral guess — measured on this binary with a ten-minute recording on
    // a two-core machine, four threads took 210 s against 88 s for two and
    // 120 s for one. Asking for more parallelism than the machine has does not
    // merely stop helping, it costs more than doing the work single-threaded.
    //
    // So automatic now means what the machine actually has. Going *beyond* the
    // core count is the part that was measured and is avoided; whether some
    // lower cap would be better on a very wide machine was not measured and is
    // therefore not invented here.
    let threads = if settings.threads > 0 {
        settings.threads
    } else {
        std::thread::available_parallelism()
            .map(|cores| cores.get() as i64)
            .unwrap_or(2)
    };
    if supports("--segmentation.num-threads") {
        cmd.arg(format!("--segmentation.num-threads={threads}"));
    }
    if supports("--embedding.num-threads") {
        cmd.arg(format!("--embedding.num-threads={threads}"));
    }
    cmd.arg(wav);

    // Read the output as it appears rather than waiting for the end.
    //
    // sherpa reports how far along it is on stderr ("progress 42.00%"), and
    // that is the only honest source of progress there is: the run takes
    // minutes on a long recording and nothing else says anything meanwhile.
    // With `output()` all of it arrived at once, after the fact, and the bar
    // stood still at whatever value we last guessed.
    //
    // stderr is consumed on a thread of its own. Both pipes have to be drained
    // in parallel — read only one and the other's buffer fills up, at which
    // point sherpa blocks on a write and neither side ever moves again.
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| UserMessage::new("diarization.launch_failed").detail(error))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    // Hand the child over so cancelling can actually kill it. Measured on this
    // binary, 45 minutes of audio is around 447 s of work; until now nothing
    // could stop it once it had started.
    task.record_process(recording_id, child);

    // This thread runs whether or not anyone wants progress, and that is the
    // whole point.
    //
    // Sherpa writes `progress 42.00%` to stderr for the length of the run. If
    // nothing drains that pipe, the operating system's buffer fills, sherpa
    // blocks on the write, and neither side ever moves again — the deadlock the
    // comment above the spawn warns about. Reporting is optional; draining is
    // not. A 45-minute recording produced enough output to hit exactly that,
    // while a 10-minute one still fit in the buffer and finished.
    let progress = report.map(|(app, id, from, to)| (app.clone(), id.to_string(), from, to));
    let reporter = std::thread::spawn(move || {
        let re = Regex::new(r"progress\s+([0-9]+(?:\.[0-9]+)?)\s*%").unwrap();
        let mut collected = String::new();
        let mut last = u32::MAX;
        for row in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some((app, id, from, to)) = progress.as_ref() {
                if let Some(c) = re.captures(&row) {
                    let done = (c[1].parse::<f64>().unwrap_or(0.0) / 100.0).clamp(0.0, 1.0);
                    let overall = (from + (to - from) * done).round() as u32;
                    if overall != last {
                        last = overall;
                        status(app, id, "diarization", overall, step("diarization.running"));
                    }
                }
            }
            collected.push_str(&row);
            collected.push('\n');
        }
        collected
    });

    let mut text = String::new();
    for row in BufReader::new(stdout).lines().map_while(Result::ok) {
        text.push_str(&row);
        text.push('\n');
    }
    if let Ok(errors) = reporter.join() {
        text.push_str(&errors);
    }
    // Nothing to wait for when cancellation has already killed and removed it.
    if let Some(mut child) = task.take_process(recording_id) {
        child.wait()?;
    }

    let re = Regex::new(r"([0-9]+\.[0-9]+)\s*--\s*([0-9]+\.[0-9]+)\s*(speaker_?\d+)").unwrap();
    let turns: Vec<SpeakerTurn> = re
        .captures_iter(&text)
        .filter_map(|c| {
            Some(SpeakerTurn {
                start: c[1].parse().ok()?,
                end: c[2].parse().ok()?,
                key: c[3].to_string(),
            })
        })
        .collect();

    if turns.is_empty() {
        // If the program printed its help instead of a result, it rejected
        // one of the flags. Say so plainly rather than leaving it to the dump.
        if text.contains("PrintUsage") || text.contains("Usage example") {
            return Err(UserMessage::new("diarization.options_rejected"));
        }
        return Err(UserMessage::new("diarization.no_turns")
            .with("output", text.chars().take(300).collect::<String>()));
    }
    Ok(turns)
}

/// Kolik reci musi uvnitr jedne vety pripadnout na druheho mluvciho, aby se
/// zmena povazovala za skutecne prevzeti slova a ne za nepresnou hranici.
///
/// Obe podminky plati zaroven. Samotny pocet slov nestaci: tri kratka slova
/// jsou pul vteriny, coz zadne prevzeti slova neni. A samotna delka nestaci
/// taky, protoze jedno slovo pred dlouhou pauzou muze mit vterinu a pul.
///
/// Pozor, tohle plati jen *uvnitr* vety. Jednoslovne pritakani v rozhovoru
/// nebo v telefonatu — „mhm“, „jasne“ — vraci Whisper jako samostatny usek,
/// a ten touhle cestou vubec neprochazi: useky kratsi nez dve slova dostanou
/// mluvciho prostym prekryvem a nikdo je nepohlti.
const MIN_TURN_SECONDS: f64 = 1.4;
const MIN_TURN_WORDS: usize = 3;

/// O kolik slov se smi hranice mluvcich posunout, aby padla na interpunkci.
///
/// Sherpa vraci cas, Whisper vraci slova, a obe hranice jsou nepresne radove
/// o desetiny vteriny — tedy prave o jedno dve slova. Kdyz uz se veta deli,
/// at se deli tam, kde ma stejne konec vetny celek.
const PUNCTUATION_SNAP: usize = 2;

/// Souvisle sledy slov jednoho mluvciho, jako dvojice prvni a posledni index.
fn speaker_runs(speakers: &[Option<String>]) -> Vec<(usize, usize)> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut i = 0usize;
    while i < speakers.len() {
        let mut j = i;
        while j + 1 < speakers.len() && speakers[j + 1] == speakers[i] {
            j += 1;
        }
        runs.push((i, j));
        i = j + 1;
    }
    runs
}

/// Konci slovo znamenkem, ktere uzavira vetu nebo vetny celek?
fn ends_clause(word: &str) -> bool {
    word.trim_end()
        .chars()
        .last()
        .map(|c| matches!(c, ',' | '.' | '!' | '?' | '…' | ';' | ':'))
        .unwrap_or(false)
}

/// Poradi mluvciho podle cisla v klici.
///
/// Textove razeni by dalo `speaker_1, speaker_10, speaker_2`, takze by
/// „Mluvci 2“ v prepisu byl ve skutecnosti desaty. Pri deleni po slovech
/// mluvcich pribyva, takze uz to neni jen teoreticka moznost.
fn order_key(key: &str) -> (i64, String) {
    let number = key
        .rsplit(|z: char| !z.is_ascii_digit())
        .next()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(i64::MAX);
    (number, key.to_string())
}

/// Mluvci, s nimz se dany casovy usek nejvic prekryva.
fn speaker_for(start: f64, end: f64, turns: &[SpeakerTurn]) -> Option<String> {
    let mut best: Option<(&str, f64)> = None;
    for u in turns {
        let prekryv = (end.min(u.end) - start.max(u.start)).max(0.0);
        if prekryv > 0.0 && best.map(|(_, p)| prekryv > p).unwrap_or(true) {
            best = Some((&u.key, prekryv));
        }
    }
    best.map(|(k, _)| k.to_string())
}

/// Assigns speakers to transcript segments — per word, not per whole sentence.
///
/// A whole sentence used to get one speaker, whoever it overlapped most. In a
/// sentence someone cuts into halfway through, that credited the second half
/// to the first speaker. Whisper gives us a time for every word, though, so
/// the speaker can be decided word by word and the sentence cut exactly where
/// the speech changes hands.
///
/// Returns a new list — there may be more segments than before.
fn assign_speakers(segments: Vec<Segment>, turns: &[SpeakerTurn]) -> Vec<Segment> {
    let mut output: Vec<Segment> = Vec::with_capacity(segments.len());

    for mut s in segments {
        // Without word timings, only the original per-sentence guess is left.
        let words: Vec<serde_json::Value> = s
            .words
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        if words.len() < 2 {
            s.speakers = speaker_for(s.start, s.end, turns);
            output.push(s);
            continue;
        }

        // Copy the sentence bounds out as plain numbers. Were the closures to
        // read them off `s`, they would hold a borrow on it and the segment
        // could then be neither modified nor moved into the result.
        let sentence_from = s.start;
        let sentence_to = s.end;
        let text_words = |i: usize| words[i]["s"].as_str().unwrap_or("").to_string();
        let time_words = |i: usize| words[i]["t"].as_f64().unwrap_or(sentence_from);

        // A word lasts until the next one starts; the last until the sentence ends.
        let mut speakers_by_word: Vec<Option<String>> = (0..words.len())
            .map(|i| {
                let from = time_words(i);
                let word_end = if i + 1 < words.len() {
                    time_words(i + 1)
                } else {
                    sentence_to
                };
                speaker_for(from, word_end.max(from), turns)
            })
            .collect();

        // Words in silence or outside any recognised span have nobody. They
        // inherit the previous speaker — speech continues until taken over.
        let mut last: Option<String> = None;
        for speaker in speakers_by_word.iter_mut() {
            match speaker {
                Some(key) => last = Some(key.clone()),
                None => *speaker = last.clone(),
            }
        }
        // And at the start of the sentence, backwards from the first known one.
        if speakers_by_word
            .first()
            .map(|speaker| speaker.is_none())
            .unwrap_or(false)
        {
            if let Some(first_speaker) = speakers_by_word.iter().flatten().next().cloned() {
                for speaker in speakers_by_word.iter_mut() {
                    if speaker.is_none() {
                        *speaker = Some(first_speaker.clone());
                    } else {
                        break;
                    }
                }
            }
        }

        let word_end = |i: usize| {
            if i + 1 < words.len() {
                time_words(i + 1)
            } else {
                sentence_to
            }
        };
        let run_seconds = |from: usize, to: usize| (word_end(to) - time_words(from)).max(0.0);
        let taken_over = |from: usize, to: usize| {
            run_seconds(from, to) >= MIN_TURN_SECONDS && to - from + 1 >= MIN_TURN_WORDS
        };

        // Smoothing. A change of speaker inside one sentence is believed only
        // when the newcomer holds the floor long enough to have actually taken
        // it. Anything shorter is an imprecise boundary and goes back to
        // whichever neighbour speaks more.
        //
        // One change is undone per pass, the least believable one first, and
        // the runs are rebuilt each time: absorbing an island joins the speech
        // on both sides of it, and the joined run may well clear the bar that
        // neither half cleared alone.
        for _ in 0..speakers_by_word.len() {
            let runs = speaker_runs(&speakers_by_word);
            if runs.len() < 2 {
                break;
            }
            let weakest = runs
                .iter()
                .copied()
                .enumerate()
                .filter(|&(_, (from, to))| !taken_over(from, to))
                .min_by(|&(_, (a, b)), &(_, (c, d))| {
                    run_seconds(a, b).total_cmp(&run_seconds(c, d))
                });
            let Some((index, (from, to))) = weakest else {
                break;
            };
            let before = index.checked_sub(1).map(|k| runs[k]);
            let after = runs.get(index + 1).copied();
            let host = match (before, after) {
                (Some(b), Some(a)) => {
                    if run_seconds(b.0, b.1) >= run_seconds(a.0, a.1) {
                        Some(b)
                    } else {
                        Some(a)
                    }
                }
                (Some(b), None) => Some(b),
                (None, Some(a)) => Some(a),
                (None, None) => None,
            };
            let Some(host) = host else {
                break;
            };
            let key = speakers_by_word[host.0].clone();
            for speaker in speakers_by_word.iter_mut().take(to + 1).skip(from) {
                *speaker = key.clone();
            }
        }

        // Whatever changes survived, put them where a clause ends.
        //
        // Sherpa returns a moment in time and Whisper returns words; both are
        // imprecise by roughly the length of one or two of them, which is why
        // the cut lands mid-phrase — `for 35 | years` — as often as not. The
        // handover is audible at the comma either way, so the boundary is
        // moved there when one is within reach.
        let runs = speaker_runs(&speakers_by_word);
        for pair in runs.windows(2) {
            let (left, right) = (pair[0], pair[1]);
            let boundary = left.1;
            if ends_clause(&text_words(boundary)) {
                continue;
            }
            let mut target = None;
            for step in 1..=PUNCTUATION_SNAP {
                // Neither side may be swallowed whole: this moves a boundary,
                // it does not undo a change the pass above chose to keep.
                if boundary >= step
                    && boundary - step >= left.0
                    && ends_clause(&text_words(boundary - step))
                {
                    target = Some(boundary - step);
                    break;
                }
                if boundary + step < right.1 && ends_clause(&text_words(boundary + step)) {
                    target = Some(boundary + step);
                    break;
                }
            }
            let Some(target) = target else { continue };
            // Read the two keys off the boundary itself. An earlier pair may
            // have moved its own boundary into this run's opening words, so
            // `left.0` no longer reliably holds this run's speaker.
            let (key, range) = if target < boundary {
                (
                    speakers_by_word[boundary + 1].clone(),
                    target + 1..=boundary,
                )
            } else {
                (speakers_by_word[boundary].clone(), boundary + 1..=target)
            };
            for index in range {
                speakers_by_word[index] = key.clone();
            }
        }

        // Boundaries between speakers inside the sentence.
        let mut cuts: Vec<usize> = Vec::new();
        for i in 0..speakers_by_word.len() - 1 {
            if speakers_by_word[i] != speakers_by_word[i + 1] {
                cuts.push(i);
            }
        }
        if cuts.is_empty() {
            s.speakers = speakers_by_word[0].clone();
            output.push(s);
            continue;
        }

        let mut from = 0usize;
        let mut order_offset = 0i64;
        for end_parts in cuts
            .into_iter()
            .chain(std::iter::once(speakers_by_word.len() - 1))
        {
            if end_parts < from {
                continue;
            }
            let chunks: Vec<String> = (from..=end_parts).map(text_words).collect();
            let text = chunks.join(" ").trim().to_string();
            if text.is_empty() {
                from = end_parts + 1;
                continue;
            }
            let start = time_words(from);
            let end = if end_parts + 1 < words.len() {
                time_words(end_parts + 1)
            } else {
                sentence_to
            };
            let word_data: Vec<serde_json::Value> = (from..=end_parts)
                .map(|i| serde_json::json!({ "t": time_words(i), "s": text_words(i) }))
                .collect();

            output.push(Segment {
                // The original identity goes to the first part that actually
                // materialises. Keying off the start index would lose it when
                // the opening piece comes out empty — and with it any
                // references to the segment, such as signed-off spots.
                id: if order_offset == 0 {
                    s.id.clone()
                } else {
                    uuid::Uuid::new_v4().to_string()
                },
                recording_id: s.recording_id.clone(),
                order: s.order * 1000 + order_offset,
                start,
                end: end.max(start),
                text,
                speakers: speakers_by_word[from].clone(),
                confidence: s.confidence,
                edited: s.edited,
                verified: s.verified,
                words: serde_json::to_string(&word_data).ok(),
                original: s.original.clone(),
            });
            order_offset += 1;
            from = end_parts + 1;
        }
    }

    for (i, s) in output.iter_mut().enumerate() {
        s.order = i as i64;
    }
    output
}

#[cfg(test)]
mod queue_tests {
    use super::*;

    #[test]
    fn the_second_recording_waits_for_the_first() {
        let task = TranscriptionTask::default();
        assert!(!task.enqueue("a"), "nobody is ahead of the first one");
        assert!(task.enqueue("b"), "the second one has somebody ahead of it");
        assert!(task.wait_for_turn("a"), "the front runs at once");
        task.leave_queue("a");
        assert!(task.wait_for_turn("b"), "and the next one follows it");
    }

    /// Proves the queue actually blocks: without it `b` would return
    /// immediately and the two runs would share the graphics card.
    #[test]
    fn a_waiting_worker_wakes_when_the_one_ahead_leaves() {
        use std::sync::mpsc;
        use std::time::Duration;

        let task = TranscriptionTask::default();
        task.enqueue("a");
        task.enqueue("b");
        let (sender, receiver) = mpsc::channel();
        let waiting = task.clone();
        let worker = std::thread::spawn(move || {
            let _ = sender.send(waiting.wait_for_turn("b"));
        });

        assert!(
            receiver.recv_timeout(Duration::from_millis(150)).is_err(),
            "b must still be waiting while a holds the front"
        );
        task.leave_queue("a");
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(2)).unwrap(),
            true,
            "leaving the queue wakes the next one"
        );
        worker.join().unwrap();
    }

    #[test]
    fn cancelling_a_waiting_recording_takes_it_out_of_the_queue() {
        let task = TranscriptionTask::default();
        task.enqueue("a");
        task.begin("a");
        task.enqueue("b");
        task.begin("b");

        task.cancel("b");
        assert!(
            !task.wait_for_turn("b"),
            "a cancelled waiting run is gone and must not start"
        );
        assert!(task.wait_for_turn("a"), "the front is untouched by it");
    }

    /// Cancelling the run that is *happening* must not remove it from the
    /// front: the next one would then start beside it rather than after it.
    #[test]
    fn cancelling_the_running_recording_leaves_it_at_the_front() {
        let task = TranscriptionTask::default();
        task.enqueue("a");
        task.begin("a");
        task.enqueue("b");
        task.begin("b");

        task.cancel("a");
        assert!(
            task.wait_for_turn("a"),
            "still the front until its worker ends"
        );
        task.leave_queue("a");
        assert!(task.wait_for_turn("b"));
    }
}

#[cfg(test)]
mod dictionary_tests {
    use super::*;

    fn entry(find: &str, replace: &str) -> db::DictionaryEntry {
        db::DictionaryEntry {
            id: "e".into(),
            find: find.into(),
            replace: replace.into(),
        }
    }

    fn spoken(text: &str) -> Segment {
        Segment {
            id: "s".into(),
            recording_id: "r".into(),
            order: 0,
            start: 0.0,
            end: 1.0,
            text: text.into(),
            speakers: None,
            confidence: None,
            edited: false,
            words: None,
            verified: false,
            original: None,
        }
    }

    /// The defect: `$` in a replacement is a capture-group reference to the
    /// regex crate, so the money the person typed was replaced by nothing.
    #[test]
    fn a_replacement_holding_a_dollar_keeps_it() {
        let mut segments = vec![spoken("stálo to pět set")];
        apply_dictionary(&mut segments, &[entry("pět set", "cena $5")]);
        assert_eq!(segments[0].text, "stálo to cena $5");
    }

    #[test]
    fn a_replacement_is_never_read_as_a_group_reference() {
        // `$1` would have expanded to the first capture group — here the whole
        // match — and written the error back over the correction.
        let mut segments = vec![spoken("součas DNA")];
        apply_dictionary(&mut segments, &[entry("součas", "$1")]);
        assert_eq!(segments[0].text, "$1 DNA");
    }

    #[test]
    fn an_ordinary_replacement_still_works() {
        let mut segments = vec![spoken("součas DNA svého života")];
        apply_dictionary(&mut segments, &[entry("součas", "součást")]);
        assert_eq!(segments[0].text, "součást DNA svého života");
    }

    #[test]
    fn the_word_timings_are_corrected_with_the_same_rule() {
        let mut segment = spoken("cena pět set");
        segment.words = Some(r#"[{"s":"cena","t":0.0},{"s":"pět set","t":0.5}]"#.into());
        let mut segments = vec![segment];
        apply_dictionary(&mut segments, &[entry("pět set", "$500")]);
        let words: Vec<serde_json::Value> =
            serde_json::from_str(segments[0].words.as_deref().unwrap()).unwrap();
        assert_eq!(words[1]["s"].as_str(), Some("$500"));
    }
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
            text: words
                .iter()
                .map(|(s, _)| *s)
                .collect::<Vec<_>>()
                .join(" "),
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            original: None,
            words: Some(serde_json::to_string(&list).unwrap()),
        }
    }

    fn first_word_time(segment: &Segment) -> f64 {
        let list: Vec<serde_json::Value> =
            serde_json::from_str(segment.words.as_ref().unwrap()).unwrap();
        list[0]["t"].as_f64().unwrap()
    }

    #[test]
    fn silence_is_skipped_and_the_onset_is_found() {
        let env = onset::envelope(&silence_then_sound(0.75, 2.0), RATE);
        let found = onset::first_audible(&env, 0.52, 2.0).expect("there is sound in this stretch");
        assert!(
            (found - 0.76).abs() <= 0.02,
            "expected the onset at about 0.76 s, got {found}"
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
            (segments[0].start - 0.76).abs() <= 0.02,
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
            (found - 0.76).abs() <= 0.02,
            "expected the onset at about 0.76 s, got {found}"
        );
    }
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;

    /// The defect: pressing Zrušit while ffmpeg was converting found no child,
    /// answered "nothing is running", and cleared the request it had just made.
    #[test]
    fn cancelling_between_programs_still_stops_the_run() {
        let task = TranscriptionTask::default();
        task.begin("a");
        assert!(
            task.cancel("a"),
            "a worker is running, so there is something to cancel"
        );
        assert!(task.was_cancelled("a"), "the request must survive the call");
        assert!(stop_if_cancelled(&task, "a").is_err());
    }

    #[test]
    fn a_run_that_has_already_finished_reports_nothing_to_cancel() {
        let task = TranscriptionTask::default();
        task.begin("a");
        task.cleanup("a");
        assert!(!task.cancel("a"));
    }

    #[test]
    fn a_new_run_does_not_inherit_the_previous_cancellation() {
        let task = TranscriptionTask::default();
        task.begin("a");
        task.cancel("a");
        task.cleanup("a");
        task.begin("a");
        assert!(!task.was_cancelled("a"));
        assert!(stop_if_cancelled(&task, "a").is_ok());
    }

    /// One recording runs several programs in turn. Storing one handle per
    /// recording dropped the previous `Child` without killing it, which is how
    /// an orphaned whisper could keep writing while a second one started.
    #[test]
    fn every_program_of_a_run_is_kept_not_only_the_last() {
        let task = TranscriptionTask::default();
        let spawn = || {
            std::process::Command::new(std::env::current_exe().unwrap())
                .arg("--list")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        };
        task.record_process("a", spawn());
        task.record_process("a", spawn());
        for _ in 0..2 {
            let mut child = task.take_process("a").expect("both children are kept");
            let _ = child.wait();
        }
        assert!(task.take_process("a").is_none());

        task.begin("a");
        task.record_process("a", spawn());
        assert!(task.cancel("a"));
        assert!(
            task.take_process("a").is_none(),
            "cancelling kills and removes whatever was running"
        );
    }

    /// Closing the window during a transcription used to leave the program
    /// running. Nothing asked it to stop: `Child` does not kill on `Drop` and
    /// the worker thread is detached.
    ///
    /// The death is observed rather than inferred. The child's stdout pipe is
    /// held open for as long as the child lives, so reading it to EOF is the
    /// question "is it gone?" — and it is asked on another thread with a
    /// timeout, because a test that hangs when it regresses is worse than no
    /// test at all. An earlier version of this test asserted only on counts
    /// and passed against a `kill_all` that merely forgot the children.
    #[test]
    fn closing_the_window_kills_what_is_still_running() {
        use std::io::Read;

        let task = TranscriptionTask::default();
        let spawn = || {
            let mut program = std::process::Command::new(std::env::current_exe().unwrap());
            program.args([
                "--exact",
                "transcription::cancellation_tests::stands_in_for_a_long_program",
                "--ignored",
                "--test-threads=1",
            ]);
            let mut child = program
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            let pipe = child.stdout.take().unwrap();
            (child, pipe)
        };
        let (first, first_pipe) = spawn();
        let (second, second_pipe) = spawn();
        task.record_process("a", first);
        task.record_process("b", second);

        let (tell, hear) = std::sync::mpsc::channel();
        for pipe in [first_pipe, second_pipe] {
            let tell = tell.clone();
            std::thread::spawn(move || {
                let mut pipe = pipe;
                let mut sink = Vec::new();
                // Returns when the write end closes, which happens when the
                // process ends and not before.
                let _ = pipe.read_to_end(&mut sink);
                let _ = tell.send(());
            });
        }

        let killed = task.kill_all();
        assert_eq!(killed, 2, "both programs were running and both had to go");

        // The stand-in sleeps for 30 seconds. Five is far past a kill and far
        // short of it finishing on its own.
        for which in 0..2 {
            hear.recv_timeout(std::time::Duration::from_secs(5))
                .unwrap_or_else(|_| panic!("program {which} was still running after kill_all"));
        }

        assert!(
            task.take_process("a").is_none() && task.take_process("b").is_none(),
            "nothing is left behind to be killed twice"
        );
        assert_eq!(task.kill_all(), 0);
    }

    /// Not a test. It is a stand-in for a long program — ffmpeg encoding a
    /// 34-minute MP3 — spawned by the test below, which then kills it. The
    /// test binary is the one program certain to exist on every platform this
    /// is built for.
    #[test]
    #[ignore = "spawned by cancelling_a_preparation_program_kills_it"]
    fn stands_in_for_a_long_program() {
        std::thread::sleep(std::time::Duration::from_secs(30));
    }

    /// `Zrušit` during `Připravuji přesné přehrávání` did nothing: the
    /// preparation programs were run with `Command::output`, which hands the
    /// child to nobody, so there was nothing to kill and the encode ran on.
    #[test]
    fn cancelling_a_preparation_program_kills_it() {
        let task = TranscriptionTask::default();
        task.begin("a");

        let mut program = std::process::Command::new(std::env::current_exe().unwrap());
        program.args([
            "--exact",
            "transcription::cancellation_tests::stands_in_for_a_long_program",
            "--ignored",
            "--test-threads=1",
        ]);

        let running = task.clone();
        let worker = std::thread::spawn(move || {
            use crate::tools::CommandRunner;
            JobRunner {
                task: &running,
                recording_id: "a",
            }
            .run(program)
        });

        // Wait for the child to be registered rather than guessing at a delay:
        // killing before the spawn would prove nothing.
        let started = std::time::Instant::now();
        while task
            .processes
            .lock()
            .unwrap()
            .get("a")
            .is_none_or(Vec::is_empty)
        {
            assert!(
                started.elapsed().as_secs() < 10,
                "the stand-in never started"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        assert!(task.cancel("a"));
        let outcome = worker.join().expect("the runner thread does not panic");
        assert!(
            matches!(outcome, Ok(None)),
            "a killed program reports that it was killed, not an exit code"
        );
        assert!(
            started.elapsed().as_secs() < 25,
            "it stopped when it was told, not when it would have finished on its own"
        );
    }
}

#[cfg(test)]
mod speaker_assignment_tests {
    use super::*;

    fn turn(start: f64, end: f64, key: &str) -> SpeakerTurn {
        SpeakerTurn {
            start,
            end,
            key: key.to_string(),
        }
    }

    /// One word per second, the sentence ending one second after the last.
    fn spoken(id: &str, words: &[&str]) -> Segment {
        let word_data: Vec<serde_json::Value> = words
            .iter()
            .enumerate()
            .map(|(index, text)| serde_json::json!({ "t": index as f64, "s": text }))
            .collect();
        Segment {
            id: id.to_string(),
            recording_id: "recording".to_string(),
            order: 0,
            start: 0.0,
            end: words.len() as f64,
            text: words.join(" "),
            speakers: None,
            confidence: Some(0.9),
            edited: false,
            verified: false,
            words: serde_json::to_string(&word_data).ok(),
            original: None,
        }
    }

    /// The reported defect: two words in the middle of a sentence fell to the
    /// other speaker and became a turn of their own, so one sentence left the
    /// pipeline as three. Two words is well under the second and a half it
    /// takes to claim the floor and give it back.
    #[test]
    fn a_two_word_island_does_not_break_the_sentence() {
        let input = spoken(
            "one",
            &[
                "Nepotřebují",
                "další",
                "obsah,",
                "potřebují",
                "obsah",
                "proti",
                "očekávání",
                "a",
                "to",
                "vytváří",
                "novou",
                "cestu",
            ],
        );
        let turns = vec![
            turn(0.0, 7.0, "speaker_0"),
            turn(7.0, 8.6, "speaker_1"),
            turn(8.6, 12.0, "speaker_0"),
        ];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(
            output.len(),
            1,
            "a two-word island must not split a sentence"
        );
        assert_eq!(output[0].speakers.as_deref(), Some("speaker_0"));
        assert_eq!(
            output[0].text,
            "Nepotřebují další obsah, potřebují obsah proti očekávání a to vytváří novou cestu"
        );
    }

    /// The other half of the same rule: someone who really does take the floor
    /// still gets their own segment.
    #[test]
    fn a_real_handover_still_splits_the_sentence() {
        let input = spoken(
            "one",
            &[
                "tak", "co", "chceš", "udělat", "je", "míň", "obsahu", "a", "přidat", "otázky",
                "tam",
            ],
        );
        let turns = vec![
            turn(0.0, 4.0, "speaker_0"),
            turn(4.0, 8.0, "speaker_1"),
            turn(8.0, 11.0, "speaker_0"),
        ];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(output.len(), 3);
        assert_eq!(output[0].speakers.as_deref(), Some("speaker_0"));
        assert_eq!(output[1].speakers.as_deref(), Some("speaker_1"));
        assert_eq!(output[1].text, "je míň obsahu a");
        assert_eq!(output[2].speakers.as_deref(), Some("speaker_0"));
    }

    /// The reported `for 35 | years` break: the change is real, its position is
    /// off by a word, and a clause ends within reach.
    #[test]
    fn a_surviving_cut_moves_to_the_end_of_the_clause() {
        let input = spoken(
            "one",
            &[
                "Byl",
                "jsem",
                "kazatelem",
                "pětatřicet",
                "let,",
                "z",
                "toho",
                "pětadvacet",
                "ve",
                "vlastním",
                "sboru.",
            ],
        );
        let turns = vec![turn(0.0, 4.0, "speaker_0"), turn(4.0, 11.0, "speaker_1")];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(output.len(), 2);
        assert_eq!(
            output[0].text, "Byl jsem kazatelem pětatřicet let,",
            "the cut belongs after the comma, not between the number and its noun"
        );
        assert_eq!(output[1].text, "z toho pětadvacet ve vlastním sboru.");
    }

    /// A short reply Whisper returned as its own segment never reaches the
    /// smoothing above, and must keep the speaker it overlaps.
    #[test]
    fn a_standalone_short_reply_keeps_its_own_speaker() {
        let input = spoken("one", &["Jasně."]);
        let turns = vec![turn(0.0, 0.4, "speaker_0"), turn(0.4, 1.0, "speaker_1")];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].speakers.as_deref(), Some("speaker_1"));
    }
}
