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
    /* **Nothing is refused any more; a second ask joins the queue.** This used
    to be two guards and an error — *Stahování už probíhá, počkejte na jeho
    dokončení* — which is a red bar for the ordinary act of pressing a second
    row while the first one is coming down, and it was said on the models
    page, in the wizard and in Settings alike.

    Both guards were about the same danger and it has not gone away: two
    runs fetching one component write one file and both report progress for
    it. `install_bundle` answers it by dropping an id it is already fetching
    or already holds, which is the refusal kept where it belongs — per
    component, inside the thing that knows.

    The cancellation flag is cleared there too, and only when a worker is
    actually started. Clearing it here, on the way in to every call, is the
    defect this comment used to describe from the other side: asking for a
    second component wiped the stop request the running worker was watching. */
    download::install_bundle(window, settings, ids, app.download_cancellation.clone());
    Ok(())
}

/// Stops everything: the component in hand and the whole queue behind it.
///
/// The guided first run's `Přerušit` and nothing else. There the download *is*
/// the errand, and one press meaning one component would leave four more coming
/// down behind a screen that says it stopped.
#[tauri::command]
pub fn cancel_download(app: State<'_, AppState>) {
    app.download_cancellation.store(true, Ordering::Relaxed);
}

/// Stops one component and leaves the queue alone.
///
/// What the stop square on a row means, and it had meant the other thing —
/// *když jsem měl něco ve frontě a zrušil jsem to, automaticky se smazala celá
/// fronta, ne jen to, co jsem stopnul*. A control drawn per row answers for its
/// row.
///
/// A component still waiting is taken out here and reported here, because no
/// worker will ever reach it to report it itself. One being fetched is left to
/// the worker: it has a part-written file to flush first, and a component
/// reported as stopped while its bytes were still landing would be the same
/// kind of lie in the other direction.
#[tauri::command]
pub fn cancel_component(window: tauri::AppHandle, id: String) {
    if download::cancel_component(&id) {
        download::emit_cancelled(&window, &id);
    }
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
        return Err(UserMessage::new("download.busy_installing"));
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
