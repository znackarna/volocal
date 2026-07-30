//! Transcription pipeline: ffmpeg -> whisper.cpp with VAD -> sherpa-onnx
//! diarization -> database.
//!
//! Work runs on a dedicated thread and emits incremental events so the UI can
//! display live text instead of only a percentage.

use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::db::{self, Segment, Settings};
use crate::tools::{self, command};

// ---------------------------------------------------------------- udalosti

#[derive(Serialize, Clone)]
pub struct TranscriptionProgress {
    pub recording_id: String,
    /// priprava | prepis | diarizace | ukladani | hotovo | chyba
    pub phase: String,
    pub percent: u32,
    pub description: String,
}

#[derive(Serialize, Clone)]
pub struct LiveSegment {
    pub recording_id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

fn status(app: &AppHandle, id: &str, phase: &str, percent: u32, description: &str) {
    let _ = app.emit(
        "transcription:status",
        TranscriptionProgress {
            recording_id: id.to_string(),
            phase: phase.to_string(),
            percent,
            description: description.to_string(),
        },
    );
}

// ---------------------------------------------------------------- bezici prace

/// Rozdelane prepisy. Drzime si spusteny proces, aby sel prerusit —
/// whisper bezi minuty a uzivatel si to muze rozmyslet.
#[derive(Default, Clone)]
pub struct TranscriptionTask {
    processes: Arc<Mutex<HashMap<String, std::process::Child>>>,
    cancellations: Arc<Mutex<HashSet<String>>>,
}

impl TranscriptionTask {
    fn record_process(&self, id: &str, child: std::process::Child) {
        self.processes.lock().unwrap().insert(id.to_string(), child);
    }
    fn forget(&self, id: &str) {
        self.processes.lock().unwrap().remove(id);
    }
    fn was_cancelled(&self, id: &str) -> bool {
        self.cancellations.lock().unwrap().contains(id)
    }

    /// Stops a running transcription. Returns whether anything was running.
    pub fn cancel(&self, id: &str) -> bool {
        self.cancellations.lock().unwrap().insert(id.to_string());
        if let Some(mut child) = self.processes.lock().unwrap().remove(id) {
            let _ = child.kill();
            let _ = child.wait();
            true
        } else {
            false
        }
    }

    /// Clears the cancel flag without stopping anything.
    pub fn forget_cancellation(&self, id: &str) {
        self.cancellations.lock().unwrap().remove(id);
    }

