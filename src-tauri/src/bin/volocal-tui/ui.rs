//! Drawing that every screen shares: the bands, the keycaps, a dialog's
//! frame, a bar, and text cut and wrapped to the grid.

use crate::theme::Theme;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph};
use ratatui::Frame;

/// The keys a footer shows: on the left, kept while they fit, and on the right.
pub type FooterKeys = (
    Vec<(&'static str, &'static str)>,
    Vec<(&'static str, &'static str)>,
);

/// How many cells a plain string takes. Czech letters are one cell each, and
/// so is every glyph the screens use.
pub fn cells(text: &str) -> usize {
    text.chars().count()
}

/// Plain text cut to `width` cells, with an ellipsis when it had to be.
pub fn cut(text: &str, width: usize, ellipsis: &str) -> String {
    if cells(text) <= width {
        return text.to_string();
    }
    let keep = width.saturating_sub(cells(ellipsis));
    format!("{}{ellipsis}", text.chars().take(keep).collect::<String>())
}

/// Plain text padded with spaces to `width` cells.
pub fn pad(text: &str, width: usize) -> String {
    format!("{text}{}", " ".repeat(width.saturating_sub(cells(text))))
}

/// The cells a line of spans takes.
pub fn line_cells(spans: &[Span]) -> usize {
    spans.iter().map(|s| cells(&s.content)).sum()
}

/// Lower case without diacritics, so `kdyz` finds `když` in a title as the
/// archive's index finds it in a transcript.
pub fn fold(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'á' | 'Á' | 'ä' | 'Ä' => 'a',
            'č' | 'Č' => 'c',
            'ď' | 'Ď' => 'd',
            'é' | 'É' | 'ě' | 'Ě' | 'ë' => 'e',
            'í' | 'Í' => 'i',
            'ľ' | 'Ľ' | 'ĺ' | 'Ĺ' => 'l',
            'ň' | 'Ň' => 'n',
            'ó' | 'Ó' | 'ö' | 'Ö' | 'ô' => 'o',
            'ř' | 'Ř' | 'ŕ' => 'r',
            'š' | 'Š' => 's',
            'ť' | 'Ť' => 't',
            'ú' | 'Ú' | 'ů' | 'Ů' | 'ü' | 'Ü' => 'u',
            'ý' | 'Ý' => 'y',
            'ž' | 'Ž' => 'z',
            other => other.to_lowercase().next().unwrap_or(other),
        })
        .collect()
}

/// Plain text broken into lines of at most `width` cells, at spaces where
/// it can be.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(10);
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        let word_cells = cells(word);
        let line_cells = cells(&line);
        if line_cells > 0 && line_cells + 1 + word_cells > width {
            lines.push(std::mem::take(&mut line));
        }
        if word_cells > width {
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

/// Spans of `text` with every occurrence of `query` (folded) in `hit`, and
/// the rest in `normal`. `current` marks one occurrence, counted from zero,
/// in `current_style`.
pub fn highlighted<'a>(
    text: &str,
    query: &str,
    normal: Style,
    hit: Style,
    current: Option<(usize, Style)>,
) -> Vec<Span<'a>> {
    let needle = fold(query);
    if needle.is_empty() {
        return vec![Span::styled(text.to_string(), normal)];
    }
    let chars: Vec<char> = text.chars().collect();
    let folded: Vec<char> = fold(text).chars().collect();
    let needle: Vec<char> = needle.chars().collect();
    let mut spans = Vec::new();
    let mut start = 0;
    let mut i = 0;
    let mut nth = 0;
    while i + needle.len() <= folded.len() {
        if folded[i..i + needle.len()] == needle[..] {
            if start < i {
                spans.push(Span::styled(
                    chars[start..i].iter().collect::<String>(),
                    normal,
                ));
            }
            let style = match current {
                Some((which, style)) if which == nth => style,
                _ => hit,
            };
            spans.push(Span::styled(
                chars[i..i + needle.len()].iter().collect::<String>(),
                style,
            ));
            nth += 1;
            i += needle.len();
            start = i;
        } else {
            i += 1;
        }
    }
    if start < chars.len() {
        spans.push(Span::styled(
            chars[start..].iter().collect::<String>(),
            normal,
        ));
    }
    spans
}

/// How many times `query` occurs in `text`, both folded.
pub fn occurrences(text: &str, query: &str) -> usize {
    let needle = fold(query);
    if needle.is_empty() {
        return 0;
    }
    fold(text).matches(&needle).count()
}

/// A full-width band with spans on the left and on the right.
pub fn band(frame: &mut Frame, area: Rect, theme: &Theme, left: Vec<Span>, right: Vec<Span>) {
    let width = area.width as usize;
    let used = line_cells(&left) + line_cells(&right);
    let mut spans = left;
    spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
    spans.extend(right);
    frame.render_widget(Paragraph::new(Line::from(spans)).style(theme.band()), area);
}

