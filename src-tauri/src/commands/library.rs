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
        second_language_choice: String::new(),
        second_language: None,
        error: None,
        segment_count: 0,
        // Everything arriving from outside lands in the archive's root; a
        // folder is a decision the person makes afterwards.
        folder: None,
        // A file opened from the disk has no web address behind it.
        source_url: None,
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

/// Where a take is written while it is still being made.
///
/// One name, not one per session: this application has a single recorder and
/// can only be making one take at a time. A new take truncates whatever the
/// last one left, and the prefix is deliberately not `.download-`, which
/// `clear_leftover_imports` deletes on sight.
pub fn take_in_progress(recordings: &std::path::Path) -> PathBuf {
    recordings.join(".take-in-progress.webm")
}

/// Below this a take holds no audible speech - the same floor
/// `save_microphone_recording` refuses at, and the one a rescued file has to
/// clear before it is worth an archive card.
const TAKE_FLOOR: u64 = 4096;

/// Opens the shadow file a take is streamed into, discarding any previous one.
///
/// **Until 20 August a take existed only as a `Blob` in the webview until
/// somebody pressed save.** `MediaRecorder` was started with no timeslice, so
/// the chunks sat in a JavaScript array and nothing was on disk. The close
/// guard written on 17 August covers the deliberate gesture and covers nothing
/// else: a renderer crash, a graphics driver reset - plausible while whisper is
/// working the same card, because recording during a transcription is allowed -
/// a power cut or a restart from Windows took a two-hour interview with nothing
/// left behind.
///
/// A take is the one artefact here that cannot be made again. Everything else
/// - a transcript, a document, a component - can be produced a second time from
/// something that survives.
#[tauri::command]
pub fn begin_take(app: State<'_, AppState>) -> Reported<()> {
    let root = take_root(&app)?;
    std::fs::create_dir_all(&root)
        .map_err(|error| UserMessage::new("microphone.save_failed").detail(error))?;
    // Truncating rather than appending: what the last take left is either
    // already an archive row or was thrown away on purpose.
    std::fs::write(take_in_progress(&root), [])
        .map_err(|error| UserMessage::new("microphone.save_failed").detail(error))?;
    Ok(())
}

/// One slice of a take, appended as it is recorded.
///
/// The chunks of a single `MediaRecorder` concatenate into a playable WebM -
/// the first carries the header, the rest are clusters - which is what makes a
/// crash leave a file that can be listened to rather than a fragment.
///
/// Failure is not reported to the window and must not be: this is a safety net
/// running behind a recording in progress, and a dialog about it would
/// interrupt the one thing the net exists to protect. It goes to the log.
#[tauri::command(async)]
pub fn append_take_chunk(
    app: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Reported<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Ok(());
    };
    let root = take_root(&app)?;
    let path = take_in_progress(&root);
    let appended = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| std::io::Write::write_all(&mut file, bytes));
    if let Err(error) = appended {
        crate::note!("take shadow could not be written: {error}");
    }
    Ok(())
}

/// Throws the shadow away: the take is either saved or deliberately discarded.
///
/// Every path out of a take calls this, and that is what stops the rescue below
/// resurrecting a recording somebody chose to be rid of.
#[tauri::command]
pub fn discard_take(app: State<'_, AppState>) -> Reported<()> {
    let root = take_root(&app)?;
    let _ = std::fs::remove_file(take_in_progress(&root));
    Ok(())
}

fn take_root(app: &State<'_, AppState>) -> Reported<PathBuf> {
    let (settings, db_path) = {
        let db = app.db.lock().unwrap();
        (reported(db::load_settings(&db))?, app.db_path.clone())
    };
    Ok(recordings_dir(&settings, &db_path))
}

