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

/// How much of its own previous output whisper carries into the next window.
///
/// A short context is what lets the model punctuate and capitalise, because it
/// decides both from the preceding sentence; too much of it and a repeated
/// sentence entrenches into a loop that runs to the end of the recording.
///
/// It was 0 for the second-language pass while that pass fed whisper
/// disconnected pieces of audio with silence laid between them, where carried
/// context described a sentence from somewhere else in the recording. The
/// multilingual pass hands whisper one turn of speech at a time — see
/// [`Over`] — and every turn carries the ordinary amount.
pub(crate) const CONTEXT_FOR_A_RUN: &str = "64";

/// What one run of whisper is asked for: the language, and how much context it
/// carries. A group rather than a bag, because naming a language without
/// saying how much context goes with it is how a run quietly changes shape.
pub(crate) struct Ask<'a> {
    pub(crate) language: &'a str,
    pub(crate) max_context: &'a str,
}

// whisper.cpp's own defaults (examples/cli/cli.cpp). Anything equal to them is
// not put on the command line at all. Our entropy has always been different —
// see `default_entropy_threshold` in db.rs.
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

/// The flags every run of whisper is given, whatever it is given to read:
/// the search, the thresholds, the alignment, the threads.
fn shared_flags(cmd: &mut Command, settings: &Settings, supports: &dyn Fn(&str) -> bool) {
    if settings.beam > 1 {
        cmd.args(["--beam-size", &settings.beam.to_string()]);
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
}

/// Builds the command one run of whisper is started with.
///
/// Lifted out of [`start_whisper`] so that the arguments can be looked at
/// without a process being spawned — `whisper_command_tests` below pins them,
/// and they are worth pinning: this program answers an unknown flag by printing
/// its help and **exiting with zero**, so a wrong argument does not fail, it
/// silently produces no transcript.
///
/// `available` is the program's own help text rather than something this reads
/// for itself, which is the whole point: fetching it means running the program.
fn whisper_command(
    program: &Path,
    settings: &Settings,
    ask: &Ask,
    check: &tools::ToolCheck,
    wav: &Path,
    prefix: &Path,
    available: &str,
) -> Command {
    let supports = |argument: &str| available.is_empty() || available.contains(argument);

    let mut cmd: Command = command(program);

    cmd.arg("-m")
        .arg(check.model_whisper.as_ref().unwrap())
        .arg("-f")
        .arg(wav)
        .args(["-l", ask.language]);

    if supports("--output-json-full") {
        cmd.arg("--output-json-full");
    } else {
        cmd.arg("--output-json");
    }
    cmd.arg("--output-file").arg(prefix).arg("--print-progress");

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
        cmd.args(["--max-context", ask.max_context]);
    }
    shared_flags(&mut cmd, settings, &supports);
    // VAD: without it Whisper repeats one token over silence and swallows the
    // beginning of the speech.
    //
    // Unconditional since 13 August 2026. `settings.vad` used to stand in front
    // of this, defaulting to true, with a switch in Settings whose own note
    // read *nechte zapnuté* — the only thing the other position could do is
    // reproduce a documented defect. The field stays in the settings record so
    // that configuration written by an older build still loads; nothing reads
    // it now.
    if supports("--vad ") {
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
            // Without the padding, VAD bites off the first syllables.
            if supports("--vad-speech-pad-ms") {
                cmd.args(["--vad-speech-pad-ms", "250"]);
            }
            if supports("--suppress-nst") {
                cmd.arg("--suppress-nst");
            }
        }
    }

    cmd
}

/// What one run of whisper over many files at once is for.
///
/// **Why many at once.** The multilingual pass hands whisper hundreds of short
/// pieces of one recording, and starting the program costs seconds every time,
/// because the model is loaded again on every start. whisper-cli takes any
/// number of `-f`, loads once and walks them in order, writing `<file>.json`
/// beside each one it transcribes and one *auto-detected language* line to its
/// log for each one it only listens to. Measured on the reference recording:
/// 1 272 pieces answered in 107 seconds, which one process a piece would have
/// spent on loading alone.
pub(crate) enum Over<'a> {
    /// Say which language each file is in, and write nothing.
    Languages,
    /// Transcribe every file, in this language.
    Transcript { language: &'a str },
}

