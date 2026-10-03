//! How the command line looks when a person is reading it.
//!
//! **Only a terminal gets any of this.** Each stream decides for itself: a
//! command whose standard output is a terminal lays its lines out here, one
//! whose output goes to a pipe or a file prints exactly what it printed before
//! this module existed, through the code that printed it then. `NO_COLOR` and
//! `TERM=dumb` count as "not a terminal". So a script never sees a change, and
//! the window never sees anything at all: nothing here is in the engine.
//!
//! **The terminal's own sixteen colours, never painted backgrounds.** A
//! terminal's theme decides what "green" and "bright blue" look like, so the
//! marks read on a dark theme and a light one alike — which a fixed palette,
//! tuned for one of them, would not. Planned in `docs/cli-look-plan.md`.
//!
//! **The reader's language, the script's English.** What a person reads here
//! follows the system's language when the program has it (Czech or English);
//! what a script reads stays English, because scripts parse it.

use std::io::IsTerminal;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    Cs,
}

#[derive(Clone, Copy)]
pub enum Stream {
    Out,
    Err,
}

/// What a stream may be given: `None` when it gets today's plain text.
#[derive(Clone, Copy)]
pub struct Look {
    pub lang: Lang,
    pub ascii: bool,
    pub width: usize,
}

impl Look {
    /// The look for this stream, or `None` when it is not a person's terminal.
    pub fn of(stream: Stream) -> Option<Look> {
        let terminal = match stream {
            Stream::Out => std::io::stdout().is_terminal(),
            Stream::Err => std::io::stderr().is_terminal(),
        };
        if !terminal || no_color() || std::env::var("TERM").is_ok_and(|t| t == "dumb") {
            return None;
        }
        // Without VT sequences the escapes would be printed as text; the plain
        // output is better than that.
        if !console::enable_sequences(stream) {
            return None;
        }
        Some(Look {
            lang: language(),
            ascii: classic_console(),
            width: console::width(stream).unwrap_or(100).clamp(40, 200),
        })
    }

    pub fn words(&self) -> &'static Words {
        match self.lang {
            Lang::En => &EN,
            Lang::Cs => &CS,
        }
    }

    pub fn glyphs(&self) -> &'static Glyphs {
        if self.ascii {
            &ASCII
        } else {
            &UNICODE
        }
    }
}

fn no_color() -> bool {
    std::env::var_os("NO_COLOR").is_some_and(|value| !value.is_empty())
}

/// The language of the system, when it is one the program speaks.
///
/// `VOLOCAL_LANG=cs|en` decides first. On Windows the user's display
/// language does, read with the one call that gives it; elsewhere the locale
/// variables, as every Unix program reads them.
fn language() -> Lang {
    let chosen = std::env::var("VOLOCAL_LANG").unwrap_or_default();
    match chosen.to_ascii_lowercase().get(..2) {
        Some("cs") => return Lang::Cs,
        Some("en") => return Lang::En,
        _ => {}
    }
    if console::system_language_is_czech() {
        Lang::Cs
    } else {
        Lang::En
    }
}

/// The old Windows console (conhost) with its default fonts: no braille, no
/// ✓, no eighth blocks. Windows Terminal says so with `WT_SESSION`, and VS
/// Code and other hosts with `TERM_PROGRAM`.
fn classic_console() -> bool {
    cfg!(windows)
        && std::env::var_os("WT_SESSION").is_none()
        && std::env::var_os("TERM_PROGRAM").is_none()
}

// ---------------------------------------------------------------- colour

/// A colour role. The codes are the standard sixteen, so the user's theme
/// draws them.
#[derive(Clone, Copy)]
pub enum Role {
    /// Meta lines, times, labels.
    Muted,
    /// The thing that is running.
    Accent,
    Success,
    Warning,
    Danger,
    /// A search hit: dark text on the terminal's yellow.
    Hit,
    Bold,
    /// A speaker, by the place of their colour in `db::COLORS`.
    Speaker(usize),
}

const RESET: &str = "\x1b[0m";

