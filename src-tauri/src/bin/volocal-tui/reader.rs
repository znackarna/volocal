//! One transcript, to read: the blocks with their times and speakers, a
//! block cursor, a search inside, and a jump to a time. Nothing in it can be
//! changed; hand editing belongs to the window.

use crate::app::{Ctx, Key};
use crate::common::clock;
use crate::ui::{self, cut, FooterKeys};
use crate::words::{self, count};
use ratatui::layout::Rect;
use ratatui::style::Modifier;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use std::cell::Cell;
use std::collections::HashMap;
use volocal_lib::db::{self, Recording, Segment};

pub enum ReaderAction {
    Back,
}

/// What the line at the foot is for, when it is not the keys.
#[derive(PartialEq, Eq)]
enum Input {
    None,
    Search,
    Time,
}

pub struct Reader {
    pub recording: Recording,
    segments: Vec<Segment>,
    /// Speaker key → name and stored colour, and the order they first speak.
    speakers: HashMap<String, (String, String)>,
    order: Vec<String>,
    cursor: usize,
    top: Cell<usize>,
    page: Cell<usize>,
    input: Input,
    pub query: String,
    time: String,
    /// Every hit: the block and which occurrence in it.
    matches: Vec<(usize, usize)>,
    current: usize,
    pub info: bool,
    /// The block whose sound is playing or paused, if any.
    sounding: Option<usize>,
}

impl Reader {
    pub fn open(connection: &rusqlite::Connection, id: &str, at: Option<f64>) -> Option<Reader> {
        let recording = db::recording(connection, id).ok()?;
        let segments = db::segments(connection, id).unwrap_or_default();
        let mut speakers = HashMap::new();
        let mut order = Vec::new();
        for speaker in db::speakers(connection, id).unwrap_or_default() {
            speakers.insert(speaker.key.clone(), (speaker.name, speaker.color));
        }
        for segment in &segments {
            if let Some(key) = speaker_key(segment) {
                if speakers.contains_key(key) && !order.iter().any(|k: &String| k == key) {
                    order.push(key.to_string());
                }
            }
        }
        let mut reader = Reader {
            recording,
            segments,
            speakers,
            order,
            cursor: 0,
            top: Cell::new(0),
            page: Cell::new(10),
            input: Input::None,
            query: String::new(),
            time: String::new(),
            matches: Vec::new(),
            current: 0,
            info: false,
            sounding: None,
        };
        if let Some(at) = at {
            reader.go_to(at);
        }
        Some(reader)
    }

    /// Opens on a hit from the archive's search, with the same word found.
    pub fn with_query(mut self, query: &str) -> Reader {
        self.query = query.trim().to_string();
        self.find();
        if let Some(i) = self
            .matches
            .iter()
            .position(|(block, _)| *block >= self.cursor)
        {
            self.current = i;
        }
        self
    }

    fn go_to(&mut self, seconds: f64) {
        self.cursor = self
            .segments
            .iter()
            .rposition(|s| s.start <= seconds + 0.01)
            .unwrap_or(0);
    }

    /// Where the block under the cursor starts and where the next one does:
    /// what the space bar plays from, and the stretch a pause belongs to.
    pub fn cursor_block(&self) -> Option<(f64, f64)> {
        let block = self.segments.get(self.cursor)?;
        let end = self
            .segments
            .get(self.cursor + 1)
            .map(|next| next.start)
            .unwrap_or_else(|| block.end.max(self.recording.duration));
        Some((block.start, end.max(block.start)))
    }

    /// Where the sound is now, or `None` when nothing plays. When it reaches
    /// another block the cursor goes with it, so that block stays on screen;
    /// a cursor moved by hand stays where it was put until then.
    pub fn sound_at(&mut self, at: Option<f64>) {
        let block = at.and_then(|seconds| {
            self.segments
                .iter()
                .rposition(|s| s.start <= seconds + 0.01)
                .or((!self.segments.is_empty()).then_some(0))
        });
        if block.is_some() && block != self.sounding {
            self.cursor = block.unwrap_or(self.cursor);
        }
        self.sounding = block;
    }

    fn find(&mut self) {
        self.matches = self
            .segments
            .iter()
            .enumerate()
            .flat_map(|(i, s)| (0..ui::occurrences(&s.text, &self.query)).map(move |n| (i, n)))
            .collect();
        self.current = 0;
    }

    /// Whether a key typed now is text for a field.
    pub fn typing(&self) -> bool {
        self.input != Input::None
    }