/// Builds the command for one run over many short files.
///
/// The files are given by name and the run is started in their folder: four
/// hundred full paths into a temporary directory run past what a Windows
/// command line holds, four hundred names do not.
///
/// No silence detection, because every file is one stretch of speech already,
/// cut by the caller, and the padding and overlap detection adds would only
/// move the times. No `--output-file` either, since whisper applies it to the
/// first file alone; each answer is read from `<file>.json`, where whisper
/// puts it of its own accord.
pub(crate) fn files_command(
    program: &Path,
    settings: &Settings,
    check: &tools::ToolCheck,
    over: &Over,
    names: &[String],
    available: &str,
) -> Command {
    let supports = |argument: &str| available.is_empty() || available.contains(argument);

    let mut cmd: Command = command(program);
    cmd.arg("-m").arg(check.model_whisper.as_ref().unwrap());
    match over {
        Over::Languages => {
            cmd.arg("--detect-language");
            if settings.threads > 0 {
                cmd.args(["-t", &settings.threads.to_string()]);
            }
        }
        Over::Transcript { language } => {
            cmd.args(["-l", language]);
            if supports("--output-json-full") {
                cmd.arg("--output-json-full");
            } else {
                cmd.arg("--output-json");
            }
            if supports("--max-context") {
                cmd.args(["--max-context", CONTEXT_FOR_A_RUN]);
            }
            if supports("--suppress-nst") {
                cmd.arg("--suppress-nst");
            }
            shared_flags(&mut cmd, settings, &supports);
        }
    }
    for name in names {
        cmd.arg("-f").arg(name);
    }
    cmd
}

/// Runs whisper over many files and hands back its log.
///
/// The handshake is [`start_whisper`]'s: the child goes into the registry so
/// `Zrušit` can reach it, its output is read to the end, and it is taken back
/// out to be waited on — unless cancellation took it first, which is reported
/// as the cancellation it was. `started` is told how many files whisper has
/// picked up so far, after each one, so a run over four hundred pieces can
/// move a bar.
pub(crate) fn run_over_files(
    run: &Run,
    mut cmd: Command,
    mut started: impl FnMut(usize),
) -> Reported<String> {
    let Run {
        recording_id, task, ..
    } = *run;
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| UserMessage::new("transcription.whisper_launch_failed").detail(error))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    task.record_process(recording_id, child);

    // stdout carries the text as it is made. Nobody reads it here, but it has
    // to be drained, or the process stops on a full pipe.
    let drain =
        std::thread::spawn(
            move || {
                for _ in BufReader::new(stdout).lines().map_while(Result::ok) {}
            },
        );
    let mut log = String::new();
    let mut picked_up = 0;
    for row in BufReader::new(stderr).lines().map_while(Result::ok) {
        if row.contains("processing '") {
            picked_up += 1;
            started(picked_up);
        }
        log.push_str(&row);
        log.push('\n');
    }
    let _ = drain.join();
    let process_status = match task.take_process(recording_id) {
        Some(mut child) => child.wait()?,
        None => return Err(UserMessage::new("transcription.cancelled")),
    };
    if !process_status.success() {
        return Err(UserMessage::new("transcription.whisper_failed")
            .with("code", process_status.code().unwrap_or(-1)));
    }
    Ok(log)
}

pub(crate) fn start_whisper(
    run: &Run,
    settings: &Settings,
    ask: &Ask,
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
    let mut cmd = whisper_command(program, settings, ask, check, wav, prefix, &available);

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

    // stderr carries the progress percentage.
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

    // stdout carries the segments as they are made.
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

/// The streamed stdout is pleasant to watch, but the JSON is the binding
/// source: it carries the confidence of each token as well.
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

        // The average token probability is the confidence the editor
        // underlines, so the reader knows where to look.
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
            // The recording's own language. The second-language pass reads its
            // own output through this same function and stamps what it keeps
            // afterwards, so this stays `None` here for both.
            language: None,
        };
        db::align_word_timestamps(&mut segment);
        result.push(segment);
    }
    Ok(result)
}

