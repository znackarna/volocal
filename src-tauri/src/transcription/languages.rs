//! A language the transcript is missing: noticing it, and writing it in.
//!
//! **Why this exists.** whisper is given one language for the whole file, so a
//! recording where two people speak two languages comes back as one of them
//! with the other silently absent — measured on a 47-minute interpreted talk,
//! one caption out of 494 was the second language and close to half the speech
//! was missing. The transcript looked complete, which is worse than a visible
//! failure. `docs/history/2026-09-01.md` carries every measurement.
//!
//! **Two ways in, one way through.** The reader can name the other language on
//! the recording, in which case the fill runs at the end of the transcription
//! without a question; or, when detection is switched on in Settings, a sweep
//! listens for one and the transcript screen offers to fill it in. Both end in
//! [`fill_with_audio`], which is the only part that does real work.
//!
//! **The one idea everything rests on.** A block's *span* runs to where whisper
//! stopped listening, which on an interpreted recording reaches over the other
//! speaker entirely; the *words inside* it do not. The stretches between words
//! are the only place another language can be — so they are where the sweep
//! listens, and they are what the fill transcribes. Handing whisper only audio
//! the first pass found no words in is also what keeps it from translating:
//! asked for English over Czech speech it does not fail, it translates, and a
//! blind pass over the whole file produced 376 such lines.

use super::*;

// ------------------------------------------------------------- the stretches

/// The shortest silence between two words that is worth looking into.
///
/// One second, because a breath is shorter than that and a spoken turn is not.
/// Measured on the reference talk: block spans cover 46.5 minutes of 47.7 and
/// the words inside them 29.5, so eighteen minutes sit between words — and
/// that is where the other language was.
const LEAST_GAP: f64 = 1.0;

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

// ------------------------------------------------------------------ the sweep

/// How much of one stretch the detection is handed, at most.
///
/// Ten seconds is what every measurement used. Longer collects both languages
/// into one window and the detection then reports whichever is louder.
const WINDOW_SECONDS: f64 = 10.0;

/// The shortest stretch worth asking about.
///
/// Under three seconds there is not enough voice to tell a language from, and
/// a stretch that short is as likely a pause as a turn.
const LEAST_LISTEN: f64 = 3.0;

/// How many stretches one sweep listens to, at most.
///
/// Measured: one detection costs about 1.1 seconds including loading the model,
/// so twelve is under fifteen seconds. Longest first, because a long stretch is
/// the one most likely to hold a whole turn of the other language.
const MOST_SAMPLES: usize = 12;

/// Below this the detection is not confident enough to count as anything.
///
/// Measured from both sides. Across 287 windows of the interpreted recording the
/// English confidences run from 0.38, tenth percentile 0.51, median 0.65 — and
/// not one window came back a language that was neither of the two. On a
/// single-language control the five real windows scored 0.996 and the one stray
/// reading was English at 0.38. The gap to sit in is 0.38 to 0.51; 0.45 is above
/// everything observed to be noise and below nine tenths of what was observed to
/// be a real second language. Anything from 0.40 to 0.50 gives the same answer,
/// so the rule does not balance on this number.
///
/// It was 0.60 first, and 0.60 found nothing: consecutive interpretation puts
/// both languages inside almost every window, so the detector is never confident
/// about the quieter one. A low score for a second language is expected, and is
/// not the same as its absence.
const CONFIDENT: f64 = 0.45;

/// How many stretches must agree before the reader is told anything.
///
/// Two, not a fraction. One reading is noise — a name, a quoted sentence, a
/// song. Two stretches apart in the recording are a pattern. A share was the
/// first idea and it was worse: it turns on how many samples were taken.
const LEAST_AGREEING: usize = 2;

