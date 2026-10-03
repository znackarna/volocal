//! What both terminal programs share: the window's dictionaries read for
//! the engine's messages, the clock the window writes times with, and the
//! window's rule for the order of a run's phases.
//!
//! Lives in `volocal-cli`'s folder and is included by `volocal-tui` with
//! `#[path]`: it belongs to neither program alone, and the engine — which
//! would have been the other home — never says anything in words.

use std::collections::HashMap;
use std::sync::OnceLock;
use volocal_lib::user_message::UserMessage;

/// The two languages the terminal programs speak to a person.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    Cs,
}

pub fn short(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

/// A length as the window writes it, `0:14` or `1:12:34`.
pub use volocal_lib::export::format_duration as clock;

/// A message from the engine in the words the window would use.
///
/// The engine returns codes, and the text for them lives in the window's
/// dictionary. Reading the English half of that dictionary here, rather than
/// writing a second set of sentences, keeps one text per message for both
/// programs — the same reason the window's notices are never written in Rust.
pub fn describe(message: UserMessage) -> String {
    fill(english_errors().get(message.code.as_str()), &message)
}

/// A step of a running transcription, from the window's progress dictionary.
/// A failure arrives through the same event, so a code that is not a step is
/// looked up among the errors.
pub fn tell(message: &UserMessage) -> String {
    let template = english_progress()
        .get(message.code.as_str())
        .or_else(|| english_errors().get(message.code.as_str()));
    fill(template, message)
}

/// The same in the reader's language. Czech is the window's source language,
/// so its dictionary has every code; English falls back to the code as above.
pub fn describe_in(lang: Lang, message: &UserMessage) -> String {
    match lang {
        Lang::En => describe(message.clone()),
        Lang::Cs => fill(czech_errors().get(message.code.as_str()), message),
    }
}

pub fn tell_in(lang: Lang, message: &UserMessage) -> String {
    match lang {
        Lang::En => tell(message),
        Lang::Cs => {
            let template = czech_progress()
                .get(message.code.as_str())
                .or_else(|| czech_errors().get(message.code.as_str()));
            fill(template, message)
        }
    }
}

pub fn fill(template: Option<&String>, message: &UserMessage) -> String {
    let template = template.cloned().unwrap_or_else(|| message.code.clone());
    let mut text = template.clone();
    for (key, value) in &message.params {
        text = text.replace(&format!("{{{key}}}"), value);
    }
    if !message.detail.is_empty() && !template.contains("{detail}") {
        text = format!("{text} ({})", message.detail);
    }
    text
}

pub fn english_errors() -> &'static HashMap<String, String> {
    static ERRORS: OnceLock<HashMap<String, String>> = OnceLock::new();
    ERRORS.get_or_init(|| {
        parse_dictionary(
            include_str!("../../../../src/locales/en/errors.ts"),
            "errors",
        )
    })
}

pub fn english_progress() -> &'static HashMap<String, String> {
    static PROGRESS: OnceLock<HashMap<String, String>> = OnceLock::new();
    PROGRESS.get_or_init(|| {
        parse_dictionary(
            include_str!("../../../../src/locales/en/progress.ts"),
            "progress",
        )
    })
}

/// Czech is the source language, so its files carry a second table under the
/// first — `csErrorsContext`, the notes for the translator, under the same
/// keys. Only the first table is the text.
pub fn czech_errors() -> &'static HashMap<String, String> {
    static ERRORS: OnceLock<HashMap<String, String>> = OnceLock::new();
    ERRORS.get_or_init(|| {
        parse_dictionary(
            first_table(include_str!("../../../../src/locales/cs/errors.ts")),
            "errors",
        )
    })
}

pub fn czech_progress() -> &'static HashMap<String, String> {
    static PROGRESS: OnceLock<HashMap<String, String>> = OnceLock::new();
    PROGRESS.get_or_init(|| {
        parse_dictionary(
            first_table(include_str!("../../../../src/locales/cs/progress.ts")),
            "progress",
        )
    })
}

/// A dictionary file up to its second `export`.
pub fn first_table(source: &str) -> &str {
    let Some(first) = source.find("export const") else {
        return source;
    };
    match source[first + 1..].find("export const") {
        Some(second) => &source[..first + 1 + second],
        None => source,
    }
}

/// `"errors.x.y": "text",` — and a value may be split over lines and joined with
/// `+`. Only the code after the prefix is kept, which is what the engine names.
pub fn parse_dictionary(source: &str, prefix: &str) -> HashMap<String, String> {
    let entry = regex::Regex::new(&format!(
        r#"(?s)"{prefix}\.([a-z0-9_.]+)"\s*:\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)"#
    ))
    .expect("the pattern is fixed");
    let piece = regex::Regex::new(r#""((?:[^"\\]|\\.)*)""#).expect("the pattern is fixed");
    entry
        .captures_iter(source)
        .map(|c| {
            let value: String = piece
                .captures_iter(&c[2])
                .map(|p| p[1].replace("\\\"", "\"").replace("\\\\", "\\"))
                .collect();
            (c[1].to_string(), value)
        })
        .collect()
}

/// The order the pipeline goes through, from `src/app/useTranscriptionRuntime.ts`.
/// A report from a phase earlier than the one shown is late, not a step back.
const PHASE_ORDER: [&str; 8] = [
    "queued",
    "preparation",
    "playback",
    "second_language_question",
    "transcription",
    "diarization",
    "saving",
    "second_language",
];
const FINAL_PHASES: [&str; 3] = ["complete", "error", "cancelled"];

/// Should this report replace the one shown? The window's rule, ported with
/// its test: progress arrives from several threads, and a late report must
/// not throw the line back a step.
pub fn keeps_moving_forward(previous: Option<(&str, u64)>, next: (&str, u64)) -> bool {
    let Some((before_phase, before_percent)) = previous else {
        return true;
    };
    if FINAL_PHASES.contains(&before_phase) || FINAL_PHASES.contains(&next.0) {
        return true;
    }
    let position = |phase: &str| PHASE_ORDER.iter().position(|p| *p == phase);
    match (position(before_phase), position(next.0)) {
        (Some(before), Some(after)) if after != before => after > before,
        (Some(_), Some(_)) => next.1 >= before_percent,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cases of `src/app/phaseOrder.test.ts`.
    #[test]
    fn a_late_report_does_not_move_the_run_back() {
        assert!(keeps_moving_forward(None, ("preparation", 0)));
        assert!(!keeps_moving_forward(
            Some(("transcription", 40)),
            ("preparation", 5)
        ));
        assert!(keeps_moving_forward(
            Some(("second_language_question", 8)),
            ("transcription", 10)
        ));
        assert!(!keeps_moving_forward(
            Some(("transcription", 40)),
            ("transcription", 39)
        ));
        assert!(keeps_moving_forward(
            Some(("saving", 90)),
            ("second_language", 2)
        ));
        assert!(keeps_moving_forward(Some(("complete", 100)), ("queued", 0)));
        assert!(keeps_moving_forward(
            Some(("transcription", 50)),
            ("cancelled", 0)
        ));
        assert!(keeps_moving_forward(
            Some(("something_new", 50)),
            ("preparation", 0)
        ));
    }
}
