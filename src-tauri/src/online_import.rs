//! Import audio from a public web link through yt-dlp.
//!
//! The downloaded media becomes an ordinary local recording. Keeping the
//! boundary here means transcription and playback do not need a special case
//! for YouTube or any other supported site.

use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::user_message::UserMessage;
use crate::{db, download, tools};

/// Result of anything that can end up in front of the user.
type Reported<T> = std::result::Result<T, UserMessage>;

const DOWNLOADER_COMPONENT: &str = "yt-dlp";
const JAVASCRIPT_COMPONENT: &str = "deno";

#[derive(Clone, Default)]
pub struct OnlineImportTask {
    current: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

impl OnlineImportTask {
    pub fn begin(&self) -> Reported<Arc<AtomicBool>> {
        let mut current = self.current.lock().unwrap();
        if current.is_some() {
            return Err(UserMessage::new("online_import.already_running"));
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        *current = Some(cancellation.clone());
        Ok(cancellation)
    }

    pub fn cancel(&self) {
        if let Some(cancellation) = self.current.lock().unwrap().as_ref() {
            cancellation.store(true, Ordering::Relaxed);
        }
    }

    /// Is an import happening? At most one ever is — `begin` refuses a second —
    /// so this is the whole question. The module listing asks it before it
    /// offers to delete yt-dlp, its JavaScript, or the ffmpeg that takes the
    /// sound out of what they fetched.
    pub fn is_running(&self) -> bool {
        self.current.lock().unwrap().is_some()
    }

    pub fn finish(&self, completed: &Arc<AtomicBool>) {
        let mut current = self.current.lock().unwrap();
        if current
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, completed))
        {
            *current = None;
        }
    }
}

#[derive(Clone, Serialize)]
pub struct OnlineImportProgress {
    pub phase: String,
    pub percent: u32,
    /// What is happening right now; the window puts it into words.
    pub message: UserMessage,
}

fn emit_progress(app: &AppHandle, phase: &str, percent: u32, message: UserMessage) {
    let _ = app.emit(
        "online-import:progress",
        OnlineImportProgress {
            phase: phase.into(),
            percent,
            message,
        },
    );
}

/// A caption that carries no values of its own.
fn step(code: &str) -> UserMessage {
    UserMessage::new(code)
}

fn validate_url(input: &str) -> Reported<String> {
    let parsed = reqwest::Url::parse(input.trim())
        .map_err(|error| UserMessage::new("online_import.invalid_url").detail(error))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(UserMessage::new("online_import.unsupported_scheme"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(UserMessage::new("online_import.credentials_in_url"));
    }
    Ok(parsed.into())
}

fn parse_percent(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()
        .map(|n| n.clamp(0.0, 100.0))
}

fn first_media_file(directory: &Path) -> Option<PathBuf> {
    const MEDIA_EXTENSIONS: &[&str] = &["m4a", "mp3", "aac", "opus", "ogg", "wav", "webm"];
    std::fs::read_dir(directory)
        .ok()?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .find(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| {
                        MEDIA_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
                    })
                    .unwrap_or(false)
        })
}

fn error_tail(value: &str) -> String {
    let lines: Vec<&str> = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    lines[lines.len().saturating_sub(8)..].join("\n")
}

