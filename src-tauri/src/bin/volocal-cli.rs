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
use std::sync::{Arc, Mutex, OnceLock};
use volocal_lib::db::{self, Recording};
use volocal_lib::transcription::{self, Report, TranscriptionTask};
use volocal_lib::user_message::UserMessage;
use volocal_lib::{create_recording, export, find_archive, prepare_import, tools};

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

    /// Add an audio or video file to the archive and transcribe it
    #[command(
        long_about = "Add an audio or video file to the archive and transcribe it.\n\n\
        Uses the model and the other choices made in the Volocal window. A second \
        language heard in the recording is written in as well. Progress goes to the error stream; when it is done, the \
        new recording's id is printed, ready for `export`. Ctrl+C stops the \
        transcription and keeps the recording in the archive."
    )]
    Transcribe {
        /// The file to transcribe
        file: PathBuf,
        /// The language spoken, as a code such as cs or en [default: the window's choice]
        #[arg(long)]
        language: Option<String>,
        /// Tell the speakers apart, and how many there are; 0 when you do not know
        /// [default: as set in the window]
        #[arg(long, value_name = "COUNT")]
        speakers: Option<i64>,
    },

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
    // The engine's diagnostics go to the window's log file beside the archive,
    // not between the lines this program prints.
    volocal_lib::diagnostics::set_file(&archive);
    volocal_lib::diagnostics::keep_off_the_terminal();
    let connection = db::open(&archive).map_err(|error| format!("{error:#}"))?;
    let settings = db::load_settings(&connection).map_err(|error| format!("{error:#}"))?;

    match command {
        Command::Status => status(&archive, &settings),
        Command::Transcribe {
            file,
            language,
            speakers,
        } => transcribe(&archive, &connection, &settings, file, language, speakers),
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

/// The window's own transcription, reporting here instead of to the window.
///
/// **One at a time, across both programs.** The window queues its own runs,
/// but it cannot see this one, and two whisper processes on one machine take
/// memory from each other — a memory failure is what a user hit on
/// 24 September. So this refuses while the archive says something is being
/// transcribed, before the file is added, so a refusal leaves nothing behind.
fn transcribe(
    archive: &Path,
    connection: &rusqlite::Connection,
    settings: &db::Settings,
    file: PathBuf,
    language: Option<String>,
    speakers: Option<i64>,
) -> Result<(), String> {
    let recordings = db::list_recordings(connection).map_err(|e| e.to_string())?;
    if let Some(busy) = recordings
        .iter()
        .find(|r| r.status == db::status::TRANSCRIBING)
    {
        return Err(format!(
            "\"{}\" is being transcribed already. Wait until it finishes; \
             two transcriptions at once can run out of memory.",
            busy.title
        ));
    }
    if !file.is_file() {
        return Err(format!("{} is not a file", file.display()));
    }

    let (file, duration) = prepare_import(settings, archive, file).map_err(describe)?;
    let recording = create_recording(connection, file, duration).map_err(describe)?;
    if let Some(language) = &language {
        db::set_language_choice(connection, &recording.id, language).map_err(|e| e.to_string())?;
    }

    let task = TranscriptionTask::default();
    let id = recording.id.clone();
    stop_on_ctrl_c(&task, &id);
    eprintln!("{}", recording.title);
    let stopped = |ending: Ending| match ending {
        Ending::Cancelled => format!(
            "stopped. The recording stays in the archive as {}",
            short(&id)
        ),
        Ending::Failed(message) => describe(message),
    };
    follow(|report| transcription::transcribe(report, archive, &id, &task, speakers))
        .map_err(stopped)?;
    // A second language heard and not written in is an offer the window shows
    // and waits on. Here there is nobody to ask, and a language left out is
    // half of a translated talk, so the offer is taken — before the speakers,
    // so the blocks it adds are told apart with the rest.
    let offer = db::second_language(connection, &id).map_err(|e| e.to_string())?;
    if let Some(offer) = offer.filter(|o| o.state == db::second_language_state::OFFERED) {
        eprintln!("also spoken: {}", offer.language);
        write_in_second_language(archive, &id, &task).map_err(stopped)?;
    }
    // With speaker recognition switched on in the window, the transcription
    // above has already told the speakers apart. With it off, the window
    // never asks for a count, so `--speakers` runs the pass the window offers
    // for a finished transcript.
    if speakers.is_some() && !settings.diarization {
        follow(|report| transcription::recognise_speakers(report, archive, &id, &task, speakers))
            .map_err(stopped)?;
    }
    println!("{id}");
    Ok(())
}

enum Ending {
    Cancelled,
    Failed(UserMessage),
}

/// Runs one piece of the engine's work with its progress drawn here, and says
/// how it ended. The engine reports its end through the same event as its
/// steps, as it does to the window.
fn follow(work: impl FnOnce(&Report)) -> Result<(), Ending> {
    let (report, ending) = drawn();
    work(&report);
    progress_done();
    let ending = ending.lock().unwrap().take();
    match ending {
        Some((phase, _)) if phase == "complete" => Ok(()),
        Some((phase, _)) if phase == "cancelled" => Err(Ending::Cancelled),
        Some((_, message)) => Err(Ending::Failed(message)),
        None => Err(Ending::Failed(
            UserMessage::new("unknown").detail("the work ended without saying how"),
        )),
    }
}

/// The second language, written in. Its end is not an event but the answer
/// the fill returns — the window announces it itself — so it is read from
/// there.
fn write_in_second_language(
    archive: &Path,
    id: &str,
    task: &TranscriptionTask,
) -> Result<(), Ending> {
    let (report, _) = drawn();
    let (done, cancelled) = transcription::fill_second_language(&report, archive, id, task);
    progress_done();
    match done {
        _ if cancelled => Err(Ending::Cancelled),
        Err(message) => Err(Ending::Failed(message)),
        Ok(_) => Ok(()),
    }
}

/// A report that draws each step here, and keeps how the work ended.
type Ended = Arc<Mutex<Option<(String, UserMessage)>>>;

fn drawn() -> (Report, Ended) {
    let ending: Ended = Arc::default();
    let report = {
        let ending = ending.clone();
        let shown = Mutex::new(String::new());
        Report::Callback(Arc::new(move |event, payload| {
            if event != "transcription:status" {
                return;
            }
            let phase = payload["phase"].as_str().unwrap_or_default().to_string();
            let percent = payload["percent"].as_u64().unwrap_or(0);
            let Ok(message) = serde_json::from_value::<UserMessage>(payload["description"].clone())
            else {
                return;
            };
            if matches!(phase.as_str(), "complete" | "cancelled" | "error") {
                *ending.lock().unwrap() = Some((phase, message));
                return;
            }
            progress(&mut shown.lock().unwrap(), percent, &tell(&message));
        }))
    };
    (report, ending)
}

/// Ctrl+C asks the run to stop, the way the window's `Zrušit` does, rather
/// than ending the program under it: whisper is started without a console of
/// its own and would not hear the key, and the row would stay marked as
/// transcribing, which the guard above then reads as busy.
#[cfg(windows)]
fn stop_on_ctrl_c(task: &TranscriptionTask, id: &str) {
    use windows::core::BOOL;
    use windows::Win32::Foundation::TRUE;
    use windows::Win32::System::Console::SetConsoleCtrlHandler;

    static RUN: OnceLock<(TranscriptionTask, String)> = OnceLock::new();
    unsafe extern "system" fn handler(_kind: u32) -> BOOL {
        if let Some((task, id)) = RUN.get() {
            task.cancel(id);
        }
        TRUE
    }
    let _ = RUN.set((task.clone(), id.to_string()));
    // SAFETY: the handler only reads a value set once above and never freed.
    let _ = unsafe { SetConsoleCtrlHandler(Some(handler), true) };
}

#[cfg(not(windows))]
fn stop_on_ctrl_c(_task: &TranscriptionTask, _id: &str) {}

/// One line that keeps being rewritten in a terminal; written to a file, a new
/// line only when the step changes, because a log of percentages helps no one.
fn progress(shown: &mut String, percent: u64, text: &str) {
    use std::io::IsTerminal;
    if std::io::stderr().is_terminal() {
        eprint!("\r\x1b[K{percent:>3} %  {text}");
    } else if shown != text {
        eprintln!("{text}");
    }
    *shown = text.to_string();
}

fn progress_done() {
    use std::io::IsTerminal;
    if std::io::stderr().is_terminal() {
        eprintln!();
    }
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
        text.replace("<<", "\x1b[1m").replace(">>", "\x1b[0m")
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
    fill(english_errors().get(message.code.as_str()), &message)
}

/// A step of a running transcription, from the window's progress dictionary.
/// A failure arrives through the same event, so a code that is not a step is
/// looked up among the errors.
fn tell(message: &UserMessage) -> String {
    let template = english_progress()
        .get(message.code.as_str())
        .or_else(|| english_errors().get(message.code.as_str()));
    fill(template, message)
}

fn fill(template: Option<&String>, message: &UserMessage) -> String {
    let template = template.cloned().unwrap_or_else(|| message.code.clone());
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
    static ERRORS: OnceLock<HashMap<String, String>> = OnceLock::new();
    ERRORS.get_or_init(|| {
        parse_dictionary(include_str!("../../../src/locales/en/errors.ts"), "errors")
    })
}

fn english_progress() -> &'static HashMap<String, String> {
    static PROGRESS: OnceLock<HashMap<String, String>> = OnceLock::new();
    PROGRESS.get_or_init(|| {
        parse_dictionary(
            include_str!("../../../src/locales/en/progress.ts"),
            "progress",
        )
    })
}

