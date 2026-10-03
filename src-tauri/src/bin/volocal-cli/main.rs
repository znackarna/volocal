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

mod common;
mod live;
mod look;
mod styled;

use clap::{Parser, Subcommand, ValueEnum};
use common::{clock, describe, describe_in, short, tell, tell_in, Lang};
use look::{Look, Stream};
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
        Err(problem) => {
            // A script reading standard error gets the `error:` line
            // `docs/cli.md` promises; a person, the same thing in a sentence.
            match Look::of(Stream::Err) {
                Some(look) => eprintln!(
                    "  {} {}",
                    look::paint(look::Role::Danger, look.glyphs().failed),
                    problem.said(look.lang)
                ),
                None => eprintln!("error: {}", problem.english()),
            }
            ExitCode::FAILURE
        }
    }
}

/// Why a command could not do what it was asked.
///
/// The English of each is exactly what the command line printed before it
/// spoke Czech, and `the_english_is_what_it_always_was` holds it there, since
/// scripts read it after `error:`. The Czech is for a person at a terminal.
enum Problem {
    /// Already words: the database's, or the operating system's.
    Text(String),
    /// The engine's, looked up in the window's dictionaries.
    Engine(UserMessage),
    NoArchive,
    NoTranscript(String),
    Busy(String),
    NotAFile(PathBuf),
    Stopped {
        id: String,
        title: String,
        kept: bool,
    },
    NoFolder(String),
    NoRecording(String),
    Ambiguous(String),
    Exists(PathBuf),
}

impl From<String> for Problem {
    fn from(text: String) -> Self {
        Problem::Text(text)
    }
}

impl Problem {
    fn english(&self) -> String {
        match self {
            Problem::Text(text) => text.clone(),
            Problem::Engine(message) => describe(message.clone()),
            Problem::NoArchive => {
                "no Volocal archive was found. Start Volocal once, which creates it.".to_string()
            }
            Problem::NoTranscript(title) => {
                format!("\"{title}\" has no transcript yet, so there is nothing to export.")
            }
            Problem::Busy(title) => format!(
                "\"{title}\" is being transcribed already. Wait until it finishes; \
                 two transcriptions at once can run out of memory."
            ),
            Problem::NotAFile(path) => format!("{} is not a file", path.display()),
            Problem::Stopped { id, .. } => format!(
                "stopped. The recording stays in the archive as {}",
                short(id)
            ),
            Problem::NoFolder(name) => format!("there is no folder called \"{name}\""),
            Problem::NoRecording(id) => {
                format!("there is no recording whose id starts with \"{id}\"")
            }
            Problem::Ambiguous(id) => {
                format!("more than one recording's id starts with \"{id}\"; give more of it")
            }
            Problem::Exists(path) => format!(
                "{} already exists; add --force to overwrite it",
                path.display()
            ),
        }
    }

    /// The same, for a person reading it in their language.
    fn said(&self, lang: Lang) -> String {
        match (self, lang) {
            (Problem::Engine(message), _) => describe_in(lang, message),
            (Problem::Stopped { title, kept, .. }, Lang::En) => {
                if *kept {
                    format!("Stopped. \"{title}\" stays in the archive with its transcript.")
                } else {
                    format!(
                        "Stopped. \"{title}\" stays in the archive without a transcript; \
                         the text so far was not kept."
                    )
                }
            }
            (Problem::Text(text), _) => text.clone(),
            (_, Lang::En) => {
                let english = self.english();
                let mut chars = english.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().chain(chars).collect(),
                    None => english,
                }
            }
            (Problem::NoArchive, Lang::Cs) => {
                "Archiv Volocalu jsme nenašli. Spusťte jednou aplikaci Volocal, ta ho vytvoří."
                    .to_string()
            }
            (Problem::NoTranscript(title), Lang::Cs) => {
                format!("Nahrávka „{title}“ zatím nemá přepis, není co ukládat.")
            }
            (Problem::Busy(title), Lang::Cs) => format!(
                "Nahrávka „{title}“ se právě přepisuje. Počkejte, až přepis skončí: \
                 dva přepisy najednou mohou vyčerpat paměť."
            ),
            (Problem::NotAFile(path), Lang::Cs) => format!("{} není soubor.", path.display()),
            (Problem::Stopped { title, kept, .. }, Lang::Cs) => {
                if *kept {
                    format!(
                        "Přepis je zastavený. Nahrávka „{title}“ zůstává v archivu i s přepisem."
                    )
                } else {
                    format!(
                        "Přepis je zastavený. Nahrávka „{title}“ zůstává v archivu bez přepisu, \
                         dosavadní text se neuložil."
                    )
                }
            }
            (Problem::NoFolder(name), Lang::Cs) => format!("Složka „{name}“ v archivu není."),
            (Problem::NoRecording(id), Lang::Cs) => {
                format!("Žádná nahrávka nemá id začínající „{id}“.")
            }
            (Problem::Ambiguous(id), Lang::Cs) => {
                format!("Id začínající „{id}“ má víc nahrávek. Zadejte ho delší.")
            }
            (Problem::Exists(path), Lang::Cs) => format!(
                "{} už existuje. Nahradit ho můžete přepínačem --force.",
                path.display()
            ),
        }
    }
}

