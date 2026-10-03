//! `volocal-tui` — Volocal in a terminal, for a machine reached over SSH or
//! a remote console.
//!
//! The same archive and the same engine as the window and `volocal-cli`,
//! shown as a full-screen interface: the archive to browse and search, a
//! transcript to read, a file to transcribe while its words appear, an
//! export to choose. Planned in `docs/tui-plan.md`; its screens are drawn in
//! `docs/prototypes/volocal-tui.html`.
//!
//! **A program of its own.** `volocal-cli` stays what scripts call, with
//! output a script can read; this one is for a person at a terminal, and it
//! never runs anywhere else — not in a pipe, not from a script.
//!
//! **The window is not touched.** Nothing here is in the engine. A
//! transcription started here holds the lock of `run_lock.rs`, which is how the
//! window knows it is alive.

// Shared with `volocal-cli`, which uses every part of it; this program reads
// the dictionaries and the phase rule but has no use for the short id.
#[allow(dead_code)]
#[path = "../volocal-cli/common.rs"]
mod common;

mod app;
mod archive;
mod console;
mod export;
mod marks;
mod reader;
mod status;
mod theme;
mod transcribe;
mod ui;
mod words;

use app::{App, Ctx, Msg};
use clap::Parser;
use common::Lang;
use ratatui::backend::CrosstermBackend;
use ratatui::crossterm::event::{self, DisableBracketedPaste, EnableBracketedPaste};
use ratatui::crossterm::execute;
use ratatui::crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::Terminal;
use std::io::{IsTerminal, Stdout};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;
use theme::Theme;
use volocal_lib::{db, find_archive};

#[derive(Parser)]
#[command(
    name = "volocal-tui",
    version,
    about = "Volocal in a terminal: the archive, transcripts and new transcriptions",
    long_about = "Volocal in a terminal: the archive, transcripts and new transcriptions.\n\n\
        A full-screen interface for a person at a terminal, for instance over SSH. \
        It works on the same archive as the Volocal window. For scripts use volocal-cli."
)]
struct Cli {}

fn main() -> ExitCode {
    let _ = Cli::parse();
    let lang = language();
    if !std::io::stdout().is_terminal() || !std::io::stdin().is_terminal() {
        eprintln!(
            "{}",
            match lang {
                Lang::Cs => "volocal-tui potřebuje terminál. Pro skripty slouží volocal-cli.",
                Lang::En => "volocal-tui needs a terminal. Scripts use volocal-cli.",
            }
        );
        return ExitCode::from(2);
    }
    let Some(archive) = find_archive() else {
        eprintln!(
            "{}",
            match lang {
                Lang::Cs =>
                    "Archiv Volocalu jsme nenašli. Spusťte jednou aplikaci Volocal, ta ho vytvoří.",
                Lang::En => "No Volocal archive was found. Start Volocal once, which creates it.",
            }
        );
        return ExitCode::FAILURE;
    };
    // The engine's diagnostics go to the window's log file, not across the
    // screen.
    volocal_lib::diagnostics::set_file(&archive);
    volocal_lib::diagnostics::keep_off_the_terminal();
    // whisper and ffmpeg end with this program however it ends, as they end
    // with the window.
    #[cfg(windows)]
    volocal_lib::die_with_this_process();
    console::install();

    let connection = match db::open(&archive) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e:#}");
            return ExitCode::FAILURE;
        }
    };
    let settings = match db::load_settings(&connection) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{e:#}");
            return ExitCode::FAILURE;
        }
    };
    let ctx = Ctx {
        archive,
        db: connection,
        settings,
        theme: Theme::detect(lang),
    };
    match run(ctx) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

/// The system's language when the program speaks it; `VOLOCAL_LANG=cs|en`
/// chooses. The same rule as `volocal-cli` in a terminal.
fn language() -> Lang {
    match std::env::var("VOLOCAL_LANG")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .get(..2)
    {
        Some("cs") => return Lang::Cs,
        Some("en") => return Lang::En,
        _ => {}
    }
    if system_language_is_czech() {
        Lang::Cs
    } else {
        Lang::En
    }
}

#[cfg(windows)]
fn system_language_is_czech() -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
    }
    // SAFETY: takes nothing, returns a number.
    let language = unsafe { GetUserDefaultUILanguage() };
    language & 0x3ff == 0x05
}

#[cfg(not(windows))]
fn system_language_is_czech() -> bool {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .find(|value| !value.is_empty())
        .is_some_and(|value| value.starts_with("cs"))
}

/// Whether the terminal is in the screen's mode right now; restoring it twice
/// is harmless, never restoring it is the one thing a full-screen program
/// must not do.
static ENTERED: AtomicBool = AtomicBool::new(false);

fn restore() {
    if ENTERED.swap(false, Ordering::SeqCst) {
        let _ = terminal::disable_raw_mode();
        let _ = execute!(
            std::io::stdout(),
            DisableBracketedPaste,
            LeaveAlternateScreen,
            ratatui::crossterm::cursor::Show
        );
    }
}

/// Raw mode and the alternate screen for as long as it lives.
struct Screen {
    terminal: Terminal<CrosstermBackend<Stdout>>,
}

impl Screen {
    fn enter() -> std::io::Result<Screen> {
        terminal::enable_raw_mode()?;
        ENTERED.store(true, Ordering::SeqCst);
        let mut stdout = std::io::stdout();
        if let Err(e) = execute!(stdout, EnterAlternateScreen, EnableBracketedPaste) {
            restore();
            return Err(e);
        }
        let terminal = match Terminal::new(CrosstermBackend::new(stdout)) {
            Ok(t) => t,
            Err(e) => {
                restore();
                return Err(e);
            }
        };
        Ok(Screen { terminal })
    }
}

impl Drop for Screen {
    fn drop(&mut self) {
        restore();
    }
}

fn run(ctx: Ctx) -> std::io::Result<()> {
    // A panic on this thread restores the terminal before its message is
    // printed. One on a worker does not: the engine catches its own, and a
    // caught panic must not tear the screen down under a running program.
    let main = std::thread::current().id();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        volocal_lib::note!("panic: {info}");
        if std::thread::current().id() == main {
            restore();
            previous(info);
        }
    }));

    let mut screen = Screen::enter()?;
    let (tx, rx) = mpsc::channel::<Msg>();
    {
        let tx = tx.clone();
        std::thread::Builder::new()
            .name("volocal-tui-input".into())
            .spawn(move || {
                while let Ok(event) = event::read() {
                    if tx.send(Msg::Input(event)).is_err() {
                        return;
                    }
                }
            })?;
    }
    let mut app = App::new(ctx, tx);
    loop {
        screen.terminal.draw(|frame| app.draw(frame))?;
        let wait = if app.animating() {
            Duration::from_millis(100)
        } else {
            Duration::from_millis(1000)
        };
        match rx.recv_timeout(wait) {
            Ok(message) => app.handle(message),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        // A burst of progress reports is drawn once.
        while let Ok(message) = rx.try_recv() {
            app.handle(message);
        }
        app.tick();
        if app.done {
            break;
        }
    }
    drop(screen);
    Ok(())
}
