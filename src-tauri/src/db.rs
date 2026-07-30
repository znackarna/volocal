//! Persistent storage backed by one SQLite file in the application data directory.
//! FTS5 provides full-text search across the transcript archive.

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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
/// token spacing and move the complete word sequence back to its segment.
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DictionaryEntry {
    pub id: String,
    pub find: String,
    pub replace: String,
    /// zda se termin posila Whisperu jako napoveda predem
    pub prompt: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    #[serde(alias = "bin_slozka")]
    pub bin_directory: String,
    #[serde(alias = "modely_slozka")]
    pub models_directory: String,
    pub model: String,
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
            model: "large-v3".into(),
            language: "auto".into(),
            // VAD je zapnuta natvrdo: bez ni Whisper na tichu halucinuje
            vad: true,
            vad_threshold: 0.5,
            diarization: false,
            speaker_count: 0,
            cluster_threshold: 0.5,
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
            chyba        TEXT
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
            overeno      INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_segmenty_nahravka ON segmenty(nahravka_id, poradi);

        CREATE TABLE IF NOT EXISTS mluvci (
            klic         TEXT NOT NULL,
            nahravka_id  TEXT NOT NULL REFERENCES nahravky(id) ON DELETE CASCADE,
            jmeno        TEXT NOT NULL,
            barva        TEXT NOT NULL,
            PRIMARY KEY (klic, nahravka_id)
        );

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

/// Bring databases created by earlier releases up to the current schema.
///
/// SQLite reports a duplicate-column error when a migration has already run,
/// so these additive migrations are intentionally idempotent.
fn migrate_legacy_schema(db: &Connection) {
    let _ = db.execute("ALTER TABLE segmenty ADD COLUMN slova TEXT", []);
    let _ = db.execute(
        "ALTER TABLE segmenty ADD COLUMN overeno INTEGER NOT NULL DEFAULT 0",
        [],
    );
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
        Some(j) => Ok(serde_json::from_str(&j).unwrap_or_default()),
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

pub fn set_status(db: &Connection, id: &str, status: &str, error: Option<&str>) -> Result<()> {
    db.execute(
        "UPDATE nahravky SET stav = ?2, chyba = ?3 WHERE id = ?1",
        params![id, status, error],
    )?;
    Ok(())
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
    })
}

const RECORDING_SELECT_SQL: &str =
    "SELECT n.id, n.cesta, n.nazev, n.delka, n.vytvoreno, n.stav, n.model, n.chyba,
        (SELECT COUNT(*) FROM segmenty s WHERE s.nahravka_id = n.id), n.jazyk, n.jazyk_volba
     FROM nahravky n";

pub fn list_recordings(db: &Connection) -> Result<Vec<Recording>> {
    let sql = format!("{RECORDING_SELECT_SQL} ORDER BY n.vytvoreno DESC");
    let mut st = db.prepare(&sql)?;
    let rows = st.query_map([], recording_from_row)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
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
    db.execute(
        "INSERT INTO segmenty (id, nahravka_id, poradi, zacatek, konec, text, mluvci, jistota, upraveno, slova, overeno)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![s.id, s.recording_id, s.order, s.start, s.end, s.text, s.speakers,
                s.confidence, s.edited as i64, s.words, s.verified as i64],
    )?;
    db.execute(
        "INSERT INTO segmenty_fts (text, segment_id, nahravka_id) VALUES (?1, ?2, ?3)",
        params![s.text, s.id, s.recording_id],
    )?;
    Ok(())
}

pub fn segments(db: &Connection, recording_id: &str) -> Result<Vec<Segment>> {
    let mut st = db.prepare(
        "SELECT id, nahravka_id, poradi, zacatek, konec, text, mluvci, jistota, upraveno, slova, overeno
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
        })
    })?;
    let mut segments: Vec<Segment> = rows.filter_map(|r| r.ok()).collect();
    for segment in &mut segments {
        align_word_timestamps(segment);
    }
    Ok(segments)
}

pub fn update_segment(db: &Connection, id: &str, text: &str) -> Result<()> {
    // After a manual edit the stored word timings no longer match the new
    // text. Whoever rewrote the segment has also reviewed it.
    db.execute(
        "UPDATE segmenty SET text = ?2, upraveno = 1, overeno = 1, slova = NULL WHERE id = ?1",
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
    let mut st =
        db.prepare("SELECT id, hledat, nahradit, napoveda FROM slovnik ORDER BY hledat")?;
    let rows = st.query_map([], |r| {
        Ok(DictionaryEntry {
            id: r.get(0)?,
            find: r.get(1)?,
            replace: r.get(2)?,
            prompt: r.get::<_, i64>(3)? != 0,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn add_dictionary_entry(db: &Connection, entry: &DictionaryEntry) -> Result<()> {
    db.execute(
        "INSERT INTO slovnik (id, hledat, nahradit, napoveda) VALUES (?1, ?2, ?3, ?4)",
        params![entry.id, entry.find, entry.replace, entry.prompt as i64],
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

#[cfg(test)]
mod tests {
    use super::{align_word_timestamps, migrate_legacy_schema, waveform, Segment, WaveformData};
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
        }
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
}