fn run(command: Command) -> Result<(), Problem> {
    let archive = find_archive().ok_or(Problem::NoArchive)?;
    // The engine's diagnostics go to the window's log file beside the archive,
    // not between the lines this program prints.
    volocal_lib::diagnostics::set_file(&archive);
    volocal_lib::diagnostics::keep_off_the_terminal();
    // whisper and ffmpeg are started without a console of their own, so they
    // would not notice this program's terminal closing; tied to it, they end
    // with it. The same call the window makes for itself at its start.
    #[cfg(windows)]
    volocal_lib::die_with_this_process();
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
                return Err(Problem::NoTranscript(recording.title));
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
            match Look::of(Stream::Out) {
                Some(look) => print!("{}", styled::saved(&look, &target)),
                None => println!("{}", target.display()),
            }
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
            let turning = Look::of(Stream::Err)
                .map(|look| live::Turning::start(look, &format.extension().to_uppercase()));
            let exported = export::audio(&settings, Path::new(&recording.path), &target);
            drop(turning);
            exported.map_err(Problem::Engine)?;
            match Look::of(Stream::Out) {
                Some(look) => print!("{}", styled::saved(&look, &target)),
                None => println!("{}", target.display()),
            }
            Ok(())
        }
    }
}

fn status(archive: &Path, settings: &db::Settings) -> Result<(), Problem> {
    let check = tools::check(settings);
    if let Some(look) = Look::of(Stream::Out) {
        let issues: Vec<String> = check
            .issues
            .iter()
            .map(|issue| describe_in(look.lang, issue))
            .collect();
        print!("{}", styled::status(&look, archive, &check, &issues));
        return Ok(());
    }
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
) -> Result<(), Problem> {
    let recordings = db::list_recordings(connection).map_err(|e| e.to_string())?;
    if let Some(busy) = recordings
        .iter()
        .find(|r| r.status == db::status::TRANSCRIBING)
    {
        return Err(Problem::Busy(busy.title.clone()));
    }
    if !file.is_file() {
        return Err(Problem::NotAFile(file));
    }

    let (file, duration) = prepare_import(settings, archive, file).map_err(Problem::Engine)?;
    let recording = create_recording(connection, file, duration).map_err(Problem::Engine)?;
    if let Some(language) = &language {
        db::set_language_choice(connection, &recording.id, language).map_err(|e| e.to_string())?;
    }

    let task = TranscriptionTask::default();
    let id = recording.id.clone();
    // Tells the window this run is alive: it neither marks it as failed when
    // it starts nor starts a whisper of its own beside it. The lock goes when
    // this process does, however it ends.
    let _alive = volocal_lib::run_lock::hold(archive, &id);
    // Until this is dropped, closing the console waits for the run to end.
    let _ends = RunEnds;
    stop_on_ctrl_c(&task, &id);
    let look = Look::of(Stream::Err);
    let live = look.map(|look| {
        let check = tools::check(settings);
        let mut meta = vec![clock(recording.duration)];
        meta.extend(check.model_whisper_id.clone());
        meta.push(match check.compute.as_str() {
            "cuda" => "CUDA".to_string(),
            "vulkan" => "Vulkan".to_string(),
            other => other.to_uppercase(),
        });
        let header = format!(
            "{}  {}",
            look::paint(look::Role::Bold, &recording.title),
            look::paint(look::Role::Muted, &meta.join(" · "))
        );
        (live::Live::start(look, &header, recording.duration), look)
    });
    if live.is_none() {
        eprintln!("{}", recording.title);
    }
    let started = std::time::Instant::now();
    let stopped = |ending: Ending| match ending {
        Ending::Cancelled => Problem::Stopped {
            id: id.clone(),
            title: recording.title.clone(),
            kept: db::recording(connection, &id)
                .map(|r| r.segment_count > 0)
                .unwrap_or(false),
        },
        Ending::Failed(message) => Problem::Engine(message),
    };
    let mut written_in = None;
    let done = (|| -> Result<(), Problem> {
        follow(live.as_ref(), |report| {
            transcription::transcribe(report, archive, &id, &task, speakers)
        })
        .map_err(stopped)?;
        // A second language heard and not written in is an offer the window
        // shows and waits on. Here there is nobody to ask, and a language left
        // out is half of a translated talk, so the offer is taken — before the
        // speakers, so the blocks it adds are told apart with the rest.
        let offer = db::second_language(connection, &id).map_err(|e| e.to_string())?;
        if let Some(offer) = offer.filter(|o| o.state == db::second_language_state::OFFERED) {
            match &live {
                Some((live, _)) => live.next_run(),
                None => eprintln!("also spoken: {}", offer.language),
            }
            write_in_second_language(live.as_ref(), archive, &id, &task).map_err(stopped)?;
            written_in = Some(offer.language);
        }
        // With speaker recognition switched on in the window, the
        // transcription above has already told the speakers apart. With it
        // off, the window never asks for a count, so `--speakers` runs the
        // pass the window offers for a finished transcript.
        if speakers.is_some() && !settings.diarization {
            if let Some((live, _)) = &live {
                live.next_run();
            }
            follow(live.as_ref(), |report| {
                transcription::recognise_speakers(report, archive, &id, &task, speakers)
            })
            .map_err(stopped)?;
        }
        Ok(())
    })();
    if let Some((live, look)) = &live {
        let phases = live.finish();
        if done.is_ok() {
            if let Ok(finished) = db::recording(connection, &id) {
                let speakers = db::speakers(connection, &id).map(|s| s.len()).unwrap_or(0);
                eprint!(
                    "{}",
                    styled::summary(
                        look,
                        &styled::Summary {
                            took: started.elapsed().as_secs_f64(),
                            recording: &finished,
                            speakers,
                            second_language: written_in.as_deref(),
                            phases: &phases,
                        }
                    )
                );
            }
        }
    }
    done?;
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
fn follow(live: Option<&Shown>, work: impl FnOnce(&Report)) -> Result<(), Ending> {
    let (report, ending) = drawn(live);
    work(&report);
    if live.is_none() {
        progress_done();
    }
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
    live: Option<&Shown>,
    archive: &Path,
    id: &str,
    task: &TranscriptionTask,
) -> Result<(), Ending> {
    let (report, _) = drawn(live);
    let (done, cancelled) = transcription::fill_second_language(&report, archive, id, task);
    match live {
        Some((live, _)) => live.close_phase(),
        None => progress_done(),
    }
    match done {
        _ if cancelled => Err(Ending::Cancelled),
        Err(message) => Err(Ending::Failed(message)),
        Ok(_) => Ok(()),
    }
}

/// A report that draws each step here, and keeps how the work ended.
type Ended = Arc<Mutex<Option<(String, UserMessage)>>>;

/// The live block and the look it was started with, when standard error is a
/// person's terminal.
type Shown = (Arc<live::Live>, Look);

fn drawn(live: Option<&Shown>) -> (Report, Ended) {
    let ending: Ended = Arc::default();
    let live = live.cloned();
    let report = {
        let ending = ending.clone();
        let shown = Mutex::new(String::new());
        Report::Callback(Arc::new(move |event, payload| {
            if event == "transcription:segment" {
                if let Some((live, _)) = &live {
                    live.segment(
                        payload["start"].as_f64().unwrap_or(0.0),
                        payload["end"].as_f64().unwrap_or(0.0),
                        payload["text"].as_str().unwrap_or_default(),
                    );
                }
                return;
            }
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
                if let Some((live, _)) = &live {
                    live.close_phase();
                }
                *ending.lock().unwrap() = Some((phase, message));
                return;
            }
            match &live {
                Some((live, look)) => live.status(&phase, percent, &tell_in(look.lang, &message)),
                None => progress(&mut shown.lock().unwrap(), percent, &tell(&message)),
            }
        }))
    };
    (report, ending)
}