    pub fn key(&mut self, key: Key) -> Option<ReaderAction> {
        let last = self.segments.len().saturating_sub(1);
        match self.input {
            Input::Search => {
                match key {
                    Key::Char(c) => {
                        self.query.push(c);
                        self.find();
                    }
                    Key::Backspace => {
                        self.query.pop();
                        self.find();
                    }
                    Key::Enter => {
                        self.input = Input::None;
                        self.jump(0);
                    }
                    Key::Esc => {
                        self.input = Input::None;
                        self.query.clear();
                        self.matches.clear();
                    }
                    _ => {}
                }
                return None;
            }
            Input::Time => {
                match key {
                    Key::Char(c) if c.is_ascii_digit() || c == ':' => self.time.push(c),
                    Key::Backspace => {
                        self.time.pop();
                    }
                    Key::Enter => {
                        if let Some(seconds) = parse_time(&self.time) {
                            self.go_to(seconds);
                        }
                        self.input = Input::None;
                    }
                    Key::Esc => self.input = Input::None,
                    _ => {}
                }
                return None;
            }
            Input::None => {}
        }
        if self.info {
            if matches!(key, Key::Esc | Key::Char('i') | Key::Char('q') | Key::Enter) {
                self.info = false;
            }
            return None;
        }
        match key {
            Key::Up | Key::Char('k') => self.cursor = self.cursor.saturating_sub(1),
            Key::Down | Key::Char('j') => self.cursor = (self.cursor + 1).min(last),
            Key::PageUp => self.cursor = self.cursor.saturating_sub(self.page.get()),
            Key::PageDown => self.cursor = (self.cursor + self.page.get()).min(last),
            Key::Home | Key::Char('g') => self.cursor = 0,
            Key::End | Key::Char('G') => self.cursor = last,
            Key::Char('m') => self.next_speaker(true),
            Key::Char('M') => self.next_speaker(false),
            Key::Char('/') => {
                self.input = Input::Search;
                self.query.clear();
                self.matches.clear();
            }
            Key::Char('n') => self.jump(1),
            Key::Char('N') => self.jump(-1),
            Key::Char('t') => {
                self.input = Input::Time;
                self.time.clear();
            }
            Key::Char('i') => self.info = true,
            Key::Esc if !self.query.is_empty() => {
                self.query.clear();
                self.matches.clear();
            }
            Key::Esc | Key::Char('q') | Key::Left | Key::Char('h') => {
                return Some(ReaderAction::Back)
            }
            _ => {}
        }
        None
    }

    /// To the next hit (`1`), the previous one (`-1`), or the first from the
    /// cursor on (`0`).
    fn jump(&mut self, step: i32) {
        if self.matches.is_empty() {
            return;
        }
        let n = self.matches.len();
        self.current = match step {
            0 => self
                .matches
                .iter()
                .position(|(block, _)| *block >= self.cursor)
                .unwrap_or(0),
            1 => (self.current + 1) % n,
            _ => (self.current + n - 1) % n,
        };
        self.cursor = self.matches[self.current].0;
    }

    fn next_speaker(&mut self, forward: bool) {
        let here = self
            .segments
            .get(self.cursor)
            .and_then(speaker_key)
            .map(str::to_string);
        let differs = |s: &Segment| speaker_key(s).map(str::to_string) != here;
        if forward {
            if let Some(i) = self.segments.iter().skip(self.cursor + 1).position(differs) {
                self.cursor += i + 1;
            }
        } else if let Some(i) = self.segments[..self.cursor].iter().rposition(differs) {
            // To the first block of that turn.
            let key = speaker_key(&self.segments[i]).map(str::to_string);
            let mut start = i;
            while start > 0 && speaker_key(&self.segments[start - 1]).map(str::to_string) == key {
                start -= 1;
            }
            self.cursor = start;
        }
    }

    pub fn draw(&self, frame: &mut Frame, area: Rect, ctx: &Ctx) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let lang = theme.lang;
        let width = area.width as usize;
        let r = &self.recording;

        let mut head = vec![
            Line::raw(""),
            Line::from(Span::styled(
                format!(
                    "    {}",
                    cut(
                        &crate::archive::title_of(r),
                        width.saturating_sub(6),
                        g.ellipsis
                    )
                ),
                theme.bold(),
            )),
        ];
        let mut meta = vec![words::when(lang, &r.created_at), clock(r.duration)];
        if !r.language.is_empty() {
            meta.push(words::language_name(lang, &r.language));
        }
        if !r.model.is_empty() {
            meta.push(r.model.clone());
        }
        meta.push(count(lang, r.segment_count, w.blocks));
        head.push(ui::plain(
            format!("    {}", meta.join(" · ")),
            theme.muted(),
        ));
        head.push(Line::raw(""));
        if !self.order.is_empty() {
            let mut legend = vec![Span::raw("    ")];
            for key in &self.order {
                let (name, colour) = &self.speakers[key];
                legend.push(Span::styled(format!("{} ", g.dot), theme.speaker(colour)));
                legend.push(Span::styled(format!("{name}   "), theme.text()));
            }
            head.push(Line::from(legend));
            head.push(Line::raw(""));
        }
        let head_height = head.len() as u16;
        frame.render_widget(Paragraph::new(head), ui::rows(area, 0, head_height));

