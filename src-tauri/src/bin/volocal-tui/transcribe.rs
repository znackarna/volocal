//! A new transcription: the sheet that starts it, the screen that follows it
//! — phases, a bar, the words as whisper writes them, the mark turning into
//! the mill — and the summary at its end, with the window's own question
//! about a second language.
//!
//! **The engine's own work, run on a thread of this program.** The same
//! `transcription::transcribe` the window and `volocal-cli` run, reporting
//! here through `Report::Callback`; nothing in the engine knows a screen is
//! watching. While it works the run holds the lock of `run_lock.rs`, so the
//! window neither takes it for a crashed run nor starts a whisper beside it.

use crate::app::{Ctx, Key, Msg};
use crate::common::{clock, keeps_moving_forward, tell_in};
use crate::marks::{FACE, MILL};
use crate::theme::Theme;
use crate::ui::{self, cut, FooterKeys};
use crate::words::{self, count, Lang};
use ratatui::layout::Rect;
use ratatui::style::Modifier;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use volocal_lib::db::{self, Recording};
use volocal_lib::transcription::{self, Report, TranscriptionTask};
use volocal_lib::user_message::UserMessage;

/// The languages the sheet offers; empty is the window's choice.
const LANGUAGES: [&str; 12] = [
    "", "auto", "cs", "en", "sk", "de", "pl", "fr", "es", "it", "uk", "ru",
];
/// The speakers the sheet offers: the window's choice, "do not know", a count.
const SPEAKERS: [Option<i64>; 10] = [
    None,
    Some(0),
    Some(1),
    Some(2),
    Some(3),
    Some(4),
    Some(5),
    Some(6),
    Some(7),
    Some(8),
];

// ---------------------------------------------------------------- the sheet

pub struct Sheet {
    pub path: String,
    language: usize,
    speakers: usize,
    focus: usize,
    pub problem: Option<String>,
}

pub enum SheetAction {
    Start(Request),
    Cancel,
}

#[derive(Clone)]
pub struct Request {
    pub file: PathBuf,
    pub language: Option<String>,
    pub speakers: Option<i64>,
}

impl Sheet {
    pub fn new(path: String) -> Sheet {
        Sheet {
            path,
            language: 0,
            speakers: 0,
            focus: 0,
            problem: None,
        }
    }

    /// A path pasted or dropped onto the terminal; quoted when it has spaces.
    pub fn paste(&mut self, text: &str) {
        self.path = clean_path(text);
        self.problem = None;
    }

    pub fn key(&mut self, key: Key, lang: Lang) -> Option<SheetAction> {
        match key {
            Key::Esc => return Some(SheetAction::Cancel),
            Key::Up | Key::BackTab => self.focus = self.focus.saturating_sub(1),
            Key::Down => self.focus = (self.focus + 1).min(2),
            Key::Tab if self.focus == 0 => self.path = complete(&self.path),
            Key::Tab => self.focus = (self.focus + 1) % 3,
            Key::Enter => {
                let file = PathBuf::from(clean_path(&self.path));
                if !file.is_file() {
                    self.problem = Some(words::not_a_file(lang, &file.display().to_string()));
                    self.focus = 0;
                    return None;
                }
                return Some(SheetAction::Start(Request {
                    file,
                    language: Some(LANGUAGES[self.language])
                        .filter(|l| !l.is_empty())
                        .map(str::to_string),
                    speakers: SPEAKERS[self.speakers],
                }));
            }
            Key::Left if self.focus == 1 => {
                self.language = (self.language + LANGUAGES.len() - 1) % LANGUAGES.len()
            }
            Key::Right if self.focus == 1 => self.language = (self.language + 1) % LANGUAGES.len(),
            Key::Left if self.focus == 2 => {
                self.speakers = (self.speakers + SPEAKERS.len() - 1) % SPEAKERS.len()
            }
            Key::Right if self.focus == 2 => self.speakers = (self.speakers + 1) % SPEAKERS.len(),
            Key::Char(c) if self.focus == 0 => {
                self.path.push(c);
                self.problem = None;
            }
            Key::Backspace if self.focus == 0 => {
                self.path.pop();
            }
            _ => {}
        }
        None
    }

