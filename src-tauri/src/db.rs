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
    /// nova | prepisuje | hotova | chyba
    pub status: String,
    pub model: String,
    /// Language code the transcript actually ran in. With automatic
    /// detection, the one Whisper recognised.
    pub language: String,
    /// Language requested for this recording. Empty = use the app
    /// aplikace. „auto“ = nechat rozpoznat.
    pub language_choice: String,
    pub error: Option<String>,
    pub segment_count: i64,
    /// The folder holding this recording; `None` is the archive's root.
    pub folder: Option<String>,
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
    pub model: String,
    /// Optional local language-editing model. Empty means that the feature was
    /// skipped and no background model is downloaded or loaded.
    #[serde(default)]
    pub editor_model: String,
    #[serde(alias = "jazyk")]
    pub language: String,
    pub vad: bool,
    #[serde(alias = "vad_prah")]
    pub vad_threshold: f64,
    #[serde(alias = "diarizace")]
    pub diarization: bool,
    /// 0 = urcit automaticky
    #[serde(alias = "pocet_mluvcich")]
    pub speaker_count: i64,
    #[serde(alias = "prah_shluku")]
    pub cluster_threshold: f64,
    /// Posun okna segmentace jako podil jeho delky. Sherpa ma vychozich 0.1,
    /// tedy devadesatiprocentni prekryv — nejpresnejsi a nejpomalejsi.
    /// Vetsi cislo = mene oken = rychleji, za cenu hrubsich hranic.
    #[serde(default = "default_segmentation_window_shift", alias = "posun_okna")]
    pub segmentation_window_shift: f64,
    pub beam: i64,
    #[serde(alias = "vlakna")]
    pub threads: i64,

    // ------- ladeni dekodovani
    //
    // Vychozi hodnoty jsou presne ty, se kterymi pracuje whisper.cpp sam.
    // Kdo se jich nedotkne, dostane stejny vysledek jako driv — proto se
    // taky nepredavaji na prikazovou radku, dokud se nezmeni.
    /// Nad tuhle mez pravdepodobnosti se okno prohlasi za ticho. Vys =
    /// prisnejsi, spolehlive ticho, ale riziko, ze zmizi tiche slovo.
    #[serde(default = "default_threshold_silence", alias = "prah_ticha")]
    pub threshold_silence: f64,
    /// Pod tuhle prumernou logaritmickou pravdepodobnost se dekodovani
    /// povazuje za selhane a zkusi se znovu s vyssi teplotou.
    #[serde(default = "default_threshold_confidence", alias = "prah_jistoty")]
    pub threshold_confidence: f64,
    /// Kdyz je vystup podezrele jednotvarny, zkusi se usek znovu. Nizsi
    /// cislo = prisnejsi, casteji opakuje.
    #[serde(default = "default_entropy_threshold", alias = "prah_entropie")]
    pub entropy_threshold: f64,
    /// Pocatecni teplota vzorkovani. Nula = vzdy nejpravdepodobnejsi slovo.
    #[serde(default, alias = "teplota")]
    pub temperature: f64,
    /// O kolik se teplota zvedne pri kazdem dalsim pokusu. Nula fallback
    /// vypne uplne — zacykleni pak nema jak prerusit.
    #[serde(default = "default_temperature_increment", alias = "teplota_krok")]
    pub temperature_increment: f64,
    /// auto | cuda | vulkan | cpu — which whisper.cpp build to use
    #[serde(default = "default_compute", alias = "vypocet")]
    pub compute: String,
    /// Which machine last did the computing. When it changes we offer to
    /// re-measure performance — the flash drive travels between machines.
    #[serde(default, alias = "posledni_stroj")]
    pub last_machine: String,

    // ------- vzhled
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
// Vychozi hodnoty whisper.cpp, opsane z examples/cli/cli.cpp. Entropie je
// jedina vyjimka: 2.6 misto 2.4, protoze na cestine se model zacykloval
// castji, nez byla whisperovska mez ochotna zachytit.
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