        let input_rows = u16::from(self.input != Input::None || !self.query.is_empty());
        let body = ui::rows(
            area,
            head_height,
            area.height.saturating_sub(head_height + input_rows),
        );
        if self.segments.is_empty() {
            frame.render_widget(
                Paragraph::new(ui::plain(format!("    {}", w.no_transcript), theme.muted())),
                body,
            );
        } else {
            self.draw_blocks(frame, body, ctx);
        }

        if input_rows > 0 {
            let row = ui::rows(area, area.height.saturating_sub(1), 1);
            let mut spans = vec![Span::styled(" / ", theme.accent())];
            match self.input {
                Input::Time => {
                    spans = vec![
                        Span::styled(format!(" {} ", w.go_to_time), theme.accent()),
                        Span::styled(self.time.clone(), theme.text()),
                        Span::styled(g.cursor, theme.accent()),
                    ];
                }
                _ => {
                    spans.push(Span::styled(self.query.clone(), theme.text()));
                    if self.input == Input::Search {
                        spans.push(Span::styled(g.cursor, theme.accent()));
                    }
                    let note = if self.matches.is_empty() {
                        format!("{}   ", w.no_hits)
                    } else {
                        format!(
                            "{} {} {}  ·  n {}  ·  N {}  ·  Esc {}   ",
                            self.current + 1,
                            w.of,
                            self.matches.len(),
                            w.next,
                            w.previous,
                            w.close
                        )
                    };
                    let used = ui::line_cells(&spans);
                    spans.push(Span::raw(
                        " ".repeat(width.saturating_sub(used + ui::cells(&note))),
                    ));
                    spans.push(Span::styled(note, theme.muted()));
                }
            }
            let used = ui::line_cells(&spans);
            spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
            frame.render_widget(Paragraph::new(Line::from(spans)).style(theme.field()), row);
        }
    }

    fn draw_blocks(&self, frame: &mut Frame, area: Rect, ctx: &Ctx) {
        let theme = &ctx.theme;
        let g = theme.glyphs();
        let text_width = (area.width as usize).saturating_sub(17).clamp(20, 74);
        // Every block laid out, with the line where it starts.
        let mut lines: Vec<(usize, Line)> = Vec::new();
        let mut starts = Vec::with_capacity(self.segments.len());
        let mut previous: Option<&str> = None;
        let current = self.matches.get(self.current).copied();
        for (i, segment) in self.segments.iter().enumerate() {
            starts.push(lines.len());
            let chosen = i == self.cursor;
            let sounding = self.sounding == Some(i);
            // The block that sounds has the play mark on its first line and
            // the bar on the rest, whether or not the cursor is on it.
            let bar = |first: bool| {
                Span::styled(
                    if sounding && first {
                        format!("  {}", g.playing)
                    } else if chosen || sounding {
                        format!("  {}", g.bar)
                    } else {
                        "   ".into()
                    },
                    theme.accent(),
                )
            };
            let key = speaker_key(segment);
            let time_style = if chosen || sounding {
                theme.accent().add_modifier(Modifier::BOLD)
            } else {
                theme.muted()
            };
            let mut first = vec![
                bar(true),
                Span::styled(format!("{:>8}  ", clock(segment.start)), time_style),
            ];
            let changed = key != previous;
            if changed {
                if let Some((name, colour)) = key.and_then(|k| self.speakers.get(k)) {
                    first.push(Span::styled(name.clone(), theme.speaker(colour)));
                    if let Some(language) = &segment.language {
                        first.push(Span::styled(
                            format!("  {}", language.to_uppercase()),
                            theme.faint(),
                        ));
                    }
                    lines.push((i, Line::from(first)));
                    first = vec![bar(false), Span::raw(" ".repeat(10))];
                }
            }
            previous = key;
            let hit = current.filter(|(block, _)| *block == i).map(|(_, nth)| nth);
            let wrapped = ui::wrap(segment.text.trim(), text_width);
            let mut seen = 0;
            for (n, piece) in wrapped.iter().enumerate() {
                let mut spans = if n == 0 {
                    first.clone()
                } else {
                    vec![bar(false), Span::raw(" ".repeat(10))]
                };
                // Which occurrence of the hit falls on this piece, counted
                // through the block.
                let here = ui::occurrences(piece, &self.query);
                let current_here =
                    hit.and_then(|nth| (nth >= seen && nth < seen + here).then(|| nth - seen));
                seen += here;
                let style = if segment.confidence.is_some_and(|c| c < 0.5) {
                    theme.muted()
                } else {
                    theme.text()
                };
                spans.extend(ui::highlighted(
                    piece,
                    &self.query,
                    style,
                    theme.hit(),
                    current_here.map(|nth| (nth, theme.current_hit())),
                ));
                lines.push((i, Line::from(spans)));
            }
            lines.push((i, Line::raw("")));
            if i + 1 < self.segments.len() && speaker_key(&self.segments[i + 1]) == key {
                // One speaker's blocks read as one passage: no blank between.
                lines.pop();
            }
        }
        let height = area.height as usize;
        self.page.set((height / 3).max(1));
        let begin = starts[self.cursor];
        let end = starts.get(self.cursor + 1).copied().unwrap_or(lines.len());
        let mut top = self.top.get();
        if begin < top {
            top = begin.saturating_sub(1);
        }
        if end > top + height {
            top = end.saturating_sub(height).min(begin);
        }
        self.top.set(top);
        let shown: Vec<Line> = lines
            .into_iter()
            .skip(top)
            .take(height)
            .map(|(_, l)| l)
            .collect();
        frame.render_widget(Paragraph::new(shown), area);
    }

    /// The fields `volocal-cli show` prints, over the transcript.
    pub fn draw_info(&self, frame: &mut Frame, area: Rect, ctx: &Ctx) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let lang = theme.lang;
        let r = &self.recording;
        let inner = ui::dialog(frame, area, theme, 64, 18);
        let mut rows: Vec<(&str, String)> = vec![
            (w.info_title, crate::archive::title_of(r)),
            (w.info_file, r.path.clone()),
            (w.info_added, words::when(lang, &r.created_at)),
            (w.info_length, clock(r.duration)),
            ("id", r.id.clone()),
        ];
        if !r.language.is_empty() {
            rows.push((w.info_language, words::language_name(lang, &r.language)));
        }
        if !r.model.is_empty() {
            rows.push((w.info_model, r.model.clone()));
        }
        rows.push((w.info_blocks, r.segment_count.to_string()));
        if let Some(url) = &r.source_url {
            rows.push((w.info_source, url.clone()));
        }
        let exists = std::path::Path::new(&r.path).is_file();
        let mut lines = vec![ui::plain(w.info_heading, theme.bold()), Line::raw("")];
        let room = (inner.width as usize).saturating_sub(12);
        for (label, value) in rows {
            lines.push(Line::from(vec![
                Span::styled(ui::pad(label, 12), theme.muted()),
                Span::styled(cut(&value, room, theme.glyphs().ellipsis), theme.text()),
            ]));
        }
        if !exists {
            lines.push(Line::raw(""));
            lines.push(ui::plain(w.source_missing, theme.warning()));
        }
        frame.render_widget(Paragraph::new(lines), inner);
    }

    /// The keys at the foot. `sound` is whether the sound plays, when
    /// playback is offered at all; without it its keys are not shown.
    pub fn footer(&self, ctx: &Ctx, sound: Option<bool>) -> FooterKeys {
        let w = ctx.words();
        let g = ctx.theme.glyphs();
        let mut keys = vec![(g.updown, w.key_block)];
        if let Some(playing) = sound {
            keys.push((w.key_space, if playing { w.key_pause } else { w.key_play }));
            keys.push((", .", w.key_skip));
        }
        keys.extend([
            ("/", w.key_search),
            ("m", w.key_speaker),
            ("t", w.key_time),
            ("e", w.key_save_as),
        ]);
        (keys, vec![("?", w.key_help), ("q", w.key_back)])
    }
}

fn speaker_key(segment: &Segment) -> Option<&str> {
    segment
        .speakers
        .as_deref()
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// `39:07`, `1:02:15` or `39` (minutes) as seconds.
pub fn parse_time(text: &str) -> Option<f64> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    let numbers: Option<Vec<f64>> = parts.iter().map(|p| p.parse::<f64>().ok()).collect();
    let numbers = numbers?;
    Some(match numbers.as_slice() {
        [m] => m * 60.0,
        [m, s] => m * 60.0 + s,
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_time_is_read_as_the_window_writes_it() {
        assert_eq!(parse_time("39:07"), Some(2347.0));
        assert_eq!(parse_time("1:02:15"), Some(3735.0));
        assert_eq!(parse_time("39"), Some(2340.0));
        assert_eq!(parse_time("x"), None);
    }
}