    pub fn draw(&self, frame: &mut Frame, area: Rect, ctx: &Ctx) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let lang = theme.lang;
        let inner = ui::dialog(frame, area, theme, 52, 22);
        let width = inner.width as usize;
        let window_language = words::language_name(lang, &ctx.settings.language);
        let language = match LANGUAGES[self.language] {
            "" => format!("{} ({window_language})", w.as_in_app),
            "auto" => w.recognise_language.to_string(),
            code => words::language_name(lang, code),
        };
        let speakers = match SPEAKERS[self.speakers] {
            None => w.as_in_app.to_string(),
            Some(0) => w.speakers_unknown.to_string(),
            Some(n) => n.to_string(),
        };
        let model = volocal_lib::tools::check(&ctx.settings)
            .model_whisper_id
            .unwrap_or_else(|| ctx.settings.model.clone());

        let field = |focused: bool, text: Vec<Span<'static>>| -> Line<'static> {
            let mut spans = vec![Span::raw(" ")];
            spans.extend(text);
            let used = ui::line_cells(&spans);
            spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
            let style = if focused {
                theme.selected()
            } else {
                theme.field()
            };
            Line::from(
                spans
                    .into_iter()
                    .map(|s| s.patch_style(style))
                    .collect::<Vec<_>>(),
            )
        };
        let shown_path = {
            let room = width.saturating_sub(14);
            let chars: Vec<char> = self.path.chars().collect();
            if chars.len() > room {
                format!(
                    "{}{}",
                    g.ellipsis,
                    chars[chars.len() - room + 1..].iter().collect::<String>()
                )
            } else {
                self.path.clone()
            }
        };
        let mut path_spans = vec![Span::styled(shown_path, theme.text())];
        if self.focus == 0 {
            path_spans.push(Span::styled(g.cursor, theme.accent()));
        }
        let tab = format!("Tab {}", w.complete);
        let used = ui::line_cells(&path_spans) + ui::cells(&tab) + 2;
        path_spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
        path_spans.push(Span::styled(tab, theme.faint()));
        let stepper = |focused: bool, value: &str| {
            vec![Span::styled(
                format!("{} {value} {}", g.left, g.right),
                if focused { theme.text() } else { theme.muted() },
            )]
        };

        let mut lines = vec![ui::plain(w.new_transcription, theme.bold())];
        lines.extend(
            ui::wrap(w.sheet_sentence, width)
                .into_iter()
                .map(|l| ui::plain(l, theme.muted())),
        );
        lines.extend([
            Line::raw(""),
            ui::plain(w.file, theme.bold()),
            field(self.focus == 0, path_spans),
            ui::plain(w.drop_here, theme.muted()),
            Line::raw(""),
            ui::plain(w.language, theme.bold()),
            field(self.focus == 1, stepper(self.focus == 1, &language)),
            Line::raw(""),
            ui::plain(w.speakers_label, theme.bold()),
            field(self.focus == 2, stepper(self.focus == 2, &speakers)),
            Line::raw(""),
            Line::from(vec![
                Span::styled(format!("{}  ", w.model), theme.bold()),
                Span::styled(format!("{model} · {}", w.set_in_app), theme.muted()),
            ]),
            Line::raw(""),
        ]);
        if let Some(problem) = &self.problem {
            lines.push(ui::plain(cut(problem, width, g.ellipsis), theme.danger()));
        } else {
            lines.push(Line::raw(""));
        }
        let cancel = format!("  Esc {}  ", w.cancel);
        let start = format!("  {} {}  ", g.enter, w.start_transcription);
        lines.push(Line::from(vec![
            Span::raw(" ".repeat(width.saturating_sub(ui::cells(&cancel) + ui::cells(&start) + 2))),
            Span::styled(cancel, theme.key()),
            Span::raw("  "),
            Span::styled(start, theme.primary()),
        ]));
        frame.render_widget(Paragraph::new(lines), inner);
    }
}

fn clean_path(text: &str) -> String {
    let text = text.trim().trim_matches(|c| c == '"' || c == '\'');
    text.lines().next().unwrap_or("").trim().to_string()
}

