//! Folders in the archive, and what moving a recording into one means.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::user_message::UserMessage;
use crate::{db, tools, transcription};
use crate::{reported, AppState, Reported};
use tauri::State;
// ---------------------------------------------------------------- folders

#[tauri::command]
pub fn folders(app: State<'_, AppState>) -> Reported<Vec<db::Folder>> {
    let db = app.db.lock().unwrap();
    reported(db::folders(&db))
}

#[tauri::command]
pub fn create_folder(app: State<'_, AppState>, name: String) -> Reported<db::Folder> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(UserMessage::new("folder.empty_name"));
    }
    let db = app.db.lock().unwrap();
    // Two folders with one name would be indistinguishable on the card.
    if reported(db::folders(&db))?
        .iter()
        .any(|folder| folder.name.to_lowercase() == name.to_lowercase())
    {
        return Err(UserMessage::new("folder.duplicate_name"));
    }
    reported(db::create_folder(&db, &name))
}

#[tauri::command]
pub fn rename_folder(app: State<'_, AppState>, id: String, name: String) -> Reported<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(UserMessage::new("folder.empty_name"));
    }
    let db = app.db.lock().unwrap();
    if reported(db::folders(&db))?
        .iter()
        .any(|folder| folder.id != id && folder.name.to_lowercase() == name.to_lowercase())
    {
        return Err(UserMessage::new("folder.duplicate_name"));
    }
    reported(db::rename_folder(&db, &id, &name))
}

/// `folder` of `None` takes the recordings back to the archive's root.
#[tauri::command]
pub fn move_to_folder(
    app: State<'_, AppState>,
    ids: Vec<String>,
    folder: Option<String>,
) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::move_to_folder(&db, &ids, folder.as_deref()))
}

/// With `contents` the recordings inside go too — the transcripts are lost,
/// the audio files on disk are not, exactly as removing one recording does.
/// Without it they return to the archive's root.
#[tauri::command]
pub fn delete_folder(app: State<'_, AppState>, id: String, contents: bool) -> Reported<()> {
    let ids = {
        // One lock over both steps, and the contents are read inside the
        // transaction that deletes them. Taking the lock twice left a window in
        // which a recording could be moved into the folder after the list was
        // read: it would then survive into the archive's root rather than being
        // deleted with the folder, which is the milder half of the wrong two
        // outcomes but still not what the person asked for.
        let db = app.db.lock().unwrap();
        // One transaction over the whole errand. Giving up in the middle of
        // the loop used to leave some recordings deleted, the rest in a folder
        // that was about to go, and nothing said about either.
        let tx = reported(db.unchecked_transaction().map_err(anyhow::Error::from))?;
        let ids = if contents {
            reported(db::folder_recording_ids(&tx, &id))?
        } else {
            Vec::new()
        };
        for recording in &ids {
            reported(db::delete_recording(&tx, recording))?;
        }
        reported(db::delete_folder(&tx, &id))?;
        reported(tx.commit().map_err(anyhow::Error::from))?;
        ids
    };
    // Outside the lock: each removal has its own playback proxies to clear.
    for recording in &ids {
        tools::remove_playback_proxies(&app.db_path, recording);
    }
    Ok(())
}