/// Where a sweep listens: the longest stretches between words, each cut to at
/// most one window.
///
/// **Not evenly across the recording, and the difference is the whole
/// feature.** Sixteen points spread by the clock were tried first, and on the
/// reference talk they landed on English once — the other language comes in
/// two-to-four-second turns, and a net with ten-second holes spaced three
/// minutes apart catches it by luck. The stretches between words are where it
/// has to be, so listening there turns a coin flip into a question with an
/// answer.
pub(crate) fn listening_places(segments: &[Segment], duration: f64) -> Vec<(f64, f64)> {
    let mut places: Vec<(f64, f64)> = unheard_stretches(segments, duration)
        .into_iter()
        .filter(|(from, to)| to - from >= LEAST_LISTEN)
        .collect();
    places.sort_by(|left, right| (right.1 - right.0).total_cmp(&(left.1 - left.0)));
    places.truncate(MOST_SAMPLES);
    // In time order again, so a log of what was heard reads like the recording.
    places.sort_by(|left, right| left.0.total_cmp(&right.0));
    places
        .into_iter()
        .map(|(from, to)| {
            // The middle of a long stretch rather than its start: the edges
            // are where the other speaker's last syllable bleeds in.
            let length = (to - from).min(WINDOW_SECONDS);
            let start = from + ((to - from) - length) / 2.0;
            (start, start + length)
        })
        .collect()
}

/// Writes 16 kHz mono samples as a WAV whisper will read.
///
/// By hand rather than through ffmpeg: a sweep would otherwise be a dozen more
/// processes, each re-opening and seeking the source. The prepared WAV is
/// already the shape whisper wants, so this only copies a slice and puts a
/// header on it.
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

/// Which language the sweep should report, given what the stretches said.
///
/// Separated from the running of it so the rule can be tested without a model:
/// the strongest language that is not the recording's own, and only when at
/// least [`LEAST_AGREEING`] stretches say so.
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

/// Listens in the stretches between words and says whether a second language
/// is in them.
///
/// `own` is the language the transcript was written in — whisper's own answer
/// for the whole file rather than the setting, since a run left on automatic
/// only learns it from the output.
///
/// Failure is not an error. A sweep that cannot run leaves the recording exactly
/// as a recording in one language: nothing is offered, and a finished transcript
/// is never held up over it. It does say why in the log, because a sweep that
/// found nothing and one that could not look are different facts.
pub(crate) fn sweep(
    check: &tools::ToolCheck,
    wav: &Path,
    own: &str,
    segments: &[Segment],
    recording_id: &str,
    task: &TranscriptionTask,
) -> Option<db::SecondLanguage> {
    let program = Path::new(check.whisper_cli.as_ref()?);
    let model = check.model_whisper.as_ref()?;
    let Some((samples, rate)) = read_pcm16(wav) else {
        crate::note!("second language: the prepared audio could not be read");
        return None;
    };
    if rate == 0 || samples.is_empty() {
        return None;
    }
    let seconds = samples.len() as f64 / f64::from(rate);
    let places = listening_places(segments, seconds);
    if places.len() < LEAST_AGREEING {
        crate::note!(
            "second language: {} stretches worth listening to, nothing to find",
            places.len()
        );
        return None;
    }

    let folder = std::env::temp_dir().join(format!("volocal-languages-{}", std::process::id()));
    std::fs::create_dir_all(&folder).ok()?;
    let window_file = folder.join(format!("{}.wav", uuid::Uuid::new_v4()));

    let mut heard: Vec<(String, f64)> = Vec::with_capacity(places.len());
    for (from, to) in &places {
        // Cancelling a transcription must not be held up by the sweep. It is
        // checked between stretches because one cannot be interrupted.
        if task.was_cancelled(recording_id) {
            break;
        }
        let first = (from * f64::from(rate)) as usize;
        let last = ((to * f64::from(rate)) as usize).min(samples.len());
        if last <= first {
            continue;
        }
        if write_wav(&window_file, &samples[first..last], rate).is_err() {
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

    let described: Vec<String> = heard
        .iter()
        .map(|(code, p)| format!("{code}:{p:.2}"))
        .collect();
    crate::note!(
        "second language: heard [{}] against {own}",
        described.join(" ")
    );

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

/// Silence laid between two pieces of extracted audio.
///
/// Long enough for speech detection to cut there, so two stretches from
/// opposite ends of the recording are never read as one sentence.
const SILENCE_BETWEEN: f64 = 0.6;

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

/// Words that only the first language uses, for lines its letters do not
/// give away.
///
/// The letters catch most of it, but not a Czech line that happens to carry no
/// diacritics: the fill on the reference recording let through `Jsem
/// odcestoval.`, `Jsi jedl.` and `A jejich hlubb.` — the interpreter's own
/// sentence, mis-heard by the pass at the edge of a gap and standing in the
/// transcript beside the correct one. Function words are the tell: a line
/// where a third of the words are `jsem`, `že`, `už`, `jejich` is Czech.
///
/// **Only words that are not also English words.** The first draft of this
/// list had `my`, `to`, `a` and `on` in it and would have thrown away `My
/// grandkids come to my house.` Measured over the fill's 282 lines: this list
/// drops the three Czech ones and no English one.
fn function_words_of(language: &str) -> &'static [&'static str] {
    match language {
        "cs" => &[
            "jsem", "jsi", "jsme", "jste", "jsou", "byl", "byla", "bylo", "byli", "je", "že", "se",
            "si", "už", "tak", "jak", "co", "kdo", "ne", "ano", "tady", "teď", "ještě", "taky",
            "také", "jen", "jenom", "když", "aby", "jestli", "nebo", "ani", "který", "která",
            "které", "tento", "tato", "toto", "můj", "moje", "tvůj", "jeho", "její", "náš", "váš",
            "jejich", "prostě", "vlastně", "tam", "nic", "něco", "někdo", "nikdo", "všechno",
            "pro", "při", "bez", "od", "po", "za", "před", "nad", "pod", "mezi", "ale", "kde",
            "kam", "proč", "dobře", "moc", "protože", "jako", "tohle", "tohleto", "ta",
        ],
        _ => &[],
    }
}

/// Is at least a third of this line made of the first language's function
/// words? Inclusive, so a three-word line with one of them counts.
fn reads_as(language: &str, text: &str) -> bool {
    let function_words = function_words_of(language);
    if function_words.is_empty() {
        return false;
    }
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect();
    let hits = words
        .iter()
        .filter(|w| function_words.contains(&w.as_str()))
        .count();
    hits > 0 && hits * 3 >= words.len()
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
/// imagined: a line still written in the first language — by its letters, or
/// by its function words where the letters give nothing away — because the
/// pass reads back whatever it is given; a line too short to carry anything;
/// and a line repeated far more often than speech repeats.
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
                && !reads_as(own, trimmed)
                && seen
                    .get(&trimmed.to_lowercase())
                    .is_none_or(|n| *n <= MOST_REPEATS)
        })
        .cloned()
        .collect()
}