/// The path completed as far as the folder allows: the one entry it names,
/// or what all of them share.
fn complete(path: &str) -> String {
    let path = clean_path(path);
    let (dir, prefix) = match path.rfind(['\\', '/']) {
        Some(i) => (path[..=i].to_string(), path[i + 1..].to_string()),
        None => (String::new(), path.clone()),
    };
    let listing = if dir.is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(&dir)
    };
    let Ok(entries) = std::fs::read_dir(&listing) else {
        return path;
    };
    let lower = prefix.to_lowercase();
    let mut names: Vec<(String, bool)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.to_lowercase()
                .starts_with(&lower)
                .then(|| (name, e.path().is_dir()))
        })
        .collect();
    names.sort();
    match names.as_slice() {
        [] => path,
        [(name, is_dir)] => {
            let separator = if cfg!(windows) { "\\" } else { "/" };
            format!("{dir}{name}{}", if *is_dir { separator } else { "" })
        }
        many => {
            let first: Vec<char> = many[0].0.chars().collect();
            let mut shared = first.len();
            for (name, _) in &many[1..] {
                let other: Vec<char> = name.chars().collect();
                shared = shared.min(
                    first
                        .iter()
                        .zip(&other)
                        .take_while(|(a, b)| a.to_lowercase().eq(b.to_lowercase()))
                        .count(),
                );
            }
            format!(
                "{dir}{}",
                first[..shared.max(prefix.chars().count()).min(first.len())]
                    .iter()
                    .collect::<String>()
            )
        }
    }
}

// ---------------------------------------------------------------- the run

/// What the worker tells the screen.
pub enum JobMsg {
    Created(Box<Recording>),
    Status {
        phase: String,
        percent: u64,
        message: UserMessage,
    },
    Segment {
        start: f64,
        end: f64,
        text: String,
    },
    Ended(Outcome),
}

pub enum Outcome {
    Done,
    /// A second language was heard and the window's settings say to ask.
    Offer(String),
    Failed(UserMessage),
    Cancelled,
}

#[derive(PartialEq, Eq)]
pub enum Stage {
    /// Waiting for a transcription in the window to end.
    Waiting,
    Running,
    Asking,
    Done,
    Failed,
    Stopped,
}

struct PhaseRow {
    name: String,
    label: String,
    caption: String,
    started: Instant,
    took: Option<Duration>,
}

pub struct Run {
    pub request: Request,
    pub id: Option<String>,
    pub title: String,
    file_name: String,
    pub duration: f64,
    model: String,
    compute: String,
    pub stage: Stage,
    phases: Vec<PhaseRow>,
    last: Option<(String, u64)>,
    pub percent: u64,
    position: f64,
    transcribing_since: Option<(Instant, f64)>,
    live: VecDeque<(f64, String)>,
    started: Instant,
    took: Option<Duration>,
    pub task: TranscriptionTask,
    pub offer: Option<String>,
    pub failure: Option<String>,
    pub kept: bool,
    summary: Option<Summary>,
    /// Whether a piece of work is alive on the worker thread.
    pub working: bool,
}

struct Summary {
    blocks: i64,
    speakers: usize,
    languages: String,
    model: String,
    first: Vec<FirstBlock>,
}

/// A block from the start of the finished transcript: its time, its speaker's
/// name and colour, its text.
type FirstBlock = (f64, Option<(String, String)>, String);

impl Run {
    pub fn new(request: Request, ctx: &Ctx) -> Run {
        let check = volocal_lib::tools::check(&ctx.settings);
        let file_name = request
            .file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Run {
            title: request
                .file
                .file_stem()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            file_name,
            request,
            id: None,
            duration: 0.0,
            model: check
                .model_whisper_id
                .unwrap_or_else(|| ctx.settings.model.clone()),
            compute: check.compute,
            stage: Stage::Waiting,
            phases: Vec::new(),
            last: None,
            percent: 0,
            position: 0.0,
            transcribing_since: None,
            live: VecDeque::new(),
            started: Instant::now(),
            took: None,
            task: TranscriptionTask::default(),
            offer: None,
            failure: None,
            kept: false,
            summary: None,
            working: false,
        }
    }

    /// Whether something on this screen moves.
    pub fn animating(&self) -> bool {
        matches!(self.stage, Stage::Waiting | Stage::Running)
    }

