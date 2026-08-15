//! Reading and writing the application settings.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::db::Settings;
use crate::{db, tools};
use crate::{reported, AppState, Reported};
use tauri::State;
// ---------------------------------------------------------------- settings

#[tauri::command]
pub fn load_settings(app: State<'_, AppState>) -> Reported<Settings> {
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
pub fn save_settings(app: State<'_, AppState>, settings: Settings) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::save_settings(&db, &settings))
}

#[tauri::command]
pub fn check_tools(app: State<'_, AppState>) -> Reported<tools::ToolCheck> {
    let db = app.db.lock().unwrap();
    let n = reported(db::load_settings(&db))?;
    Ok(tools::check(&n))
}

/// Where the log file is, so the window can open the folder holding it.
///
/// The report covers the ordinary case. This is for the one it cannot: a
/// transcription that took an hour and left more in the log than sixty lines,
/// or a problem somebody wants to look at themselves.
#[tauri::command]
pub fn log_directory() -> Option<String> {
    crate::diagnostics::file_path().map(|path| path.to_string_lossy().to_string())
}

/// Everything worth knowing when something has gone wrong, as one block of text.
///
/// Written because of an evening spent guessing. Speech detection came up
/// switched off after an install; the only evidence was a sentence describing
/// it, and the stored settings were read hours later, after they had already
/// been put right. What was missing was not a feature but a way to hand the
/// state over.
///
/// It is deliberately plain text and deliberately assembled here rather than in
/// the window: this is the side that can see the settings as they are stored,
/// the tools as they are found, and the log.
///
/// Nothing in it is sent anywhere. It is put on the clipboard and the person
/// decides what to do with it — which is also why it carries no file names from
/// the archive and no transcript text. Paths to the *tools* are in it, because
/// a wrong path is the failure being described half the time; a path can name
/// the account the machine is logged in as, and that is the most personal thing
/// here.
#[tauri::command]
pub fn diagnostic_report(app: State<'_, AppState>) -> Reported<String> {
    use std::fmt::Write;

    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    let found = tools::check(&settings);
    let mut out = String::new();

    let _ = writeln!(out, "Volocal {}", env!("CARGO_PKG_VERSION"));
    let _ = writeln!(out, "{} {}", std::env::consts::OS, std::env::consts::ARCH);
    let _ = writeln!(
        out,
        "portable: {}   webview2 bundled: {}",
        found.portable, found.webview2_bundled
    );
    let _ = writeln!(out, "archive: {}", app.db_path.display());
    if let Some(log) = crate::diagnostics::file_path() {
        let _ = writeln!(out, "log: {}", log.display());
    }

    let _ = writeln!(out, "\n-- what is transcribing --");
    let _ = writeln!(out, "model: {}", settings.model);
    let _ = writeln!(
        out,
        "compute: {} (chosen: {}, on disk: {})",
        tools::choose_compute(&tools::expand(&settings.bin_directory), &settings.compute),
        settings.compute,
        found.available_compute_backends.join(", ")
    );
    let _ = writeln!(
        out,
        "nvidia driver: {}   language: {}",
        found.nvidia_driver, settings.language
    );
    // Always on now; only the threshold is still worth reporting.
    let _ = writeln!(
        out,
        "speech detection: on (threshold {})",
        settings.vad_threshold
    );
    let _ = writeln!(
        out,
        "speakers: {} (count {}, clustering {})",
        settings.diarization, settings.speaker_count, settings.cluster_threshold
    );
    let _ = writeln!(
        out,
        "beam: {}   threads: {}   entropy: {}",
        settings.beam, settings.threads, settings.entropy_threshold
    );

    // The same list the panel above the button shows, in the same order, so
    // that a report and a screenshot of that panel say the same thing.
    let _ = writeln!(out, "\n-- components --");
    for (name, path) in [
        ("ffmpeg", &found.ffmpeg),
        ("ffprobe", &found.ffprobe),
        ("whisper-cli", &found.whisper_cli),
        ("whisper model", &found.model_whisper),
        ("vad model", &found.model_vad),
        ("embedding model", &found.embedding_model),
        ("editor", &found.editor_cli),
        ("editor model", &found.editor_model),
    ] {
        let _ = writeln!(
            out,
            "{name}: {}",
            path.as_deref().unwrap_or("— not found —")
        );
    }

    let lines = crate::diagnostics::recent_lines();
    let _ = writeln!(out, "\n-- log, last {} lines --", lines.len());
    if lines.is_empty() {
        let _ = writeln!(out, "(nothing written yet)");
    }
    for line in lines {
        let _ = writeln!(out, "{line}");
    }

    Ok(out)
}
