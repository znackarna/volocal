//! *Uložit jako*: the window's export as a dialog — several formats at once,
//! a folder, and never a file replaced without a question.

use crate::app::{Ctx, Key, Msg};
use crate::ui::{self, cut};
use crate::words;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use volocal_lib::db::{self, Recording};
use volocal_lib::export;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
    Txt,
    Md,
    Srt,
    Vtt,
    Json,
    Audio,
}

const FORMATS: [Format; 6] = [
    Format::Txt,
    Format::Md,
    Format::Srt,
    Format::Vtt,
    Format::Json,
    Format::Audio,
];
const AUDIO: [&str; 3] = ["mp3", "m4a", "wav"];

pub struct Export {
    pub recording: Recording,
    has_transcript: bool,
    chosen: [bool; 6],
    audio: usize,
    cursor: usize,
    pub folder: String,
    /// Files that exist already, waiting for the reader's answer.
    pub clashes: Vec<PathBuf>,
}

pub enum ExportAction {
    Cancel,
    /// Written, or being written; the paths for the notice.
    Saved(Vec<PathBuf>),
    /// Some of them already exist; the screen asks.
    Clash,
    Failed(String),
}

/// What an audio export says when ffmpeg is done with it.
pub enum ExportMsg {
    Done(PathBuf),
    Failed(String),
}

impl Export {
    pub fn new(connection: &rusqlite::Connection, recording: Recording) -> Export {
        let has_transcript = recording.segment_count > 0
            || db::segments(connection, &recording.id).is_ok_and(|s| !s.is_empty());
        let mut chosen = [false; 6];
        chosen[if has_transcript { 0 } else { 5 }] = true;
        Export {
            recording,
            has_transcript,
            chosen,
            audio: 0,
            cursor: if has_transcript { 0 } else { 5 },
            folder: std::env::current_dir()
                .map(|d| d.display().to_string())
                .unwrap_or_else(|_| ".".into()),
            clashes: Vec::new(),
        }
    }

    pub fn typing(&self) -> bool {
        self.cursor == FORMATS.len()
    }

    fn usable(&self, i: usize) -> bool {
        FORMATS[i] == Format::Audio || self.has_transcript
    }

    pub fn key(&mut self, key: Key, ctx: &Ctx, tx: &Sender<Msg>) -> Option<ExportAction> {
        match key {
            Key::Esc => return Some(ExportAction::Cancel),
            Key::Up | Key::BackTab => self.cursor = self.cursor.saturating_sub(1),
            Key::Down => self.cursor = (self.cursor + 1).min(FORMATS.len()),
            Key::Char(' ') if self.cursor < FORMATS.len() => {
                if self.usable(self.cursor) {
                    self.chosen[self.cursor] = !self.chosen[self.cursor];
                }
            }
            Key::Left if self.cursor == 5 => {
                self.audio = (self.audio + AUDIO.len() - 1) % AUDIO.len()
            }
            Key::Right if self.cursor == 5 => self.audio = (self.audio + 1) % AUDIO.len(),
            Key::Tab if self.cursor == FORMATS.len() => self.folder = complete_folder(&self.folder),
            Key::Char(c) if self.cursor == FORMATS.len() => self.folder.push(c),
            Key::Backspace if self.cursor == FORMATS.len() => {
                self.folder.pop();
            }
            Key::Enter => {
                self.clashes = self
                    .targets()
                    .into_iter()
                    .map(|(_, p)| p)
                    .filter(|p| p.exists())
                    .collect();
                if !self.clashes.is_empty() {
                    return Some(ExportAction::Clash);
                }
                return Some(self.write(ctx, tx, false));
            }
            _ => {}
        }
        None
    }

