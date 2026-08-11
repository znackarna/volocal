//! Copies of the archive, the watched folder, and portable copies.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::{db, tools, transcription};
use crate::{reported, AppState, Reported, WaveformJob};
use serde::Serialize;
use tauri::State;
// ---------------------------------------------------------------- backups

#[derive(Serialize)]
pub(crate) struct BackupStatus {
    /// Newest backup, formatted for display. Empty when there is none yet.
    latest: String,
    count: usize,
    directory: String,
}

#[tauri::command]
pub fn backup_status(app: State<'_, AppState>) -> BackupStatus {
    let backups = db::list_backups(&app.db_path);
    let latest = backups
        .first()
        .and_then(|p| p.metadata().ok())
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let when: chrono::DateTime<chrono::Local> = t.into();
            when.format("%-d. %-m. %Y %H:%M").to_string()
        })
        .unwrap_or_default();
    BackupStatus {
        latest,
        count: backups.len(),
        directory: db::backup_directory(&app.db_path)
            .to_string_lossy()
            .to_string(),
    }
}

/// Backs the archive up right now and reports where it landed.
///
/// This one does hold the lock: the user asked for it and is watching, so
/// waiting is the honest behaviour — unlike the automatic backup at startup,
/// which nobody asked for and must not get in the way.
#[tauri::command]
pub fn back_up_now(app: State<'_, AppState>) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let written = reported(db::back_up_and_rotate(&db, &app.db_path))?;
    Ok(written.to_string_lossy().to_string())
}

/// Waveform for the player. Read from the database; when it is not there
/// yet, it is computed in the background and the window comes back for it.
#[derive(Serialize)]
pub(crate) struct Waveform {
    /// hodnoty 0–255
    points: Vec<u8>,
    /// how many values fall on one second of audio
    points_per_second: f64,
    /// Frequency-band values laid out as frame-major bytes.
    equalizer: Vec<u8>,
    equalizer_points_per_second: f64,
    equalizer_band_count: usize,
    /// Not ready yet, but being computed. The window should ask again shortly.
    is_calculating: bool,
}

impl Waveform {
    fn from_data(data: db::WaveformData, is_calculating: bool) -> Self {
        Waveform {
            points: data.points,
            points_per_second: data.points_per_second,
            equalizer: data.equalizer,
            equalizer_points_per_second: data.equalizer_points_per_second,
            equalizer_band_count: data.equalizer_band_count,
            is_calculating,
        }
    }
}

/// This command never waits for ffmpeg.
///
/// It used to compute a missing waveform inline. That was fine while only the
/// player asked for it, after pressing play. Once the detail screen started
/// requesting it on open, every new recording meant several seconds of waiting
/// for ffmpeg to scan the whole file — and opening a transcript, previously
/// instant, began to stall. Now it is computed aside and the window returns
/// for the result.
#[tauri::command]
pub fn recording_waveform(app: State<'_, AppState>, id: String) -> Reported<Waveform> {
    let (recording, settings, cached) = {
        let db = app.db.lock().unwrap();
        let cached = db::waveform(&db, &id).unwrap_or_default();
        if !cached.points.is_empty() && !cached.equalizer.is_empty() {
            return Ok(Waveform::from_data(cached, false));
        }
        (
            reported(db::recording(&db, &id))?,
            reported(db::load_settings(&db))?,
            cached,
        )
    };

    // Opening the same recording twice must not start another ffmpeg.
    let Some(job) = WaveformJob::claim(&id) else {
        return Ok(Waveform::from_data(cached, true));
    };

    let Some(ffmpeg) = tools::check(&settings).ffmpeg else {
        return Ok(Waveform::from_data(cached, false));
    };

    let (points_per_second, count) = transcription::waveform_density(recording.duration);
    let db_path = app.db_path.clone();
    let response = Waveform::from_data(cached.clone(), true);
    std::thread::spawn(move || {
        // Moved in, so the place is given back whichever way this thread ends.
        let _job = job;
        let mut data = cached;
        if data.points.is_empty() {
            data.points = tools::waveform_amplitude(
                std::path::Path::new(&ffmpeg),
                std::path::Path::new(&recording.path),
                count,
            )
            .unwrap_or_default();
            data.points_per_second = points_per_second;
        }
        if data.equalizer.is_empty() {
            data.equalizer = tools::equalizer_peaks(
                std::path::Path::new(&ffmpeg),
                std::path::Path::new(&recording.path),
                transcription::EQUALIZER_BAND_COUNT,
                transcription::EQUALIZER_POINTS_PER_SECOND,
            )
            .unwrap_or_default();
            data.equalizer_points_per_second = transcription::EQUALIZER_POINTS_PER_SECOND as f64;
            data.equalizer_band_count = transcription::EQUALIZER_BAND_COUNT;
        }

        if !data.points.is_empty() || !data.equalizer.is_empty() {
            // Use a separate connection so analysis never blocks UI database
            // operations.
            if let Ok(connection) = db::open(&db_path) {
                let _ = db::save_waveform(&connection, &recording.id, &data);
            }
        }
    });

    Ok(response)
}

