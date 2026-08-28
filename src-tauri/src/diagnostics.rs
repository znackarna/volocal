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
        .join("volocal-log.txt");
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

/// How much of the log the report carries.
///
/// The end of it, because a problem is described soon after it happens. Sixty
/// lines is a few sessions' worth — enough to see the start that led to it,
/// short enough to stay a message rather than an attachment.
const REPORT_LINES: usize = 60;

/// Sends a panic to the log as well as to stderr, which in a released build
/// leads nowhere.
///
/// **The one event most worth having was the one not being kept.** Every
/// `note!` in this program describes something that went wrong and was handled;
/// a panic is the case where nothing was, and until this hook it left no trace
/// at all outside `tauri dev`. Somebody reporting that Volocal "just closed"
/// had a log with nothing in it around the moment it closed.
///
/// The default hook still runs afterwards, so `tauri dev` prints exactly what
/// it printed before and a debugger sees what it saw.
///
/// The payload is read as it comes: `panic!` with a formatted string leaves a
/// `String`, a bare literal leaves a `&str`, and anything else leaves a type
/// this cannot name — which is worth saying rather than dropping the line.
pub fn catch_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let said = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "a payload of some other type".to_string());
        let where_at = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "an unknown place".to_string());
        // The thread, because a panic in a worker leaves the window standing
        // and a panic on the main thread does not - and the person reporting it
        // describes two different faults.
        let thread = std::thread::current();
        let who = thread.name().unwrap_or("unnamed").to_string();
        write(format_args!("panic on thread {who} at {where_at}: {said}"));
        previous(info);
    }));
}

/// The tail of the log file, oldest first, or nothing if there is no file yet.
pub fn recent_lines() -> Vec<String> {
    let Some(path) = FILE.get() else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    lines
        .iter()
        .skip(lines.len().saturating_sub(REPORT_LINES))
        .map(|l| (*l).to_string())
        .collect()
}

/// Where the log is, so the report can say where the rest of it lives.
pub fn file_path() -> Option<PathBuf> {
    FILE.get().cloned()
}

/// Writes a report about a start that failed, beside the log, and says where.
///
/// The button that copies the technical details lives in Settings, and Settings
/// needs the application to have started. So the one moment somebody most needs
/// to hand the state over is the moment they cannot reach the thing that hands
/// it over — they get a dialog they cannot select text in, and a sentence in
/// this file is the only other trace.
///
/// A file rather than the clipboard: nothing is running that could put anything
/// on a clipboard, and a path can be read out of a dialog and typed.
pub fn write_problem_report(text: &str) -> Option<PathBuf> {
    let path = FILE.get()?.with_file_name("volocal-problem.txt");
    std::fs::write(&path, text).ok()?;
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The hook has to survive a panic that is caught, which is the only way to
    /// raise one in a test without ending it. `FILE` is a `OnceLock` set once
    /// per process, so this is the single test that may set it and the whole
    /// journey is checked in one go: install, panic, and read the file back.
    #[test]
    fn a_panic_reaches_the_log_file() {
        // The same `std::env::temp_dir()` the other tests here use, rather than
        // a new dependency for one folder.
        let folder = std::env::temp_dir().join("volocal-panic-log");
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        // `set_file` takes the archive and writes beside it.
        set_file(&folder.join("whisp.db"));
        catch_panics();

        let raised = std::panic::catch_unwind(|| panic!("a wheel came off"));
        assert!(raised.is_err(), "the panic has to have happened");

        let written = std::fs::read_to_string(file_path().unwrap()).unwrap();
        assert!(
            written.contains("a wheel came off"),
            "the log has to carry what was said: {written}"
        );
        assert!(
            written.contains("diagnostics.rs"),
            "and where it was said: {written}"
        );
        // The thread is in there because a panic in a worker leaves the window
        // standing and one on the main thread does not.
        assert!(
            written.contains("panic on thread"),
            "and by whom: {written}"
        );
    }
}
