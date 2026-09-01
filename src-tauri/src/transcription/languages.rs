//! Whether a recording holds a second language, and how sure we are.
//!
//! A sweep, not a transcript: a handful of short windows spread across the
//! recording, each handed to whisper's own language detection. It runs at the
//! end of a transcription, where the prepared WAV still exists, so no audio is
//! decoded twice.
//!
//! **Why this exists at all.** whisper is given one language for the whole
//! file, so a recording where two people speak two languages comes back as one
//! of them and the other is silently absent — measured on a 47-minute
//! interpreted talk, one caption out of 494 was the second language and close
//! to half the speech was missing. The transcript looked complete, which is
//! worse than a visible failure. See `docs/history/`.
//!
//! **What it deliberately does not do.** It does not name every language in the
//! recording, only the strongest one that is not the recording's own. The offer
//! it feeds is a single question with a single button, and a recording carrying
//! three languages is not a case anybody has yet.

use super::*;

/// How long one sampled window is.
///
/// Ten seconds is what the measurement used. Shorter is cheaper and less
/// certain; longer collects both languages into one window and the detection
/// then reports whichever is louder.
const WINDOW_SECONDS: f64 = 10.0;

/// The fewest and the most windows one sweep listens to.
///
/// Measured: one window costs about 1.1 seconds including loading the model, so
/// sixteen is under twenty seconds — half a per cent of a forty-minute
/// transcription. Six is the floor because fewer cannot show a pattern.
const FEWEST_SAMPLES: usize = 6;
const MOST_SAMPLES: usize = 16;

/// Below this the detection is not confident enough to count as anything.
///
/// **This was 0.60 and 0.60 found nothing.** On the reference recording the
/// sweep sampled three English windows out of sixteen — the share the full
/// measurement predicts — and they came back at 0.50, 0.57 and 0.56. Every one
/// was thrown away by the floor, so an interpreted talk with close to half its
/// speech missing offered nothing at all. The floor put there against noise was
/// removing the evidence.
///
/// The reason is in the material rather than in the model. Consecutive
/// interpretation puts both languages inside almost every window, so the
/// detector is never confident about the quieter one; a second language is
/// *expected* to score low, and scoring low is not the same as being absent.
///
/// **0.45 is measured from both sides.** Across 287 windows of the interpreted
/// recording the English confidences run from 0.38 with a tenth percentile of
/// 0.51 and a median of 0.65 — and not one window came back a language that was
/// neither of the two, so on a long file this kind of noise did not occur at
/// all. On a genuinely single-language control the five real windows scored
/// 0.996 and the one stray reading was English at 0.38. So the gap to sit in is
/// 0.38 to 0.51, and 0.45 is the middle of it: above everything observed to be
/// noise, below nine tenths of what was observed to be a real second language.
///
/// The rule does not balance on this number. Anything from 0.40 to 0.50 keeps
/// 55 or more of the 59 English windows and rejects the stray reading, and
/// [`LEAST_AGREEING`] is what actually stops a single odd window.
const CONFIDENT: f64 = 0.45;

/// How many windows must agree before the reader is told anything.
///
/// **Two, not a fraction.** One window is noise — a name, a quoted sentence, a
/// song. Two windows apart in the recording is a pattern. A share was the first
/// idea and it was worse: it turns on how many samples were taken, so the same
/// recording would answer differently at six samples and at sixteen.
const LEAST_AGREEING: usize = 2;

/// How many windows to listen to, from the recording's length: about one a
/// minute, between the two bounds.
pub(crate) fn sample_count(seconds: f64) -> usize {
    let minutes = (seconds / 60.0).round().max(0.0) as usize;
    minutes.clamp(FEWEST_SAMPLES, MOST_SAMPLES)
}

/// Where to listen, spread evenly and never at the very edges.
///
/// The opening of a recording is where somebody is still finding their words
/// and the end is where they are thanking the room; both are poor evidence of
/// what language the middle is in. Each point is the *start* of its window, so
/// the last one is pulled back far enough to fit.
pub(crate) fn sample_points(seconds: f64, count: usize) -> Vec<f64> {
    if seconds <= WINDOW_SECONDS || count == 0 {
        return vec![0.0];
    }
    let last_start = seconds - WINDOW_SECONDS;
    // A margin at each end, but never so large that a short recording has
    // nothing left in the middle to sample.
    let margin = (seconds * 0.05).min(last_start / 4.0);
    let from = margin;
    let to = last_start - margin;
    if to <= from {
        return vec![last_start / 2.0];
    }
    (0..count)
        .map(|index| {
            if count == 1 {
                (from + to) / 2.0
            } else {
                from + (to - from) * index as f64 / (count - 1) as f64
            }
        })
        .collect()
}

