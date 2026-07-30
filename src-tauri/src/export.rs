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

/// Cisty text. Odstavce se lamou tam, kde je v nahravce vyrazna pauza
/// nebo kde se vymeni mluvci - jinak by vznikla nectitelna zed textu.
pub fn txt(segments: &[Segment], speakers: &[Speaker]) -> String {
    let speaker_names = names(speakers);
    let mut output = String::new();
    let mut last_speakers: Option<String> = None;
    let mut last_end = 0.0f64;
    let mut paragraph = String::new();

    for s in segments {
        let change_speaker = s.speakers != last_speakers;
        let has_pause = s.start - last_end > 1.5;

        if (change_speaker || has_pause) && !paragraph.is_empty() {
            output.push_str(paragraph.trim());
            output.push_str("\n\n");
            paragraph.clear();
        }
        if change_speaker && paragraph.is_empty() {
            if let Some(k) = &s.speakers {
                let name = speaker_names.get(k).cloned().unwrap_or_else(|| k.clone());
                paragraph.push_str(&format!("{name}: "));
            }
        }
        paragraph.push_str(s.text.trim());
        paragraph.push(' ');

        last_speakers = s.speakers.clone();
        last_end = s.end;
    }
    if !paragraph.is_empty() {
        output.push_str(paragraph.trim());
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

    let mut last: Option<String> = None;
    for s in segments {
        if s.speakers != last {
            if let Some(k) = &s.speakers {
                let name = speaker_names.get(k).cloned().unwrap_or_else(|| k.clone());
                v.push_str(&format!("\n**{name}**\n\n"));
            } else {
                v.push('\n');
            }
            last = s.speakers.clone();
        }
        v.push_str(s.text.trim());
        v.push(' ');
    }
    v.push('\n');
    v
}

// ---------------------------------------------------------------- titulky
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

/// Breaks text into lines at word boundaries so it fits the width.
fn wrap_caption(text: &str) -> String {
    let mut rows: Vec<String> = Vec::new();
    let mut row = String::new();
    for word in text.split_whitespace() {
        if !row.is_empty() && row.chars().count() + 1 + word.chars().count() > CHARS_PER_LINE {
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

fn captions(segments: &[Segment]) -> Vec<Caption> {
    let ceiling = CHARS_PER_LINE * CAPTION_LINES;
    let mut output: Vec<Caption> = Vec::new();

    for s in segments {
        let text = s.text.trim();
        if text.is_empty() {
            continue;
        }
        let dost_kratky = text.chars().count() <= ceiling && s.end - s.start <= MAX_CAPTION_SECONDS;
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
        if dost_kratky {
            output.push(Caption {
                start: s.start,
                end: s.end,
                text: wrap_caption(text),
            });
            continue;
        }

        let mut batch: Vec<&str> = Vec::new();
        let mut start = words[0].0;
        let mut duration = 0usize;

        for (time, word) in words.iter() {
            let znaku = word.chars().count();
            let prekroci_delku = duration + znaku + 1 > ceiling;
            let prekroci_time = *time - start > MAX_CAPTION_SECONDS;

            if !batch.is_empty() && (prekroci_delku || prekroci_time) {
                output.push(Caption {
                    start,
                    end: *time,
                    text: wrap_caption(&batch.join(" ")),
                });
                batch.clear();
                duration = 0;
                start = *time;
            }
            // The space only counts between words, not before the first one.
            duration += znaku + if batch.is_empty() { 0 } else { 1 };
            batch.push(word);
        }
        if !batch.is_empty() {
            output.push(Caption {
                start,
                end: s.end.max(start),
                text: wrap_caption(&batch.join(" ")),
            });
        }
    }
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