/// Kompromis: proti sherpovske vychozi desetine dvojnasobny krok. Na
/// mluvenem slovu se hranice posunou o desetiny vteriny, coz se ve vete
/// ztrati, ale segmentace bere zhruba polovicni cas.
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
            // V prenosnem rezimu jsou cesty relativni ke slozce programu,
            // takze je jedno, jake pismeno flaska dostane.
            bin_directory: "bin".into(),
            models_directory: "models".into(),
            watch_folder: String::new(),
            watch_folder_enabled: false,
            watch_folder_auto: false,
            recording_folder: String::new(),
            copy_imports: false,
            update_check_automatic: false,
            model: "large-v3".into(),
            editor_model: String::new(),
            language: "auto".into(),
            // VAD je zapnuta natvrdo: bez ni Whisper na tichu halucinuje
            vad: true,
            vad_threshold: 0.5,
            diarization: false,
            speaker_count: 0,
            // Sherpovska vychozi hodnota je 0.5 a mensi cislo znamena vic
            // shluku. Na skutecnych nahravkach delala z dvouclenneho rozhovoru
            // sestnact mluvcich. Na 0.8 klesl pocet prepnuti z 119 na 20 a
            // pomer hlasu sedl na to, co je v nahravce slyset. Podrobne
            // v docs/history/.
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

