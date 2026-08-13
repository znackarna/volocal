//! Converts transcripts into portable output formats.

use crate::db::{Recording, Segment, Speaker};
use std::collections::HashMap;

fn names(speakers: &[Speaker]) -> HashMap<String, String> {
    speakers
        .iter()
        .map(|speaker| (speaker.key.clone(), speaker.name.clone()))
        .collect()
}

fn time_srt(s: f64) -> String {
    let total_ms = (s.max(0.0) * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let seconds = (total_ms / 1000) % 60;
    let minutes = (total_ms / 60_000) % 60;
    let hours = total_ms / 3_600_000;
    format!("{hours:02}:{minutes:02}:{seconds:02},{ms:03}")
}

fn time_vtt(s: f64) -> String {
    time_srt(s).replace(',', ".")
}

// ---------------------------------------------------------- prose paragraphs

/// A paragraph should feel substantial without becoming a wall of text.
/// These are deliberately character counts rather than screen pixels: export
/// must stay stable across editors, fonts and window sizes.
const PARAGRAPH_MIN_CHARS: usize = 220;
const PARAGRAPH_TARGET_CHARS: usize = 520;
const PARAGRAPH_MAX_CHARS: usize = 900;
const PARAGRAPH_MAX_BLOCKS: usize = 6;
const SOFT_PARAGRAPH_PAUSE: f64 = 1.5;
const HARD_PARAGRAPH_PAUSE: f64 = 2.5;
const ORPHAN_PARAGRAPH_CHARS: usize = 120;

/// Paragraph layout may use only a real sentence ending. Editor blocks can
/// end at commas because their job is readable playback highlighting, not
/// prose structure; treating those boundaries as paragraph endings leaves a
/// subordinate clause stranded on the next line.
fn ends_prose_sentence(text: &str) -> bool {
    text.trim_end()
        .trim_end_matches(['"', '»', '“', '”', ')', ']'])
        .ends_with(['.', '!', '?', '…'])
}

#[derive(Debug)]
struct ProseParagraph {
    speaker: Option<String>,
    start: f64,
    end: f64,
    text: String,
    blocks: usize,
}

impl ProseParagraph {
    fn from_segment(segment: &Segment, text: &str) -> Self {
        Self {
            speaker: segment.speakers.clone(),
            start: segment.start,
            end: segment.end,
            text: text.to_string(),
            blocks: 1,
        }
    }

    fn char_count(&self) -> usize {
        self.text.chars().count()
    }

    fn joined_char_count(&self, text: &str) -> usize {
        self.char_count() + usize::from(!self.text.is_empty()) + text.chars().count()
    }

    fn append(&mut self, segment: &Segment, text: &str) {
        if !self.text.is_empty() {
            self.text.push(' ');
        }
        self.text.push_str(text);
        self.end = segment.end.max(self.end);
        self.blocks += 1;
    }

    fn append_paragraph(&mut self, paragraph: ProseParagraph) {
        if !self.text.is_empty() {
            self.text.push(' ');
        }
        self.text.push_str(&paragraph.text);
        self.end = paragraph.end.max(self.end);
        self.blocks += paragraph.blocks;
    }
}

/// Builds prose paragraphs independently of the editor's visual blocks.
///
/// Speaker turns and strong pauses are semantic boundaries. Length and a
/// smaller pause are softer typographic boundaries. No text is rewritten:
/// this function only decides where to put blank lines in portable exports.
fn prose_paragraphs(segments: &[Segment]) -> Vec<ProseParagraph> {
    let mut paragraphs: Vec<ProseParagraph> = Vec::new();
    let mut current: Option<ProseParagraph> = None;

    for segment in segments {
        let text = segment.text.trim();
        if text.is_empty() {
            continue;
        }

        let Some(paragraph) = current.as_mut() else {
            current = Some(ProseParagraph::from_segment(segment, text));
            continue;
        };

        let gap = (segment.start - paragraph.end).max(0.0);
        let speaker_changed = segment.speakers != paragraph.speaker;
        let projected_chars = paragraph.joined_char_count(text);
        let sentence_complete = ends_prose_sentence(&paragraph.text);
        let useful_size = paragraph.char_count() >= PARAGRAPH_MIN_CHARS;
        let too_many_blocks = paragraph.blocks >= PARAGRAPH_MAX_BLOCKS && useful_size;
        let layout_boundary = gap >= HARD_PARAGRAPH_PAUSE
            || projected_chars > PARAGRAPH_MAX_CHARS
            || projected_chars > PARAGRAPH_TARGET_CHARS
            || too_many_blocks
            || (useful_size && gap >= SOFT_PARAGRAPH_PAUSE);
        // A speaker turn is meaningful even if Whisper omitted punctuation.
        // Every purely typographic break, however, must wait for a sentence.
        let should_break = speaker_changed || (sentence_complete && layout_boundary);

        if should_break {
            paragraphs.push(current.take().unwrap());
            current = Some(ProseParagraph::from_segment(segment, text));
        } else {
            paragraph.append(segment, text);
        }
    }
    if let Some(paragraph) = current {
        paragraphs.push(paragraph);
    }

    // A length boundary near the end can leave one short sentence by itself.
    // Join it back when doing so neither crosses a speaker/strong-pause
    // boundary nor creates another wall of text.
    let mut without_orphans: Vec<ProseParagraph> = Vec::with_capacity(paragraphs.len());
    for paragraph in paragraphs {
        let merge_with_previous = paragraph.char_count() < ORPHAN_PARAGRAPH_CHARS
            && without_orphans.last().is_some_and(|previous| {
                previous.speaker == paragraph.speaker
                    && paragraph.start - previous.end < HARD_PARAGRAPH_PAUSE
                    && previous.joined_char_count(&paragraph.text) <= PARAGRAPH_MAX_CHARS
            });
        if merge_with_previous {
            without_orphans
                .last_mut()
                .unwrap()
                .append_paragraph(paragraph);
        } else {
            without_orphans.push(paragraph);
        }
    }
    without_orphans
}

/// Clean text with human-sized paragraphs and plain speaker labels.
pub fn txt(segments: &[Segment], speakers: &[Speaker]) -> String {
    let speaker_names = names(speakers);
    let paragraphs = prose_paragraphs(segments);
    let mut output = String::new();
    let mut previous_speaker: Option<String> = None;
    let mut first = true;

    for paragraph in paragraphs {
        let new_turn = first || paragraph.speaker != previous_speaker;
        if !output.is_empty() {
            output.push_str("\n\n");
        }
        if new_turn {
            if let Some(key) = &paragraph.speaker {
                let name = speaker_names
                    .get(key)
                    .cloned()
                    .unwrap_or_else(|| key.clone());
                output.push_str(&name);
                output.push_str(":\n");
            }
        }
        output.push_str(&paragraph.text);
        previous_speaker = paragraph.speaker;
        first = false;
    }
    if !output.is_empty() {
        output.push('\n');
    }
    output
}

pub fn markdown(recording: &Recording, segments: &[Segment], speakers: &[Speaker]) -> String {
    let speaker_names = names(speakers);
    let mut v = format!("# {}\n\n", recording.title);
    v.push_str(&format!(
        "*Přepsáno modelem {} · délka {}*\n\n---\n\n",
        recording.model,
        format_duration(recording.duration)
    ));

    let mut previous_speaker: Option<String> = None;
    let mut first = true;
    for paragraph in prose_paragraphs(segments) {
        let new_turn = first || paragraph.speaker != previous_speaker;
        if new_turn {
            if let Some(key) = &paragraph.speaker {
                let name = speaker_names
                    .get(key)
                    .cloned()
                    .unwrap_or_else(|| key.clone());
                v.push_str(&format!("**{name}**\n\n"));
            }
        }
        v.push_str(&paragraph.text);
        v.push_str("\n\n");
        previous_speaker = paragraph.speaker;
        first = false;
    }
    v
}

// -------------------------------------------------------------- subtitles
//
// A transcript segment and a subtitle are not the same thing. A paragraph
// reads fine in the editor but not as a subtitle: the viewer has a couple of
// seconds and the line has to fit the width of the picture. Segments are
// therefore chopped into batches before being written out.

/// Maximum characters per subtitle line. Two lines is the convention; three
/// already start covering the picture.
const CHARS_PER_LINE: usize = 42;
const CAPTION_LINES: usize = 2;
/// Longest time a single subtitle stays on screen.
const MAX_CAPTION_SECONDS: f64 = 6.0;
/// Shortest time a subtitle stays on screen.
///
/// A word lasting a third of a second is a perfectly good transcript segment
/// and a hopeless subtitle — it flashes past before the eye finds it. Short
/// ones are stretched into the silence that follows.
const MIN_CAPTION_SECONDS: f64 = 1.2;
/// Gap left between two subtitles when one is stretched, so they do not run
/// into each other.
const CAPTION_GAP: f64 = 0.08;
/// Longest pause across which two brief captions are still joined. Beyond it
/// they are separate remarks, however short.
const MAX_MERGE_GAP: f64 = 0.6;

#[derive(Debug)]
struct Caption {
    start: f64,
    end: f64,
    text: String,
}

/// Word timings stored with the segment, when available.
fn segment_words(s: &Segment) -> Option<Vec<(f64, String)>> {
    let json = s.words.as_deref()?;
    let fields: Vec<serde_json::Value> = serde_json::from_str(json).ok()?;
    let output: Vec<(f64, String)> = fields
        .iter()
        .filter_map(|w| Some((w["t"].as_f64()?, w["s"].as_str()?.trim().to_string())))
        .filter(|(_, t)| !t.is_empty())
        .collect();
    if output.len() < 2 {
        None
    } else {
        Some(output)
    }
}

/// Breaks text into at most two lines of roughly equal length.
///
/// Filling the first line to the brim and leaving two words on the second is
/// what greedy wrapping does, and it reads badly — the eye jumps from a full
/// line to a stub. Splitting near the middle keeps both lines about the same
/// width, which is what subtitling practice asks for.
fn wrap_caption(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return String::new();
    }
    let total: usize = text.chars().count();
    if total <= CHARS_PER_LINE || words.len() < 2 {
        return words.join(" ");
    }

    // Try every break between words and keep the one closest to halfway that
    // leaves both lines within the width.
    let mut best: Option<(usize, usize)> = None;
    for split in 1..words.len() {
        let first: usize = words[..split].join(" ").chars().count();
        let second: usize = words[split..].join(" ").chars().count();
        if first > CHARS_PER_LINE || second > CHARS_PER_LINE {
            continue;
        }
        let imbalance = first.abs_diff(second);
        if best.map(|(_, b)| imbalance < b).unwrap_or(true) {
            best = Some((split, imbalance));
        }
    }

    match best {
        Some((split, _)) => format!("{}\n{}", words[..split].join(" "), words[split..].join(" ")),
        // Nothing fits in two lines — a single very long word, or text the
        // batching should have cut. Fall back to filling lines in order.
        None => {
            let mut rows: Vec<String> = Vec::new();
            let mut row = String::new();
            for word in &words {
                if !row.is_empty()
                    && row.chars().count() + 1 + word.chars().count() > CHARS_PER_LINE
                {
                    rows.push(std::mem::take(&mut row));
                }
                if !row.is_empty() {
                    row.push(' ');
                }
                row.push_str(word);
            }
            if !row.is_empty() {
                rows.push(row);
            }
            rows.join("\n")
        }
    }
}