/// Runs the dictionary over a finished transcript. Returns the change count.
#[tauri::command]
pub fn apply_dictionary(app: State<'_, AppState>, id: String) -> Reported<usize> {
    let db = app.db.lock().unwrap();
    reported(transcription::apply_dictionary_to_recording(&db, &id))
}

#[tauri::command]
pub fn mark_verified(app: State<'_, AppState>, id: String, verified: bool) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::mark_verified(&db, &id, verified))
}

#[tauri::command]
pub fn set_segment_speaker(
    app: State<'_, AppState>,
    id: String,
    speakers: Option<String>,
) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::set_segment_speaker(&db, &id, speakers.as_deref()))
}

#[tauri::command]
pub fn rename_speaker(
    app: State<'_, AppState>,
    recording_id: String,
    key: String,
    name: String,
) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::rename_speaker(&db, &recording_id, &key, &name))
}

/// A voice the machine never found.
///
/// Naming two groups the same thing joins them, which is the only correction
/// the panel has ever had. This is the other direction: a passage credited to
/// the wrong person, where the right person has no group at all because the
/// clustering folded them into somebody else. Without it there is nothing to
/// hand such a block to.
///
/// The name is written here rather than passed in, exactly as the one after
/// diarization is: it is stored data that the reader immediately renames, not
/// interface text.
#[tauri::command]
pub fn add_speaker(app: State<'_, AppState>, recording_id: String) -> Reported<db::Speaker> {
    let db = app.db.lock().unwrap();
    let existing = reported(db::speakers(&db, &recording_id))?;
    // Past the end, then past anything already taken — a merge can leave a
    // gap in the numbering, and reusing a key would silently join two people.
    let mut number = existing.len();
    let key = loop {
        let candidate = format!("speaker_{number}");
        if !existing.iter().any(|s| s.key == candidate) {
            break candidate;
        }
        number += 1;
    };
    let speaker = db::Speaker {
        key,
        recording_id,
        name: format!("Mluvčí {}", existing.len() + 1),
        color: db::COLORS[existing.len() % db::COLORS.len()].to_string(),
    };
    reported(db::insert_speaker(&db, &speaker))?;
    Ok(speaker)
}

/// Takes a speaker off the list.
///
/// The panel could add people and join them, and undo neither. A speaker added
/// by a slip of the hand — and it is one click away in the transcript's own
/// menu — stayed in the list for good, and a group the clustering invented out
/// of a cough could only be got rid of by merging it into somebody it was not.
///
/// What was said is not touched: those blocks lose the name and nothing else,
/// which is where anything diarization could not place already is.
#[tauri::command]
pub fn delete_speaker(app: State<'_, AppState>, recording_id: String, key: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_speaker(&db, &recording_id, &key))
}

#[tauri::command]
pub fn merge_speakers(
    app: State<'_, AppState>,
    recording_id: String,
    from_key: String,
    to_key: String,
) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::merge_speakers(&db, &recording_id, &from_key, &to_key))
}
