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

/// Writes 16 kHz mono samples as a WAV whisper will read.
///
/// By hand rather than through ffmpeg, and that is the whole reason the sweep
/// is cheap: sixteen windows would otherwise be sixteen more processes, each
/// re-opening and seeking the source. The prepared WAV is already exactly the
/// shape whisper wants, so this only copies a slice of it and puts a header on.
fn write_wav(path: &Path, samples: &[i16], rate: u32) -> std::io::Result<()> {
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
        if piece.is_empty() || write_wav(&window_file, piece, rate).is_err() {
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

// ------------------------------------------------- filling in the other one

/// The shortest silence between two words that is worth looking into.
///
/// **This is the whole trick and it is free.** A block's *span* runs to where
/// whisper stopped listening, which on an interpreted recording reaches over
/// the other speaker entirely — measured on the reference talk, spans cover
/// 46.5 minutes of 47.7, and the transcript therefore looks complete. The
/// *words inside* those blocks cover 29.5 minutes. The eighteen minutes between
/// them are where the other language is, and finding them costs nothing,
/// because the timings are already stored.
///
/// One second, because a breath is shorter than that and a spoken turn is not.
const LEAST_GAP: f64 = 1.0;

/// Silence laid between two pieces of extracted audio.
///
/// Long enough for speech detection to cut there, so two stretches from
/// opposite ends of the recording are never read as one sentence.
const SILENCE_BETWEEN: f64 = 0.6;

/// A word timing is where the word starts; this is how long it may have taken.
/// Without it every gap would open in the middle of the last word.
const LAST_WORD: f64 = 0.6;

/// Where the transcript actually has words, in time order and merged.
///
/// Word timings rather than block spans, which is the entire point — see
/// [`LEAST_GAP`]. A block with no stored timings falls back to its span, which
/// is the honest answer for it: nothing finer is known about that one.
pub(crate) fn spoken_spans(segments: &[Segment]) -> Vec<(f64, f64)> {
    let mut spans: Vec<(f64, f64)> = segments
        .iter()
        .map(|segment| {
            let times: Vec<f64> = segment
                .words
                .as_deref()
                .and_then(|words| serde_json::from_str::<Vec<serde_json::Value>>(words).ok())
                .map(|words| words.iter().filter_map(|word| word["t"].as_f64()).collect())
                .unwrap_or_default();
            let first = times.iter().cloned().fold(f64::INFINITY, f64::min);
            let last = times.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            if first.is_finite() && last.is_finite() {
                (first, last + LAST_WORD)
            } else {
                (segment.start, segment.end)
            }
        })
        .collect();
    spans.sort_by(|left, right| left.0.total_cmp(&right.0));
    let mut merged: Vec<(f64, f64)> = Vec::with_capacity(spans.len());
    for (from, to) in spans {
        match merged.last_mut() {
            Some(last) if from <= last.1 => last.1 = last.1.max(to),
            _ => merged.push((from, to)),
        }
    }
    merged
}

/// The stretches where the transcript heard nothing — which is where the other
/// language can be, and the only place it can be.
pub(crate) fn unheard_stretches(segments: &[Segment], duration: f64) -> Vec<(f64, f64)> {
    let mut gaps = Vec::new();
    let mut previous = 0.0_f64;
    for (from, to) in spoken_spans(segments) {
        if from - previous >= LEAST_GAP {
            gaps.push((previous, from));
        }
        previous = previous.max(to);
    }
    if duration - previous >= LEAST_GAP {
        gaps.push((previous, duration));
    }
    gaps
}

/// Where one piece of the extracted audio came from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Piece {
    /// Its place in the file handed to whisper.
    pub(crate) at: f64,
    pub(crate) until: f64,
    /// The moment in the recording it was cut from.
    pub(crate) from: f64,
}

/// Lays the unheard stretches end to end with silence between, and says where
/// each one landed.
///
/// One file and one run of whisper rather than one run per stretch: three
/// hundred invocations would spend nearly all of their time starting a process
/// and loading a model. The silence is what keeps them separate pieces of
/// speech rather than one long one.
pub(crate) fn lay_out(gaps: &[(f64, f64)], rate: u32) -> (Vec<Piece>, Vec<(usize, usize)>) {
    let mut pieces = Vec::new();
    let mut ranges = Vec::new();
    let mut at = 0.0;
    for (from, to) in gaps {
        let length = to - from;
        if length < LEAST_GAP {
            continue;
        }
        pieces.push(Piece {
            at,
            until: at + length,
            from: *from,
        });
        ranges.push((
            (from * f64::from(rate)) as usize,
            (to * f64::from(rate)) as usize,
        ));
        at += length + SILENCE_BETWEEN;
    }
    (pieces, ranges)
}

/// The moment in the recording that a moment in the extracted audio came from.
pub(crate) fn back_to_the_recording(pieces: &[Piece], at: f64) -> Option<f64> {
    pieces
        .iter()
        .find(|piece| at >= piece.at - 0.05 && at <= piece.until + 0.05)
        .map(|piece| piece.from + (at - piece.at).max(0.0))
}

/// Letters only the first language uses, for the pairs this has been measured
/// on.
///
/// Czech against English is the pair the whole feature was measured against,
/// and diacritics separate them cleanly *in this direction*: a line carrying
/// `ř` or `ě` is not English. A language with no entry here is filtered by
/// length and repetition alone, which is weaker, and that is the honest state
/// of it until somebody measures another pair.
fn letters_of(language: &str) -> &'static str {
    match language {
        "cs" | "sk" => "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ",
        _ => "",
    }
}