/// Joins neighbouring captions that are each too brief to read.
///
/// Stretching only helps where silence follows. Short remarks that come one
/// after another — "Yeah." / "We agree." / "Yeah, we agree." — have nowhere to
/// grow into, and each would flash past on its own. Together they make one
/// readable caption, which is what a subtitler would do by hand.
///
/// Only joined when the result still fits two lines and the permitted time,
/// and when the pause between them is short enough that they belong together.
fn merge_short_captions(captions: Vec<Caption>) -> Vec<Caption> {
    let ceiling = CHARS_PER_LINE * CAPTION_LINES;
    let mut output: Vec<Caption> = Vec::with_capacity(captions.len());

    for caption in captions {
        if let Some(previous) = output.last() {
            let either_is_brief = previous.end - previous.start < MIN_CAPTION_SECONDS
                || caption.end - caption.start < MIN_CAPTION_SECONDS;
            let close_enough = caption.start - previous.end <= MAX_MERGE_GAP;
            let joined = format!(
                "{} {}",
                previous.text.replace('\n', " "),
                caption.text.replace('\n', " ")
            );
            let fits = joined.chars().count() <= ceiling
                && caption.end - previous.start <= MAX_CAPTION_SECONDS;

            if either_is_brief && close_enough && fits {
                let last = output.last_mut().unwrap();
                last.end = caption.end;
                last.text = wrap_caption(&joined);
                continue;
            }
        }
        output.push(caption);
    }
    output
}

