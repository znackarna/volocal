//! Persistent storage backed by one SQLite file in the application data directory.
//! FTS5 provides full-text search across the transcript archive.

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::user_message::UserMessage;

/// A transaction, unless the caller already holds one.
///
/// SQLite has no nested transactions: a `BEGIN` inside a `BEGIN` fails with
/// *cannot start a transaction within a transaction*, and because a
/// `Transaction` derefs to a `Connection` the nesting compiles perfectly and
/// only shows up when somebody presses the button.
///
/// Which is what happened. Deleting a folder together with its recordings is
/// one errand, so the command wraps it in a transaction — and then called
/// `delete_folder`, which opened its own. Both halves were right on their own.
///
/// Every function here that wants both-or-neither has to work standalone *and*
/// inside a larger errand, so each asks only when nobody else has. `commit` on
/// `None` is nothing: the caller's transaction is still open and still owns the
/// decision to keep the work or drop it.
fn transaction_unless_in_one(db: &Connection) -> Result<Option<Transaction<'_>>> {
    Ok(if db.is_autocommit() {
        Some(db.unchecked_transaction()?)
    } else {
        None
    })
}

/// Commits what `transaction_unless_in_one` handed back, if anything.
fn commit(tx: Option<Transaction<'_>>) -> Result<()> {
    if let Some(tx) = tx {
        tx.commit()?;
    }
    Ok(())
}

// ---------------------------------------------------------------- data types

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Recording {
    pub id: String,
    pub path: String,
    pub title: String,
    pub duration: f64,
    pub created_at: String,
    /// One of [`status`]. Czech until schema 3 — see `rename_statuses_to_english`.
    pub status: String,
    pub model: String,
    /// Language code the transcript actually ran in. With automatic
    /// detection, the one Whisper recognised.
    pub language: String,
    /// Language requested for this recording. Empty means the application's
    /// own setting; "auto" means let Whisper recognise it.
    pub language_choice: String,
    /// A second language the reader says this recording holds, as a code.
    ///
    /// Empty means nobody said so. When it is set, the end of every
    /// transcription writes that language in from the stretches the first pass
    /// left empty, without asking — and the sweep for one never runs, because
    /// the answer is already known. A standing fact about the recording, like
    /// `language_choice`, and kept beside it for the same reason.
    pub second_language_choice: String,
    pub error: Option<String>,
    pub segment_count: i64,
    /// The folder holding this recording; `None` is the archive's root.
    pub folder: Option<String>,
    /// The address the audio was fetched from, for a recording that came in
    /// through an online import.
    ///
    /// `None` means the origin is not known, and that covers two different
    /// recordings: one opened from a file, which never had a web address, and
    /// one imported online before this column existed, whose address was
    /// discarded the moment the download finished. Neither can be told from
    /// the other afterwards, and nothing here invents a link for either.
    pub source_url: Option<String>,
    /// The language that has actually been written into this transcript beside
    /// its own, when a fill has run — read from the fill's own record, so it
    /// says what is in the text rather than what somebody asked for.
    pub second_language: Option<String>,
}