pub fn open(path: &std::path::Path) -> Result<Connection> {
    let db = Connection::open(path)?;
    db.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS nahravky (
            id           TEXT PRIMARY KEY,
            cesta        TEXT NOT NULL,
            nazev        TEXT NOT NULL,
            delka        REAL NOT NULL DEFAULT 0,
            vytvoreno    TEXT NOT NULL,
            stav         TEXT NOT NULL DEFAULT 'nova',
            model        TEXT NOT NULL DEFAULT '',
            chyba        TEXT,
            -- Which folder holds the recording; NULL is the archive's root.
            -- ON DELETE SET NULL is what makes "delete the folder, keep the
            -- recordings" atomic instead of a loop that can half-finish.
            slozka       TEXT REFERENCES slozky(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS slozky (
            id           TEXT PRIMARY KEY,
            nazev        TEXT NOT NULL,
            vytvoreno    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS segmenty (
            id           TEXT PRIMARY KEY,
            nahravka_id  TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
            poradi       INTEGER NOT NULL,
            zacatek      REAL NOT NULL,
            konec        REAL NOT NULL,
            text         TEXT NOT NULL,
            mluvci       TEXT,
            jistota      REAL,
            upraveno     INTEGER NOT NULL DEFAULT 0,
            slova        TEXT,
            overeno      INTEGER NOT NULL DEFAULT 0,
            puvodni      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_segmenty_nahravka ON segmenty(nahravka_id, poradi);

        CREATE TABLE IF NOT EXISTS mluvci (
            klic         TEXT NOT NULL,
            nahravka_id  TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
            jmeno        TEXT NOT NULL,
            barva        TEXT NOT NULL,
            PRIMARY KEY (klic, nahravka_id)
        );

        CREATE TABLE IF NOT EXISTS poznamky (
            id           TEXT PRIMARY KEY,
            nahravka_id  TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
            cas          REAL NOT NULL DEFAULT 0,
            text         TEXT NOT NULL,
            hotovo       INTEGER NOT NULL DEFAULT 0,
            vytvoreno    TEXT NOT NULL,
            -- Whether `cas` means anything. The column cannot be made nullable
            -- without rebuilding the table, and zero is a real position in a
            -- recording, so the flag carries the distinction instead.
            pinned       INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_poznamky_nahravka
            ON poznamky(nahravka_id, cas, vytvoreno);

        -- `napoveda` is dead: the entry used to be handed to Whisper before
        -- transcription, which only ever conditioned the first window. The
        -- column stays so a fresh archive has the same shape as an old one,
        -- and because SQLite cannot drop a column without rebuilding the table.
        CREATE TABLE IF NOT EXISTS slovnik (
            id           TEXT PRIMARY KEY,
            hledat       TEXT NOT NULL,
            nahradit     TEXT NOT NULL,
            napoveda     INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS krivky (
            nahravka_id  TEXT PRIMARY KEY REFERENCES nahravky(id) ON DELETE CASCADE,
            body         BLOB NOT NULL,
            na_sekundu   REAL NOT NULL DEFAULT 12,
            equalizer    BLOB NOT NULL DEFAULT X'',
            equalizer_points_per_second REAL NOT NULL DEFAULT 10,
            equalizer_band_count INTEGER NOT NULL DEFAULT 24
        );

        CREATE TABLE IF NOT EXISTS klice (
            klic         TEXT PRIMARY KEY,
            hodnota      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_documents (
            recording_id  TEXT PRIMARY KEY REFERENCES nahravky(id) ON DELETE CASCADE,
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

        CREATE VIRTUAL TABLE IF NOT EXISTS segmenty_fts USING fts5(
            text,
            segment_id   UNINDEXED,
            nahravka_id  UNINDEXED,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        "#,
    )?;
    migrate_legacy_schema(&db);
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
    let _ = db.execute("ALTER TABLE nahravky ADD COLUMN slozka TEXT", []);
    let _ = db.execute("ALTER TABLE segmenty ADD COLUMN slova TEXT", []);
    let _ = db.execute(
        "ALTER TABLE segmenty ADD COLUMN overeno INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // What the machine wrote, kept the first time a human rewrites a segment.
    // Segments edited before this column existed keep NULL: the original is
    // simply not knowable for them, and guessing one would be worse.
    let _ = db.execute("ALTER TABLE segmenty ADD COLUMN puvodni TEXT", []);
    let _ = db.execute(
        "ALTER TABLE nahravky ADD COLUMN jazyk TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE nahravky ADD COLUMN jazyk_volba TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE krivky ADD COLUMN na_sekundu REAL NOT NULL DEFAULT 12",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE krivky ADD COLUMN equalizer BLOB NOT NULL DEFAULT X''",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE krivky ADD COLUMN equalizer_points_per_second REAL NOT NULL DEFAULT 10",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE krivky ADD COLUMN equalizer_band_count INTEGER NOT NULL DEFAULT 24",
        [],
    );
    // Notes written before this existed all had a position, so they stay pinned.
    let _ = db.execute(
        "ALTER TABLE poznamky ADD COLUMN pinned INTEGER NOT NULL DEFAULT 1",
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
            "SELECT hodnota FROM klice WHERE klic = 'jazyk-rozpoznavani'",
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
        "INSERT OR REPLACE INTO klice (klic, hodnota) VALUES ('jazyk-rozpoznavani', 'ano')",
        [],
    );
}

// ---------------------------------------------------------------- nastaveni

pub fn load_settings(db: &Connection) -> Result<Settings> {
    let json: Option<String> = db
        .query_row(
            "SELECT hodnota FROM klice WHERE klic = 'nastaveni'",
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
                    "INSERT INTO klice (klic, hodnota) VALUES ('nastaveni-poskozeno', ?1)
                     ON CONFLICT(klic) DO UPDATE SET hodnota = excluded.hodnota",
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
        "INSERT INTO klice (klic, hodnota) VALUES ('nastaveni', ?1)
         ON CONFLICT(klic) DO UPDATE SET hodnota = excluded.hodnota",
        params![serde_json::to_string(settings)?],
    )?;
    Ok(())
}

// ---------------------------------------------------------------- nahravky

pub fn insert_recording(db: &Connection, recording: &Recording) -> Result<()> {
    db.execute(
        "INSERT INTO nahravky (id, cesta, nazev, delka, vytvoreno, stav, model, chyba)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            recording.id,
            recording.path,
            recording.title,
            recording.duration,
            recording.created_at,
            recording.status,
            recording.model,
            recording.error
        ],
    )?;
    Ok(())
}

pub fn recording_path_exists(db: &Connection, path: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM nahravky WHERE cesta = ?1)",
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
        "UPDATE nahravky SET stav = ?2, chyba = ?3 WHERE id = ?1",
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
        "UPDATE nahravky SET stav = 'hotova', chyba = NULL
         WHERE stav = 'prepisuje'
           AND EXISTS (SELECT 1 FROM segmenty WHERE nahravka_id = nahravky.id)",
        [],
    )?;
    let count = db.execute(
        "UPDATE nahravky SET stav = 'chyba', chyba = ?1 WHERE stav = 'prepisuje'",
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
        "UPDATE nahravky SET nazev = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    Ok(())
}

pub fn set_model(db: &Connection, id: &str, model: &str) -> Result<()> {
    db.execute(
        "UPDATE nahravky SET model = ?2 WHERE id = ?1",
        params![id, model],
    )?;
    Ok(())
}

/// Language the user requested for one particular recording.
pub fn set_language_choice(db: &Connection, id: &str, language: &str) -> Result<()> {
    db.execute(
        "UPDATE nahravky SET jazyk_volba = ?2 WHERE id = ?1",
        params![id, language],
    )?;
    Ok(())
}

pub fn set_language(db: &Connection, id: &str, language: &str) -> Result<()> {
    db.execute(
        "UPDATE nahravky SET jazyk = ?2 WHERE id = ?1",
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
    })
}

const RECORDING_SELECT_SQL: &str =
    "SELECT n.id, n.cesta, n.nazev, n.delka, n.vytvoreno, n.stav, n.model, n.chyba,
        (SELECT COUNT(*) FROM segmenty s WHERE s.nahravka_id = n.id), n.jazyk, n.jazyk_volba,
        n.slozka
     FROM nahravky n";

pub fn list_recordings(db: &Connection) -> Result<Vec<Recording>> {
    let sql = format!("{RECORDING_SELECT_SQL} ORDER BY n.vytvoreno DESC");
    let mut st = db.prepare(&sql)?;
    let rows = st.query_map([], recording_from_row)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Completed recordings that have a timed transcript available for a
/// one-time layout migration.
pub fn completed_recording_ids_with_segments(db: &Connection) -> Result<Vec<String>> {
    let mut statement = db.prepare(
        "SELECT n.id FROM nahravky n
         WHERE n.stav = 'hotova'
           AND EXISTS (SELECT 1 FROM segmenty s WHERE s.nahravka_id = n.id)
         ORDER BY n.vytvoreno",
    )?;
    let rows = statement.query_map([], |row| row.get(0))?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

/// Small version and migration markers stored beside the application
/// settings. The legacy table name is kept for database compatibility.
pub fn metadata_value(db: &Connection, key: &str) -> Result<Option<String>> {
    let mut statement = db.prepare("SELECT hodnota FROM klice WHERE klic = ?1")?;
    let mut rows = statement.query(params![key])?;
    Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
}

pub fn save_metadata_value(db: &Connection, key: &str, value: &str) -> Result<()> {
    db.execute(
        "INSERT INTO klice (klic, hodnota) VALUES (?1, ?2)
         ON CONFLICT(klic) DO UPDATE SET hodnota = excluded.hodnota",
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
        "DELETE FROM segmenty_fts WHERE nahravka_id = ?1",
        params![id],
    )?;
    db.execute("DELETE FROM nahravky WHERE id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------- slozky

pub fn folders(db: &Connection) -> Result<Vec<Folder>> {
    let mut statement = db.prepare(
        "SELECT s.id, s.nazev, s.vytvoreno,
                (SELECT COUNT(*) FROM nahravky n WHERE n.slozka = s.id),
                (SELECT COALESCE(SUM(n.delka), 0) FROM nahravky n WHERE n.slozka = s.id)
         FROM slozky s
         ORDER BY s.nazev COLLATE NOCASE",
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
        "INSERT INTO slozky (id, nazev, vytvoreno) VALUES (?1, ?2, ?3)",
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
        "UPDATE slozky SET nazev = ?2 WHERE id = ?1",
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
            "UPDATE nahravky SET slozka = ?2 WHERE id = ?1",
            params![id, folder],
        )?;
    }
    commit(tx)
}

pub fn folder_recording_ids(db: &Connection, folder: &str) -> Result<Vec<String>> {
    let mut statement = db.prepare("SELECT id FROM nahravky WHERE slozka = ?1")?;
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
        "UPDATE nahravky SET slozka = NULL WHERE slozka = ?1",
        params![id],
    )?;
    db.execute("DELETE FROM slozky WHERE id = ?1", params![id])?;
    commit(tx)
}

// ---------------------------------------------------------------- poznamky a ukoly

pub fn recording_notes(db: &Connection, recording_id: &str) -> Result<Vec<RecordingNote>> {
    // Notes about the whole recording come first in the order they were
    // written; the ones tied to a moment follow it. Mixing them by time would
    // bury a general remark somewhere in the middle of the recording.
    let mut statement = db.prepare(
        "SELECT id, nahravka_id, cas, text, hotovo, vytvoreno, pinned
         FROM poznamky WHERE nahravka_id = ?1
         ORDER BY pinned, CASE WHEN pinned = 1 THEN cas END, vytvoreno",
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
        "INSERT INTO poznamky (id, nahravka_id, cas, text, hotovo, vytvoreno, pinned)
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
        "UPDATE poznamky SET cas = ?1, text = ?2, hotovo = ?3, pinned = ?4 WHERE id = ?5",
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
    db.execute("DELETE FROM poznamky WHERE id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------- segmenty

pub fn delete_segments(db: &Connection, recording_id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM segmenty WHERE nahravka_id = ?1",
        params![recording_id],
    )?;
    db.execute(
        "DELETE FROM segmenty_fts WHERE nahravka_id = ?1",
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
        "INSERT INTO segmenty (id, nahravka_id, poradi, zacatek, konec, text, mluvci, jistota, upraveno, slova, overeno, puvodni)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![s.id, s.recording_id, s.order, s.start, s.end, s.text, s.speakers,
                s.confidence, s.edited as i64, s.words, s.verified as i64, s.original],
    )?;
    db.execute(
        "INSERT INTO segmenty_fts (text, segment_id, nahravka_id) VALUES (?1, ?2, ?3)",
        params![s.text, s.id, s.recording_id],
    )?;
    Ok(())
}

pub fn segments(db: &Connection, recording_id: &str) -> Result<Vec<Segment>> {
    let mut st = db.prepare(
        "SELECT id, nahravka_id, poradi, zacatek, konec, text, mluvci, jistota, upraveno, slova, overeno, puvodni
         FROM segmenty WHERE nahravka_id = ?1 ORDER BY poradi",
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
        "UPDATE segmenty SET puvodni = COALESCE(puvodni, text), text = ?2,
                upraveno = 1, overeno = 1, slova = NULL
         WHERE id = ?1",
        params![id, text],
    )?;
    db.execute(
        "UPDATE segmenty_fts SET text = ?2 WHERE segment_id = ?1",
        params![id, text],
    )?;
    Ok(())
}

/// A moved or renamed file. The transcript stays; only the path changes.
pub fn set_path(db: &Connection, id: &str, path: &str, duration: f64) -> Result<()> {
    db.execute(
        "UPDATE nahravky SET cesta = ?2, delka = ?3 WHERE id = ?1",
        params![id, path, duration],
    )?;
    // The waveform belonged to the old file.
    db.execute("DELETE FROM krivky WHERE nahravka_id = ?1", params![id])?;
    Ok(())
}

/// Cached amplitude waveform and real frequency-band peaks.
///
/// Values are stored as bytes in the 0–255 range to keep even long
/// recordings compact.
pub fn waveform(db: &Connection, recording_id: &str) -> Option<WaveformData> {
    db.query_row(
        "SELECT body, na_sekundu, equalizer,
                equalizer_points_per_second, equalizer_band_count
         FROM krivky WHERE nahravka_id = ?1",
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
        "INSERT INTO krivky (
            nahravka_id, body, na_sekundu, equalizer,
            equalizer_points_per_second, equalizer_band_count
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(nahravka_id) DO UPDATE SET
             body = excluded.body,
             na_sekundu = excluded.na_sekundu,
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
        "UPDATE segmenty SET text = ?2, slova = ?3 WHERE id = ?1",
        params![id, text, words],
    )?;
    db.execute(
        "UPDATE segmenty_fts SET text = ?2 WHERE segment_id = ?1",
        params![id, text],
    )?;
    Ok(())
}

/// Signs off a low-confidence segment as correct.
pub fn mark_verified(db: &Connection, id: &str, verified: bool) -> Result<()> {
    db.execute(
        "UPDATE segmenty SET overeno = ?2 WHERE id = ?1",
        params![id, verified as i64],
    )?;
    Ok(())
}

pub fn set_segment_speaker(db: &Connection, id: &str, speakers: Option<&str>) -> Result<()> {
    db.execute(
        "UPDATE segmenty SET mluvci = ?2 WHERE id = ?1",
        params![id, speakers],
    )?;
    Ok(())
}

// ---------------------------------------------------------------- mluvci

/// Barvy voleny tak, aby byly rozlisitelne i pri barvosleposti a citelne na svetlem pozadi.
pub const COLORS: [&str; 8] = [
    "#2563eb", "#c2410c", "#15803d", "#7c3aed", "#0891b2", "#b45309", "#be123c", "#4d7c0f",
];

pub fn insert_speaker(db: &Connection, speaker: &Speaker) -> Result<()> {
    db.execute(
        "INSERT INTO mluvci (klic, nahravka_id, jmeno, barva) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(klic, nahravka_id) DO NOTHING",
        params![
            speaker.key,
            speaker.recording_id,
            speaker.name,
            speaker.color
        ],
    )?;
    Ok(())
}

/// Before re-running diarization, the previous split is discarded.
pub fn delete_speakers(db: &Connection, recording_id: &str) -> Result<()> {
    db.execute(
        "DELETE FROM mluvci WHERE nahravka_id = ?1",
        params![recording_id],
    )?;
    db.execute(
        "UPDATE segmenty SET mluvci = NULL WHERE nahravka_id = ?1",
        params![recording_id],
    )?;
    Ok(())
}

pub fn speakers(db: &Connection, recording_id: &str) -> Result<Vec<Speaker>> {
    let mut st = db.prepare(
        "SELECT klic, nahravka_id, jmeno, barva FROM mluvci WHERE nahravka_id = ?1 ORDER BY klic",
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
        "UPDATE mluvci SET jmeno = ?3 WHERE nahravka_id = ?1 AND klic = ?2",
        params![recording_id, key, name],
    )?;
    Ok(())
}

/// Diarizace casto rozdeli jednoho cloveka na dva (zmena hlasitosti, kaslani).
/// Slouceni je proto zakladni operace, ne okrajova funkce.
pub fn merge_speakers(
    db: &Connection,
    recording_id: &str,
    from_key: &str,
    to_key: &str,
) -> Result<()> {
    db.execute(
        "UPDATE segmenty SET mluvci = ?3 WHERE nahravka_id = ?1 AND mluvci = ?2",
        params![recording_id, from_key, to_key],
    )?;
    db.execute(
        "DELETE FROM mluvci WHERE nahravka_id = ?1 AND klic = ?2",
        params![recording_id, from_key],
    )?;
    Ok(())
}

// ---------------------------------------------------------------- slovnik

pub fn dictionary(db: &Connection) -> Result<Vec<DictionaryEntry>> {
    // `napoveda` is not read any more; see the note on the table above.
    let mut st = db.prepare("SELECT id, hledat, nahradit FROM slovnik ORDER BY hledat")?;
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
        "INSERT INTO slovnik (id, hledat, nahradit) VALUES (?1, ?2, ?3)",
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
        "UPDATE slovnik SET hledat = ?2, nahradit = ?3 WHERE id = ?1",
        params![entry.id, entry.find, entry.replace],
    )?;
    Ok(())
}

pub fn delete_dictionary_entry(db: &Connection, id: &str) -> Result<()> {
    db.execute("DELETE FROM slovnik WHERE id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------- hledani

pub fn search(db: &Connection, query: &str) -> Result<Vec<SearchResult>> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(vec![]);
    }
    // The user types an ordinary word, not FTS syntax. Quoting prevents a
    // znacich jako '-' nebo '"', a hvezdickou povolime prefixove hledani.
    let safe = format!("\"{}\"*", trimmed_query.replace('"', ""));

    let mut st = db.prepare(
        "SELECT f.nahravka_id, n.nazev, f.segment_id, s.zacatek,
                snippet(segmenty_fts, 0, '<<', '>>', '…', 12)
         FROM segmenty_fts f
         JOIN segmenty s ON s.id = f.segment_id
         JOIN nahravky n ON n.id = f.nahravka_id
         WHERE segmenty_fts MATCH ?1
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
/// Only `whisp-YYYY-MM-DD-HHMMSS.db` counts. A file somebody parked in the
/// folder themselves — `whisp-pred-upgradem.db`, an exported copy — is not
/// ours to rotate away, and the extension alone does not say whose it is.
fn backup_stamp(path: &std::path::Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stamp = name.strip_prefix("whisp-")?.strip_suffix(".db")?;
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
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    let destination = backup_directory(db_path).join(format!("whisp-{stamp}.db"));
    back_up(db, &destination)?;

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
            backup_stamp(std::path::Path::new("/x/whisp-2026-08-04-071530.db")),
            Some("2026-08-04-071530".to_string())
        );
        for foreign in [
            "/x/whisp-pred-upgradem.db",
            "/x/archiv.db",
            "/x/whisp-2026-08-04.db",
            "/x/whisp-2026-08-04-071530.db.bak",
        ] {
            assert_eq!(
                backup_stamp(std::path::Path::new(foreign)),
                None,
                "{foreign}"
            );
        }
    }
}

#[cfg(test)]
mod cluster_threshold_migration_tests {
    use super::*;

    fn archive() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute(
            "CREATE TABLE klice (klic TEXT PRIMARY KEY, hodnota TEXT)",
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
        ai_outputs, align_word_timestamps, create_folder, delete_folder, delete_recording,
        delete_recording_note, delete_segments, folder_recording_ids, folders,
        insert_recording_note, insert_segment, load_settings, migrate_legacy_schema,
        move_to_folder, recording_notes, recover_interrupted, save_ai_document, save_ai_output,
        segments, update_recording_note, watch_file_imported, watch_file_is_stable, waveform,
        AiDocument, AiOutput, RecordingNote, Segment, WaveformData,
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

    /// The two columns `segments()` selects beyond the obvious ones. Kept
    /// beside the tests rather than reaching for the real `open()`, which
    /// would bring the whole schema and eleven migrations with it.
    const SEGMENT_SCHEMA: &str = "CREATE TABLE segmenty (
           id           TEXT PRIMARY KEY,
           nahravka_id  TEXT NOT NULL,
           poradi       INTEGER NOT NULL,
           zacatek      REAL NOT NULL,
           konec        REAL NOT NULL,
           text         TEXT NOT NULL,
           mluvci       TEXT,
           jistota      REAL,
           upraveno     INTEGER NOT NULL DEFAULT 0,
           slova        TEXT,
           overeno      INTEGER NOT NULL DEFAULT 0,
           puvodni      TEXT
         );
         CREATE VIRTUAL TABLE segmenty_fts USING fts5(
           text, segment_id UNINDEXED, nahravka_id UNINDEXED
         );";

    // ------------------------------------------------ the archive tells the truth

    /// Enough of `nahravky` for the two statements `recover_interrupted` runs.
    const RECORDING_SCHEMA: &str = "CREATE TABLE nahravky (
           id    TEXT PRIMARY KEY,
           stav  TEXT NOT NULL,
           chyba TEXT
         );";

    fn interrupted_archive() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(RECORDING_SCHEMA).unwrap();
        db.execute_batch(SEGMENT_SCHEMA).unwrap();
        db
    }

    fn status_of(db: &Connection, id: &str) -> String {
        db.query_row(
            "SELECT stav FROM nahravky WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_transcript_that_finished_is_not_reported_as_a_failure() {
        // The row never got its final `hotova` — the write failed, or the
        // application was closed in the half-second between the transaction
        // and the status. The segments are there, so the work is done.
        let db = interrupted_archive();
        db.execute(
            "INSERT INTO nahravky (id, stav) VALUES ('done', 'prepisuje')",
            [],
        )
        .unwrap();
        let mut written = segment(0.0, 1.0, "[]");
        written.recording_id = "done".into();
        insert_segment(&db, &written).unwrap();

        recover_interrupted(&db).unwrap();

        assert_eq!(status_of(&db, "done"), "hotova");
        let error: Option<String> = db
            .query_row("SELECT chyba FROM nahravky WHERE id = 'done'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(error, None, "a finished recording carries no failure");
    }

    #[test]
    fn a_run_that_never_wrote_anything_is_still_a_failure() {
        let db = interrupted_archive();
        db.execute(
            "INSERT INTO nahravky (id, stav) VALUES ('empty', 'prepisuje')",
            [],
        )
        .unwrap();

        let count = recover_interrupted(&db).unwrap();

        assert_eq!(count, 1);
        assert_eq!(status_of(&db, "empty"), "chyba");
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
            "INSERT INTO segmenty (id, nahravka_id, poradi, zacatek, konec, text, upraveno, overeno)
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
        db.execute_batch("CREATE TABLE klice (klic TEXT PRIMARY KEY, hodnota TEXT);")
            .unwrap();
        db.execute(
            "INSERT INTO klice (klic, hodnota) VALUES ('nastaveni', ?1)",
            params!["{ this is not json"],
        )
        .unwrap();

        let settings = load_settings(&db).unwrap();

        // Defaults are the only way to carry on...
        assert_eq!(settings.theme, super::Settings::default().theme);
        // ...but the text the person's choices were in survives.
        let kept: String = db
            .query_row(
                "SELECT hodnota FROM klice WHERE klic = 'nastaveni-poskozeno'",
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
             CREATE TABLE nahravky (id TEXT PRIMARY KEY);
             CREATE TABLE poznamky (
               id TEXT PRIMARY KEY,
               nahravka_id TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
               cas REAL NOT NULL DEFAULT 0,
               text TEXT NOT NULL,
               hotovo INTEGER NOT NULL DEFAULT 0,
               vytvoreno TEXT NOT NULL,
               pinned INTEGER NOT NULL DEFAULT 1
             );
             INSERT INTO nahravky (id) VALUES ('recording');",
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
            "CREATE TABLE nahravky (id TEXT PRIMARY KEY);
             CREATE TABLE poznamky (
               id TEXT PRIMARY KEY,
               nahravka_id TEXT NOT NULL,
               cas REAL NOT NULL DEFAULT 0,
               text TEXT NOT NULL,
               hotovo INTEGER NOT NULL DEFAULT 0,
               vytvoreno TEXT NOT NULL,
               pinned INTEGER NOT NULL DEFAULT 1
             );
             INSERT INTO nahravky (id) VALUES ('recording');",
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
            "CREATE TABLE krivky (
                nahravka_id TEXT PRIMARY KEY,
                body TEXT NOT NULL
            );",
        )
        .unwrap();

        migrate_legacy_schema(&db);
        db.execute(
            "INSERT INTO krivky (nahravka_id, body) VALUES (?1, ?2)",
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
             CREATE TABLE nahravky (id TEXT PRIMARY KEY);
             CREATE TABLE ai_documents (
               recording_id TEXT PRIMARY KEY REFERENCES nahravky(id) ON DELETE CASCADE,
               source_hash TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL,
               text TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE ai_outputs (
               recording_id TEXT NOT NULL REFERENCES ai_documents(recording_id) ON DELETE CASCADE,
               kind TEXT NOT NULL, variant TEXT NOT NULL, source_hash TEXT NOT NULL,
               model TEXT NOT NULL, text TEXT NOT NULL, updated_at TEXT NOT NULL,
               PRIMARY KEY (recording_id, kind, variant)
             );
             INSERT INTO nahravky (id) VALUES ('recording');",
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
            "CREATE TABLE slozky (
                 id TEXT PRIMARY KEY, nazev TEXT NOT NULL, vytvoreno TEXT NOT NULL);
             CREATE TABLE nahravky (
                 id TEXT PRIMARY KEY, cesta TEXT NOT NULL, nazev TEXT NOT NULL,
                 delka REAL NOT NULL DEFAULT 0, vytvoreno TEXT NOT NULL,
                 stav TEXT NOT NULL DEFAULT 'nova', model TEXT NOT NULL DEFAULT '',
                 chyba TEXT, slozka TEXT REFERENCES slozky(id) ON DELETE SET NULL);
             CREATE TABLE segmenty_fts (nahravka_id TEXT);",
        )
        .unwrap();
        db
    }

    fn recording_in(db: &Connection, id: &str, seconds: f64, folder: Option<&str>) {
        db.execute(
            "INSERT INTO nahravky (id, cesta, nazev, delka, vytvoreno, slozka)
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
            .query_row("SELECT slozka FROM nahravky WHERE id = 'a'", [], |row| {
                row.get(0)
            })
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
                .query_row("SELECT COUNT(*) FROM nahravky", [], |row| row.get(0))
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
            "CREATE TABLE nahravky (
                 id TEXT PRIMARY KEY, cesta TEXT NOT NULL, nazev TEXT NOT NULL,
                 delka REAL NOT NULL DEFAULT 0, vytvoreno TEXT NOT NULL);",
        )
        .unwrap();

        migrate_legacy_schema(&db);

        db.execute(
            "INSERT INTO nahravky (id, cesta, nazev, vytvoreno, slozka)
             VALUES ('a', 'a', 'a', '2026-08-05', NULL)",
            [],
        )
        .expect("the column has to exist after the migration");
    }
}

/// Jednorazove zvedne prah shlukovani mluvcich na novou vychozi hodnotu.
///
/// Zmena vychozi hodnoty sama o sobe plati jen pro nove instalace — kdo uz
/// aplikaci spustil, ma v `klice` ulozenou celou strukturu nastaveni vcetne
/// stareho 0.5, a ten by si sestnact mluvcich nechal navzdy.
///
/// Posune se jen hodnota, ktera se rovna byvale vychozi. Kdo si prah vedome
/// prestavil na neco jineho, si to nechava; jeho volba je novejsi informace
/// nez nas odhad.
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
