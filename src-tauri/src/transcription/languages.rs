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
//! **The one idea everything rests on.** whisper is asked one language for the
//! whole of whatever it is given, so it is given one turn at a time. The
//! recording is cut into pieces of speech at its own silences, each piece cut
//! down until it is short enough to hold one language, and whisper says which
//! language every piece is in — hundreds of pieces to one run, which loads the
//! model once. The pieces are joined back into turns, and every turn is
//! transcribed in its own language. Nothing is translated, because whisper is
//! never handed audio in a language it was not asked for; nothing is chopped,
//! because the boundaries come from the sound rather than from the first
//! transcript's word timings, which on an interpreted recording are spread over
//! the other speaker. The sweep that *notices* the other language still
//! listens between the first transcript's words, where it was measured to work.
//!
//! The design before this one filled the gaps between the first pass's words.
//! `docs/history/2026-09-02.md` says what was wrong with it, with the numbers.

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

// ---------------------------------------------- the multilingual pass

/// One frame of the loudness curve, in seconds.
const FRAME: f64 = 0.02;

/// How far above the recording's own quiet a frame has to be to count as
/// speech. The quiet is the fifth percentile of every frame, so a hum, a fan
/// or a hall's ambience sets the floor rather than defeating it.
const ABOVE_QUIET_DB: f64 = 12.0;

/// A recording whose loud and quiet are within this many decibels has no
/// speech to tell from its quiet — silence, a hum, or music at one level —
/// and nothing is cut from it. Speech against a room is forty decibels or
/// more apart; a microphone's own noise varies by one or two.
const LEAST_RANGE_DB: f64 = 6.0;

/// The quiet that ends one piece of speech.
///
/// **Measured on the reference recording, and it is the number the whole pass
/// turns on.** Between the guest's last word and the interpreter's first there
/// are 100 to 200 milliseconds: the exchange at 02:03 — *We are the same age*,
/// *Je nám stejně let*, *We have three children* — has dips of 0.12, 0.10,
/// 0.20 and 0.18 seconds. Cut at 300 milliseconds, the whole exchange came
/// back as one fifteen-second piece, and the detection called it Czech.
const PAUSE: f64 = 0.15;

/// A piece shorter than this is a syllable or a click. It goes with the piece
/// before it when there is one close by, and nowhere otherwise.
const LEAST_PIECE: f64 = 0.5;

/// No piece is longer than this when the detection listens to it.
///
/// **Measured, and it is what made the pass work.** A pause is not the only
/// place two languages meet: the interpreter often starts before the room has
/// gone quiet at all. So every piece is cut down at its quietest frame until it
/// is under this, and the language is read from each part. Pieces of up to 25
/// seconds gave 108 English blocks on the reference recording; pieces of 3.5
/// gave 409, and eleven of fourteen sentences known to be missing came back.
const LONGEST_PIECE: f64 = 3.5;

/// A cut is never closer than this to a piece's end: a part shorter than a
/// second is too little to tell a language from.
const CUT_EDGE: f64 = 1.0;

/// What is kept either side of a piece, so the first consonant is not lost.
const PAD: f64 = 0.12;

/// Two pieces in one language closer than this are one turn.
const JOIN_GAP: f64 = 1.0;

/// A turn is never longer than whisper's window, so it is heard whole.
const LONGEST_TURN: f64 = 28.0;

/// How many turns of one voice are asked about before the voice is credited
/// with a language.
///
/// Three of the longest, which on the reference recording is a dozen seconds
/// of one person rather than the two the old per-piece question had. The rest
/// of that voice's turns cost nothing.
const ASK_PER_VOICE: usize = 3;

/// How many files one run of whisper is given at most. Four hundred short
/// names are a fraction of what a Windows command line holds; four hundred
/// full paths would not be.
const MOST_FILES_AT_ONCE: usize = 400;

/// The loudness of each frame in decibels.
fn loudness(samples: &[i16], rate: u32) -> Vec<f64> {
    let hop = ((f64::from(rate) * FRAME) as usize).max(1);
    samples
        .chunks_exact(hop)
        .map(|frame| {
            let energy = frame
                .iter()
                .map(|s| f64::from(*s) * f64::from(*s))
                .sum::<f64>()
                / hop as f64;
            10.0 * (energy + 1e-9).log10()
        })
        .collect()
}

/// Where speech is, as pieces no longer than [`LONGEST_PIECE`], in seconds
/// from the start of the recording.
///
/// By loudness rather than by the first transcript's word timings, which is
/// the difference from the design this replaced: on an interpreted recording a
/// block's words are spread by the alignment over the other speaker's audio,
/// so the gaps between them chopped the other language at every word and
/// swallowed it under every block. The sound knows where the turns are; the
/// first transcript does not.
pub(crate) fn pieces_of_speech(samples: &[i16], rate: u32) -> Vec<(f64, f64)> {
    cut_speech(samples, rate, Some(LONGEST_PIECE))
}

/// The stretches of speech, whole: where somebody is talking, with nothing said
/// about where one of them stops and the next begins.
///
/// What the pass runs on now. The cutting down [`pieces_of_speech`] does was
/// how the language of a stretch was decided when whisper was asked about every
/// piece; the voice decides it now, and cutting by loudness only put boundaries
/// where there are none — see `turns_by_voice`.
pub(crate) fn speech_regions(samples: &[i16], rate: u32) -> Vec<(f64, f64)> {
    cut_speech(samples, rate, None)
}