fn code(role: Role) -> &'static str {
    match role {
        Role::Muted => "\x1b[90m",
        Role::Accent => "\x1b[94m",
        Role::Success => "\x1b[32m",
        Role::Warning => "\x1b[33m",
        Role::Danger => "\x1b[91m",
        Role::Hit => "\x1b[30;43m",
        Role::Bold => "\x1b[1m",
        // In the order of `db::COLORS`: blue, orange, green, violet, cyan,
        // amber, rose, olive — the nearest of the sixteen to each.
        Role::Speaker(n) => [
            "\x1b[1;94m",
            "\x1b[1;91m",
            "\x1b[1;92m",
            "\x1b[1;95m",
            "\x1b[1;96m",
            "\x1b[1;93m",
            "\x1b[1;35m",
            "\x1b[1;32m",
        ][n % 8],
    }
}

/// `text` in a role.
pub fn paint(role: Role, text: &str) -> String {
    format!("{}{text}{RESET}", code(role))
}

/// The speaker's place in `db::COLORS`, from the colour stored with them.
/// An archive from before that list holds other values; the nearest one wins.
pub fn speaker_role(hex: &str) -> Role {
    let rgb = |h: &str| -> Option<(i32, i32, i32)> {
        let h = h.trim_start_matches('#');
        if h.len() != 6 {
            return None;
        }
        let v = |i: usize| i32::from_str_radix(&h[i..i + 2], 16).ok();
        Some((v(0)?, v(2)?, v(4)?))
    };
    let Some((r, g, b)) = rgb(hex) else {
        return Role::Speaker(0);
    };
    let nearest = volocal_lib::db::COLORS
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            rgb(c).map(|(cr, cg, cb)| (i, (cr - r).pow(2) + (cg - g).pow(2) + (cb - b).pow(2)))
        })
        .min_by_key(|(_, distance)| *distance)
        .map_or(0, |(i, _)| i);
    Role::Speaker(nearest)
}

/// The search's `<<match>>` marks as the window's highlight.
pub fn hits(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(open) = rest.find("<<") {
        out.push_str(&rest[..open]);
        let after = &rest[open + 2..];
        let Some(close) = after.find(">>") else {
            out.push_str(after);
            return out;
        };
        out.push_str(&paint(Role::Hit, &after[..close]));
        rest = &after[close + 2..];
    }
    out.push_str(rest);
    out
}

/// How many cells a string takes, escapes left out. Czech letters are one
/// cell each, and so is every glyph below.
pub fn cells(text: &str) -> usize {
    let mut count = 0;
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            count += 1;
        }
    }
    count
}

/// `text` padded with spaces to `width` cells, escapes not counted.
pub fn pad(text: &str, width: usize) -> String {
    let n = cells(text);
    format!("{text}{}", " ".repeat(width.saturating_sub(n)))
}

/// `text` padded on the left, for numbers that line up on their right.
pub fn pad_left(text: &str, width: usize) -> String {
    let n = cells(text);
    format!("{}{text}", " ".repeat(width.saturating_sub(n)))
}

/// Plain `text` cut to `width` cells, with an ellipsis when it had to be.
pub fn cut(text: &str, width: usize, ellipsis: &str) -> String {
    if text.chars().count() <= width {
        return text.to_string();
    }
    let keep = width.saturating_sub(ellipsis.chars().count());
    format!("{}{ellipsis}", text.chars().take(keep).collect::<String>())
}

/// Plain `text` broken into lines of at most `width` cells, at spaces where
/// it can be.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(10);
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        let word_len = word.chars().count();
        let line_len = line.chars().count();
        if line_len > 0 && line_len + 1 + word_len > width {
            lines.push(std::mem::take(&mut line));
        }
        if word_len > width {
            // A word longer than the line: cut it, there is nowhere to break.
            let mut chars: Vec<char> = word.chars().collect();
            while chars.len() > width {
                lines.push(chars.drain(..width).collect());
            }
            line = chars.into_iter().collect();
            continue;
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(word);
    }
    if !line.is_empty() || lines.is_empty() {
        lines.push(line);
    }
    lines
}

