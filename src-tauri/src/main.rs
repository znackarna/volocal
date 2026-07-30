// Bez konzoloveho okna pri spusteni sestavene aplikace na Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod download;
mod export;
mod tools;
mod transcription;

use anyhow::Result;
use db::{DictionaryEntry, Recording, SearchResult, Segment, Settings, Speaker};
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

// ---------------------------------------------------------------- stav aplikace

struct AppState {
    db: Mutex<Connection>,
    db_path: PathBuf,
    /// Flag used to interrupt a download in progress
    download_cancellation: Arc<AtomicBool>,
    /// Transcriptions in flight, so they can be cancelled
    bezici: transcription::TranscriptionTask,
}

/// Recordings whose waveform is being computed in the background. Without
/// this, every open of the detail screen would start another ffmpeg over the
/// same file.
///
/// A global rather than a field on the app state: the worker thread needs to
/// reach the list too, and it outlives the state.
static WAVEFORM_JOBS: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

fn waveform_jobs() -> &'static Mutex<std::collections::HashSet<String>> {
    WAVEFORM_JOBS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Chyby z anyhow prevedeme na text - Tauri je posle do okna jako odmitnuty slib.
fn stringify_error<T>(v: Result<T>) -> std::result::Result<T, String> {
    v.map_err(|e| format!("{e:#}"))
}

// ---------------------------------------------------------------- nastaveni

#[tauri::command]
fn load_settings(app: State<'_, AppState>) -> std::result::Result<Settings, String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::load_settings(&db))
}

#[tauri::command]
fn save_settings(app: State<'_, AppState>, settings: Settings) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::save_settings(&db, &settings))
}

#[tauri::command]
fn check_tools(app: State<'_, AppState>) -> std::result::Result<tools::ToolCheck, String> {
    let db = app.db.lock().unwrap();
    let n = stringify_error(db::load_settings(&db))?;
    Ok(tools::check(&n))
}

// ---------------------------------------------------------------- knihovna

#[tauri::command]
fn list_recordings(app: State<'_, AppState>) -> std::result::Result<Vec<Recording>, String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::list_recordings(&db))
}

#[tauri::command]
fn add_recording(app: State<'_, AppState>, path: String) -> std::result::Result<Recording, String> {
    let db = app.db.lock().unwrap();
    let settings = stringify_error(db::load_settings(&db))?;

    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(format!("Soubor neexistuje: {path}"));
    }

    let duration = tools::check(&settings)
        .ffprobe
        .and_then(|p| tools::audio_duration(std::path::Path::new(&p), &file).ok())
        .unwrap_or(0.0);

    let title = file
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Bez názvu".into());

    let recording = Recording {
        id: uuid::Uuid::new_v4().to_string(),
        path,
        title,
        duration,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        status: "nova".into(),
        model: String::new(),
        language: String::new(),
        language_choice: String::new(),
        error: None,
        segment_count: 0,
    };
    stringify_error(db::insert_recording(&db, &recording))?;
    Ok(recording)
}

#[tauri::command]
fn delete_recording(app: State<'_, AppState>, id: String) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::delete_recording(&db, &id))
}

#[tauri::command]
fn start_transcription(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
) -> std::result::Result<(), String> {
    // Starting the same transcription twice would write the segments twice.
    // The status lives in the database, so a lock and a look are enough.
    {
        let db = app.db.lock().unwrap();
        let n = stringify_error(db::recording(&db, &id))?;
        if n.status == "prepisuje" {
            return Ok(());
        }
        stringify_error(db::set_status(&db, &id, "prepisuje", None))?;
    }
    transcription::start_in_thread(window, app.db_path.clone(), id, app.bezici.clone());
    Ok(())
}

/// Transcribes a recording in a given language. "auto" leaves it to detection.
#[tauri::command]
fn transcribe_in_language(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    language: String,
) -> std::result::Result<(), String> {
    {
        let db = app.db.lock().unwrap();
        let n = stringify_error(db::recording(&db, &id))?;
        if n.status == "prepisuje" {
            return Ok(());
        }
        stringify_error(db::set_language_choice(&db, &id, &language))?;
        stringify_error(db::set_status(&db, &id, "prepisuje", None))?;
    }
    transcription::start_in_thread(window, app.db_path.clone(), id, app.bezici.clone());
    Ok(())
}