fn cut_speech(samples: &[i16], rate: u32, longest: Option<f64>) -> Vec<(f64, f64)> {
    let db = loudness(samples, rate);
    if db.is_empty() {
        return Vec::new();
    }
    let mut sorted = db.clone();
    sorted.sort_by(f64::total_cmp);
    let quiet = sorted[sorted.len() / 20];
    let loud = sorted[sorted.len() * 19 / 20];
    if loud - quiet < LEAST_RANGE_DB {
        return Vec::new();
    }
    // Twelve above the quiet, or halfway up on a recording that is close to
    // its own floor throughout.
    let threshold = quiet + ABOVE_QUIET_DB.min((loud - quiet) / 2.0);

    let frames = |seconds: f64| (seconds / FRAME).round() as usize;
    let pause = frames(PAUSE).max(1);
    let least = frames(LEAST_PIECE);
    let join = frames(JOIN_GAP);

    // Stretches of speech. A pause shorter than PAUSE does not end one.
    let mut pieces: Vec<(usize, usize)> = Vec::new();
    let mut at = 0;
    while at < db.len() {
        if db[at] <= threshold {
            at += 1;
            continue;
        }
        let mut last_loud = at;
        let mut quiet_run = 0;
        let mut cursor = at;
        while cursor < db.len() {
            if db[cursor] > threshold {
                last_loud = cursor;
                quiet_run = 0;
            } else {
                quiet_run += 1;
                if quiet_run >= pause {
                    break;
                }
            }
            cursor += 1;
        }
        let end = last_loud + 1;
        if end - at >= least {
            pieces.push((at, end));
        } else if let Some(previous) = pieces.last_mut() {
            // A syllable on its own goes with the speech just before it.
            if at - previous.1 <= join {
                previous.1 = end;
            }
        }
        at = cursor;
    }

    // Long pieces cut down at their quietest frame, never within CUT_EDGE of
    // an end, until every part is short enough to hold one language. Only when
    // a length was asked for: the voice cuts better wherever it can be heard.
    let edge = frames(CUT_EDGE);
    let mut out: Vec<(usize, usize)> = Vec::with_capacity(pieces.len());
    let mut work: Vec<(usize, usize)> = pieces.into_iter().rev().collect();
    while let Some((from, to)) = work.pop() {
        let Some(longest) = longest.map(frames) else {
            out.push((from, to));
            continue;
        };
        if to - from <= longest || to - from < 2 * edge + 1 {
            out.push((from, to));
            continue;
        }
        let cut = (from + edge..to - edge)
            .min_by(|a, b| db[*a].total_cmp(&db[*b]))
            .unwrap_or(from + edge);
        work.push((cut, to));
        work.push((from, cut));
    }

    let seconds = samples.len() as f64 / f64::from(rate);
    out.into_iter()
        .map(|(from, to)| {
            (
                (from as f64 * FRAME - PAD).max(0.0),
                (to as f64 * FRAME + PAD).min(seconds),
            )
        })
        .collect()
}

/// Turns of one voice, cut where the voice changes rather than where the room
/// goes quiet.
///
/// **Why this is the first step and not the last.** Between the guest's last
/// word and the interpreter's first there are a hundred milliseconds, sometimes
/// none at all, so a cut made at the quietest moment of a long stretch lands
/// wherever it likes — measured on the reference recording, the piece from
/// 126.56 to 129.04 holds *We have three children* **and** *Máme tři děti*,
/// took one language, and the English in it was lost. Loudness says where
/// somebody is talking. It does not say who.
///
/// A turn with no voice — too short to describe, or no model on the disk — has
/// `None` for it, and the caller asks whisper about that one instead.
pub(crate) fn turns_by_voice(
    check: &tools::ToolCheck,
    samples: &[i16],
    rate: u32,
    regions: &[(f64, f64)],
    task: &TranscriptionTask,
    recording_id: &str,
    progress: impl FnMut(usize),
) -> Reported<Vec<(f64, f64, Option<usize>)>> {
    let steps = listening_walk(regions);
    if steps.is_empty() {
        return Ok(regions.iter().map(|(a, b)| (*a, *b, None)).collect());
    }
    let half = crate::voiceprint::WINDOW / 2.0;
    let spans: Vec<(f64, f64)> = steps.iter().map(|(_, at)| (at - half, at + half)).collect();
    let prints = voiceprints_of(check, samples, rate, &spans, task, recording_id, progress)?;
    if prints.iter().all(Option::is_none) {
        // No model on the disk, or it would not open. Nothing can be heard
        // about the voices, so the stretches are cut by loudness as they were
        // before any of this — short enough that whisper can be asked about
        // each one and get a single language.
        crate::note!("second language: no voice to go on, cutting by loudness instead");
        return Ok(pieces_of_speech(samples, rate)
            .into_iter()
            .map(|(from, to)| (from, to, None))
            .collect());
    }

    // Each stretch cut at its own handovers.
    let mut turns: Vec<(f64, f64)> = Vec::new();
    for (index, (from, to)) in regions.iter().enumerate() {
        let mine: Vec<usize> = steps
            .iter()
            .enumerate()
            .filter(|(_, (owner, _))| *owner == index)
            .map(|(at, _)| at)
            .collect();
        let times: Vec<f64> = mine.iter().map(|at| steps[*at].1).collect();
        let heard: Vec<Option<Vec<f32>>> = mine.iter().map(|at| prints[*at].clone()).collect();
        let mut edges = vec![*from];
        edges.extend(handovers(&times, &heard));
        edges.push(*to);
        for pair in edges.windows(2) {
            if pair[1] - pair[0] > 1e-9 {
                turns.push((pair[0], pair[1]));
            }
        }
    }

    // Whose each turn is: the middle of the windows that sit inside it, which
    // is what keeps a window straddling a handover out of both answers.
    let mut voices: Vec<Option<Vec<f32>>> = Vec::with_capacity(turns.len());
    for (from, to) in &turns {
        let inside: Vec<&[f32]> = steps
            .iter()
            .zip(&prints)
            .filter(|((_, at), _)| *at >= *from && *at <= *to)
            .filter_map(|(_, print)| print.as_deref())
            .collect();
        voices.push(if inside.is_empty() {
            None
        } else {
            middle_of(&inside)
        });
    }
    let known: Vec<Vec<f32>> = voices.iter().flatten().cloned().collect();
    if known.is_empty() {
        return Ok(turns.into_iter().map(|(a, b)| (a, b, None)).collect());
    }
    let labels = crate::voiceprint::group(&known, None);
    let mut next = 0;
    Ok(turns
        .into_iter()
        .zip(voices)
        .map(|((from, to), voice)| {
            let label = voice.map(|_| {
                let label = labels[next];
                next += 1;
                label
            });
            (from, to, label)
        })
        .collect())
}

/// Who speaks in a recording, and what whisper said about a few of their turns.
///
/// The step both ways in share: the pass that writes a bilingual transcript,
/// and the question asked before an ordinary transcription of whether there is
/// a second language at all. Both need the voices and a handful of answers;
/// only what they conclude differs.
pub(crate) struct Heard {
    /// Every turn: where it runs and whose voice it is.
    pub(crate) turns: Vec<(f64, f64, Option<usize>)>,
    /// Which turns whisper was asked about, and what it said about each.
    pub(crate) asked: Vec<usize>,
    pub(crate) readings: Vec<Option<(String, f64)>>,
    /// Which turns belong to each voice.
    pub(crate) per_voice: HashMap<usize, Vec<usize>>,
}

impl Heard {
    /// The language of each turn that was asked about and answered
    /// confidently. `only`, when given, is the languages worth hearing — the
    /// fill knows which two those are and everything else is a mishearing.
    pub(crate) fn said(&self, only: Option<&[&str]>) -> HashMap<usize, String> {
        let mut said = HashMap::new();
        for (turn, reading) in self.asked.iter().zip(&self.readings) {
            let Some((code, probability)) = reading else {
                continue;
            };
            if *probability < CONFIDENT {
                continue;
            }
            if only.is_some_and(|list| !list.iter().any(|l| code.eq_ignore_ascii_case(l))) {
                continue;
            }
            said.insert(*turn, code.to_ascii_lowercase());
        }
        said
    }

