//! The live block under a running transcription.
//!
//! **Words above, the block below.** Each block of text whisper writes is
//! printed once, as an ordinary line, so it stays in the terminal's
//! scrollback after the run. Under it a few lines are redrawn in place: the
//! phases already done with how long each took, the one running with the
//! mill, its position, a bar and an estimate, and a line saying how to stop.
//! When the work ends the block is cleared and a summary takes its place.
//!
//! **Moved over, not repainted.** The block is redrawn by going up the lines
//! it took (`ESC[nF`) and clearing to the end (`ESC[J`). Every line is cut
//! to the width first, so none wraps and the count stays true.
//!
//! **Written so it cannot take the run down.** Writing to a console that has
//! just been closed fails; `eprint!` would panic inside the engine's report.
//! Every write here ignores its error instead.

use crate::look::{self, Look, Role};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The order the pipeline goes through, from `src/app/useTranscriptionRuntime.ts`.
/// A report from a phase earlier than the one shown is late, not a step back.
const PHASE_ORDER: [&str; 8] = [
    "queued",
    "preparation",
    "playback",
    "second_language_question",
    "transcription",
    "diarization",
    "saving",
    "second_language",
];
const FINAL_PHASES: [&str; 3] = ["complete", "error", "cancelled"];

/// Should this report replace the one shown? The window's rule, ported with
/// its test: progress arrives from several threads, and a late report must
/// not throw the line back a step.
pub fn keeps_moving_forward(previous: Option<(&str, u64)>, next: (&str, u64)) -> bool {
    let Some((before_phase, before_percent)) = previous else {
        return true;
    };
    if FINAL_PHASES.contains(&before_phase) || FINAL_PHASES.contains(&next.0) {
        return true;
    }
    let position = |phase: &str| PHASE_ORDER.iter().position(|p| *p == phase);
    match (position(before_phase), position(next.0)) {
        (Some(before), Some(after)) if after != before => after > before,
        (Some(_), Some(_)) => next.1 >= before_percent,
        _ => true,
    }
}

struct Phase {
    name: String,
    /// The caption it started with, which names it in the list of done ones.
    label: String,
    /// The caption it shows now; a fill goes through several.
    caption: String,
    started: Instant,
    took: Option<Duration>,
}

struct State {
    look: Look,
    duration: f64,
    phases: Vec<Phase>,
    last: Option<(String, u64)>,
    /// Where in the recording whisper has got to: the end of its last block.
    position: f64,
    /// When the transcription phase started, for the estimate.
    transcribing_since: Option<(Instant, f64)>,
    drawn: usize,
    frame: usize,
}

/// The block, shared with the engine's report and the ticker.
pub struct Live {
    state: Mutex<State>,
    running: AtomicBool,
}

