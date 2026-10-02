//! `volocal-cli` — the archive, from a terminal.
//!
//! A second program over the same engine as the window (`volocal_lib`), and
//! the same archive: a recording listed or exported here is the recording the
//! window shows. Planned in `docs/cli.md` and `docs/cli-plan.md`.
//!
//! **A console program, deliberately a separate one.** The window is built with
//! `windows_subsystem = "windows"`, which leaves it no console, so anything it
//! printed from a terminal would go nowhere.
//!
//! **It moves nothing it did not make.** The archive is found by
//! `find_archive`, which looks where the window looks without finishing the
//! window's start-up migrations, and an existing file is never overwritten
//! unless `--force` says so.

use clap::{Parser, Subcommand, ValueEnum};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use volocal_lib::db::{self, Recording};
use volocal_lib::user_message::UserMessage;
use volocal_lib::{export, find_archive, tools};

#[derive(Parser)]
#[command(
    name = "volocal-cli",
    version,
    about = "Volocal's archive from the command line",
    long_about = "Volocal's archive from the command line.\n\n\
        Works on the same archive as the Volocal window: what you list or \
        export here is what the window shows. Start Volocal once first, \
        which creates the archive and downloads what transcription needs."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Show where the archive is and what is installed
    Status,

    /// List recordings, newest first
    List {
        /// Show only recordings whose transcript contains this text
        #[arg(long)]
        search: Option<String>,
        /// Show only recordings in the folder with this name
        #[arg(long)]
        folder: Option<String>,
    },

    /// Show one recording in detail
    Show {
        /// The recording's id, or the first few characters of it
        id: String,
    },

    /// Write a recording's transcript to a file
    Export {
        /// The recording's id, or the first few characters of it
        id: String,
        /// The format to write
        #[arg(long, value_enum)]
        format: TextFormat,
        /// Where to write it [default: the recording's title, here]
        #[arg(long)]
        out: Option<PathBuf>,
        /// Overwrite the file if it already exists
        #[arg(long)]
        force: bool,
    },

    /// Write a recording's audio to a file
    ExportAudio {
        /// The recording's id, or the first few characters of it
        id: String,
        /// The format to write
        #[arg(long, value_enum)]
        format: AudioFormat,
        /// Where to write it [default: the recording's title, here]
        #[arg(long)]
        out: Option<PathBuf>,
        /// Overwrite the file if it already exists
        #[arg(long)]
        force: bool,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum TextFormat {
    /// Plain text
    Txt,
    /// Markdown, with speakers and times
    Md,
    /// Subtitles for editors and players
    Srt,
    /// Subtitles for the web
    Vtt,
    /// Everything in the transcript, for further processing
    Json,
}

#[derive(Clone, Copy, ValueEnum)]
enum AudioFormat {
    Mp3,
    M4a,
    Wav,
}

impl TextFormat {
    fn extension(self) -> &'static str {
        match self {
            TextFormat::Txt => "txt",
            TextFormat::Md => "md",
            TextFormat::Srt => "srt",
            TextFormat::Vtt => "vtt",
            TextFormat::Json => "json",
        }
    }
}