/// The keys a screen answers to, as caps with their labels, for a footer.
pub fn keys<'a>(theme: &Theme, pairs: &[(&str, &str)]) -> Vec<Span<'a>> {
    let mut spans = Vec::new();
    for (i, (key, label)) in pairs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw("  "));
        }
        spans.push(Span::styled(format!(" {key} "), theme.key()));
        spans.push(Span::styled(format!(" {label}"), theme.muted()));
    }
    spans
}

/// A footer: the keys on the left, kept as long as they fit, and the right
/// group always.
pub fn footer(
    frame: &mut Frame,
    area: Rect,
    theme: &Theme,
    left: &[(&str, &str)],
    right: &[(&str, &str)],
) {
    let right_spans = keys(theme, right);
    let room = (area.width as usize).saturating_sub(line_cells(&right_spans) + 4);
    let mut shown = left.len();
    while shown > 0 && line_cells(&keys(theme, &left[..shown])) > room {
        shown -= 1;
    }
    let mut spans = vec![Span::raw(" ")];
    spans.extend(keys(theme, &left[..shown]));
    let mut right_spans = right_spans;
    right_spans.push(Span::raw(" "));
    band(frame, area, theme, spans, right_spans);
}

/// Fades whatever is drawn already, for the screen behind a dialog.
pub fn veil(buffer: &mut Buffer, area: Rect, theme: &Theme) {
    let faint = theme.faint();
    for y in area.top()..area.bottom() {
        for x in area.left()..area.right() {
            if let Some(cell) = buffer.cell_mut((x, y)) {
                cell.set_style(Style::reset());
                cell.set_style(faint);
            }
        }
    }
}

/// A dialog of `width` × `height` in the middle of `area`, with a rounded
/// frame, over a faded screen. Returns the inside, three cells in from the
/// frame on the left as every dialog of the window is.
pub fn dialog(frame: &mut Frame, area: Rect, theme: &Theme, width: u16, height: u16) -> Rect {
    veil(frame.buffer_mut(), area, theme);
    let width = width.min(area.width);
    let height = height.min(area.height);
    let outer = Rect {
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
    };
    frame.render_widget(Clear, outer);
    let border = if theme.ascii {
        BorderType::Plain
    } else {
        BorderType::Rounded
    };
    frame.render_widget(
        Block::default()
            .borders(Borders::ALL)
            .border_type(border)
            .border_style(theme.border())
            .style(theme.dialog()),
        outer,
    );
    Rect {
        x: outer.x + 4,
        y: outer.y + 2,
        width: outer.width.saturating_sub(8),
        height: outer.height.saturating_sub(4),
    }
}

/// A bar of `width` cells, `fraction` of it full.
pub fn bar<'a>(theme: &Theme, fraction: f64, width: usize) -> Vec<Span<'a>> {
    let glyphs = theme.glyphs();
    let fraction = fraction.clamp(0.0, 1.0);
    let full = (fraction * width as f64).floor() as usize;
    let tip = usize::from(full < width && fraction > 0.0);
    let empty = width - full - tip;
    vec![
        Span::styled(
            glyphs.fill.repeat(full) + &glyphs.tip.repeat(tip),
            theme.accent(),
        ),
        Span::styled(glyphs.track.repeat(empty), theme.track()),
    ]
}

/// A line of text in one style.
pub fn plain<'a>(text: impl Into<String>, style: Style) -> Line<'a> {
    Line::from(Span::styled(text.into(), style))
}

/// The rows of `area` from `top`, `count` of them.
pub fn rows(area: Rect, top: u16, count: u16) -> Rect {
    let y = area.y.saturating_add(top).min(area.bottom());
    Rect {
        x: area.x,
        y,
        width: area.width,
        height: count.min(area.bottom().saturating_sub(y)),
    }
}

/// `area` without `left` cells on the left and `right` on the right.
pub fn inset(area: Rect, left: u16, right: u16) -> Rect {
    Rect {
        x: area.x + left.min(area.width),
        y: area.y,
        width: area.width.saturating_sub(left + right),
        height: area.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folding_finds_czech_without_its_accents() {
        assert_eq!(fold("Když Řekl ŽÁDOST"), "kdyz rekl zadost");
        assert_eq!(occurrences("Rozpočet a rozpočtu", "rozpoc"), 2);
    }

    #[test]
    fn hits_are_marked_where_they_are() {
        let spans = highlighted(
            "a Rozpočet b",
            "rozpocet",
            Style::new(),
            Style::new().bold(),
            None,
        );
        let texts: Vec<&str> = spans.iter().map(|s| s.content.as_ref()).collect();
        assert_eq!(texts, ["a ", "Rozpočet", " b"]);
    }

    #[test]
    fn text_is_cut_and_wrapped_to_the_grid() {
        assert_eq!(cut("Přednáška", 5, "…"), "Před…");
        assert_eq!(cut("krátké", 10, "…"), "krátké");
        assert_eq!(wrap("aaa bbbb ccccc dd", 10), ["aaa bbbb", "ccccc dd"]);
    }
}