/// A take the application never got to save, turned into an archive row at the
/// next start.
///
/// Anything of a reasonable size left in the shadow file is by definition a
/// crash: every deliberate ending - saved, discarded, closed with the guard's
/// consent - deletes it. So it is renamed and listed rather than swept, and
/// the name says what it is, because somebody is going to come looking for a
/// recording they thought they had lost.
///
/// WebM rather than the M4A a saved take gets: converting needs ffmpeg and a
/// startup is not the place to shell out. The archive already accepts a `.webm`
/// here - the failed-conversion path leaves one under the same kind of name.
pub fn rescue_interrupted_take(
    connection: &rusqlite::Connection,
    settings: &db::Settings,
    db_path: &std::path::Path,
) -> Option<String> {
    let root = recordings_dir(settings, db_path);
    let shadow = take_in_progress(&root);
    let size = std::fs::metadata(&shadow).ok()?.len();
    if size < TAKE_FLOOR {
        let _ = std::fs::remove_file(&shadow);
        return None;
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M").to_string();
    let rescued = free_path(&root, &format!("Záznam {stamp} (obnovený)"), "webm");
    std::fs::rename(&shadow, &rescued).ok()?;

    /* **Its length, read here or nowhere.** The first version of this said the
    archive would fill it in when the recording was opened. It does not:
    `probe_duration` is called where a recording is *created* - an import, the
    watched folder, a saved take - and nothing updates a duration afterwards.
    A rescued row would have shown 0:00 for ever.

    So it is probed, which is one ffprobe over one file on a start that follows
    a crash - not something every start pays for. If ffprobe is not installed,
    `probe_duration` answers 0.0 and the row says nothing rather than something
    wrong, which was the only true half of that first comment. */
    let duration = probe_duration(settings, &rescued);
    let recording = db::Recording {
        id: uuid::Uuid::new_v4().to_string(),
        path: rescued.to_string_lossy().to_string(),
        title: rescued
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| "Záznam".into()),
        duration,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        status: db::status::NEW.into(),
        model: String::new(),
        language: String::new(),
        language_choice: String::new(),
        second_language_choice: String::new(),
        second_language: None,
        error: None,
        segment_count: 0,
        folder: None,
        // Rescued from the recordings folder; whatever put it there is not
        // recorded anywhere this can read.
        source_url: None,
    };
    db::insert_recording(connection, &recording).ok()?;
    Some(recording.title)
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

    // The shadow has done its job: the audio is in the archive under its own
    // name. Deleted here rather than by the window, so that a save the window
    // never hears the end of still cleans up after itself.
    let _ = std::fs::remove_file(take_in_progress(&root));

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

#[cfg(test)]
mod take_rescue_tests {
    use super::*;

    /// An archive of this test's own, with the recordings folder inside it so
    /// `recordings_dir` resolves there and nothing touches the real one.
    fn archive(name: &str) -> (rusqlite::Connection, db::Settings, PathBuf) {
        let directory = std::env::temp_dir().join(format!("volocal-take-{name}"));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("scratch");
        let db_path = directory.join("volocal.db");
        let connection = db::open(&db_path).expect("archive");
        let settings = db::load_settings(&connection).expect("settings");
        (connection, settings, db_path)
    }

    fn shadow_of(settings: &db::Settings, db_path: &std::path::Path) -> PathBuf {
        take_in_progress(&recordings_dir(settings, db_path))
    }

    /// **The repair.** Anything of a reasonable size left in the shadow file is
    /// a crash by definition, because every deliberate ending deletes it - so
    /// it comes back as a recording rather than being swept away.
    #[test]
    fn a_take_the_application_never_saved_comes_back_as_a_recording() {
        let (connection, settings, db_path) = archive("rescued");
        let shadow = shadow_of(&settings, &db_path);
        std::fs::create_dir_all(shadow.parent().unwrap()).unwrap();
        std::fs::write(&shadow, vec![7u8; 64 * 1024]).unwrap();

        let title = rescue_interrupted_take(&connection, &settings, &db_path)
            .expect("a take of this size is worth rescuing");

        assert!(
            title.contains("obnovený"),
            "the name says what it is: {title}"
        );
        assert!(
            !shadow.exists(),
            "and the shadow is not left to be rescued twice"
        );

        let listed = db::list_recordings(&connection).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, db::status::NEW);
        assert!(
            std::path::Path::new(&listed[0].path).is_file(),
            "the row points at bytes that are really there"
        );
    }

    /// **And it carries its length.** The first version of this repair left the
    /// duration at zero on the belief that the archive fills it in later. It
    /// does not — `probe_duration` runs where a recording is created and
    /// nothing updates it afterwards — so a rescued take would have read 0:00
    /// for ever.
    ///
    /// The audio is made here rather than kept as a fixture, which also makes
    /// the test say what it depends on: with no ffmpeg on this machine there is
    /// nothing to probe with either, and the row must still appear. That is the
    /// half worth keeping in both cases — a rescue that needs a converter
    /// installed would be no rescue at all.
    #[test]
    fn a_rescued_take_says_how_long_it_is_where_that_can_be_read() {
        let (connection, settings, db_path) = archive("duration");
        let shadow = shadow_of(&settings, &db_path);
        std::fs::create_dir_all(shadow.parent().unwrap()).unwrap();

        let check = crate::tools::check(&settings);
        let (Some(ffmpeg), Some(_)) = (check.ffmpeg.as_ref(), check.ffprobe.as_ref()) else {
            // No converter here. The rescue still has to work, on bytes that
            // are not audio at all.
            std::fs::write(&shadow, vec![7u8; 64 * 1024]).unwrap();
            assert!(rescue_interrupted_take(&connection, &settings, &db_path).is_some());
            let listed = db::list_recordings(&connection).unwrap();
            assert_eq!(
                listed[0].duration, 0.0,
                "nothing is claimed that cannot be read"
            );
            return;
        };

        let made = crate::tools::command(std::path::Path::new(ffmpeg))
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:a",
                "libopus",
                /* Written the way `MediaRecorder` writes: streamed out with
                **no duration in the header**, which is what the real fault
                turned out to be. `-live 1` is what makes ffmpeg leave the
                length out, the same as a browser recording as it goes.
                Without it this test passes on a file no crash could produce. */
                "-f",
                "webm",
                "-live",
                "1",
            ])
            .arg(&shadow)
            .status();
        assert!(
            made.is_ok_and(|status| status.success()),
            "two seconds of tone"
        );

        // The fault, pinned: the header says nothing about how long it is, so
        // a test whose fixture answers here would be testing the wrong file.
        let stated = crate::tools::command(std::path::Path::new(check.ffprobe.as_ref().unwrap()))
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
            ])
            .arg(&shadow)
            .stdout(std::process::Stdio::piped())
            .output()
            .expect("ffprobe");
        assert!(
            String::from_utf8_lossy(&stated.stdout)
                .trim()
                .parse::<f64>()
                .is_err(),
            "this fixture must be one no header can answer for"
        );

        rescue_interrupted_take(&connection, &settings, &db_path).expect("rescued");

        let listed = db::list_recordings(&connection).unwrap();
        assert!(
            (listed[0].duration - 2.0).abs() < 0.3,
            "the card says how long it is: {} s",
            listed[0].duration
        );
    }

    /// A take somebody threw away on purpose leaves nothing behind, so there is
    /// nothing to hand back. This is the half that keeps the rescue honest.
    #[test]
    fn a_discarded_take_is_not_handed_back() {
        let (connection, settings, db_path) = archive("discarded");
        let shadow = shadow_of(&settings, &db_path);
        std::fs::create_dir_all(shadow.parent().unwrap()).unwrap();
        std::fs::write(&shadow, vec![7u8; 64 * 1024]).unwrap();
        // What `discard_take` does, without needing an `AppState` to do it.
        std::fs::remove_file(&shadow).unwrap();

        assert!(rescue_interrupted_take(&connection, &settings, &db_path).is_none());
        assert!(db::list_recordings(&connection).unwrap().is_empty());
    }

    /// A recorder opened and closed without a word leaves a header and little
    /// else. An archive card for that is noise, and the same floor
    /// `save_microphone_recording` refuses at applies here.
    #[test]
    fn a_take_too_short_to_hold_speech_is_swept_rather_than_listed() {
        let (connection, settings, db_path) = archive("tiny");
        let shadow = shadow_of(&settings, &db_path);
        std::fs::create_dir_all(shadow.parent().unwrap()).unwrap();
        std::fs::write(&shadow, vec![7u8; 100]).unwrap();

        assert!(rescue_interrupted_take(&connection, &settings, &db_path).is_none());
        assert!(!shadow.exists(), "and it does not sit there for ever");
        assert!(db::list_recordings(&connection).unwrap().is_empty());
    }

    /// Nothing at all is the ordinary case: every start must not pay for this.
    #[test]
    fn an_ordinary_start_finds_nothing_to_rescue() {
        let (connection, settings, db_path) = archive("clean");
        assert!(rescue_interrupted_take(&connection, &settings, &db_path).is_none());
    }
}