    fn cleanup(&self, id: &str) {
        self.forget_cancellation(id);
        self.forget(id);
    }
}

// ---------------------------------------------------------------- vstupni bod

pub fn start_in_thread(
    app: AppHandle,
    db_path: PathBuf,
    recording_id: String,
    task: TranscriptionTask,
) {
    std::thread::spawn(move || {
        let result = run(&app, &db_path, &recording_id, &task);
        let connection = db::open(&db_path).ok();
        let cancelled = task.was_cancelled(&recording_id);
        task.cleanup(&recording_id);

        if cancelled {
            // Cancelling is not a failure; the recording reverts to its
            // initial state.
            if let Some(s) = &connection {
                let _ = db::delete_segments(s, &recording_id);
                let _ = db::set_status(s, &recording_id, "nova", None);
            }
            status(&app, &recording_id, "cancelled", 0, "Přepis přerušen");
            let _ = app.emit("transcription:complete", recording_id.clone());
            return;
        }

        match result {
            Ok(count) => {
                if let Some(s) = &connection {
                    let _ = db::set_status(s, &recording_id, "hotova", None);
                }
                status(
                    &app,
                    &recording_id,
                    "complete",
                    100,
                    &format!("{count} úseků"),
                );
                let _ = app.emit("transcription:complete", recording_id.clone());
            }
            Err(e) => {
                let message = format!("{e:#}");
                if let Some(s) = &connection {
                    let _ = db::set_status(s, &recording_id, "chyba", Some(&message));
                }
                status(&app, &recording_id, "error", 0, &message);
                let _ = app.emit("transcription:error", (recording_id.clone(), message));
            }
        }
    });
}

/// Runs diarization over an already finished transcript. No need to
/// transcribe again — Whisper has done its part; this only fills in who
/// said what.
pub fn start_diarization_in_thread(app: AppHandle, db_path: PathBuf, recording_id: String) {
    std::thread::spawn(move || {
        let result = run_diarization(&app, &db_path, &recording_id);
        let connection = db::open(&db_path).ok();
        match result {
            Ok(count) => {
                if let Some(s) = &connection {
                    let _ = db::set_status(s, &recording_id, "hotova", None);
                }
                status(
                    &app,
                    &recording_id,
                    "complete",
                    100,
                    &format!("{count} mluvčích"),
                );
                let _ = app.emit("transcription:complete", recording_id.clone());
            }
            Err(e) => {
                let message = format!("{e:#}");
                if let Some(s) = &connection {
                    let _ = db::set_status(s, &recording_id, "hotova", None);
                }
                status(&app, &recording_id, "error", 0, &message);
                let _ = app.emit("transcription:error", (recording_id.clone(), message));
            }
        }
    });
}

fn run_diarization(app: &AppHandle, db_path: &Path, recording_id: &str) -> Result<usize> {
    let connection = db::open(db_path)?;
    let settings = db::load_settings(&connection)?;
    let recording = db::recording(&connection, recording_id)?;

    let check = tools::check(&settings);
    if !check.issues_diarization.is_empty() {
        return Err(anyhow!(check.issues_diarization.join(" ")));
    }
    let ffmpeg = check
        .ffmpeg
        .clone()
        .ok_or_else(|| anyhow!("Chybí ffmpeg"))?;

    db::set_status(&connection, recording_id, "prepisuje", None)?;
    status(app, recording_id, "diarization", 5, "Připravuji zvuk");

    let working_directory = std::env::temp_dir()
        .join("whisp-speakers")
        .join(recording_id);
    std::fs::create_dir_all(&working_directory)?;
    let wav = working_directory.join("zvuk.wav");
    tools::convert_to_wav(Path::new(&ffmpeg), Path::new(&recording.path), &wav)
        .context("Převod zvuku selhal")?;

    status(app, recording_id, "diarization", 25, "Rozlišuji mluvčí");
    let turns = diarize(&settings, &check, &wav)?;

    let segments = db::segments(&connection, recording_id)?;
    if segments.is_empty() {
        return Err(anyhow!("Nahrávka ještě není přepsaná."));
    }
    let segments = assign_speakers(segments, &turns);

    status(app, recording_id, "saving", 90, "Ukládám");

    let mut key: Vec<String> = segments.iter().filter_map(|s| s.speakers.clone()).collect();
    key.sort_by_key(|k| order_key(k));
    key.dedup();

    // Segments are rewritten whole, not just the speaker column: diarization
    // may have cut a sentence where the speech changes hands, so there can be
    // more of them now. Text, edits and signed-off spots travel along.
    //
    // All of it in one transaction. Diarization is a bonus — it would be cruel
    // for a finished transcript to vanish because a write failed midway.
    connection.execute_batch("BEGIN")?;
    let save_result = (|| -> Result<()> {
        db::delete_speakers(&connection, recording_id)?;
        for (i, k) in key.iter().enumerate() {
            db::insert_speaker(
                &connection,
                &db::Speaker {
                    key: k.clone(),
                    recording_id: recording_id.to_string(),
                    name: format!("Mluvčí {}", i + 1),
                    color: db::COLORS[i % db::COLORS.len()].to_string(),
                },
            )?;
        }
        db::delete_segments(&connection, recording_id)?;
        for s in &segments {
            db::insert_segment(&connection, s)?;
        }
        Ok(())
    })();
    if let Err(e) = save_result {
        let _ = connection.execute_batch("ROLLBACK");
        return Err(e);
    }
    connection.execute_batch("COMMIT")?;

    let _ = std::fs::remove_dir_all(&working_directory);
    Ok(key.len())
}

fn run(
    app: &AppHandle,
    db_path: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
) -> Result<usize> {
    // Vlastni spojeni pro toto vlakno - hlavni vlakno tak neceka minuty na zamek.
    let connection = db::open(db_path)?;
    let settings = db::load_settings(&connection)?;
    let recording = db::recording(&connection, recording_id)?;
    let dictionary = db::dictionary(&connection)?;

    db::set_status(&connection, recording_id, "prepisuje", None)?;
    db::set_model(&connection, recording_id, &settings.model)?;
    db::delete_segments(&connection, recording_id)?;

    let check = tools::check(&settings);
    if !check.issues.is_empty() {
        return Err(anyhow!(check.issues.join(" ")));
    }

    // ------------------------------------------------------------ priprava
    status(app, recording_id, "preparation", 0, "Převádím zvuk");

    let working_directory = std::env::temp_dir()
        .join("whisp")
        .join(recording_id);
    std::fs::create_dir_all(&working_directory)?;
    let wav = working_directory.join("zvuk.wav");

    tools::convert_to_wav(
        Path::new(check.ffmpeg.as_ref().unwrap()),
        Path::new(&recording.path),
        &wav,
    )
    .context("Převod zvuku selhal")?;

    // Generate both the timeline waveform and frequency peaks while the
    // normalized WAV file is already available.
    let visualization_missing = db::waveform(&connection, recording_id)
        .map(|data| data.points.is_empty() || data.equalizer.is_empty())
        .unwrap_or(true);
    if visualization_missing {
        if let Ok(data) = waveform_from_wav(&check, &wav, recording.duration) {
            let _ = db::save_waveform(&connection, recording_id, &data);
        }
    }

    // ------------------------------------------------------------ prepis
    status(app, recording_id, "transcription", 0, "Přepisuji");

    let prefix = working_directory.join("vystup");
    let prompt = build_prompt(&dictionary);

    // A per-recording choice beats the global setting.
    let language = if recording.language_choice.is_empty() {
        settings.language.clone()
    } else {
        recording.language_choice.clone()
    };

    start_whisper(
        app,
        recording_id,
        &settings,
        &language,
        &check,
        &wav,
        &prefix,
        &prompt,
        task,
    )?;

    let json_file = prefix.with_extension("json");
    // With automatic detection the real language is only known from the output.
    if let Some(j) = language_from_json(&json_file) {
        db::set_language(&connection, recording_id, &j)?;
    }
    let mut segments = load_segments_from_json(&json_file, recording_id).with_context(|| {
        // Report what whisper actually left behind; otherwise this is guesswork
        let remaining_files: Vec<String> = std::fs::read_dir(&working_directory)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        format!(
            "Whisper doběhl, ale výstupní soubor nenapsal. V pracovní složce zůstalo: {}",
            if remaining_files.is_empty() {
                "nic".into()
            } else {
                remaining_files.join(", ")
            }
        )
    })?;

    if segments.is_empty() {
        return Err(anyhow!(
            "Whisper nevrátil žádný text. Zkontroluj, že v nahrávce je slyšet řeč."
        ));
    }

    // ------------------------------------------------------------ vety
    segments = split_into_sentences(segments);

    // ------------------------------------------------------------ slovnik
    apply_dictionary(&mut segments, &dictionary);

    // ------------------------------------------------------------ diarizace
    if settings.diarization {
        if check.issues_diarization.is_empty() {
            status(app, recording_id, "diarization", 0, "Rozlišuji mluvčí");
            match diarize(&settings, &check, &wav) {
                Ok(turns) => segments = assign_speakers(segments, &turns),
                Err(e) => {
                    // Diarizace je bonus. Kdyz selze, prepis prece nezahodime.
                    status(
                        app,
                        recording_id,
                        "diarization",
                        0,
                        &format!("Rozlišení mluvčích selhalo: {e}"),
                    );
                }
            }
        } else {
            status(
                app,
                recording_id,
                "diarization",
                0,
                &check.issues_diarization.join(" "),
            );
        }
    }

    // ------------------------------------------------------------ ulozeni
    status(app, recording_id, "saving", 95, "Ukládám");

    let mut key: Vec<String> = segments.iter().filter_map(|s| s.speakers.clone()).collect();
    key.sort_by_key(|k| order_key(k));
    key.dedup();
    for (i, k) in key.iter().enumerate() {
        db::insert_speaker(
            &connection,
            &db::Speaker {
                key: k.clone(),
                recording_id: recording_id.to_string(),
                // "Mluvčí", not "Řečník" — matching the wording used in the UI
                name: format!("Mluvčí {}", i + 1),
                color: db::COLORS[i % db::COLORS.len()].to_string(),
            },
        )?;
    }

    // One transaction: either the whole transcript is stored or none of it.
    // A write failing midway must not leave half a text in the archive.
    connection.execute_batch("BEGIN")?;
    for s in &segments {
        db::insert_segment(&connection, s)?;
    }
    connection.execute_batch("COMMIT")?;

    let _ = std::fs::remove_dir_all(&working_directory);
    Ok(segments.len())
}

// ---------------------------------------------------------------- whisper

fn build_prompt(dictionary: &[db::DictionaryEntry]) -> String {
    // Whisper bere prompt jako "co uz zaznelo" - staci vyjmenovat terminy carkami.
    let terms: Vec<&str> = dictionary
        .iter()
        .filter(|p| p.prompt)
        .map(|p| p.replace.as_str())
        .collect();
    terms.join(", ")
}

/// Name of the alignment preset for `--dtw`. whisper.cpp names them after
/// the models, only with dots instead of hyphens.
fn dtw_preset(model: &str) -> Option<&'static str> {
    let m = model.to_lowercase();
    if m.contains("large") && m.contains("turbo") {
        Some("large.v3.turbo")
    } else if m.contains("large-v3") || m.contains("large.v3") {
        Some("large.v3")
    } else if m.contains("large-v2") {
        Some("large.v2")
    } else if m.contains("medium") {
        Some("medium")
    } else if m.contains("small") {
        Some("small")
    } else if m.contains("base") {
        Some("base")
    } else {
        None
    }
}