    pub fn handle(&mut self, message: JobMsg, ctx: &Ctx) {
        match message {
            JobMsg::Created(recording) => {
                self.id = Some(recording.id.clone());
                self.title = crate::archive::title_of(&recording);
                self.duration = recording.duration;
            }
            JobMsg::Status {
                phase,
                percent,
                message,
            } => {
                let previous = self.last.as_ref().map(|(p, n)| (p.as_str(), *n));
                if !keeps_moving_forward(previous, (&phase, percent)) {
                    return;
                }
                let changed = self.last.as_ref().is_none_or(|(p, _)| *p != phase);
                self.last = Some((phase.clone(), percent));
                self.percent = percent;
                let caption = tell_in(ctx.theme.lang, &message);
                if changed {
                    let now = Instant::now();
                    if let Some(current) = self.phases.last_mut().filter(|p| p.took.is_none()) {
                        current.took = Some(now - current.started);
                    }
                    if phase == "transcription" {
                        self.transcribing_since = Some((now, self.position));
                    }
                    self.phases.push(PhaseRow {
                        name: phase,
                        label: caption.clone(),
                        caption,
                        started: now,
                        took: None,
                    });
                } else if let Some(current) = self.phases.last_mut() {
                    current.caption = caption;
                }
            }
            JobMsg::Segment { start, end, text } => {
                self.position = self.position.max(end);
                let text = text.trim().to_string();
                if !text.is_empty() {
                    self.live.push_back((start, text));
                    while self.live.len() > 300 {
                        self.live.pop_front();
                    }
                }
            }
            JobMsg::Ended(outcome) => {
                self.working = false;
                self.last = None;
                if let Some(current) = self.phases.last_mut().filter(|p| p.took.is_none()) {
                    current.took = Some(current.started.elapsed());
                }
                match outcome {
                    Outcome::Done => self.finish(ctx),
                    Outcome::Offer(language) => {
                        self.offer = Some(language);
                        self.finish(ctx);
                        self.stage = Stage::Asking;
                    }
                    Outcome::Failed(message) => {
                        self.failure = Some(crate::common::describe_in(ctx.theme.lang, &message));
                        self.stage = Stage::Failed;
                    }
                    Outcome::Cancelled => {
                        self.kept = self
                            .id
                            .as_ref()
                            .and_then(|id| db::recording(&ctx.db, id).ok())
                            .is_some_and(|r| r.segment_count > 0);
                        self.stage = Stage::Stopped;
                    }
                }
            }
        }
    }

    fn finish(&mut self, ctx: &Ctx) {
        self.stage = Stage::Done;
        self.took.get_or_insert(self.started.elapsed());
        let Some(id) = &self.id else { return };
        let Ok(recording) = db::recording(&ctx.db, id) else {
            return;
        };
        let speakers = db::speakers(&ctx.db, id).unwrap_or_default();
        let lang = ctx.theme.lang;
        let mut languages = words::language_name(lang, &recording.language);
        if let Some(second) = &recording.second_language {
            languages = format!("{languages} + {}", words::language_name(lang, second));
        }
        let first = db::segments(&ctx.db, id)
            .unwrap_or_default()
            .into_iter()
            .take(3)
            .map(|s| {
                let speaker = s
                    .speakers
                    .as_deref()
                    .and_then(|k| speakers.iter().find(|p| p.key == k))
                    .map(|p| (p.name.clone(), p.color.clone()));
                (s.start, speaker, s.text)
            })
            .collect();
        self.title = crate::archive::title_of(&recording);
        self.summary = Some(Summary {
            blocks: recording.segment_count,
            speakers: speakers.len(),
            languages,
            model: recording.model,
            first,
        });
    }

    /// The badge other screens show while this runs: percent and time left.
    pub fn estimate(&self, lang: Lang) -> Option<String> {
        let (since, from) = self.transcribing_since?;
        if self.last.as_ref().map(|(p, _)| p.as_str()) != Some("transcription") {
            return None;
        }
        let done = self.position - from;
        let left = self.duration - self.position;
        let elapsed = since.elapsed().as_secs_f64();
        if done < self.duration * 0.03 || elapsed < 5.0 || left <= 0.0 {
            return None;
        }
        Some(words::time_left(lang, left * elapsed / done))
    }

    pub fn draw(&self, frame: &mut Frame, area: Rect, ctx: &Ctx, tick: usize) {
        match self.stage {
            Stage::Waiting | Stage::Running => self.draw_progress(frame, area, ctx, tick),
            _ => self.draw_end(frame, area, ctx),
        }
    }

