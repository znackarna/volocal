// Bez konzoloveho okna pri spusteni sestavene aplikace na Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_edit;
mod db;
mod download;
mod export;
mod online_import;
mod tools;
mod transcription;
mod user_message;

use anyhow::Result;
use db::{DictionaryEntry, Recording, RecordingNote, SearchResult, Segment, Settings, Speaker};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use user_message::UserMessage;

// ---------------------------------------------------------------- stav aplikace

struct AppState {
    db: Mutex<Connection>,
    db_path: PathBuf,
    /// Flag used to interrupt a download in progress
    download_cancellation: Arc<AtomicBool>,
    /// Transcriptions in flight, so they can be cancelled
    bezici: transcription::TranscriptionTask,
    /// Optional language-document generation, independent of transcription.
    ai_edit: ai_edit::AiEditTask,
    /// At most one cancellable online media import at a time.
    online_import: online_import::OnlineImportTask,
}

/// Recordings whose waveform is being computed in the background. Without
/// this, every open of the detail screen would start another ffmpeg over the
/// same file.
///
/// A global rather than a field on the app state: the worker thread needs to
/// reach the list too, and it outlives the state.
static WAVEFORM_JOBS: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

fn waveform_jobs() -> &'static Mutex<std::collections::HashSet<String>> {
    WAVEFORM_JOBS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Result of a command whose failure is shown in the window.
type Reported<T> = std::result::Result<T, UserMessage>;

/// Failures from anyhow travel to the window as a message it can look up.
/// Most of them have no code of their own yet, so the window prints the
/// technical text they carry rather than nothing at all.
fn reported<T>(v: Result<T>) -> Reported<T> {
    v.map_err(UserMessage::from)
}

// ---------------------------------------------------------------- nastaveni

#[tauri::command]
fn load_settings(app: State<'_, AppState>) -> Reported<Settings> {
    let db = app.db.lock().unwrap();
    let mut settings = reported(db::load_settings(&db))?;
    if !settings.editor_model.is_empty() {
        if let Some((resolved, _)) = tools::resolve_editor_model(&settings) {
            if resolved != settings.editor_model {
                settings.editor_model = resolved;
                reported(db::save_settings(&db, &settings))?;
            }
        }
    }
    Ok(settings)
}

#[tauri::command]
fn save_settings(app: State<'_, AppState>, settings: Settings) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::save_settings(&db, &settings))
}

#[tauri::command]
fn check_tools(app: State<'_, AppState>) -> Reported<tools::ToolCheck> {
    let db = app.db.lock().unwrap();
    let n = reported(db::load_settings(&db))?;
    Ok(tools::check(&n))
}

// ---------------------------------------------------------------- knihovna

#[tauri::command]
fn list_recordings(app: State<'_, AppState>) -> Reported<Vec<Recording>> {
    let db = app.db.lock().unwrap();
    reported(db::list_recordings(&db))
}

const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mkv", "mov", "webm",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WatchFolderCandidate {
    path: String,
    name: String,
    fingerprint: String,
}

fn is_supported_media(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_MEDIA_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn watch_file_fingerprint(path: &std::path::Path) -> Result<String> {
    let metadata = path.metadata()?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let created = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(format!("{}:{modified}:{created}", metadata.len()))
}

/// Revalidates a candidate returned to the window. The frontend is not a
/// trusted filesystem boundary: only unchanged direct children of the active
/// watched directory may be imported or ignored.
fn validate_watch_candidate(
    settings: &Settings,
    candidate: &WatchFolderCandidate,
) -> Reported<PathBuf> {
    if !settings.watch_folder_enabled || settings.watch_folder.trim().is_empty() {
        return Err(UserMessage::new("watch_folder.disabled"));
    }
    let directory = PathBuf::from(&settings.watch_folder);
    let file = PathBuf::from(&candidate.path);
    if !file.is_file() || !is_supported_media(&file) {
        return Err(UserMessage::new("watch_folder.file_gone").with("name", &candidate.name));
    }
    let canonical_directory = directory.canonicalize()?;
    let canonical_file = file.canonicalize()?;
    if canonical_file.parent() != Some(canonical_directory.as_path()) {
        return Err(UserMessage::new("watch_folder.file_outside").with("name", &candidate.name));
    }
    if watch_file_fingerprint(&file)? != candidate.fingerprint {
        return Err(UserMessage::new("watch_folder.file_changed").with("name", &candidate.name));
    }
    Ok(file)
}

fn create_recording(db: &Connection, settings: &Settings, file: PathBuf) -> Reported<Recording> {
    if !file.is_file() {
        return Err(UserMessage::new("file.not_found").with("path", file.to_string_lossy()));
    }

    let duration = tools::check(settings)
        .ffprobe
        .and_then(|probe| tools::audio_duration(std::path::Path::new(&probe), &file).ok())
        .unwrap_or(0.0);
    let title = file
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "Bez názvu".into());
    let recording = Recording {
        id: uuid::Uuid::new_v4().to_string(),
        path: file.to_string_lossy().to_string(),
        title,
        duration,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        status: "nova".into(),
        model: String::new(),
        language: String::new(),
        language_choice: String::new(),
        error: None,
        segment_count: 0,
        // Everything arriving from outside lands in the archive's root; a
        // folder is a decision the person makes afterwards.
        folder: None,
    };
    db::insert_recording(db, &recording)?;
    Ok(recording)
}

#[tauri::command]
fn add_recording(app: State<'_, AppState>, path: String) -> Reported<Recording> {
    let db = app.db.lock().unwrap();
    let settings = reported(db::load_settings(&db))?;
    create_recording(&db, &settings, PathBuf::from(path))
}