#[cfg(test)]
mod whisper_command_tests {
    //! What whisper is actually asked for.
    //!
    //! Characterization tests: they describe the command as it is built today,
    //! before the second-language pass gives `--max-context` a value of its own.
    //! Nothing in here is a preference — every assertion is the behaviour that
    //! was already shipping when these were written.
    //!
    //! They are worth having for a reason peculiar to this program: an unknown
    //! flag makes whisper-cli print its help and **exit with zero**. A wrong
    //! argument therefore does not fail the run, it produces no transcript and
    //! reports success, which is the hardest kind of defect to see.

    use super::*;
    use crate::db::Settings;
    use crate::tools::ToolCheck;

    /// A build that offers every flag this module knows how to pass.
    const EVERY_FLAG: &str = "--max-context --entropy-thold --no-speech-thold \
        --logprob-thold --temperature --temperature-inc --dtw --vad  --vad-threshold \
        --vad-min-speech-duration-ms --vad-min-silence-duration-ms --vad-speech-pad-ms \
        --suppress-nst --output-json-full";

    fn tools_with_everything() -> ToolCheck {
        ToolCheck {
            whisper_cli: Some("whisper-cli.exe".into()),
            model_whisper: Some("model.bin".into()),
            model_vad: Some("vad.bin".into()),
            ..Default::default()
        }
    }

    fn arguments(
        settings: &Settings,
        check: &ToolCheck,
        language: &str,
        help: &str,
    ) -> Vec<String> {
        let cmd = whisper_command(
            Path::new("whisper-cli.exe"),
            settings,
            &Ask {
                language,
                max_context: CONTEXT_FOR_A_RUN,
            },
            check,
            Path::new("audio.wav"),
            Path::new("out"),
            help,
        );
        cmd.get_args()
            .map(|argument| argument.to_string_lossy().to_string())
            .collect()
    }