    fn mark(&self, theme: &Theme, tick: usize, still: bool) -> Vec<Line<'static>> {
        let g = theme.glyphs();
        if !g.braille {
            let text = ["", "", "  olo", "", "", "", ""];
            return text.iter().map(|t| ui::plain(*t, theme.bold())).collect();
        }
        if still {
            return FACE
                .iter()
                .map(|row| ui::plain(row.to_string(), theme.text()))
                .collect();
        }
        let frame = &MILL[(tick * 100 / 110) % MILL.len()];
        frame
            .iter()
            .enumerate()
            .map(|(i, row)| {
                ui::plain(
                    row.to_string(),
                    if i == 3 { theme.accent() } else { theme.text() },
                )
            })
            .collect()
    }

    fn draw_progress(&self, frame: &mut Frame, area: Rect, ctx: &Ctx, tick: usize) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let lang = theme.lang;
        let width = area.width as usize;
        let mark_area = Rect {
            x: area.x + 6,
            y: area.y + 1,
            width: 18,
            height: 7,
        };
        frame.render_widget(Paragraph::new(self.mark(theme, tick, false)), mark_area);
        let right = Rect {
            x: area.x + 26,
            y: area.y + 1,
            width: area.width.saturating_sub(30),
            height: 12,
        };
        let room = right.width as usize;
        let mut lines = vec![
            ui::plain(cut(&self.title, room, g.ellipsis), theme.bold()),
            ui::plain(
                cut(
                    &[
                        self.file_name.clone(),
                        if self.duration > 0.0 {
                            clock(self.duration)
                        } else {
                            String::new()
                        },
                        self.model.clone(),
                    ]
                    .into_iter()
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(" · "),
                    room,
                    g.ellipsis,
                ),
                theme.muted(),
            ),
            Line::raw(""),
        ];
        if self.stage == Stage::Waiting {
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{} ", g.mill[tick % g.mill.len()].trim()),
                    theme.accent(),
                ),
                Span::styled(w.waiting_for_window, theme.bold()),
            ]));
            lines.push(ui::plain(w.waiting_why, theme.muted()));
        } else {
            let label_width = self
                .phases
                .iter()
                .map(|p| ui::cells(&p.label))
                .max()
                .unwrap_or(10)
                .clamp(14, 30);
            for phase in self
                .phases
                .iter()
                .filter(|p| p.name != "queued" || p.took.is_none())
            {
                match phase.took {
                    Some(took) => lines.push(Line::from(vec![
                        Span::styled(format!("{} ", g.done), theme.success()),
                        Span::styled(
                            ui::pad(&cut(&phase.label, label_width, g.ellipsis), label_width + 2),
                            theme.muted(),
                        ),
                        Span::styled(clock(took.as_secs_f64()), theme.muted()),
                    ])),
                    None => {
                        let mut spans = vec![
                            Span::styled(format!("{} ", g.active), theme.accent()),
                            Span::styled(
                                ui::pad(
                                    &cut(&phase.caption, label_width, g.ellipsis),
                                    label_width + 2,
                                ),
                                theme.bold(),
                            ),
                        ];
                        if phase.name == "transcription" && self.duration > 0.0 {
                            spans.push(Span::styled(
                                format!(
                                    "{} {} {}",
                                    clock(self.position),
                                    w.of,
                                    clock(self.duration)
                                ),
                                theme.muted(),
                            ));
                        }
                        lines.push(Line::from(spans));
                    }
                }
            }
            lines.push(Line::raw(""));
            let bar_width = room.saturating_sub(8).min(60);
            let mut bar = ui::bar(theme, self.percent as f64 / 100.0, bar_width);
            bar.push(Span::styled(
                format!("  {:>3} %", self.percent),
                theme.bold(),
            ));
            lines.push(Line::from(bar));
            let mut status = Vec::new();
            if let Some(left) = self.estimate(lang) {
                status.push(left);
            }
            status.push(words::runs_on(lang, &self.compute));
            lines.push(ui::plain(status.join(" · "), theme.muted()));
        }
        frame.render_widget(Paragraph::new(lines), right);

        // The words as they come, the newest at the bottom, the oldest fading.
        let live_top = 14u16;
        if area.height > live_top + 2 {
            let live_area = Rect {
                x: area.x + 4,
                y: area.y + live_top,
                width: area.width.saturating_sub(8),
                height: area.height - live_top,
            };
            let text_width = (live_area.width as usize).saturating_sub(9).max(20);
            let mut rows: Vec<Line> = Vec::new();
            for (start, text) in &self.live {
                for (i, piece) in ui::wrap(text, text_width).into_iter().enumerate() {
                    let time = if i == 0 {
                        format!("{:>7}  ", clock(*start))
                    } else {
                        " ".repeat(9)
                    };
                    rows.push(Line::from(vec![Span::raw(time), Span::raw(piece)]));
                }
            }
            let room = live_area.height as usize - 1;
            let skip = rows.len().saturating_sub(room);
            let shown: Vec<Line> = rows.into_iter().skip(skip).collect();
            let n = shown.len();
            let mut lines = vec![ui::plain(
                w.live_transcript,
                theme.muted().add_modifier(Modifier::BOLD),
            )];
            for (i, line) in shown.into_iter().enumerate() {
                let style = if n > 3 && i == 0 {
                    theme.faint()
                } else if n > 3 && i < 3 {
                    theme.muted()
                } else {
                    theme.text()
                };
                let spans: Vec<Span> = line
                    .spans
                    .into_iter()
                    .enumerate()
                    .map(|(j, s)| s.style(if j == 0 { theme.muted() } else { style }))
                    .collect();
                lines.push(Line::from(spans));
            }
            frame.render_widget(Paragraph::new(lines), live_area);
        }
        let _ = width;
    }

    fn draw_end(&self, frame: &mut Frame, area: Rect, ctx: &Ctx) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let lang = theme.lang;
        let mark_area = Rect {
            x: area.x + 4,
            y: area.y + 1,
            width: 18,
            height: 7,
        };
        frame.render_widget(Paragraph::new(self.mark(theme, 0, true)), mark_area);
        let right = Rect {
            x: area.x + 26,
            y: area.y + 1,
            width: area.width.saturating_sub(30),
            height: area.height.saturating_sub(1),
        };
        let room = right.width as usize;
        let mut lines = vec![ui::plain(cut(&self.title, room, g.ellipsis), theme.bold())];
        match self.stage {
            Stage::Failed => {
                lines.push(Line::raw(""));
                lines.push(Line::from(vec![
                    Span::styled(format!("{} ", g.failed), theme.danger()),
                    Span::styled(w.failed.to_string(), theme.danger()),
                ]));
                if let Some(reason) = &self.failure {
                    for piece in ui::wrap(reason, room) {
                        lines.push(ui::plain(piece, theme.danger()));
                    }
                }
            }
            Stage::Stopped => {
                lines.push(Line::raw(""));
                lines.push(ui::plain(
                    if self.kept {
                        w.stopped_kept
                    } else {
                        w.stopped_lost
                    },
                    theme.text(),
                ));
            }
            _ => {
                let took = self.took.unwrap_or_default().as_secs_f64();
                lines.push(ui::plain(
                    words::speed(lang, self.duration, took),
                    theme.muted(),
                ));
                if let Some(s) = &self.summary {
                    let mut meta = vec![count(lang, s.blocks, w.blocks)];
                    if s.speakers > 0 {
                        meta.push(count(lang, s.speakers as i64, w.speakers));
                    }
                    if !s.languages.is_empty() {
                        meta.push(s.languages.clone());
                    }
                    if !s.model.is_empty() {
                        meta.push(s.model.clone());
                    }
                    lines.push(ui::plain(
                        cut(&meta.join(" · "), room, g.ellipsis),
                        theme.muted(),
                    ));
                }
            }
        }
        lines.push(Line::raw(""));
        let label_width = self
            .phases
            .iter()
            .map(|p| ui::cells(&p.label))
            .max()
            .unwrap_or(10)
            .clamp(14, 30);
        for phase in self.phases.iter().filter(|p| p.name != "queued") {
            lines.push(Line::from(vec![
                Span::styled(format!("{} ", g.done), theme.success()),
                Span::styled(
                    ui::pad(&cut(&phase.label, label_width, g.ellipsis), label_width + 2),
                    theme.muted(),
                ),
                Span::styled(
                    clock(phase.took.unwrap_or_default().as_secs_f64()),
                    theme.muted(),
                ),
            ]));
        }
        if let (Stage::Asking, Some(language)) = (&self.stage, &self.offer) {
            lines.push(Line::raw(""));
            lines.push(Line::from(vec![
                Span::styled(format!("{} ", g.bar), theme.accent()),
                Span::styled(words::offer(lang, language), theme.bold()),
            ]));
            lines.push(Line::from(vec![
                Span::styled(format!("{} ", g.bar), theme.accent()),
                Span::styled(" d ", theme.key()),
                Span::styled(format!(" {}    ", w.fill_in), theme.muted()),
                Span::styled(" x ", theme.key()),
                Span::styled(format!(" {}", w.leave_it), theme.muted()),
            ]));
        }
        if let Some(s) = self.summary.as_ref().filter(|s| !s.first.is_empty()) {
            lines.push(Line::raw(""));
            lines.push(ui::plain(
                w.transcript_start,
                theme.muted().add_modifier(Modifier::BOLD),
            ));
            for (start, speaker, text) in &s.first {
                let mut head = vec![Span::styled(
                    format!("{:>7}  ", clock(*start)),
                    theme.muted(),
                )];
                if let Some((name, colour)) = speaker {
                    head.push(Span::styled(name.clone(), theme.speaker(colour)));
                    lines.push(Line::from(head));
                    head = vec![Span::raw(" ".repeat(9))];
                }
                if let Some(first) = ui::wrap(text, room.saturating_sub(10)).into_iter().next() {
                    head.push(Span::styled(first, theme.text()));
                }
                lines.push(Line::from(head));
            }
        }
        frame.render_widget(Paragraph::new(lines), right);
    }

    pub fn footer(&self, ctx: &Ctx) -> FooterKeys {
        let w = ctx.words();
        let g = ctx.theme.glyphs();
        match self.stage {
            Stage::Waiting | Stage::Running => (
                vec![
                    ("Ctrl+C", w.stop_transcription),
                    ("Esc", w.back_keeps_running),
                ],
                vec![("?", w.key_help)],
            ),
            Stage::Asking | Stage::Done => (
                vec![
                    (g.enter, w.key_read),
                    ("e", w.key_save_as),
                    ("a", w.key_new),
                ],
                vec![("Esc", w.key_archive)],
            ),
            _ => (vec![("a", w.key_new)], vec![("Esc", w.key_archive)]),
        }
    }
}

