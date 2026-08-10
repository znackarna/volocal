//! Which way of computing this machine can use, and which is fastest.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::user_message::UserMessage;
use crate::{db, tools};
use crate::{reported, AppState, Reported};
use serde::Serialize;
use tauri::State;
// ---------------------------------------------------------------- vykon stroje

#[derive(Serialize, Clone)]
pub(crate) struct BenchmarkResult {
    compute: String,
    seconds: f64,
    /// how many times faster than real time
    realtime_factor: f64,
    /// Why this backend did not finish. Absent when it did.
    error: Option<UserMessage>,
}

/// The flash drive travels between machines. On each new one it pays to
/// briefly measure what is actually faster — guessing from the card's name
/// is misleading.
///
/// `async`: it runs whisper once per installed backend over a twenty-second
/// sample, which on a slow processor is a minute or more of a window that does
/// not repaint.
#[tauri::command(async)]
pub fn benchmark_compute(
    app: State<'_, AppState>,
    recording_id: Option<String>,
) -> Reported<Vec<BenchmarkResult>> {
    use std::path::Path;

    let (settings, source) = {
        let db = app.db.lock().unwrap();
        let settings = reported(db::load_settings(&db))?;
        let source = match &recording_id {
            Some(id) => reported(db::recording(&db, id))?.path,
            None => reported(db::list_recordings(&db))?
                .first()
                .map(|x| x.path.clone())
                .unwrap_or_default(),
        };
        (settings, source)
    };

    if source.is_empty() || !Path::new(&source).is_file() {
        return Err(UserMessage::new("benchmark.no_recording"));
    }

    let root = tools::check(&settings);
    let ffmpeg = root
        .ffmpeg
        .clone()
        .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;
    let model = root
        .model_whisper
        .clone()
        .ok_or_else(|| UserMessage::new("tools.model_missing"))?;

    let working_directory = std::env::temp_dir().join("whisp-benchmark");
    std::fs::create_dir_all(&working_directory)?;
    let sample = working_directory.join("sample.wav");

    // 20 seconds is enough to compare and holds nobody up
    tools::clip(Path::new(&ffmpeg), Path::new(&source), &sample, 20.0)?;

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
                // The last line the program printed is the only thing that
                // says anything here, and it comes from the program itself.
                error: Some(match String::from_utf8_lossy(&v.stderr).lines().last() {
                    Some(line) => UserMessage::new("benchmark.backend_failed").detail(line),
                    None => UserMessage::new("benchmark.unknown_failure"),
                }),
            }),
            Err(e) => results.push(BenchmarkResult {
                compute: backend,
                seconds: 0.0,
                realtime_factor: 0.0,
                error: Some(UserMessage::new("benchmark.launch_failed").detail(e)),
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
        let mut settings = reported(db::load_settings(&db))?;
        settings.compute = best.compute.clone();
        settings.last_machine = name_machine();
        reported(db::save_settings(&db, &settings))?;
    }

    results.sort_by(|a, b| b.realtime_factor.partial_cmp(&a.realtime_factor).unwrap());
    Ok(results)
}

#[tauri::command]
pub fn name_machine() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "neznámý".into())
}