impl AudioFormat {
    fn extension(self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::M4a => "m4a",
            AudioFormat::Wav => "wav",
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli.command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command) -> Result<(), String> {
    let archive = find_archive()
        .ok_or("no Volocal archive was found. Start Volocal once, which creates it.".to_string())?;
    let connection = db::open(&archive).map_err(|error| format!("{error:#}"))?;
    let settings = db::load_settings(&connection).map_err(|error| format!("{error:#}"))?;

    match command {
        Command::Status => status(&archive, &settings),
        Command::List { search, folder } => list(&connection, search, folder),
        Command::Show { id } => show(&connection, &id),
        Command::Export {
            id,
            format,
            out,
            force,
        } => {
            let recording = find_recording(&connection, &id)?;
            let target = destination(&recording, format.extension(), out, force)?;
            let segments = db::segments(&connection, &recording.id).map_err(|e| e.to_string())?;
            if segments.is_empty() {
                return Err(format!(
                    "\"{}\" has no transcript yet, so there is nothing to export.",
                    recording.title
                ));
            }
            let speakers = db::speakers(&connection, &recording.id).map_err(|e| e.to_string())?;
            let text = match format {
                TextFormat::Txt => export::txt(&segments, &speakers),
                TextFormat::Md => export::markdown(&recording, &segments, &speakers),
                TextFormat::Srt => export::srt(&segments),
                TextFormat::Vtt => export::vtt(&segments),
                TextFormat::Json => export::json(&recording, &segments, &speakers),
            };
            std::fs::write(&target, text).map_err(|e| e.to_string())?;
            println!("{}", target.display());
            Ok(())
        }
        Command::ExportAudio {
            id,
            format,
            out,
            force,
        } => {
            let recording = find_recording(&connection, &id)?;
            let target = destination(&recording, format.extension(), out, force)?;
            export::audio(&settings, Path::new(&recording.path), &target).map_err(describe)?;
            println!("{}", target.display());
            Ok(())
        }
    }
}

fn status(archive: &Path, settings: &db::Settings) -> Result<(), String> {
    let check = tools::check(settings);
    let found = |value: &Option<String>| value.clone().unwrap_or_else(|| "missing".to_string());
    println!("archive      {}", archive.display());
    println!("ffmpeg       {}", found(&check.ffmpeg));
    println!("whisper      {}", found(&check.whisper_cli));
    println!(
        "model        {}",
        check
            .model_whisper_id
            .clone()
            .unwrap_or_else(|| "missing".to_string())
    );
    println!("runs on      {}", check.compute);
    if let Some(gigabytes) = check.memory_gb {
        println!("memory       {gigabytes} GB");
    }
    if check.issues.is_empty() {
        println!("ready        yes");
    } else {
        println!("ready        no");
        for issue in &check.issues {
            println!("  - {}", describe(issue.clone()));
        }
    }
    Ok(())
}

fn list(
    connection: &rusqlite::Connection,
    search: Option<String>,
    folder: Option<String>,
) -> Result<(), String> {
    if let Some(query) = search {
        let hits = db::search(connection, &query).map_err(|e| e.to_string())?;
        if hits.is_empty() {
            println!("nothing found");
        }
        for hit in hits {
            println!(
                "{}  {}  {}  {}",
                short(&hit.recording_id),
                clock(hit.start),
                hit.title,
                highlight(hit.text.trim())
            );
        }
        return Ok(());
    }

    let folder_id = match folder {
        None => None,
        Some(name) => {
            let folders = db::folders(connection).map_err(|e| e.to_string())?;
            let found = folders
                .into_iter()
                .find(|f| f.name.eq_ignore_ascii_case(&name))
                .ok_or(format!("there is no folder called \"{name}\""))?;
            Some(found.id)
        }
    };
    let recordings = db::list_recordings(connection).map_err(|e| e.to_string())?;
    let shown: Vec<&Recording> = recordings
        .iter()
        .filter(|r| folder_id.is_none() || r.folder == folder_id)
        .collect();
    if shown.is_empty() {
        println!("no recordings");
    }
    for recording in shown {
        println!(
            "{}  {}  {:>8}  {:<12}  {}",
            short(&recording.id),
            recording
                .created_at
                .get(..10)
                .unwrap_or(&recording.created_at),
            clock(recording.duration),
            recording.status,
            recording.title
        );
    }
    Ok(())
}

fn show(connection: &rusqlite::Connection, id: &str) -> Result<(), String> {
    let recording = find_recording(connection, id)?;
    let speakers = db::speakers(connection, &recording.id).map_err(|e| e.to_string())?;
    println!("id           {}", recording.id);
    println!("title        {}", recording.title);
    println!("file         {}", recording.path);
    println!("recorded     {}", recording.created_at);
    println!("length       {}", clock(recording.duration));
    println!("status       {}", recording.status);
    if !recording.language.is_empty() {
        println!("language     {}", recording.language);
    }
    if !recording.model.is_empty() {
        println!("model        {}", recording.model);
    }
    println!("blocks       {}", recording.segment_count);
    if !speakers.is_empty() {
        let names: Vec<&str> = speakers.iter().map(|s| s.name.as_str()).collect();
        println!("speakers     {}", names.join(", "));
    }
    if let Some(url) = &recording.source_url {
        println!("source       {url}");
    }
    if let Some(error) = &recording.error {
        println!("error        {error}");
    }
    Ok(())
}

/// A recording by its id or a prefix of it, as `git` takes a short hash: ids
/// are long, and the first few characters `list` prints are enough to name one.
fn find_recording(connection: &rusqlite::Connection, id: &str) -> Result<Recording, String> {
    let recordings = db::list_recordings(connection).map_err(|e| e.to_string())?;
    let mut matches = recordings.into_iter().filter(|r| r.id.starts_with(id));
    let first = matches.next().ok_or(format!(
        "there is no recording whose id starts with \"{id}\""
    ))?;
    if matches.next().is_some() {
        return Err(format!(
            "more than one recording's id starts with \"{id}\"; give more of it"
        ));
    }
    Ok(first)
}

/// Where a file is written: where it was asked for, or the recording's title
/// in the current folder. Never over an existing file without `--force` — a
/// command run twice in a script must not quietly destroy the first result.
fn destination(
    recording: &Recording,
    extension: &str,
    out: Option<PathBuf>,
    force: bool,
) -> Result<PathBuf, String> {
    let target = out.unwrap_or_else(|| {
        let plain: String = recording
            .title
            .chars()
            .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
            .collect();
        let plain = if plain.trim().is_empty() {
            "recording".to_string()
        } else {
            plain
        };
        PathBuf::from(format!("{plain}.{extension}"))
    });
    if target.exists() && !force {
        return Err(format!(
            "{} already exists; add --force to overwrite it",
            target.display()
        ));
    }
    Ok(target)
}

/// The search marks each match `<<like this>>`, which the window draws as a
/// highlight. In a terminal it becomes bold; written to a file or a pipe the
/// marks are taken out, because there they are only noise in the text.
fn highlight(text: &str) -> String {
    use std::io::IsTerminal;
    if std::io::stdout().is_terminal() {
        text.replace("<<", "[1m").replace(">>", "[0m")
    } else {
        text.replace("<<", "").replace(">>", "")
    }
}

fn short(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

fn clock(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// A message from the engine in the words the window would use.
///
/// The engine returns codes, and the text for them lives in the window's
/// dictionary. Reading the English half of that dictionary here, rather than
/// writing a second set of sentences, keeps one text per message for both
/// programs — the same reason the window's notices are never written in Rust.
fn describe(message: UserMessage) -> String {
    let template = english_errors()
        .get(message.code.as_str())
        .cloned()
        .unwrap_or_else(|| message.code.clone());
    let mut text = template.clone();
    for (key, value) in &message.params {
        text = text.replace(&format!("{{{key}}}"), value);
    }
    if !message.detail.is_empty() && !template.contains("{detail}") {
        text = format!("{text} ({})", message.detail);
    }
    text
}

fn english_errors() -> &'static HashMap<String, String> {
    static ERRORS: std::sync::OnceLock<HashMap<String, String>> = std::sync::OnceLock::new();
    ERRORS.get_or_init(|| parse_errors(include_str!("../../../src/locales/en/errors.ts")))
}

/// `"errors.x.y": "text",` — and a value may be split over lines and joined with
/// `+`. Only the code after `errors.` is kept, which is what the engine names.
fn parse_errors(source: &str) -> HashMap<String, String> {
    let entry =
        regex::Regex::new(r#"(?s)"errors\.([a-z0-9_.]+)"\s*:\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)"#)
            .expect("the pattern is fixed");
    let piece = regex::Regex::new(r#""((?:[^"\\]|\\.)*)""#).expect("the pattern is fixed");
    entry
        .captures_iter(source)
        .map(|c| {
            let value: String = piece
                .captures_iter(&c[2])
                .map(|p| p[1].replace("\\\"", "\"").replace("\\\\", "\\"))
                .collect();
            (c[1].to_string(), value)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_english_messages_the_window_uses() {
        let errors = english_errors();
        assert!(errors.len() > 100, "the dictionary has more than a hundred");
        assert!(errors
            .get("audio_export.unsupported_format")
            .is_some_and(|t| !t.is_empty()));
    }

    #[test]
    fn joins_a_message_split_over_lines() {
        let parsed = parse_errors("  \"errors.a.b\":\n    \"one \" +\n    \"two\",\n");
        assert_eq!(parsed.get("a.b").map(String::as_str), Some("one two"));
    }

    #[test]
    fn fills_in_the_parameters() {
        let message = UserMessage::new("transcription.whisper_failed").with("code", 10);
        assert!(describe(message).contains("10"));
    }

    #[test]
    fn a_code_with_no_text_says_the_code() {
        assert_eq!(describe(UserMessage::new("no.such.code")), "no.such.code");
    }

    #[test]
    fn writes_clock_times_the_way_the_window_does() {
        assert_eq!(clock(14.0), "0:14");
        assert_eq!(clock(4354.0), "1:12:34");
    }
}