impl Live {
    /// Starts the block under a header line, and a ticker that keeps the mill
    /// turning between reports. `duration` is the recording's length.
    pub fn start(look: Look, header: &str, duration: f64) -> Arc<Live> {
        let mut err = std::io::stderr().lock();
        let _ = writeln!(err, "  {header}");
        let _ = writeln!(err);
        drop(err);
        let live = Arc::new(Live {
            state: Mutex::new(State {
                look,
                duration,
                phases: Vec::new(),
                last: None,
                position: 0.0,
                transcribing_since: None,
                drawn: 0,
                frame: 0,
            }),
            running: AtomicBool::new(true),
        });
        let ticker = Arc::downgrade(&live);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(100));
            let Some(live) = ticker.upgrade() else { return };
            let mut state = live.state.lock().unwrap();
            // Asked under the lock: `finish` clears the block while holding
            // it, and a frame drawn after that would sit under the summary.
            if !live.running.load(Ordering::Relaxed) {
                return;
            }
            state.frame = state.frame.wrapping_add(1);
            redraw(&mut state);
        });
        live
    }

    /// A step reported by the engine: its phase, overall percent, and its
    /// caption in the reader's words.
    pub fn status(&self, phase: &str, percent: u64, label: &str) {
        let mut state = self.state.lock().unwrap();
        if !self.running.load(Ordering::Relaxed) {
            return;
        }
        let previous = state.last.as_ref().map(|(p, n)| (p.as_str(), *n));
        if !keeps_moving_forward(previous, (phase, percent)) {
            return;
        }
        let changed = state.last.as_ref().is_none_or(|(p, _)| p != phase);
        state.last = Some((phase.to_string(), percent));
        if !changed {
            if let Some(current) = state.phases.last_mut() {
                current.caption = label.to_string();
            }
        } else {
            let now = Instant::now();
            if let Some(current) = state.phases.last_mut().filter(|p| p.took.is_none()) {
                current.took = Some(now - current.started);
            }
            state.phases.push(Phase {
                name: phase.to_string(),
                label: label.to_string(),
                caption: label.to_string(),
                started: now,
                took: None,
            });
            if phase == "transcription" {
                let position = state.position;
                state.transcribing_since = Some((now, position));
            }
        }
        redraw(&mut state);
    }

    /// The engine's next piece of work starts its phases from the beginning
    /// again — the speaker pass after a fill reports `diarization` once more —
    /// so the order is not held against it.
    pub fn next_run(&self) {
        self.state.lock().unwrap().last = None;
    }

    /// A piece of the engine's work has ended: the phase it was in is done,
    /// and its time stops there rather than running on until the next one.
    pub fn close_phase(&self) {
        let mut state = self.state.lock().unwrap();
        if let Some(current) = state.phases.last_mut().filter(|p| p.took.is_none()) {
            current.took = Some(current.started.elapsed());
        }
        if self.running.load(Ordering::Relaxed) {
            redraw(&mut state);
        }
    }

    /// A block of text whisper has just written.
    pub fn segment(&self, start: f64, end: f64, text: &str) {
        let mut state = self.state.lock().unwrap();
        if !self.running.load(Ordering::Relaxed) {
            return;
        }
        state.position = state.position.max(end);
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let width = state.look.width.saturating_sub(10).max(20);
        let time = crate::clock(start);
        let mut out = String::new();
        for (i, line) in look::wrap(text, width).into_iter().enumerate() {
            let gutter = if i == 0 {
                look::pad_left(&time, 7)
            } else {
                " ".repeat(7)
            };
            out.push_str(&format!("{}  {line}\n", look::paint(Role::Muted, &gutter)));
        }
        clear(&mut state);
        let mut err = std::io::stderr().lock();
        let _ = err.write_all(out.as_bytes());
        drop(err);
        redraw(&mut state);
    }

    /// The block cleared for good, the ticker stopped. Returns each phase
    /// with how long it took, for the summary.
    pub fn finish(&self) -> Vec<(String, Duration)> {
        self.running.store(false, Ordering::Relaxed);
        let mut state = self.state.lock().unwrap();
        clear(&mut state);
        let now = Instant::now();
        state
            .phases
            .iter()
            .filter(|p| p.name != "queued")
            .map(|p| (p.label.clone(), p.took.unwrap_or(now - p.started)))
            .collect()
    }
}

