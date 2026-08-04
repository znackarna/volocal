//! Messages the interface shows to the user.

use std::collections::BTreeMap;

/// A message the interface shows to the user.
///
/// Rust does not know the active language, so it never sends a finished
/// sentence. It sends a stable code plus the values that belong in it; the
/// interface looks the code up in its dictionary. `detail` carries the
/// technical text for cases the dictionary does not cover yet, so a new
/// failure is never shown as a blank message.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UserMessage {
    pub code: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
    pub detail: String,
}

/// Code used when nothing more specific is known. The dictionary has no entry
/// for it on purpose: the interface then falls back to `detail`.
pub const UNKNOWN: &str = "unknown";

impl UserMessage {
    pub fn new(code: impl Into<String>) -> Self {
        UserMessage {
            code: code.into(),
            params: BTreeMap::new(),
            detail: String::new(),
        }
    }

    /// Adds one value the dictionary entry can interpolate.
    pub fn with(mut self, key: impl Into<String>, value: impl std::fmt::Display) -> Self {
        self.params.insert(key.into(), value.to_string());
        self
    }

    /// Technical text shown when the dictionary has no entry for the code.
    pub fn detail(mut self, detail: impl std::fmt::Display) -> Self {
        self.detail = detail.to_string();
        self
    }

    /// Anything that can be printed, reported without a code of its own.
    pub fn unknown(error: impl std::fmt::Display) -> Self {
        UserMessage::new(UNKNOWN).detail(error)
    }

    /// Stored form for the `nahravky.chyba` column. Archives written by older
    /// versions hold a finished Czech sentence there, which the interface still
    /// prints as it is; anything stored from now on is a message it can
    /// translate.
    pub fn to_stored(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| self.detail.clone())
    }
}

impl std::fmt::Display for UserMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.detail.is_empty() {
            write!(f, "{}", self.code)
        } else {
            write!(f, "{}: {}", self.code, self.detail)
        }
    }
}

/// Keeps `?` working on the `anyhow` results the pipeline is built from. The
/// whole chain of causes goes into `detail`, so a failure nobody has given a
/// code to yet still says something useful.
impl From<anyhow::Error> for UserMessage {
    fn from(error: anyhow::Error) -> Self {
        UserMessage::unknown(format!("{error:#}"))
    }
}

macro_rules! unknown_from {
    ($($type:ty),* $(,)?) => {
        $(
            impl From<$type> for UserMessage {
                fn from(error: $type) -> Self {
                    UserMessage::unknown(error)
                }
            }
        )*
    };
}

// Errors raised by the standard library and by dependencies inside functions
// that report to the window. They carry no code of their own, only a detail.
unknown_from!(
    std::io::Error,
    serde_json::Error,
    reqwest::Error,
    rusqlite::Error,
    zip::result::ZipError,
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_uncoded_failure_keeps_its_text_under_the_unknown_code() {
        let error = anyhow::anyhow!("disk is full")
            .context("could not write the archive")
            .context("backup failed");

        let message = UserMessage::from(error);

        assert_eq!(message.code, "unknown");
        assert_eq!(
            message.detail,
            "backup failed: could not write the archive: disk is full"
        );
        assert!(message.params.is_empty());
    }

    #[test]
    fn a_coded_message_carries_its_values() {
        let message = UserMessage::new("download.failed")
            .with("component", "ffmpeg")
            .detail("404");

        assert_eq!(message.code, "download.failed");
        assert_eq!(
            message.params.get("component").map(String::as_str),
            Some("ffmpeg")
        );
        assert_eq!(message.detail, "404");
    }
}