/// `"errors.x.y": "text",` — and a value may be split over lines and joined with
/// `+`. Only the code after the prefix is kept, which is what the engine names.
fn parse_dictionary(source: &str, prefix: &str) -> HashMap<String, String> {
    let entry = regex::Regex::new(&format!(
        r#"(?s)"{prefix}\.([a-z0-9_.]+)"\s*:\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)"#
    ))
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

/// The reference in `docs/cli.md`, built from the program's own help.
///
/// **The documentation is a snapshot of `--help`, not a second text.**
/// `the_documentation_is_the_help` below fails whenever the two differ, so a
/// command cannot be added, renamed or reworded without the reference saying
/// so — the same discipline `docs-check.mjs` keeps over `SECURITY.md`.
///
/// Only the test calls it, so only the test build carries it.
#[cfg(test)]
fn reference() -> String {
    use clap::CommandFactory;

    // Only what the help does not say. What the program is and that the window
    // has to be started once are its first lines, just below.
    const INTRO: &[&str] = &[
        "# volocal-cli",
        "",
        "Installed beside the application, in the same folder.",
        "",
        "*Generated from the program's own help. After changing a command, run*",
        "`UPDATE_CLI_DOCS=1 cargo test --manifest-path src-tauri/Cargo.toml --bin volocal-cli`.",
    ];
    // The help names the program by its file name as the system reports it;
    // the reference names it as people type it, the same on every machine.
    let help = |text: String| text.replace("volocal-cli.exe", "volocal-cli");

    let mut cli = Cli::command();
    let mut out = INTRO.join("\n");
    out.push_str("\n\n## volocal-cli\n\n```text\n");
    out.push_str(&help(cli.render_long_help().to_string()));
    out.push_str("```\n");
    for sub in cli.get_subcommands_mut() {
        let name = sub.get_name().to_string();
        if name == "help" {
            continue;
        }
        out.push_str(&format!("\n## {name}\n\n```text\n"));
        out.push_str(&help(sub.render_long_help().to_string()));
        out.push_str("```\n");
    }
    out
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
        let parsed = parse_dictionary(
            "  \"errors.a.b\":\n    \"one \" +\n    \"two\",\n",
            "errors",
        );
        assert_eq!(parsed.get("a.b").map(String::as_str), Some("one two"));
    }

    #[test]
    fn says_a_step_in_the_window_words() {
        assert_eq!(
            tell(&UserMessage::new("transcription.running")),
            "Transcribing"
        );
        let failure = UserMessage::new("audio_export.unsupported_format");
        assert_eq!(tell(&failure), describe(failure.clone()));
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

    /// `docs/cli.md` is the help, word for word. Set `UPDATE_CLI_DOCS=1` to
    /// write it after changing a command; without it the test only compares.
    #[test]
    fn the_documentation_is_the_help() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/cli.md");
        let wanted = reference();
        if std::env::var_os("UPDATE_CLI_DOCS").is_some() {
            std::fs::write(&path, &wanted).unwrap();
            return;
        }
        // Git on Windows may hand the file back with CRLF; the help has LF.
        let have = std::fs::read_to_string(&path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        assert!(
            have == wanted,
            "docs/cli.md no longer matches the program's help. Regenerate it with: \
             UPDATE_CLI_DOCS=1 cargo test --manifest-path src-tauri/Cargo.toml --bin volocal-cli"
        );
    }
}