pub fn import(
    app: &AppHandle,
    db_path: &Path,
    settings: &db::Settings,
    input_url: &str,
    cancellation: Arc<AtomicBool>,
) -> Reported<db::Recording> {
    let url = validate_url(input_url)?;
    let downloader = tools::component_path(settings, "bin/yt-dlp.exe");
    let javascript_runtime = tools::component_path(settings, "bin/deno.exe");

    if !downloader.is_file() {
        emit_progress(
            app,
            "preparing",
            2,
            step("online_import.preparing_downloader"),
        );
        download::install_component(app, settings, DOWNLOADER_COMPONENT, cancellation.clone())
            .map_err(|error| {
                UserMessage::new("online_import.downloader_setup_failed").detail(error)
            })?;
    }
    if cancellation.load(Ordering::Relaxed) {
        emit_progress(app, "cancelled", 0, step("online_import.cancelled"));
        return Err(UserMessage::new("online_import.cancelled"));
    }
    if !javascript_runtime.is_file() {
        emit_progress(
            app,
            "preparing",
            4,
            step("online_import.preparing_javascript"),
        );
        download::install_component(app, settings, JAVASCRIPT_COMPONENT, cancellation.clone())
            .map_err(|error| {
                UserMessage::new("online_import.javascript_setup_failed").detail(error)
            })?;
    }
    if cancellation.load(Ordering::Relaxed) {
        emit_progress(app, "cancelled", 0, step("online_import.cancelled"));
        return Err(UserMessage::new("online_import.cancelled"));
    }

    let check = tools::check(settings);
    let ffmpeg = check
        .ffmpeg
        .map(PathBuf::from)
        .ok_or_else(|| UserMessage::new("online_import.ffmpeg_missing"))?;
    let ffmpeg_directory = ffmpeg
        .parent()
        .ok_or_else(|| UserMessage::new("online_import.ffmpeg_path_invalid"))?;

    /* The finished file lands in the recordings folder with everything else the
    application owns — that folder exists so its owner can find this audio,
    and audio hidden under a UUID in a second place defeats it.
    The scratch directory stays: yt-dlp names the file from the video's own
    title, so the only way to know what it wrote is to give it a directory
    of its own and look. It is removed either way, on success and on every
    failure path below. */
    let import_id = uuid::Uuid::new_v4().to_string();
    let media_root = crate::commands::library::recordings_dir(settings, db_path);
    let output_directory = media_root.join(format!(".download-{import_id}"));
    std::fs::create_dir_all(&output_directory)
        .map_err(|error| UserMessage::new("online_import.directory_failed").detail(error))?;
    let output_template = output_directory.join("%(title).180B.%(ext)s");

    emit_progress(app, "preparing", 10, step("online_import.reading_info"));

    let mut child = tools::command(&downloader)
        .arg("--ignore-config")
        .arg("--no-playlist")
        .arg("--newline")
        .arg("--progress")
        .arg("--quiet")
        .arg("--encoding")
        .arg("utf-8")
        .arg("--windows-filenames")
        .arg("--progress-template")
        .arg("download:__WHISP_PROGRESS__%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s")
        .arg("--js-runtimes")
        .arg(format!("deno:{}", javascript_runtime.to_string_lossy()))
        .arg("--ffmpeg-location")
        .arg(ffmpeg_directory)
        /* YouTube's default players hand out an audio address that serves
        about a megabyte and then answers 403 to the rest, unless the request
        carries a PO token this application has no way to mint. The embedded
        web player's address has no such condition, so it is asked first;
        `default` stays behind it as the fallback for what that player will
        not open, and for every other site, which this argument never
        reaches — `--extractor-args` is addressed to youtube alone. */
        .arg("--extractor-args")
        .arg("youtube:player_client=web_embedded,default")
        .arg("--format")
        .arg("bestaudio/best")
        .arg("--extract-audio")
        .arg("--audio-format")
        .arg("m4a")
        .arg("--audio-quality")
        .arg("0")
        .arg("--output")
        .arg(&output_template)
        .arg(&url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .spawn()
        .map_err(|error| UserMessage::new("online_import.launch_failed").detail(error))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| UserMessage::new("online_import.stderr_unavailable"))?;
    let stderr_text = Arc::new(Mutex::new(String::new()));
    let stderr_copy = stderr_text.clone();
    let stderr_thread = std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = String::new();
        let _ = reader.read_to_string(&mut buffer);
        if let Ok(mut value) = stderr_copy.lock() {
            *value = buffer;
        }
    });

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| UserMessage::new("online_import.stdout_unavailable"))?;
    let (line_sender, line_receiver) = mpsc::channel();
    let stdout_thread = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(|line| line.ok()) {
            if line_sender.send(line).is_err() {
                break;
            }
        }
    });

    let mut stdout_open = true;
    let status =
        loop {
            if cancellation.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                let _ = std::fs::remove_dir_all(&output_directory);
                emit_progress(app, "cancelled", 0, step("online_import.cancelled"));
                return Err(UserMessage::new("online_import.cancelled"));
            }

            let next_line = if stdout_open {
                match line_receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(line) => Some(line),
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        stdout_open = false;
                        None
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => None,
                }
            } else {
                std::thread::sleep(Duration::from_millis(50));
                None
            };

            if let Some(line) = next_line {
                let clean = line.trim();
                if let Some(value) = clean.strip_prefix("__WHISP_PROGRESS__") {
                    let parts: Vec<&str> = value.split('|').collect();
                    if let Some(raw_percent) = parts.first().and_then(|part| parse_percent(part)) {
                        let percent = 10 + (raw_percent * 0.8).round() as u32;
                        let speed = parts.get(1).map(|part| part.trim()).unwrap_or("");
                        let eta = parts.get(2).map(|part| part.trim()).unwrap_or("");
                        let has_speed = !speed.is_empty() && speed != "N/A";
                        let has_eta = !eta.is_empty() && eta != "N/A";
                        // Speed and remaining time are optional, and the sentence
                        // reads differently with each of them, so each combination
                        // is its own entry rather than a phrase glued together here.
                        let message = match (has_speed, has_eta) {
                            (true, true) => UserMessage::new("online_import.downloading_speed_eta")
                                .with("speed", speed)
                                .with("eta", eta),
                            (true, false) => UserMessage::new("online_import.downloading_speed")
                                .with("speed", speed),
                            (false, true) => {
                                UserMessage::new("online_import.downloading_eta").with("eta", eta)
                            }
                            (false, false) => UserMessage::new("online_import.downloading"),
                        };
                        if raw_percent >= 99.5 {
                            emit_progress(app, "converting", 92, step("online_import.converting"));
                        } else {
                            emit_progress(app, "downloading", percent.min(90), message);
                        }
                    }
                }
            }

            if let Some(status) = child.try_wait().map_err(|error| {
                UserMessage::new("online_import.status_unavailable").detail(error)
            })? {
                break status;
            }
        };
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    if !status.success() {
        let details = stderr_text
            .lock()
            .map(|value| error_tail(&value))
            .unwrap_or_default();
        let _ = std::fs::remove_dir_all(&output_directory);
        return Err(if details.is_empty() {
            UserMessage::new("online_import.download_failed")
        } else {
            UserMessage::new("online_import.download_failed_details").with("details", details)
        });
    }

    let path = first_media_file(&output_directory)
        .ok_or_else(|| UserMessage::new("online_import.no_media_file"))?;
    if cancellation.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&output_directory);
        emit_progress(app, "cancelled", 0, step("online_import.cancelled"));
        return Err(UserMessage::new("online_import.cancelled"));
    }
    let recording_title = path
        .file_stem()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Online nahrávka".into());

    /* Up out of the scratch directory, under the name the video gave it. A
    rename first because it is instant on the same volume; a copy is the
    fallback for the case where the recordings folder is on another disk. */
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "m4a".into());
    let final_path = crate::commands::library::free_path(&media_root, &recording_title, &extension);
    let moved = std::fs::rename(&path, &final_path).is_ok()
        || (std::fs::copy(&path, &final_path).is_ok() && std::fs::remove_file(&path).is_ok());
    let path = if moved { final_path } else { path };
    if moved {
        let _ = std::fs::remove_dir_all(&output_directory);
    }

    let duration = check
        .ffprobe
        .as_ref()
        .and_then(|probe| tools::audio_duration(Path::new(probe), &path).ok())
        .unwrap_or(0.0);

    let recording = db::Recording {
        id: uuid::Uuid::new_v4().to_string(),
        path: path.to_string_lossy().to_string(),
        title: recording_title,
        duration,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        status: db::status::NEW.into(),
        model: String::new(),
        language: String::new(),
        language_choice: String::new(),
        error: None,
        segment_count: 0,
        // Everything arriving from outside lands in the archive's root; a
        // folder is a decision the person makes afterwards.
        folder: None,
    };
    let connection = db::open(db_path)?;
    db::insert_recording(&connection, &recording)?;
    emit_progress(app, "complete", 100, step("online_import.complete"));
    Ok(recording)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_web_urls() {
        assert!(validate_url("https://www.youtube.com/watch?v=test").is_ok());
        assert!(validate_url("http://example.com/video").is_ok());
    }

    #[test]
    fn rejects_non_web_urls_and_credentials() {
        assert!(validate_url("file:///C:/secret.mp4").is_err());
        assert!(validate_url("https://name:password@example.com/video").is_err());
        assert!(validate_url("not a link").is_err());
    }

    #[test]
    fn cancellation_is_scoped_to_one_active_import() {
        let task = OnlineImportTask::default();
        let first = task.begin().unwrap();
        assert!(task.begin().is_err());
        task.cancel();
        assert!(first.load(Ordering::Relaxed));
        task.finish(&first);
        assert!(task.begin().is_ok());
    }
}