/// Stops a running transcription. The recording returns to the untranscribed pile.
#[tauri::command]
fn cancel_transcription(app: State<'_, AppState>, id: String) -> std::result::Result<(), String> {
    if !app.bezici.cancel(&id) {
        // The process has already finished. Tidy up the status and, above
        // all, clear the cancel flag — otherwise the next transcription of
        // this recording would abort itself.
        app.bezici.forget_cancellation(&id);
        let db = app.db.lock().unwrap();
        stringify_error(db::set_status(&db, &id, "nova", None))?;
    }
    Ok(())
}

/// Discards a finished transcript but keeps the recording in the archive.
#[tauri::command]
fn delete_transcription(app: State<'_, AppState>, id: String) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::delete_segments(&db, &id))?;
    stringify_error(db::delete_speakers(&db, &id))?;
    stringify_error(db::set_status(&db, &id, "nova", None))
}

/// Renames a recording in the archive; the default comes from the file name.
#[tauri::command]
fn rename_recording(
    app: State<'_, AppState>,
    id: String,
    title: String,
) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::rename_recording(&db, &id, title.trim()))
}

#[tauri::command]
fn diarize_speakers(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
) -> std::result::Result<(), String> {
    {
        let db = app.db.lock().unwrap();
        let n = stringify_error(db::recording(&db, &id))?;
        if n.status == "prepisuje" {
            return Err("Počkej, až doběhne přepis.".into());
        }
    }
    transcription::start_diarization_in_thread(window, app.db_path.clone(), id);
    Ok(())
}

// ---------------------------------------------------------------- detail

#[derive(Serialize)]
struct Detail {
    recording: Recording,
    segments: Vec<Segment>,
    speakers: Vec<Speaker>,
}

#[tauri::command]
fn detail(app: State<'_, AppState>, id: String) -> std::result::Result<Detail, String> {
    let db = app.db.lock().unwrap();
    Ok(Detail {
        recording: stringify_error(db::recording(&db, &id))?,
        segments: stringify_error(db::segments(&db, &id))?,
        speakers: stringify_error(db::speakers(&db, &id))?,
    })
}

#[tauri::command]
fn update_segment(
    app: State<'_, AppState>,
    id: String,
    text: String,
) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::update_segment(&db, &id, &text))
}

/// Is the source file still where it was? The transcript lives in the
/// database, so the recording can be deleted — it just cannot be played then.
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// Repoints a recording at a different file, in case it has moved.
#[tauri::command]
fn change_recording_path(
    app: State<'_, AppState>,
    id: String,
    path: String,
) -> std::result::Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err("Takový soubor neexistuje.".into());
    }
    let db = app.db.lock().unwrap();
    let settings = stringify_error(db::load_settings(&db))?;
    let duration = tools::check(&settings)
        .ffprobe
        .and_then(|p| {
            tools::audio_duration(std::path::Path::new(&p), std::path::Path::new(&path)).ok()
        })
        .unwrap_or(0.0);
    stringify_error(db::set_path(&db, &id, &path, duration))
}

/// Waveform for the player. Read from the database; when it is not there
/// yet, it is computed in the background and the window comes back for it.
#[derive(Serialize)]
struct Waveform {
    /// hodnoty 0–255
    points: Vec<u8>,
    /// how many values fall on one second of audio
    points_per_second: f64,
    /// Frequency-band values laid out as frame-major bytes.
    equalizer: Vec<u8>,
    equalizer_points_per_second: f64,
    equalizer_band_count: usize,
    /// Not ready yet, but being computed. The window should ask again shortly.
    is_calculating: bool,
}

impl Waveform {
    fn from_data(data: db::WaveformData, is_calculating: bool) -> Self {
        Waveform {
            points: data.points,
            points_per_second: data.points_per_second,
            equalizer: data.equalizer,
            equalizer_points_per_second: data.equalizer_points_per_second,
            equalizer_band_count: data.equalizer_band_count,
            is_calculating,
        }
    }
}