/// Transcribes the other language from audio that is already prepared, and
/// puts it into the transcript.
///
/// The stretches where the first pass heard no words are cut out and laid end
/// to end with silence between them, and whisper is run over that once, told
/// the other language and given no carried context. What comes back is
/// filtered by [`worth_keeping`] and written in one transaction with the
/// offer's new state, so a failure anywhere leaves the transcript exactly as it
/// was.
///
/// Called from two places: the end of a transcription, where the WAV is still
/// there, and [`fill`], which has to make one first.
#[allow(clippy::too_many_arguments)]
pub(crate) fn fill_with_audio(
    app: &AppHandle,
    connection: &rusqlite::Connection,
    check: &tools::ToolCheck,
    settings: &db::Settings,
    recording: &db::Recording,
    language: &str,
    wav: &Path,
    working: &Path,
    task: &TranscriptionTask,
) -> Reported<usize> {
    let recording_id = recording.id.as_str();
    let say = |percent: u32, code: &str| {
        status(app, recording_id, "second_language", percent, step(code));
    };
    let segments = db::segments(connection, recording_id)?;
    if segments.is_empty() {
        return Err(UserMessage::new("second_language.no_transcript"));
    }

    say(5, "second_language.cutting");
    let Some((samples, rate)) = read_pcm16(wav) else {
        return Err(UserMessage::new("diarization.audio_unreadable"));
    };
    let duration = samples.len() as f64 / f64::from(rate.max(1));
    let gaps = unheard_stretches(&segments, duration);
    let (pieces, ranges) = lay_out(&gaps, rate);
    if pieces.is_empty() {
        // Every second of the recording already has words on it. Nothing to
        // look into, and that is an answer rather than a failure.
        db::set_second_language_state(connection, recording_id, db::second_language_state::FILLED)?;
        say(100, "second_language.done");
        return Ok(0);
    }

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

    say(15, "second_language.transcribing");
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
            language,
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
    let mut all: Vec<Segment> = segments.clone();
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
            language: Some(language.to_string()),
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

/// Transcribes the other language into a transcript that is already stored,
/// making the audio first.
///
/// What it fills is whatever the recording's row says: the language the reader
/// named, or the one a sweep found and the reader accepted.
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
    status(
        app,
        recording_id,
        "second_language",
        2,
        step("second_language.preparing_audio"),
    );
    let wav = working.join("audio.wav");
    let outcome = tools::convert_to_wav(
        Path::new(&ffmpeg),
        Path::new(&recording.path),
        &wav,
        &JobRunner { task, recording_id },
    )
    .and_then(|()| stop_if_cancelled(task, recording_id))
    .and_then(|()| {
        fill_with_audio(
            app,
            &connection,
            &check,
            &settings,
            &recording,
            &offer.language,
            &wav,
            &working,
            task,
        )
    });
    // Whatever happened, the copy of the audio goes. It is the size of the
    // recording and nothing else will come looking for it.
    let _ = std::fs::remove_dir_all(&working);
    outcome
}