/// Below this a line carries nothing worth inserting, and it is where a
/// hallucination hides.
const SHORTEST_LINE: usize = 4;

/// How many times one line may appear before it reads as a loop rather than as
/// speech.
///
/// **Measured.** The fill over the reference recording produced `he had a
/// voice` eleven times, on the one stretch of near-silence in the whole set —
/// whisper over nothing, which is exactly what silence detection and this are
/// for. Twice can be a real repetition; eleven cannot. The guard in
/// `load_segments_from_json` does not catch it, because these are not
/// consecutive.
const MOST_REPEATS: usize = 2;

/// Which of the second pass's lines are worth putting in the transcript.
///
/// Three rules, and each answers something that was observed rather than
/// imagined: a line still written in the first language, because the pass reads
/// back whatever it is given; a line too short to carry anything; and a line
/// repeated far more often than speech repeats.
pub(crate) fn worth_keeping(lines: &[(f64, String)], own: &str) -> Vec<(f64, String)> {
    let letters = letters_of(own);
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (_, text) in lines {
        *seen.entry(text.trim().to_lowercase()).or_default() += 1;
    }
    lines
        .iter()
        .filter(|(_, text)| {
            let trimmed = text.trim();
            trimmed.chars().count() >= SHORTEST_LINE
                && !trimmed.chars().any(|letter| letters.contains(letter))
                && seen
                    .get(&trimmed.to_lowercase())
                    .is_none_or(|n| *n <= MOST_REPEATS)
        })
        .cloned()
        .collect()
}

/// Transcribes the other language and puts it into the transcript.
///
/// **The shape of it, and why each step is the way it is.**
///
/// The stretches where the first pass heard no words are cut out and laid end
/// to end with silence between them, and whisper is run over that once, told
/// the other language and given no carried context. Feeding it only audio the
/// first pass found nothing in is what makes this safe: asked for English over
/// Czech speech, whisper does not fail, it *translates* — measured over the
/// whole reference recording, 376 of 467 English-looking lines from a blind
/// pass sat over Czech audio, including thirteen invented sentences over an
/// introduction where nobody speaks English at all. Here there is nothing to
/// translate, because the words are already written down.
///
/// What comes back is filtered by [`worth_keeping`] and written in one
/// transaction with the offer's new state, so a failure anywhere leaves the
/// transcript exactly as it was.
pub fn fill(
    app: &AppHandle,
    db_path: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
) -> Reported<usize> {
    let connection = db::open(db_path)?;
    let settings = db::load_settings(&connection)?;
    let recording = db::recording(&connection, recording_id)?;
    let offer = db::second_language(&connection, recording_id)?
        .ok_or_else(|| UserMessage::new("second_language.nothing_offered"))?;
    let segments = db::segments(&connection, recording_id)?;
    if segments.is_empty() {
        return Err(UserMessage::new("second_language.no_transcript"));
    }

    let check = tools::check(&settings);
    if let Some(issue) = check.issues.first() {
        return Err(issue.clone());
    }
    let ffmpeg = check
        .ffmpeg
        .clone()
        .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;
    if !Path::new(&recording.path).is_file() {
        return Err(UserMessage::new("playback.source_missing"));
    }

    let working = std::env::temp_dir()
        .join("volocal-languages")
        .join(recording_id);
    std::fs::create_dir_all(&working)?;
    let outcome = fill_from(
        app,
        &connection,
        &check,
        &settings,
        &recording,
        &offer,
        &segments,
        Path::new(&ffmpeg),
        &working,
        recording_id,
        task,
    );
    let _ = std::fs::remove_dir_all(&working);
    outcome
}