/// This command never waits for ffmpeg.
///
/// It used to compute a missing waveform inline. That was fine while only the
/// player asked for it, after pressing play. Once the detail screen started
/// requesting it on open, every new recording meant several seconds of waiting
/// for ffmpeg to scan the whole file — and opening a transcript, previously
/// instant, began to stall. Now it is computed aside and the window returns
/// for the result.
#[tauri::command]
fn recording_waveform(
    app: State<'_, AppState>,
    id: String,
) -> std::result::Result<Waveform, String> {
    let (recording, settings, cached) = {
        let db = app.db.lock().unwrap();
        let cached = db::waveform(&db, &id).unwrap_or_default();
        if !cached.points.is_empty() && !cached.equalizer.is_empty() {
            return Ok(Waveform::from_data(cached, false));
        }
        (
            stringify_error(db::recording(&db, &id))?,
            stringify_error(db::load_settings(&db))?,
            cached,
        )
    };

    // Opening the same recording twice must not start another ffmpeg.
    {
        let mut running = waveform_jobs().lock().unwrap();
        if running.contains(&id) {
            return Ok(Waveform::from_data(cached, true));
        }
        running.insert(id.clone());
    }

    let Some(ffmpeg) = tools::check(&settings).ffmpeg else {
        waveform_jobs().lock().unwrap().remove(&id);
        return Ok(Waveform::from_data(cached, false));
    };

    let (points_per_second, count) = transcription::waveform_density(recording.duration);
    let db_path = app.db_path.clone();
    let response = Waveform::from_data(cached.clone(), true);
    std::thread::spawn(move || {
        let mut data = cached;
        if data.points.is_empty() {
            data.points = tools::waveform_amplitude(
                std::path::Path::new(&ffmpeg),
                std::path::Path::new(&recording.path),
                count,
            )
            .unwrap_or_default();
            data.points_per_second = points_per_second;
        }
        if data.equalizer.is_empty() {
            data.equalizer = tools::equalizer_peaks(
                std::path::Path::new(&ffmpeg),
                std::path::Path::new(&recording.path),
                transcription::EQUALIZER_BAND_COUNT,
                transcription::EQUALIZER_POINTS_PER_SECOND,
            )
            .unwrap_or_default();
            data.equalizer_points_per_second = transcription::EQUALIZER_POINTS_PER_SECOND as f64;
            data.equalizer_band_count = transcription::EQUALIZER_BAND_COUNT;
        }

        if !data.points.is_empty() || !data.equalizer.is_empty() {
            // Use a separate connection so analysis never blocks UI database
            // operations.
            if let Ok(connection) = db::open(&db_path) {
                let _ = db::save_waveform(&connection, &recording.id, &data);
            }
        }
        waveform_jobs().lock().unwrap().remove(&recording.id);
    });

    Ok(response)
}

/// Runs the dictionary over a finished transcript. Returns the change count.
#[tauri::command]
fn apply_dictionary(app: State<'_, AppState>, id: String) -> std::result::Result<usize, String> {
    let db = app.db.lock().unwrap();
    stringify_error(transcription::apply_dictionary_to_recording(&db, &id))
}

#[tauri::command]
fn mark_verified(
    app: State<'_, AppState>,
    id: String,
    verified: bool,
) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::mark_verified(&db, &id, verified))
}

#[tauri::command]
fn set_segment_speaker(
    app: State<'_, AppState>,
    id: String,
    speakers: Option<String>,
) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::set_segment_speaker(&db, &id, speakers.as_deref()))
}

#[tauri::command]
fn rename_speaker(
    app: State<'_, AppState>,
    recording_id: String,
    key: String,
    name: String,
) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::rename_speaker(&db, &recording_id, &key, &name))
}

#[tauri::command]
fn merge_speakers(
    app: State<'_, AppState>,
    recording_id: String,
    from_key: String,
    to_key: String,
) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::merge_speakers(&db, &recording_id, &from_key, &to_key))
}

// ---------------------------------------------------------------- slovnik

#[tauri::command]
fn dictionary(app: State<'_, AppState>) -> std::result::Result<Vec<DictionaryEntry>, String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::dictionary(&db))
}

#[tauri::command]
fn add_dictionary_entry(
    app: State<'_, AppState>,
    find: String,
    replace: String,
    prompt: bool,
) -> std::result::Result<DictionaryEntry, String> {
    let db = app.db.lock().unwrap();
    let p = DictionaryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        find,
        replace,
        prompt,
    };
    stringify_error(db::add_dictionary_entry(&db, &p))?;
    Ok(p)
}

#[tauri::command]
fn delete_dictionary_entry(
    app: State<'_, AppState>,
    id: String,
) -> std::result::Result<(), String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::delete_dictionary_entry(&db, &id))
}

// ---------------------------------------------------------------- hledani

#[tauri::command]
fn search(
    app: State<'_, AppState>,
    query: String,
) -> std::result::Result<Vec<SearchResult>, String> {
    let db = app.db.lock().unwrap();
    stringify_error(db::search(&db, &query))
}

