//! The screen: which feature is open, what may start, the questions and
//! notices, and how they are drawn together.
//!
//! **Each feature owns its state and what can be done to it** (`archive.rs`,
//! `reader.rs`, `transcribe.rs`, `export.rs`, `status.rs`); this file is
//! handed what they ask for and does it. Only it starts a transcription, so the
//! readiness check and the wait for a run in the window cannot be skipped, and
//! only it asks the reader a question.

use crate::archive::{Archive, ArchiveAction};
use crate::export::{Export, ExportAction, ExportMsg};
use crate::reader::{Reader, ReaderAction};
use crate::status::Status;
use crate::theme::Theme;
use crate::transcribe::{self, JobMsg, Request, Run, Sheet, SheetAction, Stage};
use crate::ui::{self, FooterKeys};
use crate::words::{self, Words};
use ratatui::crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::style::Modifier;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};
use volocal_lib::db;
use volocal_lib::user_message::UserMessage;

/// What every feature may read: the archive, the window's settings, the look.
pub struct Ctx {
    pub archive: PathBuf,
    pub db: rusqlite::Connection,
    pub settings: db::Settings,
    pub theme: Theme,
}

impl Ctx {
    pub fn words(&self) -> &'static Words {
        words::of(self.theme.lang)
    }
}

/// A key, as the screens answer to it. Matched by the character it types:
/// on Windows AltGr arrives as Ctrl+Alt, and a Czech keyboard reaches `/` and
/// `?` only with Shift, so the modifiers of a typed character are not held
/// against it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Key {
    Char(char),
    Enter,
    Esc,
    Up,
    Down,
    Left,
    Right,
    PageUp,
    PageDown,
    Home,
    End,
    Tab,
    BackTab,
    Backspace,
    CtrlC,
}

pub fn key_of(event: KeyEvent) -> Option<Key> {
    // Windows reports a release as well as a press.
    if event.kind == KeyEventKind::Release {
        return None;
    }
    let control = event.modifiers.contains(KeyModifiers::CONTROL);
    let alt = event.modifiers.contains(KeyModifiers::ALT);
    Some(match event.code {
        KeyCode::Char('c') | KeyCode::Char('C') if control && !alt => Key::CtrlC,
        KeyCode::Char(_) if control && !alt => return None,
        KeyCode::Char(c) => Key::Char(c),
        KeyCode::Enter => Key::Enter,
        KeyCode::Esc => Key::Esc,
        KeyCode::Up => Key::Up,
        KeyCode::Down => Key::Down,
        KeyCode::Left => Key::Left,
        KeyCode::Right => Key::Right,
        KeyCode::PageUp => Key::PageUp,
        KeyCode::PageDown => Key::PageDown,
        KeyCode::Home => Key::Home,
        KeyCode::End => Key::End,
        KeyCode::Tab => Key::Tab,
        KeyCode::BackTab => Key::BackTab,
        KeyCode::Backspace => Key::Backspace,
        _ => return None,
    })
}

pub enum Msg {
    Input(Event),
    Job(JobMsg),
    Export(ExportMsg),
}