/// Checks the configured directory once. Polling lives in the window so this
/// feature stops naturally with the app and needs no background system
/// service. Only direct children are considered: choosing one folder must not
/// unexpectedly crawl an entire drive through nested directories.
#[tauri::command]
async fn scan_watch_folder(app: State<'_, AppState>) -> Reported<Vec<WatchFolderCandidate>> {
    let (settings, db_path) = {
        let db = app.db.lock().unwrap();
        (reported(db::load_settings(&db))?, app.db_path.clone())
    };
    if !settings.watch_folder_enabled || settings.watch_folder.trim().is_empty() {
        return Ok(Vec::new());
    }

    tauri::async_runtime::spawn_blocking(move || -> Reported<Vec<WatchFolderCandidate>> {
        let directory = PathBuf::from(&settings.watch_folder);
        if !directory.is_dir() {
            return Err(UserMessage::new("watch_folder.not_available")
                .with("path", directory.to_string_lossy()));
        }

        let mut files = std::fs::read_dir(&directory)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.is_file() && is_supported_media(path))
            .collect::<Vec<_>>();
        files.sort();

        let db = db::open(&db_path)?;
        let mut candidates = Vec::new();
        for file in files {
            let fingerprint = watch_file_fingerprint(&file)?;
            let path = file.to_string_lossy().to_string();

            // Already answered about — imported, added, or set aside. The
            // record is keyed on the content as well as the path, so the same
            // file put there afresh comes back on its own.
            if db::watch_file_imported(&db, &path, &fingerprint)? {
                continue;
            }
            // In the archive but never seen by the watcher: an ordinary drag
            // and drop of a file that happens to live in the folder.
            if db::recording_path_exists(&db, &path)? {
                db::mark_watch_file_imported(&db, &path, &fingerprint)?;
                continue;
            }
            if !db::watch_file_is_stable(&db, &path, &fingerprint)? {
                continue;
            }

            candidates.push(WatchFolderCandidate {
                name: file
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Nahrávka".into()),
                path,
                fingerprint,
            });
        }
        Ok(candidates)
    })
    .await
    .map_err(|error| UserMessage::new("watch_folder.scan_interrupted").detail(error))?
}

#[tauri::command]
async fn import_watch_folder_files(
    app: State<'_, AppState>,
    files: Vec<WatchFolderCandidate>,
) -> Reported<Vec<Recording>> {
    let (settings, db_path) = {
        let db = app.db.lock().unwrap();
        (reported(db::load_settings(&db))?, app.db_path.clone())
    };
    tauri::async_runtime::spawn_blocking(move || -> Reported<Vec<Recording>> {
        let db = db::open(&db_path)?;
        let mut recordings = Vec::new();
        for candidate in files {
            let file = validate_watch_candidate(&settings, &candidate)?;
            if db::watch_file_imported(&db, &candidate.path, &candidate.fingerprint)? {
                continue;
            }
            if !db::watch_file_is_stable(&db, &candidate.path, &candidate.fingerprint)? {
                continue;
            }
            if db::recording_path_exists(&db, &candidate.path)? {
                db::mark_watch_file_imported(&db, &candidate.path, &candidate.fingerprint)?;
                continue;
            }
            let recording = create_recording(&db, &settings, file)?;
            db::mark_watch_file_imported(&db, &candidate.path, &candidate.fingerprint)?;
            recordings.push(recording);
        }
        Ok(recordings)
    })
    .await
    .map_err(|error| UserMessage::new("watch_folder.import_interrupted").detail(error))?
}

#[tauri::command]
async fn ignore_watch_folder_files(
    app: State<'_, AppState>,
    files: Vec<WatchFolderCandidate>,
) -> Reported<()> {
    let (settings, db_path) = {
        let db = app.db.lock().unwrap();
        (reported(db::load_settings(&db))?, app.db_path.clone())
    };
    tauri::async_runtime::spawn_blocking(move || -> Reported<()> {
        let db = db::open(&db_path)?;
        for candidate in files {
            validate_watch_candidate(&settings, &candidate)?;
            db::mark_watch_file_imported(&db, &candidate.path, &candidate.fingerprint)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| UserMessage::new("watch_folder.ignore_interrupted").detail(error))?
}

/// A take from the interface's microphone recorder.
///
/// The audio arrives as the raw invoke body — a longer take is tens of
/// megabytes, and pushing that through JSON would mean serializing a giant
/// number array. `(async)` because the conversion below shells out to ffmpeg,
/// which must never run on the thread that owns the window; a borrowed
/// `Request` rules out an `async fn`, and this is the documented shape for
/// binary uploads.
#[tauri::command(async)]
fn save_microphone_recording(
    app: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Reported<Recording> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(UserMessage::new("microphone.no_audio"));
    };
    // A take this small holds no audible speech; refusing it here beats an
    // archive card whose transcription finds nothing.
    if bytes.len() < 4096 {
        return Err(UserMessage::new("microphone.empty"));
    }
    let (settings, db_path) = {
        let db = app.db.lock().unwrap();
        (reported(db::load_settings(&db))?, app.db_path.clone())
    };
    let check = tools::check(&settings);
    let ffmpeg = check
        .ffmpeg
        .ok_or_else(|| UserMessage::new("microphone.ffmpeg_missing"))?;
    let root = db_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("microphone");
    std::fs::create_dir_all(&root)
        .map_err(|error| UserMessage::new("microphone.save_failed").detail(error))?;

    // The browser side records WebM/Opus; the archive gets an M4A like the
    // online imports, so every recording the application creates for itself
    // has the same shape — and M4A's sample table seeks precisely, which is
    // the property the MP3 playback proxy exists to add.
    let raw = root.join(format!("take-{}.webm", uuid::Uuid::new_v4()));
    std::fs::write(&raw, bytes)
        .map_err(|error| UserMessage::new("microphone.save_failed").detail(error))?;

    // `Záznam 2026-08-05 09-30.m4a` — the file name is also the recording's
    // title, so it is written for reading, not for parsing. A second take in
    // the same minute counts up.
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M").to_string();
    let mut output = root.join(format!("Záznam {stamp}.m4a"));
    let mut counter = 2;
    while output.exists() {
        output = root.join(format!("Záznam {stamp} ({counter}).m4a"));
        counter += 1;
    }

    let converted = tools::command(std::path::Path::new(&ffmpeg))
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&raw)
        .args(["-vn", "-c:a", "aac", "-b:a", "160k"])
        .arg(&output)
        .status();
    let _ = std::fs::remove_file(&raw);
    match converted {
        Ok(status) if status.success() => {}
        Ok(_) => return Err(UserMessage::new("microphone.convert_failed")),
        Err(error) => return Err(UserMessage::new("microphone.convert_failed").detail(error)),
    }

    let db = app.db.lock().unwrap();
    create_recording(&db, &settings, output)
}