/// Pulls the program's own help text so we know which flags it accepts.
fn program_help(program: &Path) -> String {
    match command(program)
        .arg("--help")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => format!(
            "{}{}",
            String::from_utf8_lossy(&o.stdout),
            String::from_utf8_lossy(&o.stderr)
        ),
        Err(_) => String::new(),
    }
}

// Vychozi hodnoty samotneho whisper.cpp (examples/cli/cli.cpp). Co se jim
// rovna, se na prikazovou radku vubec neposila. Entropii mame jinou uz
// odjakziva — viz `vychozi_prah_entropie` v db.rs.
const WHISPER_NO_SPEECH_THRESHOLD: f64 = 0.6;
const WHISPER_LOGPROB_THRESHOLD: f64 = -1.0;
const WHISPER_ENTROPY_THRESHOLD: f64 = 2.4;
const WHISPER_TEMPERATURE_INCREMENT: f64 = 0.2;

fn start_whisper(
    app: &AppHandle,
    recording_id: &str,
    settings: &Settings,
    language: &str,
    check: &tools::ToolCheck,
    wav: &Path,
    prefix: &Path,
    prompt: &str,
    task: &TranscriptionTask,
) -> Result<()> {
    let program = Path::new(check.whisper_cli.as_ref().unwrap());

    // Find out what this particular build supports. whisper.cpp versions
    // differ, and on an unknown flag the program prints its help and **exits
    // with zero** — it looks like success, only there is no output after it.
    let available = program_help(program);
    let supports = |argument: &str| available.is_empty() || available.contains(argument);

    let mut cmd: Command = command(program);

    cmd.arg("-m")
        .arg(check.model_whisper.as_ref().unwrap())
        .arg("-f")
        .arg(wav)
        .args(["-l", language]);

    if supports("--output-json-full") {
        cmd.arg("--output-json-full");
    } else {
        cmd.arg("--output-json");
    }
    cmd.arg("--output-file").arg(prefix).arg("--print-progress");

    if settings.beam > 1 {
        cmd.args(["--beam-size", &settings.beam.to_string()]);
    }

    // Whisper can get stuck in a loop and repeat one sentence a hundred
    // times over. The safeguard is to limit how much of its own previous
    // output it carries forward.
    //
    // Turning context off entirely (`--no-context`) breaks the loop reliably,
    // but the model then starts every window from scratch and stops producing
    // capitals and punctuation — both of which it decides from the preceding
    // sentence. A short context is the compromise: enough for typesetting the
    // text, not enough to entrench a loop.
    if supports("--max-context") {
        cmd.args(["--max-context", "64"]);
    }
    // Thresholds whisper.cpp uses to decide whether it transcribed a segment
    // properly or should try again. Only those differing from the program's
    // own defaults are passed: a shorter command is easier to read from a log
    // when something goes wrong, and it shows at a glance what was tweaked.
    let differs = |a: f64, b: f64| (a - b).abs() > f64::EPSILON;

    // When the output is suspiciously monotonous, have it retry differently.
    if supports("--entropy-thold") && differs(settings.entropy_threshold, WHISPER_ENTROPY_THRESHOLD)
    {
        cmd.args(["--entropy-thold", &settings.entropy_threshold.to_string()]);
    }
    if supports("--no-speech-thold")
        && differs(settings.threshold_silence, WHISPER_NO_SPEECH_THRESHOLD)
    {
        cmd.args(["--no-speech-thold", &settings.threshold_silence.to_string()]);
    }
    if supports("--logprob-thold")
        && differs(settings.threshold_confidence, WHISPER_LOGPROB_THRESHOLD)
    {
        cmd.args([
            "--logprob-thold",
            &settings.threshold_confidence.to_string(),
        ]);
    }
    if supports("--temperature") && differs(settings.temperature, 0.0) {
        cmd.args(["--temperature", &settings.temperature.to_string()]);
    }
    if supports("--temperature-inc")
        && differs(
            settings.temperature_increment,
            WHISPER_TEMPERATURE_INCREMENT,
        )
    {
        cmd.args([
            "--temperature-inc",
            &settings.temperature_increment.to_string(),
        ]);
    }
    // Without alignment (DTW) the token times are a rough guess and word
    // highlighting drifts towards the end of a segment.
    if supports("--dtw") {
        if let Some(preset) = dtw_preset(&settings.model) {
            cmd.args(["--dtw", preset]);
        }
    }
    if settings.threads > 0 {
        cmd.args(["-t", &settings.threads.to_string()]);
    }
    if !prompt.is_empty() && supports("--prompt") {
        cmd.args(["--prompt", prompt]);
    }

    // VAD: bez ni Whisper na tichu opakuje jeden token dokola a spolkne zacatek reci.
    if settings.vad && supports("--vad ") {
        if let Some(vad) = &check.model_vad {
            cmd.arg("--vad").arg("--vad-model").arg(vad);
            if supports("--vad-threshold") {
                cmd.args(["--vad-threshold", &settings.vad_threshold.to_string()]);
            }
            if supports("--vad-min-speech-duration-ms") {
                cmd.args(["--vad-min-speech-duration-ms", "250"]);
            }
            if supports("--vad-min-silence-duration-ms") {
                cmd.args(["--vad-min-silence-duration-ms", "500"]);
            }
            // bez odsazeni VAD ukusuje prvni slabiky
            if supports("--vad-speech-pad-ms") {
                cmd.args(["--vad-speech-pad-ms", "250"]);
            }
            if supports("--suppress-nst") {
                cmd.arg("--suppress-nst");
            }
        }
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Nepodařilo se spustit whisper-cli")?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // From here the transcription can be cancelled. Without a stored handle
    // there would be no way to kill the process and whisper would run to the
    // end regardless.
    task.record_process(recording_id, child);

    // stderr = postup v procentech
    let app2 = app.clone();
    let id2 = recording_id.to_string();
    let progress_thread = std::thread::spawn(move || {
        let re = Regex::new(r"progress\s*=\s*(\d+)\s*%").unwrap();
        let mut last = 0u32;
        for row in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(c) = re.captures(&row) {
                if let Ok(p) = c[1].parse::<u32>() {
                    if p != last {
                        last = p;
                        status(&app2, &id2, "transcription", p.min(94), "Přepisuji");
                    }
                }
            }
        }
    });

    // stdout = segmenty, jak vznikaji
    let re_segment =
        Regex::new(r"^\[(\d+):(\d+):(\d+)\.(\d+)\s*-->\s*(\d+):(\d+):(\d+)\.(\d+)\]\s*(.*)$")
            .unwrap();
    for row in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(c) = re_segment.captures(row.trim()) {
            let time = |h: &str, m: &str, s: &str, ms: &str| -> f64 {
                h.parse::<f64>().unwrap_or(0.0) * 3600.0
                    + m.parse::<f64>().unwrap_or(0.0) * 60.0
                    + s.parse::<f64>().unwrap_or(0.0)
                    + ms.parse::<f64>().unwrap_or(0.0) / 1000.0
            };
            let _ = app.emit(
                "transcription:segment",
                LiveSegment {
                    recording_id: recording_id.to_string(),
                    start: time(&c[1], &c[2], &c[3], &c[4]),
                    end: time(&c[5], &c[6], &c[7], &c[8]),
                    text: c[9].trim().to_string(),
                },
            );
        }
    }

    let _ = progress_thread.join();
    // take the process back out of the registry; if someone killed it in the
    // meantime it is gone from there, and we read that as a cancellation
    let process_status = match task.processes.lock().unwrap().remove(recording_id) {
        Some(mut child) => child.wait()?,
        None => return Ok(()),
    };

    if !process_status.success() {
        return Err(anyhow!(
            "whisper-cli skončil s chybou (kód {})",
            process_status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

/// The language the transcript ran in. Whisper always writes it into the
/// output, including when it detected the language itself.
fn language_from_json(file: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&contents).ok()?;
    json["result"]["language"].as_str().map(|s| s.to_string())
}

/// Streamovany stdout je hezky pro oko, ale zavazny zdroj dat je JSON -
/// obsahuje i jistotu jednotlivych tokenu.
fn load_segments_from_json(file: &Path, recording_id: &str) -> Result<Vec<Segment>> {
    let contents = std::fs::read_to_string(file)?;
    let json: serde_json::Value = serde_json::from_str(&contents)?;
    let fields = json["transcription"]
        .as_array()
        .ok_or_else(|| anyhow!("V JSON chybí pole 'transcription'"))?;

    let mut result: Vec<Segment> = Vec::new();
    for (i, s) in fields.iter().enumerate() {
        let text = s["text"].as_str().unwrap_or("").trim().to_string();
        if text.is_empty() {
            continue;
        }
        let from = s["offsets"]["from"].as_f64().unwrap_or(0.0) / 1000.0;
        let segment_end = s["offsets"]["to"].as_f64().unwrap_or(0.0) / 1000.0;

        // VAD keeps an overlap between segments (--vad-samples-overlap), so
        // a whole sentence is occasionally repeated at a boundary. The same
        // text at the same time is always a duplicate, never said twice.
        if let Some(p) = result.last() {
            if p.text == text && (p.start - from).abs() < 0.5 {
                continue;
            }
        }

        // Looping: Whisper sometimes repeats one sentence over and over to
        // the end of the recording. A couple of repeats can be rhetoric; ten
        // cannot.
        let repetition_count = result.iter().rev().take_while(|p| p.text == text).count();
        if repetition_count >= 2 {
            continue;
        }

        // prumerna pravdepodobnost tokenu = miru jistoty, kterou v editoru
        // podtrhneme, aby uzivatel vedel, kam se divat
        let confidence = s["tokens"].as_array().map(|t| {
            let values: Vec<f64> = t.iter().filter_map(|x| x["p"].as_f64()).collect();
            if values.is_empty() {
                1.0
            } else {
                values.iter().sum::<f64>() / values.len() as f64
            }
        });

        // Real word timings. Whisper returns them per token, and tokens are
        // often word fragments — glue them back together and take the time
        // from the first fragment.
        let words = s["tokens"].as_array().and_then(|t| {
            let mut output: Vec<serde_json::Value> = Vec::new();
            for tok in t {
                let Some(chunk) = tok["text"].as_str() else {
                    continue;
                };
                // technical markers such as [_BEG_] do not belong in the text
                if chunk.starts_with("[_") {
                    continue;
                }
                let time = tok["offsets"]["from"].as_f64().unwrap_or(0.0) / 1000.0;
                if chunk.starts_with(' ') || output.is_empty() {
                    output.push(serde_json::json!({ "t": time, "s": chunk.trim_start() }));
                } else if let Some(p) = output.last_mut() {
                    // continuation of a split word
                    let joined = format!("{}{}", p["s"].as_str().unwrap_or(""), chunk);
                    p["s"] = serde_json::Value::String(joined);
                }
            }
            output.retain(|x| !x["s"].as_str().unwrap_or("").trim().is_empty());
            if output.len() < 2 {
                None
            } else {
                serde_json::to_string(&output).ok()
            }
        });

        let mut segment = Segment {
            id: uuid::Uuid::new_v4().to_string(),
            recording_id: recording_id.to_string(),
            order: i as i64,
            start: from,
            end: segment_end,
            text,
            speakers: None,
            confidence,
            edited: false,
            verified: false,
            words,
        };
        db::align_word_timestamps(&mut segment);
        result.push(segment);
    }
    Ok(result)
}

// ---------------------------------------------------------------- slovnik

/// Applies the dictionary to an already stored transcript. Returns the number
/// of changed segments. Used when someone adds a term afterwards — otherwise
/// the correction would only show up in the next transcription.
pub fn apply_dictionary_to_recording(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<usize> {
    let dictionary = db::dictionary(connection)?;
    let mut segments = db::segments(connection, recording_id)?;
    let original: Vec<(String, Option<String>)> = segments
        .iter()
        .map(|s| (s.text.clone(), s.words.clone()))
        .collect();

    apply_dictionary(&mut segments, &dictionary);

    let mut changes_applied = 0;
    for (segment, (old_text, old_words)) in segments.iter().zip(original) {
        if segment.text != old_text || segment.words != old_words {
            db::save_segment_text(
                connection,
                &segment.id,
                &segment.text,
                segment.words.as_deref(),
            )?;
            changes_applied += 1;
        }
    }
    Ok(changes_applied)
}

/// Abbreviations after which a full stop does not end the sentence.
const ABBREVIATIONS: &[&str] = &[
    "tzv.", "tzn.", "např.", "resp.", "atd.", "apod.", "mj.", "tj.", "č.", "str.", "kap.", "obr.",
    "sv.", "st.", "mgr.", "ing.", "phdr.", "mudr.", "prof.", "doc.", "mr.", "mrs.", "ms.", "dr.",
    "vs.", "etc.", "e.g.", "i.e.",
];

/// A sentence end is recognised from punctuation, but not every full stop
/// ends a sentence.
fn ends_sentence(word: &str, next: Option<&str>) -> bool {
    let ocesane = word.trim_end_matches(|z: char| z == '"' || z == '»' || z == '“' || z == ')');
    if !ocesane.ends_with(['.', '!', '?', '…']) {
        return false;
    }
    // Question and exclamation marks are unambiguous; a full stop needs care.
    if ocesane.ends_with(['!', '?', '…']) {
        return true;
    }

    let male = ocesane.to_lowercase();
    if ABBREVIATIONS.contains(&male.as_str()) {
        return false;
    }
    // Neither an initial ("J. A. Komenský") nor an ordinal ("3. kapitola").
    let jadro = male.trim_end_matches('.');
    if jadro.chars().count() <= 1 || jadro.chars().all(|z| z.is_ascii_digit()) {
        return false;
    }
    // A sentence end is followed by a capital letter or by nothing.
    match next {
        None => true,
        Some(d) => d
            .chars()
            .find(|z| z.is_alphanumeric())
            .map(|z| z.is_uppercase())
            .unwrap_or(false),
    }
}

/// Splits segments into sentences.
///
/// Whisper divides the text as it pleases: for continuous speech without
/// pauses it dumps a whole thirty-second window as one block, elsewhere it
/// goes sentence by sentence. A long block is awkward in the editor and
/// highlighting inside it is hard to follow. Times come from the stored word
/// timings, so splitting shifts nothing.
fn split_into_sentences(segments: Vec<Segment>) -> Vec<Segment> {
    let mut output: Vec<Segment> = Vec::with_capacity(segments.len());

    for s in segments {
        let Some(json) = s.words.as_deref() else {
            output.push(s);
            continue;
        };
        let Ok(words) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
            output.push(s);
            continue;
        };
        if words.len() < 2 {
            output.push(s);
            continue;
        }

        // Sentence boundaries: indices after which to cut.
        let text_words = |i: usize| words[i]["s"].as_str().unwrap_or("");
        let time_words = |i: usize| words[i]["t"].as_f64().unwrap_or(s.start);

        let mut cuts: Vec<usize> = Vec::new();
        for i in 0..words.len() - 1 {
            if ends_sentence(text_words(i), Some(text_words(i + 1))) {
                cuts.push(i);
            }
        }
        if cuts.is_empty() {
            output.push(s);
            continue;
        }

        let mut from = 0usize;
        let mut order_offset = 0i64;
        for end_sentences in cuts.into_iter().chain(std::iter::once(words.len() - 1)) {
            if end_sentences < from {
                continue;
            }
            let chunks: Vec<&str> = (from..=end_sentences).map(text_words).collect();
            let text = chunks.join(" ").trim().to_string();
            if text.is_empty() {
                from = end_sentences + 1;
                continue;
            }

            let start = time_words(from);
            let end = if end_sentences + 1 < words.len() {
                time_words(end_sentences + 1)
            } else {
                s.end
            };
            let word_data: Vec<serde_json::Value> = (from..=end_sentences)
                .map(|i| serde_json::json!({ "t": time_words(i), "s": text_words(i) }))
                .collect();

            output.push(Segment {
                id: if from == 0 {
                    s.id.clone()
                } else {
                    uuid::Uuid::new_v4().to_string()
                },
                recording_id: s.recording_id.clone(),
                order: s.order * 1000 + order_offset,
                start,
                end: end.max(start),
                text,
                speakers: s.speakers.clone(),
                confidence: s.confidence,
                edited: s.edited,
                verified: s.verified,
                words: serde_json::to_string(&word_data).ok(),
            });
            order_offset += 1;
            from = end_sentences + 1;
        }
    }

    // The ordering had to spread out to fit the new segments. Tidy it up.
    for (i, s) in output.iter_mut().enumerate() {
        s.order = i as i64;
    }
    output
}

fn apply_dictionary(segments: &mut [Segment], dictionary: &[db::DictionaryEntry]) {
    let rules: Vec<(Regex, String)> = dictionary
        .iter()
        .filter(|p| !p.find.trim().is_empty())
        .filter_map(|p| {
            let pattern = format!(r"(?i)\b{}\b", regex::escape(p.find.trim()));
            Regex::new(&pattern)
                .ok()
                .map(|regex| (regex, p.replace.clone()))
        })
        .collect();

    if rules.is_empty() {
        return;
    }
    for s in segments.iter_mut() {
        for (re, replacement) in &rules {
            s.text = re.replace_all(&s.text, replacement.as_str()).to_string();
        }

        // Word timings carry the word text too. Without this, highlighting
        // would keep lighting up the old wording.
        let Some(json) = s.words.as_deref() else {
            continue;
        };
        let Ok(mut chunks) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
            continue;
        };
        let mut change = false;
        for chunk in chunks.iter_mut() {
            let Some(text) = chunk["s"].as_str() else {
                continue;
            };
            let mut new = text.to_string();
            for (re, replacement) in &rules {
                new = re.replace_all(&new, replacement.as_str()).to_string();
            }
            if new != text {
                chunk["s"] = serde_json::Value::String(new);
                change = true;
            }
        }
        if change {
            if let Ok(t) = serde_json::to_string(&chunks) {
                s.words = Some(t);
            }
        }
    }
}

/// Sample density of the waveform. Twelve per second is enough for lively
/// bars; on a very long recording it drops so the total stays under thirty
/// thousand.
/// Must match what the waveform command in main.rs computes, or the same
/// recording would get a different envelope depending on which path made it.
pub const MAX_WAVEFORM_POINTS: f64 = 30_000.0;
pub const EQUALIZER_BAND_COUNT: usize = 24;
pub const EQUALIZER_POINTS_PER_SECOND: usize = 10;

pub fn waveform_density(duration: f64) -> (f64, usize) {
    let points_per_second = if duration > 0.0 {
        (MAX_WAVEFORM_POINTS / duration).min(12.0)
    } else {
        12.0
    };
    let count =
        ((duration * points_per_second).ceil() as usize).clamp(1, MAX_WAVEFORM_POINTS as usize);
    (points_per_second, count)
}

fn waveform_from_wav(
    check: &tools::ToolCheck,
    wav: &Path,
    duration: f64,
) -> Result<db::WaveformData> {
    let ffmpeg = check
        .ffmpeg
        .as_ref()
        .ok_or_else(|| anyhow!("chybí ffmpeg"))?;
    let (points_per_second, count) = waveform_density(duration);
    let points = tools::waveform_amplitude(Path::new(ffmpeg), wav, count)?;
    let equalizer = tools::equalizer_peaks(
        Path::new(ffmpeg),
        wav,
        EQUALIZER_BAND_COUNT,
        EQUALIZER_POINTS_PER_SECOND,
    )?;
    Ok(db::WaveformData {
        points,
        points_per_second,
        equalizer,
        equalizer_points_per_second: EQUALIZER_POINTS_PER_SECOND as f64,
        equalizer_band_count: EQUALIZER_BAND_COUNT,
    })
}

// ---------------------------------------------------------------- diarizace

struct SpeakerTurn {
    start: f64,
    end: f64,
    key: String,
}

fn diarize(settings: &Settings, check: &tools::ToolCheck, wav: &Path) -> Result<Vec<SpeakerTurn>> {
    let program = Path::new(check.sherpa_diarization.as_ref().unwrap());

    // Sherpa is built on the Kaldi option parser: an unknown flag is not an
    // error, the program simply prints its help and exits with zero. So ask it
    // up front what it supports and pass only that.
    let available = program_help(program);
    let supports = |argument: &str| available.is_empty() || available.contains(argument);

    let mut cmd = command(program);
    cmd.arg(format!(
        "--segmentation.pyannote-model={}",
        check.segmentation_model.as_ref().unwrap()
    ))
    .arg(format!(
        "--embedding.model={}",
        check.embedding_model.as_ref().unwrap()
    ));

    if settings.speaker_count > 0 {
        cmd.arg(format!(
            "--clustering.num-clusters={}",
            settings.speaker_count
        ));
    } else if supports("--clustering.cluster-threshold") {
        cmd.arg(format!(
            "--clustering.cluster-threshold={}",
            settings.cluster_threshold
        ));
    } else if supports("--clustering.threshold") {
        cmd.arg(format!(
            "--clustering.threshold={}",
            settings.cluster_threshold
        ));
    }

    // How densely the segmentation windows follow one another. Sherpa
    // defaults to a tenth, i.e. ninety per cent overlap — the slowest setting
    // there is. The user chooses in settings; here we only keep the value
    // inside the range the program accepts, since outside (0, 1] it errors.
    if supports("--segmentation.pyannote-window-shift-ratio") {
        let shift = settings.segmentation_window_shift.clamp(0.05, 1.0);
        cmd.arg(format!(
            "--segmentation.pyannote-window-shift-ratio={shift}"
        ));
    }

    // `--min-duration-on` and `--min-duration-off` are deliberately absent.
    //
    // Raising them is tempting as a cure for fragmentation: a segment shorter
    // than `on` is dropped, a gap shorter than `off` is glued. But what counts
    // as noise in a sermon is content in an interview or a phone recording —
    // a one-word "mhm" or "jasně" belongs to the other person, and dropping it
    // credits their speech to the first speaker. The app serves both, so
    // sherpa's defaults (0.3 and 0.5) stay as the compromise between genres.
    // Fragmentation is handled on our side instead, by smoothing short runs
    // of words.

    // Thread counts are set per model; this program has no shared
    // --num-threads flag.
    let threads = if settings.threads > 0 {
        settings.threads
    } else {
        4
    };
    if supports("--segmentation.num-threads") {
        cmd.arg(format!("--segmentation.num-threads={threads}"));
    }
    if supports("--embedding.num-threads") {
        cmd.arg(format!("--embedding.num-threads={threads}"));
    }
    cmd.arg(wav);

    let output = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output()?;

    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let re = Regex::new(r"([0-9]+\.[0-9]+)\s*--\s*([0-9]+\.[0-9]+)\s*(speaker_?\d+)").unwrap();
    let turns: Vec<SpeakerTurn> = re
        .captures_iter(&text)
        .filter_map(|c| {
            Some(SpeakerTurn {
                start: c[1].parse().ok()?,
                end: c[2].parse().ok()?,
                key: c[3].to_string(),
            })
        })
        .collect();

    if turns.is_empty() {
        // If the program printed its help instead of a result, it rejected
        // one of the flags. Say so plainly rather than leaving it to the dump.
        if text.contains("PrintUsage") || text.contains("Usage example") {
            return Err(anyhow!(
                "Rozlišení mluvčích odmítlo předané volby a vypsalo nápovědu. \
                 Nejspíš má jiná jména přepínačů než ta, se kterými počítáme."
            ));
        }
        return Err(anyhow!(
            "sherpa-onnx nevrátil žádné úseky. Výstup: {}",
            text.chars().take(300).collect::<String>()
        ));
    }
    Ok(turns)
}

/// Kratsi sled slov nez tolik se uvnitr jedne vety nepovazuje za stridani
/// mluvcich, ale za nepresnou hranici.
///
/// Pozor, tohle plati jen *uvnitr* vety. Jednoslovne pritakani v rozhovoru
/// nebo v telefonatu — „mhm“, „jasne“ — vraci Whisper jako samostatny usek,
/// a ten touhle cestou vubec neprochazi: useky kratsi nez dve slova dostanou
/// mluvciho prostym prekryvem a nikdo je nepohlti. Zahodit by se dalo jen
/// jedno slovo vsazene doprostred cizi vety, a to je skoro vzdy chyba
/// diarizace, ne skutecny vstup do reci.
const MIN_SPEAKER_RUN: usize = 2;

/// Poradi mluvciho podle cisla v klici.
///
/// Textove razeni by dalo `speaker_1, speaker_10, speaker_2`, takze by
/// „Mluvci 2“ v prepisu byl ve skutecnosti desaty. Pri deleni po slovech
/// mluvcich pribyva, takze uz to neni jen teoreticka moznost.
fn order_key(key: &str) -> (i64, String) {
    let number = key
        .rsplit(|z: char| !z.is_ascii_digit())
        .next()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(i64::MAX);
    (number, key.to_string())
}

/// Mluvci, s nimz se dany casovy usek nejvic prekryva.
fn speaker_for(start: f64, end: f64, turns: &[SpeakerTurn]) -> Option<String> {
    let mut best: Option<(&str, f64)> = None;
    for u in turns {
        let prekryv = (end.min(u.end) - start.max(u.start)).max(0.0);
        if prekryv > 0.0 && best.map(|(_, p)| prekryv > p).unwrap_or(true) {
            best = Some((&u.key, prekryv));
        }
    }
    best.map(|(k, _)| k.to_string())
}

/// Assigns speakers to transcript segments — per word, not per whole sentence.
///
/// A whole sentence used to get one speaker, whoever it overlapped most. In a
/// sentence someone cuts into halfway through, that credited the second half
/// to the first speaker. Whisper gives us a time for every word, though, so
/// the speaker can be decided word by word and the sentence cut exactly where
/// the speech changes hands.
///
/// Returns a new list — there may be more segments than before.
fn assign_speakers(segments: Vec<Segment>, turns: &[SpeakerTurn]) -> Vec<Segment> {
    let mut output: Vec<Segment> = Vec::with_capacity(segments.len());

    for mut s in segments {
        // Without word timings, only the original per-sentence guess is left.
        let words: Vec<serde_json::Value> = s
            .words
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        if words.len() < 2 {
            s.speakers = speaker_for(s.start, s.end, turns);
            output.push(s);
            continue;
        }

        // Copy the sentence bounds out as plain numbers. Were the closures to
        // read them off `s`, they would hold a borrow on it and the segment
        // could then be neither modified nor moved into the result.
        let sentence_from = s.start;
        let sentence_to = s.end;
        let text_words = |i: usize| words[i]["s"].as_str().unwrap_or("").to_string();
        let time_words = |i: usize| words[i]["t"].as_f64().unwrap_or(sentence_from);

        // A word lasts until the next one starts; the last until the sentence ends.
        let mut speakers_by_word: Vec<Option<String>> = (0..words.len())
            .map(|i| {
                let from = time_words(i);
                let word_end = if i + 1 < words.len() {
                    time_words(i + 1)
                } else {
                    sentence_to
                };
                speaker_for(from, word_end.max(from), turns)
            })
            .collect();

        // Words in silence or outside any recognised span have nobody. They
        // inherit the previous speaker — speech continues until taken over.
        let mut last: Option<String> = None;
        for speaker in speakers_by_word.iter_mut() {
            match speaker {
                Some(key) => last = Some(key.clone()),
                None => *speaker = last.clone(),
            }
        }
        // And at the start of the sentence, backwards from the first known one.
        if speakers_by_word
            .first()
            .map(|speaker| speaker.is_none())
            .unwrap_or(false)
        {
            if let Some(first_speaker) = speakers_by_word.iter().flatten().next().cloned() {
                for speaker in speakers_by_word.iter_mut() {
                    if speaker.is_none() {
                        *speaker = Some(first_speaker.clone());
                    } else {
                        break;
                    }
                }
            }
        }

        // Smoothing: a short island in the middle of someone else's speech is
        // almost certainly an imprecise boundary, not a real handover. A run at
        // the start of a sentence is absorbed by what follows; elsewhere by
        // what precedes.
        let mut i = 0usize;
        while i < speakers_by_word.len() {
            let mut j = i;
            while j + 1 < speakers_by_word.len() && speakers_by_word[j + 1] == speakers_by_word[i] {
                j += 1;
            }
            let duration = j - i + 1;
            if duration < MIN_SPEAKER_RUN {
                let neighbor = if i > 0 {
                    Some(speakers_by_word[i - 1].clone())
                } else if j + 1 < speakers_by_word.len() {
                    Some(speakers_by_word[j + 1].clone())
                } else {
                    // One-word sentence: nobody to lean on, leave it alone.
                    None
                };
                if let Some(neighbor) = neighbor {
                    for speaker in speakers_by_word.iter_mut().take(j + 1).skip(i) {
                        *speaker = neighbor.clone();
                    }
                }
            }
            i = j + 1;
        }

        // Boundaries between speakers inside the sentence.
        let mut cuts: Vec<usize> = Vec::new();
        for i in 0..speakers_by_word.len() - 1 {
            if speakers_by_word[i] != speakers_by_word[i + 1] {
                cuts.push(i);
            }
        }
        if cuts.is_empty() {
            s.speakers = speakers_by_word[0].clone();
            output.push(s);
            continue;
        }

        let mut from = 0usize;
        let mut order_offset = 0i64;
        for end_parts in cuts
            .into_iter()
            .chain(std::iter::once(speakers_by_word.len() - 1))
        {
            if end_parts < from {
                continue;
            }
            let chunks: Vec<String> = (from..=end_parts).map(text_words).collect();
            let text = chunks.join(" ").trim().to_string();
            if text.is_empty() {
                from = end_parts + 1;
                continue;
            }
            let start = time_words(from);
            let end = if end_parts + 1 < words.len() {
                time_words(end_parts + 1)
            } else {
                sentence_to
            };
            let word_data: Vec<serde_json::Value> = (from..=end_parts)
                .map(|i| serde_json::json!({ "t": time_words(i), "s": text_words(i) }))
                .collect();

            output.push(Segment {
                // The original identity goes to the first part that actually
                // materialises. Keying off the start index would lose it when
                // the opening piece comes out empty — and with it any
                // references to the segment, such as signed-off spots.
                id: if order_offset == 0 {
                    s.id.clone()
                } else {
                    uuid::Uuid::new_v4().to_string()
                },
                recording_id: s.recording_id.clone(),
                order: s.order * 1000 + order_offset,
                start,
                end: end.max(start),
                text,
                speakers: speakers_by_word[from].clone(),
                confidence: s.confidence,
                edited: s.edited,
                verified: s.verified,
                words: serde_json::to_string(&word_data).ok(),
            });
            order_offset += 1;
            from = end_parts + 1;
        }
    }

    for (i, s) in output.iter_mut().enumerate() {
        s.order = i as i64;
    }
    output
}