/// A running transcription, as the other screens mention it.
pub struct RunBadge {
    pub id: String,
    pub percent: u64,
    pub left: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Screen {
    Archive,
    Reader,
    Run,
    Status,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Asked {
    Stop,
    Quit,
    Clash,
}

struct Question {
    asked: Asked,
    title: String,
    text: String,
    options: Vec<(char, String)>,
}

pub struct App {
    pub ctx: Ctx,
    tx: Sender<Msg>,
    screen: Screen,
    archive: Archive,
    reader: Option<Reader>,
    run: Option<Run>,
    sheet: Option<Sheet>,
    export: Option<Export>,
    status: Option<Status>,
    help: bool,
    question: Option<Question>,
    notice: Option<(String, bool, Instant)>,
    elsewhere: HashSet<String>,
    data_version: i64,
    polled: Instant,
    tick: usize,
    last_ctrl_c: Option<Instant>,
    quitting: Option<Instant>,
    pub done: bool,
}

fn data_version(connection: &rusqlite::Connection) -> i64 {
    connection
        .query_row("PRAGMA data_version", [], |r| r.get(0))
        .unwrap_or(0)
}

/// A message stored with a failed recording: a code the dictionaries know, or
/// a finished sentence from an older archive.
pub fn stored_message(lang: words::Lang, stored: &str) -> String {
    match serde_json::from_str::<UserMessage>(stored) {
        Ok(message) => crate::common::describe_in(lang, &message),
        Err(_) => stored.to_string(),
    }
}

impl App {
    pub fn new(ctx: Ctx, tx: Sender<Msg>) -> App {
        let mut archive = Archive::new();
        archive.load(&ctx.db);
        let data_version = data_version(&ctx.db);
        let elsewhere = volocal_lib::run_lock::held_elsewhere(&ctx.archive)
            .into_iter()
            .collect();
        App {
            ctx,
            tx,
            screen: Screen::Archive,
            archive,
            reader: None,
            run: None,
            sheet: None,
            export: None,
            status: None,
            help: false,
            question: None,
            notice: None,
            elsewhere,
            data_version,
            polled: Instant::now(),
            tick: 0,
            last_ctrl_c: None,
            quitting: None,
            done: false,
        }
    }

    /// Whether something on screen moves, so the loop draws ten times a second
    /// rather than once.
    pub fn animating(&self) -> bool {
        self.run.as_ref().is_some_and(Run::animating) || self.archive.pending()
    }

    fn working(&self) -> bool {
        self.run
            .as_ref()
            .is_some_and(|r| r.working || r.stage == Stage::Waiting)
    }

    fn notify(&mut self, text: impl Into<String>, error: bool) {
        self.notice = Some((text.into(), error, Instant::now()));
    }

    pub fn tick(&mut self) {
        self.tick = self.tick.wrapping_add(1);
        self.archive.tick(&self.ctx.db);
        if self
            .notice
            .as_ref()
            .is_some_and(|(_, _, at)| at.elapsed() > Duration::from_secs(6))
        {
            self.notice = None;
        }
        if let Some(since) = self.quitting {
            if !self.working() || since.elapsed() > Duration::from_secs(10) {
                self.done = true;
            }
        }
        if self.polled.elapsed() < Duration::from_secs(1) {
            return;
        }
        self.polled = Instant::now();
        // Another program wrote to the archive — the window, the command
        // line, this program's own worker — and the list follows it.
        let version = data_version(&self.ctx.db);
        if version != self.data_version {
            self.data_version = version;
            self.archive.load(&self.ctx.db);
        }
        self.elsewhere = volocal_lib::run_lock::held_elsewhere(&self.ctx.archive)
            .into_iter()
            .collect();
        if self.run.as_ref().is_some_and(|r| r.stage == Stage::Waiting) && !self.busy() {
            self.start_worker();
        }
    }

    /// Whether the archive says something is being transcribed. Before this
    /// program's run has made its recording, any such row is somebody else's.
    fn busy(&self) -> bool {
        db::list_recordings(&self.ctx.db)
            .map(|all| all.iter().any(|r| r.status == db::status::TRANSCRIBING))
            .unwrap_or(false)
    }

    pub fn handle(&mut self, message: Msg) {
        match message {
            Msg::Input(Event::Key(event)) => {
                if let Some(key) = key_of(event) {
                    self.key(key);
                }
            }
            Msg::Input(Event::Paste(text)) => self.paste(&text),
            Msg::Input(_) => {}
            Msg::Job(job) => {
                let ended = matches!(job, JobMsg::Ended(_));
                if let Some(run) = &mut self.run {
                    run.handle(job, &self.ctx);
                }
                if ended {
                    self.archive.load(&self.ctx.db);
                    if self.quitting.is_some() {
                        self.done = true;
                    }
                }
            }
            Msg::Export(done) => match done {
                ExportMsg::Done(path) => {
                    let w = self.ctx.words();
                    self.notify(
                        format!(
                            "{} {}  {}",
                            self.ctx.theme.glyphs().done,
                            w.saved,
                            path.display()
                        ),
                        false,
                    )
                }
                ExportMsg::Failed(text) => self.notify(text, true),
            },
        }
    }

    /// A path pasted or dropped onto the terminal opens the sheet with it.
    fn paste(&mut self, text: &str) {
        if let Some(sheet) = &mut self.sheet {
            sheet.paste(text);
            return;
        }
        let candidate = text.trim().trim_matches('"');
        if std::path::Path::new(candidate).is_file()
            && self.question.is_none()
            && self.export.is_none()
        {
            let mut sheet = Sheet::new(String::new());
            sheet.paste(text);
            self.sheet = Some(sheet);
        }
    }

    fn key(&mut self, key: Key) {
        let w = self.ctx.words();
        if let Some(question) = &self.question {
            let asked = question.asked;
            let chosen = match key {
                Key::Enter => question.options.first().map(|o| o.0),
                Key::Esc => Some('\u{1b}'),
                Key::CtrlC if asked == Asked::Stop => Some('\u{3}'),
                Key::Char(c) => question.options.iter().find(|o| o.0 == c).map(|o| o.0),
                _ => None,
            };
            if let Some(chosen) = chosen {
                self.question = None;
                self.answer(asked, chosen);
            }
            return;
        }
        if self.help {
            if matches!(key, Key::Esc | Key::Char('?') | Key::Char('q') | Key::Enter) {
                self.help = false;
            }
            return;
        }
        if key == Key::CtrlC {
            self.ctrl_c();
            return;
        }
        if let Some(export) = &mut self.export {
            match export.key(key, &self.ctx, &self.tx) {
                Some(ExportAction::Cancel) => self.export = None,
                Some(ExportAction::Saved(paths)) => {
                    self.export = None;
                    let audio = paths.iter().any(|p| {
                        matches!(
                            p.extension().and_then(|e| e.to_str()),
                            Some("mp3" | "m4a" | "wav")
                        )
                    });
                    let first = paths
                        .first()
                        .map(|p| p.display().to_string())
                        .unwrap_or_default();
                    let text = if audio {
                        w.converting_audio.to_string()
                    } else {
                        format!("{} {}  {first}", self.ctx.theme.glyphs().done, w.saved)
                    };
                    self.notify(text, false);
                }
                Some(ExportAction::Clash) => {
                    let n = self.export.as_ref().map_or(0, |e| e.clashes.len());
                    self.question = Some(Question {
                        asked: Asked::Clash,
                        title: words::clash(self.ctx.theme.lang, n),
                        text: self
                            .export
                            .as_ref()
                            .and_then(|e| e.clashes.first())
                            .map(|p| p.display().to_string())
                            .unwrap_or_default(),
                        options: vec![('j', w.save_beside.into()), ('n', w.replace.into())],
                    });
                }
                Some(ExportAction::Failed(text)) => {
                    self.export = None;
                    self.notify(text, true);
                }
                None => {}
            }
            return;
        }
        if let Some(sheet) = &mut self.sheet {
            match sheet.key(key, self.ctx.theme.lang) {
                Some(SheetAction::Cancel) => self.sheet = None,
                Some(SheetAction::Start(request)) => {
                    self.sheet = None;
                    self.begin(request);
                }
                None => {}
            }
            return;
        }
        let typing = match self.screen {
            Screen::Archive => self.archive.typing(),
            Screen::Reader => self.reader.as_ref().is_some_and(|r| r.typing() || r.info),
            _ => false,
        };
        if !typing {
            match key {
                Key::Char('?') => {
                    self.help = true;
                    return;
                }
                Key::Char('a') => {
                    if self.working() {
                        self.notify(w.already_running, true);
                    } else {
                        self.sheet = Some(Sheet::new(String::new()));
                    }
                    return;
                }
                Key::Char('s') => {
                    self.status = Some(Status::new(&self.ctx));
                    self.screen = Screen::Status;
                    return;
                }
                Key::Char('p') if self.run.is_some() => {
                    self.screen = Screen::Run;
                    return;
                }
                Key::Char('e') => {
                    self.open_export();
                    return;
                }
                _ => {}
            }
        }
        match self.screen {
            Screen::Archive => {
                if !typing && key == Key::Char('q') {
                    self.quit();
                    return;
                }
                if let Some(ArchiveAction::Open { id, at }) = self.archive.key(key) {
                    self.open_reader(&id, at);
                }
            }
            Screen::Reader => {
                if let Some(reader) = &mut self.reader {
                    if let Some(ReaderAction::Back) = reader.key(key) {
                        self.screen = Screen::Archive;
                    }
                }
            }
            Screen::Status => match key {
                Key::Char('r') => self.status = Some(Status::new(&self.ctx)),
                Key::Esc | Key::Char('q') | Key::Left => self.screen = Screen::Archive,
                _ => {}
            },
            Screen::Run => self.run_key(key),
        }
    }

    fn run_key(&mut self, key: Key) {
        let Some(run) = &mut self.run else {
            self.screen = Screen::Archive;
            return;
        };
        match (&run.stage, key) {
            (_, Key::Esc | Key::Char('q')) => self.screen = Screen::Archive,
            (Stage::Asking, Key::Char('d')) => {
                if let Some(id) = run.id.clone() {
                    run.stage = Stage::Running;
                    run.working = true;
                    transcribe::fill(
                        self.tx.clone(),
                        self.ctx.archive.clone(),
                        self.ctx.settings.clone(),
                        id,
                        run.request.speakers,
                        run.task.clone(),
                    );
                }
            }
            (Stage::Asking, Key::Char('x')) => {
                if let Some(id) = &run.id {
                    transcribe::refuse(&self.ctx.db, id);
                }
                run.stage = Stage::Done;
                run.offer = None;
            }
            (Stage::Asking | Stage::Done, Key::Enter) => {
                if let Some(id) = run.id.clone() {
                    self.open_reader(&id, None);
                }
            }
            (Stage::Failed | Stage::Stopped, Key::Enter) => self.screen = Screen::Archive,
            _ => {}
        }
    }

    fn ctrl_c(&mut self) {
        if self.working() {
            let again = self
                .last_ctrl_c
                .is_some_and(|at| at.elapsed() < Duration::from_secs(2));
            self.last_ctrl_c = Some(Instant::now());
            if again {
                self.stop_run();
            } else {
                self.ask_stop();
            }
        } else {
            self.done = true;
        }
    }

    fn ask_stop(&mut self) {
        let w = self.ctx.words();
        self.question = Some(Question {
            asked: Asked::Stop,
            title: w.stop_title.into(),
            text: w.stop_text.into(),
            options: vec![('z', w.stop_action.into()), ('p', w.keep_running.into())],
        });
    }

    fn quit(&mut self) {
        if !self.working() {
            self.done = true;
            return;
        }
        let w = self.ctx.words();
        self.question = Some(Question {
            asked: Asked::Quit,
            title: w.quit_title.into(),
            text: w.quit_text.into(),
            options: vec![('z', w.quit_action.into()), ('p', w.keep_running.into())],
        });
    }

    fn answer(&mut self, asked: Asked, chosen: char) {
        match (asked, chosen) {
            (Asked::Stop, 'z' | '\u{3}') => self.stop_run(),
            (Asked::Quit, 'z') => {
                self.stop_run();
                self.quitting = Some(Instant::now());
                let w = self.ctx.words();
                self.notify(w.stopping, false);
            }
            (Asked::Clash, 'n' | 'j') => {
                if let Some(mut export) = self.export.take() {
                    let action = export.write(&self.ctx, &self.tx, chosen == 'j');
                    self.export = Some(export);
                    let w = self.ctx.words();
                    match action {
                        ExportAction::Saved(paths) => {
                            self.export = None;
                            let first = paths
                                .first()
                                .map(|p| p.display().to_string())
                                .unwrap_or_default();
                            self.notify(
                                format!("{} {}  {first}", self.ctx.theme.glyphs().done, w.saved),
                                false,
                            );
                        }
                        ExportAction::Failed(text) => {
                            self.export = None;
                            self.notify(text, true);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    /// Stops the run the way the window's *Zrušit* does.
    fn stop_run(&mut self) {
        if let Some(run) = &mut self.run {
            match (&run.stage, &run.id) {
                (Stage::Waiting, _) => {
                    run.stage = Stage::Stopped;
                    run.kept = false;
                }
                (_, Some(id)) => {
                    run.task.cancel(id);
                }
                // Not in the archive yet: the file is still being prepared,
                // and the run stops as soon as it has an id to stop.
                (_, None) => {}
            }
        }
    }

    /// The one way a transcription starts: ready, not beside another one,
    /// and only then on its thread.
    fn begin(&mut self, request: Request) {
        let w = self.ctx.words();
        let status = Status::new(&self.ctx);
        if !status.ready() {
            self.notify(w.not_ready, true);
            self.status = Some(status);
            self.screen = Screen::Status;
            return;
        }
        let mut run = Run::new(request, &self.ctx);
        run.stage = Stage::Waiting;
        self.run = Some(run);
        self.screen = Screen::Run;
        if !self.busy() {
            self.start_worker();
        }
    }

    fn start_worker(&mut self) {
        let Some(run) = &mut self.run else { return };
        run.stage = Stage::Running;
        run.working = true;
        transcribe::start(
            self.tx.clone(),
            self.ctx.archive.clone(),
            self.ctx.settings.clone(),
            run.request.clone(),
            run.task.clone(),
        );
    }

    fn open_reader(&mut self, id: &str, at: Option<f64>) {
        if let Some(reader) = Reader::open(&self.ctx.db, id, at) {
            let query = self.archive.query.clone();
            self.reader = Some(if query.trim().is_empty() {
                reader
            } else {
                reader.with_query(&query)
            });
            self.screen = Screen::Reader;
        }
    }

    fn open_export(&mut self) {
        let id = match self.screen {
            Screen::Reader => self.reader.as_ref().map(|r| r.recording.id.clone()),
            Screen::Run => self.run.as_ref().and_then(|r| r.id.clone()),
            _ => self.archive.selected_id(),
        };
        if let Some(recording) = id.and_then(|id| db::recording(&self.ctx.db, &id).ok()) {
            self.export = Some(Export::new(&self.ctx.db, recording));
        }
    }

    fn badge(&self) -> Option<RunBadge> {
        let run = self.run.as_ref()?;
        if !run.working {
            return None;
        }
        Some(RunBadge {
            id: run.id.clone()?,
            percent: run.percent,
            left: run.estimate(self.ctx.theme.lang),
        })
    }

    pub fn draw(&self, frame: &mut Frame) {
        let area = frame.area();
        let theme = &self.ctx.theme;
        let w = self.ctx.words();
        let g = theme.glyphs();
        if area.width < 60 || area.height < 16 {
            let text = words::enlarge(theme.lang, area.width, area.height);
            let lines: Vec<Line> = ui::wrap(&text, area.width.saturating_sub(2) as usize)
                .into_iter()
                .map(|l| ui::plain(l, theme.text()))
                .collect();
            let y = (area.height / 2).saturating_sub(lines.len() as u16 / 2);
            frame.render_widget(
                Paragraph::new(lines).alignment(ratatui::layout::Alignment::Center),
                ui::rows(area, y, area.height - y),
            );
            return;
        }
        let header = ui::rows(area, 0, 1);
        let footer = ui::rows(area, area.height - 1, 1);
        let body = ui::rows(area, 1, area.height - 2);
        let badge = self.badge();

        // The header: where the reader is, and what is running.
        let mut left = vec![
            Span::raw("  "),
            Span::styled("olo", theme.bold()),
            Span::raw("  "),
        ];
        let crumb = |left: &mut Vec<Span>, text: String| {
            left.push(Span::styled(g.crumb.trim().to_string(), theme.faint()));
            left.push(Span::raw(" "));
            left.push(Span::styled(text, theme.bold()));
        };
        match self.screen {
            Screen::Archive => left.push(Span::styled(w.archive, theme.bold())),
            Screen::Status => left.push(Span::styled(w.status_title, theme.bold())),
            Screen::Reader => {
                left.push(Span::styled(format!("{} ", w.archive), theme.muted()));
                if let Some(r) = &self.reader {
                    crumb(
                        &mut left,
                        ui::cut(&crate::archive::title_of(&r.recording), 50, g.ellipsis),
                    );
                }
            }
            Screen::Run => {
                left.push(Span::styled(format!("{} ", w.archive), theme.muted()));
                crumb(&mut left, w.new_transcription.to_string());
            }
        }
        let right = match &badge {
            Some(b) if self.screen != Screen::Run => vec![
                Span::styled(g.mill[self.tick % g.mill.len()].to_string(), theme.accent()),
                Span::styled(
                    format!(" {} · {} %  ", w.transcribing, b.percent),
                    theme.accent(),
                ),
            ],
            Some(b) => vec![Span::styled(
                format!("{} %  ", b.percent),
                theme.accent().add_modifier(Modifier::BOLD),
            )],
            None if self.screen == Screen::Reader => vec![Span::styled(
                format!(
                    "{}  ",
                    self.reader
                        .as_ref()
                        .map(|r| crate::common::clock(r.recording.duration))
                        .unwrap_or_default()
                ),
                theme.muted(),
            )],
            None => vec![Span::styled(
                format!("{}  ", self.archive.totals(&self.ctx)),
                theme.muted(),
            )],
        };
        ui::band(frame, header, theme, left, right);

        match self.screen {
            Screen::Archive => self.archive.draw(
                frame,
                body,
                &self.ctx,
                badge.as_ref(),
                &self.elsewhere,
                self.tick,
            ),
            Screen::Reader => {
                if let Some(reader) = &self.reader {
                    reader.draw(frame, body, &self.ctx);
                    if reader.info {
                        reader.draw_info(frame, area, &self.ctx);
                    }
                }
            }
            Screen::Run => {
                if let Some(run) = &self.run {
                    run.draw(frame, body, &self.ctx, self.tick);
                }
            }
            Screen::Status => {
                if let Some(status) = &self.status {
                    let seconds = self.archive.recordings.iter().map(|r| r.duration).sum();
                    status.draw(
                        frame,
                        body,
                        &self.ctx,
                        self.archive.recordings.len(),
                        seconds,
                    );
                }
            }
        }

        if let Some((text, error, _)) = &self.notice {
            let row = ui::rows(area, area.height - 2, 1);
            let style = if *error {
                theme.danger()
            } else {
                theme.success()
            };
            frame.render_widget(
                Paragraph::new(ui::plain(
                    format!("  {}", ui::cut(text, area.width as usize - 4, g.ellipsis)),
                    style,
                ))
                .style(theme.band()),
                row,
            );
        }

        let (keys, right) = self.footer_keys();
        if let Some(sheet) = &self.sheet {
            sheet.draw(frame, area, &self.ctx);
        }
        if let Some(export) = &self.export {
            export.draw(frame, area, &self.ctx);
        }
        if self.help {
            self.draw_help(frame, area);
        }
        if let Some(question) = &self.question {
            self.draw_question(frame, area, question);
        }
        ui::footer(frame, footer, theme, &keys, &right);
    }

    fn footer_keys(&self) -> FooterKeys {
        let w = self.ctx.words();
        let g = self.ctx.theme.glyphs();
        if self.question.is_some() {
            return (vec![(g.enter, w.key_done)], vec![("Esc", w.cancel)]);
        }
        if self.help {
            return (vec![], vec![("Esc", w.key_close_help)]);
        }
        if self.export.is_some() {
            return (
                vec![
                    (g.updown, w.key_move),
                    (w.key_space, w.key_select),
                    ("←→", w.key_audio_format),
                    (g.enter, w.key_save),
                ],
                vec![("Esc", w.cancel)],
            );
        }
        if self.sheet.is_some() {
            return (
                vec![
                    (g.updown, w.key_move),
                    ("←→", w.key_change),
                    (g.enter, w.start_transcription),
                ],
                vec![("Esc", w.cancel)],
            );
        }
        match self.screen {
            Screen::Archive if self.archive.typing() => (
                vec![(g.enter, w.key_done)],
                vec![("Esc", w.key_cancel_search)],
            ),
            Screen::Archive => (
                vec![
                    (g.updown, w.key_move),
                    (g.enter, w.key_read),
                    ("/", w.key_search),
                    ("a", w.key_new),
                    ("e", w.key_save_as),
                ],
                vec![("q", w.key_quit), ("?", w.key_help)],
            ),
            Screen::Reader => self
                .reader
                .as_ref()
                .map(|r| r.footer(&self.ctx))
                .unwrap_or_default(),
            Screen::Run => self
                .run
                .as_ref()
                .map(|r| r.footer(&self.ctx))
                .unwrap_or_default(),
            Screen::Status => (vec![("r", w.key_recheck)], vec![("Esc", w.key_back)]),
        }
    }

    fn draw_question(&self, frame: &mut Frame, area: Rect, question: &Question) {
        let theme = &self.ctx.theme;
        let width = 58u16;
        let text = ui::wrap(&question.text, width as usize - 8);
        let height = 8 + text.len() as u16;
        let inner = ui::dialog(frame, area, theme, width, height);
        let mut lines = vec![ui::plain(question.title.clone(), theme.bold())];
        lines.extend(text.into_iter().map(|t| ui::plain(t, theme.muted())));
        lines.push(Line::raw(""));
        let mut buttons = Vec::new();
        for (i, (key, label)) in question.options.iter().enumerate() {
            let style = if i == 0 { theme.primary() } else { theme.key() };
            buttons.push(Span::styled(format!("  {key}  {label}  "), style));
            buttons.push(Span::raw("  "));
        }
        buttons.push(Span::styled("  Esc  ", theme.key()));
        lines.push(Line::from(buttons));
        frame.render_widget(Paragraph::new(lines), inner);
    }

    fn draw_help(&self, frame: &mut Frame, area: Rect) {
        let theme = &self.ctx.theme;
        let w = self.ctx.words();
        let g = theme.glyphs();
        let inner = ui::dialog(frame, area, theme, 78, 22);
        let column = |title: &str, rows: &[(&str, &str)]| -> Vec<Line<'static>> {
            let mut lines = vec![ui::plain(
                title.to_string(),
                theme.muted().add_modifier(Modifier::BOLD),
            )];
            for (key, label) in rows {
                lines.push(Line::from(vec![
                    Span::styled(ui::pad(key, 10), theme.bold()),
                    Span::styled(label.to_string(), theme.text()),
                ]));
            }
            lines.push(Line::raw(""));
            lines
        };
        let mut left = column(
            w.help_moving,
            &[
                (&format!("{} j k", g.updown), w.help_up_down),
                ("←→ h l", w.help_panes),
                ("PgUp PgDn", w.help_page),
                ("g G", w.help_ends),
                (g.enter, w.help_open),
                ("Esc", w.help_back),
            ],
        );
        left.extend(column(
            w.help_archive,
            &[
                ("/", w.help_search_archive),
                ("f", w.help_filter),
                ("o", w.help_sort),
                ("i", w.help_info),
            ],
        ));
        let mut right = column(
            w.help_reading,
            &[
                ("/", w.help_search_transcript),
                ("n N", w.help_hits),
                ("m M", w.help_speakers),
                ("t", w.help_time),
                ("i", w.help_info),
            ],
        );
        right.extend(column(
            w.help_everywhere,
            &[
                ("a", w.help_new),
                ("e", w.help_save_as),
                ("p", w.help_running),
                ("s", w.help_status),
                ("Ctrl+C", w.help_ctrl_c),
                ("q", w.help_quit),
            ],
        ));
        let head = vec![
            ui::plain(w.help_title, theme.bold()),
            ui::plain(w.help_sentence, theme.muted()),
        ];
        frame.render_widget(Paragraph::new(head), ui::rows(inner, 0, 2));
        let half = inner.width / 2;
        frame.render_widget(
            Paragraph::new(left),
            Rect {
                x: inner.x,
                y: inner.y + 3,
                width: half,
                height: inner.height.saturating_sub(4),
            },
        );
        frame.render_widget(
            Paragraph::new(right),
            Rect {
                x: inner.x + half,
                y: inner.y + 3,
                width: inner.width - half,
                height: inner.height.saturating_sub(4),
            },
        );
        frame.render_widget(
            Paragraph::new(ui::plain(w.help_select_text, theme.muted())),
            ui::rows(inner, inner.height.saturating_sub(1), 1),
        );
    }
}

#[cfg(test)]
mod tests {
    //! Every screen drawn over a small archive, on a test terminal: that it
    //! draws at all, at 100 × 30 and at 80 × 24, and says what it should.
    //! `UPDATE_TUI_SCREENS=<folder>` also writes each screen there as text,
    //! for looking at.

    use super::*;
    use crate::theme::Colours;
    use ratatui::backend::TestBackend;
    use ratatui::crossterm::event::{KeyEvent, KeyEventState};

    fn recording(
        id: &str,
        title: &str,
        status: &str,
        duration: f64,
        created: &str,
    ) -> db::Recording {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "path": format!("C:\\Users\\jana\\{title}.m4a"),
            "title": title,
            "duration": duration,
            "created_at": created,
            "status": status,
            "model": "large-v3-turbo",
            "language": "cs",
            "language_choice": "",
            "second_language_choice": "",
            "second_language_by_reader": false,
            "error": null,
            "segment_count": 0,
        }))
        .unwrap()
    }

    fn sample(lang: words::Lang) -> (App, std::sync::mpsc::Receiver<Msg>, PathBuf) {
        let folder =
            std::env::temp_dir().join(format!("volocal-tui-screens-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let archive = folder.join("volocal.db");
        let connection = db::open(&archive).unwrap();
        let rows = [
            (
                "3f9c2a17-1",
                "Porada vedení — rozpočet 2027",
                db::status::DONE,
                3138.0,
                "2026-10-01T09:14:00",
            ),
            (
                "7d41e0b9-2",
                "Rozhovor s paní Kovářovou",
                db::status::NEW,
                2292.0,
                "2026-09-30T08:02:00",
            ),
            (
                "0a6f3d29-3",
                "Hovor s účetní",
                db::status::FAILED,
                592.0,
                "2026-08-21T11:00:00",
            ),
        ];
        for (id, title, status, duration, created) in rows {
            db::insert_recording(
                &connection,
                &recording(id, title, status, duration, created),
            )
            .unwrap();
        }
        let text = [
            (701.0, "b", "Takže k prvnímu bodu. Návrh leží na stole od minulého týdne a myslím, že ho všichni znáte."),
            (724.0, "a", "Jen bych doplnila, že rozpočet na příští rok počítá s rezervou deset procent."),
            (761.0, "c", "A ta rezerva je v rozpočtu vedená zvlášť, nebo je rozpuštěná v jednotlivých kapitolách?"),
            (768.0, "a", "Zvlášť. Kapitoly zůstávají na loňských částkách."),
        ];
        for (i, (start, speaker, line)) in text.iter().enumerate() {
            db::insert_segment(
                &connection,
                &db::Segment {
                    id: format!("s{i}"),
                    recording_id: "3f9c2a17-1".into(),
                    order: i as i64,
                    start: *start,
                    end: start + 6.0,
                    text: line.to_string(),
                    speakers: Some(speaker.to_string()),
                    ..Default::default()
                },
            )
            .unwrap();
        }
        for (i, (key, name)) in [("a", "Jana Bílá"), ("b", "Petr Novák"), ("c", "Mluvčí 3")]
            .iter()
            .enumerate()
        {
            db::insert_speaker(
                &connection,
                &db::Speaker {
                    key: key.to_string(),
                    recording_id: "3f9c2a17-1".into(),
                    name: name.to_string(),
                    color: db::COLORS[i].into(),
                },
            )
            .unwrap();
        }
        db::set_status(&connection, "3f9c2a17-1", db::status::DONE, None).unwrap();
        let settings = db::load_settings(&connection).unwrap();
        let theme = Theme {
            colours: Colours::Full,
            light: false,
            ascii: false,
            lang,
        };
        let (tx, rx) = std::sync::mpsc::channel();
        let app = App::new(
            Ctx {
                archive,
                db: connection,
                settings,
                theme,
            },
            tx,
        );
        (app, rx, folder)
    }

    fn press(app: &mut App, keys: &[Key]) {
        for key in keys {
            app.key(*key);
        }
    }

    fn screen(app: &App, width: u16, height: u16, name: &str) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|f| app.draw(f)).unwrap();
        let buffer = terminal.backend().buffer().clone();
        let mut text = String::new();
        for y in 0..height {
            for x in 0..width {
                text.push_str(buffer[(x, y)].symbol());
            }
            text.push('\n');
        }
        if let Some(folder) = std::env::var_os("UPDATE_TUI_SCREENS") {
            let _ = std::fs::write(
                std::path::Path::new(&folder).join(format!("{name}-{width}x{height}.txt")),
                &text,
            );
        }
        text
    }

    use ratatui::Terminal;

    #[test]
    fn the_archive_shows_its_recordings_and_their_states() {
        let (app, _rx, folder) = sample(words::Lang::Cs);
        for (w, h) in [(100, 30), (80, 24)] {
            let text = screen(&app, w, h, "archive");
            assert!(text.contains("Porada vedení — rozpočet 2027"), "{text}");
            assert!(text.contains("Zatím nepřepsaná"), "{text}");
            assert!(text.contains("Přepis se nepodařil"), "{text}");
            assert!(text.contains("Nápověda"), "{text}");
        }
        assert!(screen(&app, 100, 30, "archive").contains("Všechny nahrávky"));
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn a_search_finds_a_word_in_a_transcript() {
        let (mut app, _rx, folder) = sample(words::Lang::Cs);
        press(&mut app, &[Key::Char('/')]);
        for c in "rezerv".chars() {
            app.key(Key::Char(c));
        }
        std::thread::sleep(Duration::from_millis(250));
        app.tick();
        let text = screen(&app, 100, 30, "archive-search");
        assert!(text.contains("rezer"), "{text}");
        assert!(!text.contains("Hovor s účetní"), "{text}");
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn the_reader_shows_speakers_and_finds_a_word() {
        let (mut app, _rx, folder) = sample(words::Lang::Cs);
        press(&mut app, &[Key::Enter]);
        let text = screen(&app, 100, 30, "reader");
        assert!(text.contains("Petr Novák"), "{text}");
        assert!(text.contains("11:41"), "{text}");
        press(
            &mut app,
            &[
                Key::Char('/'),
                Key::Char('r'),
                Key::Char('e'),
                Key::Char('z'),
                Key::Enter,
            ],
        );
        let text = screen(&app, 100, 30, "reader-search");
        assert!(text.contains("1 z 2"), "{text}");
        press(
            &mut app,
            &[
                Key::Char('t'),
                Key::Char('1'),
                Key::Char('2'),
                Key::Char(':'),
                Key::Char('4'),
                Key::Char('5'),
                Key::Enter,
            ],
        );
        assert_eq!(app.reader.as_ref().unwrap().recording.id, "3f9c2a17-1");
        let _ = screen(&app, 80, 24, "reader");
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn a_running_transcription_shows_its_phases_and_words() {
        let (mut app, _rx, folder) = sample(words::Lang::Cs);
        let request = Request {
            file: PathBuf::from("C:\\Users\\jana\\kovarova.m4a"),
            language: None,
            speakers: None,
        };
        let mut run = Run::new(request, &app.ctx);
        run.stage = Stage::Running;
        run.working = true;
        app.run = Some(run);
        app.screen = Screen::Run;
        let mut recording = recording(
            "new-1",
            "Rozhovor s paní Kovářovou",
            db::status::TRANSCRIBING,
            2292.0,
            "2026-10-03T08:02:00",
        );
        recording.segment_count = 0;
        app.handle(Msg::Job(JobMsg::Created(Box::new(recording))));
        app.handle(Msg::Job(JobMsg::Status {
            phase: "preparation".into(),
            percent: 2,
            message: UserMessage::new("preparation.converting_audio"),
        }));
        app.handle(Msg::Job(JobMsg::Status {
            phase: "transcription".into(),
            percent: 42,
            message: UserMessage::new("transcription.running"),
        }));
        app.handle(Msg::Job(JobMsg::Segment {
            start: 851.0,
            end: 917.0,
            text: "Takže jsme to museli otočit: nejdřív střecha, pak teprve třídy.".into(),
        }));
        let text = screen(&app, 100, 30, "transcribing");
        assert!(text.contains("Převádím zvuk"), "{text}");
        assert!(text.contains("Přepisuji"), "{text}");
        assert!(text.contains("15:17 z 38:12"), "{text}");
        assert!(text.contains("42 %"), "{text}");
        assert!(text.contains("nejdřív střecha"), "{text}");
        assert!(text.contains("Zastavit přepis"), "{text}");
        // Elsewhere, the header says it runs.
        app.screen = Screen::Archive;
        assert!(screen(&app, 100, 30, "archive-running").contains("Přepisuji · 42 %"));
        // Ctrl+C asks first.
        app.screen = Screen::Run;
        press(&mut app, &[Key::CtrlC]);
        assert!(screen(&app, 100, 30, "stop-question").contains("Zastavit přepis?"));
        press(&mut app, &[Key::Esc]);
        assert!(app.question.is_none());
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn the_end_of_a_run_asks_about_the_second_language() {
        let (mut app, _rx, folder) = sample(words::Lang::Cs);
        let mut run = Run::new(
            Request {
                file: PathBuf::from("porada.m4a"),
                language: None,
                speakers: None,
            },
            &app.ctx,
        );
        run.stage = Stage::Running;
        run.working = true;
        app.run = Some(run);
        app.screen = Screen::Run;
        // The offer as the engine leaves it: English heard, not written in.
        app.ctx
            .db
            .execute(
                "INSERT INTO second_language (recording_id, language, share, state)
                 VALUES ('3f9c2a17-1', 'en', 0.48, ?1)",
                [db::second_language_state::OFFERED],
            )
            .unwrap();
        let finished = db::recording(&app.ctx.db, "3f9c2a17-1").unwrap();
        app.handle(Msg::Job(JobMsg::Created(Box::new(finished))));
        app.handle(Msg::Job(JobMsg::Ended(transcribe::Outcome::Offer(
            "en".into(),
        ))));
        let text = screen(&app, 100, 30, "transcribe-done");
        assert!(
            text.contains("V nahrávce zní také anglicky. Chcete doplnit přepis?"),
            "{text}"
        );
        assert!(text.contains("Nechat být"), "{text}");
        press(&mut app, &[Key::Char('x')]);
        let offer = db::second_language(&app.ctx.db, "3f9c2a17-1").unwrap();
        assert!(offer.is_some_and(|o| o.state == db::second_language_state::REFUSED));
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn the_dialogs_and_the_help_draw_and_close() {
        let (mut app, _rx, folder) = sample(words::Lang::Cs);
        press(&mut app, &[Key::Char('a')]);
        assert!(screen(&app, 100, 30, "sheet").contains("Nový přepis"));
        press(&mut app, &[Key::Esc]);
        press(&mut app, &[Key::Char('e')]);
        let text = screen(&app, 100, 30, "export");
        assert!(text.contains("Jak chcete nahrávku uložit?"), "{text}");
        press(&mut app, &[Key::Esc]);
        press(&mut app, &[Key::Char('?')]);
        let text = screen(&app, 100, 30, "help");
        assert!(text.contains("Klávesové zkratky"), "{text}");
        let _ = screen(&app, 80, 24, "help");
        press(&mut app, &[Key::Esc]);
        press(&mut app, &[Key::Char('s')]);
        let text = screen(&app, 100, 30, "status");
        assert!(text.contains("SOUČÁSTI"), "{text}");
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn a_small_terminal_asks_to_be_larger() {
        let (app, _rx, folder) = sample(words::Lang::Cs);
        assert!(screen(&app, 50, 12, "small").contains("Zvětšete"));
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn english_where_the_system_is_english() {
        let (app, _rx, folder) = sample(words::Lang::En);
        let text = screen(&app, 100, 30, "archive-en");
        assert!(text.contains("All recordings"), "{text}");
        assert!(text.contains("Not transcribed yet"), "{text}");
        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn keys_are_read_by_the_character_they_type() {
        let press = |code, modifiers| KeyEvent {
            code,
            modifiers,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        };
        assert_eq!(
            key_of(press(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            Some(Key::CtrlC)
        );
        // AltGr on a Czech keyboard arrives as Ctrl+Alt.
        assert_eq!(
            key_of(press(
                KeyCode::Char('/'),
                KeyModifiers::CONTROL | KeyModifiers::ALT
            )),
            Some(Key::Char('/'))
        );
        assert_eq!(
            key_of(press(KeyCode::Char('?'), KeyModifiers::SHIFT)),
            Some(Key::Char('?'))
        );
        let mut release = press(KeyCode::Char('q'), KeyModifiers::NONE);
        release.kind = KeyEventKind::Release;
        assert_eq!(key_of(release), None);
    }
}
