//! The console closing under a running transcription.
//!
//! In raw mode Ctrl+C is a key, and the screen asks before it stops anything.
//! What is left for the console to say is that it is going away: its window
//! closed, the SSH connection dropped, the user logged off. Windows ends the
//! process as soon as the handler returns from such an event, so the handler
//! stops the run and waits for the engine to write down that it stopped — up
//! to four of the five seconds Windows allows — or the recording would stay
//! marked as transcribing and block every later run in both programs.

use std::sync::{Condvar, Mutex};
use volocal_lib::transcription::TranscriptionTask;

static CURRENT: Mutex<Option<(TranscriptionTask, String)>> = Mutex::new(None);
static ENDED: (Mutex<bool>, Condvar) = (Mutex::new(true), Condvar::new());

/// Holds the run as the current one until it is dropped.
pub struct Watched;

impl Drop for Watched {
    fn drop(&mut self) {
        *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let (ended, signal) = &ENDED;
        *ended.lock().unwrap_or_else(|e| e.into_inner()) = true;
        signal.notify_all();
    }
}

/// From here until the guard goes, closing the console stops this run first.
pub fn watch(task: &TranscriptionTask, id: &str) -> Watched {
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = Some((task.clone(), id.to_string()));
    *ENDED.0.lock().unwrap_or_else(|e| e.into_inner()) = false;
    Watched
}

#[cfg(windows)]
pub fn install() {
    use windows::core::BOOL;
    use windows::Win32::Foundation::TRUE;
    use windows::Win32::System::Console::{
        SetConsoleCtrlHandler, CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT,
    };

    unsafe extern "system" fn handler(kind: u32) -> BOOL {
        if [CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT].contains(&kind) {
            if let Some((task, id)) = CURRENT.lock().unwrap_or_else(|e| e.into_inner()).clone() {
                task.cancel(&id);
            }
            let (ended, signal) = &ENDED;
            let guard = ended.lock().unwrap_or_else(|e| e.into_inner());
            let _ = signal
                .wait_timeout_while(guard, std::time::Duration::from_secs(4), |ended| !*ended);
        }
        // Ctrl+C and Ctrl+Break are keys the screen answers; nothing here ends
        // the program under it.
        TRUE
    }
    // SAFETY: the handler reads two statics and never frees anything.
    let _ = unsafe { SetConsoleCtrlHandler(Some(handler), true) };
}

#[cfg(not(windows))]
pub fn install() {}