// ---------------------------------------------------------------- workers

/// A report that hands every event to the screen and keeps how the work
/// ended, as `volocal-cli` keeps it.
/// How a piece of the engine's work ended, as its last report said.
type Ending = Arc<Mutex<Option<(String, UserMessage)>>>;

fn reporting(tx: &Sender<Msg>) -> (Report, Ending) {
    let ending: Ending = Arc::default();
    let report = {
        let tx = tx.clone();
        let ending = ending.clone();
        Report::Callback(Arc::new(move |event, payload| match event {
            "transcription:segment" => {
                let _ = tx.send(Msg::Job(JobMsg::Segment {
                    start: payload["start"].as_f64().unwrap_or(0.0),
                    end: payload["end"].as_f64().unwrap_or(0.0),
                    text: payload["text"].as_str().unwrap_or_default().to_string(),
                }));
            }
            "transcription:status" => {
                let phase = payload["phase"].as_str().unwrap_or_default().to_string();
                let percent = payload["percent"].as_u64().unwrap_or(0);
                let Ok(message) =
                    serde_json::from_value::<UserMessage>(payload["description"].clone())
                else {
                    return;
                };
                if matches!(phase.as_str(), "complete" | "cancelled" | "error") {
                    *ending.lock().unwrap() = Some((phase, message));
                } else {
                    let _ = tx.send(Msg::Job(JobMsg::Status {
                        phase,
                        percent,
                        message,
                    }));
                }
            }
            _ => {}
        }))
    };
    (report, ending)
}