/// Sweeps a transcript that is already in the archive.
///
/// The difference from the sweep inside a run is the audio: there is no
/// prepared WAV any more, so one is made and thrown away again. That is the
/// whole cost, and it is why this is asked for rather than done to every
/// recording on sight — and why an archive that predates the sweep can still
/// be asked.
pub fn sweep_existing(
    db_path: &Path,
    recording_id: &str,
    task: &TranscriptionTask,
) -> Reported<Option<db::SecondLanguage>> {
    let connection = db::open(db_path)?;
    let settings = db::load_settings(&connection)?;
    let recording = db::recording(&connection, recording_id)?;
    let segments = db::segments(&connection, recording_id)?;
    if segments.is_empty() {
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
        let found = sweep(&check, &wav, &own, &segments, recording_id, task);
        match &found {
            Some(row) => db::save_second_language(&connection, row)?,
            None => db::clear_second_language(&connection, recording_id)?,
        }
        Ok(found)
    });
    let _ = std::fs::remove_dir_all(&working_directory);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

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

    // ------------------------------------------- finding what the transcript missed

    /// **The measurement the whole feature rests on.** A block's span runs to
    /// where whisper stopped listening, which on an interpreted recording
    /// reaches over the other speaker entirely. Its words do not. Here the block
    /// claims eight seconds and its words occupy two, so six seconds are
    /// unheard — and that is where the other language is.
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

    // ---------------------------------------------------- where a sweep listens

    /// **The defect the first sweep had.** Sixteen points spread by the clock
    /// landed on the other language once. The stretches between words are where
    /// it has to be, so that is where the sweep listens — and a recording whose
    /// words cover everything gives it nowhere to listen at all.
    #[test]
    fn a_sweep_listens_between_the_words_and_nowhere_else() {
        // Words at 0..2, then nothing until 20, words 20..22, nothing to 60.
        let blocks = [
            block(0.0, 10.0, &[(0.0, "Dobrý"), (1.4, "den.")]),
            block(20.0, 40.0, &[(20.0, "Tak"), (21.4, "dál.")]),
        ];
        let places = listening_places(&blocks, 60.0);
        assert_eq!(places.len(), 2);
        // Each place sits inside a gap, never over a word.
        for (from, to) in &places {
            assert!(*from >= 2.0 && *to <= 60.0);
            assert!(
                !(*from < 22.0 && *to > 20.0),
                "listening over a word at {from}..{to}"
            );
            assert!(to - from <= WINDOW_SECONDS + 1e-9);
        }

        let covered = [block(0.0, 10.0, &[(0.0, "a"), (9.5, "b")])];
        assert!(listening_places(&covered, 10.0).is_empty());
    }

    /// A pause is not a place to listen. Under three seconds there is not enough
    /// voice to tell a language from.
    #[test]
    fn a_short_gap_is_not_listened_to() {
        let blocks = [
            block(0.0, 1.0, &[(0.0, "Ano.")]),
            block(3.0, 4.0, &[(3.0, "Ne.")]),
        ];
        assert!(listening_places(&blocks, 4.0).is_empty());
    }

    /// Longest first, and never more than the cap: a long interpreted talk has
    /// three hundred gaps, and a dozen of the longest is where the answer is.
    #[test]
    fn the_longest_gaps_are_chosen_and_capped() {
        let mut blocks = Vec::new();
        for turn in 0..40 {
            let at = turn as f64 * 30.0;
            blocks.push(block(at, at + 1.0, &[(at, "Ano.")]));
        }
        let places = listening_places(&blocks, 40.0 * 30.0);
        assert_eq!(places.len(), MOST_SAMPLES);
        for (from, to) in &places {
            assert!((to - from - WINDOW_SECONDS).abs() < 1e-9);
        }
    }

    // ------------------------------------------------- laying the pieces out

    #[test]
    fn a_piece_can_be_found_again_where_it_came_from() {
        let (pieces, ranges) = lay_out(&[(10.0, 14.0), (100.0, 103.0)], 16_000);
        assert_eq!(pieces.len(), 2);
        assert_eq!(ranges[0], (160_000, 224_000));
        assert!((pieces[1].at - (4.0 + SILENCE_BETWEEN)).abs() < 1e-9);
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

    // ------------------------------------------------ what the detection says

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

    /// **One reading is noise.** A name, a quoted sentence, a song.
    #[test]
    fn one_reading_alone_offers_nothing() {
        let heard = vec![
            ("cs".into(), 0.99),
            ("en".into(), 0.95),
            ("cs".into(), 0.97),
        ];
        assert_eq!(strongest_other(&heard, "cs", 3), None);
    }

    #[test]
    fn two_readings_that_agree_are_a_pattern() {
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

    /// **The numbers the first attempt got wrong.** The three English readings
    /// the very first sweep sampled on the reference recording, at 0.50, 0.57
    /// and 0.56 — all discarded by a floor of 0.60, so an interpreted talk
    /// missing half its speech offered nothing.
    #[test]
    fn the_interpreted_recordings_own_readings_are_counted() {
        let heard = vec![
            ("en".into(), 0.50),
            ("cs".into(), 1.00),
            ("en".into(), 0.57),
            ("cs".into(), 0.99),
            ("en".into(), 0.56),
        ];
        assert_eq!(strongest_other(&heard, "cs", 16).unwrap().0, "en");
    }

    /// The measured control: five confident Czech readings and one stray
    /// English one at 0.38. Silent by both rules at once.
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

    /// Nothing heard at all is not an offer, and must not be a panic either —
    /// a sweep cancelled on its first stretch lands here.
    #[test]
    fn hearing_nothing_offers_nothing() {
        assert_eq!(strongest_other(&[], "cs", 0), None);
    }

    // ------------------------------------------------ what is worth inserting

    fn lines(items: &[(f64, &str)]) -> Vec<(f64, String)> {
        items.iter().map(|(t, s)| (*t, (*s).to_string())).collect()
    }

    /// **The measured hallucination.** `he had a voice` eleven times over the
    /// one stretch of near-silence in the set. Twice can be a real repetition;
    /// eleven cannot.
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

    /// **The leak the letters cannot see.** `Jsem odcestoval.` carries no
    /// diacritics and stood in the reference transcript beside the correct
    /// Czech line. Its function words give it away.
    #[test]
    fn a_czech_line_without_diacritics_is_still_dropped() {
        let kept = worth_keeping(
            &lines(&[
                (1.0, "Jsem odcestoval."),
                (2.0, "Jsi jedl."),
                (3.0, "A jejich hlubb."),
                (4.0, "She didn't even notice I was gone."),
            ]),
            "cs",
        );
        assert_eq!(kept.len(), 1);
        assert!(kept[0].1.starts_with("She didn't"));
    }

    /// **What the first draft of that list got wrong.** `my`, `to`, `a` and
    /// `on` are Czech function words and English words both, and a list that
    /// held them threw away real English. Only the unambiguous ones are used.
    #[test]
    fn english_full_of_short_words_is_kept() {
        let kept = worth_keeping(
            &lines(&[
                (1.0, "My grandkids come to my house."),
                (2.0, "I have a rule, a guideline."),
                (3.0, "And I have a rule."),
                (4.0, "don't tell me what to do."),
            ]),
            "cs",
        );
        assert_eq!(kept.len(), 4);
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