/// Brings the timings into a range a viewer can actually read.
///
/// Runs after the captions are cut, because only then is it known where each
/// one's neighbours are. A caption is stretched into the silence that follows
/// it, never over the next one.
fn tidy_timings(captions: &mut [Caption]) {
    for i in 0..captions.len() {
        let limit = captions
            .get(i + 1)
            .map(|next| next.start - CAPTION_GAP)
            .unwrap_or(f64::MAX);

        let start = captions[i].start;
        let end = captions[i].end;

        if end - start < MIN_CAPTION_SECONDS {
            captions[i].end = (start + MIN_CAPTION_SECONDS).min(limit).max(end);
        } else if end - start > MAX_CAPTION_SECONDS {
            captions[i].end = start + MAX_CAPTION_SECONDS;
        }
    }
}

/// Where a sentence breaks into captions of at most `limit` characters,
/// as index ranges into `words`. A caption also breaks early where it would
/// otherwise run longer than a viewer can hold it on screen.
///
/// Ranges rather than finished captions, because the caller tries a dozen
/// limits before settling on one and only the count matters until then.
fn plan_captions(words: &[(f64, String)], limit: usize) -> Vec<(usize, usize)> {
    let mut output = Vec::new();
    let mut first = 0usize;
    // Characters in the current caption so far — not a duration, despite
    // what the previous name here suggested.
    let mut length = 0usize;

    for (i, (time, word)) in words.iter().enumerate() {
        let characters = word.chars().count();
        let started = i > first;
        let too_long = length + characters + 1 > limit;
        let too_slow = *time - words[first].0 > MAX_CAPTION_SECONDS;

        if started && (too_long || too_slow) {
            output.push((first, i));
            first = i;
            length = 0;
        }
        // The space only counts between words, not before the first one.
        length += characters + if i > first { 1 } else { 0 };
    }
    if first < words.len() {
        output.push((first, words.len()));
    }
    output
}

