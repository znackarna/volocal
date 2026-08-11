//! Letting the updater's installer outlive the window it was started from.

use crate::Reported;

/// The one command the update path needs from the Rust side.
///
/// The window calls it immediately before `downloadAndInstall`, and everything
/// it does is explained at `crate::let_the_installer_out` — briefly: the
/// installer would otherwise be killed by the job object that keeps whisper and
/// ffmpeg from outliving the window.
#[tauri::command]
pub fn let_the_installer_out() -> Reported<()> {
    crate::let_the_installer_out()
}