// ---------------------------------------------------------------- export

#[tauri::command]
fn export_preview(
    app: State<'_, AppState>,
    id: String,
    format: String,
) -> std::result::Result<String, String> {
    let db = app.db.lock().unwrap();
    let recording = stringify_error(db::recording(&db, &id))?;
    let segments = stringify_error(db::segments(&db, &id))?;
    let speakers = stringify_error(db::speakers(&db, &id))?;
    Ok(export::create(&format, &recording, &segments, &speakers))
}

#[tauri::command]
fn save_export(
    app: State<'_, AppState>,
    id: String,
    format: String,
    path: String,
) -> std::result::Result<String, String> {
    let contents = export_preview(app, id, format)?;
    std::fs::write(&path, contents).map_err(|e| format!("Zápis selhal: {e}"))?;
    Ok(path)
}

#[tauri::command]
fn suggested_name(
    app: State<'_, AppState>,
    id: String,
    format: String,
) -> std::result::Result<String, String> {
    let db = app.db.lock().unwrap();
    let n = stringify_error(db::recording(&db, &id))?;
    let cisty: String = n
        .title
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
        .collect();
    Ok(format!("{}.{}", cisty, export::extension(&format)))
}

// ---------------------------------------------------------------- stahovani

#[tauri::command]
fn catalog(
    app: State<'_, AppState>,
) -> std::result::Result<Vec<download::DownloadComponent>, String> {
    let db = app.db.lock().unwrap();
    let settings = stringify_error(db::load_settings(&db))?;
    Ok(download::catalog(&settings))
}

#[tauri::command]
fn download(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    ids: Vec<String>,
) -> std::result::Result<(), String> {
    let settings = {
        let db = app.db.lock().unwrap();
        stringify_error(db::load_settings(&db))?
    };
    app.download_cancellation.store(false, Ordering::Relaxed);
    download::install_bundle(window, settings, ids, app.download_cancellation.clone());
    Ok(())
}