/// Writes one window of 16 kHz mono samples as a WAV whisper will read.
///
/// By hand rather than through ffmpeg, and that is the whole reason the sweep
/// is cheap: sixteen windows would otherwise be sixteen more processes, each
/// re-opening and seeking the source. The prepared WAV is already exactly the
/// shape whisper wants, so this only copies a slice of it and puts a header on.
fn write_window(path: &Path, samples: &[i16], rate: u32) -> std::io::Result<()> {
    let data_bytes = (samples.len() * 2) as u32;
    let mut out: Vec<u8> = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM header length
    out.extend_from_slice(&1u16.to_le_bytes()); // uncompressed
    out.extend_from_slice(&1u16.to_le_bytes()); // one channel
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes()); // bytes a second
    out.extend_from_slice(&2u16.to_le_bytes()); // bytes a frame
    out.extend_from_slice(&16u16.to_le_bytes()); // bits a sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    std::fs::write(path, out)
}

/// The language and the confidence out of whisper's own report.
///
/// The line it writes is `auto-detected language: cs (p = 0.997182)`. Parsed
/// rather than asked for as JSON because `--detect-language` writes no file —
/// it says this and exits.
pub(crate) fn detected_language(output: &str) -> Option<(String, f64)> {
    let line = output
        .lines()
        .find(|line| line.contains("auto-detected language:"))?;
    let after = line.split("auto-detected language:").nth(1)?.trim();
    let code = after
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '-')
        .find(|piece| !piece.is_empty())?;
    let probability = line
        .split("p =")
        .nth(1)
        .and_then(|rest| {
            rest.trim()
                .trim_start_matches('=')
                .split(|c: char| !(c.is_ascii_digit() || c == '.'))
                .find(|piece| !piece.is_empty())
                .and_then(|piece| piece.parse::<f64>().ok())
        })
        .unwrap_or(0.0);
    Some((code.to_ascii_lowercase(), probability))
}

/// Which language the sweep should report, given what the windows said.
///
/// Separated from the running of it so the rule can be tested without a model:
/// the strongest language that is not the recording's own, and only when at
/// least [`LEAST_AGREEING`] windows say so.
pub(crate) fn strongest_other(
    heard: &[(String, f64)],
    own: &str,
    sampled: usize,
) -> Option<(String, f64)> {
    let mut tally: HashMap<&str, usize> = HashMap::new();
    for (code, probability) in heard {
        if *probability < CONFIDENT || code.eq_ignore_ascii_case(own) {
            continue;
        }
        *tally.entry(code.as_str()).or_default() += 1;
    }
    // Ties broken by the name, so one recording always answers the same way.
    let (code, count) = tally
        .into_iter()
        .max_by(|left, right| left.1.cmp(&right.1).then(right.0.cmp(left.0)))?;
    if count < LEAST_AGREEING {
        return None;
    }
    Some((code.to_string(), count as f64 / sampled.max(1) as f64))
}

/// Listens across the recording and says whether a second language is in it.
///
/// `own` is the language the transcript was written in, which is whisper's own
/// answer for the whole file rather than the setting — a run left on automatic
/// only learns it from the output.
///
/// Failure is not an error. A sweep that cannot run leaves the recording exactly
/// as a recording in one language: nothing is offered, and a finished transcript
/// is never held up over it.
pub(crate) fn sweep(
    check: &tools::ToolCheck,
    wav: &Path,
    own: &str,
    recording_id: &str,
    task: &TranscriptionTask,
) -> Option<db::SecondLanguage> {
    let program = Path::new(check.whisper_cli.as_ref()?);
    let model = check.model_whisper.as_ref()?;
    let (samples, rate) = read_pcm16(wav)?;
    if rate == 0 || samples.is_empty() {
        return None;
    }
    let seconds = samples.len() as f64 / f64::from(rate);
    let points = sample_points(seconds, sample_count(seconds));

    let folder = std::env::temp_dir().join(format!("volocal-languages-{}", std::process::id()));
    std::fs::create_dir_all(&folder).ok()?;
    let window_file = folder.join(format!("{}.wav", uuid::Uuid::new_v4()));

    let mut heard: Vec<(String, f64)> = Vec::with_capacity(points.len());
    for point in &points {
        // Cancelling a transcription must not be held up by the sweep. It is
        // checked between windows because one window cannot be interrupted.
        if task.was_cancelled(recording_id) {
            break;
        }
        let from = (point * f64::from(rate)) as usize;
        let to = ((point + WINDOW_SECONDS) * f64::from(rate)) as usize;
        let piece = samples.get(from..to.min(samples.len()))?;
        if piece.is_empty() || write_window(&window_file, piece, rate).is_err() {
            continue;
        }
        let output = command(program)
            .arg("-m")
            .arg(model)
            .arg("-f")
            .arg(&window_file)
            .arg("--detect-language")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();
        let Ok(output) = output else { continue };
        let said = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if let Some(found) = detected_language(&said) {
            heard.push(found);
        }
    }
    let _ = std::fs::remove_file(&window_file);
    let _ = std::fs::remove_dir(&folder);

    let (language, share) = strongest_other(&heard, own, heard.len())?;
    Some(db::SecondLanguage {
        recording_id: recording_id.to_string(),
        language,
        share,
        state: db::second_language_state::OFFERED.to_string(),
        filled_at: None,
    })
}