    /// The pair as it is written on the command line, so a test asserts on the
    /// flag *and* its value rather than on the flag alone.
    fn value_of<'a>(arguments: &'a [String], flag: &str) -> Option<&'a str> {
        let at = arguments.iter().position(|a| a == flag)?;
        arguments.get(at + 1).map(String::as_str)
    }

    /// 64 is not an arbitrary number: it is the compromise `start_whisper`
    /// documents — enough context for whisper to punctuate and capitalise, not
    /// enough for it to entrench a loop. This test is what makes a change to
    /// it deliberate rather than a drift.
    #[test]
    fn a_run_carries_sixty_four_tokens_of_context() {
        let arguments = arguments(
            &Settings::default(),
            &tools_with_everything(),
            "cs",
            EVERY_FLAG,
        );
        assert_eq!(value_of(&arguments, "--max-context"), Some("64"));
    }

    fn over(over: &Over, names: &[&str], help: &str) -> Vec<String> {
        let names: Vec<String> = names.iter().map(|n| (*n).to_string()).collect();
        let cmd = files_command(
            Path::new("whisper-cli.exe"),
            &Settings::default(),
            &tools_with_everything(),
            over,
            &names,
            help,
        );
        cmd.get_args()
            .map(|argument| argument.to_string_lossy().to_string())
            .collect()
    }

    /// **The multilingual pass.** Every file on the line by name, the language
    /// asked for once, and no `--output-file` — whisper applies that to the
    /// first file alone, and each answer is read from beside its file instead.
    #[test]
    fn a_run_over_files_names_each_file_and_no_output_file() {
        let arguments = over(
            &Over::Transcript { language: "en" },
            &["0000.wav", "0001.wav", "0002.wav"],
            EVERY_FLAG,
        );
        let files: Vec<&str> = arguments
            .iter()
            .enumerate()
            .filter(|(at, a)| *a == "-f" && *at + 1 < arguments.len())
            .map(|(at, _)| arguments[at + 1].as_str())
            .collect();
        assert_eq!(files, vec!["0000.wav", "0001.wav", "0002.wav"]);
        assert_eq!(value_of(&arguments, "-l"), Some("en"));
        assert_eq!(value_of(&arguments, "--max-context"), Some("64"));
        assert!(arguments.iter().any(|a| a == "--output-json-full"));
        assert!(!arguments.iter().any(|a| a == "--output-file"));
    }

    /// A turn is one stretch of speech already. Silence detection would only
    /// pad it and move the times.
    #[test]
    fn a_run_over_files_asks_for_no_silence_detection() {
        let arguments = over(
            &Over::Transcript { language: "cs" },
            &["0000.wav"],
            EVERY_FLAG,
        );
        assert!(!arguments.iter().any(|a| a == "--vad"));
        assert!(!arguments.iter().any(|a| a == "--vad-model"));
        // The thresholds and the alignment still travel: this is a transcript.
        assert_eq!(value_of(&arguments, "--entropy-thold"), Some("2.6"));
        assert_eq!(value_of(&arguments, "--dtw"), Some("large.v3"));
        assert!(arguments.iter().any(|a| a == "--suppress-nst"));
    }

    /// Listening for the language asks for that and nothing else: no language,
    /// no output, no thresholds that only a transcript needs.
    #[test]
    fn listening_asks_for_the_language_and_nothing_else() {
        let arguments = over(&Over::Languages, &["0000.wav", "0001.wav"], EVERY_FLAG);
        assert!(arguments.iter().any(|a| a == "--detect-language"));
        assert!(!arguments.iter().any(|a| a == "-l"));
        assert!(!arguments.iter().any(|a| a == "--output-json-full"));
        assert!(!arguments.iter().any(|a| a == "--dtw"));
        assert_eq!(arguments.iter().filter(|a| *a == "-f").count(), 2);
    }

    #[test]
    fn the_model_the_audio_and_the_language_are_passed() {
        let arguments = arguments(
            &Settings::default(),
            &tools_with_everything(),
            "cs",
            EVERY_FLAG,
        );
        assert_eq!(value_of(&arguments, "-m"), Some("model.bin"));
        assert_eq!(value_of(&arguments, "-f"), Some("audio.wav"));
        assert_eq!(value_of(&arguments, "-l"), Some("cs"));
        assert_eq!(value_of(&arguments, "--output-file"), Some("out"));
    }

    /// Only thresholds that differ from whisper.cpp's own are put on the line.
    /// Entropy is the one that always differs — 2.6 against whisper's 2.4,
    /// because on Czech the model loops more often than 2.4 catches.
    #[test]
    fn only_a_threshold_that_differs_from_whispers_own_is_passed() {
        let arguments = arguments(
            &Settings::default(),
            &tools_with_everything(),
            "cs",
            EVERY_FLAG,
        );
        assert_eq!(value_of(&arguments, "--entropy-thold"), Some("2.6"));
        assert!(!arguments.iter().any(|a| a == "--no-speech-thold"));
        assert!(!arguments.iter().any(|a| a == "--logprob-thold"));
        assert!(!arguments.iter().any(|a| a == "--temperature"));
        assert!(!arguments.iter().any(|a| a == "--temperature-inc"));
    }

    #[test]
    fn a_threshold_the_reader_moved_is_passed() {
        let settings = Settings {
            threshold_silence: 0.4,
            ..Default::default()
        };
        let arguments = arguments(&settings, &tools_with_everything(), "cs", EVERY_FLAG);
        assert_eq!(value_of(&arguments, "--no-speech-thold"), Some("0.4"));
    }

    /// Silence detection is unconditional and brings its model with it —
    /// without it whisper repeats one token over silence.
    #[test]
    fn silence_detection_is_asked_for_with_its_model() {
        let arguments = arguments(
            &Settings::default(),
            &tools_with_everything(),
            "cs",
            EVERY_FLAG,
        );
        assert!(arguments.iter().any(|a| a == "--vad"));
        assert_eq!(value_of(&arguments, "--vad-model"), Some("vad.bin"));
        assert_eq!(value_of(&arguments, "--vad-speech-pad-ms"), Some("250"));
    }

    /// A build that does not offer a flag is not given it. The help text is the
    /// only evidence there is, and passing an unknown flag costs the whole run.
    #[test]
    fn a_flag_the_build_does_not_offer_is_left_out() {
        let arguments = arguments(
            &Settings::default(),
            &tools_with_everything(),
            "cs",
            "-m -f -l --output-json",
        );
        assert!(!arguments.iter().any(|a| a == "--max-context"));
        assert!(!arguments.iter().any(|a| a == "--vad"));
        assert!(!arguments.iter().any(|a| a == "--dtw"));
        // The fallback, for a build too old to write the full JSON.
        assert!(arguments.iter().any(|a| a == "--output-json"));
        assert!(!arguments.iter().any(|a| a == "--output-json-full"));
    }

    /// Empty help means the program could not be asked. Everything is then
    /// passed rather than nothing — see `supports` in this module.
    #[test]
    fn a_build_that_could_not_be_asked_is_given_everything() {
        let arguments = arguments(&Settings::default(), &tools_with_everything(), "cs", "");
        assert_eq!(value_of(&arguments, "--max-context"), Some("64"));
        assert!(arguments.iter().any(|a| a == "--vad"));
    }

    /// Word timings come from the alignment preset, and the preset is named
    /// after the model. A model with no preset simply goes without.
    #[test]
    fn the_alignment_preset_follows_the_model() {
        let named = arguments(
            &Settings::default(),
            &tools_with_everything(),
            "cs",
            EVERY_FLAG,
        );
        assert_eq!(value_of(&named, "--dtw"), Some("large.v3"));

        let settings = Settings {
            model: "tiny".into(),
            ..Default::default()
        };
        let unnamed = arguments(&settings, &tools_with_everything(), "cs", EVERY_FLAG);
        assert!(!unnamed.iter().any(|a| a == "--dtw"));
    }

    /// Without the model there is nothing to detect silence with, so the whole
    /// block is skipped rather than half of it being passed.
    #[test]
    fn silence_detection_is_skipped_when_its_model_is_missing() {
        let check = ToolCheck {
            model_vad: None,
            ..tools_with_everything()
        };
        let arguments = arguments(&Settings::default(), &check, "cs", EVERY_FLAG);
        assert!(!arguments.iter().any(|a| a == "--vad"));
        assert!(!arguments.iter().any(|a| a == "--vad-model"));
    }
}