/// Ctrl+C asks the run to stop, the way the window's `Zrušit` does, rather
/// than ending the program under it: whisper is started without a console of
/// its own and would not hear the key, and the row would stay marked as
/// transcribing, which the guard above then reads as busy.
///
/// **Closing the console waits for the run to end.** Windows ends the process
/// as soon as the handler returns from a close, logoff or shutdown event — so
/// a handler that only asked for the stop let the process die before the
/// engine wrote down that it had stopped, and the row stayed marked as
/// transcribing. For those three it waits until `RunEnds` is dropped, up to
/// four of the five seconds Windows allows. Ctrl+C and Ctrl+Break return at
/// once, as before: the process is not ended under them.
#[cfg(windows)]
fn stop_on_ctrl_c(task: &TranscriptionTask, id: &str) {
    use windows::core::BOOL;
    use windows::Win32::Foundation::TRUE;
    use windows::Win32::System::Console::{
        SetConsoleCtrlHandler, CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT,
    };

    static RUN: OnceLock<(TranscriptionTask, String)> = OnceLock::new();
    unsafe extern "system" fn handler(kind: u32) -> BOOL {
        if let Some((task, id)) = RUN.get() {
            task.cancel(id);
        }
        if [CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT].contains(&kind) {
            let (ended, signal) = &RUN_ENDED;
            let guard = ended.lock().unwrap_or_else(|e| e.into_inner());
            let _ = signal
                .wait_timeout_while(guard, std::time::Duration::from_secs(4), |ended| !*ended);
        }
        TRUE
    }
    let _ = RUN.set((task.clone(), id.to_string()));
    // SAFETY: the handler only reads a value set once above and never freed.
    let _ = unsafe { SetConsoleCtrlHandler(Some(handler), true) };
}

