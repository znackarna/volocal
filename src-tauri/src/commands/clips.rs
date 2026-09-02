//! Cutting one stretch out of a finished transcript: its text, its subtitles,
//! its audio.
//!
//! **Nothing here is stored.** A clip is a selection that makes files, not an
//! object with a life of its own — storing them would mean a table, a list, a
//! rule about what happens to a clip when its transcript is rewritten, and all
//! of it in service of something whose entire value is the file that comes
//! out. If saved clips ever earn their keep, that is a feature of its own.
//!
//! The audio is written through a temporary file beside the destination and
//! renamed once it is whole, so a cancelled or failed cut never leaves half a
//! file wearing the name of a finished one.

use crate::user_message::UserMessage;
use crate::{db, export, tools};
use crate::{reported, AppState, Reported};
use std::path::{Path, PathBuf};
use tauri::State;

/// What the reader will get, so the dialog can show it before it is written.
#[tauri::command]
pub fn clip_preview(
    app: State<'_, AppState>,
    id: String,
    from: f64,
    to: f64,
    format: String,
    from_zero: bool,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let speakers = reported(db::speakers(&db, &id))?;
    let all = reported(db::segments(&db, &id))?;
    Ok(text_of(
        &recording, &speakers, &all, from, to, &format, from_zero,
    ))
}

fn text_of(
    recording: &db::Recording,
    speakers: &[db::Speaker],
    all: &[db::Segment],
    from: f64,
    to: f64,
    format: &str,
    from_zero: bool,
) -> String {
    let chosen = export::between(all, from, to);
    // The speakers come from the whole recording, not from the clip, so a clip
    // that starts mid-conversation still names whoever is talking — and one
    // crossing from one voice to another is right without being asked.
    let shown = if from_zero {
        export::from_zero(&chosen, from)
    } else {
        chosen
    };
    export::create(format, recording, &shown, speakers)
}

#[tauri::command]
pub fn save_clip_text(
    app: State<'_, AppState>,
    id: String,
    from: f64,
    to: f64,
    format: String,
    path: String,
    from_zero: bool,
) -> Reported<String> {
    let contents = clip_preview(app, id, from, to, format, from_zero)?;
    std::fs::write(&path, contents)
        .map_err(|error| UserMessage::new("file.write_failed").detail(error))?;
    Ok(path)
}

/// The audio between two instants, re-encoded rather than copied — see
/// `tools::cut_arguments` for why that is not a preference.
///
/// On a blocking thread: ffmpeg on a few minutes is a second or two, and the
/// window has to stay answerable while it runs.
#[tauri::command]
pub async fn save_clip_audio(
    app: State<'_, AppState>,
    id: String,
    from: f64,
    to: f64,
    path: String,
) -> Reported<String> {
    let (source, ffmpeg) = {
        let db = app.db.lock().unwrap();
        let recording = reported(db::recording(&db, &id))?;
        let settings = reported(db::load_settings(&db))?;
        let check = tools::check(&settings);
        let ffmpeg = check
            .ffmpeg
            .clone()
            .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;
        (PathBuf::from(recording.path), PathBuf::from(ffmpeg))
    };
    if !source.is_file() {
        return Err(UserMessage::new("playback.source_missing"));
    }
    // Writing a clip over the recording it is cut from would destroy the
    // source mid-read. The same guard the audio export uses.
    if super::backups::points_at_the_same_file(&source, Path::new(&path)) {
        return Err(UserMessage::new("file.same_file"));
    }

    let destination = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || {
        let half_written = beside(&destination);
        let cut = tools::cut_audio(
            &ffmpeg,
            &source,
            &half_written,
            from,
            to,
            &tools::PlainRunner,
        );
        if let Err(error) = cut {
            let _ = std::fs::remove_file(&half_written);
            return Err(error);
        }
        std::fs::rename(&half_written, &destination).map_err(|error| {
            let _ = std::fs::remove_file(&half_written);
            UserMessage::new("file.write_failed").detail(error)
        })?;
        Ok(destination.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| UserMessage::new("file.write_failed").detail(error))?
}

/// Where the half-written clip lives: beside its destination, so the rename
/// that finishes it stays on one volume and is therefore atomic.
fn beside(destination: &Path) -> PathBuf {
    let name = destination
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "clip".into());
    destination.with_file_name(format!(".{name}.part"))
}

/// A name that says which recording and which minutes, so a folder of clips
/// stays readable: `Porada 12-04 - 14-31.srt`.
#[tauri::command]
pub fn suggested_clip_name(
    app: State<'_, AppState>,
    id: String,
    from: f64,
    to: f64,
    format: String,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    Ok(clip_name(
        &recording.title,
        from,
        to,
        &format,
        &recording.path,
    ))
}

fn clip_name(title: &str, from: f64, to: f64, format: &str, source: &str) -> String {
    let plain = |text: &str| -> String {
        text.chars()
            .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
            .collect()
    };
    // The colon of a timestamp is not allowed in a file name, so the span is
    // written with hyphens: 12-04 - 14-31.
    let stamp = |t: f64| export::format_duration(t).replace(':', "-");
    let extension = if format == "audio" {
        // The clip keeps the recording's own container, so it plays wherever
        // the recording does.
        Path::new(source)
            .extension()
            .map(|e| e.to_string_lossy().into_owned())
            .unwrap_or_else(|| "mp3".into())
    } else {
        export::extension(format).to_string()
    };
    format!(
        "{} {} - {}.{}",
        plain(title),
        stamp(from),
        stamp(to),
        extension
    )
}

#[cfg(test)]
mod tests {
    use super::clip_name;

    #[test]
    fn a_clip_is_named_by_its_recording_and_its_minutes() {
        assert_eq!(
            clip_name("Porada 12. 8.", 724.0, 871.0, "srt", "C:/a/porada.mp3"),
            "Porada 12. 8. 12-04 - 14-31.srt"
        );
    }

    /// The audio keeps the recording's own container, so the clip plays
    /// wherever the recording plays.
    #[test]
    fn an_audio_clip_takes_the_extension_of_its_source() {
        assert_eq!(
            clip_name("Rozhovor", 0.0, 61.0, "audio", "C:/a/rozhovor.m4a"),
            "Rozhovor 0-00 - 1-01.m4a"
        );
    }

    /// A recording named after a date holds characters Windows will not take.
    #[test]
    fn characters_a_file_name_cannot_hold_are_replaced() {
        assert_eq!(
            clip_name("Q1: plán/rozpočet", 0.0, 5.0, "txt", "x.wav"),
            "Q1- plán-rozpočet 0-00 - 0-05.txt"
        );
    }
}