/// The work itself, with the working directory already made so that one
/// `remove_dir_all` above cleans up whichever way this ends.
#[allow(clippy::too_many_arguments)]
fn fill_from(
    app: &AppHandle,
    connection: &rusqlite::Connection,
    check: &tools::ToolCheck,
    settings: &db::Settings,
    recording: &db::Recording,
    offer: &db::SecondLanguage,
    segments: &[Segment],
    ffmpeg: &Path,
    working: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
) -> Reported<usize> {
    let say = |percent: u32, code: &str| {
        status(app, recording_id, "second_language", percent, step(code));
    };

    say(5, "second_language.preparing_audio");
    let wav = working.join("audio.wav");
    tools::convert_to_wav(
        ffmpeg,
        Path::new(&recording.path),
        &wav,
        &JobRunner { task, recording_id },
    )?;
    stop_if_cancelled(task, recording_id)?;

    let Some((samples, rate)) = read_pcm16(&wav) else {
        return Err(UserMessage::new("diarization.audio_unreadable"));
    };
    let duration = samples.len() as f64 / f64::from(rate.max(1));
    let gaps = unheard_stretches(segments, duration);
    let (pieces, ranges) = lay_out(&gaps, rate);
    if pieces.is_empty() {
        // Every second of the recording already has words on it. Nothing to
        // look into, and that is an answer rather than a failure.
        db::set_second_language_state(connection, recording_id, db::second_language_state::FILLED)?;
        return Ok(0);
    }

    say(15, "second_language.cutting");
    let silence = vec![0_i16; (SILENCE_BETWEEN * f64::from(rate)) as usize];
    let mut extracted: Vec<i16> = Vec::new();
    for (from, to) in &ranges {
        let piece = &samples[(*from).min(samples.len())..(*to).min(samples.len())];
        extracted.extend_from_slice(piece);
        extracted.extend_from_slice(&silence);
    }
    let cut = working.join("unheard.wav");
    write_wav(&cut, &extracted, rate)?;
    stop_if_cancelled(task, recording_id)?;

    say(25, "second_language.transcribing");
    let prefix = working.join("second");
    let run = Run {
        app,
        recording_id,
        task,
    };
    // The recording's own model and settings, with two things changed: the
    // language asked for, and no carried context. Both are the difference
    // between seeing the other language and not.
    start_whisper(
        &run,
        settings,
        &Ask {
            language: &offer.language,
            max_context: CONTEXT_FOR_A_SECOND_LANGUAGE,
        },
        check,
        &cut,
        &prefix,
    )?;
    stop_if_cancelled(task, recording_id)?;

    say(85, "second_language.merging");
    let found = load_segments_from_json(&prefix.with_extension("json"), recording_id)
        .map_err(|error| UserMessage::new("transcription.no_output_file").detail(error))?;
    let lines: Vec<(f64, String)> = found
        .iter()
        .filter_map(|segment| {
            back_to_the_recording(&pieces, segment.start).map(|at| (at, segment.text.clone()))
        })
        .collect();
    let own = crate::ai_edit::effective_language(recording);
    let kept = worth_keeping(&lines, &own);

    let added = kept.len();
    let mut all: Vec<Segment> = segments.to_vec();
    for (at, text) in kept {
        all.push(Segment {
            id: uuid::Uuid::new_v4().to_string(),
            recording_id: recording_id.to_string(),
            order: 0,
            start: at,
            // The end is not known any better than this: the piece it came from
            // was cut by silence, not by a clock. Long enough to read, short
            // enough not to swallow the answer that follows it.
            end: at + 2.0,
            text,
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            words: None,
            original: None,
            language: Some(offer.language.clone()),
        });
    }
    all.sort_by(|left, right| left.start.total_cmp(&right.start));
    for (position, segment) in all.iter_mut().enumerate() {
        segment.order = position as i64;
    }

    // One transaction. A failure halfway through would otherwise leave a
    // transcript with half its blocks gone, which is worse than never having
    // asked.
    connection.execute_batch("BEGIN")?;
    let written = (|| -> Reported<()> {
        db::delete_segments(connection, recording_id)?;
        for segment in &all {
            db::insert_segment(connection, segment)?;
        }
        db::set_second_language_state(connection, recording_id, db::second_language_state::FILLED)?;
        Ok(())
    })();
    if let Err(error) = written {
        let _ = connection.execute_batch("ROLLBACK");
        return Err(error);
    }
    connection.execute_batch("COMMIT")?;
    say(100, "second_language.done");
    Ok(added)
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

    // ------------------------------------------- finding what the transcript missed

    fn block(start: f64, end: f64, words: &[(f64, &str)]) -> Segment {
        let list: Vec<serde_json::Value> = words
            .iter()
            .map(|(t, w)| serde_json::json!({ "t": t, "s": w }))
            .collect();
        Segment {
            id: "s".into(),
            recording_id: "r".into(),
            order: 0,
            start,
            end,
            text: words.iter().map(|(_, w)| *w).collect::<Vec<_>>().join(" "),
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            words: (!list.is_empty()).then(|| serde_json::to_string(&list).unwrap()),
            original: None,
            language: None,
        }
    }

    /// **The measurement the whole fill rests on.** A block's span runs to where
    /// whisper stopped listening, which on an interpreted recording reaches over
    /// the other speaker entirely. Its words do not. Here the block claims eight
    /// seconds and its words occupy two, so six seconds are unheard — and that is
    /// where the other language is.
    #[test]
    fn a_blocks_span_is_not_where_its_words_are() {
        let blocks = [block(0.0, 8.0, &[(0.0, "Dobrý"), (0.6, "den.")])];
        assert_eq!(spoken_spans(&blocks), vec![(0.0, 1.2)]);
        let gaps = unheard_stretches(&blocks, 8.0);
        assert_eq!(gaps.len(), 1);
        assert!((gaps[0].0 - 1.2).abs() < 1e-9 && (gaps[0].1 - 8.0).abs() < 1e-9);
    }

    /// A block nobody stored timings for says only what its span says. That is
    /// the honest answer for it, and it must not open a gap out of nothing.
    #[test]
    fn a_block_without_word_timings_falls_back_to_its_span() {
        let blocks = [block(2.0, 6.0, &[])];
        assert_eq!(spoken_spans(&blocks), vec![(2.0, 6.0)]);
    }

    /// Breathing is not a turn. Anything under a second is left alone.
    #[test]
    fn a_pause_shorter_than_a_second_is_not_a_gap() {
        let blocks = [
            block(0.0, 1.0, &[(0.0, "Ano.")]),
            block(1.2, 2.0, &[(1.2, "Ne.")]),
        ];
        assert!(unheard_stretches(&blocks, 2.0).is_empty());
    }

    #[test]
    fn silence_before_the_first_word_and_after_the_last_both_count() {
        let blocks = [block(5.0, 6.0, &[(5.0, "Ano.")])];
        let gaps = unheard_stretches(&blocks, 20.0);
        assert_eq!(gaps.len(), 2);
        assert!(
            (gaps[0].1 - 5.0).abs() < 1e-9,
            "the silence before the first word"
        );
        assert!(
            (gaps[1].1 - 20.0).abs() < 1e-9,
            "and the one after the last"
        );
    }

    /// Overlapping blocks are one stretch of speech, not two, or the gap
    /// between them would be negative.
    #[test]
    fn blocks_that_overlap_are_merged() {
        let blocks = [
            block(0.0, 4.0, &[(0.0, "Jedna"), (2.0, "dvě")]),
            block(1.0, 5.0, &[(1.0, "dvě"), (3.0, "tři")]),
        ];
        assert_eq!(spoken_spans(&blocks).len(), 1);
    }

    // ------------------------------------------------- laying the pieces out

    #[test]
    fn a_piece_can_be_found_again_where_it_came_from() {
        let (pieces, ranges) = lay_out(&[(10.0, 14.0), (100.0, 103.0)], 16_000);
        assert_eq!(pieces.len(), 2);
        assert_eq!(ranges[0], (160_000, 224_000));
        // The second piece starts after the first plus the silence between.
        assert!((pieces[1].at - (4.0 + SILENCE_BETWEEN)).abs() < 1e-9);
        // A moment two seconds into the second piece is at 102 s of the recording.
        let at = back_to_the_recording(&pieces, pieces[1].at + 2.0).unwrap();
        assert!((at - 102.0).abs() < 1e-9, "got {at}");
    }

    /// The silence between pieces belongs to neither of them. Whisper writing
    /// something there has nowhere to be put, and must not be guessed onto the
    /// nearest piece.
    #[test]
    fn a_moment_in_the_silence_between_pieces_belongs_nowhere() {
        let (pieces, _) = lay_out(&[(10.0, 14.0), (100.0, 103.0)], 16_000);
        assert_eq!(back_to_the_recording(&pieces, 4.3), None);
    }

    #[test]
    fn a_stretch_too_short_to_hold_a_turn_is_not_cut_out() {
        let (pieces, _) = lay_out(&[(10.0, 10.4)], 16_000);
        assert!(pieces.is_empty());
    }

    // ------------------------------------------------ what is worth inserting

    fn lines(items: &[(f64, &str)]) -> Vec<(f64, String)> {
        items.iter().map(|(t, s)| (*t, (*s).to_string())).collect()
    }

    /// **The measured hallucination.** The fill over the reference recording
    /// wrote `he had a voice` eleven times, over the one stretch of near-silence
    /// in the whole set. Twice can be a real repetition; eleven cannot. The
    /// guard in `load_segments_from_json` does not see it, because these are not
    /// consecutive.
    #[test]
    fn a_line_repeated_far_more_often_than_speech_repeats_is_dropped() {
        let mut items: Vec<(f64, &str)> = Vec::new();
        for turn in 0..11 {
            items.push((turn as f64 * 30.0, "he had a voice"));
        }
        items.push((5.0, "I always go fishing for the type of fish I want."));
        let kept = worth_keeping(&lines(&items), "cs");
        assert_eq!(kept.len(), 1);
        assert!(kept[0].1.starts_with("I always go fishing"));
    }

    /// Twice is speech. A speaker really does repeat a line for effect.
    #[test]
    fn a_line_said_twice_is_kept() {
        let kept = worth_keeping(
            &lines(&[(1.0, "Don't worry."), (40.0, "Don't worry.")]),
            "cs",
        );
        assert_eq!(kept.len(), 2);
    }

    /// The pass reads back whatever it is given, so the first language turns up
    /// in its output at the edges of a gap. It is already in the transcript,
    /// and better.
    #[test]
    fn a_line_still_in_the_first_language_is_dropped() {
        let kept = worth_keeping(
            &lines(&[(1.0, "Já jsem rybář."), (2.0, "I am a fisherman.")]),
            "cs",
        );
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].1, "I am a fisherman.");
    }

    /// Where the pair has never been measured, the letters say nothing and only
    /// the general rules apply. Weaker, and deliberately not pretended
    /// otherwise.
    #[test]
    fn a_language_nobody_measured_is_filtered_by_the_general_rules_alone() {
        let kept = worth_keeping(&lines(&[(1.0, "Ich bin ein Fischer.")]), "fr");
        assert_eq!(kept.len(), 1);
    }

    /// Short lines are where hallucination hides, and they carry nothing worth
    /// inserting anyway.
    #[test]
    fn a_line_too_short_to_carry_anything_is_dropped() {
        let kept = worth_keeping(&lines(&[(1.0, "Ok"), (2.0, "Hm"), (3.0, "Amen.")]), "cs");
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].1, "Amen.");
    }

    /// The header a WAV needs, checked by reading it back with the same reader
    /// the pipeline uses.
    #[test]
    fn a_written_wav_reads_back_as_what_went_in() {
        let path = std::env::temp_dir().join(format!("volocal-window-{}.wav", std::process::id()));
        let written: Vec<i16> = (0..1600).map(|n| (n % 3000) as i16 - 1500).collect();
        write_wav(&path, &written, 16_000).unwrap();

        let (read, rate) = read_pcm16(&path).unwrap();
        assert_eq!(rate, 16_000);
        assert_eq!(read, written);
        let _ = std::fs::remove_file(&path);
    }
}