/// Formats that hold audio and nothing else. A source already in one of them
/// can be handed over as it is; anything else — every video container — has
/// to have its audio taken out, or `Uložit zvuk` would produce a video.
pub(crate) const AUDIO_ONLY_FORMATS: [&str; 8] =
    ["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "wma"];

/// Hand a recording's audio over in a format that opens anywhere. Microphone
/// takes and downloaded media live inside the application's data directory,
/// which nobody should have to go digging for.
///
/// The destination's own extension says which format to write. When it
/// already matches an audio-only source the file is copied verbatim —
/// re-encoding lossy audio into the same shape only shaves quality off it for
/// nothing, and a copy needs no ffmpeg at all. Otherwise ffmpeg writes the
/// requested format with `-vn`, so a video source yields audio.
///
/// `async`, because converting an hour of audio takes seconds and the window
/// must not stop for it. `destination` is taken as it arrives, deliberately —
/// see the note above `validate_watch_candidate`.
#[tauri::command(async)]
pub fn export_audio(app: State<'_, AppState>, id: String, destination: String) -> Reported<()> {
    let (source, settings) = {
        let db = app.db.lock().unwrap();
        (
            reported(db::recording(&db, &id))?.path,
            reported(db::load_settings(&db))?,
        )
    };
    let source = std::path::Path::new(&source);
    if !source.exists() {
        return Err(UserMessage::new("audio_export.source_missing"));
    }
    let target = std::path::Path::new(&destination);
    /* **Not onto itself.** Both branches below would destroy the recording:
    `fs::copy` truncates the destination before reading the source, and
    ffmpeg's `-y` opens the output for writing over the input it is reading.
    Either way the audio is gone and the archive still points at the path.

    The picker makes this easy rather than exotic — a recording the archive
    holds a copy of already lives in the recordings folder, which is where
    the save dialog opens. `points_at_the_same_file` is the same comparison
    `restore_backup` makes before overwriting an archive, and it is here for
    the same reason: a file dialog cannot be relied on to refuse. */
    if crate::commands::backups::points_at_the_same_file(source, target) {
        return Err(UserMessage::new("audio_export.same_file"));
    }
    let extension = |path: &std::path::Path| {
        path.extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    };
    let wanted = extension(target);
    let have = extension(source);

    if wanted == have && AUDIO_ONLY_FORMATS.contains(&wanted.as_str()) {
        std::fs::copy(source, target)
            .map_err(|error| UserMessage::new("audio_export.failed").detail(error.to_string()))?;
        return Ok(());
    }

    let codec: &[&str] = match wanted.as_str() {
        // VBR around 190 kb/s: transparent for speech and small enough to send.
        "mp3" => &["-c:a", "libmp3lame", "-q:a", "2"],
        "m4a" | "aac" => &["-c:a", "aac", "-b:a", "192k"],
        "wav" => &["-c:a", "pcm_s16le"],
        _ => return Err(UserMessage::new("audio_export.unsupported_format")),
    };

    let ffmpeg = tools::check(&settings)
        .ffmpeg
        .ok_or_else(|| UserMessage::new("audio_export.ffmpeg_missing"))?;
    let result = tools::command(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(source)
        // Audio only. Without this a video source would be copied through
        // with its picture, which is not what the action promises.
        .arg("-vn")
        .args(codec)
        .arg(target)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|error| UserMessage::new("audio_export.failed").detail(error.to_string()))?;
    if !result.status.success() {
        return Err(UserMessage::new("audio_export.failed")
            .detail(String::from_utf8_lossy(&result.stderr).trim()));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_recording(app: State<'_, AppState>, id: String) -> Reported<()> {
    {
        let db = app.db.lock().unwrap();
        reported(db::delete_recording(&db, &id))?;
    }
    tools::remove_playback_proxies(&app.db_path, &id);
    Ok(())
}

/// Whether another worker already holds this recording.
///
/// Two sources, and neither alone is enough. The registry knows from the
/// instant a run is started, including one still waiting in the queue — and a
/// queued run has not touched the row yet, which is how a transcription could
/// be started beside a speaker recognition standing in line. The row in turn
/// outlives the process, so it is what catches a run interrupted by a crash
/// before `recover_interrupted` has had its say.
pub(crate) fn recording_is_busy(running: bool, status: &str) -> bool {
    running || status == db::status::TRANSCRIBING
}

#[tauri::command]
pub fn start_transcription(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    speaker_count: Option<i64>,
) -> Reported<()> {
    // Starting the same transcription twice would write the segments twice.
    {
        let running = app.bezici.is_running(&id);
        let db = app.db.lock().unwrap();
        let n = reported(db::recording(&db, &id))?;
        if recording_is_busy(running, &n.status) {
            return Err(UserMessage::new("transcription.still_running"));
        }
        reported(db::set_status(&db, &id, db::status::TRANSCRIBING, None))?;
    }
    transcription::start_in_thread(
        window,
        app.db_path.clone(),
        id,
        app.bezici.clone(),
        speaker_count,
    );
    Ok(())
}

/// Transcribes a recording in a given language. "auto" leaves it to detection.
#[tauri::command]
pub fn transcribe_in_language(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    language: String,
    speaker_count: Option<i64>,
) -> Reported<()> {
    {
        let running = app.bezici.is_running(&id);
        let db = app.db.lock().unwrap();
        let n = reported(db::recording(&db, &id))?;
        if recording_is_busy(running, &n.status) {
            return Err(UserMessage::new("transcription.still_running"));
        }
        reported(db::set_language_choice(&db, &id, &language))?;
        reported(db::set_status(&db, &id, db::status::TRANSCRIBING, None))?;
    }
    transcription::start_in_thread(
        window,
        app.db_path.clone(),
        id,
        app.bezici.clone(),
        speaker_count,
    );
    Ok(())
}

/// Stops a running transcription or speaker recognition.
///
/// `cancel` answers whether a worker is running, not whether a program happens
/// to be spawned at this instant. Between the stages of a run — converting
/// audio, preparing playback, saving — there is no child to kill, and the old
/// answer in that window was "nothing is running", which then threw away the
/// cancellation the user had just asked for.
#[tauri::command]
pub fn cancel_transcription(app: State<'_, AppState>, id: String) -> Reported<()> {
    if !app.bezici.cancel(&id) {
        // Nothing is running: the work finished between the click and this
        // call. Clear the flag, or the next transcription of this recording
        // would abort itself, and tidy up a status left behind by a crash.
        app.bezici.forget_cancellation(&id);
        let db = app.db.lock().unwrap();
        if let Ok(recording) = db::recording(&db, &id) {
            if recording.status == db::status::TRANSCRIBING {
                reported(db::set_status(&db, &id, db::status::NEW, None))?;
            }
        }
    }
    Ok(())
}

/// Discards a finished transcript but keeps the recording in the archive.
#[tauri::command]
pub fn delete_transcription(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_segments(&db, &id))?;
    reported(db::delete_speakers(&db, &id))?;
    reported(db::set_status(&db, &id, db::status::NEW, None))
}

/// Renames a recording in the archive; the default comes from the file name.
#[tauri::command]
pub fn rename_recording(app: State<'_, AppState>, id: String, title: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::rename_recording(&db, &id, title.trim()))
}

#[tauri::command]
pub fn diarize_speakers(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    speaker_count: Option<i64>,
) -> Reported<()> {
    {
        let running = app.bezici.is_running(&id);
        let db = app.db.lock().unwrap();
        let n = reported(db::recording(&db, &id))?;
        if recording_is_busy(running, &n.status) {
            return Err(UserMessage::new("transcription.still_running"));
        }
    }
    transcription::start_diarization_in_thread(
        window,
        app.db_path.clone(),
        id,
        app.bezici.clone(),
        speaker_count,
    );
    Ok(())
}

#[cfg(test)]
mod busy_recording_tests {
    use super::*;

    /// The defect this exists for: speaker recognition waiting in the queue
    /// has not touched the row yet, so a transcription started beside it and
    /// two workers held one recording.
    #[test]
    fn a_queued_run_counts_as_busy_although_its_row_does_not_say_so() {
        assert!(recording_is_busy(true, db::status::DONE));
        assert!(recording_is_busy(true, db::status::NEW));
    }

    /// And the row still earns its place: a run interrupted by a crash is in
    /// no registry, because the registry died with it.
    #[test]
    fn a_row_left_on_prepisuje_counts_as_busy_without_a_worker() {
        assert!(recording_is_busy(false, db::status::TRANSCRIBING));
    }

    #[test]
    fn a_recording_nobody_is_working_on_is_free() {
        for status in [db::status::NEW, db::status::DONE, db::status::FAILED] {
            assert!(!recording_is_busy(false, status), "{status}");
        }
    }
}