#[cfg(test)]
mod loaded_segment_tests {
    //! What whisper's own JSON becomes.
    //!
    //! Characterization tests, written before the second-language pass leans on
    //! two of these rules. That pass runs with no text context, which is what
    //! recovers the other language and also what reopens the looping whisper is
    //! prone to — so the guard against a repeated sentence stops being a
    //! long-stop and becomes load-bearing. The duplicate rule matters for the
    //! same reason: silence detection keeps an overlap between windows, and a
    //! second pass over the same audio produces those doubles again.
    //!
    //! Nothing here is new behaviour. Every assertion is what was already
    //! shipping when these were written.

    use super::*;

    /// A throwaway JSON file. No test dependency: one counter keeps the names
    /// from colliding, the same way `machine_with` does in `tools.rs`.
    fn written(json: serde_json::Value) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "volocal-whisper-json-{}-{}.json",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, json.to_string()).unwrap();
        path
    }

    /// One entry of whisper's `transcription` array, with no token detail.
    fn spoken(text: &str, from_ms: u64, to_ms: u64) -> serde_json::Value {
        serde_json::json!({
            "text": text,
            "offsets": { "from": from_ms, "to": to_ms },
        })
    }

    fn load(entries: Vec<serde_json::Value>) -> Vec<Segment> {
        let file = written(serde_json::json!({ "transcription": entries }));
        let segments = load_segments_from_json(&file, "recording").unwrap();
        let _ = std::fs::remove_file(&file);
        segments
    }

    /// Silence detection keeps an overlap between windows, so a whole sentence
    /// is occasionally written twice at the boundary. The same text at the same
    /// moment is a duplicate, never something said twice.
    #[test]
    fn the_same_text_at_the_same_moment_is_one_segment() {
        let segments = load(vec![
            spoken("Jeden prut, jedna návnada.", 1000, 4000),
            spoken("Jeden prut, jedna návnada.", 1200, 4200),
        ]);
        assert_eq!(segments.len(), 1);
    }

    /// Half a second apart is the line: beyond it the two are separate remarks,
    /// however alike.
    #[test]
    fn the_same_text_well_apart_is_two_segments() {
        let segments = load(vec![
            spoken("Ano.", 1000, 2000),
            spoken("Ano.", 9000, 10000),
        ]);
        assert_eq!(segments.len(), 2);
    }

    /// **The guard the second pass depends on.** Whisper can repeat one
    /// sentence to the end of a recording. Two in a row can be rhetoric; the
    /// third and everything after it is a loop.
    #[test]
    fn a_sentence_repeated_over_and_over_is_cut_to_two() {
        let mut entries = Vec::new();
        for turn in 0..12 {
            entries.push(spoken(
                "A pak se to stalo.",
                turn * 4000,
                turn * 4000 + 3000,
            ));
        }
        let segments = load(entries);
        assert_eq!(segments.len(), 2, "a loop must not reach the transcript");
    }

    /// An empty line carries nothing and is not a segment.
    #[test]
    fn an_entry_with_no_words_is_skipped() {
        let segments = load(vec![
            spoken("   ", 0, 1000),
            spoken("Dobrý den.", 1000, 2000),
        ]);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "Dobrý den.");
    }

    /// Times arrive in milliseconds and are kept in seconds.
    #[test]
    fn milliseconds_become_seconds() {
        let segments = load(vec![spoken("Dobrý den.", 1500, 4250)]);
        assert_eq!(segments[0].start, 1.5);
        assert_eq!(segments[0].end, 4.25);
    }

    /// The confidence the editor underlines is the mean token probability.
    #[test]
    fn confidence_is_the_mean_of_the_token_probabilities() {
        let segments = load(vec![serde_json::json!({
            "text": "Dobrý den.",
            "offsets": { "from": 0, "to": 1000 },
            "tokens": [
                { "text": "Dobrý", "p": 0.5, "offsets": { "from": 0 } },
                { "text": " den.", "p": 0.9, "offsets": { "from": 500 } },
            ],
        })]);
        let confidence = segments[0].confidence.unwrap();
        assert!((confidence - 0.7).abs() < 1e-9, "got {confidence}");
    }

    /// Tokens are often word fragments. They are glued back together and the
    /// time comes from the first fragment; a marker such as `[_BEG_]` is not a
    /// word and does not become one.
    #[test]
    fn split_words_are_glued_back_together_without_the_markers() {
        let segments = load(vec![serde_json::json!({
            "text": "Nepřehlédnutelné dítě",
            "offsets": { "from": 0, "to": 4000 },
            "tokens": [
                { "text": "[_BEG_]", "p": 1.0, "offsets": { "from": 0 } },
                { "text": " Nepře", "p": 1.0, "offsets": { "from": 0 } },
                { "text": "hlédnutelné", "p": 1.0, "offsets": { "from": 500 } },
                { "text": " dítě", "p": 1.0, "offsets": { "from": 2000 } },
            ],
        })]);
        let words: Vec<serde_json::Value> =
            serde_json::from_str(segments[0].words.as_ref().unwrap()).unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[0]["s"], "Nepřehlédnutelné");
        assert_eq!(words[1]["s"], "dítě");
        assert_eq!(words[0]["t"], 0.0);
    }

    /// A single word carries no timing worth keeping — two is the fewest that
    /// can light one at a time.
    #[test]
    fn one_word_alone_gets_no_timings() {
        let segments = load(vec![serde_json::json!({
            "text": "Ano",
            "offsets": { "from": 0, "to": 1000 },
            "tokens": [{ "text": " Ano", "p": 1.0, "offsets": { "from": 0 } }],
        })]);
        assert!(segments[0].words.is_none());
    }

    /// Position is the entry's place in whisper's own array, which is what the
    /// transcript is ordered by.
    #[test]
    fn segments_keep_the_order_they_arrived_in() {
        let segments = load(vec![
            spoken("První.", 0, 1000),
            spoken("Druhá.", 2000, 3000),
            spoken("Třetí.", 4000, 5000),
        ]);
        let order: Vec<i64> = segments.iter().map(|s| s.order).collect();
        assert_eq!(order, vec![0, 1, 2]);
    }
}