    /// The language each voice speaks: the one most of its answers agreed on.
    pub(crate) fn voices_language(&self, said: &HashMap<usize, String>) -> HashMap<usize, String> {
        let mut out = HashMap::new();
        for (voice, turns) in &self.per_voice {
            let mut tally: HashMap<&str, usize> = HashMap::new();
            for turn in turns {
                if let Some(code) = said.get(turn) {
                    *tally.entry(code.as_str()).or_default() += 1;
                }
            }
            if let Some((code, _)) = tally
                .into_iter()
                .max_by(|left, right| left.1.cmp(&right.1).then(right.0.cmp(left.0)))
            {
                out.insert(*voice, code.to_string());
            }
        }
        out
    }

    /// Every language somebody was heard speaking, most turns first.
    pub(crate) fn languages(&self) -> Vec<(String, usize)> {
        let said = self.said(None);
        let mut tally: HashMap<String, usize> = HashMap::new();
        for code in said.values() {
            *tally.entry(code.clone()).or_default() += 1;
        }
        let mut out: Vec<(String, usize)> = tally.into_iter().collect();
        out.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
        out
    }
}

/// Cuts the recording into turns by voice and asks whisper about a few of each
/// voice's longest.
///
/// **One question per voice, not one per turn.** Every turn of one voice is in
/// that voice's language — that is what an interpreted recording *is*, and the
/// rule the speakers already follow at the end of an ordinary run. So the
/// longest few turns of each voice are asked about, far more speech than a
/// single piece, and the answer covers everything that voice says. A turn
/// nobody could be described in is asked about on its own.
#[allow(clippy::too_many_arguments)]
pub(crate) fn voices_speaking(
    run: &Run,
    settings: &Settings,
    check: &tools::ToolCheck,
    samples: &[i16],
    rate: u32,
    regions: &[(f64, f64)],
    working: &Path,
    say: &dyn Fn(u32, &str),
) -> Reported<Heard> {
    let steps = listening_walk(regions).len().max(1);
    let turns = turns_by_voice(
        check,
        samples,
        rate,
        regions,
        run.task,
        run.recording_id,
        |done| {
            say(6 + (16 * done / steps) as u32, "second_language.listening");
        },
    )?;
    stop_if_cancelled(run.task, run.recording_id)?;

    let mut per_voice: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut alone: Vec<usize> = Vec::new();
    for (index, (_, _, voice)) in turns.iter().enumerate() {
        match voice {
            Some(voice) => per_voice.entry(*voice).or_default().push(index),
            None => alone.push(index),
        }
    }
    let mut asked: Vec<usize> = Vec::new();
    let mut voices: Vec<usize> = per_voice.keys().copied().collect();
    voices.sort_unstable();
    for voice in &voices {
        let mut theirs = per_voice[voice].clone();
        theirs.sort_by(|left, right| {
            let a = turns[*left].1 - turns[*left].0;
            let b = turns[*right].1 - turns[*right].0;
            b.total_cmp(&a)
        });
        theirs.truncate(ASK_PER_VOICE);
        asked.extend(theirs);
    }
    asked.extend(&alone);
    asked.sort_unstable();

    let folder = working.join("asked");
    let spans: Vec<(f64, f64)> = asked
        .iter()
        .map(|at| (turns[*at].0, turns[*at].1))
        .collect();
    let names = write_pieces(&folder, samples, rate, &spans)?;
    let readings = languages_of_files(run, settings, check, &folder, &names, |done| {
        say(
            22 + (8 * done / names.len().max(1)) as u32,
            "second_language.listening",
        );
    })?;
    let _ = std::fs::remove_dir_all(&folder);

    Ok(Heard {
        turns,
        asked,
        readings,
        per_voice,
    })
}

/// Are two languages spoken here? Asked *before* an ordinary transcription, so
/// that a bilingual recording is never transcribed twice.
///
/// Until this existed, a recording with detection switched on was transcribed
/// whole in one language, then swept, then transcribed again in two — and the
/// first transcript was thrown away. The voices know the answer for the price
/// of a few questions, and the recording then goes down one road or the other.
///
/// The second language has to be heard from more than one turn: a single
/// answer is a name, a quotation, a song.
pub(crate) fn two_languages_heard(
    run: &Run,
    settings: &Settings,
    check: &tools::ToolCheck,
    wav: &Path,
    working: &Path,
    say: &dyn Fn(u32, &str),
) -> Reported<Option<(String, String)>> {
    let Some((samples, rate)) = read_pcm16(wav) else {
        return Ok(None);
    };
    let regions = speech_regions(&samples, rate);
    if regions.is_empty() {
        return Ok(None);
    }
    let heard = voices_speaking(run, settings, check, &samples, rate, &regions, working, say)?;
    let languages = heard.languages();
    crate::note!(
        "second language: {} turns, {} voices, heard {:?}",
        heard.turns.len(),
        heard.per_voice.len(),
        languages
    );
    match languages.as_slice() {
        [(own, _), (second, times), ..] if *times >= LEAST_AGREEING => {
            Ok(Some((own.clone(), second.clone())))
        }
        _ => Ok(None),
    }
}

/// One turn of speech: one voice, one language, and the boundary it really has.
///
/// `from` and `to` are the turn itself. whisper is handed a little more than
/// that at each end so it does not bite off the first consonant — see
/// [`heard_between`] — and words that land in the extra are dropped again,
/// because they belong to the neighbour it was borrowed from.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Spoken {
    pub(crate) from: f64,
    pub(crate) to: f64,
    pub(crate) language: String,
    /// Which voice, when the voice was heard. Turns of one voice share a
    /// language, which is what makes the language cost a handful of questions
    /// instead of one per piece.
    pub(crate) voice: Option<usize>,
}

/// What whisper is handed for a turn: the turn plus a little either side.
pub(crate) fn heard_between(turn: &Spoken, duration: f64) -> (f64, f64) {
    ((turn.from - PAD).max(0.0), (turn.to + PAD).min(duration))
}

/// What whisper said about each file, in the order it was given them.
///
/// The log carries `processing 'NAME'` as each file is picked up and
/// `auto-detected language: en (p = 0.99)` once it has listened, so a name is
/// paired with the first report after it. A file with no report — one whisper
/// could not read — has no entry.
pub(crate) fn languages_reported(log: &str) -> Vec<(String, String, f64)> {
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    for line in log.lines() {
        if let Some(rest) = line.split("processing '").nth(1) {
            current = rest.split('\'').next().map(str::to_string);
        } else if line.contains("auto-detected language:") {
            if let (Some(name), Some((code, probability))) =
                (current.take(), detected_language(line))
            {
                out.push((name, code, probability));
            }
        }
    }
    out
}