/// Sweeps a transcript that is already in the archive.
///
/// **The hole this closes.** The sweep otherwise runs only at the end of a
/// transcription, so every recording that was in the archive before it existed
/// would never be asked about — and the person worst served by that is exactly
/// the one this feature is for, somebody with a back catalogue of interpreted
/// recordings none of which says that half its speech is missing.
///
/// The difference from the sweep inside a run is the audio: there is no
/// prepared WAV any more, so one is made and thrown away again. That is the
/// whole cost, and it is why this is asked for rather than done to every
/// recording on sight.
///
/// It stands in the same queue as a transcription. Not because it is heavy —
/// it is about twenty seconds — but because it runs whisper, and two of those
/// on one graphics card finish later than either would alone.
pub fn sweep_existing(
    db_path: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
) -> Reported<Option<db::SecondLanguage>> {
    let connection = db::open(db_path)?;
    let settings = db::load_settings(&connection)?;
    let recording = db::recording(&connection, recording_id)?;

    // Nothing to compare a second language against. Refused rather than swept,
    // because an answer about a recording with no transcript is meaningless.
    if db::segments(&connection, recording_id)?.is_empty() {
        return Err(UserMessage::new("second_language.no_transcript"));
    }

    let check = tools::check(&settings);
    let ffmpeg = check
        .ffmpeg
        .clone()
        .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;
    if !Path::new(&recording.path).is_file() {
        return Err(UserMessage::new("playback.source_missing"));
    }

    let working_directory = std::env::temp_dir()
        .join("volocal-languages")
        .join(recording_id);
    std::fs::create_dir_all(&working_directory)?;
    let wav = working_directory.join("audio.wav");
    let prepared = tools::convert_to_wav(
        Path::new(&ffmpeg),
        Path::new(&recording.path),
        &wav,
        &JobRunner { task, recording_id },
    );
    let outcome = prepared.and_then(|()| {
        let own = crate::ai_edit::effective_language(&recording);
        let found = sweep(&check, &wav, &own, recording_id, task);
        match &found {
            Some(row) => db::save_second_language(&connection, row)?,
            None => db::clear_second_language(&connection, recording_id)?,
        }
        Ok(found)
    });
    // Whatever happened, the copy of the audio goes. It is the size of the
    // recording and nothing else will come looking for it.
    let _ = std::fs::remove_dir_all(&working_directory);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_recording_still_gets_the_fewest_samples() {
        assert_eq!(sample_count(30.0), FEWEST_SAMPLES);
        assert_eq!(sample_count(0.0), FEWEST_SAMPLES);
    }

    #[test]
    fn a_long_recording_is_capped_rather_than_swept_all_day() {
        assert_eq!(sample_count(47.0 * 60.0), MOST_SAMPLES);
        assert_eq!(sample_count(600.0 * 60.0), MOST_SAMPLES);
    }

    #[test]
    fn about_one_window_a_minute_in_between() {
        assert_eq!(sample_count(9.0 * 60.0), 9);
    }

    /// Every window has to fit inside the recording, or the last one reads
    /// silence and reports whatever silence sounds like.
    #[test]
    fn no_window_runs_off_the_end() {
        for seconds in [11.0, 60.0, 600.0, 2861.0] {
            for point in sample_points(seconds, sample_count(seconds)) {
                assert!(point >= 0.0, "{seconds}s produced a negative point");
                assert!(
                    point + WINDOW_SECONDS <= seconds + 1e-9,
                    "{seconds}s produced a window ending past the recording"
                );
            }
        }
    }

    #[test]
    fn a_recording_shorter_than_one_window_is_listened_to_whole() {
        assert_eq!(sample_points(4.0, 6), vec![0.0]);
    }

    #[test]
    fn the_points_are_spread_rather_than_bunched() {
        let points = sample_points(600.0, 6);
        assert_eq!(points.len(), 6);
        let spread = points.last().unwrap() - points.first().unwrap();
        assert!(
            spread > 400.0,
            "six points over ten minutes covered {spread}s"
        );
    }

    #[test]
    fn whispers_own_report_is_read_back() {
        let said = "whisper_full_with_state: auto-detected language: cs (p = 0.997182)";
        assert_eq!(detected_language(said), Some(("cs".into(), 0.997182)));
    }

    #[test]
    fn a_report_that_never_came_reads_as_nothing() {
        assert_eq!(detected_language("error: model not found"), None);
    }

    /// The recording's own language is not a second language, however often it
    /// turns up.
    #[test]
    fn the_recordings_own_language_is_never_offered() {
        let heard = vec![
            ("cs".into(), 0.99),
            ("cs".into(), 0.98),
            ("cs".into(), 0.97),
        ];
        assert_eq!(strongest_other(&heard, "cs", 3), None);
    }

    /// **One window is noise.** A name, a quoted sentence, a song.
    #[test]
    fn one_window_alone_offers_nothing() {
        let heard = vec![
            ("cs".into(), 0.99),
            ("en".into(), 0.95),
            ("cs".into(), 0.97),
        ];
        assert_eq!(strongest_other(&heard, "cs", 3), None);
    }

    #[test]
    fn two_windows_that_agree_are_a_pattern() {
        let heard = vec![
            ("cs".into(), 0.99),
            ("en".into(), 0.95),
            ("cs".into(), 0.97),
            ("en".into(), 0.91),
        ];
        let (language, share) = strongest_other(&heard, "cs", 4).unwrap();
        assert_eq!(language, "en");
        assert!((share - 0.5).abs() < 1e-9);
    }

    /// A reading this weak is what a single-language recording throws off now
    /// and then, not a second language.
    #[test]
    fn a_reading_at_the_noise_level_does_not_count() {
        let heard = vec![
            ("en".into(), 0.31),
            ("en".into(), 0.38),
            ("cs".into(), 0.99),
        ];
        assert_eq!(strongest_other(&heard, "cs", 3), None);
    }

    /// Two other languages, and the stronger one wins — the offer is one
    /// question with one button.
    #[test]
    fn the_strongest_other_language_is_the_one_offered() {
        let heard = vec![
            ("en".into(), 0.95),
            ("en".into(), 0.93),
            ("en".into(), 0.92),
            ("de".into(), 0.91),
            ("de".into(), 0.90),
        ];
        assert_eq!(strongest_other(&heard, "cs", 5).unwrap().0, "en");
    }

    /// **The case the first attempt got wrong, in the numbers it got it wrong
    /// with.** These are the three English windows the sweep really sampled on
    /// the reference recording. At the floor of 0.60 that shipped first, every
    /// one was discarded, and an interpreted talk missing close to half its
    /// speech offered nothing at all.
    #[test]
    fn the_interpreted_recordings_own_windows_are_counted() {
        let heard = vec![
            ("en".into(), 0.50),
            ("cs".into(), 1.00),
            ("en".into(), 0.57),
            ("cs".into(), 0.99),
            ("en".into(), 0.56),
        ];
        assert_eq!(strongest_other(&heard, "cs", 16).unwrap().0, "en");
    }

    /// The measured control: five confident Czech windows and one stray English
    /// reading. One window is not a pattern and 0.38 is not a confidence, so
    /// this stays silent by both rules at once.
    #[test]
    fn a_single_language_recording_says_nothing() {
        let heard = vec![
            ("cs".into(), 0.9957),
            ("cs".into(), 0.9963),
            ("cs".into(), 0.9964),
            ("cs".into(), 0.9966),
            ("cs".into(), 0.9966),
            ("en".into(), 0.3786),
        ];
        assert_eq!(strongest_other(&heard, "cs", 6), None);
    }

    /// Nothing heard at all is not an offer, and must not be a panic either —
    /// a sweep cancelled on its first window lands here.
    #[test]
    fn hearing_nothing_offers_nothing() {
        assert_eq!(strongest_other(&[], "cs", 0), None);
    }

    /// The header a WAV needs, checked by reading it back with the same reader
    /// the pipeline uses.
    #[test]
    fn a_written_window_reads_back_as_what_went_in() {
        let path = std::env::temp_dir().join(format!("volocal-window-{}.wav", std::process::id()));
        let written: Vec<i16> = (0..1600).map(|n| (n % 3000) as i16 - 1500).collect();
        write_window(&path, &written, 16_000).unwrap();

        let (read, rate) = read_pcm16(&path).unwrap();
        assert_eq!(rate, 16_000);
        assert_eq!(read, written);
        let _ = std::fs::remove_file(&path);
    }
}
