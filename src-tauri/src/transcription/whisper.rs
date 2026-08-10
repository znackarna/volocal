//! Starting whisper-cli and reading what it writes back.
//!
//! One stage of the pipeline, lifted out of transcription.rs unchanged when
//! that file had grown to 3 626 lines. Its tests came with it.

use super::*;

// ---------------------------------------------------------------- whisper

/// Name of the alignment preset for `--dtw`. whisper.cpp names them after
/// the models, only with dots instead of hyphens.
pub(crate) fn dtw_preset(model: &str) -> Option<&'static str> {
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
pub(crate) fn program_help(program: &Path) -> String {
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
pub(crate) const WHISPER_NO_SPEECH_THRESHOLD: f64 = 0.6;
pub(crate) const WHISPER_LOGPROB_THRESHOLD: f64 = -1.0;
pub(crate) const WHISPER_ENTROPY_THRESHOLD: f64 = 2.4;
pub(crate) const WHISPER_TEMPERATURE_INCREMENT: f64 = 0.2;

/// The three things every step of one run needs: the window to report to, which
/// recording is being worked on, and the registry that owns its child processes
/// so it can be cancelled. They are set once when a run starts and never vary
/// within it — which is what makes them a group rather than a bag.
pub(crate) struct Run<'a> {
    pub(crate) app: &'a AppHandle,
    pub(crate) recording_id: &'a str,
    pub(crate) task: &'a TranscriptionTask,
}

pub(crate) fn start_whisper(
    run: &Run,
    settings: &Settings,
    language: &str,
    check: &tools::ToolCheck,
    wav: &Path,
    prefix: &Path,
) -> Reported<()> {
    let Run {
        app,
        recording_id,
        task,
    } = *run;
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
        .map_err(|error| UserMessage::new("transcription.whisper_launch_failed").detail(error))?;

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
        let mut last = TRANSCRIPTION_START_PERCENT;
        for row in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(c) = re.captures(&row) {
                if let Ok(p) = c[1].parse::<u32>() {
                    let overall = overall_transcription_percent(p);
                    if overall != last {
                        last = overall;
                        status(
                            &app2,
                            &id2,
                            "transcription",
                            overall,
                            step("transcription.running"),
                        );
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
    let process_status = match task.take_process(recording_id) {
        Some(mut child) => child.wait()?,
        None => return Ok(()),
    };

    if !process_status.success() {
        return Err(UserMessage::new("transcription.whisper_failed")
            .with("code", process_status.code().unwrap_or(-1)));
    }
    Ok(())
}

/// The language the transcript ran in. Whisper always writes it into the
/// output, including when it detected the language itself.
pub(crate) fn language_from_json(file: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&contents).ok()?;
    json["result"]["language"].as_str().map(|s| s.to_string())
}

/// Streamovany stdout je hezky pro oko, ale zavazny zdroj dat je JSON -
/// obsahuje i jistotu jednotlivych tokenu.
pub(crate) fn load_segments_from_json(file: &Path, recording_id: &str) -> Result<Vec<Segment>> {
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
            original: None,
            words,
        };
        db::align_word_timestamps(&mut segment);
        result.push(segment);
    }
    Ok(result)
}