    fn extension(&self, format: Format) -> &'static str {
        match format {
            Format::Txt => "txt",
            Format::Md => "md",
            Format::Srt => "srt",
            Format::Vtt => "vtt",
            Format::Json => "json",
            Format::Audio => AUDIO[self.audio],
        }
    }

    /// Each chosen format with the file it goes to: the recording's title in
    /// the folder, with the characters Windows refuses replaced.
    fn targets(&self) -> Vec<(Format, PathBuf)> {
        let title: String = crate::archive::title_of(&self.recording)
            .chars()
            .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
            .collect();
        let title = if title.trim().is_empty() {
            "recording".to_string()
        } else {
            title
        };
        FORMATS
            .iter()
            .enumerate()
            .filter(|(i, _)| self.chosen[*i] && self.usable(*i))
            .map(|(_, f)| {
                (
                    *f,
                    Path::new(self.folder.trim()).join(format!("{title}.{}", self.extension(*f))),
                )
            })
            .collect()
    }

    /// Writes what was chosen. `beside` saves a file that exists under a new
    /// name, `Porada (2).srt`, rather than replacing it.
    pub fn write(&mut self, ctx: &Ctx, tx: &Sender<Msg>, beside: bool) -> ExportAction {
        let targets = self.targets();
        if targets.is_empty() {
            return ExportAction::Cancel;
        }
        let segments = db::segments(&ctx.db, &self.recording.id).unwrap_or_default();
        let speakers = db::speakers(&ctx.db, &self.recording.id).unwrap_or_default();
        let mut saved = Vec::new();
        for (format, target) in targets {
            let target = if beside { free_name(&target) } else { target };
            let text = match format {
                Format::Txt => export::txt(&segments, &speakers),
                Format::Md => export::markdown(&self.recording, &segments, &speakers),
                Format::Srt => export::srt(&segments),
                Format::Vtt => export::vtt(&segments),
                Format::Json => export::json(&self.recording, &segments, &speakers),
                Format::Audio => {
                    // ffmpeg can take a while; the screen hears when it is done.
                    let (settings, source, tx, destination) = (
                        ctx.settings.clone(),
                        PathBuf::from(&self.recording.path),
                        tx.clone(),
                        target.clone(),
                    );
                    let lang = ctx.theme.lang;
                    std::thread::spawn(move || {
                        let done = export::audio(&settings, &source, &destination);
                        let _ = tx.send(Msg::Export(match done {
                            Ok(_) => ExportMsg::Done(destination),
                            Err(message) => {
                                ExportMsg::Failed(crate::common::describe_in(lang, &message))
                            }
                        }));
                    });
                    saved.push(target);
                    continue;
                }
            };
            if let Err(e) = std::fs::write(&target, text) {
                return ExportAction::Failed(format!("{}: {e}", target.display()));
            }
            saved.push(target);
        }
        ExportAction::Saved(saved)
    }

    pub fn draw(&self, frame: &mut Frame, area: Rect, ctx: &Ctx) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let inner = ui::dialog(frame, area, theme, 64, 19);
        let width = inner.width as usize;
        let mut lines = vec![
            ui::plain(w.save_how, theme.bold()),
            ui::plain(w.save_several, theme.muted()),
            Line::raw(""),
        ];
        let names = [
            (w.format_txt, w.format_txt_note),
            (w.format_md, w.format_md_note),
            (w.format_srt, w.format_srt_note),
            (w.format_vtt, w.format_vtt_note),
            (w.format_json, w.format_json_note),
            (w.format_audio, w.format_audio_note),
        ];
        for (i, (name, note)) in names.iter().enumerate() {
            let usable = self.usable(i);
            let on = self.chosen[i] && usable;
            let focused = self.cursor == i;
            let mut spans = vec![
                Span::styled(if focused { g.bar } else { " " }, theme.accent()),
                Span::raw(" "),
                Span::styled(
                    format!("{} ", if on { g.checked } else { g.unchecked }),
                    if on { theme.accent() } else { theme.faint() },
                ),
                Span::styled(
                    ui::pad(name, 14),
                    if !usable {
                        theme.faint()
                    } else if on {
                        theme.bold()
                    } else {
                        theme.text()
                    },
                ),
                Span::styled(
                    note.to_string(),
                    if usable { theme.muted() } else { theme.faint() },
                ),
            ];
            if FORMATS[i] == Format::Audio {
                let stepper = format!(
                    "{} {} {}",
                    g.left,
                    AUDIO[self.audio].to_uppercase(),
                    g.right
                );
                let used = ui::line_cells(&spans);
                spans.push(Span::raw(
                    " ".repeat(width.saturating_sub(used + ui::cells(&stepper))),
                ));
                spans.push(Span::styled(
                    stepper,
                    if focused { theme.text() } else { theme.faint() },
                ));
            }
            let used = ui::line_cells(&spans);
            spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
            if focused {
                spans = spans
                    .into_iter()
                    .map(|s| s.patch_style(theme.selected()))
                    .collect();
            }
            lines.push(Line::from(spans));
        }
        if !self.has_transcript {
            lines.push(ui::plain(w.only_audio, theme.muted()));
        } else {
            lines.push(Line::raw(""));
        }
        lines.push(ui::plain(w.save_to, theme.bold()));
        let focused = self.typing();
        let mut field = vec![
            Span::raw(" "),
            Span::styled(
                cut(&self.folder, width.saturating_sub(16), g.ellipsis),
                theme.text(),
            ),
        ];
        if focused {
            field.push(Span::styled(g.cursor, theme.accent()));
        }
        let tab = format!("Tab {}", w.complete);
        let used = ui::line_cells(&field);
        field.push(Span::raw(
            " ".repeat(width.saturating_sub(used + ui::cells(&tab) + 1)),
        ));
        field.push(Span::styled(tab, theme.faint()));
        field.push(Span::raw(" "));
        let style = if focused {
            theme.selected()
        } else {
            theme.field()
        };
        lines.push(Line::from(
            field
                .into_iter()
                .map(|s| s.patch_style(style))
                .collect::<Vec<_>>(),
        ));
        lines.push(ui::plain(w.files_named, theme.muted()));
        lines.push(Line::raw(""));
        let n = self.targets().len() as i64;
        let cancel = format!("  Esc {}  ", w.cancel);
        let save = format!("  {} {}  ", g.enter, words::save_files(ctx.theme.lang, n));
        lines.push(Line::from(vec![
            Span::raw(" ".repeat(width.saturating_sub(ui::cells(&cancel) + ui::cells(&save) + 2))),
            Span::styled(cancel, theme.key()),
            Span::raw("  "),
            Span::styled(save, theme.primary()),
        ]));
        frame.render_widget(Paragraph::new(lines), inner);
    }
}