fn captions(segments: &[Segment]) -> Vec<Caption> {
    let ceiling = CHARS_PER_LINE * CAPTION_LINES;
    let mut output: Vec<Caption> = Vec::new();

    for s in segments {
        let text = s.text.trim();
        if text.is_empty() {
            continue;
        }
        let fits_as_one = text.chars().count() <= ceiling && s.end - s.start <= MAX_CAPTION_SECONDS;
        let Some(words) = segment_words(s) else {
            // Without word timings there is nowhere to cut and keep the
            // timing honest.
            output.push(Caption {
                start: s.start,
                end: s.end,
                text: wrap_caption(text),
            });
            continue;
        };
        if fits_as_one {
            output.push(Caption {
                start: s.start,
                end: s.end,
                text: wrap_caption(text),
            });
            continue;
        }

        // Filling each caption to the brim and letting the rest fall
        // through leaves a runt at the end: a sentence of 87 characters
        // becomes one caption of 80 and a second one reading only "Bohem."
        // Nothing downstream repairs it either — merging the two back
        // together would exceed the ceiling again.
        //
        // So plan the cut at the ceiling once, only to learn how many
        // captions the sentence needs, then look for the smallest limit that
        // still yields that many. Same number of captions, evenly filled.
        let needed = plan_captions(&words, ceiling).len();
        let limit = if needed < 2 {
            ceiling
        } else {
            let characters: usize = words
                .iter()
                .map(|(_, w)| w.chars().count() + 1)
                .sum::<usize>()
                .saturating_sub(1);
            (characters.div_ceil(needed)..=ceiling)
                .find(|&limit| plan_captions(&words, limit).len() <= needed)
                .unwrap_or(ceiling)
        };

        for (first, past) in plan_captions(&words, limit) {
            let text: Vec<&str> = words[first..past].iter().map(|(_, w)| w.as_str()).collect();
            output.push(Caption {
                start: words[first].0,
                // A timing says when a word begins, not when it ends, so the
                // caption runs up to the next one — or to the sentence's own
                // end if this is the last.
                end: words
                    .get(past)
                    .map(|(t, _)| *t)
                    .unwrap_or(s.end)
                    .max(words[first].0),
                text: wrap_caption(&text.join(" ")),
            });
        }
    }
    let mut output = merge_short_captions(output);
    tidy_timings(&mut output);
    output
}

pub fn srt(segments: &[Segment]) -> String {
    let mut v = String::new();
    for (i, t) in captions(segments).iter().enumerate() {
        v.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            time_srt(t.start),
            time_srt(t.end),
            t.text
        ));
    }
    v
}