fn ended(ending: &Mutex<Option<(String, UserMessage)>>) -> Outcome {
    match ending.lock().unwrap().take() {
        Some((phase, _)) if phase == "complete" => Outcome::Done,
        Some((phase, _)) if phase == "cancelled" => Outcome::Cancelled,
        Some((_, message)) => Outcome::Failed(message),
        None => {
            Outcome::Failed(UserMessage::new("unknown").detail("the work ended without saying how"))
        }
    }
}

/// The work a run starts with: the file into the archive, the transcription,
/// and the speakers when they were asked for and the window does not
/// separate them on its own. A second language the window's settings say to
/// ask about stops it there, with the question.
pub fn start(
    tx: Sender<Msg>,
    archive: PathBuf,
    settings: db::Settings,
    request: Request,
    task: TranscriptionTask,
) {
    std::thread::Builder::new()
        .name("volocal-tui-run".into())
        .spawn(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                transcribe_file(&tx, &archive, &settings, request, &task)
            }))
            .unwrap_or_else(|_| Outcome::Failed(UserMessage::new("unknown")));
            let _ = tx.send(Msg::Job(JobMsg::Ended(outcome)));
        })
        .expect("a thread for the run");
}

fn transcribe_file(
    tx: &Sender<Msg>,
    archive: &Path,
    settings: &db::Settings,
    request: Request,
    task: &TranscriptionTask,
) -> Outcome {
    let connection = match db::open(archive) {
        Ok(c) => c,
        Err(e) => return Outcome::Failed(UserMessage::unknown(e)),
    };
    let (file, duration) = match volocal_lib::prepare_import(settings, archive, request.file) {
        Ok(found) => found,
        Err(message) => return Outcome::Failed(message),
    };
    let recording = match volocal_lib::create_recording(&connection, file, duration) {
        Ok(r) => r,
        Err(message) => return Outcome::Failed(message),
    };
    let id = recording.id.clone();
    let _ = tx.send(Msg::Job(JobMsg::Created(Box::new(recording))));
    if let Some(language) = &request.language {
        let _ = db::set_language_choice(&connection, &id, language);
    }
    let _alive = volocal_lib::run_lock::hold(archive, &id);
    let _ends = crate::console::watch(task, &id);

    let (report, ending) = reporting(tx);
    transcription::transcribe(&report, archive, &id, task, request.speakers);
    let outcome = ended(&ending);
    if !matches!(outcome, Outcome::Done) {
        return outcome;
    }
    let offer = db::second_language(&connection, &id).ok().flatten();
    if let Some(offer) = offer.filter(|o| o.state == db::second_language_state::OFFERED) {
        return Outcome::Offer(offer.language);
    }
    if request.speakers.is_some() && !settings.diarization {
        let (report, ending) = reporting(tx);
        transcription::recognise_speakers(&report, archive, &id, task, request.speakers);
        return ended(&ending);
    }
    Outcome::Done
}

