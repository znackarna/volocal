//! One transcript: its segments, the waveform, and playback.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::db::{Recording, RecordingNote, Segment, Speaker};
use crate::user_message::UserMessage;
use crate::{db, tools};
use crate::{reported, AppState, Reported};
use serde::Serialize;
use tauri::State;
// ---------------------------------------------------------------- detail

#[derive(Serialize)]
pub(crate) struct Detail {
    recording: Recording,
    segments: Vec<Segment>,
    speakers: Vec<Speaker>,
    notes: Vec<RecordingNote>,
}

#[tauri::command]
pub fn detail(app: State<'_, AppState>, id: String) -> Reported<Detail> {
    let db = app.db.lock().unwrap();
    Ok(Detail {
        recording: reported(db::recording(&db, &id))?,
        segments: reported(db::segments(&db, &id))?,
        speakers: reported(db::speakers(&db, &id))?,
        notes: reported(db::recording_notes(&db, &id))?,
    })
}

/// A note may sit anywhere in the recording or nowhere at all, but never at a
/// position that does not exist.
pub(crate) fn check_note_time(time: Option<f64>) -> Reported<()> {
    match time {
        Some(seconds) if !seconds.is_finite() || seconds < 0.0 => {
            Err(UserMessage::new("note.invalid_time"))
        }
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn add_recording_note(
    app: State<'_, AppState>,
    recording_id: String,
    time: Option<f64>,
    text: String,
) -> Reported<RecordingNote> {
    let text = text.trim();
    if text.is_empty() {
        return Err(UserMessage::new("note.empty"));
    }
    check_note_time(time)?;
    let note = RecordingNote {
        id: uuid::Uuid::new_v4().to_string(),
        recording_id,
        time,
        text: text.to_string(),
        done: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let db = app.db.lock().unwrap();
    reported(db::insert_recording_note(&db, &note))?;
    Ok(note)
}

#[tauri::command]
pub fn update_recording_note(
    app: State<'_, AppState>,
    id: String,
    time: Option<f64>,
    text: String,
    done: bool,
) -> Reported<()> {
    let text = text.trim();
    if text.is_empty() {
        return Err(UserMessage::new("note.empty"));
    }
    check_note_time(time)?;
    let db = app.db.lock().unwrap();
    reported(db::update_recording_note(&db, &id, time, text, done))
}

#[tauri::command]
pub fn delete_recording_note(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_recording_note(&db, &id))
}

#[tauri::command]
pub fn update_segment(app: State<'_, AppState>, id: String, text: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::update_segment(&db, &id, &text))
}

/// Is the source file still where it was? The transcript lives in the
/// database, so the recording can be deleted — it just cannot be played then.
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// A media source with an accurate timeline for word-level seeking.
///
/// Long VBR MP3 files are converted once to a cached M4A. This command is
/// asynchronous because encoding must never block Tauri's UI/IPC thread.
#[tauri::command]
pub async fn playback_source(app: State<'_, AppState>, id: String) -> Reported<String> {
    let (recording, settings, db_path) = {
        let db = app.db.lock().unwrap();
        (
            reported(db::recording(&db, &id))?,
            reported(db::load_settings(&db))?,
            app.db_path.clone(),
        )
    };

    let source = std::path::PathBuf::from(&recording.path);

    /* The source is gone, but its playback proxy may still be sitting in the
    cache. Play that rather than reporting nothing.
    This is a rescue, not a promise, and the difference matters: the proxy
    exists only for MP3 sources and is a second-generation lossy encode, so
    it can never be the guarantee that audio survives. `copy_imports` is
    that guarantee. Do not let this become the reason not to build it. */
    if !source.exists() {
        if let Some(proxy) = tools::existing_playback_proxy(&db_path, &recording.id) {
            crate::note!(
                "playback: source missing, using cached proxy for {}",
                recording.id
            );
            return Ok(proxy.to_string_lossy().to_string());
        }
        return Ok(recording.path);
    }

    let is_mp3 = source
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"));
    if !is_mp3 {
        return Ok(recording.path);
    }

    let ffmpeg = tools::check(&settings)
        .ffmpeg
        .ok_or_else(|| UserMessage::new("playback.ffmpeg_missing"))?;
    let recording_id = recording.id;
    let proxy = tauri::async_runtime::spawn_blocking(move || {
        tools::ensure_seekable_playback(
            std::path::Path::new(&ffmpeg),
            &db_path,
            &recording_id,
            &source,
            // Nothing owns this one: it is prepared on demand when a finished
            // transcript is opened, and there is no job to cancel.
            &tools::PlainRunner,
        )
    })
    .await
    .map_err(|error| UserMessage::new("playback.preparation_interrupted").detail(error))?;
    proxy.map(|path| path.to_string_lossy().to_string())
}

/// Repoints a recording at a different file, in case it has moved.
#[tauri::command]
pub fn change_recording_path(app: State<'_, AppState>, id: String, path: String) -> Reported<()> {
    if !std::path::Path::new(&path).is_file() {
        return Err(UserMessage::new("recording.path_not_found"));
    }
    let db = app.db.lock().unwrap();
    let settings = reported(db::load_settings(&db))?;
    let duration = tools::check(&settings)
        .ffprobe
        .and_then(|p| {
            tools::audio_duration(std::path::Path::new(&p), std::path::Path::new(&path)).ok()
        })
        .unwrap_or(0.0);
    reported(db::set_path(&db, &id, &path, duration))?;
    drop(db);
    tools::remove_playback_proxies(&app.db_path, &id);
    Ok(())
}