pub fn vtt(segments: &[Segment]) -> String {
    let mut v = String::from("WEBVTT\n\n");
    for t in captions(segments) {
        v.push_str(&format!(
            "{} --> {}\n{}\n\n",
            time_vtt(t.start),
            time_vtt(t.end),
            t.text
        ));
    }
    v
}

pub fn json(recording: &Recording, segments: &[Segment], speakers: &[Speaker]) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "recording": recording,
        "speakers": speakers,
        "segments": segments,
    }))
    .unwrap_or_else(|_| "{}".into())
}

pub fn format_duration(s: f64) -> String {
    let total = s.max(0.0).round() as u64;
    let hours = total / 3600;
    let minutes = (total / 60) % 60;
    let seconds = total % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

pub fn extension(format: &str) -> &'static str {
    match format {
        "txt" => "txt",
        "md" => "md",
        "srt" => "srt",
        "vtt" => "vtt",
        _ => "json",
    }
}

pub fn create(
    format: &str,
    recording: &Recording,
    segments: &[Segment],
    speakers: &[Speaker],
) -> String {
    match format {
        "txt" => txt(segments, speakers),
        "md" => markdown(recording, segments, speakers),
        "srt" => srt(segments),
        "vtt" => vtt(segments),
        _ => json(recording, segments, speakers),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prose_segment(
        order: i64,
        start: f64,
        end: f64,
        text: &str,
        speaker: Option<&str>,
    ) -> Segment {
        Segment {
            id: format!("segment-{order}"),
            order,
            start,
            end,
            text: text.to_string(),
            speakers: speaker.map(str::to_string),
            ..Default::default()
        }
    }

    fn speaker(key: &str, name: &str) -> Speaker {
        Speaker {
            key: key.to_string(),
            recording_id: "recording".to_string(),
            name: name.to_string(),
            color: "#000000".to_string(),
        }
    }

    fn recording() -> Recording {
        Recording {
            id: "recording".to_string(),
            path: String::new(),
            title: "Rozhovor".to_string(),
            duration: 120.0,
            created_at: String::new(),
            status: "hotova".to_string(),
            model: "large-v3".to_string(),
            language: "cs".to_string(),
            language_choice: "cs".to_string(),
            error: None,
            segment_count: 0,
            folder: None,
        }
    }

    /// One word per 0.35 s, which is roughly conversational pace.
    fn sentence(text: &str) -> Segment {
        let words: Vec<serde_json::Value> = text
            .split_whitespace()
            .enumerate()
            .map(|(i, w)| serde_json::json!({ "t": i as f64 * 0.35, "s": w }))
            .collect();
        Segment {
            start: 0.0,
            end: (text.split_whitespace().count() as f64 - 1.0) * 0.35 + 0.4,
            text: text.to_string(),
            words: Some(serde_json::to_string(&words).unwrap()),
            ..Default::default()
        }
    }

    /// The case from a real recording: 87 characters became 80 + "Bohem."
    #[test]
    fn a_sentence_just_over_two_lines_is_not_left_with_a_runt() {
        let s = sentence(
            "Je to úplně jedno, protože ono je velké už jenom tím, že člověk se mohl setkat s Bohem.",
        );
        let cut = captions(&[s]);
        assert_eq!(cut.len(), 2);
        let shortest = cut
            .iter()
            .map(|c| c.text.replace('\n', " ").chars().count())
            .min()
            .unwrap();
        assert!(shortest > 20, "runt survived: {cut:?}");
    }

    #[test]
    fn balancing_never_adds_captions() {
        let s = sentence(
            "Je to vlastně, jmenují se osmihrán, mají to ve znaku, \
             stříkají ty osmihrány vždycky někde.",
        );
        assert_eq!(captions(&[s]).len(), 2);
    }

    #[test]
    fn a_short_sentence_stays_one_caption() {
        let cut = captions(&[sentence("A já jsem za to moc vděčný.")]);
        assert_eq!(cut.len(), 1);
        assert!(!cut[0].text.contains('\n'));
    }

    #[test]
    fn no_line_runs_past_the_reading_width() {
        let s = sentence(
            "Díky bohu, že máme úžasné lidi ve společenství, \
             kteří mě nenechali se utopit v těch věcech.",
        );
        for caption in captions(&[s]) {
            for line in caption.text.split('\n') {
                assert!(line.chars().count() <= CHARS_PER_LINE, "too wide: {line}");
            }
        }
    }

    #[test]
    fn short_neighbouring_blocks_form_one_prose_paragraph() {
        let segments = vec![
            prose_segment(0, 0.0, 2.0, "První krátká věta.", None),
            prose_segment(1, 2.1, 4.0, "Druhá krátká věta.", None),
            prose_segment(2, 4.1, 6.0, "Třetí krátká věta.", None),
        ];

        let paragraphs = prose_paragraphs(&segments);

        assert_eq!(paragraphs.len(), 1);
        assert_eq!(
            paragraphs[0].text,
            "První krátká věta. Druhá krátká věta. Třetí krátká věta."
        );
    }

    #[test]
    fn a_long_monologue_becomes_bounded_paragraphs_without_losing_text() {
        let sentence = "Tahle věta nese jednu ucelenou myšlenku a pokračuje přirozeným tempem.";
        let segments: Vec<Segment> = (0..14)
            .map(|index| {
                prose_segment(
                    index,
                    index as f64 * 4.0,
                    index as f64 * 4.0 + 3.8,
                    sentence,
                    None,
                )
            })
            .collect();

        let paragraphs = prose_paragraphs(&segments);

        assert!(paragraphs.len() >= 2);
        assert!(paragraphs
            .iter()
            .all(|paragraph| paragraph.char_count() <= PARAGRAPH_MAX_CHARS));
        assert_eq!(
            paragraphs
                .iter()
                .map(|paragraph| paragraph.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            segments
                .iter()
                .map(|segment| segment.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        );
    }

    #[test]
    fn a_strong_pause_starts_a_new_paragraph_even_when_text_is_short() {
        let segments = vec![
            prose_segment(0, 0.0, 2.0, "Před pauzou.", None),
            prose_segment(1, 5.0, 7.0, "Po pauze.", None),
        ];

        let paragraphs = prose_paragraphs(&segments);

        assert_eq!(paragraphs.len(), 2);
    }

    #[test]
    fn a_speaker_change_is_always_a_new_turn() {
        let segments = vec![
            prose_segment(0, 0.0, 2.0, "První odpověď.", Some("a")),
            prose_segment(1, 2.1, 4.0, "Druhá odpověď.", Some("b")),
        ];
        let speakers = vec![speaker("a", "Anna"), speaker("b", "Boris")];

        let plain = txt(&segments, &speakers);
        let md = markdown(&recording(), &segments, &speakers);

        assert!(plain.contains("Anna:\nPrvní odpověď."));
        assert!(plain.contains("Boris:\nDruhá odpověď."));
        assert!(md.contains("**Anna**\n\nPrvní odpověď."));
        assert!(md.contains("**Boris**\n\nDruhá odpověď."));
    }

    #[test]
    fn one_long_speaker_turn_does_not_repeat_its_label() {
        let long =
            "Jedna delší výpověď, která má dost textu na samostatnou část dokumentu. ".repeat(8);
        let segments = vec![
            prose_segment(0, 0.0, 20.0, long.trim(), Some("a")),
            prose_segment(1, 20.1, 40.0, long.trim(), Some("a")),
        ];
        let speakers = vec![speaker("a", "Anna")];

        let plain = txt(&segments, &speakers);
        let md = markdown(&recording(), &segments, &speakers);

        assert_eq!(plain.matches("Anna:\n").count(), 1);
        assert_eq!(md.matches("**Anna**").count(), 1);
        assert!(plain.contains("\n\n"));
    }

    #[test]
    fn prose_paragraphs_never_split_a_compound_sentence_after_a_comma() {
        let introduction = format!(
            "{} Dáme Jance ještě prostor, tak pro mě je moc důležité to říct, \
             my jsme byli asi dva dny předtím,",
            "Toto je dokončená úvodní věta.".repeat(14)
        );
        let segments = vec![
            prose_segment(0, 0.0, 12.0, &introduction, None),
            prose_segment(1, 12.1, 14.0, "než Jarda odešel,", None),
            prose_segment(
                2,
                14.1,
                19.0,
                "tak jsme za ním byli a potom spolu dlouho mluvili.",
                None,
            ),
            prose_segment(3, 19.1, 22.0, "Tady začíná další věta.", None),
        ];

        let paragraphs = prose_paragraphs(&segments);
        let plain = txt(&segments, &[]);

        assert!(!plain.contains("předtím,\n\nnež Jarda"));
        assert!(!plain.contains(",\n\n"));
        assert!(paragraphs
            .iter()
            .take(paragraphs.len().saturating_sub(1))
            .all(|paragraph| ends_prose_sentence(&paragraph.text)));
    }
}
