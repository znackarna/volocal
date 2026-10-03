//! The archive: folders, a filter, the recordings, and one field that finds
//! a word in titles and transcripts alike.

use crate::app::{Ctx, Key, RunBadge};
use crate::ui::{self, cut, fold, pad};
use crate::words::{self, count};
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use volocal_lib::db::{self, Folder, Recording, SearchResult};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Filter {
    All,
    New,
    Failed,
    MissingLanguage,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Sort {
    Newest,
    Oldest,
    TitleUp,
    TitleDown,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Focus {
    Folders,
    List,
    Query,
}

/// What the archive asks the screen to do.
pub enum ArchiveAction {
    Open { id: String, at: Option<f64> },
}

pub struct Archive {
    pub recordings: Vec<Recording>,
    pub folders: Vec<Folder>,
    speakers: HashMap<String, usize>,
    /// The open folder; `None` is every recording.
    pub folder: Option<String>,
    folder_cursor: usize,
    pub filter: Filter,
    pub sort: Sort,
    pub focus: Focus,
    pub query: String,
    typed_at: Option<Instant>,
    searched: String,
    hits: Vec<SearchResult>,
    selected: usize,
    top: std::cell::Cell<usize>,
}

/// The search runs once the typing pauses, as the window's does.
const SEARCH_PAUSE: Duration = Duration::from_millis(220);

/// A recording's name: its title, or the file it came from.
pub fn title_of(recording: &Recording) -> String {
    if !recording.title.trim().is_empty() {
        return recording.title.clone();
    }
    std::path::Path::new(&recording.path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl Archive {
    pub fn new() -> Archive {
        Archive {
            recordings: Vec::new(),
            folders: Vec::new(),
            speakers: HashMap::new(),
            folder: None,
            folder_cursor: 0,
            filter: Filter::All,
            sort: Sort::Newest,
            focus: Focus::List,
            query: String::new(),
            typed_at: None,
            searched: String::new(),
            hits: Vec::new(),
            selected: 0,
            top: std::cell::Cell::new(0),
        }
    }

    /// Reads the archive again, keeping the selection on the same recording.
    pub fn load(&mut self, connection: &rusqlite::Connection) {
        let keep = self.selected_id();
        if let Ok(recordings) = db::list_recordings(connection) {
            self.recordings = recordings;
        }
        if let Ok(folders) = db::folders(connection) {
            self.folders = folders;
        }
        self.speakers = self
            .recordings
            .iter()
            .filter(|r| r.status == db::status::DONE)
            .map(|r| {
                let n = db::speakers(connection, &r.id)
                    .map(|s| s.len())
                    .unwrap_or(0);
                (r.id.clone(), n)
            })
            .collect();
        if self
            .folder
            .as_ref()
            .is_some_and(|f| !self.folders.iter().any(|x| &x.id == f))
        {
            self.folder = None;
        }
        if let Some(id) = keep {
            if let Some(i) = self.visible().iter().position(|r| r.id == id) {
                self.selected = i;
            }
        }
        self.clamp();
    }

    fn hits_by_recording(&self) -> HashMap<&str, Vec<&SearchResult>> {
        let mut map: HashMap<&str, Vec<&SearchResult>> = HashMap::new();
        if fold(&self.query) == fold(&self.searched) {
            for hit in &self.hits {
                map.entry(hit.recording_id.as_str()).or_default().push(hit);
            }
        }
        map
    }

    /// The recordings shown, in the order shown.
    pub fn visible(&self) -> Vec<&Recording> {
        let query = fold(self.query.trim());
        let hits = self.hits_by_recording();
        let mut shown: Vec<&Recording> = self
            .recordings
            .iter()
            .filter(|r| self.folder.is_none() || r.folder == self.folder)
            .filter(|r| match self.filter {
                Filter::All => true,
                Filter::New => r.status == db::status::NEW,
                Filter::Failed => r.status == db::status::FAILED,
                Filter::MissingLanguage => r.second_language_missing.is_some(),
            })
            .filter(|r| {
                query.is_empty()
                    || fold(&title_of(r)).contains(&query)
                    || hits.contains_key(r.id.as_str())
            })
            .collect();
        match self.sort {
            Sort::Newest => {}
            Sort::Oldest => shown.reverse(),
            Sort::TitleUp => shown.sort_by_key(|r| fold(&title_of(r))),
            Sort::TitleDown => {
                shown.sort_by_key(|r| fold(&title_of(r)));
                shown.reverse();
            }
        }
        shown
    }

    pub fn selected_id(&self) -> Option<String> {
        self.visible().get(self.selected).map(|r| r.id.clone())
    }

    fn clamp(&mut self) {
        let n = self.visible().len();
        if self.selected >= n {
            self.selected = n.saturating_sub(1);
        }
    }

    /// Runs the transcript search once the typing has paused.
    pub fn tick(&mut self, connection: &rusqlite::Connection) {
        let Some(typed) = self.typed_at else {
            return;
        };
        if typed.elapsed() < SEARCH_PAUSE {
            return;
        }
        self.typed_at = None;
        let query = self.query.trim().to_string();
        self.hits = if query.chars().count() >= 2 {
            db::search(connection, &query).unwrap_or_default()
        } else {
            Vec::new()
        };
        self.searched = self.query.clone();
        self.clamp();
    }

    /// Whether a key typed now is text for the search field.
    pub fn typing(&self) -> bool {
        self.focus == Focus::Query
    }

    pub fn key(&mut self, key: Key) -> Option<ArchiveAction> {
        match self.focus {
            Focus::Query => {
                match key {
                    Key::Char(c) => {
                        self.query.push(c);
                        self.typed();
                    }
                    Key::Backspace => {
                        self.query.pop();
                        self.typed();
                    }
                    Key::Esc => {
                        self.query.clear();
                        self.hits.clear();
                        self.searched.clear();
                        self.focus = Focus::List;
                    }
                    Key::Enter | Key::Down | Key::Tab => self.focus = Focus::List,
                    _ => {}
                }
                self.clamp();
                None
            }
            Focus::Folders => {
                let count = self.folders.len() + 1;
                match key {
                    Key::Up | Key::Char('k') => {
                        self.folder_cursor = self.folder_cursor.saturating_sub(1)
                    }
                    Key::Down | Key::Char('j') => {
                        self.folder_cursor = (self.folder_cursor + 1).min(count - 1)
                    }
                    Key::Enter | Key::Right | Key::Char('l') | Key::Tab => {
                        self.folder = match self.folder_cursor {
                            0 => None,
                            i => self.folders.get(i - 1).map(|f| f.id.clone()),
                        };
                        self.selected = 0;
                        self.focus = Focus::List;
                    }
                    Key::Esc => self.focus = Focus::List,
                    other => return self.common(other),
                }
                None
            }
            Focus::List => {
                let n = self.visible().len();
                match key {
                    Key::Up | Key::Char('k') => self.selected = self.selected.saturating_sub(1),
                    Key::Down | Key::Char('j') => {
                        self.selected = (self.selected + 1).min(n.saturating_sub(1))
                    }
                    Key::PageUp => self.selected = self.selected.saturating_sub(8),
                    Key::PageDown => self.selected = (self.selected + 8).min(n.saturating_sub(1)),
                    Key::Home | Key::Char('g') => self.selected = 0,
                    Key::End | Key::Char('G') => self.selected = n.saturating_sub(1),
                    Key::Left | Key::Char('h') | Key::BackTab => {
                        self.folder_cursor = match &self.folder {
                            None => 0,
                            Some(id) => self
                                .folders
                                .iter()
                                .position(|f| &f.id == id)
                                .map_or(0, |i| i + 1),
                        };
                        self.focus = Focus::Folders;
                    }
                    Key::Enter | Key::Right | Key::Char('l') => {
                        let recording = self.visible().get(self.selected).map(|r| r.id.clone())?;
                        let at = self
                            .hits_by_recording()
                            .get(recording.as_str())
                            .and_then(|h| h.first().map(|h| h.start));
                        return Some(ArchiveAction::Open { id: recording, at });
                    }
                    Key::Esc if !self.query.is_empty() => {
                        self.query.clear();
                        self.hits.clear();
                        self.searched.clear();
                    }
                    other => return self.common(other),
                }
                None
            }
        }
    }

    /// Keys that mean the same in the folders and the list.
    fn common(&mut self, key: Key) -> Option<ArchiveAction> {
        match key {
            Key::Char('/') => self.focus = Focus::Query,
            Key::Char('f') => {
                self.filter = match self.filter {
                    Filter::All => Filter::New,
                    Filter::New => Filter::Failed,
                    Filter::Failed => Filter::MissingLanguage,
                    Filter::MissingLanguage => Filter::All,
                };
                self.selected = 0;
            }
            Key::Char('o') => {
                self.sort = match self.sort {
                    Sort::Newest => Sort::Oldest,
                    Sort::Oldest => Sort::TitleUp,
                    Sort::TitleUp => Sort::TitleDown,
                    Sort::TitleDown => Sort::Newest,
                };
            }
            _ => {}
        }
        None
    }

    fn typed(&mut self) {
        self.typed_at = Some(Instant::now());
        self.selected = 0;
    }

    /// Whether the search is waiting for the typing to pause, so the screen
    /// knows to come back.
    pub fn pending(&self) -> bool {
        self.typed_at.is_some()
    }

    /// The archive's size, for the header.
    pub fn totals(&self, ctx: &Ctx) -> String {
        let w = ctx.words();
        let seconds: f64 = self.recordings.iter().map(|r| r.duration).sum();
        format!(
            "{} · {} {}",
            count(ctx.theme.lang, self.recordings.len() as i64, w.recordings),
            words::span(seconds),
            w.of_sound
        )
    }

    pub fn draw(
        &self,
        frame: &mut Frame,
        area: Rect,
        ctx: &Ctx,
        badge: Option<&RunBadge>,
        elsewhere: &HashSet<String>,
        tick: usize,
    ) {
        let wide = area.width >= 90;
        if wide {
            let side = Rect { width: 24, ..area };
            self.draw_folders(frame, side, ctx);
            let rule: Vec<Line> = (0..area.height)
                .map(|_| ui::plain(ctx.theme.glyphs().rule, ctx.theme.rule()))
                .collect();
            frame.render_widget(
                Paragraph::new(rule),
                Rect {
                    x: area.x + 24,
                    width: 1,
                    ..area
                },
            );
            let list = ui::inset(area, 26, 1);
            self.draw_list(frame, list, ctx, badge, elsewhere, tick);
        } else if self.focus == Focus::Folders {
            self.draw_folders(frame, area, ctx);
        } else {
            self.draw_list(frame, ui::inset(area, 1, 1), ctx, badge, elsewhere, tick);
        }
    }

    fn draw_folders(&self, frame: &mut Frame, area: Rect, ctx: &Ctx) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let width = area.width as usize;
        let mut lines = vec![
            Line::raw(""),
            ui::plain(format!("  {}", w.folders), theme.bold()),
        ];
        let mut entries: Vec<(Option<String>, String, i64)> = vec![(
            None,
            w.all_recordings.to_string(),
            self.recordings.len() as i64,
        )];
        for folder in &self.folders {
            entries.push((
                Some(folder.id.clone()),
                folder.name.clone(),
                folder.recording_count,
            ));
        }
        for (i, (id, name, n)) in entries.iter().enumerate() {
            let open = *id == self.folder;
            let cursor = self.focus == Focus::Folders && i == self.folder_cursor;
            let number = n.to_string();
            let name = cut(name, width.saturating_sub(number.len() + 5), g.ellipsis);
            let gap = width.saturating_sub(3 + ui::cells(&name) + number.len() + 1);
            let mut spans = vec![
                Span::styled(
                    if open {
                        format!(" {}", g.bar)
                    } else {
                        "  ".into()
                    },
                    theme.accent(),
                ),
                Span::raw(" "),
                Span::styled(
                    name,
                    if open {
                        theme.accent().add_modifier(ratatui::style::Modifier::BOLD)
                    } else {
                        theme.text()
                    },
                ),
                Span::raw(" ".repeat(gap)),
                Span::styled(number, if open { theme.accent() } else { theme.muted() }),
            ];
            if cursor {
                spans = spans
                    .into_iter()
                    .map(|s| s.patch_style(theme.selected()))
                    .collect();
            }
            lines.push(Line::from(spans));
        }
        lines.push(Line::raw(""));
        lines.push(Line::from(vec![
            Span::styled(format!("  {}", w.show), theme.bold()),
            Span::styled("  f", theme.faint()),
        ]));
        for (filter, label) in [
            (Filter::All, w.filter_all),
            (Filter::New, w.filter_new),
            (Filter::Failed, w.filter_failed),
            (Filter::MissingLanguage, w.filter_missing),
        ] {
            let on = self.filter == filter;
            lines.push(Line::from(vec![
                Span::styled(
                    format!("   {} ", if on { g.radio_on } else { g.radio_off }),
                    if on { theme.accent() } else { theme.faint() },
                ),
                Span::styled(
                    label.to_string(),
                    if on { theme.bold() } else { theme.muted() },
                ),
            ]));
        }
        lines.push(Line::raw(""));
        lines.push(Line::from(vec![
            Span::styled(format!("  {}", w.sort), theme.bold()),
            Span::styled("  o", theme.faint()),
        ]));
        let sort = match self.sort {
            Sort::Newest => w.sort_newest,
            Sort::Oldest => w.sort_oldest,
            Sort::TitleUp => w.sort_az,
            Sort::TitleDown => w.sort_za,
        };
        lines.push(Line::from(vec![
            Span::styled(format!("   {sort} "), theme.text()),
            Span::styled(g.dropdown, theme.faint()),
        ]));
        frame.render_widget(Paragraph::new(lines), area);
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_list(
        &self,
        frame: &mut Frame,
        area: Rect,
        ctx: &Ctx,
        badge: Option<&RunBadge>,
        elsewhere: &HashSet<String>,
        tick: usize,
    ) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let lang = theme.lang;
        let width = area.width as usize;
        let visible = self.visible();
        let hits = self.hits_by_recording();

        // The search field.
        let focused = self.focus == Focus::Query;
        let field_style = if focused {
            theme.selected()
        } else {
            theme.field()
        };
        let mut field = vec![Span::styled(
            " / ",
            if focused {
                theme.accent()
            } else {
                theme.faint()
            },
        )];
        if self.query.is_empty() && !focused {
            field.push(Span::styled(
                w.search_placeholder,
                theme.faint().add_modifier(ratatui::style::Modifier::ITALIC),
            ));
        } else {
            field.push(Span::styled(self.query.clone(), theme.text()));
            if focused {
                field.push(Span::styled(g.cursor, theme.accent()));
            }
        }
        if !self.query.is_empty() {
            let note = format!(
                "{} · {} ",
                count(lang, visible.len() as i64, w.recordings),
                w.esc_clears
            );
            let used = ui::line_cells(&field);
            field.push(Span::raw(
                " ".repeat(width.saturating_sub(used + ui::cells(&note))),
            ));
            field.push(Span::styled(note, theme.muted()));
        }
        let used = ui::line_cells(&field);
        field.push(Span::raw(" ".repeat(width.saturating_sub(used))));
        frame.render_widget(
            Paragraph::new(Line::from(field)).style(field_style),
            ui::rows(area, 1, 1),
        );

        // Column heads.
        let right = 22;
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(
                    pad(&format!("  {}", w.col_title), width.saturating_sub(right)),
                    theme.muted().add_modifier(ratatui::style::Modifier::BOLD),
                ),
                Span::styled(
                    format!("{:>8}  {:>10}", w.col_length, w.col_added),
                    theme.muted().add_modifier(ratatui::style::Modifier::BOLD),
                ),
            ])),
            ui::rows(area, 3, 1),
        );

        let list = ui::rows(area, 4, area.height.saturating_sub(4));
        if visible.is_empty() {
            let text = if self.recordings.is_empty() {
                w.archive_empty
            } else {
                w.nothing_matches
            };
            frame.render_widget(
                Paragraph::new(ui::plain(format!("  {text}"), theme.muted())),
                list,
            );
            return;
        }
        let per_screen = (list.height as usize / 3).max(1);
        let mut top = self.top.get();
        if self.selected < top {
            top = self.selected;
        }
        if self.selected >= top + per_screen {
            top = self.selected + 1 - per_screen;
        }
        self.top.set(top);

        let mut lines = Vec::new();
        for (i, recording) in visible.iter().enumerate().skip(top).take(per_screen) {
            let chosen = i == self.selected && self.focus == Focus::List;
            let title = cut(
                &title_of(recording),
                width.saturating_sub(right + 3),
                g.ellipsis,
            );
            let first = vec![
                Span::styled(if chosen { g.bar } else { " " }, theme.accent()),
                Span::raw(" "),
                Span::styled(pad(&title, width.saturating_sub(right + 2)), theme.bold()),
                Span::styled(
                    format!(
                        "{:>8}  {:>10}",
                        crate::common::clock(recording.duration),
                        words::when(lang, &recording.created_at)
                    ),
                    theme.muted(),
                ),
            ];
            let mut second = vec![
                Span::styled(if chosen { g.bar } else { " " }, theme.accent()),
                Span::raw(" "),
            ];
            second.extend(self.meta(
                recording,
                ctx,
                badge,
                elsewhere,
                hits.get(recording.id.as_str()),
                width.saturating_sub(2),
                tick,
            ));
            let fill = |mut spans: Vec<Span<'static>>| {
                let used = ui::line_cells(&spans);
                spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
                if chosen {
                    spans = spans
                        .into_iter()
                        .map(|s| s.patch_style(theme.selected()))
                        .collect();
                }
                Line::from(spans)
            };
            lines.push(fill(first));
            lines.push(fill(second));
            lines.push(Line::raw(""));
        }
        frame.render_widget(Paragraph::new(lines), list);
    }

    /// The second line of a card: what is in the recording, or what is
    /// happening to it.
    #[allow(clippy::too_many_arguments)]
    fn meta(
        &self,
        r: &Recording,
        ctx: &Ctx,
        badge: Option<&RunBadge>,
        elsewhere: &HashSet<String>,
        hits: Option<&Vec<&SearchResult>>,
        width: usize,
        tick: usize,
    ) -> Vec<Span<'static>> {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let lang = theme.lang;
        if let Some(hits) = hits.filter(|h| !h.is_empty()) {
            let hit = hits[0];
            let more = if hits.len() > 1 {
                format!("  +{}", hits.len() - 1)
            } else {
                String::new()
            };
            let time = format!("{}  ", crate::common::clock(hit.start));
            let room = width.saturating_sub(ui::cells(&time) + ui::cells(&more));
            let mut spans = vec![Span::styled(time, theme.muted())];
            spans.extend(snippet(&hit.text, room, ctx));
            spans.push(Span::styled(more, theme.faint()));
            return spans;
        }
        let mill = g.mill[tick % g.mill.len()].to_string();
        match r.status.as_str() {
            db::status::TRANSCRIBING => {
                if let Some(badge) = badge.filter(|b| b.id == r.id) {
                    let mut spans = vec![
                        Span::styled(mill, theme.accent()),
                        Span::styled(
                            format!(" {} · {} %  ", w.transcribing, badge.percent),
                            theme.accent(),
                        ),
                    ];
                    spans.extend(ui::bar(theme, badge.percent as f64 / 100.0, 24));
                    if let Some(left) = &badge.left {
                        spans.push(Span::styled(format!("  {left}"), theme.muted()));
                    }
                    spans
                } else {
                    let said = if elsewhere.contains(&r.id) {
                        w.in_terminal
                    } else {
                        w.in_window
                    };
                    vec![
                        Span::styled(mill, theme.accent()),
                        Span::styled(format!(" {said}"), theme.accent()),
                    ]
                }
            }
            db::status::FAILED => {
                let reason = r
                    .error
                    .as_deref()
                    .map(|e| crate::app::stored_message(lang, e))
                    .unwrap_or_default();
                let text = if reason.is_empty() {
                    w.failed.to_string()
                } else {
                    format!("{}: {reason}", w.failed)
                };
                vec![Span::styled(
                    cut(&format!("{} {text}", g.failed), width, g.ellipsis),
                    theme.danger(),
                )]
            }
            db::status::NEW => vec![Span::styled(
                format!("{} {}", g.new, w.not_transcribed),
                theme.muted(),
            )],
            _ => {
                let mut parts = Vec::new();
                if !r.language.is_empty() {
                    let mut language = words::language_name(lang, &r.language);
                    if let Some(second) = &r.second_language {
                        language = format!("{language}, {}", words::language_name(lang, second));
                    }
                    parts.push(language);
                }
                let speakers = self.speakers.get(&r.id).copied().unwrap_or(0);
                if speakers > 0 {
                    parts.push(count(lang, speakers as i64, w.speakers));
                }
                parts.push(count(lang, r.segment_count, w.blocks));
                let mut spans = vec![Span::styled(
                    cut(&parts.join(" · "), width, g.ellipsis),
                    theme.muted(),
                )];
                if let Some(missing) = &r.second_language_missing {
                    spans.push(Span::styled(
                        format!("  {} {}", g.warning, words::missing_language(lang, missing)),
                        theme.warning(),
                    ));
                }
                spans
            }
        }
    }
}

/// A search snippet with its `<<match>>` marks as highlights, cut to `room`.
fn snippet(text: &str, room: usize, ctx: &Ctx) -> Vec<Span<'static>> {
    let theme = &ctx.theme;
    let mut spans = Vec::new();
    let mut used = 0;
    let mut rest = text.trim();
    let mut inside = false;
    while !rest.is_empty() && used < room {
        let marker = if inside { ">>" } else { "<<" };
        let (piece, next) = match rest.find(marker) {
            Some(i) => (&rest[..i], &rest[i + 2..]),
            None => (rest, ""),
        };
        let piece = cut(piece, room - used, theme.glyphs().ellipsis);
        used += ui::cells(&piece);
        spans.push(Span::styled(
            piece,
            if inside { theme.hit() } else { theme.muted() },
        ));
        rest = next;
        inside = !inside;
    }
    spans
}
