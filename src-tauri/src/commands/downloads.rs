//! Fetching the tools and models, and reporting how far that got.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::user_message::UserMessage;
use crate::{db, download};
use crate::{reported, AppState, Reported};
use std::sync::atomic::Ordering;
use tauri::State;
// ---------------------------------------------------------------- downloads

#[tauri::command]
pub fn catalog(app: State<'_, AppState>) -> Reported<Vec<download::DownloadComponent>> {
    let db = app.db.lock().unwrap();
    let settings = reported(db::load_settings(&db))?;
    Ok(download::catalog(&settings))
}

#[tauri::command]
pub fn download(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    ids: Vec<String>,
) -> Reported<()> {
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
pub fn cancel_download(app: State<'_, AppState>) {
    app.download_cancellation.store(true, Ordering::Relaxed);
}

/// Deletes one installed component from the disk.
///
/// **Every guard the screen applies is applied again here**, and that is
/// deliberate rather than belt-and-braces: the window draws no bin on a row it
/// must not delete, but a drawing is not a guard. `settings.model` and
/// `editor_model` name the files that are working right now, and removing one
/// leaves the application resolving a path that has gone — the same failure
/// this branch met from the other direction this morning, when a model was
/// written into settings before it had landed.
///
/// `async`, like the portable copy and for the same reason: a seven-gigabyte
/// model is not deleted between two frames on every disk.
#[tauri::command(async)]
pub fn remove_component(app: State<'_, AppState>, id: String) -> Reported<()> {
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    // Not while something is landing in the same folders. The installer writes
    // through temporary names and renames into place; deleting underneath it is
    // the one way to get a half-installed component that still records itself
    // as complete.
    if download::is_installing() {
        return Err(UserMessage::new("download.already_running"));
    }
    if download::component_is_in_use(&settings, &id) {
        return Err(UserMessage::new("download.component_in_use").with("component", &id));
    }
    download::remove_component(&settings, &id)
}

/// `async`, and of the four this is the one that could not be anything else:
/// it copies the programs and the models, up to about ten gigabytes, and it
/// reports its own progress to the window as it goes. On the window's thread
/// that progress could not be drawn — the interface was frozen for the whole
/// copy, so the one command with a progress bar was the one that could not
/// show it moving.
#[tauri::command(async)]
pub fn create_portable_copy(
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
