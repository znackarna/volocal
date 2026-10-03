//! The commands' output for a person at a terminal.
//!
//! Each function here is the twin of one in `main.rs` and is called instead
//! of it only when `Look::of` says the stream is a terminal. The plain one is
//! left exactly as it was, so what a script reads cannot drift; this one may
//! say the same things in the reader's language and lay them out.

use crate::look::{self, Look, Role};
use crate::{clock, short};
use std::path::Path;
use volocal_lib::db::{self, Recording, SearchResult, Speaker};
use volocal_lib::tools::ToolCheck;

/// A recording's state as a mark, and as words in a colour.
fn state(look: &Look, status: &str) -> (String, String) {
    let words = look.words();
    let glyphs = look.glyphs();
    match status {
        db::status::DONE => (
            look::paint(Role::Success, glyphs.done),
            look::paint(Role::Success, words.state_done),
        ),
        db::status::TRANSCRIBING => (
            // `list` prints once, so the mill stands still in its middle frame.
            look::paint(Role::Accent, glyphs.mill[glyphs.mill.len() / 2].trim()),
            look::paint(Role::Accent, words.state_transcribing),
        ),
        db::status::FAILED => (
            look::paint(Role::Danger, glyphs.failed),
            look::paint(Role::Danger, words.state_failed),
        ),
        _ => (
            look::paint(Role::Muted, glyphs.new),
            look::paint(Role::Muted, words.state_new),
        ),
    }
}