/// The answer *Doplnit*: the second language written in, then the speakers
/// if they were asked for, so the added blocks are told apart with the rest.
pub fn fill(
    tx: Sender<Msg>,
    archive: PathBuf,
    settings: db::Settings,
    id: String,
    speakers: Option<i64>,
    task: TranscriptionTask,
) {
    std::thread::Builder::new()
        .name("volocal-tui-fill".into())
        .spawn(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _alive = volocal_lib::run_lock::hold(&archive, &id);
                let _ends = crate::console::watch(&task, &id);
                let (report, _) = reporting(&tx);
                let (done, cancelled) =
                    transcription::fill_second_language(&report, &archive, &id, &task);
                if cancelled {
                    return Outcome::Cancelled;
                }
                if let Err(message) = done {
                    return Outcome::Failed(message);
                }
                if speakers.is_some() && !settings.diarization {
                    let (report, ending) = reporting(&tx);
                    transcription::recognise_speakers(&report, &archive, &id, &task, speakers);
                    return ended(&ending);
                }
                Outcome::Done
            }))
            .unwrap_or_else(|_| Outcome::Failed(UserMessage::new("unknown")));
            let _ = tx.send(Msg::Job(JobMsg::Ended(outcome)));
        })
        .expect("a thread for the fill");
}

/// The answer *Nechat být*, as the window's `refuse_second_language` writes
/// it: the standing choice goes, and the refusal is remembered.
pub fn refuse(connection: &rusqlite::Connection, id: &str) {
    let _ = db::set_second_language_choice(connection, id, "", true);
    let _ = db::set_second_language_state(connection, id, db::second_language_state::REFUSED);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dropped_path_loses_its_quotes() {
        assert_eq!(
            clean_path("\"C:\\Nahrávky\\a b.mp3\"\r\n"),
            "C:\\Nahrávky\\a b.mp3"
        );
        assert_eq!(clean_path("  /tmp/x.wav "), "/tmp/x.wav");
    }
}