/// `Porada.srt` → `Porada (2).srt`, or the first number that is free.
fn free_name(target: &Path) -> PathBuf {
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = target
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let folder = target.parent().unwrap_or(Path::new("."));
    (2..)
        .map(|n| folder.join(format!("{stem} ({n}).{extension}")))
        .find(|p| !p.exists())
        .unwrap_or_else(|| target.to_path_buf())
}

fn complete_folder(folder: &str) -> String {
    let path = Path::new(folder);
    let (parent, prefix) = if folder.ends_with(['\\', '/']) {
        (path.to_path_buf(), String::new())
    } else {
        (
            path.parent().map(Path::to_path_buf).unwrap_or_default(),
            path.file_name()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default(),
        )
    };
    let Ok(entries) = std::fs::read_dir(if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        &parent
    }) else {
        return folder.to_string();
    };
    let dirs: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.to_lowercase().starts_with(&prefix))
        .collect();
    match dirs.as_slice() {
        [one] => parent.join(one).display().to_string(),
        _ => folder.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_that_exists_is_saved_beside_it() {
        let folder =
            std::env::temp_dir().join(format!("volocal-tui-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let first = folder.join("Porada.srt");
        std::fs::write(&first, "").unwrap();
        assert_eq!(free_name(&first), folder.join("Porada (2).srt"));
        std::fs::write(folder.join("Porada (2).srt"), "").unwrap();
        assert_eq!(free_name(&first), folder.join("Porada (3).srt"));
        let _ = std::fs::remove_dir_all(&folder);
    }
}
