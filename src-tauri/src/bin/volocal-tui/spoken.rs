//! Which words of the block that sounds have been said: the window colours
//! them as the sound reaches each (`.word.sounded`), and so does the reader.
//!
//! The times are the window's reading of what is stored (`src/wordTimes.ts`,
//! `src/detail/corrections.tsx`), ported rather than reinvented: Whisper's own
//! time for each word, the words that share one spread across the gap after
//! them, and for a block without stored words — an older transcript or one
//! rewritten by hand — an estimate from where each word sits in the text.
//! **Nothing stored is changed**; this only decides what to colour.

use ratatui::style::Style;
use ratatui::text::Span;
use serde::Deserialize;
use volocal_lib::db::Segment;

/// How far ahead of the estimate a tied word lands; measured, see
/// `wordTimes.ts`, which keeps the table.
const LEAD: f64 = 0.08;

/// A word as the archive stores it: `{"t":1.23,"s":"slovo"}`.
#[derive(Deserialize)]
struct Stored {
    t: f64,
    s: String,
}

/// `spreadTiedWords`: the time to use for each word. The first word of every
/// group that shares a timestamp keeps it exactly; the others are placed
/// across the gap to the next measured word (or `until`), weighted by length,
/// pulled `LEAD` earlier and never before the group's own start.
fn spread(words: &[(f64, usize)], until: f64) -> Vec<f64> {
    let mut times: Vec<f64> = words.iter().map(|w| w.0).collect();
    let mut start = 0;
    while start < words.len() {
        let mut last = start;
        while last + 1 < words.len() && words[last + 1].0 == words[start].0 {
            last += 1;
        }
        if last > start {
            let end = if last + 1 < words.len() {
                words[last + 1].0
            } else {
                until
            };
            let span = end - words[start].0;
            if span > 0.0 {
                let total: usize = words[start..=last].iter().map(|w| w.1).sum();
                let mut before = 0;
                for i in start..=last {
                    let fraction = if total > 0 {
                        before as f64 / total as f64
                    } else {
                        (i - start) as f64 / (last - start + 1) as f64
                    };
                    times[i] = words[start].0.max(words[start].0 + span * fraction - LEAD);
                    before += words[i].1;
                }
            }
        }
        start = last + 1;
    }
    times
}

/// When each word of the block's text starts, one time per word as
/// `split_whitespace` finds them in `segment.text`.
pub fn word_times(segment: &Segment) -> Vec<f64> {
    let text: Vec<&str> = segment.text.split_whitespace().collect();
    let stored: Vec<Stored> = segment
        .words
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();
    if !stored.is_empty() {
        let pairs: Vec<(f64, usize)> = stored.iter().map(|w| (w.t, w.s.chars().count())).collect();
        let times = spread(&pairs, segment.end);
        if times.len() == text.len() {
            return times;
        }
        // Whisper's words and the text's differ in count — punctuation of its
        // own, a hyphen — so each word of the text takes the time of the
        // stored word at the same place in the list.
        return (0..text.len())
            .map(|i| times[(i * times.len() / text.len().max(1)).min(times.len() - 1)])
            .collect();
    }
    // The window's fallback: where the word begins in the text, as a share of
    // the block's length in time.
    let total: usize = segment.text.trim().chars().count().max(1);
    let mut times = Vec::with_capacity(text.len());
    let mut position = 0;
    let trimmed = segment.text.trim();
    let mut rest = trimmed;
    for word in &text {
        let offset = rest.find(word).unwrap_or(0);
        position += rest[..offset].chars().count();
        times.push(segment.start + position as f64 / total as f64 * (segment.end - segment.start));
        position += word.chars().count();
        rest = &rest[offset + word.len()..];
    }
    times
}

/// How many of the block's words have been said by `at`.
pub fn said(times: &[f64], at: f64) -> usize {
    times.iter().filter(|t| **t <= at).count()
}

/// Where the `n`th word of `text` ends, in characters; the whole text when it
/// has fewer.
pub fn chars_through(text: &str, n: usize) -> usize {
    if n == 0 {
        return 0;
    }
    let mut seen = 0;
    let mut in_word = false;
    for (i, c) in text.chars().enumerate() {
        if c.is_whitespace() {
            if in_word {
                seen += 1;
                if seen == n {
                    return i;
                }
            }
            in_word = false;
        } else {
            in_word = true;
        }
    }
    text.chars().count()
}