#[tauri::command]
fn cancel_download(app: State<'_, AppState>) {
    app.download_cancellation.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn create_portable_copy(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    path: String,
) -> std::result::Result<f64, String> {
    let settings = {
        let db = app.db.lock().unwrap();
        stringify_error(db::load_settings(&db))?
    };
    let bytes = download::create_portable_copy(&window, &settings, std::path::Path::new(&path))
        .map_err(|e| format!("{e:#}"))?;
    Ok(bytes as f64 / 1_073_741_824.0)
}

// ---------------------------------------------------------------- vykon stroje

#[derive(Serialize, Clone)]
struct BenchmarkResult {
    compute: String,
    seconds: f64,
    /// how many times faster than real time
    realtime_factor: f64,
    error: Option<String>,
}

/// The flash drive travels between machines. On each new one it pays to
/// briefly measure what is actually faster — guessing from the card's name
/// is misleading.
#[tauri::command]
fn benchmark_compute(
    app: State<'_, AppState>,
    recording_id: Option<String>,
) -> std::result::Result<Vec<BenchmarkResult>, String> {
    use std::path::Path;

    let (settings, source) = {
        let db = app.db.lock().unwrap();
        let settings = stringify_error(db::load_settings(&db))?;
        let source = match &recording_id {
            Some(id) => stringify_error(db::recording(&db, id))?.path,
            None => stringify_error(db::list_recordings(&db))?
                .first()
                .map(|x| x.path.clone())
                .unwrap_or_default(),
        };
        (settings, source)
    };

    if source.is_empty() || !Path::new(&source).is_file() {
        return Err(
            "Přidej nejdřív nějakou nahrávku — zkouška potřebuje kus skutečného zvuku.".into(),
        );
    }

    let root = tools::check(&settings);
    let ffmpeg = root.ffmpeg.clone().ok_or("Chybí ffmpeg")?;
    let model = root.model_whisper.clone().ok_or("Chybí model")?;

    let working_directory = std::env::temp_dir().join("whisp-benchmark");
    std::fs::create_dir_all(&working_directory).map_err(|e| e.to_string())?;
    let sample = working_directory.join("sample.wav");

    // 20 seconds is enough to compare and holds nobody up
    tools::clip(Path::new(&ffmpeg), Path::new(&source), &sample, 20.0)
        .map_err(|e| format!("{e:#}"))?;

    let bin = tools::expand(&settings.bin_directory);
    let mut results = Vec::new();

    for backend in tools::available_compute_backends(&bin) {
        let directory = tools::compute_directory(&bin, &backend);
        let program = match tools::find_program_in(&[directory], "whisper-cli") {
            Some(p) => p,
            None => continue,
        };

        let started_at = std::time::Instant::now();
        let output = tools::command(&program)
            .arg("-m")
            .arg(&model)
            .arg("-f")
            .arg(&sample)
            .args(["-l", &settings.language, "--no-prints"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .output();
        let seconds = started_at.elapsed().as_secs_f64();

        match output {
            Ok(v) if v.status.success() => results.push(BenchmarkResult {
                compute: backend,
                seconds,
                realtime_factor: if seconds > 0.0 { 20.0 / seconds } else { 0.0 },
                error: None,
            }),
            Ok(v) => results.push(BenchmarkResult {
                compute: backend,
                seconds,
                realtime_factor: 0.0,
                error: Some(
                    String::from_utf8_lossy(&v.stderr)
                        .lines()
                        .last()
                        .unwrap_or("neznámá chyba")
                        .to_string(),
                ),
            }),
            Err(e) => results.push(BenchmarkResult {
                compute: backend,
                seconds: 0.0,
                realtime_factor: 0.0,
                error: Some(e.to_string()),
            }),
        }
    }

    let _ = std::fs::remove_dir_all(&working_directory);

    // the fastest of those that finished at all is stored right away
    if let Some(best) = results
        .iter()
        .filter(|v| v.error.is_none() && v.realtime_factor > 0.0)
        .max_by(|a, b| a.realtime_factor.partial_cmp(&b.realtime_factor).unwrap())
    {
        let db = app.db.lock().unwrap();
        let mut settings = stringify_error(db::load_settings(&db))?;
        settings.compute = best.compute.clone();
        settings.last_machine = name_machine();
        stringify_error(db::save_settings(&db, &settings))?;
    }

    results.sort_by(|a, b| b.realtime_factor.partial_cmp(&a.realtime_factor).unwrap());
    Ok(results)
}

#[tauri::command]
fn name_machine() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "neznámý".into())
}

// ---------------------------------------------------------------- start

fn main() {
    // Must happen before Tauri creates the window.
    tools::set_webview2();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // anyhow::Error nejde primo do Box<dyn Error>, proto prevod na text
            connect_database(app).map_err(|e| e.to_string())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            check_tools,
            list_recordings,
            add_recording,
            delete_recording,
            start_transcription,
            transcribe_in_language,
            cancel_transcription,
            delete_transcription,
            rename_recording,
            diarize_speakers,
            detail,
            update_segment,
            file_exists,
            change_recording_path,
            recording_waveform,
            apply_dictionary,
            mark_verified,
            set_segment_speaker,
            rename_speaker,
            merge_speakers,
            dictionary,
            add_dictionary_entry,
            delete_dictionary_entry,
            search,
            export_preview,
            save_export,
            suggested_name,
            benchmark_compute,
            name_machine,
            catalog,
            download,
            cancel_download,
            create_portable_copy,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the application");
}

fn connect_database(app: &tauri::App) -> Result<()> {
    // Prenosny rezim: databaze lezi vedle programu, nic se nezapisuje
    // do profilu uzivatele na cizim pocitaci.
    let directory = tools::data_directory(app.path().app_data_dir()?);
    std::fs::create_dir_all(&directory)?;
    let db_path = directory.join("whisp.db");
    let connection = db::open(&db_path)?;

    // The default paths are relative ("bin", "models") and are resolved
    // against the tools root: next to the executable in portable mode,
    // otherwise the app's own folder in the user profile. Anyone who keeps
    // their tools elsewhere sets an absolute path in the settings.
    let mut settings = db::load_settings(&connection)?;
    let mut changed = false;
    if settings.bin_directory.is_empty() {
        settings.bin_directory = "bin".into();
        changed = true;
    }
    if settings.models_directory.is_empty() {
        settings.models_directory = "models".into();
        changed = true;
    }
    if changed {
        db::save_settings(&connection, &settings)?;
    }

    app.manage(AppState {
        db: Mutex::new(connection),
        db_path,
        download_cancellation: Arc::new(AtomicBool::new(false)),
        bezici: transcription::TranscriptionTask::default(),
    });
    Ok(())
}

