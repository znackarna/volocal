//! A transcription running in `volocal-cli`, as the window can see it.
//!
//! **The archive cannot say who is working.** A row marked as transcribing
//! looks the same whether a program is behind it or a crash left it there,
//! and until the command line existed the window was the only program that
//! could have been: at its start, every such row was a leftover, and
//! `recover_interrupted` marked it as failed. With the command line running
//! beside it, that turned a live forty-minute run into an error with a *Zkusit
//! znovu* button, which started a second whisper beside the first.
//!
//! **So the command line holds a file while it works**, `running\<id>.lock`
//! beside the archive, opened so that nobody else can open it and so that
//! Windows deletes it when the handle closes. Windows closes it however the
//! program ends — finished, stopped, killed, crashed — so a lock is never left
//! behind to lie. Asking is trying to open it: a sharing violation means a
//! program is holding it right now.
//!
//! **The window holds one file of its own, for as long as it is open**:
//! `running\window.open`, by the same rule. Its runs are in its own queue
//! already; what the command line needs from it is only whether it is there.
//! A row marked as transcribing with neither a command line holding it nor a
//! window open is then known to be a leftover of a crash (2026-10-08). With
//! no command line running the window behaves exactly as it did before.
//!
//! Windows only, like the program. Elsewhere nothing is held and nothing is
//! found.

use std::path::{Path, PathBuf};

/// Held while a transcription runs; dropping it lets the lock go.
pub struct Held {
    #[cfg(windows)]
    _file: std::fs::File,
}

fn folder(archive: &Path) -> PathBuf {
    archive
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("running")
}

/// The window's presence, beside the recordings' locks. Not ending in
/// `.lock`, so it is never taken for a run.
const WINDOW: &str = "window.open";

/// Takes the lock for one recording. `None` when it could not be taken, in
/// which case the run goes ahead as it always did — the lock only ever adds
/// protection, it never stands in the way of a transcription.
#[cfg(windows)]
pub fn hold(archive: &Path, recording_id: &str) -> Option<Held> {
    take(archive, &format!("{recording_id}.lock"))
}

/// Says that the window is open, until the returned value is dropped — which
/// the window does by exiting. `None` when it could not be taken; the command
/// line then simply does not learn that the window is there.
#[cfg(windows)]
pub fn hold_window(archive: &Path) -> Option<Held> {
    take(archive, WINDOW)
}

#[cfg(windows)]
fn take(archive: &Path, name: &str) -> Option<Held> {
    use std::os::windows::fs::OpenOptionsExt;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    // Deleting on close needs the right to delete.
    const DELETE: u32 = 0x0001_0000;
    const FILE_FLAG_DELETE_ON_CLOSE: u32 = 0x0400_0000;

    let directory = folder(archive);
    std::fs::create_dir_all(&directory).ok()?;
    let path = directory.join(name);
    // A window looking at the same moment holds it open for a few
    // microseconds; one more try after a pause is enough.
    for _ in 0..10 {
        let opened = std::fs::OpenOptions::new()
            .access_mode(GENERIC_READ | GENERIC_WRITE | DELETE)
            .create(true)
            .write(true)
            .share_mode(0)
            .custom_flags(FILE_FLAG_DELETE_ON_CLOSE)
            .open(&path);
        if let Ok(file) = opened {
            return Some(Held { _file: file });
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    crate::note!("run lock: could not take {}", path.display());
    None
}

#[cfg(not(windows))]
pub fn hold(_archive: &Path, _recording_id: &str) -> Option<Held> {
    None
}

#[cfg(not(windows))]
pub fn hold_window(_archive: &Path) -> Option<Held> {
    None
}

/// Whether the window is open right now.
#[cfg(windows)]
pub fn window_open(archive: &Path) -> bool {
    is_held(&folder(archive).join(WINDOW))
}

#[cfg(not(windows))]
pub fn window_open(_archive: &Path) -> bool {
    false
}

/// A file somebody holds open without sharing. One that opens is nobody's —
/// a handle can only have gone without the file going with it if the disk was
/// pulled away — and is removed.
#[cfg(windows)]
fn is_held(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    match std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
    {
        Err(e) => e.raw_os_error() == Some(ERROR_SHARING_VIOLATION),
        Ok(file) => {
            drop(file);
            let _ = std::fs::remove_file(path);
            false
        }
    }
}

/// The recordings some program is transcribing right now with a lock held.
#[cfg(windows)]
pub fn held_elsewhere(archive: &Path) -> Vec<String> {
    let mut held: Vec<String> = held_since(archive).into_iter().map(|(id, _)| id).collect();
    held.sort();
    held
}

/// The runs the run holding `mine` has to wait for: those whose lock was
/// taken before its own, so that two command lines started together queue in
/// the order they arrived instead of each waiting for the other for ever, as
/// both did until 2026-10-08. Two locks taken in the same instant are put in
/// order by id. Without a lock of its own, a run waits for every one there is.
#[cfg(windows)]
pub fn held_before(archive: &Path, mine: &str) -> Vec<String> {
    let held = held_since(archive);
    let Some(own) = held.iter().find(|(id, _)| id == mine).map(|(_, at)| *at) else {
        return held.into_iter().map(|(id, _)| id).collect();
    };
    held.into_iter()
        .filter(|(id, at)| id != mine && (*at < own || (*at == own && id.as_str() < mine)))
        .map(|(id, _)| id)
        .collect()
}

/// Every held lock with the moment it was taken. The time comes from the
/// folder listing, which needs no handle on a file nobody may open.
#[cfg(windows)]
fn held_since(archive: &Path) -> Vec<(String, std::time::SystemTime)> {
    let Ok(entries) = std::fs::read_dir(folder(archive)) else {
        return Vec::new();
    };
    let mut held = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(id) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".lock"))
            .map(str::to_string)
        else {
            continue;
        };
        let taken = entry
            .metadata()
            .and_then(|m| m.created())
            .unwrap_or(std::time::UNIX_EPOCH);
        // Being deleted as we look, or unreadable: not a run.
        if is_held(&path) {
            held.push((id, taken));
        }
    }
    held
}

