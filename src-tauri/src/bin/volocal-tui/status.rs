//! What transcription needs, and whether it is there. The screen says what
//! is missing and where to get it; fixing it is the window's.

use crate::app::Ctx;
use crate::common::describe_in;
use crate::marks::FACE;
use crate::ui::{self, cut};
use crate::words::{self, count};
use ratatui::layout::Rect;
use ratatui::style::Modifier;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use volocal_lib::tools::{self, ToolCheck};

pub struct Status {
    pub check: ToolCheck,
}

impl Status {
    pub fn new(ctx: &Ctx) -> Status {
        Status {
            check: tools::check(&ctx.settings),
        }
    }

    pub fn ready(&self) -> bool {
        self.check.issues.is_empty()
    }

    pub fn draw(&self, frame: &mut Frame, area: Rect, ctx: &Ctx, recordings: usize, seconds: f64) {
        let theme = &ctx.theme;
        let w = ctx.words();
        let g = theme.glyphs();
        let lang = theme.lang;
        let check = &self.check;
        if g.braille {
            frame.render_widget(
                Paragraph::new(
                    FACE.iter()
                        .map(|r| ui::plain(r.to_string(), theme.text()))
                        .collect::<Vec<_>>(),
                ),
                Rect {
                    x: area.x + 4,
                    y: area.y + 1,
                    width: 16,
                    height: 7,
                },
            );
        }
        let right = Rect {
            x: area.x + 25,
            y: area.y + 2,
            width: area.width.saturating_sub(28),
            height: 4,
        };
        let headline = if self.ready() { w.ready } else { w.not_ready };
        frame.render_widget(
            Paragraph::new(vec![
                ui::plain(headline, theme.bold()),
                ui::plain(
                    format!(
                        "{} {} · {} · {} {}",
                        w.version,
                        env!("CARGO_PKG_VERSION"),
                        count(lang, recordings as i64, w.recordings),
                        words::span(seconds),
                        w.of_sound
                    ),
                    theme.muted(),
                ),
                ui::plain(w.stays_here, theme.muted()),
            ]),
            right,
        );

        let width = area.width.saturating_sub(8) as usize;
        let label = |text: &str| Span::styled(ui::pad(text, 22), theme.muted());
        let micro = |text: &str| {
            ui::plain(
                format!("    {text}"),
                theme.muted().add_modifier(Modifier::BOLD),
            )
        };
        let mut lines = vec![micro(w.micro_archive)];
        let size = std::fs::metadata(&ctx.archive)
            .map(|m| m.len())
            .unwrap_or(0);
        lines.push(Line::from(vec![
            Span::raw("    "),
            label(w.location),
            Span::styled(
                cut(
                    &ctx.archive.display().to_string(),
                    width.saturating_sub(26),
                    g.ellipsis,
                ),
                theme.text(),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::raw("    "),
            label(w.size),
            Span::styled(words::megabytes(lang, size), theme.text()),
        ]));
        lines.push(Line::raw(""));
        lines.push(micro(w.micro_parts));
        let part = |name: &str, found: Option<&String>| -> Line<'static> {
            match found {
                Some(path) => Line::from(vec![
                    Span::styled(format!("    {} ", g.done), theme.success()),
                    Span::styled(ui::pad(name, 20), theme.text()),
                    Span::styled(
                        cut(path, width.saturating_sub(26), g.ellipsis),
                        theme.muted(),
                    ),
                ]),
                None => Line::from(vec![
                    Span::styled(format!("    {} ", g.warning), theme.warning()),
                    Span::styled(ui::pad(name, 20), theme.text()),
                    Span::styled(w.missing.to_string(), theme.warning()),
                ]),
            }
        };
        lines.push(part("ffmpeg", check.ffmpeg.as_ref()));
        lines.push(part("whisper", check.whisper_cli.as_ref()));
        lines.push(part(w.transcription_model, check.model_whisper_id.as_ref()));
        lines.push(Line::raw(""));
        lines.push(micro(w.micro_performance));
        lines.push(Line::from(vec![
            Span::raw("    "),
            label(w.runs_on),
            Span::styled(words::compute(lang, &check.compute), theme.text()),
        ]));
        if let Some(gigabytes) = check.memory_gb {
            lines.push(Line::from(vec![
                Span::raw("    "),
                label(w.memory),
                Span::styled(format!("{gigabytes} GB"), theme.text()),
            ]));
        }
        if !check.issues.is_empty() {
            lines.push(Line::raw(""));
            for issue in &check.issues {
                for (i, piece) in ui::wrap(&describe_in(lang, issue), width.saturating_sub(4))
                    .into_iter()
                    .enumerate()
                {
                    let mark = if i == 0 {
                        format!("    {} ", g.warning)
                    } else {
                        "      ".into()
                    };
                    lines.push(Line::from(vec![
                        Span::styled(mark, theme.warning()),
                        Span::styled(piece, theme.warning()),
                    ]));
                }
            }
        }
        // The last row is the publisher's, so the lines stop one short of it.
        frame.render_widget(
            Paragraph::new(lines),
            ui::rows(area, 9, area.height.saturating_sub(10)),
        );

        // The publisher, bottom right: one character a shape, in its colours.
        let mut signature = Vec::new();
        if g.braille {
            for (i, shape) in ["▲", "●", "■"].iter().enumerate() {
                signature.push(Span::styled(format!("{shape} "), theme.brand(i)));
            }
        }
        signature.push(Span::styled("Značkárna  ", theme.muted()));
        let width = ui::line_cells(&signature) as u16;
        if area.height > 10 && area.width > width {
            frame.render_widget(
                Paragraph::new(Line::from(signature)),
                Rect {
                    x: area.right() - width,
                    y: area.bottom() - 1,
                    width,
                    height: 1,
                },
            );
        }
    }
}