// ---------------------------------------------------------------- glyphs

pub struct Glyphs {
    pub done: &'static str,
    pub warning: &'static str,
    pub failed: &'static str,
    pub new: &'static str,
    pub ellipsis: &'static str,
    pub bar_full: &'static str,
    pub bar_tip: &'static str,
    pub bar_empty: &'static str,
    /// The mill from the mark, one frame per 100 ms: two rollers and the
    /// sheet passing between them, in four cells.
    pub mill: &'static [&'static str],
}

const UNICODE: Glyphs = Glyphs {
    done: "✓",
    warning: "!",
    failed: "✕",
    new: "·",
    ellipsis: "…",
    bar_full: "━",
    bar_tip: "╸",
    bar_empty: "─",
    mill: &[
        " ⢈⡁ ",
        "⠆⢈⡁ ",
        "⠶⢈⡁ ",
        "⠶⢎⡁ ",
        "⠰⢾⡁ ",
        " ⢾⡇ ",
        " ⢸⡷ ",
        " ⢈⡷⠆",
        " ⢈⡱⠶",
        " ⢈⡁⠶",
        " ⢈⡁⠰",
    ],
};

/// The old console's fonts have none of the above; `·`, `—` and `…` they do
/// have, but a plain set is plain.
const ASCII: Glyphs = Glyphs {
    done: "+",
    warning: "!",
    failed: "x",
    new: ".",
    ellipsis: "...",
    bar_full: "=",
    bar_tip: ">",
    bar_empty: "-",
    mill: &[" |  ", " /  ", " -  ", " \\  "],
};

/// A bar of `width` cells, `fraction` of it full.
pub fn bar(glyphs: &Glyphs, fraction: f64, width: usize) -> String {
    let fraction = fraction.clamp(0.0, 1.0);
    let full = (fraction * width as f64).floor() as usize;
    let tip = usize::from(full < width && fraction > 0.0);
    let empty = width - full - tip;
    format!(
        "{}{}",
        paint(
            Role::Accent,
            &format!(
                "{}{}",
                glyphs.bar_full.repeat(full),
                glyphs.bar_tip.repeat(tip)
            )
        ),
        paint(Role::Muted, &glyphs.bar_empty.repeat(empty))
    )
}

// ---------------------------------------------------------------- plurals

/// Czech counts choose between three forms (1, 2–4, the rest); English
/// between two. A count never chooses its own word in code.
pub fn count(lang: Lang, n: i64, forms: [&str; 3]) -> String {
    let form = match lang {
        Lang::En => {
            if n == 1 {
                forms[0]
            } else {
                forms[2]
            }
        }
        Lang::Cs => match n {
            1 => forms[0],
            2..=4 => forms[1],
            _ => forms[2],
        },
    };
    format!("{} {form}", number(lang, n))
}

/// `1 208` in Czech, `1,208` in English.
pub fn number(lang: Lang, n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let separator = match lang {
        Lang::En => ",",
        Lang::Cs => "\u{a0}",
    };
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push_str(separator);
        }
        out.push(c);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

/// A length of time for a summary: `5 h 12 min`, `12 min`, `40 s`.
pub fn span(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let (h, m) = (total / 3600, (total % 3600) / 60);
    match (h, m) {
        (0, 0) => format!("{total} s"),
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m} min"),
    }
}

/// A date from the archive (`2026-10-03…`) the way the reader writes it.
pub fn date(lang: Lang, stored: &str) -> String {
    let day = stored.get(..10).unwrap_or(stored);
    if lang == Lang::En {
        return day.to_string();
    }
    let parts: Vec<&str> = day.split('-').collect();
    match parts.as_slice() {
        [y, m, d] => format!(
            "{}.\u{a0}{}.\u{a0}{y}",
            d.trim_start_matches('0'),
            m.trim_start_matches('0')
        ),
        _ => day.to_string(),
    }
}