/// One line with the mill turning, for work that reports no progress of its
/// own — ffmpeg converting the audio for `export-audio`. Cleared when dropped.
pub struct Turning {
    running: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Turning {
    pub fn start(look: Look, format: &str) -> Turning {
        let running = Arc::new(AtomicBool::new(true));
        let line = format!(
            "{} {format}{}",
            look.words().converting,
            look.glyphs().ellipsis
        );
        let thread = {
            let running = running.clone();
            std::thread::spawn(move || {
                let mill = look.glyphs().mill;
                let mut frame = 0;
                while running.load(Ordering::Relaxed) {
                    let mut err = std::io::stderr().lock();
                    let _ = write!(
                        err,
                        "\r\x1b[K  {}  {line}",
                        look::paint(Role::Accent, mill[frame % mill.len()])
                    );
                    let _ = err.flush();
                    drop(err);
                    frame += 1;
                    std::thread::sleep(Duration::from_millis(100));
                }
                let mut err = std::io::stderr().lock();
                let _ = write!(err, "\r\x1b[K");
                let _ = err.flush();
            })
        };
        Turning {
            running,
            thread: Some(thread),
        }
    }
}

impl Drop for Turning {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Goes back over the lines the block took and clears them.
fn clear(state: &mut State) {
    if state.drawn == 0 {
        return;
    }
    let mut err = std::io::stderr().lock();
    let _ = write!(err, "\x1b[{}F\x1b[J", state.drawn);
    let _ = err.flush();
    state.drawn = 0;
}

fn redraw(state: &mut State) {
    let lines = frame(state);
    clear(state);
    let mut err = std::io::stderr().lock();
    for line in &lines {
        let _ = writeln!(err, "{line}");
    }
    let _ = err.flush();
    state.drawn = lines.len();
}

/// The block's lines, each cut to the width.
fn frame(state: &State) -> Vec<String> {
    let look = state.look;
    let words = look.words();
    let glyphs = look.glyphs();
    let width = look.width.saturating_sub(1);
    let label_width = state
        .phases
        .iter()
        .map(|p| p.label.chars().count())
        .max()
        .unwrap_or(0)
        .clamp(12, 34);

    let mut lines = Vec::new();
    for phase in state
        .phases
        .iter()
        .filter(|p| p.name != "queued" || p.took.is_none())
    {
        let label = look::cut(&phase.label, label_width, glyphs.ellipsis);
        let line = match phase.took {
            Some(took) => format!(
                "  {}  {}  {}",
                look::paint(Role::Success, &look::pad(&format!(" {}", glyphs.done), 4)),
                look::pad(&label, label_width),
                look::paint(Role::Muted, &crate::clock(took.as_secs_f64()))
            ),
            None => {
                let mill = glyphs.mill[state.frame % glyphs.mill.len()];
                let percent = state.last.as_ref().map_or(0, |(_, n)| *n);
                let caption = look::cut(&phase.caption, label_width, glyphs.ellipsis);
                let mut line = format!(
                    "  {}  {}",
                    look::paint(Role::Accent, mill),
                    look::pad(&look::paint(Role::Bold, &caption), label_width)
                );
                if phase.name == "transcription" && state.duration > 0.0 {
                    line.push_str(&look::paint(
                        Role::Muted,
                        &format!(
                            "  {} {} {}",
                            look::pad_left(&crate::clock(state.position), 7),
                            words.position_of,
                            crate::clock(state.duration)
                        ),
                    ));
                }
                line.push_str("  ");
                line.push_str(&look::bar(glyphs, percent as f64 / 100.0, 24));
                line.push_str(&format!(
                    "  {}",
                    look::paint(Role::Bold, &format!("{percent:>3} %"))
                ));
                if phase.name == "transcription" {
                    if let Some(left) = estimate(state) {
                        line.push_str(&format!("  {}", look::paint(Role::Muted, &left)));
                    }
                }
                line
            }
        };
        lines.push(fit(&line, width));
    }
    lines.push(fit(
        &look::paint(Role::Muted, &format!("  {}", words.stop_hint)),
        width,
    ));
    lines
}

/// Time left in the transcription phase, from how fast it has gone so far.
/// Nothing until there is enough to go on.
fn estimate(state: &State) -> Option<String> {
    let (since, from) = state.transcribing_since?;
    let done = state.position - from;
    let left = state.duration - state.position;
    let elapsed = since.elapsed().as_secs_f64();
    if done < state.duration * 0.03 || elapsed < 5.0 || left <= 0.0 {
        return None;
    }
    let seconds = left * elapsed / done;
    let look = state.look;
    let words = look.words();
    if seconds < 60.0 {
        return Some(words.left_under_a_minute.to_string());
    }
    let minutes = (seconds / 60.0).ceil() as i64;
    Some(format!(
        "{} {}",
        words.left_about,
        look::count(look.lang, minutes, words.minutes)
    ))
}

/// A line cut so it never wraps. Escapes are kept; text past the width goes.
fn fit(line: &str, width: usize) -> String {
    if look::cells(line) <= width {
        return line.to_string();
    }
    let mut out = String::new();
    let mut count = 0;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            out.push(c);
            for c in chars.by_ref() {
                out.push(c);
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        if count >= width {
            continue;
        }
        out.push(c);
        count += 1;
    }
    out.push_str("\x1b[0m");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cases of `src/app/phaseOrder.test.ts`.
    #[test]
    fn a_late_report_does_not_move_the_run_back() {
        assert!(keeps_moving_forward(None, ("preparation", 0)));
        assert!(!keeps_moving_forward(
            Some(("transcription", 40)),
            ("preparation", 5)
        ));
        assert!(keeps_moving_forward(
            Some(("second_language_question", 8)),
            ("transcription", 10)
        ));
        assert!(!keeps_moving_forward(
            Some(("transcription", 40)),
            ("transcription", 39)
        ));
        assert!(keeps_moving_forward(
            Some(("saving", 90)),
            ("second_language", 2)
        ));
        assert!(keeps_moving_forward(Some(("complete", 100)), ("queued", 0)));
        assert!(keeps_moving_forward(
            Some(("transcription", 50)),
            ("cancelled", 0)
        ));
        assert!(keeps_moving_forward(
            Some(("something_new", 50)),
            ("preparation", 0)
        ));
    }

    #[test]
    fn a_line_is_cut_to_the_width_and_keeps_its_colour() {
        let line = look::paint(Role::Accent, "abcdefghij");
        let cut = fit(&line, 4);
        assert_eq!(look::cells(&cut), 4);
        assert!(cut.starts_with("\x1b[94m"));
        assert!(cut.ends_with("\x1b[0m"));
        assert_eq!(fit("short", 10), "short");
    }

    fn sample(lang: look::Lang) -> State {
        let started = Instant::now();
        State {
            look: Look {
                lang,
                ascii: false,
                width: 100,
            },
            duration: 2292.0,
            phases: vec![
                Phase {
                    name: "preparation".into(),
                    label: "Převádím zvuk".into(),
                    caption: "Převádím zvuk".into(),
                    started,
                    took: Some(Duration::from_secs(6)),
                },
                Phase {
                    name: "transcription".into(),
                    label: "Přepisuji".into(),
                    caption: "Přepisuji".into(),
                    started,
                    took: None,
                },
            ],
            last: Some(("transcription".into(), 42)),
            position: 917.0,
            transcribing_since: None,
            drawn: 0,
            frame: 5,
        }
    }

    #[test]
    fn the_block_shows_what_is_done_and_what_runs() {
        let lines = frame(&sample(look::Lang::Cs));
        let plain: Vec<String> = lines
            .iter()
            .map(|l| {
                regex::Regex::new("\x1b\\[[0-9;]*[A-Za-z]")
                    .unwrap()
                    .replace_all(l, "")
                    .into_owned()
            })
            .collect();
        assert_eq!(plain.len(), 3);
        assert!(
            plain[0].starts_with("   ✓    Převádím zvuk"),
            "{:?}",
            plain[0]
        );
        assert!(plain[0].trim_end().ends_with("0:06"));
        assert!(plain[1].contains("⢾⡇"), "{}", plain[1]);
        assert!(plain[1].contains("Přepisuji"));
        assert!(plain[1].contains("15:17 z 38:12"), "{}", plain[1]);
        assert!(plain[1].contains(" 42 %"));
        assert!(plain[2].contains("Ctrl+C"));
        for line in &lines {
            assert!(look::cells(line) < 100);
        }
    }

    #[test]
    fn the_block_fits_a_narrow_console() {
        let mut state = sample(look::Lang::En);
        state.look.width = 50;
        for line in frame(&state) {
            assert!(look::cells(&line) <= 49, "{line:?}");
        }
    }
}