fn speaker_names(speakers: &[Speaker]) -> String {
    speakers
        .iter()
        .map(|s| look::paint(look::speaker_role(&s.color), &s.name))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `list`: one row per recording, the columns lined up, and the archive's
/// size at the foot.
pub fn list(look: &Look, connection: &rusqlite::Connection, shown: &[&Recording]) -> String {
    let words = look.words();
    let lang = look.lang;
    if shown.is_empty() {
        return format!("  {}\n", words.no_recordings);
    }
    let dates: Vec<String> = shown
        .iter()
        .map(|r| look::date(lang, &r.created_at))
        .collect();
    let date_width = dates
        .iter()
        .map(|d| d.chars().count())
        .max()
        .unwrap_or(10)
        .max(words.col_date.len());
    let lengths: Vec<String> = shown.iter().map(|r| clock(r.duration)).collect();
    let length_width = lengths
        .iter()
        .map(String::len)
        .max()
        .unwrap_or(5)
        .max(words.col_length.chars().count());

    let metas: Vec<String> = shown
        .iter()
        .map(|r| {
            if r.status != db::status::DONE {
                return state(look, &r.status).1;
            }
            let speakers = db::speakers(connection, &r.id)
                .map(|s| s.len())
                .unwrap_or(0);
            let mut parts = Vec::new();
            if speakers > 0 {
                parts.push(look::count(lang, speakers as i64, words.speakers));
            }
            if !r.language.is_empty() {
                parts.push(r.language.clone());
            }
            look::paint(Role::Muted, &parts.join(" · "))
        })
        .collect();
    let meta_width = metas.iter().map(|m| look::cells(m)).max().unwrap_or(0);
    // What is left of the line goes to the title, which is cut before the
    // rest is.
    let fixed = 2 + 8 + 2 + date_width + 2 + length_width + 2 + 2 + 2 + meta_width;
    let longest = shown
        .iter()
        .map(|r| r.title.chars().count())
        .max()
        .unwrap_or(0);
    let title_width = longest.min(look.width.saturating_sub(fixed + 1)).max(12);

    let mut out = String::new();
    out.push_str(&look::paint(
        Role::Muted,
        &format!(
            "  {}  {}  {}    {}\n",
            look::pad(words.col_id, 8),
            look::pad(words.col_date, date_width),
            look::pad_left(words.col_length, length_width),
            words.col_title
        ),
    ));
    let mut total = 0.0;
    for (i, recording) in shown.iter().enumerate() {
        total += recording.duration;
        let (mark, _) = state(look, &recording.status);
        let title = look::cut(&recording.title, title_width, look.glyphs().ellipsis);
        out.push_str(&format!(
            "  {}  {}  {}  {}  {}  {}\n",
            look::paint(Role::Muted, short(&recording.id)),
            look::paint(Role::Muted, &look::pad(&dates[i], date_width)),
            look::paint(Role::Bold, &look::pad_left(&lengths[i], length_width)),
            look::pad(&mark, 2).trim_end(),
            look::pad(&title, title_width),
            metas[i]
        ));
    }
    out.push('\n');
    out.push_str(&look::paint(
        Role::Muted,
        &format!(
            "  {} · {}\n",
            look::count(lang, shown.len() as i64, words.recordings),
            look::span(total)
        ),
    ));
    out
}

/// `list --search`: the hits under their recording, in the order the
/// archive ranked them, the match in the window's amber.
pub fn search(look: &Look, hits: &[SearchResult]) -> String {
    let words = look.words();
    let lang = look.lang;
    if hits.is_empty() {
        return format!("  {}\n", words.nothing_found);
    }
    let mut order: Vec<&str> = Vec::new();
    for hit in hits {
        if !order.contains(&hit.recording_id.as_str()) {
            order.push(&hit.recording_id);
        }
    }
    let mut out = String::new();
    for id in &order {
        let mine: Vec<&SearchResult> = hits.iter().filter(|h| h.recording_id == *id).collect();
        out.push_str(&format!(
            "  {}  {}\n",
            look::paint(Role::Bold, &mine[0].title),
            look::paint(Role::Muted, short(id))
        ));
        for hit in mine {
            out.push_str(&format!(
                "    {}  {}\n",
                look::paint(Role::Muted, &look::pad_left(&clock(hit.start), 7)),
                look::hits(hit.text.trim())
            ));
        }
        out.push('\n');
    }
    out.push_str(&look::paint(
        Role::Muted,
        &format!(
            "  {} · {}\n",
            look::count(lang, hits.len() as i64, words.hits),
            look::count(lang, order.len() as i64, words.recordings)
        ),
    ));
    out
}

/// `show`: the same fields as the plain one, labels in a quiet column.
pub fn show(look: &Look, recording: &Recording, speakers: &[Speaker]) -> String {
    let words = look.words();
    let lang = look.lang;
    let mut rows: Vec<(&str, String)> = vec![
        (words.label_id, recording.id.clone()),
        (words.label_title, look::paint(Role::Bold, &recording.title)),
        (words.label_file, recording.path.clone()),
        (words.label_recorded, {
            let day = look::date(lang, &recording.created_at);
            match recording.created_at.get(11..16) {
                Some(time) if recording.created_at.len() >= 16 => format!("{day}  {time}"),
                _ => day,
            }
        }),
        (words.label_length, clock(recording.duration)),
        (words.label_status, {
            let (mark, said) = state(look, &recording.status);
            format!("{mark} {said}")
        }),
    ];
    if !recording.language.is_empty() {
        rows.push((words.label_language, recording.language.clone()));
    }
    if !recording.model.is_empty() {
        rows.push((words.label_model, recording.model.clone()));
    }
    rows.push((
        words.label_blocks,
        look::number(lang, recording.segment_count),
    ));
    if !speakers.is_empty() {
        rows.push((words.label_speakers, speaker_names(speakers)));
    }
    if let Some(url) = &recording.source_url {
        rows.push((words.label_source, url.clone()));
    }
    if let Some(error) = &recording.error {
        rows.push((words.label_error, look::paint(Role::Danger, error)));
    }
    let width = rows
        .iter()
        .map(|(label, _)| label.chars().count())
        .max()
        .unwrap_or(0)
        + 2;
    rows.iter()
        .map(|(label, value)| {
            format!(
                "  {}{value}\n",
                look::paint(Role::Muted, &look::pad(label, width))
            )
        })
        .collect()
}

/// `status`: a checklist of what transcription needs, then whether it can run.
pub fn status(look: &Look, archive: &Path, check: &ToolCheck, issues: &[String]) -> String {
    let words = look.words();
    let glyphs = look.glyphs();
    let found = |value: &Option<String>| match value {
        Some(path) => (look::paint(Role::Success, glyphs.done), path.clone()),
        None => (
            look::paint(Role::Warning, glyphs.warning),
            look::paint(Role::Warning, words.missing),
        ),
    };
    let compute = match check.compute.as_str() {
        "cuda" => words.compute_cuda.to_string(),
        "vulkan" => words.compute_vulkan.to_string(),
        "cpu" => words.compute_cpu.to_string(),
        other => other.to_string(),
    };
    let mut rows: Vec<(String, &str, String)> = vec![(
        " ".into(),
        words.label_archive,
        archive.display().to_string(),
    )];
    let (mark, value) = found(&check.ffmpeg);
    rows.push((mark, words.label_ffmpeg, value));
    let (mark, value) = found(&check.whisper_cli);
    rows.push((mark, words.label_whisper, value));
    let (mark, value) = found(&check.model_whisper_id);
    rows.push((mark, words.label_model, value));
    rows.push((" ".into(), words.label_runs_on, compute));
    if let Some(gigabytes) = check.memory_gb {
        rows.push((" ".into(), words.label_memory, format!("{gigabytes} GB")));
    }
    let width = rows
        .iter()
        .map(|(_, label, _)| label.chars().count())
        .max()
        .unwrap_or(0)
        + 2;
    let mut out: String = rows
        .iter()
        .map(|(mark, label, value)| {
            format!(
                "  {} {}{value}\n",
                look::pad(mark, 1),
                look::paint(Role::Muted, &look::pad(label, width))
            )
        })
        .collect();
    out.push('\n');
    if issues.is_empty() {
        out.push_str(&format!(
            "  {} {}\n",
            look::paint(Role::Success, glyphs.done),
            look::paint(Role::Bold, words.ready)
        ));
    } else {
        out.push_str(&format!(
            "  {} {}\n",
            look::paint(Role::Warning, glyphs.warning),
            look::paint(Role::Bold, words.not_ready)
        ));
        for issue in issues {
            out.push_str(&format!("    {}\n", look::paint(Role::Warning, issue)));
        }
    }
    out
}

/// What `export` and `export-audio` print when their output is a terminal:
/// the path, said to be saved. A script reading the output gets the bare
/// path, from the plain code.
pub fn saved(look: &Look, target: &Path) -> String {
    format!(
        "  {} {}  {}\n",
        look::paint(Role::Success, look.glyphs().done),
        look.words().saved,
        target.display()
    )
}

/// The end of a transcription, in place of the live block.
pub struct Summary<'a> {
    pub took: f64,
    pub recording: &'a Recording,
    pub speakers: usize,
    pub second_language: Option<&'a str>,
    pub phases: &'a [(String, std::time::Duration)],
}