/// A folder in the archive, with what it holds. The two totals come from the
/// same query, because a card that says nothing about its contents is a card
/// nobody can decide anything from.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub recording_count: i64,
    pub duration: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Segment {
    pub id: String,
    pub recording_id: String,
    pub order: i64,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speakers: Option<String>,
    pub confidence: Option<f64>,
    pub edited: bool,
    /// A low-confidence segment a human has signed off as correct.
    pub verified: bool,
    /// Per-word timings as JSON `[{"t":1.23,"s":"word"}]`. Whisper knows
    /// them, so there is no reason to guess them from the text length.
    pub words: Option<String>,
    /// What the machine wrote here, kept from the first manual rewrite.
    /// `None` for a segment nobody has touched — and for one edited before
    /// the column existed.
    pub original: Option<String>,
    /// Which language this block was transcribed in, when it is not the
    /// recording's own.
    ///
    /// `None` means the recording's language, which is every block of every
    /// transcript written before this existed. It is set only by the
    /// second-language pass, so what it really answers is *did this sentence
    /// come from the fill* — which is what keeps a second fill from writing
    /// the same sentences twice.
    pub language: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct WaveformData {
    pub points: Vec<u8>,
    pub points_per_second: f64,
    pub equalizer: Vec<u8>,
    pub equalizer_points_per_second: f64,
    pub equalizer_band_count: usize,
}

/// VAD keeps segment offsets on the original audio timeline, but some
/// whisper.cpp versions report token offsets on the silence-compressed
/// timeline. The difference accumulates throughout a recording. Preserve the
/// spacing between tokens and move the whole sequence back to its segment.
///
/// Only a shift, deliberately.
///
/// Stretching the words to fill the segment's real span was tried and had to
/// be taken out again. It rests on the words filling the segment, and they do
/// not: VAD pads every segment with a quarter second of silence at each end,
/// and whisper's segment end sits past the final word anyway. Stretching to
/// the end therefore pushed everything late, and any sentence starting in the
/// middle of a segment took its timestamp with it — the one thing that had
/// always been reliable.
///
/// Moving the sequence keeps one thing true and claims nothing more: the first
/// word starts where the segment starts. Whatever drift remains inside is
/// smaller than the error introduced by guessing.
pub fn align_word_timestamps(segment: &mut Segment) {
    let Some(serialized) = segment.words.as_deref() else {
        return;
    };
    let Ok(mut words) = serde_json::from_str::<Vec<serde_json::Value>>(serialized) else {
        return;
    };
    let Some(first_time) = words.iter().find_map(|word| word["t"].as_f64()) else {
        return;
    };

    let shift = segment.start - first_time;
    if shift <= 0.0 {
        return;
    }

    let upper_bound = segment.end.max(segment.start);
    for word in &mut words {
        let Some(time) = word["t"].as_f64() else {
            continue;
        };
        let aligned = (time + shift).clamp(segment.start, upper_bound);
        word["t"] = serde_json::json!((aligned * 1000.0).round() / 1000.0);
    }

    if let Ok(serialized) = serde_json::to_string(&words) {
        segment.words = Some(serialized);
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Speaker {
    pub key: String,
    pub recording_id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RecordingNote {
    pub id: String,
    pub recording_id: String,
    /// Where in the recording the note belongs, when it belongs anywhere.
    /// A note about the recording as a whole has none.
    pub time: Option<f64>,
    pub text: String,
    pub done: bool,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DictionaryEntry {
    pub id: String,
    pub find: String,
    pub replace: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    #[serde(alias = "bin_slozka")]
    pub bin_directory: String,
    #[serde(alias = "modely_slozka")]
    pub models_directory: String,
    /// Optional directory polled for newly added media files while the app is
    /// running. Empty and disabled by default, so upgrades never start an
    /// import without an explicit choice.
    #[serde(default)]
    pub watch_folder: String,
    #[serde(default)]
    pub watch_folder_enabled: bool,
    /// Start transcribing what the watched folder finds, instead of offering
    /// it in the Archive. Off by default: an upgrade must not start work
    /// nobody asked for.
    #[serde(default)]
    pub watch_folder_auto: bool,
    /// Where the application keeps audio it owns: microphone takes, the sound
    /// pulled out of an online video, and — when `copy_imports` asks for it —
    /// a copy of every file added by hand.
    ///
    /// Configurable because the default is inside `%APPDATA%`, which nobody
    /// browses to. A take from the microphone exists nowhere else, so it must
    /// be somewhere its owner can find it. Empty means the default place.
    #[serde(default)]
    pub recording_folder: String,
    /// Copy a file that is added by hand into that folder, instead of leaving
    /// it where it is and remembering the path. Off by default: it doubles the
    /// disk a recording costs, and that is the owner's decision, not ours.
    #[serde(default)]
    pub copy_imports: bool,
    /// Look for a newer Volocal when the window opens, instead of only when the
    /// button on the About page is pressed.
    ///
    /// Off by default, and the default is the promise: an application that
    /// says nothing leaves this computer must not start asking a server about
    /// itself because somebody upgraded. Turning it on is a choice, and it
    /// only ever asks — nothing is downloaded or installed without a press.
    #[serde(default)]
    pub update_check_automatic: bool,
    /* An `update_checked_at` was added here and taken out again the same day.
    The moment of the last check is on screen, but it is not a setting: nobody
    chose it, no Rust reads it, and a settings record travels — into a portable
    copy, out to a backup and back again — so a restored archive would have
    claimed a check that never happened on the machine reading it. It lives in
    `localStorage` now (`types.ts`, `UPDATE_CHECKED_AT`), which also keeps it
    out of the write that raises the *Uloženo* confirmation.

    The rule that came out of it, and the reason this note is here rather than
    in a commit message: this struct holds what the reader decided. Saving it
    is confirmed on screen because a decision was made. Anything the
    application notes down for itself does not belong in it. */
    pub model: String,
    /// The answer to the only question the first run asks: `fast` or
    /// `accurate`. Everything that has a fast and an accurate side follows
    /// from it — the transcription model the wizard downloads, and the size of
    /// the language-editing model offered later — so that nothing asks a
    /// second time.
    ///
    /// Empty means nobody has been asked, which is every installation set up
    /// before 14 August 2026. It is deliberately not guessed here: the window
    /// reads it against `model`, which is what the same question produced on
    /// those machines. Serde default rather than a named one, so an older
    /// settings record still loads.
    #[serde(default)]
    pub quality_choice: String,
    /// Optional local language-editing model. Empty means that the feature was
    /// skipped and no background model is downloaded or loaded.
    #[serde(default)]
    pub editor_model: String,
    /// Listen, at the end of every transcription, for a language the transcript
    /// does not have, and offer to write it in.
    ///
    /// Off by default. It costs a few seconds on every run and answers a
    /// question most recordings never raise — and when the reader already knows
    /// a recording holds two languages, naming them on the recording is both
    /// cheaper and surer than listening for them. Serde default, so a settings
    /// record written before this existed still loads.
    #[serde(default)]
    pub detect_second_language: bool,
    /// The instruction last written for a custom-prompt document.
    ///
    /// One per installation, not one per recording: it says how this person
    /// wants documents made — minutes with tasks, questions and answers, a
    /// letter — and the recording they open tomorrow is where they want the
    /// same thing again. The results are kept per recording and keyed by the
    /// instruction that made them; this is only what the field is filled with
    /// when the dialog opens, so nobody has to remember their own wording.
    ///
    /// Empty means nobody has written one. Serde default, so a settings record
    /// written before 14 August 2026 still loads.
    #[serde(default)]
    pub custom_prompt: String,
    #[serde(alias = "jazyk")]
    pub language: String,
    /// Kept so that a settings file written before 13 August 2026 still loads,
    /// and read by nothing: `whisper.rs` passes `--vad` unconditionally. Off
    /// was the documented cause of Whisper repeating one token over silence,
    /// so it was never a choice worth offering.
    pub vad: bool,
    #[serde(alias = "vad_prah")]
    pub vad_threshold: f64,
    #[serde(alias = "diarizace")]
    pub diarization: bool,
    /// 0 means decide automatically.
    #[serde(alias = "pocet_mluvcich")]
    pub speaker_count: i64,
    #[serde(alias = "prah_shluku")]
    pub cluster_threshold: f64,
    /// How far the segmentation window moves, as a share of its own length.
    /// Sherpa's default is 0.1 — a ninety per cent overlap, the most accurate
    /// and the slowest. A larger number means fewer windows and less time, at
    /// the price of coarser boundaries.
    #[serde(default = "default_segmentation_window_shift", alias = "posun_okna")]
    pub segmentation_window_shift: f64,
    pub beam: i64,
    #[serde(alias = "vlakna")]
    pub threads: i64,

    // ------- decoding, tuned
    //
    // The defaults are exactly the ones whisper.cpp uses on its own, so
    // anybody who leaves them alone gets what they always got — which is also
    // why they are not passed on the command line until they are changed.
    /// Above this probability the window is declared silence. Higher is
    /// stricter and more reliably silent, at the risk of losing a quiet word.
    #[serde(default = "default_threshold_silence", alias = "prah_ticha")]
    pub threshold_silence: f64,
    /// Below this average log probability the decoding counts as failed and
    /// is tried again at a higher temperature.
    #[serde(default = "default_threshold_confidence", alias = "prah_jistoty")]
    pub threshold_confidence: f64,
    /// When the output is suspiciously uniform the passage is decoded again.
    /// A lower number is stricter and retries more often.
    #[serde(default = "default_entropy_threshold", alias = "prah_entropie")]
    pub entropy_threshold: f64,
    /// The starting sampling temperature. Zero always takes the likeliest word.
    #[serde(default, alias = "teplota")]
    pub temperature: f64,
    /// How much the temperature rises with each further attempt. Zero turns
    /// the fallback off entirely, leaving nothing to break a loop.
    #[serde(default = "default_temperature_increment", alias = "teplota_krok")]
    pub temperature_increment: f64,
    /// auto | gpu | cpu — where the transcription should compute, plus the two
    /// build names `cuda` and `vulkan` that older settings records may hold.
    ///
    /// The window writes only the first three. `gpu` names the card without
    /// naming a build: which of CUDA and Vulkan suits it is read off the
    /// drivers in `choose_compute`, and asking a reader that question was the
    /// defect the 14 August 2026 rework removed — a stored `cuda` on a machine
    /// with an AMD card silently transcribed on the processor while the screen
    /// said otherwise. The two old values still load and are still honoured
    /// where the machine can run them; `Nástroje` shows them as the card.
    #[serde(default = "default_compute", alias = "vypocet")]
    pub compute: String,
    /// Which machine last did the computing. When it changes we offer to
    /// re-measure performance — the flash drive travels between machines.
    #[serde(default, alias = "posledni_stroj")]
    pub last_machine: String,

    // ------- appearance
    /// system | light | dark. `system` follows the operating system; the other
    /// two are a decision that overrides it. Serde default, so a settings file
    /// written before this existed reads as `system`.
    #[serde(default = "default_theme", alias = "motiv")]
    pub theme: String,
    #[serde(default = "default_font_ui", alias = "pismo_ui")]
    pub font_ui: String,
    #[serde(default = "default_font_text", alias = "pismo_text")]
    pub font_text: String,
    #[serde(default = "default_size", alias = "velikost_textu")]
    pub transcript_font_size: f64,
    #[serde(default = "default_line_height", alias = "radkovani")]
    pub transcript_line_height: f64,
}

fn default_compute() -> String {
    "auto".into()
}
// whisper.cpp's own defaults, copied from examples/cli/cli.cpp. Entropy is the
// one exception — 2.6 rather than 2.4, because on Czech the model looped more
// often than whisper's threshold was willing to catch.
fn default_threshold_silence() -> f64 {
    0.6
}
fn default_threshold_confidence() -> f64 {
    -1.0
}
fn default_entropy_threshold() -> f64 {
    2.6
}
fn default_temperature_increment() -> f64 {
    0.2
}

/// A compromise: twice Sherpa's default tenth of a step. On speech the
/// boundaries move by tenths of a second, which is lost inside a sentence,
/// and the segmentation takes about half the time.
fn default_segmentation_window_shift() -> f64 {
    0.2
}
fn default_theme() -> String {
    "system".into()
}
fn default_font_ui() -> String {
    "geist".into()
}
fn default_font_text() -> String {
    "literata".into()
}
fn default_size() -> f64 {
    17.5
}
fn default_line_height() -> f64 {
    1.72
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            // In portable mode the paths are relative to the program's own
            // folder, so the stick's drive letter does not matter.
            bin_directory: "bin".into(),
            models_directory: "models".into(),
            watch_folder: String::new(),
            watch_folder_enabled: false,
            watch_folder_auto: false,
            recording_folder: String::new(),
            copy_imports: false,
            update_check_automatic: false,
            model: "large-v3".into(),
            // Nobody has been asked yet; the wizard writes it.
            quality_choice: String::new(),
            editor_model: String::new(),
            detect_second_language: false,
            custom_prompt: String::new(),
            language: "auto".into(),
            // Always on: without it Whisper hallucinates over silence.
            vad: true,
            vad_threshold: 0.5,
            diarization: false,
            speaker_count: 0,
            // Sherpa's default is 0.5, and a smaller number means more
            // clusters. On real recordings it turned a conversation between
            // two people into sixteen speakers. At 0.8 the number of handovers
            // fell from 119 to 20 and the share of each voice matched what is
            // audible. The measurements are in docs/history/.
            cluster_threshold: 0.8,
            segmentation_window_shift: default_segmentation_window_shift(),
            beam: 5,
            threads: 0,
            threshold_silence: default_threshold_silence(),
            threshold_confidence: default_threshold_confidence(),
            entropy_threshold: default_entropy_threshold(),
            temperature: 0.0,
            temperature_increment: default_temperature_increment(),
            compute: "auto".into(),
            last_machine: String::new(),
            theme: default_theme(),
            font_ui: default_font_ui(),
            font_text: default_font_text(),
            transcript_font_size: default_size(),
            transcript_line_height: default_line_height(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResult {
    pub recording_id: String,
    pub title: String,
    pub segment_id: String,
    pub start: f64,
    pub text: String,
}

// ---------------------------------------------------------------- schema

/// Tables and columns this archive may still be carrying in Czech, and what
/// each is called now. Order matters only in that a table is renamed before its
/// columns are, because the column statements name the new table.
const RENAMED: &[(&str, &[(&str, &str)])] = &[
    (
        "nahravky recordings",
        &[
            ("cesta", "path"),
            ("nazev", "name"),
            ("delka", "duration"),
            ("vytvoreno", "created_at"),
            ("stav", "status"),
            ("chyba", "error"),
            ("slozka", "folder_id"),
        ],
    ),
    (
        "slozky folders",
        &[("nazev", "name"), ("vytvoreno", "created_at")],
    ),
    (
        "segmenty segments",
        &[
            ("nahravka_id", "recording_id"),
            ("poradi", "position"),
            ("zacatek", "start_time"),
            ("konec", "end_time"),
            ("mluvci", "speakers"),
            ("jistota", "confidence"),
            ("upraveno", "edited"),
            ("slova", "words"),
            ("overeno", "verified"),
            ("puvodni", "original"),
        ],
    ),
    (
        "mluvci speakers",
        &[
            ("klic", "key"),
            ("nahravka_id", "recording_id"),
            ("jmeno", "name"),
            ("barva", "color"),
        ],
    ),
    (
        "poznamky notes",
        &[
            ("nahravka_id", "recording_id"),
            ("cas", "time"),
            ("hotovo", "done"),
            ("vytvoreno", "created_at"),
        ],
    ),
    (
        "slovnik dictionary",
        &[
            ("hledat", "search"),
            ("nahradit", "replacement"),
            ("napoveda", "prompt"),
        ],
    ),
    (
        "krivky waveforms",
        &[
            ("nahravka_id", "recording_id"),
            ("body", "points"),
            ("na_sekundu", "per_second"),
        ],
    ),
    ("klice settings", &[("klic", "key"), ("hodnota", "value")]),
];

/// What this build knows how to read.
///
/// 1 is the Czech schema every archive had until 1.0.5; 2 is the English one.
/// The number is written into the archive so that a build meeting an archive
/// from the future can say so, instead of doing what 1.0.4 did to 1.0.5's:
/// look for the tables it knows, not find them, and quietly make empty ones.
/// The reader is then shown an archive with nothing in it, which is the worst
/// thing this application could tell somebody who has lost nothing at all.
///
/// It cannot fix the builds already out there. It stops the next migration from
/// repeating it.
/// 3 since 13 August 2026, when the four status values stopped being Czech.
const SCHEMA_VERSION: i64 = 3;

/// The key that carries it, in the settings table.
const SCHEMA_VERSION_KEY: &str = "schema-version";

/// What `recordings.status` may say.
///
/// Constants rather than literals scattered over eight files, because these
/// have been renamed once and the rename is not the kind a compiler helps with:
/// a status is a string on both sides of the IPC boundary and in the SQL, so a
/// missed one goes on compiling and simply stops matching. It has happened —
/// `.hotova` became `.done` in the stylesheet in 1.0.5 and every status dot in
/// the archive went grey, with nothing failing anywhere.
///
/// The SQL in this module still writes them literally, because a query is text.
/// `the_stored_statuses_are_the_ones_the_queries_use` is what holds the two
/// together.
pub mod status {
    pub const NEW: &str = "new";
    pub const TRANSCRIBING: &str = "transcribing";
    pub const DONE: &str = "done";
    pub const FAILED: &str = "error";

    /// Czech to English, which is what an archive older than schema 3 needs.
    pub const RENAMED: &[(&str, &str)] = &[
        ("nova", NEW),
        ("prepisuje", TRANSCRIBING),
        ("hotova", DONE),
        ("chyba", FAILED),
    ];
}

/// Raised when the archive was written by a newer Volocal than this one.
///
/// A type of its own because the window has to tell these two apart: a damaged
/// archive asks to be replaced from a backup, and this one asks for nothing but
/// a newer application — the archive is perfectly good and its owner must not
/// be told to start copying files over it.
#[derive(Debug)]
pub struct ArchiveFromTheFuture {
    pub found: i64,
    pub known: i64,
}

impl std::fmt::Display for ArchiveFromTheFuture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "the archive was written by a newer version of Volocal \
             (schema {}, this build knows {})",
            self.found, self.known
        )
    }
}

impl std::error::Error for ArchiveFromTheFuture {}

/// What a file somebody has *offered* as an archive turns out to be.
///
/// [`open`] migrates what it opens, which makes it the wrong tool for asking
/// questions about a file that has only been proposed: answering "can I take
/// this?" must not rewrite the thing being asked about, and must certainly not
/// rewrite it before the reader has agreed to anything.
#[derive(Debug, PartialEq, Eq)]
pub enum Offered {
    /// No archive tables in it. A picture, a document, the wrong `.db`.
    NotAnArchive,
    /// Written by a newer Volocal. Refused rather than migrated backwards: this
    /// build does not know what the newer one put in there, and opening it
    /// would strip whatever that is.
    FromTheFuture { found: i64, known: i64 },
    /// Old or current. `open` migrates an old one on the way in.
    Usable,
}

/// Looks at an offered archive read-only and says which of the three it is.
pub fn look_at_offered_archive(path: &std::path::Path) -> Offered {
    use rusqlite::OpenFlags;
    let Ok(db) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return Offered::NotAnArchive;
    };
    // Both names, because an archive worth importing may predate the rename —
    // that is exactly the archive somebody kept on an old machine.
    let holds_recordings = ["recordings", "nahravky"]
        .into_iter()
        .any(|name| has_table(&db, name).unwrap_or(false));
    if !holds_recordings {
        return Offered::NotAnArchive;
    }
    match stored_schema_version(&db) {
        Ok(Some(found)) if found > SCHEMA_VERSION => Offered::FromTheFuture {
            found,
            known: SCHEMA_VERSION,
        },
        // No number at all is an archive older than the numbering, which `open`
        // handles: it is given one on the way in.
        _ => Offered::Usable,
    }
}

/// Reads the schema number without assuming the table it lives in exists.
///
/// It has moved: `klice` before 1.0.5, `settings` after. An archive older than
/// both has neither the key nor a number, and counts as the schema it was
/// written in.
fn stored_schema_version(db: &Connection) -> Result<Option<i64>> {
    let table = if has_table(db, "settings")? {
        "settings"
    } else if has_table(db, "klice")? {
        "klice"
    } else {
        return Ok(None);
    };
    // Both columns moved with the table, and this runs before the rename, so
    // the pair is chosen together. Asking for the wrong one is not a missing
    // row that `optional` would absorb — it is a missing column, and it fails.
    let (key_column, value_column) = if table == "settings" {
        ("key", "value")
    } else {
        ("klic", "hodnota")
    };
    let value: Option<String> = db
        .query_row(
            &format!("SELECT {value_column} FROM {table} WHERE {key_column} = ?1"),
            params![SCHEMA_VERSION_KEY],
            |r| r.get(0),
        )
        .optional()?;
    Ok(value.and_then(|v| v.parse().ok()))
}

/// Whether this archive still has a table by that name.
fn has_table(db: &Connection, name: &str) -> Result<bool> {
    let found: i64 = db.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![name],
        |r| r.get(0),
    )?;
    Ok(found > 0)
}

/// Takes in a Czech table standing beside the English one it became.
///
/// This is what an archive looks like after a build older than 1.0.5 has opened
/// it: that build looks for `nahravky`, does not find it, and its own
/// `CREATE TABLE IF NOT EXISTS` makes an empty one. The next start then finds
/// both and cannot rename one onto the other — which is how 1.0.5 came to
/// refuse to open an archive it had itself migrated the day before.
///
/// Usually the leftover is empty and simply goes. It is not always: somebody
/// can have added a recording in the older build before coming back, and that
/// work is theirs. The rows are copied across by name, mapped through the same
/// table the rename used, so nothing rests on the two tables having their
/// columns in the same order.
fn absorb_leftover(db: &Connection, from: &str, to: &str, columns: &[(&str, &str)]) -> Result<()> {
    let rows: i64 = db.query_row(&format!("SELECT count(*) FROM {from}"), [], |r| r.get(0))?;
    if rows > 0 {
        let present: Vec<String> = db
            .prepare(&format!("SELECT name FROM pragma_table_info('{from}')"))?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<_, _>>()?;
        let renamed: Vec<String> = present
            .iter()
            .map(|name| {
                columns
                    .iter()
                    .find(|(old, _)| old == name)
                    .map(|(_, new)| (*new).to_string())
                    .unwrap_or_else(|| name.clone())
            })
            .collect();
        // OR IGNORE, because the same row can be in both: the older build may
        // have been shown work that was already there before it recreated the
        // table. A conflict means the English side already has it.
        db.execute_batch(&format!(
            "INSERT OR IGNORE INTO {to} ({}) SELECT {} FROM {from};",
            renamed.join(", "),
            present.join(", ")
        ))?;
        crate::note!("archive: {rows} rows moved from the leftover {from} into {to}");
    }
    db.execute_batch(&format!("DROP TABLE {from};"))?;
    Ok(())
}

/// Puts the schema into English, once, in an archive written before 1.0.5.
///
/// This runs before the `CREATE TABLE IF NOT EXISTS` batch and has to: those
/// statements name the English tables, so an archive left in Czech would end up
/// with both — the reader's recordings in one set and an empty set beside them,
/// and the application reading the empty one.
///
/// `PRAGMA foreign_keys` must be on before a rename, and cannot be changed
/// inside a transaction, so it is set first. With it off, SQLite renames the
/// table and leaves every `REFERENCES nahravky(id)` in the other tables pointing
/// at a name that no longer exists.
///
/// The full-text index is dropped rather than renamed: `ALTER TABLE RENAME
/// COLUMN` does not work on a virtual table, and its `nahravka_id` column is
/// named in every search. It is rebuilt from the segments below, so searching an
/// old transcript keeps working — the index is derived data and nothing in it is
/// the reader's.
fn rename_schema_to_english(db: &Connection, path: &std::path::Path) -> Result<()> {
    if !has_table(db, "nahravky")? {
        return Ok(());
    }

    // A copy first. Renaming a table cannot be undone by opening the file with
    // an older build - that build looks for `nahravky` and makes an empty one.
    // This is the only migration in the archive's history that the previous
    // version cannot read afterwards, so it is the only one that leaves a way
    // back. `VACUUM INTO` rather than a file copy: the write-ahead log may hold
    // the last session's work, and copying the main file alone would leave it
    // out of the very backup taken to protect it.
    // Named after the archive rather than fixed, so a file called anything else
    // gets a copy that says what it is a copy of - and so it followed the
    // archive when that was renamed from `whisp.db` to `volocal.db`.
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let copy = path.with_file_name(format!("{stem}-before-english.db"));
    if !copy.exists() {
        match db.execute("VACUUM INTO ?1", params![copy.to_string_lossy()]) {
            Ok(_) => crate::note!("archive: copied to {} before the rename", copy.display()),
            // Worth saying and not worth stopping for: the rename itself is
            // transactional, and refusing to open the archive because a spare
            // copy could not be written would be the worse outcome.
            Err(error) => crate::note!("archive: the copy before the rename failed: {error}"),
        }
    }

    db.execute_batch("PRAGMA foreign_keys = ON;")?;
    let tx = db.unchecked_transaction()?;

    for (names, columns) in RENAMED {
        let (from, to) = names.split_once(' ').expect("a pair");
        if !has_table(db, from)? {
            continue;
        }
        if has_table(db, to)? {
            absorb_leftover(db, from, to, columns)?;
            continue;
        }
        db.execute_batch(&format!("ALTER TABLE {from} RENAME TO {to};"))?;
        for (old, new) in *columns {
            db.execute_batch(&format!("ALTER TABLE {to} RENAME COLUMN {old} TO {new};"))?;
        }
    }

    db.execute_batch(
        "DROP INDEX IF EXISTS idx_segmenty_nahravka;
         DROP INDEX IF EXISTS idx_poznamky_nahravka;
         DROP TABLE IF EXISTS segmenty_fts;",
    )?;
    tx.commit()?;
    Ok(())
}

/// Turns the four Czech status values into the English ones, in place.
///
/// The tables and columns stopped being Czech in 1.0.5; these four strings did
/// not, because they are data rather than structure and renaming data means
/// touching every archive. This does that, and it is cheap: one statement over
/// one column, inside the transaction SQLite gives a single `UPDATE`.
///
/// No copy is taken first, unlike the table rename. That one restructured the
/// file and could not be undone; this one rewrites four known strings, and the
/// backups the application already keeps are the way back if one is ever
/// needed. What does protect it is `SCHEMA_VERSION`, raised to 3: a build older
/// than this refuses the archive by name instead of reading it and finding
/// every recording in a status it does not know.
///
/// Idempotent by construction — nothing maps onto a Czech value, so a second
/// run matches no rows. An archive already in English is one `UPDATE` that
/// changes nothing.
fn rename_statuses_to_english(db: &Connection) -> Result<()> {
    let mut clauses = String::new();
    for (czech, english) in status::RENAMED {
        clauses.push_str(&format!(" WHEN '{czech}' THEN '{english}'"));
    }
    let changed = db.execute(
        &format!(
            "UPDATE recordings SET status = CASE status{clauses} ELSE status END
             WHERE status IN ('nova', 'prepisuje', 'hotova', 'chyba')"
        ),
        [],
    )?;
    if changed > 0 {
        crate::note!("archive: {changed} recordings moved to the English statuses");
    }
    Ok(())
}

/// Fills the rebuilt full-text index from the transcripts already in the
/// archive. Runs after the schema batch, which is what creates the empty index.
fn refill_search_index(db: &Connection) -> Result<()> {
    let indexed: i64 = db.query_row("SELECT count(*) FROM segments_fts", [], |r| r.get(0))?;
    let stored: i64 = db.query_row("SELECT count(*) FROM segments", [], |r| r.get(0))?;
    if indexed > 0 || stored == 0 {
        return Ok(());
    }
    db.execute_batch(
        "INSERT INTO segments_fts (text, segment_id, recording_id)
         SELECT text, id, recording_id FROM segments;",
    )?;
    crate::note!("archive: rebuilt the search index over {stored} segments");
    Ok(())
}

pub fn open(path: &std::path::Path) -> Result<Connection> {
    let db = Connection::open(path)?;

    /* **Wait for a busy archive rather than failing at it.** SQLite's default
    is to give up the instant another connection holds the write lock, and
    this application opens six or more of them — the window's, a
    transcription's, an AI edit's, a waveform's, the startup backup's. Under
    WAL a reader never blocks a writer, so the collisions are brief and rare;
    what they are not is impossible, and without this the loser is an
    ordinary command answering `database is locked` to somebody who did
    nothing wrong.

    Five seconds is far longer than any write here takes and far shorter than
    a person's patience for a button that has visibly been pressed. */
    db.busy_timeout(std::time::Duration::from_secs(5))?;

    // Before anything is renamed or created. An archive from a newer build is
    // not ours to touch, and the one thing this must not do is what an older
    // build does today: fail to find the tables it knows and make empty ones.
    if let Some(found) = stored_schema_version(&db)? {
        if found > SCHEMA_VERSION {
            return Err(ArchiveFromTheFuture {
                found,
                known: SCHEMA_VERSION,
            }
            .into());
        }
    }

    rename_schema_to_english(&db, path)?;
    db.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS recordings (
            id           TEXT PRIMARY KEY,
            path        TEXT NOT NULL,
            name        TEXT NOT NULL,
            duration        REAL NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL,
            status         TEXT NOT NULL DEFAULT 'new',
            model        TEXT NOT NULL DEFAULT '',
            error        TEXT,
            -- Which folder holds the recording; NULL is the archive's root.
            -- ON DELETE SET NULL is what makes "delete the folder, keep the
            -- recordings" atomic instead of a loop that can half-finish.
            folder_id       TEXT REFERENCES folders(id) ON DELETE SET NULL,
            -- Where the audio was fetched from, when it came through an online
            -- import. NULL for every other recording, and for the online
            -- imports made before this column existed: an address that was
            -- never written down is not one that can be filled in later.
            source_url      TEXT,
            -- A second language the reader says the recording holds. Empty is
            -- nobody said so, which is every recording written before this.
            second_language_choice TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS folders (
            id           TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS segments (
            id           TEXT PRIMARY KEY,
            recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
            position       INTEGER NOT NULL,
            start_time      REAL NOT NULL,
            end_time        REAL NOT NULL,
            text         TEXT NOT NULL,
            speakers       TEXT,
            confidence      REAL,
            edited     INTEGER NOT NULL DEFAULT 0,
            words        TEXT,
            verified      INTEGER NOT NULL DEFAULT 0,
            original      TEXT,
            -- Which language this block was transcribed in, when it is not the
            -- recording's own. NULL is every block written before the
            -- second-language pass existed, and every block that pass did not
            -- write.
            language      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_segments_recording ON segments(recording_id, position);

        CREATE TABLE IF NOT EXISTS speakers (
            key         TEXT NOT NULL,
            recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            color        TEXT NOT NULL,
            PRIMARY KEY (key, recording_id)
        );

        CREATE TABLE IF NOT EXISTS notes (
            id           TEXT PRIMARY KEY,
            recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
            time          REAL NOT NULL DEFAULT 0,
            text         TEXT NOT NULL,
            done       INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL,
            -- Whether `time` means anything. The column cannot be made nullable
            -- without rebuilding the table, and zero is a real position in a
            -- recording, so the flag carries the distinction instead.
            pinned       INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_notes_recording
            ON notes(recording_id, time, created_at);

        -- `prompt` is dead: the entry used to be handed to Whisper before
        -- transcription, which only ever conditioned the first window. The
        -- column stays so a fresh archive has the same shape as an old one,
        -- and because SQLite cannot drop a column without rebuilding the table.
        CREATE TABLE IF NOT EXISTS dictionary (
            id           TEXT PRIMARY KEY,
            search       TEXT NOT NULL,
            replacement     TEXT NOT NULL,
            prompt     INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS waveforms (
            recording_id  TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
            points         BLOB NOT NULL,
            per_second   REAL NOT NULL DEFAULT 12,
            equalizer    BLOB NOT NULL DEFAULT X'',
            equalizer_points_per_second REAL NOT NULL DEFAULT 10,
            equalizer_band_count INTEGER NOT NULL DEFAULT 24
        );

        CREATE TABLE IF NOT EXISTS settings (
            key         TEXT PRIMARY KEY,
            value      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_documents (
            recording_id  TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
            source_hash   TEXT NOT NULL,
            model         TEXT NOT NULL,
            mode          TEXT NOT NULL,
            text          TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_outputs (
            recording_id  TEXT NOT NULL REFERENCES ai_documents(recording_id) ON DELETE CASCADE,
            kind          TEXT NOT NULL,
            variant       TEXT NOT NULL,
            source_hash   TEXT NOT NULL,
            model         TEXT NOT NULL,
            text          TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            PRIMARY KEY (recording_id, kind, variant)
        );

        -- A document made by an instruction the reader wrote themselves.
        --
        -- It hangs off the recording rather than off `ai_documents`, which is
        -- what summaries and translations do. Two reasons: the instruction is
        -- given about the recording, so the timed transcript is its source;
        -- and it is asked for from the dialog that offers to make the improved
        -- transcript, which is exactly the moment when no improved transcript
        -- exists yet. Hanging it off the document would have made regenerating
        -- or discarding that document take this one with it.
        --
        -- Keyed by the instruction, so rewording asks a new question instead of
        -- overwriting the answer to the old one.
        CREATE TABLE IF NOT EXISTS ai_custom_documents (
            recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
            prompt        TEXT NOT NULL,
            source_hash   TEXT NOT NULL,
            model         TEXT NOT NULL,
            text          TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            PRIMARY KEY (recording_id, prompt)
        );

        -- What the watched folder has already been answered about. The record
        -- outlives the archive card: deleting a recording is a decision about
        -- the archive, not an instruction to offer its source file again.
        -- Keyed on the fingerprint as well as the path, so the same file put
        -- there afresh — which changes its modification time — comes back.
        CREATE TABLE IF NOT EXISTS watch_folder_files (
            path          TEXT NOT NULL,
            fingerprint   TEXT NOT NULL,
            imported_at   TEXT NOT NULL,
            PRIMARY KEY (path, fingerprint)
        );

        -- A file has to keep the same fingerprint for two scans before it is
        -- imported. This prevents reading a recording while it is still being
        -- copied into the watched directory.
        CREATE TABLE IF NOT EXISTS watch_folder_observations (
            path          TEXT PRIMARY KEY,
            fingerprint   TEXT NOT NULL,
            observed_at   TEXT NOT NULL
        );

        -- What a sweep for a second language found in one recording, so the
        -- offer survives a restart and a refusal is not asked again.
        --
        -- One row per recording and one language, not a list: the offer is a
        -- single question with a single button, and a recording carrying three
        -- languages is not a case anybody has yet. `share` is what fraction of
        -- the sampled windows came back that language, kept so a later change
        -- to the threshold can be judged against archives already swept.
        CREATE TABLE IF NOT EXISTS second_language (
            recording_id  TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
            language      TEXT NOT NULL,
            share         REAL NOT NULL,
            -- offered | filled | refused
            state         TEXT NOT NULL,
            filled_at     TEXT
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
            text,
            segment_id   UNINDEXED,
            recording_id  UNINDEXED,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        "#,
    )?;
    migrate_legacy_schema(&db);
    // After the batch, which is what guarantees there is a `recordings` table
    // to update, and before anything reads a status out of it.
    rename_statuses_to_english(&db)?;
    // Written last, so an archive only claims a schema it actually reached.
    save_metadata_value(&db, SCHEMA_VERSION_KEY, &SCHEMA_VERSION.to_string())?;
    // After the batch, which is what creates the empty index the rename left.
    if let Err(error) = refill_search_index(&db) {
        crate::note!("archive: the search index could not be rebuilt: {error}");
    }
    enable_language_detection(&db);
    Ok(db)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiDocument {
    pub recording_id: String,
    pub source_hash: String,
    pub model: String,
    pub mode: String,
    pub text: String,
    pub updated_at: String,
    pub stale: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiOutput {
    pub recording_id: String,
    pub kind: String,
    pub variant: String,
    pub source_hash: String,
    pub model: String,
    pub text: String,
    pub updated_at: String,
}

/// One answer to one instruction, for one recording.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiCustomDocument {
    pub recording_id: String,
    pub prompt: String,
    pub source_hash: String,
    pub model: String,
    pub text: String,
    pub updated_at: String,
    /// Whether the transcript has been rewritten since this was made. The row
    /// cannot know; `ai_edit_status` fills it in, as it does for `AiDocument`.
    pub stale: bool,
}

pub fn ai_document(db: &Connection, recording_id: &str) -> Result<Option<AiDocument>> {
    let mut statement = db.prepare(
        "SELECT recording_id, source_hash, model, mode, text, updated_at
         FROM ai_documents WHERE recording_id = ?1",
    )?;
    let mut rows = statement.query(params![recording_id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    Ok(Some(AiDocument {
        recording_id: row.get(0)?,
        source_hash: row.get(1)?,
        model: row.get(2)?,
        mode: row.get(3)?,
        text: row.get(4)?,
        updated_at: row.get(5)?,
        stale: false,
    }))
}

pub fn save_ai_document(db: &Connection, document: &AiDocument) -> Result<()> {
    db.execute(
        "INSERT INTO ai_documents
         (recording_id, source_hash, model, mode, text, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(recording_id) DO UPDATE SET
           source_hash = excluded.source_hash,
           model = excluded.model,
           mode = excluded.mode,
           text = excluded.text,
           updated_at = excluded.updated_at",
        params![
            document.recording_id,
            document.source_hash,
            document.model,
            document.mode,
            document.text,
            document.updated_at,
        ],
    )?;
    // Summaries and translations derive from the edited document, not the
    // timed transcript. A newly generated document invalidates all of them.
    db.execute(
        "DELETE FROM ai_outputs WHERE recording_id = ?1",
        params![document.recording_id],
    )?;
    Ok(())
}

pub fn ai_outputs(db: &Connection, recording_id: &str) -> Result<Vec<AiOutput>> {
    let mut statement = db.prepare(
        "SELECT recording_id, kind, variant, source_hash, model, text, updated_at
         FROM ai_outputs WHERE recording_id = ?1 ORDER BY kind, variant",
    )?;
    let rows = statement.query_map(params![recording_id], |row| {
        Ok(AiOutput {
            recording_id: row.get(0)?,
            kind: row.get(1)?,
            variant: row.get(2)?,
            source_hash: row.get(3)?,
            model: row.get(4)?,
            text: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

pub fn save_ai_output(db: &Connection, output: &AiOutput) -> Result<()> {
    db.execute(
        "INSERT INTO ai_outputs
         (recording_id, kind, variant, source_hash, model, text, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(recording_id, kind, variant) DO UPDATE SET
           source_hash = excluded.source_hash,
           model = excluded.model,
           text = excluded.text,
           updated_at = excluded.updated_at",
        params![
            output.recording_id,
            output.kind,
            output.variant,
            output.source_hash,
            output.model,
            output.text,
            output.updated_at,
        ],
    )?;
    Ok(())
}

pub fn ai_custom_documents(db: &Connection, recording_id: &str) -> Result<Vec<AiCustomDocument>> {
    let mut statement = db.prepare(
        "SELECT recording_id, prompt, source_hash, model, text, updated_at
         FROM ai_custom_documents WHERE recording_id = ?1 ORDER BY updated_at DESC",
    )?;
    let rows = statement.query_map(params![recording_id], |row| {
        Ok(AiCustomDocument {
            recording_id: row.get(0)?,
            prompt: row.get(1)?,
            source_hash: row.get(2)?,
            model: row.get(3)?,
            text: row.get(4)?,
            updated_at: row.get(5)?,
            stale: false,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

pub fn save_ai_custom_document(db: &Connection, document: &AiCustomDocument) -> Result<()> {
    db.execute(
        "INSERT INTO ai_custom_documents
         (recording_id, prompt, source_hash, model, text, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(recording_id, prompt) DO UPDATE SET
           source_hash = excluded.source_hash,
           model = excluded.model,
           text = excluded.text,
           updated_at = excluded.updated_at",
        params![
            document.recording_id,
            document.prompt,
            document.source_hash,
            document.model,
            document.text,
            document.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete_ai_document(db: &Connection, recording_id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM ai_documents WHERE recording_id = ?1",
        params![recording_id],
    )?;
    Ok(())
}

/// Bring databases created by earlier releases up to the current schema.
///
/// SQLite reports a duplicate-column error when a migration has already run,
/// so these additive migrations are intentionally idempotent.
fn migrate_legacy_schema(db: &Connection) {
    // Folders arrived after the archive did. The table is created above for
    // fresh databases; an existing one needs the column added, and SQLite
    // cannot add a column with a REFERENCES clause that has an action, so the
    // clause is plain here — `delete_folder` clears the column itself.
    let _ = db.execute("ALTER TABLE recordings ADD COLUMN folder_id TEXT", []);
    let _ = db.execute("ALTER TABLE segments ADD COLUMN words TEXT", []);
    let _ = db.execute(
        "ALTER TABLE segments ADD COLUMN verified INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // What the machine wrote, kept the first time a human rewrites a segment.
    // Segments edited before this column existed keep NULL: the original is
    // simply not knowable for them, and guessing one would be worse.
    let _ = db.execute("ALTER TABLE segments ADD COLUMN original TEXT", []);
    // Which language a block was transcribed in, when it is not the
    // recording's own. Added with the second-language pass; NULL in every
    // archive written before it, which is exactly what it should say.
    let _ = db.execute("ALTER TABLE segments ADD COLUMN language TEXT", []);
    let _ = db.execute(
        "ALTER TABLE recordings ADD COLUMN jazyk TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE recordings ADD COLUMN jazyk_volba TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE waveforms ADD COLUMN per_second REAL NOT NULL DEFAULT 12",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE waveforms ADD COLUMN equalizer BLOB NOT NULL DEFAULT X''",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE waveforms ADD COLUMN equalizer_points_per_second REAL NOT NULL DEFAULT 10",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE waveforms ADD COLUMN equalizer_band_count INTEGER NOT NULL DEFAULT 24",
        [],
    );
    // Notes written before this existed all had a position, so they stay pinned.
    let _ = db.execute(
        "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 1",
        [],
    );
    /* The address an online import came from. Nullable and with no default, on
    purpose: every recording already in the archive gets NULL, which is the
    truth about them — the importer validated a URL, downloaded the audio and
    threw the URL away, so their origin is gone rather than absent. An empty
    string would say instead that they were never imported from anywhere.

    `SCHEMA_VERSION` stays at 3. It is raised when an older build would read
    this archive wrongly, and a column added at the end is not that: every
    query in this module names its columns, so a build without `source_url`
    goes on reading and writing the same rows and only cannot see this one
    value. Refusing the archive over that would cost its owner far more than
    the column is worth. */
    let _ = db.execute("ALTER TABLE recordings ADD COLUMN source_url TEXT", []);
    // A second language the reader named. Empty on every archive from before,
    // which says exactly what it should: nobody has said anything yet.
    let _ = db.execute(
        "ALTER TABLE recordings ADD COLUMN second_language_choice TEXT NOT NULL DEFAULT ''",
        [],
    );
}

/// Earlier versions hard-coded Czech as the default language, so Whisper
/// translated a foreign-language recording instead of transcribing it. This
/// switches to detection once; anyone who later picks a specific language
/// keeps that choice.
fn enable_language_detection(db: &Connection) {
    let complete: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE key = 'jazyk-rozpoznavani'",
            [],
            |r| r.get(0),
        )
        .ok();
    if complete.is_some() {
        return;
    }
    if let Ok(mut n) = load_settings(db) {
        n.language = "auto".into();
        let _ = save_settings(db, &n);
    }
    let _ = db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('jazyk-rozpoznavani', 'ano')",
        [],
    );
}

// ---------------------------------------------------------------- settings

pub fn load_settings(db: &Connection) -> Result<Settings> {
    let json: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE key = 'nastaveni'",
            [],
            |r| r.get(0),
        )
        .ok();
    match json {
        Some(j) => match serde_json::from_str(&j) {
            Ok(settings) => Ok(settings),
            Err(error) => {
                // Defaults are the only way to carry on, but the broken text
                // must not be lost with them: the next `save_settings` writes
                // over this key, so without a copy the loss is permanent and
                // silent. Whoever ends up here can read their own paths and
                // choices out of `nastaveni-poskozeno`.
                crate::note!("settings: unreadable, keeping a copy: {error}");
                let _ = db.execute(
                    "INSERT INTO settings (key, value) VALUES ('nastaveni-poskozeno', ?1)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![j],
                );
                Ok(Settings::default())
            }
        },
        None => Ok(Settings::default()),
    }
}

pub fn save_settings(db: &Connection, settings: &Settings) -> Result<()> {
    db.execute(
        "INSERT INTO settings (key, value) VALUES ('nastaveni', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![serde_json::to_string(settings)?],
    )?;
    Ok(())
}

// -------------------------------------------------------------- recordings

pub fn insert_recording(db: &Connection, recording: &Recording) -> Result<()> {
    db.execute(
        "INSERT INTO recordings (id, path, name, duration, created_at, status, model, error,
             source_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            recording.id,
            recording.path,
            recording.title,
            recording.duration,
            recording.created_at,
            recording.status,
            recording.model,
            recording.error,
            recording.source_url
        ],
    )?;
    Ok(())
}

pub fn recording_path_exists(db: &Connection, path: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM recordings WHERE path = ?1)",
        params![path],
        |row| row.get(0),
    )?)
}

/// Returns true after the same file fingerprint has been seen on a previous
/// scan. A changed or new file is only remembered and must survive one more
/// scan before the caller may import it.
/// Whether this exact file, with this exact content, has already been answered
/// about — imported, added, or set aside.
pub fn watch_file_imported(db: &Connection, path: &str, fingerprint: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM watch_folder_files WHERE path = ?1 AND fingerprint = ?2
         )",
        params![path, fingerprint],
        |row| row.get(0),
    )?)
}

pub fn mark_watch_file_imported(db: &Connection, path: &str, fingerprint: &str) -> Result<()> {
    db.execute(
        "INSERT OR IGNORE INTO watch_folder_files (path, fingerprint, imported_at)
         VALUES (?1, ?2, ?3)",
        params![
            path,
            fingerprint,
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
        ],
    )?;
    Ok(())
}

/// Returns true after the same file fingerprint has been seen on a previous
/// scan. A changed or new file is only remembered and must survive one more
/// scan before the caller may import it.
pub fn watch_file_is_stable(db: &Connection, path: &str, fingerprint: &str) -> Result<bool> {
    let previous: Option<String> = db
        .query_row(
            "SELECT fingerprint FROM watch_folder_observations WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .optional()?;
    if previous.as_deref() == Some(fingerprint) {
        return Ok(true);
    }
    db.execute(
        "INSERT INTO watch_folder_observations (path, fingerprint, observed_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           observed_at = excluded.observed_at",
        params![
            path,
            fingerprint,
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
        ],
    )?;
    Ok(false)
}

pub fn set_status(db: &Connection, id: &str, status: &str, error: Option<&str>) -> Result<()> {
    db.execute(
        "UPDATE recordings SET status = ?2, error = ?3 WHERE id = ?1",
        params![id, status, error],
    )?;
    Ok(())
}

/// Cleans up transcriptions that were cut short by the app going away.
///
/// A transcription only ever runs inside this process, so at startup — before
/// anything can have been started — any recording still marked as running is
/// by definition a leftover from a crash, a forced quit or a power cut. That
/// makes a timestamp column unnecessary: the state itself is the evidence.
///
/// They are moved to the error state rather than quietly back to untranscribed,
/// so it is visible that something went wrong. The library already offers
/// "Zkusit znovu" for that state.
///
/// Returns how many recordings were rescued.
///
/// Caveat: two instances of the app over one archive would have the second one
/// declare the first one's work interrupted. Sharing an archive between two
/// running copies is a worse problem than this one, so it is left alone.
pub fn recover_interrupted(db: &Connection) -> Result<usize> {
    let tx = transaction_unless_in_one(db)?;
    // A row still saying `prepisuje` while its segments are there is a run
    // that finished and failed to write down that it had. Segments are
    // written in one transaction at the very end — including a re-run, which
    // deletes and reinserts inside it — so their presence means a complete
    // transcript, whether from this run or the one before it. Calling that a
    // failure is how a forty-minute transcript that went fine comes back as
    // an error.
    db.execute(
        "UPDATE recordings SET status = 'done', error = NULL
         WHERE status = 'transcribing'
           AND EXISTS (SELECT 1 FROM segments WHERE recording_id = recordings.id)",
        [],
    )?;
    let count = db.execute(
        "UPDATE recordings SET status = 'error', error = ?1 WHERE status = 'transcribing'",
        params![UserMessage::new("transcription.interrupted").to_stored()],
    )?;
    commit(tx)?;
    Ok(count)
}

pub fn rename_recording(db: &Connection, id: &str, title: &str) -> Result<()> {
    if title.is_empty() {
        return Ok(());
    }
    db.execute(
        "UPDATE recordings SET name = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    Ok(())
}

pub fn set_model(db: &Connection, id: &str, model: &str) -> Result<()> {
    db.execute(
        "UPDATE recordings SET model = ?2 WHERE id = ?1",
        params![id, model],
    )?;
    Ok(())
}

/// Language the user requested for one particular recording.
/// Writes down a second language the reader says the recording holds, or
/// forgets it when `language` is empty.
pub fn set_second_language_choice(db: &Connection, id: &str, language: &str) -> Result<()> {
    db.execute(
        "UPDATE recordings SET second_language_choice = ?2 WHERE id = ?1",
        params![id, language.trim().to_ascii_lowercase()],
    )?;
    Ok(())
}

pub fn set_language_choice(db: &Connection, id: &str, language: &str) -> Result<()> {
    db.execute(
        "UPDATE recordings SET jazyk_volba = ?2 WHERE id = ?1",
        params![id, language],
    )?;
    Ok(())
}

pub fn set_language(db: &Connection, id: &str, language: &str) -> Result<()> {
    db.execute(
        "UPDATE recordings SET jazyk = ?2 WHERE id = ?1",
        params![id, language],
    )?;
    Ok(())
}

fn recording_from_row(r: &rusqlite::Row) -> rusqlite::Result<Recording> {
    Ok(Recording {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        duration: r.get(3)?,
        created_at: r.get(4)?,
        status: r.get(5)?,
        model: r.get(6)?,
        error: r.get(7)?,
        segment_count: r.get(8)?,
        language: r.get(9).unwrap_or_default(),
        language_choice: r.get(10).unwrap_or_default(),
        folder: r.get(11).unwrap_or_default(),
        source_url: r.get(12).unwrap_or_default(),
        second_language_choice: r.get(13).unwrap_or_default(),
        second_language: r.get(14).unwrap_or_default(),
    })
}

const RECORDING_SELECT_SQL: &str =
    "SELECT n.id, n.path, n.name, n.duration, n.created_at, n.status, n.model, n.error,
        (SELECT COUNT(*) FROM segments s WHERE s.recording_id = n.id), n.jazyk, n.jazyk_volba,
        n.folder_id, n.source_url, n.second_language_choice,
        (SELECT sl.language FROM second_language sl
          WHERE sl.recording_id = n.id AND sl.state = 'filled')
     FROM recordings n";

/// Every recording in the archive, and **a row that cannot be read is shown as
/// damaged rather than left out.**
///
/// `filter_map(|r| r.ok())` dropped it in silence. SQLite is dynamically typed,
/// so a NULL where a TEXT is expected is enough — and the archive then showed
/// the recording as simply not existing, which a reader can only take as
/// *somebody deleted it*. This is the one screen the owner trusts to say what
/// is there.
///
/// Failing the whole read is not the answer either: one bad row must not blank
/// the archive. So the ids are read a second time, forgivingly — `id` alone,
/// which is the primary key and cannot be the column that failed — and anything
/// that did not map comes back as a card in the error state saying so.
pub fn list_recordings(db: &Connection) -> Result<Vec<Recording>> {
    let sql = format!("{RECORDING_SELECT_SQL} ORDER BY n.created_at DESC");
    let mut st = db.prepare(&sql)?;
    let rows = st.query_map([], recording_from_row)?;
    let readable: Vec<Recording> = rows.filter_map(|r| r.ok()).collect();

    let mut all = db.prepare("SELECT id FROM recordings ORDER BY created_at DESC")?;
    let ids: Vec<String> = all
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    if ids.len() == readable.len() {
        return Ok(readable);
    }

    let mut by_id: std::collections::HashMap<String, Recording> = readable
        .into_iter()
        .map(|recording| (recording.id.clone(), recording))
        .collect();
    Ok(ids
        .into_iter()
        .map(|id| {
            by_id.remove(&id).unwrap_or_else(|| Recording {
                path: String::new(),
                // Named by its id, which is the only thing about it that read.
                // A blank card would be one more thing the reader cannot act on.
                title: id.clone(),
                duration: 0.0,
                created_at: String::new(),
                status: status::FAILED.into(),
                model: String::new(),
                language: String::new(),
                language_choice: String::new(),
                second_language_choice: String::new(),
                second_language: None,
                error: Some(
                    crate::user_message::UserMessage::new("archive.row_unreadable")
                        .with("id", &id)
                        .to_stored(),
                ),
                segment_count: 0,
                folder: None,
                // A row that could not be read says nothing about where it came
                // from either.
                source_url: None,
                id,
            })
        })
        .collect())
}

/// Completed recordings that have a timed transcript available for a
/// one-time layout migration.
pub fn completed_recording_ids_with_segments(db: &Connection) -> Result<Vec<String>> {
    let mut statement = db.prepare(
        "SELECT n.id FROM recordings n
         WHERE n.status = 'done'
           AND EXISTS (SELECT 1 FROM segments s WHERE s.recording_id = n.id)
         ORDER BY n.created_at",
    )?;
    let rows = statement.query_map([], |row| row.get(0))?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

/// Small version and migration markers stored beside the application
/// settings. The legacy table name is kept for database compatibility.
pub fn metadata_value(db: &Connection, key: &str) -> Result<Option<String>> {
    let mut statement = db.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = statement.query(params![key])?;
    Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
}

pub fn save_metadata_value(db: &Connection, key: &str, value: &str) -> Result<()> {
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn recording(db: &Connection, id: &str) -> Result<Recording> {
    let sql = format!("{RECORDING_SELECT_SQL} WHERE n.id = ?1");
    Ok(db.query_row(&sql, params![id], recording_from_row)?)
}

pub fn delete_recording(db: &Connection, id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM segments_fts WHERE recording_id = ?1",
        params![id],
    )?;
    db.execute("DELETE FROM recordings WHERE id = ?1", params![id])?;
    Ok(())
}

// --------------------------------------------------------------- folders

pub fn folders(db: &Connection) -> Result<Vec<Folder>> {
    let mut statement = db.prepare(
        "SELECT s.id, s.name, s.created_at,
                (SELECT COUNT(*) FROM recordings n WHERE n.folder_id = s.id),
                (SELECT COALESCE(SUM(n.duration), 0) FROM recordings n WHERE n.folder_id = s.id)
         FROM folders s
         ORDER BY s.name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            recording_count: row.get(3)?,
            duration: row.get(4)?,
        })
    })?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

pub fn create_folder(db: &Connection, name: &str) -> Result<Folder> {
    let id = uuid::Uuid::new_v4().to_string();
    let created = chrono::Local::now().to_rfc3339();
    db.execute(
        "INSERT INTO folders (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, name, created],
    )?;
    Ok(Folder {
        id,
        name: name.to_string(),
        created_at: created,
        recording_count: 0,
        duration: 0.0,
    })
}

pub fn rename_folder(db: &Connection, id: &str, name: &str) -> Result<()> {
    db.execute(
        "UPDATE folders SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    Ok(())
}

/// `folder` of `None` takes the recordings back to the archive's root.
pub fn move_to_folder(db: &Connection, ids: &[String], folder: Option<&str>) -> Result<()> {
    // One transaction: a loop that gives up in the middle would leave half a
    // selection in one folder and half in another, with nothing said about it.
    let tx = transaction_unless_in_one(db)?;
    for id in ids {
        db.execute(
            "UPDATE recordings SET folder_id = ?2 WHERE id = ?1",
            params![id, folder],
        )?;
    }
    commit(tx)
}

pub fn folder_recording_ids(db: &Connection, folder: &str) -> Result<Vec<String>> {
    let mut statement = db.prepare("SELECT id FROM recordings WHERE folder_id = ?1")?;
    let rows = statement.query_map(params![folder], |row| row.get(0))?;
    // Every id matters: the caller deletes exactly this list and then the
    // folder itself, so a dropped row is a recording orphaned in a folder
    // that no longer exists.
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Deleting the folder alone. The recordings it held return to the root —
/// explicitly, because an archive migrated from an older version has the
/// column without its `ON DELETE SET NULL` clause and would otherwise keep
/// pointing at a folder that no longer exists.
pub fn delete_folder(db: &Connection, id: &str) -> Result<()> {
    // Both statements or neither: returning the recordings to the root and
    // removing the folder are one decision, and the half where the folder is
    // gone but its recordings still point at it is unreachable from the UI.
    let tx = transaction_unless_in_one(db)?;
    db.execute(
        "UPDATE recordings SET folder_id = NULL WHERE folder_id = ?1",
        params![id],
    )?;
    db.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    commit(tx)
}

// ----------------------------------------------------------------- notes and tasks

pub fn recording_notes(db: &Connection, recording_id: &str) -> Result<Vec<RecordingNote>> {
    // Notes about the whole recording come first in the order they were
    // written; the ones tied to a moment follow it. Mixing them by time would
    // bury a general remark somewhere in the middle of the recording.
    let mut statement = db.prepare(
        "SELECT id, recording_id, time, text, done, created_at, pinned
         FROM notes WHERE recording_id = ?1
         ORDER BY pinned, CASE WHEN pinned = 1 THEN time END, created_at",
    )?;
    let rows = statement.query_map(params![recording_id], |row| {
        let pinned = row.get::<_, i64>(6)? != 0;
        Ok(RecordingNote {
            id: row.get(0)?,
            recording_id: row.get(1)?,
            time: if pinned { Some(row.get(2)?) } else { None },
            text: row.get(3)?,
            done: row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn insert_recording_note(db: &Connection, note: &RecordingNote) -> Result<()> {
    db.execute(
        "INSERT INTO notes (id, recording_id, time, text, done, created_at, pinned)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            note.id,
            note.recording_id,
            note.time.unwrap_or(0.0),
            note.text,
            note.done as i64,
            note.created_at,
            note.time.is_some() as i64,
        ],
    )?;
    Ok(())
}

pub fn update_recording_note(
    db: &Connection,
    id: &str,
    time: Option<f64>,
    text: &str,
    done: bool,
) -> Result<()> {
    db.execute(
        "UPDATE notes SET time = ?1, text = ?2, done = ?3, pinned = ?4 WHERE id = ?5",
        params![
            time.unwrap_or(0.0),
            text,
            done as i64,
            time.is_some() as i64,
            id
        ],
    )?;
    Ok(())
}

pub fn delete_recording_note(db: &Connection, id: &str) -> Result<()> {
    db.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------- segments

pub fn delete_segments(db: &Connection, recording_id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM segments WHERE recording_id = ?1",
        params![recording_id],
    )?;
    db.execute(
        "DELETE FROM segments_fts WHERE recording_id = ?1",
        params![recording_id],
    )?;
    Ok(())
}

// ------------------------------------------------------- a second language

/// What a sweep found: one recording speaks a second language, and where the
/// reader stands on doing something about it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SecondLanguage {
    pub recording_id: String,
    pub language: String,
    /// The fraction of sampled windows that came back this language.
    pub share: f64,
    pub state: String,
    pub filled_at: Option<String>,
}

/// What `second_language.state` may say.
///
/// Constants rather than literals for the same reason as [`status`]: these
/// travel as strings across the IPC boundary and inside SQL, so a missed rename
/// goes on compiling and simply stops matching.
pub mod second_language_state {
    /// Found, and the reader has not answered.
    pub const OFFERED: &str = "offered";
    /// The missing language has been transcribed and merged in.
    pub const FILLED: &str = "filled";
    /// The reader said no. Not asked again for this transcript.
    pub const REFUSED: &str = "refused";
}

pub fn second_language(db: &Connection, recording_id: &str) -> Result<Option<SecondLanguage>> {
    Ok(db
        .query_row(
            "SELECT recording_id, language, share, state, filled_at
             FROM second_language WHERE recording_id = ?1",
            params![recording_id],
            |r| {
                Ok(SecondLanguage {
                    recording_id: r.get(0)?,
                    language: r.get(1)?,
                    share: r.get(2)?,
                    state: r.get(3)?,
                    filled_at: r.get(4)?,
                })
            },
        )
        .optional()?)
}

/// Writes what a sweep found, replacing whatever stood there.
///
/// Replacing rather than ignoring a conflict: a fresh transcript is a fresh
/// question, and a refusal recorded against text that no longer exists is not
/// an answer to it.
pub fn save_second_language(db: &Connection, found: &SecondLanguage) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO second_language
             (recording_id, language, share, state, filled_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            found.recording_id,
            found.language,
            found.share,
            found.state,
            found.filled_at
        ],
    )?;
    Ok(())
}

/// Moves the offer to `filled` or `refused`. Does nothing where nothing was
/// ever offered, which is every recording in one language.
pub fn set_second_language_state(db: &Connection, recording_id: &str, state: &str) -> Result<()> {
    let filled_at =
        (state == second_language_state::FILLED).then(|| chrono::Local::now().to_rfc3339());
    db.execute(
        "UPDATE second_language SET state = ?2, filled_at = ?3 WHERE recording_id = ?1",
        params![recording_id, state, filled_at],
    )?;
    Ok(())
}

/// Forgets the offer entirely.
///
/// **Not called from `delete_segments`,** and that is the whole of the care
/// here: separating speakers and the sentence-layout upgrade both delete every
/// segment and write them back, and neither is a new transcript. Clearing the
/// offer there would throw away a question the reader had not answered because
/// they pressed *Rozpoznat znovu*. It belongs where a transcript is actually
/// discarded or replaced.
pub fn clear_second_language(db: &Connection, recording_id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM second_language WHERE recording_id = ?1",
        params![recording_id],
    )?;
    Ok(())
}

pub fn insert_segment(db: &Connection, s: &Segment) -> Result<()> {
    // `puvodni` belongs in this list. Two paths delete every segment of a
    // recording and insert them again from values that already carry it —
    // `run_diarization` and the one-time sentence-layout upgrade. Leaving the
    // column out of the INSERT meant that recognising speakers on a
    // hand-corrected transcript silently emptied its `Opravy` list, which
    // shows only the segments whose original is known. The pencil marks
    // survived, so it read as a rendering fault rather than as deletion.
    db.execute(
        "INSERT INTO segments (id, recording_id, position, start_time, end_time, text, speakers, confidence, edited, words, verified, original, language)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![s.id, s.recording_id, s.order, s.start, s.end, s.text, s.speakers,
                s.confidence, s.edited as i64, s.words, s.verified as i64, s.original,
                s.language],
    )?;
    db.execute(
        "INSERT INTO segments_fts (text, segment_id, recording_id) VALUES (?1, ?2, ?3)",
        params![s.text, s.id, s.recording_id],
    )?;
    Ok(())
}

pub fn segments(db: &Connection, recording_id: &str) -> Result<Vec<Segment>> {
    let mut st = db.prepare(
        "SELECT id, recording_id, position, start_time, end_time, text, speakers, confidence, edited, words, verified, original, language
         FROM segments WHERE recording_id = ?1 ORDER BY position",
    )?;
    let rows = st.query_map(params![recording_id], |r| {
        Ok(Segment {
            id: r.get(0)?,
            recording_id: r.get(1)?,
            order: r.get(2)?,
            start: r.get(3)?,
            end: r.get(4)?,
            text: r.get(5)?,
            speakers: r.get(6)?,
            confidence: r.get(7)?,
            edited: r.get::<_, i64>(8)? != 0,
            words: r.get(9).ok(),
            verified: r.get::<_, i64>(10).unwrap_or(0) != 0,
            original: r.get(11).ok().flatten(),
            // `.ok().flatten()` like `original` beside it: an archive migrated
            // a moment ago has the column, one being read by an older build
            // does not, and a missing column must not fail the read.
            language: r.get(12).ok().flatten(),
        })
    })?;
    // Not `filter_map(|r| r.ok())`. Two paths delete every segment of a
    // recording and insert back exactly what this function returned —
    // `run_diarization` and the sentence-layout upgrade — so a row quietly
    // dropped here stops being a hole in the display and becomes a deletion.
    // Failing the read leaves the archive alone, which is the safe direction.
    let mut segments: Vec<Segment> = rows.collect::<Result<Vec<_>, _>>()?;
    for segment in &mut segments {
        align_word_timestamps(segment);
    }
    Ok(segments)
}

pub fn update_segment(db: &Connection, id: &str, text: &str) -> Result<()> {
    // After a manual edit the stored word timings no longer match the new
    // text. Whoever rewrote the segment has also reviewed it.
    // `COALESCE` is the whole rule: the first rewrite records what the machine
    // wrote, every later one leaves that record alone. The interesting
    // comparison is always against the transcript, not against the previous
    // attempt at fixing it.
    db.execute(
        "UPDATE segments SET original = COALESCE(original, text), text = ?2,
                edited = 1, verified = 1, words = NULL
         WHERE id = ?1",
        params![id, text],
    )?;
    db.execute(
        "UPDATE segments_fts SET text = ?2 WHERE segment_id = ?1",
        params![id, text],
    )?;
    Ok(())
}

/// A moved or renamed file. The transcript stays; only the path changes.
pub fn set_path(db: &Connection, id: &str, path: &str, duration: f64) -> Result<()> {
    db.execute(
        "UPDATE recordings SET path = ?2, duration = ?3 WHERE id = ?1",
        params![id, path, duration],
    )?;
    // The waveform belonged to the old file.
    db.execute("DELETE FROM waveforms WHERE recording_id = ?1", params![id])?;
    Ok(())
}

/// Cached amplitude waveform and real frequency-band peaks.
///
/// Values are stored as bytes in the 0–255 range to keep even long
/// recordings compact.
pub fn waveform(db: &Connection, recording_id: &str) -> Option<WaveformData> {
    db.query_row(
        "SELECT points, per_second, equalizer,
                equalizer_points_per_second, equalizer_band_count
         FROM waveforms WHERE recording_id = ?1",
        params![recording_id],
        |r| {
            Ok(WaveformData {
                points: r.get(0)?,
                points_per_second: r.get(1)?,
                equalizer: r.get(2)?,
                equalizer_points_per_second: r.get(3)?,
                equalizer_band_count: r.get::<_, i64>(4)?.max(0) as usize,
            })
        },
    )
    .ok()
}

pub fn save_waveform(db: &Connection, recording_id: &str, data: &WaveformData) -> Result<()> {
    db.execute(
        "INSERT INTO waveforms (
            recording_id, points, per_second, equalizer,
            equalizer_points_per_second, equalizer_band_count
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(recording_id) DO UPDATE SET
             points = excluded.points,
             per_second = excluded.per_second,
             equalizer = excluded.equalizer,
             equalizer_points_per_second = excluded.equalizer_points_per_second,
             equalizer_band_count = excluded.equalizer_band_count",
        params![
            recording_id,
            &data.points,
            data.points_per_second,
            &data.equalizer,
            data.equalizer_points_per_second,
            data.equalizer_band_count as i64
        ],
    )?;
    Ok(())
}

/// Writes segment text without setting the manual-edit flag. Used by the
/// dictionary: replacing a term is not the same as a human intervening and
/// must not clear the uncertainty marker.
pub fn save_segment_text(db: &Connection, id: &str, text: &str, words: Option<&str>) -> Result<()> {
    db.execute(
        "UPDATE segments SET text = ?2, words = ?3 WHERE id = ?1",
        params![id, text, words],
    )?;
    db.execute(
        "UPDATE segments_fts SET text = ?2 WHERE segment_id = ?1",
        params![id, text],
    )?;
    Ok(())
}

/// Signs off a low-confidence segment as correct.
pub fn mark_verified(db: &Connection, id: &str, verified: bool) -> Result<()> {
    db.execute(
        "UPDATE segments SET verified = ?2 WHERE id = ?1",
        params![id, verified as i64],
    )?;
    Ok(())
}

pub fn set_segment_speaker(db: &Connection, id: &str, speakers: Option<&str>) -> Result<()> {
    db.execute(
        "UPDATE segments SET speakers = ?2 WHERE id = ?1",
        params![id, speakers],
    )?;
    Ok(())
}

// -------------------------------------------------------------- speakers

/// Chosen to stay distinguishable to a colour-blind reader and legible on a
/// light ground.
pub const COLORS: [&str; 8] = [
    "#2563eb", "#c2410c", "#15803d", "#7c3aed", "#0891b2", "#b45309", "#be123c", "#4d7c0f",
];

pub fn insert_speaker(db: &Connection, speaker: &Speaker) -> Result<()> {
    db.execute(
        "INSERT INTO speakers (key, recording_id, name, color) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key, recording_id) DO NOTHING",
        params![
            speaker.key,
            speaker.recording_id,
            speaker.name,
            speaker.color
        ],
    )?;
    Ok(())
}

/// Removes the speakers of this recording that the new transcript has no use
/// for, leaving the rest — names included — exactly as they are.
///
/// **A re-run used to add and never take away.** Speakers were inserted with
/// `ON CONFLICT DO NOTHING`, which is what lets a renamed `Mluvčí 1` keep the
/// name a person gave it across a second transcription, and nothing anywhere
/// deleted the ones the new run did not produce. Transcribe a diarized
/// interview again with diarization off, or with fewer voices found, and the
/// recording kept named people with nothing they had said.
///
/// Not a blanket delete, for the reason above: the names are the part worth
/// keeping. What one cannot promise is that a kept name still belongs to the
/// same voice — clustering may hand `speaker_1` to somebody else between two
/// runs, and no code here can tell. Recorded rather than silently traded away.
pub fn keep_only_speakers(db: &Connection, recording_id: &str, keys: &[String]) -> Result<()> {
    let mut kept = String::new();
    for index in 0..keys.len() {
        if index > 0 {
            kept.push(',');
        }
        kept.push('?');
        kept.push_str(&(index + 2).to_string());
    }
    let sql = if keys.is_empty() {
        "DELETE FROM speakers WHERE recording_id = ?1".to_string()
    } else {
        format!("DELETE FROM speakers WHERE recording_id = ?1 AND key NOT IN ({kept})")
    };
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&recording_id];
    for key in keys {
        values.push(key);
    }
    db.execute(&sql, values.as_slice())?;
    Ok(())
}

/// Before re-running diarization, the previous split is discarded.
pub fn delete_speakers(db: &Connection, recording_id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM speakers WHERE recording_id = ?1",
        params![recording_id],
    )?;
    db.execute(
        "UPDATE segments SET speakers = NULL WHERE recording_id = ?1",
        params![recording_id],
    )?;
    Ok(())
}

pub fn speakers(db: &Connection, recording_id: &str) -> Result<Vec<Speaker>> {
    let mut st = db.prepare(
        "SELECT key, recording_id, name, color FROM speakers WHERE recording_id = ?1 ORDER BY key",
    )?;
    let rows = st.query_map(params![recording_id], |r| {
        Ok(Speaker {
            key: r.get(0)?,
            recording_id: r.get(1)?,
            name: r.get(2)?,
            color: r.get(3)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn rename_speaker(db: &Connection, recording_id: &str, key: &str, name: &str) -> Result<()> {
    db.execute(
        "UPDATE speakers SET name = ?3 WHERE recording_id = ?1 AND key = ?2",
        params![recording_id, key, name],
    )?;
    Ok(())
}

/// Diarization often splits one person in two — a change of loudness, a cough.
/// Merging is therefore a basic operation here, not a fringe one.
/// Removes a speaker and leaves what they said without a name.
///
/// Not a merge with nobody: a merge moves the blocks to another person, and
/// there may be no other person to move them to. The blocks stay exactly where
/// they are and lose only the name, which is the state the archive already has
/// for anything diarization could not place — so they turn up in the panel's
/// list of unnamed passages, where they can be given to somebody again. Nothing
/// about the transcript itself changes.
pub fn delete_speaker(db: &Connection, recording_id: &str, key: &str) -> Result<()> {
    // Both statements or neither: a speaker deleted while their blocks still
    // point at them would leave those blocks naming somebody who is gone.
    let tx = transaction_unless_in_one(db)?;
    db.execute(
        "UPDATE segments SET speakers = NULL WHERE recording_id = ?1 AND speakers = ?2",
        params![recording_id, key],
    )?;
    db.execute(
        "DELETE FROM speakers WHERE recording_id = ?1 AND key = ?2",
        params![recording_id, key],
    )?;
    commit(tx)
}

pub fn merge_speakers(
    db: &Connection,
    recording_id: &str,
    from_key: &str,
    to_key: &str,
) -> Result<()> {
    db.execute(
        "UPDATE segments SET speakers = ?3 WHERE recording_id = ?1 AND speakers = ?2",
        params![recording_id, from_key, to_key],
    )?;
    db.execute(
        "DELETE FROM speakers WHERE recording_id = ?1 AND key = ?2",
        params![recording_id, from_key],
    )?;
    Ok(())
}

// ------------------------------------------------------------- dictionary

pub fn dictionary(db: &Connection) -> Result<Vec<DictionaryEntry>> {
    // `napoveda` is not read any more; see the note on the table above.
    let mut st = db.prepare("SELECT id, search, replacement FROM dictionary ORDER BY search")?;
    let rows = st.query_map([], |r| {
        Ok(DictionaryEntry {
            id: r.get(0)?,
            find: r.get(1)?,
            replace: r.get(2)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn add_dictionary_entry(db: &Connection, entry: &DictionaryEntry) -> Result<()> {
    db.execute(
        "INSERT INTO dictionary (id, search, replacement) VALUES (?1, ?2, ?3)",
        params![entry.id, entry.find, entry.replace],
    )?;
    Ok(())
}

/// Rewrites an entry in place, keeping its id.
///
/// Without this, changing what a word should become would mean deleting the
/// entry and writing it again, which is a strange thing to ask of someone
/// fixing a typo.
pub fn update_dictionary_entry(db: &Connection, entry: &DictionaryEntry) -> Result<()> {
    db.execute(
        "UPDATE dictionary SET search = ?2, replacement = ?3 WHERE id = ?1",
        params![entry.id, entry.find, entry.replace],
    )?;
    Ok(())
}

pub fn delete_dictionary_entry(db: &Connection, id: &str) -> Result<()> {
    db.execute("DELETE FROM dictionary WHERE id = ?1", params![id])?;
    Ok(())
}

// ----------------------------------------------------------------- search

pub fn search(db: &Connection, query: &str) -> Result<Vec<SearchResult>> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(vec![]);
    }
    // The user types an ordinary word, not FTS syntax. Quoting prevents a
    // marks such as '-' or '"', and the star allows a prefix search.
    let safe = format!("\"{}\"*", trimmed_query.replace('"', ""));

    let mut st = db.prepare(
        "SELECT f.recording_id, n.name, f.segment_id, s.start_time,
                snippet(segments_fts, 0, '<<', '>>', '…', 12)
         FROM segments_fts f
         JOIN segments s ON s.id = f.segment_id
         JOIN recordings n ON n.id = f.recording_id
         WHERE segments_fts MATCH ?1
         ORDER BY rank
         LIMIT 100",
    )?;
    let rows = st.query_map(params![safe], |r| {
        Ok(SearchResult {
            recording_id: r.get(0)?,
            title: r.get(1)?,
            segment_id: r.get(2)?,
            start: r.get(3)?,
            text: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ---------------------------------------------------------------- backups

/// How many backups to keep. Three covers "I broke it yesterday" without the
/// folder quietly growing to the size of the archive several times over.
const BACKUPS_KEPT: usize = 3;
/// Beyond those, one backup per day is kept for this many days. Three copies
/// alone is a window measured in launches, not in time: this application is
/// opened far more often than it is left running, so four launches in one
/// morning could overwrite every copy of yesterday's good state — which is
/// exactly the state someone reaches for after a bad afternoon.
const DAILY_BACKUPS_KEPT: usize = 7;

/// The timestamp out of a name this module wrote, or nothing.
///
/// Only `volocal-YYYY-MM-DD-HHMMSS.db` counts, or `whisp-` for the ones taken
/// before the rename. A file somebody parked in the folder themselves —
/// `whisp-pred-upgradem.db`, an exported copy — is not
/// ours to rotate away, and the extension alone does not say whose it is.
/// Both prefixes, because a folder of backups outlives a rename.
///
/// New ones are written as `volocal-`; every one taken before today is
/// `whisp-`, and they are the same list — listed together, rotated together,
/// and offered together in the window. Renaming the files themselves would be
/// work for nothing: their names are read by this function and by nobody else.
fn backup_stamp(path: &std::path::Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stamp = name
        .strip_prefix("volocal-")
        .or_else(|| name.strip_prefix("whisp-"))?
        .strip_suffix(".db")?;
    let shape = "0000-00-00-000000";
    if stamp.len() != shape.len() {
        return None;
    }
    let matches = stamp.chars().zip(shape.chars()).all(|(c, s)| match s {
        '-' => c == '-',
        _ => c.is_ascii_digit(),
    });
    matches.then(|| stamp.to_string())
}

/// Which of these backups to throw away, given their stamps newest first.
///
/// Kept: the newest `BACKUPS_KEPT` whatever their date, and then the newest
/// backup of each of the last `DAILY_BACKUPS_KEPT` days. Everything else goes.
fn rotation_plan(stamps: &[String]) -> Vec<usize> {
    let mut days: Vec<&str> = Vec::new();
    let mut discard = Vec::new();
    for (index, stamp) in stamps.iter().enumerate() {
        let day = stamp.get(..10).unwrap_or(stamp.as_str());
        let first_of_its_day = !days.contains(&day);
        if first_of_its_day {
            days.push(day);
        }
        if index < BACKUPS_KEPT {
            continue;
        }
        if first_of_its_day && days.len() <= DAILY_BACKUPS_KEPT {
            continue;
        }
        discard.push(index);
    }
    discard
}

/// Where backups live: a folder beside the database itself. In portable mode
/// that travels with the flash drive, which is the point.
pub fn backup_directory(db_path: &std::path::Path) -> std::path::PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("backups")
}

/// Writes a copy of the whole database to `destination`.
///
/// `VACUUM INTO` rather than a file copy: the archive runs in WAL mode, so at
/// any moment part of the data sits in a side file and a plain copy could
/// capture a torn state. This produces one consistent, already compacted file,
/// and SQLite does the locking for us.
///
/// The destination must not exist — SQLite refuses to overwrite, which is a
/// feature here: a timestamped name can never clobber an older backup.
pub fn back_up(db: &Connection, destination: &std::path::Path) -> Result<()> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // The path goes into SQL as a literal, so single quotes have to be doubled.
    let quoted = destination.to_string_lossy().replace('\'', "''");
    db.execute_batch(&format!("VACUUM INTO '{quoted}'"))?;
    Ok(())
}

/// Backups this module wrote, newest first.
///
/// Ordered by the stamp in the name rather than by the file's own time. The
/// stamp is fixed width and zero padded, so comparing the text is comparing
/// the moment. A copied or restored folder can carry any modification time it
/// likes; the name is what the writer actually recorded.
pub fn list_backups(db_path: &std::path::Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(backup_directory(db_path)) else {
        return Vec::new();
    };
    let mut found: Vec<(String, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((backup_stamp(&e.path())?, e.path())))
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, p)| p).collect()
}

/// Makes a backup and throws away all but the newest few.
///
/// Returns the file that was written. Runs on whatever thread calls it and can
/// take a while on a large archive, so don't call it from the UI thread.
pub fn back_up_and_rotate(
    db: &Connection,
    db_path: &std::path::Path,
) -> Result<std::path::PathBuf> {
    back_up_and_rotate_at(db, db_path, chrono::Local::now())
}

/// The same, for a moment somebody names.
///
/// The clock is a parameter for one reason: the behaviour below is *two calls
/// inside one second*, and a test that calls twice and hopes the second hand
/// waits is a test that fails on whichever machine is slowest that morning.
/// It did, on 2026-08-13, on a pull request that changed two Markdown files —
/// `070456` and `070457`, a boundary crossed between two lines of the test.
///
/// Nothing else passes a moment in. `back_up_and_rotate` reads the clock, which
/// is where reading it belongs.
fn back_up_and_rotate_at(
    db: &Connection,
    db_path: &std::path::Path,
    when: chrono::DateTime<chrono::Local>,
) -> Result<std::path::PathBuf> {
    let stamp = when.format("%Y-%m-%d-%H%M%S");
    let destination = backup_directory(db_path).join(format!("volocal-{stamp}.db"));
    // A second call inside the same second finds the copy it was about to make
    // already sitting there, and that is an answer rather than a failure: what
    // was asked for is a backup of now, and there is one.
    //
    // Reported as an error until 2026-08-13, because `VACUUM INTO` refuses to
    // overwrite and the refusal reached the screen as `output file already
    // exists: Error code 1: SQL error or missing database`. Pressing *Zálohovat
    // teď* twice quickly is enough: the name is only accurate to the second,
    // and the button re-enables as soon as the first copy is written.
    //
    // Not fixed by widening the stamp. `backup_stamp` parses exactly
    // `0000-00-00-000000`, the rotation reads the moment out of that name, and
    // every backup already on every disk is written in it.
    //
    // Not fixed by overwriting either: `back_up` refuses to clobber on purpose,
    // so that a timestamped name can never land on an older copy.
    if !destination.is_file() {
        back_up(db, &destination)?;
    }

    let existing = list_backups(db_path);
    let stamps: Vec<String> = existing.iter().filter_map(|p| backup_stamp(p)).collect();
    for index in rotation_plan(&stamps) {
        let _ = std::fs::remove_file(&existing[index]);
    }
    Ok(destination)
}

#[cfg(test)]
mod backup_rotation_tests {
    use super::*;

    fn stamps(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// Four launches in one morning must not take yesterday's copy with them.
    #[test]
    fn several_launches_in_one_day_do_not_reach_an_older_day() {
        let all = stamps(&[
            "2026-08-04-104500",
            "2026-08-04-101500",
            "2026-08-04-093000",
            "2026-08-04-081500",
            "2026-08-03-190000",
            "2026-07-28-090000",
        ]);
        let discard = rotation_plan(&all);
        // Only the fourth copy of today goes: it is neither among the three
        // newest nor the first of its day.
        assert_eq!(discard, vec![3]);
    }

    /// The daily window has an end, or the folder grows for ever.
    #[test]
    fn days_beyond_the_window_are_discarded() {
        let mut all = Vec::new();
        for day in (1..=12).rev() {
            all.push(format!("2026-08-{day:02}-120000"));
        }
        let discard = rotation_plan(&all);
        // Twelve days, one copy each: the seven newest days survive.
        assert_eq!(discard, vec![7, 8, 9, 10, 11]);
    }

    /// A file the user parked there is not ours to delete.
    #[test]
    fn only_our_own_names_are_rotated() {
        assert_eq!(
            backup_stamp(std::path::Path::new("/x/volocal-2026-08-04-071530.db")),
            Some("2026-08-04-071530".to_string())
        );
        // Taken before the application was renamed, and part of the same list:
        // listed together, rotated together, offered together.
        assert_eq!(
            backup_stamp(std::path::Path::new("/x/whisp-2026-08-04-071530.db")),
            Some("2026-08-04-071530".to_string())
        );
        for foreign in [
            "/x/whisp-pred-upgradem.db",
            "/x/archiv.db",
            "/x/whisp-2026-08-04.db",
            "/x/volocal-2026-08-04-071530.db.bak",
        ] {
            assert_eq!(
                backup_stamp(std::path::Path::new(foreign)),
                None,
                "{foreign}"
            );
        }
    }

    /// Pressing *Zálohovat teď* twice in the same second.
    ///
    /// Reported from the running application on 2026-08-13: `output file
    /// already exists: Error code 1: SQL error or missing database`. The stamp
    /// in the name is only accurate to the second, and the button re-enables
    /// the moment the first copy is written, so two clicks land on one name.
    ///
    /// The moment is handed in rather than read twice from the clock. Read
    /// twice, this test says *the same second* and means *whatever the second
    /// hand did between these two lines*, which is not the same claim and not
    /// one a machine can keep.
    #[test]
    fn two_backups_in_the_same_second_are_one_backup_and_not_an_error() {
        let folder = std::env::temp_dir().join("volocal-backup-twice");
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        let archive = folder.join("volocal.db");
        let db = open(&archive).unwrap();

        let now = chrono::Local::now();
        let first = back_up_and_rotate_at(&db, &archive, now).unwrap();
        let second = back_up_and_rotate_at(&db, &archive, now).unwrap();

        assert_eq!(first, second, "the same second is the same copy");
        assert!(first.is_file());
        assert_eq!(
            list_backups(&archive).len(),
            1,
            "and it is one file, not two"
        );

        drop(db);
        let _ = std::fs::remove_dir_all(&folder);
    }

    /// The other half of the same promise, and the one a careless fix eats: a
    /// name is reused because it names this second, not because a backup
    /// already exists. Returning the newest copy whatever the time would pass
    /// the test above and quietly stop making backups.
    #[test]
    fn the_next_second_is_a_backup_of_its_own() {
        let folder = std::env::temp_dir().join("volocal-backup-next-second");
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        let archive = folder.join("volocal.db");
        let db = open(&archive).unwrap();

        let now = chrono::Local::now();
        let first = back_up_and_rotate_at(&db, &archive, now).unwrap();
        let later =
            back_up_and_rotate_at(&db, &archive, now + chrono::TimeDelta::seconds(1)).unwrap();

        assert_ne!(first, later, "a different second is a different copy");
        assert_eq!(list_backups(&archive).len(), 2, "and both are on disk");

        drop(db);
        let _ = std::fs::remove_dir_all(&folder);
    }
}

#[cfg(test)]
mod cluster_threshold_migration_tests {
    use super::*;

    fn archive() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .unwrap();
        db
    }

    #[test]
    fn an_untouched_threshold_is_raised_once() {
        let db = archive();
        let settings = Settings {
            cluster_threshold: 0.5,
            ..Default::default()
        };
        save_settings(&db, &settings).unwrap();

        assert!(raise_cluster_threshold_once(&db).unwrap());
        assert_eq!(load_settings(&db).unwrap().cluster_threshold, 0.8);

        // Idempotent: a second start must not touch it again, and must not
        // undo a value the user has since chosen.
        let mut chosen = load_settings(&db).unwrap();
        chosen.cluster_threshold = 0.62;
        save_settings(&db, &chosen).unwrap();
        assert!(!raise_cluster_threshold_once(&db).unwrap());
        assert_eq!(load_settings(&db).unwrap().cluster_threshold, 0.62);
    }

    #[test]
    fn a_deliberately_chosen_threshold_is_left_alone() {
        let db = archive();
        let settings = Settings {
            cluster_threshold: 0.35,
            ..Default::default()
        };
        save_settings(&db, &settings).unwrap();

        assert!(!raise_cluster_threshold_once(&db).unwrap());
        assert_eq!(load_settings(&db).unwrap().cluster_threshold, 0.35);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ai_outputs, align_word_timestamps, clear_second_language, create_folder, delete_folder,
        delete_recording, delete_recording_note, delete_segments, delete_speaker, dictionary,
        folder_recording_ids, folders, has_table, insert_recording, insert_recording_note,
        insert_segment, insert_speaker, keep_only_speakers, list_recordings, load_settings,
        look_at_offered_archive, metadata_value, migrate_legacy_schema, move_to_folder, open,
        recording, recording_notes, recover_interrupted, save_ai_document, save_ai_output,
        save_metadata_value, save_second_language, search, second_language, second_language_state,
        segments, set_second_language_state, speakers, status, update_recording_note,
        watch_file_imported, watch_file_is_stable, waveform, AiDocument, AiOutput,
        ArchiveFromTheFuture, Offered, Recording, RecordingNote, SecondLanguage, Segment, Speaker,
        WaveformData,
    };
    use rusqlite::{params, Connection};

    fn segment(start: f64, end: f64, words: &str) -> Segment {
        Segment {
            id: "segment".into(),
            recording_id: "recording".into(),
            order: 0,
            start,
            end,
            text: String::new(),
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            words: Some(words.into()),
            original: None,
            language: None,
        }
    }

    /// Every column `segments()` reads has to be one `insert_segment` writes.
    /// `run_diarization` and the sentence-layout upgrade both delete a
    /// recording's segments and put them back from values they already hold,
    /// so a column missing from the INSERT is not a gap — it is deletion.
    #[test]
    fn a_segment_keeps_every_column_it_was_given() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();

        let mut written = segment(1.0, 2.0, r#"[{"s":"ahoj","t":1.0}]"#);
        written.text = "Ahoj světe".into();
        written.speakers = Some("Mluvčí 1".into());
        written.confidence = Some(0.71);
        written.edited = true;
        written.verified = true;
        written.original = Some("Ahoj světe".into());
        written.language = Some("en".into());
        insert_segment(&db, &written).unwrap();

        let read = segments(&db, "recording").unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].text, written.text);
        assert_eq!(read[0].speakers, written.speakers);
        assert_eq!(read[0].confidence, written.confidence);
        assert_eq!(read[0].edited, written.edited);
        assert_eq!(read[0].verified, written.verified);
        assert_eq!(read[0].words, written.words);
        assert_eq!(
            read[0].original, written.original,
            "what the machine wrote is what the corrections list is built from"
        );
        assert_eq!(
            read[0].language, written.language,
            "a block the second-language pass wrote has to still say so after a rewrite"
        );
    }

    /// Every transcript written before the second-language pass existed says
    /// nothing about its language, and must go on saying nothing rather than
    /// claiming one.
    #[test]
    fn a_segment_nobody_stamped_has_no_language() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();
        insert_segment(&db, &segment(0.0, 1.0, r#"[{"s":"ahoj","t":0.0}]"#)).unwrap();
        assert_eq!(segments(&db, "recording").unwrap()[0].language, None);
    }

    // ------------------------------------------------------ a second language

    const SECOND_LANGUAGE_SCHEMA: &str = "CREATE TABLE second_language (
           recording_id  TEXT PRIMARY KEY,
           language      TEXT NOT NULL,
           share         REAL NOT NULL,
           state         TEXT NOT NULL,
           filled_at     TEXT
         );";

    fn offered(language: &str, share: f64) -> SecondLanguage {
        SecondLanguage {
            recording_id: "recording".into(),
            language: language.into(),
            share,
            state: second_language_state::OFFERED.into(),
            filled_at: None,
        }
    }

    #[test]
    fn a_recording_nobody_swept_offers_nothing() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SECOND_LANGUAGE_SCHEMA).unwrap();
        assert_eq!(second_language(&db, "recording").unwrap(), None);
    }

    #[test]
    fn an_offer_reads_back_as_it_was_written() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SECOND_LANGUAGE_SCHEMA).unwrap();
        let found = offered("en", 0.21);
        save_second_language(&db, &found).unwrap();
        assert_eq!(second_language(&db, "recording").unwrap(), Some(found));
    }

    /// A refusal is an answer about this transcript, so it is kept — and it is
    /// not a moment, so it stamps no time.
    #[test]
    fn a_refusal_is_remembered_and_stamps_no_time() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SECOND_LANGUAGE_SCHEMA).unwrap();
        save_second_language(&db, &offered("en", 0.21)).unwrap();
        set_second_language_state(&db, "recording", second_language_state::REFUSED).unwrap();

        let after = second_language(&db, "recording").unwrap().unwrap();
        assert_eq!(after.state, second_language_state::REFUSED);
        assert_eq!(after.filled_at, None);
        assert_eq!(
            after.language, "en",
            "refusing does not forget what was found"
        );
    }

    #[test]
    fn filling_stamps_when_it_happened() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SECOND_LANGUAGE_SCHEMA).unwrap();
        save_second_language(&db, &offered("en", 0.21)).unwrap();
        set_second_language_state(&db, "recording", second_language_state::FILLED).unwrap();

        let after = second_language(&db, "recording").unwrap().unwrap();
        assert_eq!(after.state, second_language_state::FILLED);
        assert!(after.filled_at.is_some());
    }

    /// A new transcript is a new question. A refusal recorded against text that
    /// no longer exists is not an answer to it.
    #[test]
    fn a_fresh_sweep_replaces_the_answer_to_the_old_one() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SECOND_LANGUAGE_SCHEMA).unwrap();
        save_second_language(&db, &offered("en", 0.21)).unwrap();
        set_second_language_state(&db, "recording", second_language_state::REFUSED).unwrap();

        save_second_language(&db, &offered("de", 0.44)).unwrap();
        let after = second_language(&db, "recording").unwrap().unwrap();
        assert_eq!(after.state, second_language_state::OFFERED);
        assert_eq!(after.language, "de");
    }

    /// **The one that is easy to get wrong.** Separating speakers deletes every
    /// segment of a recording and writes them back — and so does the
    /// sentence-layout upgrade. Neither is a new transcript, so neither may
    /// throw away a question the reader has not answered yet.
    #[test]
    fn rewriting_the_segments_does_not_forget_the_offer() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();
        db.execute_batch(SECOND_LANGUAGE_SCHEMA).unwrap();
        insert_segment(&db, &segment(0.0, 1.0, r#"[{"s":"ahoj","t":0.0}]"#)).unwrap();
        save_second_language(&db, &offered("en", 0.21)).unwrap();

        delete_segments(&db, "recording").unwrap();

        assert!(
            second_language(&db, "recording").unwrap().is_some(),
            "pressing Rozpoznat znovu must not answer a question nobody asked"
        );
    }

    /// What the footer and the archive read: the language that is really in the
    /// text. An offer the reader has not answered is not in the text yet.
    #[test]
    fn a_filled_language_is_read_with_the_recording_and_an_offered_one_is_not() {
        let dir = std::env::temp_dir().join(format!("volocal-second-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = open(&dir.join("volocal.db")).unwrap();
        insert_recording(
            &db,
            &Recording {
                id: "recording".into(),
                path: "x.wav".into(),
                title: "x".into(),
                duration: 1.0,
                created_at: "2026-09-02".into(),
                status: status::DONE.into(),
                model: String::new(),
                language: "cs".into(),
                language_choice: String::new(),
                second_language_choice: String::new(),
                error: None,
                segment_count: 0,
                folder: None,
                source_url: None,
                second_language: None,
            },
        )
        .unwrap();
        save_second_language(&db, &offered("en", 0.2)).unwrap();
        assert_eq!(recording(&db, "recording").unwrap().second_language, None);
        set_second_language_state(&db, "recording", second_language_state::FILLED).unwrap();
        assert_eq!(
            recording(&db, "recording")
                .unwrap()
                .second_language
                .as_deref(),
            Some("en")
        );
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discarding_the_transcript_forgets_the_offer() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SECOND_LANGUAGE_SCHEMA).unwrap();
        save_second_language(&db, &offered("en", 0.21)).unwrap();
        clear_second_language(&db, "recording").unwrap();
        assert_eq!(second_language(&db, "recording").unwrap(), None);
    }

    /// An archive written before this existed has no `language` column. It
    /// gains one, and every block already in it goes on saying nothing.
    #[test]
    fn a_transcript_from_an_older_build_gains_the_language_column() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE segments (
               id           TEXT PRIMARY KEY,
               recording_id  TEXT NOT NULL,
               position       INTEGER NOT NULL,
               start_time      REAL NOT NULL,
               end_time        REAL NOT NULL,
               text         TEXT NOT NULL,
               speakers       TEXT,
               confidence      REAL,
               edited     INTEGER NOT NULL DEFAULT 0
             );
             CREATE VIRTUAL TABLE segments_fts USING fts5(
               text, segment_id UNINDEXED, recording_id UNINDEXED
             );",
        )
        .unwrap();
        db.execute(
            "INSERT INTO segments (id, recording_id, position, start_time, end_time, text)
             VALUES ('s', 'recording', 0, 0.0, 1.0, 'Dobrý den')",
            [],
        )
        .unwrap();

        migrate_legacy_schema(&db);

        let read = segments(&db, "recording").unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].text, "Dobrý den");
        assert_eq!(read[0].language, None);
    }

    /// Recognising speakers rewrites who said what and nothing else. It does
    /// that by deleting every segment and inserting them again, so this is the
    /// path where a hand-corrected transcript is most easily damaged.
    #[test]
    fn rewriting_the_speakers_does_not_lose_the_corrections() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();

        let mut corrected = segment(1.0, 2.0, r#"[{"s":"ahoj","t":1.0}]"#);
        corrected.text = "součást DNA".into();
        corrected.original = Some("součas DNA".into());
        corrected.edited = true;
        insert_segment(&db, &corrected).unwrap();

        // What `run_diarization` does: read, assign speakers, delete, re-insert.
        let mut again = segments(&db, "recording").unwrap();
        again[0].speakers = Some("Mluvčí 2".into());
        delete_segments(&db, "recording").unwrap();
        for s in &again {
            insert_segment(&db, s).unwrap();
        }

        let read = segments(&db, "recording").unwrap();
        assert_eq!(read[0].speakers.as_deref(), Some("Mluvčí 2"));
        assert_eq!(read[0].text, "součást DNA");
        assert_eq!(
            read[0].original.as_deref(),
            Some("součas DNA"),
            "the correction survives a round trip through the speaker pass"
        );
    }

    // ------------------------------------------ the schema stopped being Czech

    /// A database file of its own, removed when the test ends.
    ///
    /// The rest of these tests are happy in memory; this one is not, because
    /// what it checks is what happens the *second* time a file is opened.
    /// Written here rather than by taking a dependency for three tests.
    struct TempDb(std::path::PathBuf);

    impl TempDb {
        fn new(tag: &str) -> Self {
            static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("volocal-{tag}-{n}.db"));
            let _ = std::fs::remove_file(&path);
            Self(path)
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            // WAL leaves two more files beside the one that was asked for, and
            // the migration leaves the copy it took before renaming anything.
            let stem = self
                .0
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let _ =
                std::fs::remove_file(self.0.with_file_name(format!("{stem}-before-english.db")));
            for suffix in ["", "-wal", "-shm"] {
                let mut name = self.0.clone().into_os_string();
                name.push(suffix);
                let _ = std::fs::remove_file(std::path::PathBuf::from(name));
            }
        }
    }

    /// An archive as 1.0.4 wrote it, with one recording, one segment, one
    /// speaker, one note and one row in the search index.
    ///
    /// Written out in full rather than built from the current schema, because
    /// the point is to be the shape that is on the reader's disk today — a
    /// fixture derived from the code under test would follow it wherever it
    /// goes and prove nothing.
    fn czech_archive(path: &std::path::Path) -> Connection {
        let db = Connection::open(path).unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE slozky (id TEXT PRIMARY KEY, nazev TEXT NOT NULL, vytvoreno TEXT NOT NULL);
             CREATE TABLE nahravky (
                 id TEXT PRIMARY KEY, cesta TEXT NOT NULL, nazev TEXT NOT NULL,
                 delka REAL NOT NULL DEFAULT 0, vytvoreno TEXT NOT NULL,
                 stav TEXT NOT NULL DEFAULT 'nova', model TEXT NOT NULL DEFAULT '',
                 chyba TEXT,
                 slozka TEXT REFERENCES slozky(id) ON DELETE SET NULL);
             CREATE TABLE segmenty (
                 id TEXT PRIMARY KEY,
                 nahravka_id TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
                 poradi INTEGER NOT NULL, zacatek REAL NOT NULL, konec REAL NOT NULL,
                 text TEXT NOT NULL, mluvci TEXT, jistota REAL,
                 upraveno INTEGER NOT NULL DEFAULT 0, slova TEXT,
                 overeno INTEGER NOT NULL DEFAULT 0, puvodni TEXT);
             CREATE INDEX idx_segmenty_nahravka ON segmenty(nahravka_id, poradi);
             CREATE TABLE mluvci (
                 klic TEXT NOT NULL,
                 nahravka_id TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
                 jmeno TEXT NOT NULL, barva TEXT NOT NULL,
                 PRIMARY KEY (klic, nahravka_id));
             CREATE TABLE poznamky (
                 id TEXT PRIMARY KEY,
                 nahravka_id TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
                 cas REAL NOT NULL DEFAULT 0, text TEXT NOT NULL,
                 hotovo INTEGER NOT NULL DEFAULT 0, vytvoreno TEXT NOT NULL,
                 pinned INTEGER NOT NULL DEFAULT 1);
             CREATE INDEX idx_poznamky_nahravka ON poznamky(nahravka_id, cas, vytvoreno);
             CREATE TABLE slovnik (id TEXT PRIMARY KEY, hledat TEXT NOT NULL,
                 nahradit TEXT NOT NULL, napoveda INTEGER NOT NULL DEFAULT 1);
             CREATE TABLE krivky (
                 nahravka_id TEXT PRIMARY KEY REFERENCES nahravky(id) ON DELETE CASCADE,
                 body BLOB NOT NULL, na_sekundu REAL NOT NULL DEFAULT 12,
                 equalizer BLOB NOT NULL DEFAULT X'',
                 equalizer_points_per_second REAL NOT NULL DEFAULT 10,
                 equalizer_band_count INTEGER NOT NULL DEFAULT 24);
             CREATE TABLE klice (klic TEXT PRIMARY KEY, hodnota TEXT NOT NULL);
             CREATE VIRTUAL TABLE segmenty_fts USING fts5(
                 text, segment_id UNINDEXED, nahravka_id UNINDEXED,
                 tokenize = 'unicode61 remove_diacritics 2');

             INSERT INTO slozky VALUES ('f1', 'Rozhovory', '2026-08-01');
             INSERT INTO nahravky VALUES
                 ('r1', 'C:\\zvuk.mp3', 'Janka', 2704.0, '2026-08-01', 'hotova', 'large-v3', NULL, 'f1');
             INSERT INTO segmenty VALUES
                 ('s1', 'r1', 0, 2347.34, 2350.0, 'když nastal ten okamžik', 'speaker_0',
                  0.91, 0, NULL, 0, NULL);
             INSERT INTO mluvci VALUES ('speaker_0', 'r1', 'Janka Bílá', '#1f6feb');
             INSERT INTO poznamky VALUES ('p1', 'r1', 12.5, 'ověřit jméno', 0, '2026-08-02', 1);
             INSERT INTO slovnik VALUES ('d1', 'volokal', 'Volocal', 1);
             INSERT INTO klice VALUES ('jazyk-rozpoznavani', 'ano');
             INSERT INTO segmenty_fts VALUES ('když nastal ten okamžik', 's1', 'r1');",
        )
        .unwrap();
        db
    }

    /// What is in an archive is what has to come out of it. Every table, and
    /// the two things a rename is most likely to lose on the way: the foreign
    /// keys, which SQLite only rewrites when they are switched on, and the
    /// full-text index, which cannot be renamed at all and is rebuilt instead.
    #[test]
    fn an_archive_written_in_czech_opens_with_everything_in_it() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        drop(czech_archive(&path));

        let db = open(&path).unwrap();

        let (name, status, folder_id): (String, String, Option<String>) = db
            .query_row(
                "SELECT name, status, folder_id FROM recordings WHERE id = 'r1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "Janka");
        assert_eq!(
            status, "done",
            "the Czech status was migrated with the Czech schema"
        );
        assert_eq!(folder_id.as_deref(), Some("f1"));

        let segment = segments(&db, "r1").unwrap();
        assert_eq!(segment.len(), 1);
        assert_eq!(segment[0].text, "když nastal ten okamžik");
        assert_eq!(segment[0].start, 2347.34);
        assert_eq!(segment[0].speakers.as_deref(), Some("speaker_0"));
        assert_eq!(segment[0].confidence, Some(0.91));

        let speaker = speakers(&db, "r1").unwrap();
        assert_eq!(speaker[0].name, "Janka Bílá");
        assert_eq!(speaker[0].color, "#1f6feb");

        let note = recording_notes(&db, "r1").unwrap();
        assert_eq!(note[0].text, "ověřit jméno");

        let entries = dictionary(&db).unwrap();
        assert_eq!(entries[0].replace, "Volocal");

        // Searching an old transcript still finds it: the index was dropped
        // with the schema and refilled from the segments.
        let hits = search(&db, "okamžik").unwrap();
        assert_eq!(hits.len(), 1, "the search index was rebuilt");
        assert_eq!(hits[0].recording_id, "r1");

        // The reference survived the rename, which it only does when foreign
        // keys are on while the table is renamed.
        db.execute("DELETE FROM recordings WHERE id = 'r1'", [])
            .unwrap();
        assert!(
            segments(&db, "r1").unwrap().is_empty(),
            "ON DELETE CASCADE still holds"
        );

        // And the way back exists: a copy of the archive as it was, which an
        // older build can still read.
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        let copy = path.with_file_name(format!("{stem}-before-english.db"));
        assert!(copy.exists(), "a copy was left before the rename");
        let old = Connection::open(&copy).unwrap();
        let kept: String = old
            .query_row("SELECT nazev FROM nahravky WHERE id = 'r1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            kept, "Janka",
            "and it is still the Czech schema, with the data in it"
        );
        drop(old);
        let _ = std::fs::remove_file(&copy);
    }

    /// Opening it twice must not try to rename anything the second time.
    #[test]
    fn the_rename_happens_once_and_the_second_open_is_ordinary() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        drop(czech_archive(&path));
        drop(open(&path).unwrap());

        let db = open(&path).unwrap();
        assert_eq!(segments(&db, "r1").unwrap().len(), 1);
        assert!(!has_table(&db, "nahravky").unwrap());
        let indexed: i64 = db
            .query_row("SELECT count(*) FROM segments_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(indexed, 1, "and the index is not filled a second time");
    }

    /// The state that actually happened, on the owner's own machine, the day
    /// 1.0.5 went out: migrate, then open the archive once with an older build.
    ///
    /// That build looks for `nahravky`, does not find it, and its own
    /// `CREATE TABLE IF NOT EXISTS` makes an empty one beside `recordings`. The
    /// next start found both, tried to rename one onto the other, and refused
    /// to open the archive at all — `there is already another table or index
    /// with this name: recordings`.
    #[test]
    fn an_archive_an_older_build_reopened_is_repaired_rather_than_refused() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        drop(czech_archive(&path));
        drop(open(&path).unwrap());

        // What the older build does on its way past: the empty Czech shells.
        let older = Connection::open(&path).unwrap();
        older
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS nahravky (
                     id TEXT PRIMARY KEY, cesta TEXT NOT NULL, nazev TEXT NOT NULL,
                     delka REAL NOT NULL DEFAULT 0, vytvoreno TEXT NOT NULL,
                     stav TEXT NOT NULL DEFAULT 'nova', model TEXT NOT NULL DEFAULT '',
                     chyba TEXT, slozka TEXT);
                 CREATE TABLE IF NOT EXISTS mluvci (
                     klic TEXT NOT NULL, nahravka_id TEXT NOT NULL,
                     jmeno TEXT NOT NULL, barva TEXT NOT NULL,
                     PRIMARY KEY (klic, nahravka_id));
                 CREATE TABLE IF NOT EXISTS klice (klic TEXT PRIMARY KEY, hodnota TEXT NOT NULL);",
            )
            .unwrap();
        drop(older);

        let db = open(&path).unwrap();

        assert!(!has_table(&db, "nahravky").unwrap(), "the shell is gone");
        assert!(!has_table(&db, "mluvci").unwrap());
        assert!(!has_table(&db, "klice").unwrap());
        assert_eq!(
            segments(&db, "r1").unwrap().len(),
            1,
            "and the work is still there"
        );
        assert_eq!(speakers(&db, "r1").unwrap()[0].name, "Janka Bílá");
    }

    /// And if somebody added a recording in that older build before coming
    /// back, that recording is theirs and has to survive the repair.
    #[test]
    fn work_done_in_the_older_build_is_carried_over_before_the_shell_is_dropped() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        drop(czech_archive(&path));
        drop(open(&path).unwrap());

        let older = Connection::open(&path).unwrap();
        older
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS nahravky (
                     id TEXT PRIMARY KEY, cesta TEXT NOT NULL, nazev TEXT NOT NULL,
                     delka REAL NOT NULL DEFAULT 0, vytvoreno TEXT NOT NULL,
                     stav TEXT NOT NULL DEFAULT 'nova', model TEXT NOT NULL DEFAULT '',
                     chyba TEXT, slozka TEXT);
                 INSERT INTO nahravky (id, cesta, nazev, delka, vytvoreno, stav, model)
                 VALUES ('r2', 'C:\\pozdejsi.mp3', 'Přidáno ve staré verzi', 60.0,
                         '2026-08-12', 'nova', '');",
            )
            .unwrap();
        drop(older);

        let db = open(&path).unwrap();

        let names: Vec<String> = db
            .prepare("SELECT name FROM recordings ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(names, vec!["Janka", "Přidáno ve staré verzi"]);
        assert!(!has_table(&db, "nahravky").unwrap());
    }

    /// An archive carries the schema it was written for, so that a build older
    /// than it can say so rather than guess.
    #[test]
    fn opening_an_archive_writes_down_which_schema_it_now_has() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        let db = open(&path).unwrap();
        assert_eq!(
            metadata_value(&db, "schema-version").unwrap().as_deref(),
            Some("3")
        );
    }

    /// The four stored values, on an archive that has one recording in each.
    ///
    /// Written as a whole set rather than one example, because the failure this
    /// guards against is a partial rename: three statuses migrated and the
    /// fourth left in Czech shows a dot with no colour and a screen offering
    /// the wrong buttons, and nothing anywhere fails.
    #[test]
    fn every_czech_status_becomes_its_english_name() {
        let temp = TempDb::new("statuses");
        let path = temp.0.clone();
        {
            let old = Connection::open(&path).unwrap();
            old.execute_batch(
                "CREATE TABLE recordings (
                     id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
                     duration REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                     status TEXT NOT NULL DEFAULT 'nova', model TEXT NOT NULL DEFAULT '',
                     error TEXT, folder_id TEXT);
                 INSERT INTO recordings (id, path, name, created_at, status) VALUES
                     ('a', 'C:\\a.mp3', 'A', '2026-08-01', 'nova'),
                     ('b', 'C:\\b.mp3', 'B', '2026-08-01', 'prepisuje'),
                     ('c', 'C:\\c.mp3', 'C', '2026-08-01', 'hotova'),
                     ('d', 'C:\\d.mp3', 'D', '2026-08-01', 'chyba');",
            )
            .unwrap();
        }

        let db = open(&path).unwrap();
        let read = |id: &str| -> String {
            db.query_row(
                "SELECT status FROM recordings WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(read("a"), status::NEW);
        assert_eq!(read("b"), status::TRANSCRIBING);
        assert_eq!(read("c"), status::DONE);
        assert_eq!(read("d"), status::FAILED);

        // And nothing else moved: four recordings in, four out, names intact.
        let names: Vec<String> = db
            .prepare("SELECT name FROM recordings ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(names, vec!["A", "B", "C", "D"]);
    }

    /// Opening twice is the ordinary case — every launch after the first one.
    #[test]
    fn an_archive_already_in_english_is_left_alone() {
        let temp = TempDb::new("statuses-again");
        let path = temp.0.clone();
        {
            let db = open(&path).unwrap();
            db.execute(
                "INSERT INTO recordings (id, path, name, created_at, status)
                 VALUES ('a', 'C:\\a.mp3', 'A', '2026-08-01', ?1)",
                params![status::DONE],
            )
            .unwrap();
        }

        let db = open(&path).unwrap();
        let stored: String = db
            .query_row("SELECT status FROM recordings WHERE id = 'a'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored, status::DONE);
    }

    /// The whole point of writing it down: what happens to the build that meets
    /// an archive from the future.
    ///
    /// 1.0.4 met 1.0.5's archive, did not recognise it, and made empty tables —
    /// which would have shown its owner an archive with nothing in it. This is
    /// the opposite: refuse, say why, and touch nothing.
    #[test]
    fn an_archive_from_a_newer_version_is_refused_and_left_alone() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        {
            let db = open(&path).unwrap();
            save_metadata_value(&db, "schema-version", "99").unwrap();
        }

        let refused = open(&path).unwrap_err();
        let named = refused
            .downcast_ref::<ArchiveFromTheFuture>()
            .expect("the window has to tell this apart from a damaged archive");
        assert_eq!(named.found, 99);
        assert_eq!(named.known, 3);

        // And nothing was done to it on the way out.
        let db = Connection::open(&path).unwrap();
        let value: String = db
            .query_row(
                "SELECT value FROM settings WHERE key = 'schema-version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(value, "99", "the archive is untouched");
    }

    /// An archive written before any of this has no number, and is simply the
    /// schema it was written in — not a stranger to be refused.
    #[test]
    fn an_archive_with_no_number_at_all_is_opened_and_given_one() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        drop(czech_archive(&path));

        let db = open(&path).unwrap();

        assert_eq!(segments(&db, "r1").unwrap().len(), 1);
        assert_eq!(
            metadata_value(&db, "schema-version").unwrap().as_deref(),
            Some("3")
        );
    }

    /// A fresh archive has nothing to rename and must not be slowed or touched.
    #[test]
    fn a_new_archive_is_created_in_english_with_no_rename() {
        let temp = TempDb::new("archive");
        let path = temp.0.clone();
        let db = open(&path).unwrap();
        assert!(has_table(&db, "recordings").unwrap());
        assert!(!has_table(&db, "nahravky").unwrap());
    }

    /// Enough of `speakers` to delete a row from it. The real table has a foreign
    /// key into `recordings`, which these tests do not create.
    const SPEAKER_SCHEMA: &str = "CREATE TABLE speakers (
           key         TEXT NOT NULL,
           recording_id  TEXT NOT NULL,
           name        TEXT NOT NULL,
           color        TEXT NOT NULL,
           PRIMARY KEY (key, recording_id)
         );";

    /// **A damaged row used to make a recording vanish.** `filter_map(ok)`
    /// dropped it in silence, and the archive then showed the recording as
    /// simply not being there - which a reader can only take as somebody
    /// having deleted it. One bad row must not blank the whole archive either,
    /// so it comes back as a card that says what happened.
    #[test]
    fn a_row_that_cannot_be_read_is_shown_as_damaged_rather_than_hidden() {
        // A real archive, because what is being tested is the row mapper
        // against the columns it actually reads.
        let temp = TempDb::new("list-damaged");
        let db = open(&temp.0).unwrap();

        for id in ["good", "broken"] {
            insert_recording(
                &db,
                &Recording {
                    id: id.into(),
                    path: format!("C:/{id}.wav"),
                    title: id.into(),
                    duration: 1.0,
                    created_at: "2026-08-20 10:00:00".into(),
                    status: status::DONE.into(),
                    model: String::new(),
                    language: String::new(),
                    language_choice: String::new(),
                    second_language_choice: String::new(),
                    second_language: None,
                    error: None,
                    segment_count: 0,
                    folder: None,
                    source_url: None,
                },
            )
            .unwrap();
        }
        /* The damage SQLite permits and the row mapper refuses. `NOT NULL`
        rules out a missing value, but not a wrong *type*: a column with TEXT
        affinity keeps a BLOB as a BLOB, and reading it as a string fails.
        That is a torn write or a half-restored file, and it is the shape a
        real archive comes back damaged in. */
        db.execute(
            "UPDATE recordings SET name = x'00ff' WHERE id = 'broken'",
            [],
        )
        .unwrap();

        let listed = list_recordings(&db).unwrap();

        assert_eq!(listed.len(), 2, "nothing disappears: {listed:?}");
        let broken = listed
            .iter()
            .find(|r| r.id == "broken")
            .expect("still listed");
        assert_eq!(broken.status, status::FAILED);
        assert!(
            broken
                .error
                .as_deref()
                .is_some_and(|text| text.contains("archive.row_unreadable")),
            "and it says what is wrong: {:?}",
            broken.error
        );
        assert!(
            listed
                .iter()
                .any(|r| r.id == "good" && r.status == status::DONE),
            "the healthy row is untouched"
        );
    }

    /// **Where an import came from is the one thing about it that cannot be
    /// recovered afterwards.** The file the downloader leaves behind is named
    /// after the video's title and carries nothing else, so a transcript made
    /// from a link whose address was not stored has no way back to it.
    #[test]
    fn a_recording_keeps_the_address_it_was_imported_from() {
        let temp = TempDb::new("source-url");
        let db = open(&temp.0).unwrap();
        let link = "https://www.youtube.com/watch?v=test";

        insert_recording(
            &db,
            &Recording {
                id: "imported".into(),
                path: "C:/recordings/Talk.m4a".into(),
                title: "Talk".into(),
                duration: 61.0,
                created_at: "2026-08-20 11:00:00".into(),
                status: status::NEW.into(),
                model: String::new(),
                language: String::new(),
                language_choice: String::new(),
                second_language_choice: String::new(),
                second_language: None,
                error: None,
                segment_count: 0,
                folder: None,
                source_url: Some(link.into()),
            },
        )
        .unwrap();

        assert_eq!(
            recording(&db, "imported").unwrap().source_url.as_deref(),
            Some(link)
        );
        // And through the listing as well, which is a second query over the
        // same columns and has been the one to fall behind before.
        let listed = list_recordings(&db).unwrap();
        assert_eq!(listed[0].source_url.as_deref(), Some(link));
    }

    /// An archive written before the column existed gets it on the next start,
    /// and the recordings already in it stay honest: their address was thrown
    /// away at import time, so NULL is what is true about them.
    #[test]
    fn recordings_from_before_the_column_have_no_address_rather_than_a_wrong_one() {
        let temp = TempDb::new("source-url-older");
        let path = temp.0.clone();
        {
            let older = Connection::open(&path).unwrap();
            older
                .execute_batch(
                    "CREATE TABLE recordings (
                         id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
                         duration REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                         status TEXT NOT NULL DEFAULT 'new', model TEXT NOT NULL DEFAULT '',
                         error TEXT, folder_id TEXT);
                     INSERT INTO recordings (id, path, name, created_at, status)
                         VALUES ('older', 'C:\\older.m4a', 'Older', '2026-08-01', 'done');",
                )
                .unwrap();
        }

        let db = open(&path).unwrap();
        let carried = recording(&db, "older").unwrap();
        assert_eq!(carried.title, "Older", "the row itself is untouched");
        assert_eq!(carried.source_url, None);

        // The archive still says schema 3: a column added at the end changes
        // nothing an older build reads, and refusing it would cost more than
        // this value is worth.
        assert_eq!(
            metadata_value(&db, "schema-version").unwrap().as_deref(),
            Some("3")
        );

        // An import made after the migration stores its address beside the row
        // that has none, and the two are told apart.
        insert_recording(
            &db,
            &Recording {
                id: "newer".into(),
                path: "C:/newer.m4a".into(),
                title: "Newer".into(),
                duration: 1.0,
                created_at: "2026-08-20 12:00:00".into(),
                status: status::NEW.into(),
                model: String::new(),
                language: String::new(),
                language_choice: String::new(),
                second_language_choice: String::new(),
                second_language: None,
                error: None,
                segment_count: 0,
                folder: None,
                source_url: Some("https://example.com/talk".into()),
            },
        )
        .unwrap();
        assert_eq!(
            recording(&db, "newer").unwrap().source_url.as_deref(),
            Some("https://example.com/talk")
        );
        assert_eq!(recording(&db, "older").unwrap().source_url, None);
    }

    /// **A re-run used to add speakers and never take any away.** Transcribe a
    /// diarized interview again with fewer voices found, or with diarization
    /// off, and the recording kept named people with nothing in the transcript
    /// they had said.
    #[test]
    fn a_second_transcript_keeps_only_the_speakers_it_found() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SPEAKER_SCHEMA).unwrap();

        for (key, name) in [
            ("speaker_0", "Jana"),
            ("speaker_1", "Mluvčí 2"),
            ("speaker_2", "Mluvčí 3"),
        ] {
            insert_speaker(
                &db,
                &Speaker {
                    key: key.into(),
                    recording_id: "r".into(),
                    name: name.into(),
                    color: "#000".into(),
                },
            )
            .unwrap();
        }

        keep_only_speakers(&db, "r", &["speaker_0".to_string()]).unwrap();

        let left = speakers(&db, "r").unwrap();
        assert_eq!(left.len(), 1, "only the voice this run found is left");
        assert_eq!(
            left[0].name, "Jana",
            "and the name a person typed survives the re-run"
        );
    }

    /// Diarization turned off finds no voices at all, and then none may stay.
    #[test]
    fn a_transcript_with_no_voices_keeps_no_speakers() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SPEAKER_SCHEMA).unwrap();
        insert_speaker(
            &db,
            &Speaker {
                key: "speaker_0".into(),
                recording_id: "r".into(),
                name: "Jana".into(),
                color: "#000".into(),
            },
        )
        .unwrap();

        keep_only_speakers(&db, "r", &[]).unwrap();

        assert!(speakers(&db, "r").unwrap().is_empty());
    }

    /// And another recording's speakers are none of this run's business.
    #[test]
    fn another_recordings_speakers_are_left_where_they_are() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SPEAKER_SCHEMA).unwrap();
        for recording in ["r", "other"] {
            insert_speaker(
                &db,
                &Speaker {
                    key: "speaker_0".into(),
                    recording_id: recording.into(),
                    name: "Jana".into(),
                    color: "#000".into(),
                },
            )
            .unwrap();
        }

        keep_only_speakers(&db, "r", &[]).unwrap();

        assert!(speakers(&db, "r").unwrap().is_empty());
        assert_eq!(speakers(&db, "other").unwrap().len(), 1);
    }

    /// Removing a speaker takes the name off their passages and touches nothing
    /// else. The passages themselves stay where they are — they are the reading,
    /// and only the machine's guess about who was speaking is being withdrawn.
    #[test]
    fn removing_a_speaker_leaves_what_they_said_without_a_name() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();
        db.execute_batch(SPEAKER_SCHEMA).unwrap();

        let mut theirs = segment(1.0, 2.0, r#"[{"s":"ahoj","t":1.0}]"#);
        theirs.text = "co řekli".into();
        theirs.speakers = Some("speaker_0".into());
        insert_segment(&db, &theirs).unwrap();

        let mut somebody_else = segment(2.0, 3.0, r#"[{"s":"ahoj","t":2.0}]"#);
        somebody_else.id = "second".into();
        somebody_else.speakers = Some("speaker_1".into());
        insert_segment(&db, &somebody_else).unwrap();

        for key in ["speaker_0", "speaker_1"] {
            insert_speaker(
                &db,
                &Speaker {
                    key: key.into(),
                    recording_id: "recording".into(),
                    name: key.into(),
                    color: "#000".into(),
                },
            )
            .unwrap();
        }

        delete_speaker(&db, "recording", "speaker_0").unwrap();

        let read = segments(&db, "recording").unwrap();
        assert_eq!(read[0].speakers, None, "the name is gone");
        assert_eq!(read[0].text, "co řekli", "and nothing else is");
        assert_eq!(
            read[1].speakers.as_deref(),
            Some("speaker_1"),
            "nobody else loses their name"
        );

        let left = speakers(&db, "recording").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].key, "speaker_1");
    }

    /// The same errand run from inside a larger one, which is how the folder
    /// delete crashed: `delete_speaker` asking SQLite for a transaction while
    /// its caller already held one.
    #[test]
    fn a_speaker_can_be_removed_inside_someone_elses_transaction() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();
        db.execute_batch(SPEAKER_SCHEMA).unwrap();
        insert_speaker(
            &db,
            &Speaker {
                key: "speaker_0".into(),
                recording_id: "recording".into(),
                name: "Někdo".into(),
                color: "#000".into(),
            },
        )
        .unwrap();

        let tx = db.unchecked_transaction().unwrap();
        delete_speaker(&db, "recording", "speaker_0").unwrap();
        tx.commit().unwrap();

        assert!(speakers(&db, "recording").unwrap().is_empty());
    }

    /// The two columns `segments()` selects beyond the obvious ones. Kept
    /// beside the tests rather than reaching for the real `open()`, which
    /// would bring the whole schema and eleven migrations with it.
    const SEGMENT_SCHEMA: &str = "CREATE TABLE segments (
           id           TEXT PRIMARY KEY,
           recording_id  TEXT NOT NULL,
           position       INTEGER NOT NULL,
           start_time      REAL NOT NULL,
           end_time        REAL NOT NULL,
           text         TEXT NOT NULL,
           speakers       TEXT,
           confidence      REAL,
           edited     INTEGER NOT NULL DEFAULT 0,
           words        TEXT,
           verified      INTEGER NOT NULL DEFAULT 0,
           original      TEXT,
           language      TEXT
         );
         CREATE VIRTUAL TABLE segments_fts USING fts5(
           text, segment_id UNINDEXED, recording_id UNINDEXED
         );";

    // ------------------------------------------------ the archive tells the truth

    /// Enough of `nahravky` for the two statements `recover_interrupted` runs.
    const RECORDING_SCHEMA: &str = "CREATE TABLE recordings (
           id    TEXT PRIMARY KEY,
           status  TEXT NOT NULL,
           error TEXT
         );";

    fn interrupted_archive() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(RECORDING_SCHEMA).unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();
        db
    }

    fn status_of(db: &Connection, id: &str) -> String {
        db.query_row(
            "SELECT status FROM recordings WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_transcript_that_finished_is_not_reported_as_a_failure() {
        // The row never got its final `done` — the write failed, or the
        // application was closed in the half-second between the transaction
        // and the status. The segments are there, so the work is done.
        let db = interrupted_archive();
        db.execute(
            "INSERT INTO recordings (id, status) VALUES ('done', ?1)",
            params![status::TRANSCRIBING],
        )
        .unwrap();
        let mut written = segment(0.0, 1.0, "[]");
        written.recording_id = "done".into();
        insert_segment(&db, &written).unwrap();

        recover_interrupted(&db).unwrap();

        assert_eq!(status_of(&db, "done"), status::DONE);
        let error: Option<String> = db
            .query_row("SELECT error FROM recordings WHERE id = 'done'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(error, None, "a finished recording carries no failure");
    }

    #[test]
    fn a_run_that_never_wrote_anything_is_still_a_failure() {
        let db = interrupted_archive();
        db.execute(
            "INSERT INTO recordings (id, status) VALUES ('empty', ?1)",
            params![status::TRANSCRIBING],
        )
        .unwrap();

        let count = recover_interrupted(&db).unwrap();

        assert_eq!(count, 1);
        assert_eq!(status_of(&db, "empty"), status::FAILED);
    }

    #[test]
    fn a_bad_segment_row_fails_the_read_instead_of_disappearing() {
        // `segments()` is what the two delete-and-reinsert paths read from, so
        // a row quietly skipped here would be deleted rather than displayed
        // wrong. `poradi` is NOT NULL in the real schema; a value of the wrong
        // type stands in for whatever corruption produced it.
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();
        let good = segment(0.0, 1.0, "[]");
        insert_segment(&db, &good).unwrap();
        db.execute(
            "INSERT INTO segments (id, recording_id, position, start_time, end_time, text, edited, verified)
             VALUES ('broken', 'nahravka', 'not a number', 1.0, 2.0, 'text', 0, 0)",
            [],
        )
        .unwrap();

        assert!(
            segments(&db, "nahravka").is_err(),
            "a row that cannot be read must not be silently dropped"
        );
    }

    #[test]
    fn unreadable_settings_are_kept_rather_than_overwritten() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);")
            .unwrap();
        db.execute(
            "INSERT INTO settings (key, value) VALUES ('nastaveni', ?1)",
            params!["{ this is not json"],
        )
        .unwrap();

        let settings = load_settings(&db).unwrap();

        // Defaults are the only way to carry on...
        assert_eq!(settings.theme, super::Settings::default().theme);
        // ...but the text the person's choices were in survives.
        let kept: String = db
            .query_row(
                "SELECT value FROM settings WHERE key = 'nastaveni-poskozeno'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kept, "{ this is not json");
    }

    #[test]
    fn aligns_vad_compressed_word_timestamps_to_segment_start() {
        let mut value = segment(
            631.19,
            632.63,
            r#"[{"s":"in","t":577.21},{"s":"sure","t":578.28}]"#,
        );

        align_word_timestamps(&mut value);

        let words: Vec<serde_json::Value> =
            serde_json::from_str(value.words.as_deref().unwrap()).unwrap();
        assert_eq!(words[0]["t"].as_f64(), Some(631.19));
        assert_eq!(words[1]["t"].as_f64(), Some(632.26));
    }

    #[test]
    fn preserves_word_timestamp_that_is_already_inside_segment() {
        let original = r#"[{"s":"Yeah","t":0.09},{"s":"you","t":0.27}]"#;
        let mut value = segment(0.0, 1.36, original);

        align_word_timestamps(&mut value);

        assert_eq!(value.words.as_deref(), Some(original));
    }

    #[test]
    fn watch_file_must_be_unchanged_between_two_scans() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE watch_folder_observations (
               path TEXT PRIMARY KEY,
               fingerprint TEXT NOT NULL,
               observed_at TEXT NOT NULL
             );",
        )
        .unwrap();

        assert!(!watch_file_is_stable(&db, "recording.mp3", "10:100").unwrap());
        assert!(watch_file_is_stable(&db, "recording.mp3", "10:100").unwrap());
        assert!(!watch_file_is_stable(&db, "recording.mp3", "20:200").unwrap());
        assert!(watch_file_is_stable(&db, "recording.mp3", "20:200").unwrap());
    }

    #[test]
    fn watch_folder_remembers_every_imported_fingerprint() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE watch_folder_files (
               path TEXT NOT NULL,
               fingerprint TEXT NOT NULL,
               imported_at TEXT NOT NULL,
               PRIMARY KEY (path, fingerprint)
             );
             INSERT INTO watch_folder_files (path, fingerprint, imported_at)
             VALUES ('recording.mp3', '10:100', 'now');",
        )
        .unwrap();

        assert!(watch_file_imported(&db, "recording.mp3", "10:100").unwrap());
        // The same file put there afresh has a new modification time, so it is
        // a different fingerprint and must be offered again.
        assert!(!watch_file_imported(&db, "recording.mp3", "20:200").unwrap());
        assert!(!watch_file_imported(&db, "another.mp3", "10:100").unwrap());
    }

    #[test]
    fn recording_notes_are_persisted_updated_and_deleted() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE recordings (id TEXT PRIMARY KEY);
             CREATE TABLE notes (
               id TEXT PRIMARY KEY,
               recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
               time REAL NOT NULL DEFAULT 0,
               text TEXT NOT NULL,
               done INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL,
               pinned INTEGER NOT NULL DEFAULT 1
             );
             INSERT INTO recordings (id) VALUES ('recording');",
        )
        .unwrap();

        let note = RecordingNote {
            id: "note".into(),
            recording_id: "recording".into(),
            time: Some(12.5),
            text: "Ověřit jméno".into(),
            done: false,
            created_at: "now".into(),
        };
        insert_recording_note(&db, &note).unwrap();
        assert_eq!(recording_notes(&db, "recording").unwrap(), vec![note]);

        update_recording_note(&db, "note", Some(18.0), "Jméno ověřeno", true).unwrap();
        let updated = recording_notes(&db, "recording").unwrap();
        assert_eq!(updated[0].time, Some(18.0));
        assert_eq!(updated[0].text, "Jméno ověřeno");
        assert!(updated[0].done);

        // Unpinning must not leave the old position behind as a zero, which
        // would read as "at the very beginning" rather than "nowhere".
        update_recording_note(&db, "note", None, "Jméno ověřeno", true).unwrap();
        assert_eq!(recording_notes(&db, "recording").unwrap()[0].time, None);

        delete_recording_note(&db, "note").unwrap();
        assert!(recording_notes(&db, "recording").unwrap().is_empty());
    }

    #[test]
    fn notes_without_a_position_are_listed_first() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE recordings (id TEXT PRIMARY KEY);
             CREATE TABLE notes (
               id TEXT PRIMARY KEY,
               recording_id TEXT NOT NULL,
               time REAL NOT NULL DEFAULT 0,
               text TEXT NOT NULL,
               done INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL,
               pinned INTEGER NOT NULL DEFAULT 1
             );
             INSERT INTO recordings (id) VALUES ('recording');",
        )
        .unwrap();

        let make = |id: &str, time: Option<f64>, created: &str| RecordingNote {
            id: id.into(),
            recording_id: "recording".into(),
            time,
            text: id.into(),
            done: false,
            created_at: created.into(),
        };
        // Deliberately inserted out of order, including a pinned note at zero
        // seconds, which must not be mistaken for a note with no position.
        insert_recording_note(&db, &make("pinned-late", Some(90.0), "3")).unwrap();
        insert_recording_note(&db, &make("loose-second", None, "2")).unwrap();
        insert_recording_note(&db, &make("pinned-zero", Some(0.0), "4")).unwrap();
        insert_recording_note(&db, &make("loose-first", None, "1")).unwrap();

        let ids: Vec<String> = recording_notes(&db, "recording")
            .unwrap()
            .into_iter()
            .map(|note| note.id)
            .collect();
        assert_eq!(
            ids,
            ["loose-first", "loose-second", "pinned-zero", "pinned-late"]
        );
    }

    #[test]
    fn migrates_waveform_density_in_legacy_database() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE waveforms (
                recording_id TEXT PRIMARY KEY,
                points TEXT NOT NULL
            );",
        )
        .unwrap();

        migrate_legacy_schema(&db);
        db.execute(
            "INSERT INTO waveforms (recording_id, points) VALUES (?1, ?2)",
            params!["recording", vec![10_u8, 20_u8, 30_u8]],
        )
        .unwrap();

        assert_eq!(
            waveform(&db, "recording"),
            Some(WaveformData {
                points: vec![10_u8, 20_u8, 30_u8],
                points_per_second: 12.0,
                equalizer: Vec::new(),
                equalizer_points_per_second: 10.0,
                equalizer_band_count: 24,
            })
        );
    }

    #[test]
    fn derived_ai_outputs_are_saved_and_invalidated_with_a_new_document() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE recordings (id TEXT PRIMARY KEY);
             CREATE TABLE ai_documents (
               recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
               source_hash TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL,
               text TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE ai_outputs (
               recording_id TEXT NOT NULL REFERENCES ai_documents(recording_id) ON DELETE CASCADE,
               kind TEXT NOT NULL, variant TEXT NOT NULL, source_hash TEXT NOT NULL,
               model TEXT NOT NULL, text TEXT NOT NULL, updated_at TEXT NOT NULL,
               PRIMARY KEY (recording_id, kind, variant)
             );
             INSERT INTO recordings (id) VALUES ('recording');",
        )
        .unwrap();
        let mut document = AiDocument {
            recording_id: "recording".into(),
            source_hash: "transcript-one".into(),
            model: "editor".into(),
            mode: "faithful".into(),
            text: "Vylepšený text".into(),
            updated_at: "now".into(),
            stale: false,
        };
        save_ai_document(&db, &document).unwrap();
        save_ai_output(
            &db,
            &AiOutput {
                recording_id: "recording".into(),
                kind: "summary".into(),
                variant: "standard".into(),
                source_hash: "document-one".into(),
                model: "editor".into(),
                text: "Shrnutí".into(),
                updated_at: "now".into(),
            },
        )
        .unwrap();
        assert_eq!(ai_outputs(&db, "recording").unwrap().len(), 1);

        document.text = "Nově vylepšený text".into();
        save_ai_document(&db, &document).unwrap();
        assert!(ai_outputs(&db, "recording").unwrap().is_empty());
    }

    /// The two tables the folder tests need, in the shape `init` creates them.
    fn archive_with_folders() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE folders (
                 id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
             CREATE TABLE recordings (
                 id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
                 duration REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'nova', model TEXT NOT NULL DEFAULT '',
                 error TEXT, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL);
             CREATE TABLE segments_fts (recording_id TEXT);",
        )
        .unwrap();
        db
    }

    fn recording_in(db: &Connection, id: &str, seconds: f64, folder: Option<&str>) {
        db.execute(
            "INSERT INTO recordings (id, path, name, duration, created_at, folder_id)
             VALUES (?1, ?1, ?1, ?2, '2026-08-05 10:00:00', ?3)",
            params![id, seconds, folder],
        )
        .unwrap();
    }

    #[test]
    fn a_folder_reports_what_it_holds() {
        let db = archive_with_folders();
        let folder = create_folder(&db, "Kázání").unwrap();
        recording_in(&db, "a", 60.0, Some(&folder.id));
        recording_in(&db, "b", 90.0, Some(&folder.id));
        recording_in(&db, "loose", 30.0, None);

        let listed = folders(&db).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].recording_count, 2);
        assert_eq!(listed[0].duration, 150.0);
    }

    #[test]
    fn deleting_a_folder_returns_its_recordings_to_the_root() {
        let db = archive_with_folders();
        let folder = create_folder(&db, "Kázání").unwrap();
        recording_in(&db, "a", 60.0, Some(&folder.id));

        delete_folder(&db, &folder.id).unwrap();

        assert!(folders(&db).unwrap().is_empty());
        // The recording is still there, and no longer points at anything.
        let held: Option<String> = db
            .query_row(
                "SELECT folder_id FROM recordings WHERE id = 'a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(held, None);
    }

    #[test]
    fn moving_takes_recordings_in_and_out() {
        let db = archive_with_folders();
        let folder = create_folder(&db, "Kázání").unwrap();
        recording_in(&db, "a", 60.0, None);
        recording_in(&db, "b", 60.0, None);

        move_to_folder(&db, &["a".into(), "b".into()], Some(&folder.id)).unwrap();
        assert_eq!(folder_recording_ids(&db, &folder.id).unwrap().len(), 2);

        move_to_folder(&db, &["a".into()], None).unwrap();
        assert_eq!(folder_recording_ids(&db, &folder.id).unwrap(), vec!["b"]);
    }

    /// Reported from the running application: deleting a folder together with
    /// the transcripts in it gave *cannot start a transaction within a
    /// transaction*. The command wraps the whole errand in one — the
    /// recordings and the folder go together or not at all — and the functions
    /// below opened a second one inside it. SQLite has no nesting, and because
    /// a `Transaction` derefs to a `Connection` it all compiled.
    mod inside_someone_elses_transaction {
        use super::*;

        #[test]
        fn a_folder_and_its_recordings_go_together() {
            let db = archive_with_folders();
            let folder = create_folder(&db, "Kázání").unwrap();
            recording_in(&db, "a", 60.0, Some(&folder.id));
            recording_in(&db, "b", 60.0, Some(&folder.id));

            // Exactly what commands::folders::delete_folder does.
            let tx = db.unchecked_transaction().unwrap();
            for id in folder_recording_ids(&tx, &folder.id).unwrap() {
                delete_recording(&tx, &id).unwrap();
            }
            delete_folder(&tx, &folder.id).unwrap();
            tx.commit().unwrap();

            assert!(folders(&db).unwrap().is_empty());
            let left: i64 = db
                .query_row("SELECT COUNT(*) FROM recordings", [], |row| row.get(0))
                .unwrap();
            assert_eq!(left, 0);
        }

        #[test]
        fn moving_recordings_works_there_too() {
            let db = archive_with_folders();
            let folder = create_folder(&db, "Kázání").unwrap();
            recording_in(&db, "a", 60.0, None);

            let tx = db.unchecked_transaction().unwrap();
            move_to_folder(&tx, &["a".into()], Some(&folder.id)).unwrap();
            tx.commit().unwrap();

            assert_eq!(folder_recording_ids(&db, &folder.id).unwrap(), vec!["a"]);
        }

        /// And the caller's transaction still decides. Rolling back must undo
        /// the folder deletion too — which it cannot if the inner call
        /// committed a transaction of its own.
        #[test]
        fn a_rollback_takes_the_folder_back() {
            let db = archive_with_folders();
            let folder = create_folder(&db, "Kázání").unwrap();

            let tx = db.unchecked_transaction().unwrap();
            delete_folder(&tx, &folder.id).unwrap();
            drop(tx); // no commit: rusqlite rolls back

            assert_eq!(folders(&db).unwrap().len(), 1);
        }
    }

    #[test]
    fn an_archive_upgraded_from_an_older_version_gets_the_column() {
        let db = Connection::open_in_memory().unwrap();
        // The shape before folders existed: no `slozka` anywhere.
        db.execute_batch(
            "CREATE TABLE recordings (
                 id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
                 duration REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);",
        )
        .unwrap();

        migrate_legacy_schema(&db);

        db.execute(
            "INSERT INTO recordings (id, path, name, created_at, folder_id)
             VALUES ('a', 'a', 'a', '2026-08-05', NULL)",
            [],
        )
        .expect("the column has to exist after the migration");
    }

    /// Everything the import command refuses, and the two things it accepts.
    ///
    /// A backup came from this application; a file picked off a disk did not.
    /// This is what stands between "I chose the wrong file" and an archive
    /// replaced by a holiday photograph.
    #[test]
    fn an_offered_file_is_judged_before_anything_is_replaced() {
        // An ordinary archive of this build's schema.
        let current = TempDb::new("offered-current");
        drop(open(&current.0).unwrap());
        assert_eq!(look_at_offered_archive(&current.0), Offered::Usable);

        // One from a newer Volocal. Refused, and refused by number.
        let future = TempDb::new("offered-future");
        {
            let db = open(&future.0).unwrap();
            save_metadata_value(&db, "schema-version", "99").unwrap();
        }
        assert_eq!(
            look_at_offered_archive(&future.0),
            Offered::FromTheFuture {
                found: 99,
                known: 3
            }
        );

        // An archive from before the schema was English. This is the one worth
        // being able to take: it is what sat on the machine somebody replaced.
        let czech = TempDb::new("offered-czech");
        drop(czech_archive(&czech.0));
        assert_eq!(look_at_offered_archive(&czech.0), Offered::Usable);

        // A database, but not one of ours.
        let stranger = TempDb::new("offered-stranger");
        {
            let db = Connection::open(&stranger.0).unwrap();
            db.execute("CREATE TABLE something_else (id TEXT)", [])
                .unwrap();
        }
        assert_eq!(look_at_offered_archive(&stranger.0), Offered::NotAnArchive);

        // Not a database at all.
        let rubbish = TempDb::new("offered-rubbish");
        std::fs::write(&rubbish.0, b"this is not a database, it is a sentence").unwrap();
        assert_eq!(look_at_offered_archive(&rubbish.0), Offered::NotAnArchive);

        // And nothing at that path.
        let missing = TempDb::new("offered-missing");
        assert_eq!(look_at_offered_archive(&missing.0), Offered::NotAnArchive);
    }

    /// Looking must not be opening. `open` migrates, and an archive somebody has
    /// only pointed at has not been agreed to yet — least of all one that is
    /// about to be refused for being too new.
    #[test]
    fn looking_at_an_offered_archive_does_not_write_to_it() {
        let temp = TempDb::new("offered-untouched");
        drop(czech_archive(&temp.0));
        let before = std::fs::read(&temp.0).unwrap();
        assert_eq!(look_at_offered_archive(&temp.0), Offered::Usable);
        assert_eq!(
            std::fs::read(&temp.0).unwrap(),
            before,
            "the file changed just by being looked at"
        );
    }
}

/// Raises the speaker clustering threshold to its new default, once.
///
/// Changing a default only reaches new installations. Anybody who has already
/// started the application has the whole settings structure stored in
/// `settings`, old 0.5 and all, and would have kept their sixteen speakers for
/// good.
///
/// Only a value equal to the former default is moved. Somebody who set the
/// threshold deliberately keeps what they set: their choice is newer
/// information than our estimate.
pub fn raise_cluster_threshold_once(db: &Connection) -> Result<bool> {
    const MARK: &str = "cluster-threshold-version";
    const OLD_DEFAULT: f64 = 0.5;
    const NEW_DEFAULT: f64 = 0.8;

    if metadata_value(db, MARK)?.as_deref() == Some("2") {
        return Ok(false);
    }
    let mut settings = load_settings(db)?;
    let moved = (settings.cluster_threshold - OLD_DEFAULT).abs() < f64::EPSILON;
    if moved {
        settings.cluster_threshold = NEW_DEFAULT;
        save_settings(db, &settings)?;
    }
    save_metadata_value(db, MARK, "2")?;
    Ok(moved)
}