#[cfg(not(windows))]
fn stop_on_ctrl_c(_task: &TranscriptionTask, _id: &str) {}

/// Whether the transcription this process started has ended, for the console
/// handler above.
static RUN_ENDED: (Mutex<bool>, std::sync::Condvar) =
    (Mutex::new(false), std::sync::Condvar::new());

/// Says the run has ended when it goes out of scope — on every way out of
/// `transcribe`, a panic included.
struct RunEnds;

impl Drop for RunEnds {
    fn drop(&mut self) {
        let (ended, signal) = &RUN_ENDED;
        *ended.lock().unwrap_or_else(|e| e.into_inner()) = true;
        signal.notify_all();
    }
}

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
) -> Result<(), Problem> {
    let look = Look::of(Stream::Out);
    if let Some(query) = search {
        let hits = db::search(connection, &query).map_err(|e| e.to_string())?;
        if let Some(look) = look {
            print!("{}", styled::search(&look, &hits));
            return Ok(());
        }
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
                .ok_or(Problem::NoFolder(name))?;
            Some(found.id)
        }
    };
    let recordings = db::list_recordings(connection).map_err(|e| e.to_string())?;
    let shown: Vec<&Recording> = recordings
        .iter()
        .filter(|r| folder_id.is_none() || r.folder == folder_id)
        .collect();
    if let Some(look) = look {
        print!("{}", styled::list(&look, connection, &shown));
        return Ok(());
    }
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