#[cfg(not(windows))]
pub fn held_elsewhere(_archive: &Path) -> Vec<String> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn held_before(_archive: &Path, _mine: &str) -> Vec<String> {
    Vec::new()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// A fresh folder for one test, removed when the guard goes.
    struct Scratch(PathBuf);

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn archive() -> (Scratch, PathBuf) {
        let directory =
            std::env::temp_dir().join(format!("volocal-run-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("volocal.db");
        (Scratch(directory), path)
    }

    #[test]
    fn nothing_is_held_where_nothing_ever_ran() {
        let (_directory, archive) = archive();
        assert!(held_elsewhere(&archive).is_empty());
    }

    #[test]
    fn a_held_lock_is_seen_and_goes_with_its_holder() {
        let (_directory, archive) = archive();
        let held = hold(&archive, "rec-1").expect("the lock is taken");
        assert_eq!(held_elsewhere(&archive), vec!["rec-1".to_string()]);
        // Nobody else gets it while it is held.
        assert!(std::fs::OpenOptions::new()
            .read(true)
            .open(folder(&archive).join("rec-1.lock"))
            .is_err());
        drop(held);
        assert!(held_elsewhere(&archive).is_empty());
        assert!(
            !folder(&archive).join("rec-1.lock").exists(),
            "deleted on close"
        );
    }

    #[test]
    fn two_runs_queue_in_the_order_they_took_their_locks() {
        let (_directory, archive) = archive();
        let first = hold(&archive, "rec-b").expect("first");
        // File times on Windows are 100 ns; a pause keeps the two apart.
        std::thread::sleep(std::time::Duration::from_millis(30));
        let second = hold(&archive, "rec-a").expect("second");
        assert!(
            held_before(&archive, "rec-b").is_empty(),
            "the first waits for nobody"
        );
        assert_eq!(held_before(&archive, "rec-a"), vec!["rec-b".to_string()]);
        drop(first);
        assert!(
            held_before(&archive, "rec-a").is_empty(),
            "then the second goes"
        );
        drop(second);
    }

    #[test]
    fn a_run_without_a_lock_waits_for_every_one() {
        let (_directory, archive) = archive();
        let held = hold(&archive, "rec-1").expect("taken");
        assert_eq!(held_before(&archive, "other"), vec!["rec-1".to_string()]);
        drop(held);
    }

    #[test]
    fn the_window_is_seen_while_it_is_open_and_is_never_a_run() {
        let (_directory, archive) = archive();
        assert!(!window_open(&archive));
        let open = hold_window(&archive).expect("taken");
        assert!(window_open(&archive));
        assert!(held_elsewhere(&archive).is_empty(), "not a recording");
        drop(open);
        assert!(!window_open(&archive));
    }

    #[test]
    fn a_file_nobody_holds_is_not_a_run() {
        let (_directory, archive) = archive();
        std::fs::create_dir_all(folder(&archive)).unwrap();
        std::fs::write(folder(&archive).join("stale.lock"), "").unwrap();
        assert!(held_elsewhere(&archive).is_empty());
        assert!(!folder(&archive).join("stale.lock").exists(), "tidied away");
    }
}
