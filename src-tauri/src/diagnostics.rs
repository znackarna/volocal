//! Where a line of diagnostics goes once the program is not run from a
//! terminal.
//!
//! `#![windows_subsystem = "windows"]` gives a released build no console, so
//! every `eprintln!` in it is written to a handle that leads nowhere. That is
//! fine for most of them, and it is not fine for the handful that are the only
//! record of something the person may later have to be told about: a backup
//! that failed before a schema upgrade, settings that could not be read and
//! were copied aside, transcriptions recovered after a crash, child processes
//! that may have outlived the window.
//!
//! So the same line goes to stderr — which is what `tauri dev` shows, and that
//! stays as it was — and to one file beside the archive. Deliberately not a
//! logging library: there is no level to filter on, no target to route by, and
//! nothing here is written in a loop. What is needed is a file somebody can be
//! asked to send.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Set once the archive's location is known, because that is where the file
/// belongs — next to the thing most of these lines are about, and in the
/// folder a portable copy carries with it.
static FILE: OnceLock<PathBuf> = OnceLock::new();

/// Above this the file starts again from empty. A cap rather than rotation:
/// these lines are rare, and the alternative is a second file to explain to
/// somebody who is already reporting a problem.
const MAX_BYTES: u64 = 512 * 1024;

pub fn set_file(archive: &Path) {
    let file = archive
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("slobot-log.txt");
    let _ = FILE.set(file);
}

/// Never fails and never panics: a diagnostic that could take the application
/// down would be worse than the failure it describes.
pub fn write(message: std::fmt::Arguments) {
    eprintln!("{message}");
    let Some(path) = FILE.get() else {
        return;
    };
    if std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        let _ = std::fs::remove_file(path);
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{stamp}  {message}");
    }
}

/// Reads like `eprintln!` on purpose, so replacing one with the other at the
/// call site changes nothing but where the line ends up.
#[macro_export]
macro_rules! note {
    ($($arg:tt)*) => {
        $crate::diagnostics::write(format_args!($($arg)*))
    };
}