/// Writes each span of the samples as a WAV of its own, named by its place.
fn write_pieces(
    folder: &Path,
    samples: &[i16],
    rate: u32,
    spans: &[(f64, f64)],
) -> Reported<Vec<String>> {
    std::fs::create_dir_all(folder)?;
    let mut names = Vec::with_capacity(spans.len());
    for (index, (from, to)) in spans.iter().enumerate() {
        let first = ((from * f64::from(rate)) as usize).min(samples.len());
        let last = ((to * f64::from(rate)) as usize)
            .min(samples.len())
            .max(first);
        let name = format!("{index:04}.wav");
        write_wav(&folder.join(&name), &samples[first..last], rate)?;
        names.push(name);
    }
    Ok(names)
}

/// Asks whisper which language each file is in, [`MOST_FILES_AT_ONCE`] to a
/// run. `progress` is told how many files have been picked up so far.
fn languages_of_files(
    run: &Run,
    settings: &Settings,
    check: &tools::ToolCheck,
    folder: &Path,
    names: &[String],
    mut progress: impl FnMut(usize),
) -> Reported<Vec<Option<(String, f64)>>> {
    let program = Path::new(check.whisper_cli.as_ref().unwrap());
    let available = program_help(program);
    let mut heard: HashMap<String, (String, f64)> = HashMap::new();
    let mut before = 0;
    for batch in names.chunks(MOST_FILES_AT_ONCE) {
        let mut cmd = files_command(
            program,
            settings,
            check,
            &Over::Languages,
            batch,
            &available,
        );
        cmd.current_dir(folder);
        let log = run_over_files(run, cmd, |started| progress(before + started))?;
        for (name, code, probability) in languages_reported(&log) {
            heard.insert(name, (code, probability));
        }
        before += batch.len();
        stop_if_cancelled(run.task, run.recording_id)?;
    }
    Ok(names.iter().map(|name| heard.get(name).cloned()).collect())
}

/// Transcribes each file in one language, [`MOST_FILES_AT_ONCE`] to a run,
/// leaving `<file>.json` beside every one.
fn transcribe_files(
    run: &Run,
    settings: &Settings,
    check: &tools::ToolCheck,
    folder: &Path,
    language: &str,
    names: &[String],
    mut progress: impl FnMut(usize),
) -> Reported<()> {
    let program = Path::new(check.whisper_cli.as_ref().unwrap());
    let available = program_help(program);
    let mut before = 0;
    for batch in names.chunks(MOST_FILES_AT_ONCE) {
        let over = Over::Transcript { language };
        let mut cmd = files_command(program, settings, check, &over, batch, &available);
        cmd.current_dir(folder);
        run_over_files(run, cmd, |started| progress(before + started))?;
        before += batch.len();
        stop_if_cancelled(run.task, run.recording_id)?;
    }
    Ok(())
}

/// Letters only the first language uses, for the pairs this has been measured
/// on.
///
/// Czech against English is the pair the whole feature was measured against,
/// and diacritics separate them cleanly *in this direction*: a line carrying
/// `ř` or `ě` is not English. A language with no entry here is told apart by
/// its function words alone, or not at all.
fn letters_of(language: &str) -> &'static str {
    match language {
        "cs" | "sk" => "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ",
        _ => "",
    }
}

/// Words that only one of the two languages uses, for lines the letters do not
/// give away.
///
/// **Only words that are not also words in the other language.** The first
/// draft of the Czech list had `my`, `to`, `a` and `on` in it and would have
/// read `My grandkids come to my house.` as Czech; the English list leaves out
/// `a`, `to`, `on`, `my`, `do`, `by`, `no` and `i` for the same reason in the
/// other direction. Measured over 282 lines of the reference recording: the
/// Czech list catches the Czech ones and no English one.
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
        "en" => &[
            "the", "and", "you", "that", "with", "have", "this", "what", "your", "they", "we",
            "could", "would", "should", "from", "were", "was", "are", "not", "but", "for", "our",
            "is", "of", "it", "in", "he", "she", "so", "at", "as", "if", "or", "be", "us", "there",
            "here", "when", "because", "about", "just", "like", "know", "going", "get", "got",
            "them", "his", "her", "who", "how", "why", "did", "does", "don't", "didn't",
        ],
        _ => &[],
    }
}

/// Is at least a third of this line made of the language's function words?
/// Inclusive, so a three-word line with one of them counts.
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

/// Which of the two languages a line reads as, when its letters or its
/// function words say so; nothing when they do not.
///
/// whisper told to transcribe in the wrong language does one of two things,
/// and both were seen on the reference recording: it writes the language
/// actually spoken anyway — `If we could have skipped` under a Czech label —
/// or it writes the sounds in the language it was asked for — `Mám vnútsata`
/// under an English one. Letters catch the second, function words the first,
/// and a turn caught either way is heard again in its real language.
/// Lines whisper writes over near-silence, by language.
///
/// **Seen, not imagined.** *Titulky vytvořil Jirka Kovář* stood at 02:20 of
/// the reference recording, over a breath between two turns — the credit line
/// of the subtitle files whisper learnt Czech from, which it reproduces
/// whenever it is given nothing to hear. The English model has the same habit
/// with *Thank you for watching*. A block that is one of these is not speech
/// and is not kept, whatever its confidence.
fn sounds_like_nothing(text: &str) -> bool {
    const KNOWN: &[&str] = &[
        "titulky vytvořil",
        "titulky vytvořila",
        "titulky vytvorili",
        "překlad a titulky",
        "děkuji za zhlédnutí",
        "děkuju za zhlédnutí",
        "díky za zhlédnutí",
        "thank you for watching",
        "thanks for watching",
        "subtitles by",
        "subscribe to",
        "please subscribe",
    ];
    let lower = text.to_lowercase();
    KNOWN.iter().any(|phrase| lower.contains(phrase))
}

fn spoken_in(text: &str, own: &str, second: &str) -> Option<String> {
    for language in [own, second] {
        let letters = letters_of(language);
        if !letters.is_empty() && text.chars().any(|c| letters.contains(c)) {
            return Some(language.to_string());
        }
    }
    [own, second]
        .into_iter()
        .find(|language| reads_as(language, text))
        .map(str::to_string)
}