fn show(connection: &rusqlite::Connection, id: &str) -> Result<(), Problem> {
    let recording = find_recording(connection, id)?;
    let speakers = db::speakers(connection, &recording.id).map_err(|e| e.to_string())?;
    if let Some(look) = Look::of(Stream::Out) {
        print!("{}", styled::show(&look, &recording, &speakers));
        return Ok(());
    }
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
fn find_recording(connection: &rusqlite::Connection, id: &str) -> Result<Recording, Problem> {
    let recordings = db::list_recordings(connection).map_err(|e| e.to_string())?;
    let mut matches = recordings.into_iter().filter(|r| r.id.starts_with(id));
    let first = matches
        .next()
        .ok_or_else(|| Problem::NoRecording(id.to_string()))?;
    if matches.next().is_some() {
        return Err(Problem::Ambiguous(id.to_string()));
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
) -> Result<PathBuf, Problem> {
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
        return Err(Problem::Exists(target));
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
    // What a script calling the program relies on, which the help of no single
    // command says. Kept here, beside the code it describes, so a change to
    // the behaviour and to this text are one change.
    const FOR_SCRIPTS: &str = "\
## For scripts

- **The result goes to standard output, everything else to standard error.**
  `transcribe` prints the new recording's id and nothing more; `export` and
  `export-audio` print the path they wrote. Progress and errors go to standard
  error, so `id=$(volocal-cli transcribe talk.mp3)` captures the id alone.
- **Exit codes.** `0` when the command did what it was asked. `1` when it could
  not; the reason is the last line on standard error, starting `error:`. `2`
  when the command line itself was wrong, such as an unknown option.
- **Ids.** A command that takes an id also takes its first few characters, as
  long as only one recording starts with them. `list` prints eight.
- **Nothing is overwritten** without `--force`; the command fails instead.
- **One transcription at a time.** `transcribe` fails at once while anything in
  the archive is being transcribed, from the window or from another
  `volocal-cli`.
- **Ctrl+C** stops a transcription and ends with `1`. The recording stays in
  the archive; its transcript is kept only if one had been saved before the
  key.
- **Progress** goes to standard error: one line per step when it goes to a
  file. In a terminal it is a block redrawn in place, with the text printed
  above it as it is transcribed.
- **In a terminal** every command lays out and colours what it prints, in the
  system's language when that is Czech, and an error is a sentence rather than
  an `error:` line. What a script reads, from a pipe or a file, is the plain
  English described here; `NO_COLOR` gives it in a terminal too.
- **`list`** prints one recording per line, its fields separated by two
  spaces: id, date, length, status, title. With `--search`, one match per
  line: id, time in the recording, title, the matching text.
- **Diagnostics** go to `volocal-log.txt` beside the archive, the file the
  window writes too.
";
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
    out.push('\n');
    out.push_str(FOR_SCRIPTS);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::{czech_errors, czech_progress, english_errors, parse_dictionary};

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
    fn reads_the_czech_text_and_not_the_note_beside_it() {
        let vad = czech_errors().get("tools.vad_model_missing").unwrap();
        assert!(!vad.starts_with("VAD = "), "{vad}");
        assert_eq!(
            tell_in(Lang::Cs, &UserMessage::new("transcription.running")),
            "Přepisuji"
        );
        assert_eq!(
            czech_progress()
                .get("preparation.converting_audio")
                .map(String::as_str),
            Some("Převádím zvuk")
        );
    }

    /// Scripts read these after `error:`; each is the sentence the command
    /// line printed before it learned Czech.
    #[test]
    fn the_english_is_what_it_always_was() {
        let cases = [
            (Problem::NoArchive, "no Volocal archive was found. Start Volocal once, which creates it."),
            (Problem::NoTranscript("Porada".into()), "\"Porada\" has no transcript yet, so there is nothing to export."),
            (Problem::Busy("Porada".into()), "\"Porada\" is being transcribed already. Wait until it finishes; two transcriptions at once can run out of memory."),
            (Problem::NotAFile("talk.mp3".into()), "talk.mp3 is not a file"),
            (Problem::Stopped { id: "3f9c2a17-5c2a".into(), title: "Porada".into(), kept: false }, "stopped. The recording stays in the archive as 3f9c2a17"),
            (Problem::NoFolder("Porady".into()), "there is no folder called \"Porady\""),
            (Problem::NoRecording("x".into()), "there is no recording whose id starts with \"x\""),
            (Problem::Ambiguous("3".into()), "more than one recording's id starts with \"3\"; give more of it"),
            (Problem::Exists("Porada.srt".into()), "Porada.srt already exists; add --force to overwrite it"),
        ];
        for (problem, english) in cases {
            assert_eq!(problem.english(), english);
            assert!(!problem.said(Lang::Cs).is_empty());
        }
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