/// The first `upto` characters of a line in `said`, where they were drawn in
/// `normal`: a search hit keeps its own colour.
pub fn colour<'a>(spans: Vec<Span<'a>>, upto: usize, normal: Style, said: Style) -> Vec<Span<'a>> {
    let mut out = Vec::with_capacity(spans.len() + 1);
    let mut left = upto;
    for span in spans {
        let length = span.content.chars().count();
        if left == 0 || span.style != normal {
            left = left.saturating_sub(length);
            out.push(span);
            continue;
        }
        if length <= left {
            left -= length;
            out.push(Span::styled(span.content, said));
            continue;
        }
        let head: String = span.content.chars().take(left).collect();
        let tail: String = span.content.chars().skip(left).collect();
        out.push(Span::styled(head, said));
        out.push(Span::styled(tail, normal));
        left = 0;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(pairs: &[(f64, &str)]) -> Vec<(f64, usize)> {
        pairs.iter().map(|(t, s)| (*t, s.chars().count())).collect()
    }

    // The window's own cases (`src/wordTimes.test.ts`), so the two read the
    // stored times alike.
    #[test]
    fn tied_words_are_spread_as_the_window_spreads_them() {
        assert_eq!(
            spread(&words(&[(1.0, "a"), (2.0, "b"), (3.0, "c")]), 4.0),
            [1.0, 2.0, 3.0]
        );
        let t = spread(&words(&[(10.0, "ab"), (10.0, "cd"), (12.0, "e")]), 20.0);
        assert!(
            t[0] == 10.0 && t[1] > 10.0 && t[1] < 12.0 && t[2] == 12.0,
            "{t:?}"
        );
        let t = spread(
            &words(&[(5.0, "a"), (5.0, "b"), (5.0, "c"), (9.0, "d"), (9.0, "e")]),
            12.0,
        );
        assert!(t[0] == 5.0 && t[3] == 9.0, "{t:?}");
        let t = spread(
            &words(&[(0.0, "aaaa"), (0.0, "b"), (0.0, "c"), (1.0, "d")]),
            2.0,
        );
        assert!(t[..3].iter().all(|t| *t < 1.0), "{t:?}");
        let long = spread(
            &words(&[(0.0, "dlouhatanske"), (0.0, "x"), (1.0, "z")]),
            2.0,
        )[1];
        let short = spread(
            &words(&[(0.0, "x"), (0.0, "dlouhatanske"), (1.0, "z")]),
            2.0,
        )[1];
        assert!(long > short);
        assert_eq!(
            spread(&words(&[(7.0, "a"), (7.0, "b"), (7.0, "c")]), 7.0),
            [7.0; 3]
        );
        assert_eq!(spread(&words(&[(7.0, "a"), (7.0, "b")]), 3.0), [7.0; 2]);
        let t = spread(&words(&[(100.0, "a"), (100.0, "b"), (100.01, "c")]), 101.0);
        assert!(t.iter().all(|t| *t >= 100.0), "{t:?}");
    }

    fn segment(text: &str, words: Option<&str>) -> Segment {
        Segment {
            start: 10.0,
            end: 14.0,
            text: text.into(),
            words: words.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn a_block_reads_its_stored_words_and_estimates_without_them() {
        let stored = segment(
            "Dobrý den, vítejte.",
            Some(r#"[{"t":10.0,"s":"Dobrý"},{"t":10.6,"s":"den,"},{"t":11.4,"s":"vítejte."}]"#),
        );
        assert_eq!(word_times(&stored), [10.0, 10.6, 11.4]);
        assert_eq!(said(&word_times(&stored), 10.7), 2);
        // Rewritten by hand: no stored words, so where each word sits in the text.
        let edited = segment("raz dva", None);
        let times = word_times(&edited);
        assert_eq!(times[0], 10.0);
        assert!(
            (times[1] - (10.0 + 4.0 / 7.0 * 4.0)).abs() < 1e-9,
            "{times:?}"
        );
    }

    #[test]
    fn what_was_said_is_coloured_and_a_hit_keeps_its_own() {
        let normal = Style::new();
        let said_style = Style::new().fg(ratatui::style::Color::Blue);
        let hit = Style::new().fg(ratatui::style::Color::Yellow);
        assert_eq!(chars_through("raz dva tři", 2), 7);
        assert_eq!(chars_through("raz dva", 5), 7);
        let spans = vec![
            Span::styled("raz ", normal),
            Span::styled("dva", hit),
            Span::styled(" tři", normal),
        ];
        let out = colour(spans, 9, normal, said_style);
        let shown: Vec<(String, Style)> = out
            .iter()
            .map(|s| (s.content.to_string(), s.style))
            .collect();
        assert_eq!(
            shown,
            [
                ("raz ".to_string(), said_style),
                ("dva".to_string(), hit),
                (" t".to_string(), said_style),
                ("ři".to_string(), normal),
            ]
        );
    }
}