// ---------------------------------------------------------------- words

/// Everything the command line says in its own words to a person. The
/// engine's messages come from the window's dictionaries instead; these are
/// the labels and sentences that only the command line has.
///
/// Czech addresses the reader formally, as the window does.
pub struct Words {
    // list
    pub no_recordings: &'static str,
    pub nothing_found: &'static str,
    pub col_id: &'static str,
    pub col_date: &'static str,
    pub col_length: &'static str,
    pub col_title: &'static str,
    pub recordings: [&'static str; 3],
    pub hits: [&'static str; 3],
    pub speakers: [&'static str; 3],
    pub blocks: [&'static str; 3],
    pub state_new: &'static str,
    pub state_transcribing: &'static str,
    pub state_done: &'static str,
    pub state_failed: &'static str,
    // show
    pub label_id: &'static str,
    pub label_title: &'static str,
    pub label_file: &'static str,
    pub label_recorded: &'static str,
    pub label_length: &'static str,
    pub label_status: &'static str,
    pub label_language: &'static str,
    pub label_model: &'static str,
    pub label_blocks: &'static str,
    pub label_speakers: &'static str,
    pub label_source: &'static str,
    pub label_error: &'static str,
    // status
    pub label_archive: &'static str,
    pub label_ffmpeg: &'static str,
    pub label_whisper: &'static str,
    pub label_runs_on: &'static str,
    pub label_memory: &'static str,
    pub missing: &'static str,
    pub ready: &'static str,
    pub not_ready: &'static str,
    pub compute_cuda: &'static str,
    pub compute_vulkan: &'static str,
    pub compute_cpu: &'static str,
    // transcribe
    pub stop_hint: &'static str,
    pub position_of: &'static str,
    pub left_about: &'static str,
    pub left_under_a_minute: &'static str,
    pub minutes: [&'static str; 3],
    pub transcribed_in: &'static str,
    pub faster: &'static str,
    pub second_language_added: &'static str,
    // export
    pub saved: &'static str,
    pub converting: &'static str,
}

pub const EN: Words = Words {
    no_recordings: "No recordings yet.",
    nothing_found: "Nothing found.",
    col_id: "ID",
    col_date: "DATE",
    col_length: "LENGTH",
    col_title: "TITLE",
    recordings: ["recording", "recordings", "recordings"],
    hits: ["hit", "hits", "hits"],
    speakers: ["speaker", "speakers", "speakers"],
    blocks: ["block", "blocks", "blocks"],
    state_new: "not transcribed",
    state_transcribing: "transcribing",
    state_done: "transcribed",
    state_failed: "failed",
    label_id: "id",
    label_title: "title",
    label_file: "file",
    label_recorded: "recorded",
    label_length: "length",
    label_status: "status",
    label_language: "language",
    label_model: "model",
    label_blocks: "blocks",
    label_speakers: "speakers",
    label_source: "source",
    label_error: "error",
    label_archive: "archive",
    label_ffmpeg: "ffmpeg",
    label_whisper: "whisper",
    label_runs_on: "runs on",
    label_memory: "memory",
    missing: "missing",
    ready: "Ready to transcribe.",
    not_ready: "Not ready to transcribe:",
    compute_cuda: "graphics card (CUDA)",
    compute_vulkan: "graphics card (Vulkan)",
    compute_cpu: "processor",
    stop_hint: "Ctrl+C stops the transcription; the recording stays in the archive.",
    position_of: "/",
    left_about: "about",
    left_under_a_minute: "under a minute left",
    minutes: ["min left", "min left", "min left"],
    transcribed_in: "Transcribed in",
    faster: "faster than the recording",
    second_language_added: "written in as well",
    saved: "Saved",
    converting: "Converting",
};

pub const CS: Words = Words {
    no_recordings: "Archiv je zatím prázdný.",
    nothing_found: "Nic jsme nenašli.",
    col_id: "ID",
    col_date: "DATUM",
    col_length: "DÉLKA",
    col_title: "NÁZEV",
    recordings: ["nahrávka", "nahrávky", "nahrávek"],
    hits: ["výsledek", "výsledky", "výsledků"],
    speakers: ["mluvčí", "mluvčí", "mluvčích"],
    blocks: ["úsek", "úseky", "úseků"],
    state_new: "nepřepsaná",
    state_transcribing: "přepisuje se",
    state_done: "přepsaná",
    state_failed: "nepodařilo se",
    label_id: "id",
    label_title: "název",
    label_file: "soubor",
    label_recorded: "přidáno",
    label_length: "délka",
    label_status: "stav",
    label_language: "jazyk",
    label_model: "model",
    label_blocks: "úseky",
    label_speakers: "mluvčí",
    label_source: "zdroj",
    label_error: "chyba",
    label_archive: "archiv",
    label_ffmpeg: "ffmpeg",
    label_whisper: "whisper",
    label_runs_on: "počítá na",
    label_memory: "paměť",
    missing: "chybí",
    ready: "Připraveno k přepisu.",
    not_ready: "Přepisovat zatím nelze:",
    compute_cuda: "grafické kartě (CUDA)",
    compute_vulkan: "grafické kartě (Vulkan)",
    compute_cpu: "procesoru",
    stop_hint: "Přepis zastavíte klávesami Ctrl+C, nahrávka zůstane v archivu.",
    position_of: "z",
    left_about: "zbývá asi",
    left_under_a_minute: "zbývá méně než minuta",
    minutes: ["minuta", "minuty", "minut"],
    transcribed_in: "Přepsáno za",
    faster: "rychleji, než nahrávka trvá",
    second_language_added: "doplněno",
    saved: "Uloženo",
    converting: "Převádím na",
};

// ---------------------------------------------------------------- console

/// The few things only the console itself can say.
mod console {
    use super::Stream;

    #[cfg(windows)]
    fn handle(stream: Stream) -> Option<windows::Win32::Foundation::HANDLE> {
        use windows::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE};
        let which = match stream {
            Stream::Out => STD_OUTPUT_HANDLE,
            Stream::Err => STD_ERROR_HANDLE,
        };
        // SAFETY: GetStdHandle only reads the process's standard handles.
        unsafe { GetStdHandle(which) }.ok()
    }

    /// Windows Terminal reads escapes on its own; the old console only once
    /// it is told to, and the setting belongs to the console, so it is asked
    /// for here rather than assumed.
    #[cfg(windows)]
    pub fn enable_sequences(stream: Stream) -> bool {
        use windows::Win32::System::Console::{
            GetConsoleMode, SetConsoleMode, CONSOLE_MODE, ENABLE_VIRTUAL_TERMINAL_PROCESSING,
        };
        let Some(handle) = handle(stream) else {
            return false;
        };
        let mut mode = CONSOLE_MODE::default();
        // SAFETY: both calls only read and set the mode of our own handle.
        unsafe {
            if GetConsoleMode(handle, &mut mode).is_err() {
                return false;
            }
            if mode.contains(ENABLE_VIRTUAL_TERMINAL_PROCESSING) {
                return true;
            }
            SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING).is_ok()
        }
    }

    #[cfg(not(windows))]
    pub fn enable_sequences(_stream: Stream) -> bool {
        true
    }

    /// The visible width of the console window, in cells.
    #[cfg(windows)]
    pub fn width(stream: Stream) -> Option<usize> {
        use windows::Win32::System::Console::{
            GetConsoleScreenBufferInfo, CONSOLE_SCREEN_BUFFER_INFO,
        };
        let handle = handle(stream)?;
        let mut info = CONSOLE_SCREEN_BUFFER_INFO::default();
        // SAFETY: the call fills a struct we own.
        unsafe { GetConsoleScreenBufferInfo(handle, &mut info) }.ok()?;
        let width = i32::from(info.srWindow.Right) - i32::from(info.srWindow.Left) + 1;
        usize::try_from(width).ok().filter(|w| *w > 0)
    }

    #[cfg(not(windows))]
    pub fn width(_stream: Stream) -> Option<usize> {
        std::env::var("COLUMNS").ok()?.parse().ok()
    }

    /// Czech as the user's display language. Declared here rather than taken
    /// from the `windows` crate, whose feature for it the window does not
    /// need; kernel32 is linked by every Windows program anyway.
    #[cfg(windows)]
    pub fn system_language_is_czech() -> bool {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetUserDefaultUILanguage() -> u16;
        }
        // SAFETY: takes nothing, returns a number.
        let language = unsafe { GetUserDefaultUILanguage() };
        // The primary language is the low ten bits; Czech is 0x05.
        language & 0x3ff == 0x05
    }

    #[cfg(not(windows))]
    pub fn system_language_is_czech() -> bool {
        ["LC_ALL", "LC_MESSAGES", "LANG"]
            .iter()
            .filter_map(|name| std::env::var(name).ok())
            .find(|value| !value.is_empty())
            .is_some_and(|value| value.starts_with("cs"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_choose_the_czech_form() {
        assert_eq!(count(Lang::Cs, 1, CS.recordings), "1 nahrávka");
        assert_eq!(count(Lang::Cs, 3, CS.recordings), "3 nahrávky");
        assert_eq!(count(Lang::Cs, 5, CS.recordings), "5 nahrávek");
        assert_eq!(count(Lang::Cs, 1208, CS.blocks), "1\u{a0}208 úseků");
        assert_eq!(count(Lang::En, 1, EN.recordings), "1 recording");
        assert_eq!(count(Lang::En, 2, EN.recordings), "2 recordings");
    }

    #[test]
    fn measures_without_the_escapes() {
        assert_eq!(cells(&paint(Role::Success, "✓ hotovo")), 8);
        assert_eq!(cells("Přednáška"), 9);
        assert_eq!(cells(&pad(&paint(Role::Muted, "ab"), 5)), 5);
    }

    #[test]
    fn wraps_at_spaces() {
        assert_eq!(wrap("aaa bbbb ccccc dd", 10), vec!["aaa bbbb", "ccccc dd"]);
        assert_eq!(wrap("", 10), vec![""]);
        assert_eq!(wrap("abcdefghijklmnop", 10), vec!["abcdefghij", "klmnop"]);
    }

    #[test]
    fn marks_search_hits() {
        let text = hits("…a <<rozpočet>> na rok…");
        assert!(text.contains("\x1b[30;43mrozpočet\x1b[0m"));
        assert_eq!(cells(&text), "…a rozpočet na rok…".chars().count());
        assert_eq!(hits("no marks"), "no marks");
        assert_eq!(hits("open <<only"), "open only");
    }

    #[test]
    fn speakers_keep_their_colour() {
        assert!(matches!(speaker_role("#c2410c"), Role::Speaker(1)));
        // An archive from before the list: the nearest blue is the first.
        assert!(matches!(speaker_role("#1f6feb"), Role::Speaker(0)));
        assert!(matches!(speaker_role("nonsense"), Role::Speaker(0)));
    }

    #[test]
    fn dates_and_spans_read_naturally() {
        assert_eq!(
            date(Lang::Cs, "2026-10-03T08:02:00"),
            "3.\u{a0}10.\u{a0}2026"
        );
        assert_eq!(date(Lang::En, "2026-10-03T08:02:00"), "2026-10-03");
        assert_eq!(span(18_720.0), "5 h 12 min");
        assert_eq!(span(40.0), "40 s");
    }

    #[test]
    fn a_bar_is_as_wide_as_asked() {
        for fraction in [0.0, 0.42, 1.0] {
            assert_eq!(cells(&bar(&UNICODE, fraction, 24)), 24);
            assert_eq!(cells(&bar(&ASCII, fraction, 24)), 24);
        }
    }

    #[test]
    fn every_mill_frame_is_four_cells() {
        for frame in UNICODE.mill.iter().chain(ASCII.mill) {
            assert_eq!(frame.chars().count(), 4, "{frame:?}");
        }
    }
}
