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
//! **The window holds none.** Its own runs are in its own queue already; what
//! it needs to know is only what the other program is doing. With no command
//! line running, the folder is empty or absent and every answer here is
//! "nothing", so the window behaves exactly as it did before this existed.
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

/// Takes the lock for one recording. `None` when it could not be taken, in
/// which case the run goes ahead as it always did — the lock only ever adds
/// protection, it never stands in the way of a transcription.
#[cfg(windows)]
pub fn hold(archive: &Path, recording_id: &str) -> Option<Held> {
    use std::os::windows::fs::OpenOptionsExt;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    // Deleting on close needs the right to delete.
    const DELETE: u32 = 0x0001_0000;
    const FILE_FLAG_DELETE_ON_CLOSE: u32 = 0x0400_0000;

    let directory = folder(archive);
    std::fs::create_dir_all(&directory).ok()?;
    let path = directory.join(format!("{recording_id}.lock"));
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

/// The recordings some program is transcribing right now with a lock held.
///
/// A lock file that opens is nobody's — a handle can only have gone without
/// the file going with it if the disk was pulled away — and is removed.
#[cfg(windows)]
pub fn held_elsewhere(archive: &Path) -> Vec<String> {
    use std::os::windows::fs::OpenOptionsExt;
    const ERROR_SHARING_VIOLATION: i32 = 32;

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
        else {
            continue;
        };
        match std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
        {
            Err(e) if e.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => {
                held.push(id.to_string())
            }
            Ok(file) => {
                drop(file);
                let _ = std::fs::remove_file(&path);
            }
            // Being deleted as we look, or unreadable: not a run.
            Err(_) => {}
        }
    }
    held.sort();
    held
}

#[cfg(not(windows))]
pub fn held_elsewhere(_archive: &Path) -> Vec<String> {
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
    fn a_file_nobody_holds_is_not_a_run() {
        let (_directory, archive) = archive();
        std::fs::create_dir_all(folder(&archive)).unwrap();
        std::fs::write(folder(&archive).join("stale.lock"), "").unwrap();
        assert!(held_elsewhere(&archive).is_empty());
        assert!(!folder(&archive).join("stale.lock").exists(), "tidied away");
    }
}