/// A block heard inside one turn, put back at the turn's place in the
/// recording and stamped with the turn's language.
fn shifted(mut segment: Segment, by: f64, language: Option<&str>) -> Segment {
    let place = |t: f64| ((t + by) * 1000.0).round() / 1000.0;
    segment.start = place(segment.start);
    segment.end = place(segment.end);
    if let Some(words) = segment
        .words
        .as_deref()
        .and_then(|w| serde_json::from_str::<Vec<serde_json::Value>>(w).ok())
    {
        let moved: Vec<serde_json::Value> = words
            .into_iter()
            .map(|mut word| {
                if let Some(t) = word["t"].as_f64() {
                    word["t"] = serde_json::json!(place(t));
                }
                word
            })
            .collect();
        segment.words = serde_json::to_string(&moved).ok();
    }
    segment.language = language.map(str::to_string);
    segment
}

/// What the multilingual pass wrote: every block, and how many of them are
/// in the second language. A run reports the first; a fill asked for from
/// the transcript reports the second.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Written {
    pub(crate) blocks: usize,
    pub(crate) in_second: usize,
}

/// The recording's own language, when nothing has said it yet: the language
/// most of the pieces were confidently heard in, other than the second.
///
/// A run left on automatic used to learn the language from the
/// single-language pass; a recording transcribed in two languages from the
/// start has no such pass, and the detection over its pieces already knows.
pub(crate) fn own_language_heard(heard: &[Option<(String, f64)>], second: &str) -> Option<String> {
    let mut tally: HashMap<String, usize> = HashMap::new();
    for (code, probability) in heard.iter().flatten() {
        if *probability >= CONFIDENT && !code.eq_ignore_ascii_case(second) {
            *tally.entry(code.to_ascii_lowercase()).or_default() += 1;
        }
    }
    tally
        .into_iter()
        .max_by(|left, right| left.1.cmp(&right.1).then(right.0.cmp(&left.0)))
        .map(|(code, _)| code)
}

/// How far past a turn's edge a word may still start and be counted as the
/// turn's own. A handover found by the voice is accurate to tenths, and a
/// stricter line would cut real speech off the ends.
const BOUNDARY_SLACK: f64 = 0.05;