#[tauri::command]
async fn import_online_recording(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    url: String,
) -> Reported<Recording> {
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    let db_path = app.db_path.clone();
    let task = app.online_import.clone();
    let cancellation = task.begin()?;
    let worker_cancellation = cancellation.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        online_import::import(&window, &db_path, &settings, &url, worker_cancellation)
    })
    .await
    .map_err(|error| UserMessage::new("online_import.interrupted").detail(error))
    .and_then(|outcome| outcome);
    task.finish(&cancellation);
    result
}

#[tauri::command]
fn cancel_online_import(app: State<'_, AppState>) {
    app.online_import.cancel();
}

// ---------------------------------------------------------------- folders

#[tauri::command]
fn folders(app: State<'_, AppState>) -> Reported<Vec<db::Folder>> {
    let db = app.db.lock().unwrap();
    reported(db::folders(&db))
}

#[tauri::command]
fn create_folder(app: State<'_, AppState>, name: String) -> Reported<db::Folder> {
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
fn rename_folder(app: State<'_, AppState>, id: String, name: String) -> Reported<()> {
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
fn move_to_folder(
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
fn delete_folder(app: State<'_, AppState>, id: String, contents: bool) -> Reported<()> {
    let ids = {
        let db = app.db.lock().unwrap();
        if contents {
            reported(db::folder_recording_ids(&db, &id))?
        } else {
            Vec::new()
        }
    };
    {
        let db = app.db.lock().unwrap();
        // One transaction over the whole errand. Giving up in the middle of
        // the loop used to leave some recordings deleted, the rest in a folder
        // that was about to go, and nothing said about either.
        let tx = reported(db.unchecked_transaction().map_err(anyhow::Error::from))?;
        for recording in &ids {
            reported(db::delete_recording(&tx, recording))?;
        }
        reported(db::delete_folder(&tx, &id))?;
        reported(tx.commit().map_err(anyhow::Error::from))?;
    }
    // Outside the lock: each removal has its own playback proxies to clear.
    for recording in &ids {
        tools::remove_playback_proxies(&app.db_path, recording);
    }
    Ok(())
}

/// Formats that hold audio and nothing else. A source already in one of them
/// can be handed over as it is; anything else — every video container — has
/// to have its audio taken out, or `Uložit zvuk` would produce a video.
const AUDIO_ONLY_FORMATS: [&str; 8] = ["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "wma"];

/// Hand a recording's audio over in a format that opens anywhere. Microphone
/// takes and downloaded media live inside the application's data directory,
/// which nobody should have to go digging for.
///
/// The destination's own extension says which format to write. When it
/// already matches an audio-only source the file is copied verbatim —
/// re-encoding lossy audio into the same shape only shaves quality off it for
/// nothing, and a copy needs no ffmpeg at all. Otherwise ffmpeg writes the
/// requested format with `-vn`, so a video source yields audio.
#[tauri::command]
fn export_audio(app: State<'_, AppState>, id: String, destination: String) -> Reported<()> {
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
fn delete_recording(app: State<'_, AppState>, id: String) -> Reported<()> {
    {
        let db = app.db.lock().unwrap();
        reported(db::delete_recording(&db, &id))?;
    }
    tools::remove_playback_proxies(&app.db_path, &id);
    Ok(())
}

#[tauri::command]
fn start_transcription(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    speaker_count: Option<i64>,
) -> Reported<()> {
    // Starting the same transcription twice would write the segments twice.
    // The status lives in the database, so a lock and a look are enough.
    {
        let db = app.db.lock().unwrap();
        let n = reported(db::recording(&db, &id))?;
        if n.status == "prepisuje" {
            return Ok(());
        }
        reported(db::set_status(&db, &id, "prepisuje", None))?;
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
fn transcribe_in_language(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    language: String,
    speaker_count: Option<i64>,
) -> Reported<()> {
    {
        let db = app.db.lock().unwrap();
        let n = reported(db::recording(&db, &id))?;
        if n.status == "prepisuje" {
            return Ok(());
        }
        reported(db::set_language_choice(&db, &id, &language))?;
        reported(db::set_status(&db, &id, "prepisuje", None))?;
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
fn cancel_transcription(app: State<'_, AppState>, id: String) -> Reported<()> {
    if !app.bezici.cancel(&id) {
        // Nothing is running: the work finished between the click and this
        // call. Clear the flag, or the next transcription of this recording
        // would abort itself, and tidy up a status left behind by a crash.
        app.bezici.forget_cancellation(&id);
        let db = app.db.lock().unwrap();
        if let Ok(recording) = db::recording(&db, &id) {
            if recording.status == "prepisuje" {
                reported(db::set_status(&db, &id, "nova", None))?;
            }
        }
    }
    Ok(())
}

/// Discards a finished transcript but keeps the recording in the archive.
#[tauri::command]
fn delete_transcription(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_segments(&db, &id))?;
    reported(db::delete_speakers(&db, &id))?;
    reported(db::set_status(&db, &id, "nova", None))
}

/// Renames a recording in the archive; the default comes from the file name.
#[tauri::command]
fn rename_recording(app: State<'_, AppState>, id: String, title: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::rename_recording(&db, &id, title.trim()))
}

#[tauri::command]
fn diarize_speakers(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    speaker_count: Option<i64>,
) -> Reported<()> {
    // The registry knows the instant a worker starts; the row only once that
    // worker has said so, and a queued run has not said anything yet. Asking
    // the row alone let a second recognition start beside the first — the
    // guard an earlier entry claimed was already here, and was not.
    if app.bezici.is_running(&id) {
        return Err(UserMessage::new("transcription.still_running"));
    }
    {
        let db = app.db.lock().unwrap();
        let n = reported(db::recording(&db, &id))?;
        if n.status == "prepisuje" {
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

// ---------------------------------------------------------------- detail

#[derive(Serialize)]
struct Detail {
    recording: Recording,
    segments: Vec<Segment>,
    speakers: Vec<Speaker>,
    notes: Vec<RecordingNote>,
}

#[tauri::command]
fn detail(app: State<'_, AppState>, id: String) -> Reported<Detail> {
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
fn check_note_time(time: Option<f64>) -> Reported<()> {
    match time {
        Some(seconds) if !seconds.is_finite() || seconds < 0.0 => {
            Err(UserMessage::new("note.invalid_time"))
        }
        _ => Ok(()),
    }
}

#[tauri::command]
fn add_recording_note(
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
fn update_recording_note(
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
fn delete_recording_note(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_recording_note(&db, &id))
}

#[tauri::command]
fn update_segment(app: State<'_, AppState>, id: String, text: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::update_segment(&db, &id, &text))
}

/// Is the source file still where it was? The transcript lives in the
/// database, so the recording can be deleted — it just cannot be played then.
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// A media source with an accurate timeline for word-level seeking.
///
/// Long VBR MP3 files are converted once to a cached M4A. This command is
/// asynchronous because encoding must never block Tauri's UI/IPC thread.
#[tauri::command]
async fn playback_source(app: State<'_, AppState>, id: String) -> Reported<String> {
    let (recording, settings, db_path) = {
        let db = app.db.lock().unwrap();
        (
            reported(db::recording(&db, &id))?,
            reported(db::load_settings(&db))?,
            app.db_path.clone(),
        )
    };

    let source = std::path::PathBuf::from(&recording.path);
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
fn change_recording_path(app: State<'_, AppState>, id: String, path: String) -> Reported<()> {
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

// ---------------------------------------------------------------- backups

#[derive(Serialize)]
struct BackupStatus {
    /// Newest backup, formatted for display. Empty when there is none yet.
    latest: String,
    count: usize,
    directory: String,
}

#[tauri::command]
fn backup_status(app: State<'_, AppState>) -> BackupStatus {
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
fn back_up_now(app: State<'_, AppState>) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let written = reported(db::back_up_and_rotate(&db, &app.db_path))?;
    Ok(written.to_string_lossy().to_string())
}

/// Waveform for the player. Read from the database; when it is not there
/// yet, it is computed in the background and the window comes back for it.
#[derive(Serialize)]
struct Waveform {
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
fn recording_waveform(app: State<'_, AppState>, id: String) -> Reported<Waveform> {
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
    {
        let mut running = waveform_jobs().lock().unwrap();
        if running.contains(&id) {
            return Ok(Waveform::from_data(cached, true));
        }
        running.insert(id.clone());
    }

    let Some(ffmpeg) = tools::check(&settings).ffmpeg else {
        waveform_jobs().lock().unwrap().remove(&id);
        return Ok(Waveform::from_data(cached, false));
    };

    let (points_per_second, count) = transcription::waveform_density(recording.duration);
    let db_path = app.db_path.clone();
    let response = Waveform::from_data(cached.clone(), true);
    std::thread::spawn(move || {
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
        waveform_jobs().lock().unwrap().remove(&recording.id);
    });

    Ok(response)
}

/// Runs the dictionary over a finished transcript. Returns the change count.
#[tauri::command]
fn apply_dictionary(app: State<'_, AppState>, id: String) -> Reported<usize> {
    let db = app.db.lock().unwrap();
    reported(transcription::apply_dictionary_to_recording(&db, &id))
}

#[tauri::command]
fn mark_verified(app: State<'_, AppState>, id: String, verified: bool) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::mark_verified(&db, &id, verified))
}

#[tauri::command]
fn set_segment_speaker(
    app: State<'_, AppState>,
    id: String,
    speakers: Option<String>,
) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::set_segment_speaker(&db, &id, speakers.as_deref()))
}

#[tauri::command]
fn rename_speaker(
    app: State<'_, AppState>,
    recording_id: String,
    key: String,
    name: String,
) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::rename_speaker(&db, &recording_id, &key, &name))
}

#[tauri::command]
fn merge_speakers(
    app: State<'_, AppState>,
    recording_id: String,
    from_key: String,
    to_key: String,
) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::merge_speakers(&db, &recording_id, &from_key, &to_key))
}

// ---------------------------------------------------------------- slovnik

#[tauri::command]
fn dictionary(app: State<'_, AppState>) -> Reported<Vec<DictionaryEntry>> {
    let db = app.db.lock().unwrap();
    reported(db::dictionary(&db))
}

#[tauri::command]
fn add_dictionary_entry(
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
fn update_dictionary_entry(
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
fn delete_dictionary_entry(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_dictionary_entry(&db, &id))
}

// ---------------------------------------------------------------- hledani

#[tauri::command]
fn search(app: State<'_, AppState>, query: String) -> Reported<Vec<SearchResult>> {
    let db = app.db.lock().unwrap();
    reported(db::search(&db, &query))
}

// ---------------------------------------------------------------- export

#[tauri::command]
fn export_preview(app: State<'_, AppState>, id: String, format: String) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let segments = reported(db::segments(&db, &id))?;
    let speakers = reported(db::speakers(&db, &id))?;
    Ok(export::create(&format, &recording, &segments, &speakers))
}

#[tauri::command]
fn save_export(
    app: State<'_, AppState>,
    id: String,
    format: String,
    path: String,
) -> Reported<String> {
    let contents = export_preview(app, id, format)?;
    std::fs::write(&path, contents)
        .map_err(|error| UserMessage::new("file.write_failed").detail(error))?;
    Ok(path)
}

#[tauri::command]
fn suggested_name(app: State<'_, AppState>, id: String, format: String) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let n = reported(db::recording(&db, &id))?;
    let cisty: String = n
        .title
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
        .collect();
    Ok(format!("{}.{}", cisty, export::extension(&format)))
}

// ---------------------------------------------------------- language editing

#[derive(Serialize)]
struct AiEditStatus {
    document: Option<db::AiDocument>,
    outputs: Vec<db::AiOutput>,
    running: bool,
    progress: Option<ai_edit::AiEditProgress>,
}

#[tauri::command]
fn ai_edit_status(app: State<'_, AppState>, id: String) -> Reported<AiEditStatus> {
    let db = app.db.lock().unwrap();
    let mut document = reported(db::ai_document(&db, &id))?;
    let mut outputs = reported(db::ai_outputs(&db, &id))?;
    if let Some(document) = document.as_mut() {
        let source = reported(ai_edit::transcript_source(&db, &id))?;
        let settings = reported(db::load_settings(&db))?;
        let recording = reported(db::recording(&db, &id))?;
        let source_language = ai_edit::effective_language(&recording);
        let resolved_model = tools::resolve_editor_model(&settings).map(|(id, _)| id);
        document.stale = document.source_hash != ai_edit::source_hash(&source)
            || resolved_model.is_some_and(|model| document.model != model);
        // Hide summaries produced by the former direct-to-Czech pipeline. The
        // row is overwritten when the user generates that length again.
        outputs.retain(|output| {
            output.source_hash
                == ai_edit::output_source_hash(&document.text, &output.kind, &source_language)
        });
    }
    Ok(AiEditStatus {
        document,
        outputs,
        running: app.ai_edit.is_running(&id),
        progress: app.ai_edit.current_progress(&id),
    })
}

#[tauri::command]
fn start_ai_edit(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    mode: String,
) -> Reported<()> {
    if mode != "faithful" && mode != "clean" {
        return Err(UserMessage::new("ai.unknown_mode"));
    }
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    app.ai_edit
        .start(window, app.db_path.clone(), settings, id, mode)
}

#[tauri::command]
fn cancel_ai_edit(app: State<'_, AppState>, id: String) {
    app.ai_edit.cancel(&id);
}

#[tauri::command]
fn start_ai_output(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    kind: String,
    variant: String,
) -> Reported<()> {
    let valid = match kind.as_str() {
        "summary" => matches!(variant.as_str(), "short" | "standard" | "detailed"),
        "translation" => matches!(
            variant.as_str(),
            "cs" | "en" | "de" | "sk" | "pl" | "fr" | "es" | "it" | "uk"
        ),
        _ => false,
    };
    if !valid {
        return Err(UserMessage::new("ai.unknown_output"));
    }
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    app.ai_edit
        .start_output(window, app.db_path.clone(), settings, id, kind, variant)
}

#[tauri::command]
fn delete_ai_document(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_ai_document(&db, &id))
}

#[tauri::command]
fn save_ai_document(
    app: State<'_, AppState>,
    id: String,
    format: String,
    path: String,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let document = reported(db::ai_document(&db, &id))?
        .ok_or_else(|| UserMessage::new("ai.document_missing"))?;
    let contents = match format.as_str() {
        "txt" => format!("{}\n", document.text.trim()),
        "md" => format!(
            "# {}\n\n*Text vylepšil místní model {}*\n\n---\n\n{}\n",
            recording.title,
            document.model,
            document.text.trim()
        ),
        _ => return Err(UserMessage::new("ai.unsupported_document_format")),
    };
    std::fs::write(&path, contents)
        .map_err(|error| UserMessage::new("file.write_failed").detail(error))?;
    Ok(path)
}

#[tauri::command]
fn save_ai_output(
    app: State<'_, AppState>,
    id: String,
    kind: String,
    variant: String,
    format: String,
    path: String,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let output = reported(db::ai_outputs(&db, &id))?
        .into_iter()
        .find(|output| output.kind == kind && output.variant == variant)
        .ok_or_else(|| UserMessage::new("ai.output_missing"))?;
    let title = if kind == "summary" {
        match variant.as_str() {
            "short" => "Stručné shrnutí".to_string(),
            "detailed" => "Podrobné shrnutí".to_string(),
            _ => "Shrnutí".to_string(),
        }
    } else {
        let language = match variant.as_str() {
            "cs" => "češtiny",
            "en" => "angličtiny",
            "de" => "němčiny",
            "sk" => "slovenštiny",
            "pl" => "polštiny",
            "fr" => "francouzštiny",
            "es" => "španělštiny",
            "it" => "italštiny",
            "uk" => "ukrajinštiny",
            _ => "zvoleného jazyka",
        };
        format!("Překlad do {language}")
    };
    let contents = match format.as_str() {
        "txt" => format!("{}\n", output.text.trim()),
        "md" => format!(
            "# {} – {}\n\n*Vytvořeno místním modelem {}*\n\n---\n\n{}\n",
            recording.title,
            title,
            output.model,
            output.text.trim()
        ),
        _ => return Err(UserMessage::new("ai.unsupported_output_format")),
    };
    std::fs::write(&path, contents)
        .map_err(|error| UserMessage::new("file.write_failed").detail(error))?;
    Ok(path)
}

#[tauri::command]
fn suggested_ai_output_name(
    app: State<'_, AppState>,
    id: String,
    kind: String,
    variant: String,
    format: String,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let clean: String = recording
        .title
        .chars()
        .map(|character| {
            if r#"\/:*?"<>|"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let suffix = if kind == "summary" {
        match variant.as_str() {
            "short" => "stručné shrnutí".to_string(),
            "detailed" => "podrobné shrnutí".to_string(),
            _ => "shrnutí".to_string(),
        }
    } else {
        match variant.as_str() {
            "cs" => "český překlad",
            "en" => "anglický překlad",
            "de" => "německý překlad",
            "sk" => "slovenský překlad",
            "pl" => "polský překlad",
            "fr" => "francouzský překlad",
            "es" => "španělský překlad",
            "it" => "italský překlad",
            "uk" => "ukrajinský překlad",
            _ => "překlad",
        }
        .to_string()
    };
    let extension = if format == "md" { "md" } else { "txt" };
    Ok(format!("{clean} – {suffix}.{extension}"))
}

#[tauri::command]
fn suggested_ai_name(app: State<'_, AppState>, id: String, format: String) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let clean: String = recording
        .title
        .chars()
        .map(|character| {
            if r#"\/:*?"<>|"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let extension = if format == "md" { "md" } else { "txt" };
    Ok(format!("{clean} – vylepšený.{extension}"))
}

// ---------------------------------------------------------------- stahovani

#[tauri::command]
fn catalog(app: State<'_, AppState>) -> Reported<Vec<download::DownloadComponent>> {
    let db = app.db.lock().unwrap();
    let settings = reported(db::load_settings(&db))?;
    Ok(download::catalog(&settings))
}

#[tauri::command]
fn download(window: tauri::AppHandle, app: State<'_, AppState>, ids: Vec<String>) -> Reported<()> {
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    // Asked before the flag is cleared: a second call used to reset the
    // cancellation the first run was watching, so pressing Stop and then
    // starting again left the first thread downloading with its stop request
    // wiped. The same shape as the transcription `cancel` defect.
    if download::is_installing() {
        return Err(UserMessage::new("download.already_running"));
    }
    app.download_cancellation.store(false, Ordering::Relaxed);
    if !download::install_bundle(window, settings, ids, app.download_cancellation.clone()) {
        return Err(UserMessage::new("download.already_running"));
    }
    Ok(())
}

#[tauri::command]
fn cancel_download(app: State<'_, AppState>) {
    app.download_cancellation.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn create_portable_copy(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    path: String,
) -> Reported<f64> {
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    let bytes = download::create_portable_copy(&window, &settings, std::path::Path::new(&path))?;
    Ok(bytes as f64 / 1_073_741_824.0)
}

// ---------------------------------------------------------------- vykon stroje

#[derive(Serialize, Clone)]
struct BenchmarkResult {
    compute: String,
    seconds: f64,
    /// how many times faster than real time
    realtime_factor: f64,
    /// Why this backend did not finish. Absent when it did.
    error: Option<UserMessage>,
}

/// The flash drive travels between machines. On each new one it pays to
/// briefly measure what is actually faster — guessing from the card's name
/// is misleading.
#[tauri::command]
fn benchmark_compute(
    app: State<'_, AppState>,
    recording_id: Option<String>,
) -> Reported<Vec<BenchmarkResult>> {
    use std::path::Path;

    let (settings, source) = {
        let db = app.db.lock().unwrap();
        let settings = reported(db::load_settings(&db))?;
        let source = match &recording_id {
            Some(id) => reported(db::recording(&db, id))?.path,
            None => reported(db::list_recordings(&db))?
                .first()
                .map(|x| x.path.clone())
                .unwrap_or_default(),
        };
        (settings, source)
    };

    if source.is_empty() || !Path::new(&source).is_file() {
        return Err(UserMessage::new("benchmark.no_recording"));
    }

    let root = tools::check(&settings);
    let ffmpeg = root
        .ffmpeg
        .clone()
        .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;
    let model = root
        .model_whisper
        .clone()
        .ok_or_else(|| UserMessage::new("tools.model_missing"))?;

    let working_directory = std::env::temp_dir().join("whisp-benchmark");
    std::fs::create_dir_all(&working_directory)?;
    let sample = working_directory.join("sample.wav");

    // 20 seconds is enough to compare and holds nobody up
    tools::clip(Path::new(&ffmpeg), Path::new(&source), &sample, 20.0)?;

    let bin = tools::expand(&settings.bin_directory);
    let mut results = Vec::new();

    for backend in tools::available_compute_backends(&bin) {
        let directory = tools::compute_directory(&bin, &backend);
        let program = match tools::find_program_in(&[directory], "whisper-cli") {
            Some(p) => p,
            None => continue,
        };

        let started_at = std::time::Instant::now();
        let output = tools::command(&program)
            .arg("-m")
            .arg(&model)
            .arg("-f")
            .arg(&sample)
            .args(["-l", &settings.language, "--no-prints"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .output();
        let seconds = started_at.elapsed().as_secs_f64();

        match output {
            Ok(v) if v.status.success() => results.push(BenchmarkResult {
                compute: backend,
                seconds,
                realtime_factor: if seconds > 0.0 { 20.0 / seconds } else { 0.0 },
                error: None,
            }),
            Ok(v) => results.push(BenchmarkResult {
                compute: backend,
                seconds,
                realtime_factor: 0.0,
                // The last line the program printed is the only thing that
                // says anything here, and it comes from the program itself.
                error: Some(match String::from_utf8_lossy(&v.stderr).lines().last() {
                    Some(line) => UserMessage::new("benchmark.backend_failed").detail(line),
                    None => UserMessage::new("benchmark.unknown_failure"),
                }),
            }),
            Err(e) => results.push(BenchmarkResult {
                compute: backend,
                seconds: 0.0,
                realtime_factor: 0.0,
                error: Some(UserMessage::new("benchmark.launch_failed").detail(e)),
            }),
        }
    }

    let _ = std::fs::remove_dir_all(&working_directory);

    // the fastest of those that finished at all is stored right away
    if let Some(best) = results
        .iter()
        .filter(|v| v.error.is_none() && v.realtime_factor > 0.0)
        .max_by(|a, b| a.realtime_factor.partial_cmp(&b.realtime_factor).unwrap())
    {
        let db = app.db.lock().unwrap();
        let mut settings = reported(db::load_settings(&db))?;
        settings.compute = best.compute.clone();
        settings.last_machine = name_machine();
        reported(db::save_settings(&db, &settings))?;
    }

    results.sort_by(|a, b| b.realtime_factor.partial_cmp(&a.realtime_factor).unwrap());
    Ok(results)
}

#[tauri::command]
fn name_machine() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "neznámý".into())
}

// ---------------------------------------------------------------- start

/// Answers WebView2's microphone permission request without asking again.
///
/// WebView2 treats the application as a web page and prompts in the name of the
/// origin it is served from, which on Windows is `tauri.localhost`. That name
/// cannot be changed — a page that could choose how it is announced would make
/// the prompt worthless — so the only way to stop a person being asked by a
/// stranger is not to raise the prompt at all.
///
/// The consent is not skipped, it is moved to where it means something: the
/// recorder is opened deliberately, and its own dialog says the microphone is
/// being opened and that not a word leaves the computer. The system prompt only
/// repeated that question in a name nobody recognises.
///
/// Only `MICROPHONE` is answered. Every other kind — camera, location,
/// notifications, clipboard — is left untouched and still prompts. This webview
/// loads nothing but the bundled interface, so there is no third-party page
/// that could be the one asking.
#[cfg(windows)]
fn allow_microphone(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    let registered = window.with_webview(|webview| {
        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => {
                eprintln!("microphone: WebView2 unreachable, prompt stays: {error}");
                return;
            }
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
            unsafe { args.PermissionKind(&mut kind)? };
            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
            }
            Ok(())
        }));
        // The token is only needed to unsubscribe, and this handler lives as
        // long as the window does.
        let mut token = 0i64;
        if let Err(error) = unsafe { core.add_PermissionRequested(&handler, &mut token) } {
            eprintln!("microphone: handler not registered, prompt stays: {error}");
        }
    });
    if let Err(error) = registered {
        eprintln!("microphone: no webview to attach to, prompt stays: {error}");
    }
}

fn main() {
    // Must happen before Tauri creates the window.
    tools::set_webview2();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // anyhow::Error nejde primo do Box<dyn Error>, proto prevod na text
            connect_database(app).map_err(|e| e.to_string())?;
            // The title is a constant now that the version is out of it, so it
            // lives in tauri.conf.json and nothing sets it at runtime.
            #[cfg(windows)]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                allow_microphone(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            check_tools,
            list_recordings,
            add_recording,
            scan_watch_folder,
            import_watch_folder_files,
            ignore_watch_folder_files,
            save_microphone_recording,
            import_online_recording,
            cancel_online_import,
            delete_recording,
            export_audio,
            folders,
            create_folder,
            rename_folder,
            move_to_folder,
            delete_folder,
            start_transcription,
            transcribe_in_language,
            cancel_transcription,
            delete_transcription,
            rename_recording,
            diarize_speakers,
            detail,
            add_recording_note,
            update_recording_note,
            delete_recording_note,
            update_segment,
            file_exists,
            playback_source,
            change_recording_path,
            recording_waveform,
            apply_dictionary,
            mark_verified,
            set_segment_speaker,
            rename_speaker,
            merge_speakers,
            dictionary,
            add_dictionary_entry,
            update_dictionary_entry,
            delete_dictionary_entry,
            search,
            export_preview,
            save_export,
            suggested_name,
            ai_edit_status,
            start_ai_edit,
            start_ai_output,
            cancel_ai_edit,
            delete_ai_document,
            save_ai_document,
            save_ai_output,
            suggested_ai_name,
            suggested_ai_output_name,
            benchmark_compute,
            name_machine,
            catalog,
            download,
            cancel_download,
            create_portable_copy,
            backup_status,
            back_up_now,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start the application")
        .run(|app, event| {
            // Closing the window must take the programs with it.
            //
            // `std::process::Child` does not kill on `Drop`, the worker
            // threads are detached, and nothing here used to ask them to stop
            // — so closing the window mid-transcription left `whisper-cli` or
            // `sherpa-onnx` running, and `llama-server` resident with a seven
            // gigabyte model. They held the graphics card and went on writing
            // into a temporary directory the next start deletes underneath
            // them.
            //
            // `ExitRequested` rather than `Exit`: it arrives while the state
            // is still there to be read. `Exit` is kept as the net for the
            // paths that never raise the request.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                let state = app.state::<AppState>();
                let killed = state.bezici.kill_all();
                let server = state.ai_edit.kill_server();
                if killed > 0 || server {
                    eprintln!(
                        "closing: stopped {killed} transcription program(s){}",
                        if server {
                            " and the language server"
                        } else {
                            ""
                        }
                    );
                }
            }
        });
}

/// Which archive to open, given where this mode says it belongs and the only
/// other place one can be.
///
/// An empty folder is indistinguishable from a first run: `db::open` creates
/// the whole schema in it and the Archive comes up blank and plausible. So
/// before starting a new archive, look at the other candidate. If a real one
/// is sitting there, open that instead. Losing sight of a year of transcripts
/// must take more than a folder appearing beside the executable.
fn archive_to_open(chosen: &std::path::Path, other: &std::path::Path) -> std::path::PathBuf {
    let preferred = chosen.join("whisp.db");
    if preferred.is_file() {
        return preferred;
    }
    let alternative = other.join("whisp.db");
    if alternative.is_file() {
        eprintln!(
            "opening the existing archive at {} instead of starting an empty one at {}",
            alternative.display(),
            preferred.display()
        );
        return alternative;
    }
    preferred
}

fn connect_database(app: &tauri::App) -> Result<()> {
    // Prenosny rezim: databaze lezi vedle programu, nic se nezapisuje
    // do profilu uzivatele na cizim pocitaci.
    let profile = app.path().app_data_dir()?;
    let directory = tools::data_directory(profile.clone());
    let other = if directory == profile {
        tools::app_directory().join("data")
    } else {
        profile
    };
    let db_path = archive_to_open(&directory, &other);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut connection = db::open(&db_path)?;

    // Anything still marked as running belongs to a session that never
    // finished. Without this the recording would sit there for ever showing a
    // progress bar that goes nowhere, with no way to start over.
    match db::recover_interrupted(&connection) {
        Ok(0) => {}
        Ok(n) => eprintln!("recovered {n} interrupted transcription(s)"),
        Err(e) => eprintln!("could not recover interrupted transcriptions: {e:#}"),
    }

    // Measured, not guessed — see the change log. Changing the default alone
    // would only reach new installations, and an existing one would keep
    // finding sixteen speakers in a conversation between two people.
    match db::raise_cluster_threshold_once(&connection) {
        Ok(true) => eprintln!("raised speaker clustering threshold to the new default"),
        Ok(false) => {}
        Err(e) => eprintln!("could not raise the clustering threshold: {e:#}"),
    }

    // Sentence blocks are derived from preserved word timestamps, so layout
    // improvements can be applied to existing transcripts without running
    // Whisper again. Back up an archive with existing transcripts first; the
    // rebuild itself is one transaction and leaves edited or verified blocks
    // untouched.
    if transcription::sentence_layout_upgrade_needed(&connection)? {
        let has_existing_transcripts =
            !db::completed_recording_ids_with_segments(&connection)?.is_empty();
        let backup_ready = !has_existing_transcripts
            || match db::back_up_and_rotate(&connection, &db_path) {
                Ok(path) => {
                    eprintln!(
                        "backed up archive before sentence layout upgrade: {}",
                        path.display()
                    );
                    true
                }
                Err(error) => {
                    eprintln!("sentence layout upgrade skipped because backup failed: {error:#}");
                    false
                }
            };
        if backup_ready {
            match transcription::upgrade_sentence_layout(&mut connection) {
                Ok(0) => {}
                Ok(count) => eprintln!("upgraded sentence layout in {count} recording(s)"),
                Err(error) => eprintln!("sentence layout upgrade failed: {error:#}"),
            }
        }
    }

    // The same crash also leaves the converted audio in the temp folder —
    // roughly 115 MB per hour of recording. Nothing can be using those folders
    // at this point, so clearing them is safe.
    let reclaimed = tools::clear_leftover_temporary();
    if reclaimed > 0 {
        eprintln!(
            "reclaimed {} MB of leftover temporary files",
            reclaimed / 1_000_000
        );
    }

    // The default paths are relative ("bin", "models") and are resolved
    // against the tools root: next to the executable in portable mode,
    // otherwise the app's own folder in the user profile. Anyone who keeps
    // their tools elsewhere sets an absolute path in the settings.
    let mut settings = db::load_settings(&connection)?;
    let mut changed = false;
    if settings.bin_directory.is_empty() {
        settings.bin_directory = "bin".into();
        changed = true;
    }
    if settings.models_directory.is_empty() {
        settings.models_directory = "models".into();
        changed = true;
    }
    if changed {
        db::save_settings(&connection, &settings)?;
    }

    // A backup on every application start, made on a thread of its own.
    //
    // The archive is a single SQLite file; if it breaks, everything ever
    // transcribed is gone. Backing up on startup rather than on a timer is
    // deliberate: the app is opened far more often than it is left running,
    // and a copy from every session is more useful than a precise schedule.
    // On a large archive this takes seconds, hence the thread and its own
    // connection — the window must not wait for it.
    let path = db_path.clone();
    std::thread::spawn(move || match db::open(&path) {
        Ok(own) => {
            if let Err(e) = db::back_up_and_rotate(&own, &path) {
                eprintln!("backup failed: {e:#}");
            }
        }
        Err(e) => eprintln!("backup could not open the database: {e:#}"),
    });

    app.manage(AppState {
        db: Mutex::new(connection),
        db_path,
        download_cancellation: Arc::new(AtomicBool::new(false)),
        bezici: transcription::TranscriptionTask::default(),
        ai_edit: ai_edit::AiEditTask::default(),
        online_import: online_import::OnlineImportTask::default(),
    });
    Ok(())
}

#[cfg(test)]
mod archive_location_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn scratch(name: &str) -> std::path::PathBuf {
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("whisp-archive-test-{id}-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn archive(dir: &std::path::Path) {
        std::fs::write(dir.join("whisp.db"), b"not really sqlite").unwrap();
    }

    #[test]
    fn the_place_for_this_mode_wins_when_it_holds_an_archive() {
        let chosen = scratch("chosen");
        let other = scratch("other");
        archive(&chosen);
        archive(&other);
        assert_eq!(archive_to_open(&chosen, &other), chosen.join("whisp.db"));
    }

    /// The defect this exists for: portability flipped, and the archive was
    /// suddenly somewhere else and empty.
    #[test]
    fn an_existing_archive_elsewhere_is_opened_rather_than_a_new_empty_one() {
        let chosen = scratch("empty");
        let other = scratch("has-the-archive");
        archive(&other);
        assert_eq!(archive_to_open(&chosen, &other), other.join("whisp.db"));
    }

    #[test]
    fn a_genuine_first_run_still_starts_where_it_belongs() {
        let chosen = scratch("first-run");
        let other = scratch("also-empty");
        assert_eq!(archive_to_open(&chosen, &other), chosen.join("whisp.db"));
    }
}
