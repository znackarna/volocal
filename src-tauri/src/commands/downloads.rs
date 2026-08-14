//! Fetching the tools and models, and reporting how far that got.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::user_message::UserMessage;
use crate::{db, download, tools};
use crate::{reported, AppState, Reported};
use std::sync::atomic::Ordering;
use tauri::State;
// ---------------------------------------------------------------- downloads

/// What the application is working on this moment, gathered from the registries
/// that already know rather than from a list kept in step by hand.
///
/// This is the one place all five are in scope, which is why the gathering is
/// here and the meaning — *which components does that make busy* — is in
/// `download.rs` beside the catalogue it decides about.
fn busy_now(app: &AppState) -> download::Busy {
    download::Busy {
        transcribing: app.bezici.anything_running(),
        editing: app.ai_edit.anything_running(),
        importing: app.online_import.is_running(),
        // Two kinds of ffmpeg that belong to no transcription: the waveform
        // under the player, and the seekable playback copy.
        converting: crate::waveform_running() || tools::playback_conversion_running(),
    }
}

#[tauri::command]
pub fn catalog(app: State<'_, AppState>) -> Reported<Vec<download::DownloadComponent>> {
    let busy = busy_now(&app);
    let db = app.db.lock().unwrap();
    let settings = reported(db::load_settings(&db))?;
    Ok(download::catalog(&settings, busy))
}

/// How much disk the tools and the models take, for the module card's second
/// row. Its first row — how many components are installed of how many are
/// offered — is counted in the window from the catalogue it already has.
///
/// Separate from `catalog` rather than folded into it: the listing asks for the
/// catalogue on every visit and after every download, and this walks two
/// folders. `async` for the same reason — a models folder of several gigabytes
/// is a few dozen directory reads, which is quick but is not something to do on
/// the window's own thread.
#[tauri::command(async)]
pub fn installed_megabytes(app: State<'_, AppState>) -> Reported<f64> {
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    Ok(download::installed_megabytes(&settings))
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
/// deliberate rather than belt-and-braces: the window draws a lock instead of a
/// bin on a row it must not delete, but a drawing is not a guard — and the
/// catalogue the screen drew from may be a second old, which is long enough for
/// a transcription to have started.
///
/// `async`, like the portable copy and for the same reason: a seven-gigabyte
/// model is not deleted between two frames on every disk.
#[tauri::command(async)]
pub fn remove_component(app: State<'_, AppState>, id: String) -> Reported<()> {
    let busy = busy_now(&app);
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
    if download::component_is_busy(&settings, &id, busy) {
        return Err(UserMessage::new("download.component_busy").with("component", &id));
    }
    download::remove_component(&settings, &id)?;

    // The files have gone, so nothing may go on naming them. `settings.model`
    // is resolved strictly as `ggml-{model}.bin` with no fallback, and a name
    // without a file is a transcription that refuses to start — the same defect
    // this branch fixed from the other direction, when a model was written into
    // settings before it had landed. The value written is the one the
    // confirmation named: both come from `replacement_component`.
    if let Some(repaired) = download::settings_after_removal(&settings, &id) {
        let db = app.db.lock().unwrap();
        reported(db::save_settings(&db, &repaired))?;
    }
    Ok(())
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