pub fn summary(look: &Look, s: &Summary) -> String {
    let words = look.words();
    let lang = look.lang;
    let mut headline = format!("{} {}", words.transcribed_in, clock(s.took));
    if s.took > 0.0 {
        let speed = s.recording.duration / s.took;
        if speed >= 1.2 {
            let shown = if speed < 10.0 {
                format!("{speed:.1}")
            } else {
                format!("{speed:.0}")
            };
            let shown = if lang == look::Lang::Cs {
                shown.replace('.', ",")
            } else {
                shown
            };
            headline.push_str(&format!(", {shown}× {}", words.faster));
        }
    }
    let mut meta = vec![look::count(lang, s.recording.segment_count, words.blocks)];
    if s.speakers > 0 {
        meta.push(look::count(lang, s.speakers as i64, words.speakers));
    }
    let mut languages = s.recording.language.clone();
    if let Some(second) = s.second_language {
        languages = format!("{languages} + {second} ({})", words.second_language_added);
    }
    if !languages.is_empty() {
        meta.push(languages);
    }
    if !s.recording.model.is_empty() {
        meta.push(s.recording.model.clone());
    }
    let phases: Vec<String> = s
        .phases
        .iter()
        .map(|(label, took)| format!("{label} {}", clock(took.as_secs_f64())))
        .collect();
    let mut out = format!(
        "\n  {} {}\n    {}\n",
        look::paint(Role::Success, look.glyphs().done),
        look::paint(Role::Bold, &headline),
        look::paint(Role::Muted, &meta.join(" · "))
    );
    if !phases.is_empty() {
        out.push_str(&format!(
            "    {}\n",
            look::paint(Role::Muted, &phases.join(" · "))
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::look::{Lang, CS};

    fn plain(text: &str) -> String {
        regex::Regex::new("\x1b\\[[0-9;]*[A-Za-z]")
            .unwrap()
            .replace_all(text, "")
            .into_owned()
    }

    fn czech() -> Look {
        Look {
            lang: Lang::Cs,
            ascii: false,
            width: 100,
        }
    }

    fn recording(title: &str, status: &str, duration: f64) -> Recording {
        serde_json::from_value(serde_json::json!({
            "id": "3f9c2a17-5c2a-4f8e-b1d3-9a6e2c4f0b18",
            "path": "C:\\Users\\jana\\porada.m4a",
            "title": title,
            "duration": duration,
            "created_at": "2026-10-03T09:14:00",
            "status": status,
            "model": "large-v3-turbo",
            "language": "cs",
            "language_choice": "",
            "second_language_choice": "",
            "second_language_by_reader": false,
            "error": null,
            "segment_count": 538,
            "folder": null,
            "source_url": null,
        }))
        .expect("a recording as the archive keeps it")
    }

    #[test]
    fn the_summary_says_what_was_done() {
        let r = recording("Rozhovor", db::status::DONE, 2292.0);
        let phases = vec![
            (
                "Převádím zvuk".to_string(),
                std::time::Duration::from_secs(6),
            ),
            ("Přepisuji".to_string(), std::time::Duration::from_secs(161)),
        ];
        let text = plain(&summary(
            &czech(),
            &Summary {
                took: 192.0,
                recording: &r,
                speakers: 2,
                second_language: Some("en"),
                phases: &phases,
            },
        ));
        assert!(
            text.contains("✓ Přepsáno za 3:12, 12× rychleji, než nahrávka trvá"),
            "{text}"
        );
        assert!(
            text.contains("538 úseků · 2 mluvčí · cs + en (doplněno) · large-v3-turbo"),
            "{text}"
        );
        assert!(
            text.contains("Převádím zvuk 0:06 · Přepisuji 2:41"),
            "{text}"
        );
    }

    #[test]
    fn show_keeps_the_fields_and_names_them_in_czech() {
        let r = recording("Porada vedení — rozpočet 2027", db::status::DONE, 3138.0);
        let speakers = vec![Speaker {
            key: "a".into(),
            recording_id: r.id.clone(),
            name: "Jana Bílá".into(),
            color: db::COLORS[0].into(),
        }];
        let text = plain(&show(&czech(), &r, &speakers));
        for wanted in [
            "název",
            "Porada vedení",
            "52:18",
            "✓ přepsaná",
            "3.\u{a0}10.\u{a0}2026  09:14",
            "538",
            "Jana Bílá",
        ] {
            assert!(text.contains(wanted), "{wanted:?} in {text}");
        }
    }

    #[test]
    fn search_groups_the_hits_under_their_recording() {
        let hit = |id: &str, title: &str, start: f64| SearchResult {
            recording_id: id.into(),
            title: title.into(),
            segment_id: "s".into(),
            start,
            text: "…navrhuji, aby se <<rozpočet>> držel…".into(),
        };
        let hits = vec![
            hit("aaaaaaaa1", "Porada", 761.0),
            hit("bbbbbbbb2", "Přednáška", 10.0),
            hit("aaaaaaaa1", "Porada", 800.0),
        ];
        let text = plain(&search(&czech(), &hits));
        assert_eq!(text.matches("Porada").count(), 1, "{text}");
        assert!(text.contains("3 výsledky · 2 nahrávky"), "{text}");
    }

    #[test]
    fn an_empty_list_says_so() {
        assert_eq!(
            plain(&search(&czech(), &[])),
            format!("  {}\n", CS.nothing_found)
        );
    }
}