/// A block cut back to the turn it belongs to.
///
/// whisper is handed a little more than the turn at each end so that it does
/// not bite off the first consonant, and it duly writes down what it hears in
/// the extra — which is the neighbour's speech, in the neighbour's language,
/// already transcribed there. Words that start outside the turn are dropped and
/// the text is rebuilt from the ones that remain, the same way the sentence
/// builder does it. A block that was borrowed whole is dropped whole.
///
/// A block with no word timings has nothing finer than itself to judge by, so
/// it stays or goes on its middle.
fn trimmed(segment: Segment, from: f64, to: f64) -> Option<Segment> {
    let words: Vec<serde_json::Value> = segment
        .words
        .as_deref()
        .and_then(|w| serde_json::from_str(w).ok())
        .unwrap_or_default();
    if words.len() < 2 {
        let middle = (segment.start + segment.end) / 2.0;
        return (middle >= from - BOUNDARY_SLACK && middle <= to + BOUNDARY_SLACK)
            .then_some(segment);
    }
    let kept: Vec<serde_json::Value> = words
        .into_iter()
        .filter(|word| {
            word["t"]
                .as_f64()
                .is_some_and(|t| t >= from - BOUNDARY_SLACK && t <= to + BOUNDARY_SLACK)
        })
        .collect();
    if kept.is_empty() {
        return None;
    }
    let text = kept
        .iter()
        .filter_map(|word| word["s"].as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if text.is_empty() {
        return None;
    }
    let start = kept[0]["t"].as_f64().unwrap_or(segment.start);
    Some(Segment {
        start,
        end: segment.end.min(to).max(start),
        text,
        words: serde_json::to_string(&kept).ok(),
        ..segment
    })
}

/// Transcribes a recording in both of its languages and replaces the
/// transcript with the result.
///
/// **The pass, in order.** The prepared audio is cut into pieces of speech at
/// its own silences and each piece cut down until it is short enough to hold
/// one language; the voice says which language each piece is in, and whisper
/// is asked about a few; the pieces are joined back into turns; every turn is
/// transcribed in its language, one run for each; a turn whose text gives
/// away that it was heard in the wrong one is heard again; and the blocks are
/// put back at their places, given their speakers and written in one
/// transaction with the offer's new state — so a failure anywhere leaves the
/// transcript exactly as it was.
///
/// Which language a piece is in is asked of its *voice* first and of whisper
/// only for the seeds and the doubtful — see [`SEED_EVERY`] for why that is
/// the difference between a pass that takes as long as a transcription and
/// one that takes three times as long.
///
/// It replaces the whole transcript rather than adding to it, because the
/// first transcript is wrong wherever the other language was spoken: whisper
/// asked for Czech over English speech does not fail, it translates, and those
/// lines look like Czech that was never said. Corrections made to the earlier
/// text do not survive this, the same as any transcription run again.
///
/// **The language stays on the recording.** Once written in, the second
/// language is put on the recording's row as its choice — where the reader
/// would have put it by hand — so the next transcription of this recording is
/// bilingual from its first second, with no sweep and no single-language pass
/// in front of it.
///
/// Called from three places: the start of a transcription of a recording
/// already known to be bilingual, where it is the whole run; the end of one
/// whose sweep found the other language, where the WAV is still there; and
/// [`fill`], which has to make one first.
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
) -> Reported<Written> {
    let recording_id = recording.id.as_str();
    let say = |percent: u32, code: &str| {
        status(app, recording_id, "second_language", percent, step(code));
    };
    let second = language.trim().to_ascii_lowercase();
    let run = Run {
        app,
        recording_id,
        task,
    };

    say(5, "second_language.cutting");
    let Some((samples, rate)) = read_pcm16(wav) else {
        return Err(UserMessage::new("diarization.audio_unreadable"));
    };
    let duration = samples.len() as f64 / f64::from(rate.max(1));
    let regions = speech_regions(&samples, rate);
    if regions.is_empty() {
        // Nothing spoken at all: nothing is written, and whatever transcript
        // there was stays as it is.
        return Err(UserMessage::new("transcription.empty_result"));
    }

    say(6, "second_language.listening");
    let heard = voices_speaking(
        &run,
        settings,
        check,
        &samples,
        rate,
        &regions,
        working,
        &|percent, code| say(percent, code),
    )?;
    let placed = &heard.turns;

    // The recording's own language: what it says, or what was just heard.
    let mut own = crate::ai_edit::effective_language(recording);
    if own.is_empty() || own == "auto" {
        own = own_language_heard(&heard.readings, &second).unwrap_or_else(|| second.clone());
        db::set_language(connection, recording_id, &own)?;
        crate::note!("second language: the recording's own language read as {own}");
    }
    let spoken_languages: Vec<&str> = if own == second {
        vec![own.as_str()]
    } else {
        vec![own.as_str(), second.as_str()]
    };
    // Only the two languages this recording is in; anything else came back
    // from a mishearing and is treated as no answer at all.
    let said = heard.said(Some(&spoken_languages));
    let voice_language = heard.voices_language(&said);

    let mut turns: Vec<Spoken> = Vec::new();
    let mut how: Vec<&str> = Vec::new();
    for (index, (from, to, voice)) in placed.iter().enumerate() {
        let (language, told) = match voice.and_then(|v| voice_language.get(&v)) {
            Some(language) => (language.clone(), "voice"),
            None => match said.get(&index) {
                Some(language) => (language.clone(), "asked"),
                // Neither the voice nor a question answered. The turn before
                // it is a better guess than the recording's own language:
                // measured over the reference recording, a stretch nobody
                // could place is nearly always the same speaker continuing.
                None => (
                    turns
                        .last()
                        .map(|last: &Spoken| last.language.clone())
                        .unwrap_or_else(|| own.clone()),
                    "inherited",
                ),
            },
        };
        // Neighbours of one voice saying one language are one turn, up to a
        // window's worth, so whisper hears a sentence whole and punctuates it.
        match turns.last_mut() {
            Some(last)
                if last.language == language
                    && last.voice == *voice
                    && from - last.to < JOIN_GAP
                    && to - last.from <= LONGEST_TURN =>
            {
                last.to = last.to.max(*to);
            }
            _ => {
                turns.push(Spoken {
                    from: *from,
                    to: *to,
                    language,
                    voice: *voice,
                });
                how.push(told);
            }
        }
    }
    crate::note!(
        "second language: {} stretches, {} turns, {} voices, {} questions, {} turns in {second}",
        regions.len(),
        turns.len(),
        heard.per_voice.len(),
        heard.asked.len(),
        turns.iter().filter(|t| t.language == second).count()
    );
    // For measuring what the voice decided against what whisper would say.
    if let Some(dump) = std::env::var_os("VOLOCAL_LANGUAGE_DUMP") {
        let rows: Vec<String> = turns
            .iter()
            .zip(&how)
            .map(|(turn, how)| {
                let voice = turn.voice.map(|v| v.to_string()).unwrap_or_default();
                format!(
                    "{:.3}\t{:.3}\t{}\t{how}\t{voice}",
                    turn.from, turn.to, turn.language
                )
            })
            .collect();
        let _ = std::fs::write(dump, rows.join("\n"));
    }

    let turns_folder = working.join("turns");
    let spans: Vec<(f64, f64)> = turns.iter().map(|t| heard_between(t, duration)).collect();
    let turn_names = write_pieces(&turns_folder, &samples, rate, &spans)?;
    stop_if_cancelled(task, recording_id)?;

    say(30, "second_language.transcribing");
    let mut done_before = 0;
    for spoken in &spoken_languages {
        let names: Vec<String> = turns
            .iter()
            .zip(&turn_names)
            .filter(|(turn, _)| turn.language == *spoken)
            .map(|(_, name)| name.clone())
            .collect();
        if names.is_empty() {
            continue;
        }
        transcribe_files(
            &run,
            settings,
            check,
            &turns_folder,
            spoken,
            &names,
            |done| {
                say(
                    30 + (55 * (done_before + done) / turns.len()) as u32,
                    "second_language.transcribing",
                );
            },
        )?;
        done_before += names.len();
    }

    say(85, "second_language.merging");
    let answer = |name: &str| {
        load_segments_from_json(&turns_folder.join(format!("{name}.json")), recording_id)
            .unwrap_or_default()
    };
    let mut heard_turns: Vec<(Spoken, Vec<Segment>)> = turns
        .iter()
        .zip(&turn_names)
        .map(|(turn, name)| (turn.clone(), answer(name)))
        .collect();

    // A turn whose text reads as the other language was heard in the wrong
    // one. It is flipped and heard again, one small run for each language.
    let mut flipped: Vec<usize> = Vec::new();
    if own != second {
        for (index, (turn, blocks)) in heard_turns.iter_mut().enumerate() {
            let other = if turn.language == own { &second } else { &own };
            let gives_away = blocks
                .iter()
                .any(|b| spoken_in(&b.text, &own, &second).as_deref() == Some(other.as_str()));
            if gives_away {
                turn.language = other.clone();
                flipped.push(index);
            }
        }
    }
    if !flipped.is_empty() {
        crate::note!(
            "second language: {} turns heard again in the other language",
            flipped.len()
        );
        for spoken in &spoken_languages {
            let names: Vec<String> = flipped
                .iter()
                .filter(|index| heard_turns[**index].0.language == *spoken)
                .map(|index| turn_names[*index].clone())
                .collect();
            if names.is_empty() {
                continue;
            }
            transcribe_files(&run, settings, check, &turns_folder, spoken, &names, |_| {})?;
        }
        for index in &flipped {
            heard_turns[*index].1 = answer(&turn_names[*index]);
        }
    }
    let _ = std::fs::remove_dir_all(&turns_folder);
    stop_if_cancelled(task, recording_id)?;

    /* Back in place, and whisper's own blocks are kept as they are. They were
    cut into sentences here at first, each language on its own — and the
    sentence rule then joined four Czech turns across the English ones between
    them into one block sixteen seconds long, which stood in the export before
    the English that was said inside it. A turn is the unit; nothing joins
    across it. */
    let mut in_own: Vec<Segment> = Vec::new();
    let mut in_second: Vec<Segment> = Vec::new();
    for (turn, blocks) in heard_turns {
        let stamp = (turn.language != own).then_some(turn.language.as_str());
        for block in blocks {
            if sounds_like_nothing(&block.text) {
                continue;
            }
            let (heard_from, _) = heard_between(&turn, duration);
            let Some(block) = trimmed(shifted(block, heard_from, stamp), turn.from, turn.to) else {
                continue;
            };
            let moved = block;
            if stamp.is_some() {
                in_second.push(moved);
            } else {
                in_own.push(moved);
            }
        }
    }
    let mut segments = in_own;
    let mut added = in_second;
    let count = added.len();
    segments.append(&mut added);
    segments.sort_by(|left, right| left.start.total_cmp(&right.start));
    for (position, segment) in segments.iter_mut().enumerate() {
        segment.order = position as i64;
    }
    if segments.is_empty() {
        return Err(UserMessage::new("transcription.empty_result"));
    }
    snap_starts_to_sound(&mut segments, wav);
    apply_dictionary(&mut segments, &db::dictionary(connection)?);
    stop_if_cancelled(task, recording_id)?;

    // Speakers, the way a run gives them: a bonus, and never a reason to lose
    // the transcript. The language rule at the end is what makes the voices
    // right on an interpreted recording, where the language *is* the speaker.
    if settings.diarization && check.issues_diarization.is_empty() {
        say(90, "diarization.running");
        match diarize(settings, check, wav, &segments, task, recording_id, None) {
            Ok(voices) => {
                segments = assign_speakers(segments, &voices);
                bridge_unknown(&mut segments);
                keep_voices_to_one_language(&mut segments);
            }
            Err(error) => {
                crate::note!("second language: the speakers were not told apart: {error}");
            }
        }
    }
    stop_if_cancelled(task, recording_id)?;
    let mut key: Vec<String> = segments.iter().filter_map(|s| s.speakers.clone()).collect();
    key.sort_by_key(|k| order_key(k));
    key.dedup();

    say(97, "saving");
    // One transaction. A failure halfway through would otherwise leave a
    // transcript with half its blocks gone, which is worse than never having
    // asked.
    connection.execute_batch("BEGIN")?;
    let written = (|| -> Reported<()> {
        db::delete_segments(connection, recording_id)?;
        for segment in &segments {
            db::insert_segment(connection, segment)?;
        }
        db::keep_only_speakers(connection, recording_id, &key)?;
        for (i, k) in key.iter().enumerate() {
            db::insert_speaker(
                connection,
                &db::Speaker {
                    key: k.clone(),
                    recording_id: recording_id.to_string(),
                    name: format!("Mluvčí {}", i + 1),
                    color: db::COLORS[i % db::COLORS.len()].to_string(),
                },
            )?;
        }
        db::set_second_language_state(connection, recording_id, db::second_language_state::FILLED)?;
        // From now on the recording is bilingual, and says so itself.
        if recording.second_language_choice.trim().is_empty() && own != second {
            db::set_second_language_choice(connection, recording_id, &second)?;
        }
        Ok(())
    })();
    if let Err(error) = written {
        let _ = connection.execute_batch("ROLLBACK");
        return Err(error);
    }
    connection.execute_batch("COMMIT")?;
    say(100, "second_language.done");
    Ok(Written {
        blocks: segments.len(),
        in_second: count,
    })
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
        .map(|written| written.in_second)
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

    // ------------------------------------------- cutting speech into pieces

    /// A signal at 16 kHz: a tone where `speech` says, a whisper of noise
    /// everywhere else, so the quiet has a floor of its own.
    fn sound(seconds: f64, speech: &[(f64, f64)]) -> Vec<i16> {
        let rate = 16_000.0;
        (0..(seconds * rate) as usize)
            .map(|n| {
                let t = n as f64 / rate;
                let loud = speech.iter().any(|(from, to)| t >= *from && t < *to);
                if loud {
                    (8000.0 * (t * 2.0 * std::f64::consts::PI * 220.0).sin()) as i16
                } else {
                    ((n * 7919) % 13) as i16 - 6
                }
            })
            .collect()
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.06
    }

    #[test]
    fn silence_holds_no_pieces() {
        assert!(pieces_of_speech(&sound(5.0, &[]), 16_000).is_empty());
    }

    #[test]
    fn one_stretch_of_speech_is_one_piece_with_its_edges_kept() {
        let pieces = pieces_of_speech(&sound(5.0, &[(1.0, 3.0)]), 16_000);
        assert_eq!(pieces.len(), 1, "{pieces:?}");
        assert!(near(pieces[0].0, 1.0 - PAD), "{pieces:?}");
        assert!(near(pieces[0].1, 3.0 + PAD), "{pieces:?}");
    }

    /// **The number the pass turns on.** Half a second of quiet is a change of
    /// speaker; a tenth of a second is a breath inside one.
    #[test]
    fn half_a_second_of_quiet_ends_a_piece_and_a_tenth_does_not() {
        let two = pieces_of_speech(&sound(6.0, &[(1.0, 2.5), (3.0, 4.5)]), 16_000);
        assert_eq!(two.len(), 2, "{two:?}");
        let one = pieces_of_speech(&sound(6.0, &[(1.0, 2.5), (2.6, 4.0)]), 16_000);
        assert_eq!(one.len(), 1, "{one:?}");
    }

    /// **The measurement that made the difference.** A long stretch is cut
    /// down until every piece is short enough to hold one language, and the
    /// pieces still cover what they were cut from.
    #[test]
    fn a_long_stretch_is_cut_into_pieces_short_enough_to_hold_one_language() {
        let pieces = pieces_of_speech(&sound(13.0, &[(1.0, 12.0)]), 16_000);
        assert!(pieces.len() >= 4, "{pieces:?}");
        for (from, to) in &pieces {
            assert!(to - from <= LONGEST_PIECE + 2.0 * PAD + 1e-9, "{pieces:?}");
            assert!(to - from >= CUT_EDGE - 1e-9, "{pieces:?}");
        }
        for pair in pieces.windows(2) {
            assert!(pair[1].0 <= pair[0].1, "a hole between pieces: {pieces:?}");
        }
        assert!(near(pieces[0].0, 1.0 - PAD));
        assert!(near(pieces[pieces.len() - 1].1, 12.0 + PAD));
    }

    /// A syllable on its own is part of the speech before it; a click a long
    /// way from any speech is nothing.
    #[test]
    fn a_syllable_joins_the_piece_before_it_and_a_distant_click_is_dropped() {
        let joined = pieces_of_speech(&sound(6.0, &[(1.0, 3.0), (3.3, 3.5)]), 16_000);
        assert_eq!(joined.len(), 1, "{joined:?}");
        assert!(near(joined[0].1, 3.5 + PAD), "{joined:?}");
        let alone = pieces_of_speech(&sound(12.0, &[(1.0, 3.0), (10.0, 10.2)]), 16_000);
        assert_eq!(alone.len(), 1, "{alone:?}");
    }

    // --------------------------------------------- where speech changes hands

    /// A stretch of speech is left whole now: the voice cuts it, not the
    /// loudness. Only the fallback for a machine with no voice model still
    /// cuts a long stretch down.
    #[test]
    fn a_long_stretch_stays_whole_but_the_fallback_still_cuts_it() {
        let audio = sound(13.0, &[(1.0, 12.0)]);
        let whole = speech_regions(&audio, 16_000);
        assert_eq!(whole.len(), 1, "{whole:?}");
        assert!(whole[0].1 - whole[0].0 > 10.0, "{whole:?}");
        assert!(pieces_of_speech(&audio, 16_000).len() >= 4);
    }

    #[test]
    fn the_walk_steps_along_each_stretch_and_skips_what_is_too_short() {
        let walk = listening_walk(&[(10.0, 14.0), (20.0, 20.4), (30.0, 31.6)]);
        let first: Vec<f64> = walk
            .iter()
            .filter(|(r, _)| *r == 0)
            .map(|(_, t)| *t)
            .collect();
        assert!(first.len() >= 3, "{walk:?}");
        assert!((first[1] - first[0] - 0.4).abs() < 1e-9, "{walk:?}");
        assert!(first.iter().all(|t| *t >= 10.0 && *t <= 14.0), "{walk:?}");
        assert!(!walk.iter().any(|(r, _)| *r == 1), "too short to describe");
        assert!(walk.iter().any(|(r, _)| *r == 2));
    }

    fn voice(a: f32, b: f32) -> Option<Vec<f32>> {
        Some(vec![a, b])
    }

    /// **The measurement this replaced.** One stretch, two people, no pause
    /// between them — the loudness cut put its boundary at the quietest frame
    /// and lost a sentence. The likeness between what came before a moment and
    /// what comes after it dips exactly where they change over.
    #[test]
    fn the_moment_two_people_change_over_is_found_without_a_pause() {
        let walk: Vec<f64> = (0..20).map(|n| 100.0 + n as f64 * 0.4).collect();
        let prints: Vec<Option<Vec<f32>>> = (0..20)
            .map(|n| {
                if n < 10 {
                    voice(1.0, 0.0)
                } else {
                    voice(0.0, 1.0)
                }
            })
            .collect();
        let found = handovers(&walk, &prints);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!((found[0] - walk[10]).abs() < 0.9, "got {found:?}");
    }

    /// One person throughout hands over to nobody.
    #[test]
    fn one_voice_the_whole_way_has_no_handover() {
        let walk: Vec<f64> = (0..20).map(|n| n as f64 * 0.4).collect();
        let prints: Vec<Option<Vec<f32>>> = (0..20).map(|_| voice(1.0, 0.0)).collect();
        assert!(handovers(&walk, &prints).is_empty());
    }

    /// Moments nobody could be described at do not become handovers.
    #[test]
    fn a_stretch_nobody_could_be_heard_in_has_no_handover() {
        let walk: Vec<f64> = (0..20).map(|n| n as f64 * 0.4).collect();
        assert!(handovers(&walk, &vec![None; 20]).is_empty());
    }

    // ------------------------------------------------ a block cut back to its turn

    fn spoken(start: f64, end: f64, text: &str, words: &str) -> Segment {
        Segment {
            id: "b".into(),
            recording_id: "r".into(),
            order: 0,
            start,
            end,
            text: text.into(),
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            words: Some(words.into()),
            original: None,
            language: None,
        }
    }

    /// **The borrowed word.** whisper is given a little past the turn so it
    /// does not bite off the first consonant, and writes down the neighbour's
    /// first word too. It belongs to the neighbour, which is transcribing it
    /// in the neighbour's own language.
    #[test]
    fn a_word_that_starts_after_the_turn_belongs_to_the_neighbour() {
        let block = spoken(
            100.0,
            104.4,
            "Máme tři děti Two",
            r#"[{"t":100.0,"s":"Máme"},{"t":100.6,"s":"tři"},{"t":101.2,"s":"děti"},{"t":104.3,"s":"Two"}]"#,
        );
        let kept = trimmed(block, 100.0, 104.0).unwrap();
        assert_eq!(kept.text, "Máme tři děti");
        assert!((kept.end - 104.0).abs() < 1e-9, "got {}", kept.end);
    }

    #[test]
    fn a_block_borrowed_whole_is_dropped_whole() {
        let block = spoken(
            104.2,
            104.9,
            "Two boys",
            r#"[{"t":104.2,"s":"Two"},{"t":104.5,"s":"boys"}]"#,
        );
        assert!(trimmed(block, 100.0, 104.0).is_none());
    }

    /// Nothing finer than the block is known, so its middle decides.
    #[test]
    fn a_block_with_no_word_timings_is_judged_by_its_middle() {
        let mut block = spoken(103.4, 104.0, "Ano.", "[]");
        block.words = None;
        assert!(trimmed(block.clone(), 100.0, 104.0).is_some());
        assert!(trimmed(block, 100.0, 103.0).is_none());
    }

    // ------------------------------------------- a turn heard in the wrong one

    /// **Both things whisper does when asked the wrong language**, as seen on
    /// the reference recording: it writes the language actually spoken anyway,
    /// or it writes the sounds in the language it was asked for.
    #[test]
    fn a_line_gives_away_the_language_it_was_really_spoken_in() {
        assert_eq!(
            spoken_in("If we could have skipped", "cs", "en").as_deref(),
            Some("en")
        );
        assert_eq!(
            spoken_in("Peter the Jew", "cs", "en").as_deref(),
            Some("en")
        );
        assert_eq!(
            spoken_in("Mám vnútsata.", "cs", "en").as_deref(),
            Some("cs")
        );
        assert_eq!(
            spoken_in("Jsem odcestoval.", "cs", "en").as_deref(),
            Some("cs")
        );
    }

    /// A line with no tell says nothing, and is left where whisper put it.
    #[test]
    fn a_line_with_no_tell_says_nothing() {
        assert_eq!(spoken_in("Two boys, one girl.", "cs", "en"), None);
        assert_eq!(spoken_in("333.", "cs", "en"), None);
    }

    // ------------------------------------------- what whisper said about each

    #[test]
    fn the_language_of_each_file_is_paired_with_its_name() {
        let log = "main: processing '0000.wav' (48000 samples, 3.0 sec), 4 threads\n\
                   whisper_full_with_state: auto-detected language: cs (p = 0.991)\n\
                   main: processing '0001.wav' (32000 samples, 2.0 sec), 4 threads\n\
                   error: failed to read audio\n\
                   main: processing '0002.wav' (32000 samples, 2.0 sec), 4 threads\n\
                   whisper_full_with_state: auto-detected language: en (p = 0.870)\n";
        let heard = languages_reported(log);
        assert_eq!(heard.len(), 2);
        assert_eq!(heard[0].0, "0000.wav");
        assert_eq!(heard[0].1, "cs");
        assert_eq!(heard[1].0, "0002.wav");
        assert!((heard[1].2 - 0.87).abs() < 1e-9);
    }

    // ----------------------------------------------- a block back in its place

    #[test]
    fn a_block_moves_with_its_turn_and_takes_the_language_with_it() {
        let block = Segment {
            id: "b".into(),
            recording_id: "r".into(),
            order: 0,
            start: 1.0,
            end: 2.5,
            text: "We are the same age.".into(),
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            words: Some(r#"[{"t":1.0,"s":"We"},{"t":1.4,"s":"are"}]"#.into()),
            original: None,
            language: None,
        };
        let moved = shifted(block, 122.0, Some("en"));
        assert!((moved.start - 123.0).abs() < 1e-9);
        assert!((moved.end - 124.5).abs() < 1e-9);
        assert_eq!(moved.language.as_deref(), Some("en"));
        let words: Vec<serde_json::Value> =
            serde_json::from_str(moved.words.as_ref().unwrap()).unwrap();
        assert_eq!(words[1]["t"], 123.4);
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
