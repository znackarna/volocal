//! The archive: recordings, their transcription, notes and speakers.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::db::{Recording, Settings};
use crate::user_message::UserMessage;
use crate::{db, online_import, tools};
use crate::{reported, AppState, Reported};
use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;
// ----------------------------------------------------------------- library

#[tauri::command]
pub fn list_recordings(app: State<'_, AppState>) -> Reported<Vec<Recording>> {
    let db = app.db.lock().unwrap();
    reported(db::list_recordings(&db))
}

pub(crate) const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mkv", "mov", "webm",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct WatchFolderCandidate {
    path: String,
    name: String,
    fingerprint: String,
}

pub(crate) fn is_supported_media(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_MEDIA_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

pub(crate) fn watch_file_fingerprint(path: &std::path::Path) -> Result<String> {
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
///
/// Why this one and not the paths in `add_recording`, `export_audio` or
/// `create_portable_copy`, which take whatever they are handed: those three are
/// answers to a system file dialog. The picker is the person, so validating its
/// result against a rule invented here could only ever refuse a folder they
/// deliberately chose. There is no attacker on the other side either — the
/// webview loads the bundled interface and nothing else, so a page that could
/// forge a command does not exist; and if one did, it would call
/// `delete_recording` long before it bothered writing an MP3 somewhere.
///
/// A watched candidate is different in kind. It is not a choice a person just
/// made, it is a list this program produced earlier and handed out, and acting
/// on it starts a transcription and marks the file as answered for. The
/// settings say which directory that list may come from, so there is a rule to
/// check it against — which is what makes checking meaningful here and theatre
/// there.
pub(crate) fn validate_watch_candidate(
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

/// Asks ffprobe how long the file is. Deliberately separate from writing the
/// row: this runs another program over a file that may be on a slow disk, and
/// it used to happen with the archive's lock held — so adding one recording
/// stopped every other command until the probe returned.
pub(crate) fn probe_duration(settings: &Settings, file: &std::path::Path) -> f64 {
    tools::check(settings)
        .ffprobe
        .and_then(|probe| tools::audio_duration(std::path::Path::new(&probe), file).ok())
        .unwrap_or(0.0)
}

pub(crate) fn create_recording(
    db: &Connection,
    file: PathBuf,
    duration: f64,
) -> Reported<Recording> {
    if !file.is_file() {
        return Err(UserMessage::new("file.not_found").with("path", file.to_string_lossy()));
    }

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
        status: db::status::NEW.into(),
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

/// `async`, so ffprobe runs off the window's thread — a file on a network share
/// or a sleeping external disk can take seconds to answer, and until it did,
/// nothing else in the interface responded.
#[tauri::command(async)]
pub fn add_recording(app: State<'_, AppState>, path: String) -> Reported<Recording> {
    let (settings, db_path) = {
        let db = app.db.lock().unwrap();
        (reported(db::load_settings(&db))?, app.db_path.clone())
    };
    let mut file = PathBuf::from(path);

    /* Asked for a self-contained archive: the file is copied in and the row
    points at our copy, so deleting the original loses nothing. Deliberately
    a copy and not a move — the file is the owner's and this application does
    not get to take it. A copy that fails is reported and stops the import
    rather than quietly filing the original: the answer to "is my audio
    safe here" must not be sometimes. */
    if settings.copy_imports {
        let root = recordings_dir(&settings, &db_path);
        std::fs::create_dir_all(&root)
            .map_err(|error| UserMessage::new("import.copy_failed").detail(error))?;
        let stem = file
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| "recording".into());
        let extension = file
            .extension()
            .map(|extension| extension.to_string_lossy().to_string())
            .unwrap_or_else(|| "bin".into());
        let destination = free_path(&root, &stem, &extension);
        // Already ours — adding a file straight out of this folder must not
        // make a second copy of it beside the first.
        let inside = file.canonicalize().ok().zip(root.canonicalize().ok());
        let already_ours = inside
            .map(|(file, root)| file.starts_with(&root))
            .unwrap_or(false);
        if !already_ours {
            std::fs::copy(&file, &destination)
                .map_err(|error| UserMessage::new("import.copy_failed").detail(error))?;
            file = destination;
        }
    }

    let duration = probe_duration(&settings, &file);
    let db = app.db.lock().unwrap();
    create_recording(&db, file, duration)
}

/// Checks the configured directory once. Polling lives in the window so this
/// feature stops naturally with the app and needs no background system
/// service. Only direct children are considered: choosing one folder must not
/// unexpectedly crawl an entire drive through nested directories.
#[tauri::command]
pub async fn scan_watch_folder(app: State<'_, AppState>) -> Reported<Vec<WatchFolderCandidate>> {
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
pub async fn import_watch_folder_files(
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
            let duration = probe_duration(&settings, &file);
            let recording = create_recording(&db, file, duration)?;
            db::mark_watch_file_imported(&db, &candidate.path, &candidate.fingerprint)?;
            recordings.push(recording);
        }
        Ok(recordings)
    })
    .await
    .map_err(|error| UserMessage::new("watch_folder.import_interrupted").detail(error))?
}

#[tauri::command]
pub async fn ignore_watch_folder_files(
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

/// The folder the application keeps its own audio in.
///
/// One place for all of it — microphone takes, the sound out of an online
/// video, and copies of files added by hand — because the point of the setting
/// is that somebody can find them. Two folders would defeat it.
///
/// The default is `recordings` beside the archive rather than the historical
/// `microphone`: existing files stay exactly where they are and keep playing,
/// since every row holds an absolute path. Nothing is moved by an upgrade.
pub fn recordings_dir(settings: &db::Settings, db_path: &std::path::Path) -> PathBuf {
    let configured = settings.recording_folder.trim();
    if !configured.is_empty() {
        return PathBuf::from(configured);
    }
    db_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("recordings")
}

/// A name inside `directory` that is not taken, counting up if it is.
///
/// The names this produces are read by a person in a file manager, so they
/// keep the original stem rather than becoming a UUID.
pub fn free_path(directory: &std::path::Path, stem: &str, extension: &str) -> PathBuf {
    let mut candidate = directory.join(format!("{stem}.{extension}"));
    let mut counter = 2;
    while candidate.exists() {
        candidate = directory.join(format!("{stem} ({counter}).{extension}"));
        counter += 1;
    }
    candidate
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
pub fn save_microphone_recording(
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
    let root = recordings_dir(&settings, &db_path);
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
    let output = free_path(&root, &format!("Záznam {stamp}"), "m4a");

    let converted = tools::command(std::path::Path::new(&ffmpeg))
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&raw)
        .args(["-vn", "-c:a", "aac", "-b:a", "160k"])
        .arg(&output)
        .status();
    /* **The take is deleted only once there is something to replace it with.**
    This line stood above the match, so a conversion that failed — a full
    disk, an ffmpeg deleted between the check and the run — removed the only
    copy of the recording and then reported that the take could not be
    converted. About audio that no longer existed.

    Every other artefact in this application can be made again: a transcript
    from its recording, a document from its transcript, a component from its
    download. A take cannot. It is the one place where a failure was able to
    destroy something irreproducible, and it is the one thing the audit of
    4 August 2026 — *nothing may quietly destroy work* — never covered,
    because the microphone was built the day after it.

    On the way out it is given the name the recording would have had. A
    `take-<uuid>.webm` left in the folder is a file nobody would recognise as
    theirs, and this is the moment somebody is going to go looking. */
    match converted {
        Ok(status) if status.success() => {
            let _ = std::fs::remove_file(&raw);
        }
        outcome => {
            let kept = free_path(&root, &format!("Záznam {stamp}"), "webm");
            let kept = match std::fs::rename(&raw, &kept) {
                Ok(()) => kept,
                // Even the rename failing leaves the bytes where they are.
                Err(_) => raw.clone(),
            };
            let message =
                UserMessage::new("microphone.convert_failed").with("file", kept.display());
            return Err(match outcome {
                Err(error) => message.detail(error),
                _ => message,
            });
        }
    }

    // Probe before the lock, for the reason `probe_duration` carries.
    let duration = probe_duration(&settings, &output);
    let db = app.db.lock().unwrap();
    create_recording(&db, output, duration)
}

#[tauri::command]
pub async fn import_online_recording(
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
pub fn cancel_online_import(app: State<'_, AppState>) {
    app.online_import.cancel();
}
