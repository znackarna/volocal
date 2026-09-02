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
    // an end, until every part is short enough to hold one language.
    let edge = frames(CUT_EDGE);
    let longest = frames(LONGEST_PIECE);
    let mut out: Vec<(usize, usize)> = Vec::with_capacity(pieces.len());
    let mut work: Vec<(usize, usize)> = pieces.into_iter().rev().collect();
    while let Some((from, to)) = work.pop() {
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

/// One piece in every stretch this long is asked whisper about directly. The
/// rest are told by their voice, and only a piece whose voice says nothing
/// clear is asked as well.
///
/// **This is the hack, and it is the same one speaker recognition is.** whisper
/// answers the language of a piece in about eighty milliseconds, whatever the
/// piece's length, because it runs its whole encoder over a thirty-second
/// window every time — 1 264 pieces of the reference recording cost 105
/// seconds, more than the transcription itself. The voice model already on
/// the disk describes a piece in a few milliseconds, and on an interpreted
/// recording the voice *is* the language: the guest speaks one, the
/// interpreter the other. So whisper is asked about one piece in every half
/// minute — enough to hear every voice several times over — and every other
/// piece takes the language of the seeds its voice is most like.
const SEED_EVERY: f64 = 30.0;

/// How many of the nearest seeds a piece's voice is compared with.
const NEAREST: usize = 7;

/// The share of the nearest seeds' weight one language must hold before the
/// voice's answer is taken. Below it the voices disagree — a piece at a
/// handover, a laugh, a voice the seeds never heard — and whisper is asked.
const AGREEING_SHARE: f32 = 0.8;

/// Fewer seeds than this say nothing about anybody.
const LEAST_SEEDS: usize = 3;

/// Which pieces are asked whisper about directly: the longest in every
/// [`SEED_EVERY`] seconds, so that every voice in the recording is heard
/// several times and a long piece — the surest kind — is what is heard.
pub(crate) fn seeds_of(pieces: &[(f64, f64)]) -> Vec<usize> {
    let mut longest: Vec<Option<usize>> = Vec::new();
    for (index, (from, to)) in pieces.iter().enumerate() {
        let bucket = (from / SEED_EVERY) as usize;
        if longest.len() <= bucket {
            longest.resize(bucket + 1, None);
        }
        let better = match longest[bucket] {
            Some(held) => to - from > pieces[held].1 - pieces[held].0,
            None => true,
        };
        if better {
            longest[bucket] = Some(index);
        }
    }
    longest.into_iter().flatten().collect()
}

/// The language a piece's voice says it is in, from the seeds it is most like;
/// nothing when the voice is not known or the nearest seeds do not agree.
pub(crate) fn by_voice(
    prints: &[Option<Vec<f32>>],
    known: &[(usize, String)],
    index: usize,
) -> Option<String> {
    let print = prints.get(index)?.as_ref()?;
    let mut nearest: Vec<(f32, &str)> = known
        .iter()
        .filter_map(|(seed, language)| {
            prints
                .get(*seed)?
                .as_ref()
                .map(|other| (crate::voiceprint::alike(print, other), language.as_str()))
        })
        .collect();
    if nearest.len() < LEAST_SEEDS {
        return None;
    }
    nearest.sort_by(|left, right| right.0.total_cmp(&left.0));
    nearest.truncate(NEAREST);
    let mut weight: HashMap<&str, f32> = HashMap::new();
    let mut total = 0.0_f32;
    for (alike, language) in &nearest {
        let w = alike.max(0.0);
        *weight.entry(language).or_default() += w;
        total += w;
    }
    if total <= 0.0 {
        return None;
    }
    let (language, held) = weight
        .into_iter()
        .max_by(|left, right| left.1.total_cmp(&right.1).then(right.0.cmp(left.0)))?;
    (held / total >= AGREEING_SHARE).then(|| language.to_string())
}

/// The language of each piece, from what the detection said about it.
///
/// Only the recording's own language and the one being filled are possible
/// answers: a Czech piece read as Slovak is Czech, and a two-second piece the
/// detection is not sure of is whatever the piece before it was. Measured on
/// the reference recording, 32 of 1 272 pieces were settled that way.
pub(crate) fn language_of_each(
    heard: &[Option<(String, f64)>],
    own: &str,
    second: &str,
) -> Vec<String> {
    let mut previous = own.to_ascii_lowercase();
    heard
        .iter()
        .map(|reading| {
            if let Some((code, probability)) = reading {
                let allowed = code.eq_ignore_ascii_case(own) || code.eq_ignore_ascii_case(second);
                if *probability >= CONFIDENT && allowed {
                    previous = code.to_ascii_lowercase();
                }
            }
            previous.clone()
        })
        .collect()
}

/// One turn of speech in one language, ready to be transcribed in it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Spoken {
    pub(crate) from: f64,
    pub(crate) to: f64,
    pub(crate) language: String,
}

/// Pieces back into turns: neighbours in one language become one, up to a
/// window's worth, so whisper hears a sentence whole and punctuates it.
pub(crate) fn turns_of(pieces: &[(f64, f64)], languages: &[String]) -> Vec<Spoken> {
    let mut turns: Vec<Spoken> = Vec::new();
    for ((from, to), language) in pieces.iter().zip(languages) {
        match turns.last_mut() {
            Some(last)
                if last.language == *language
                    && from - last.to < JOIN_GAP
                    && to - last.from <= LONGEST_TURN =>
            {
                last.to = last.to.max(*to);
            }
            _ => turns.push(Spoken {
                from: *from,
                to: *to,
                language: language.clone(),
            }),
        }
    }
    turns
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
    let pieces = pieces_of_speech(&samples, rate);
    if pieces.is_empty() {
        // Nothing spoken at all: nothing is written, and whatever transcript
        // there was stays as it is.
        return Err(UserMessage::new("transcription.empty_result"));
    }
    let pieces_folder = working.join("pieces");
    let piece_names = write_pieces(&pieces_folder, &samples, rate, &pieces)?;
    stop_if_cancelled(task, recording_id)?;

    say(6, "second_language.listening");
    // The voice of every piece first — cheap — then whisper about the seeds.
    let prints = voiceprints_of(check, &samples, rate, &pieces, task, recording_id, |done| {
        say(
            6 + (8 * done / pieces.len()) as u32,
            "second_language.listening",
        );
    })?;
    let seeds = seeds_of(&pieces);
    let seed_names: Vec<String> = seeds.iter().map(|i| piece_names[*i].clone()).collect();
    let seed_readings =
        languages_of_files(&run, settings, check, &pieces_folder, &seed_names, |done| {
            say(
                14 + (8 * done / seeds.len().max(1)) as u32,
                "second_language.listening",
            );
        })?;

    // The recording's own language: what it says, or what the seeds said.
    let mut own = crate::ai_edit::effective_language(recording);
    if own.is_empty() || own == "auto" {
        own = own_language_heard(&seed_readings, &second).unwrap_or_else(|| second.clone());
        db::set_language(connection, recording_id, &own)?;
        crate::note!("second language: the recording's own language read as {own}");
    }
    let spoken_languages: Vec<&str> = if own == second {
        vec![own.as_str()]
    } else {
        vec![own.as_str(), second.as_str()]
    };
    let allowed =
        |code: &str| code.eq_ignore_ascii_case(&own) || code.eq_ignore_ascii_case(&second);

    // Each piece's answer as a reading, so one rule settles what is not known.
    let mut heard: Vec<Option<(String, f64)>> = vec![None; pieces.len()];
    let mut how: Vec<&str> = vec!["inherited"; pieces.len()];
    let mut known: Vec<(usize, String)> = Vec::new();
    for (seed, reading) in seeds.iter().zip(&seed_readings) {
        if let Some((code, probability)) = reading {
            if *probability >= CONFIDENT && allowed(code) {
                heard[*seed] = Some((code.to_ascii_lowercase(), *probability));
                how[*seed] = "asked";
                known.push((*seed, code.to_ascii_lowercase()));
            }
        }
    }
    let mut doubtful: Vec<usize> = Vec::new();
    for index in 0..pieces.len() {
        if heard[index].is_some() {
            continue;
        }
        match by_voice(&prints, &known, index) {
            Some(language) => {
                heard[index] = Some((language, 1.0));
                how[index] = "voice";
            }
            None => doubtful.push(index),
        }
    }
    if !doubtful.is_empty() {
        let names: Vec<String> = doubtful.iter().map(|i| piece_names[*i].clone()).collect();
        let readings = languages_of_files(&run, settings, check, &pieces_folder, &names, |done| {
            say(
                22 + (8 * done / names.len()) as u32,
                "second_language.listening",
            );
        })?;
        for (index, reading) in doubtful.iter().zip(readings) {
            if let Some((code, probability)) = reading {
                if probability >= CONFIDENT && allowed(&code) {
                    heard[*index] = Some((code.to_ascii_lowercase(), probability));
                    how[*index] = "asked";
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&pieces_folder);
    crate::note!(
        "second language: {} pieces, {} asked whisper, {} told by the voice",
        pieces.len(),
        how.iter().filter(|h| **h == "asked").count(),
        how.iter().filter(|h| **h == "voice").count()
    );
    let languages = language_of_each(&heard, &own, &second);
    // For measuring the voice's answers against whisper's, piece by piece.
    if let Some(dump) = std::env::var_os("VOLOCAL_LANGUAGE_DUMP") {
        let rows: Vec<String> = pieces
            .iter()
            .zip(&languages)
            .zip(&how)
            .map(|(((from, to), language), how)| format!("{from:.3}\t{to:.3}\t{language}\t{how}"))
            .collect();
        let _ = std::fs::write(dump, rows.join("\n"));
    }
    let turns = turns_of(&pieces, &languages);
    crate::note!(
        "second language: {} pieces, {} turns, {} of them in {second}",
        pieces.len(),
        turns.len(),
        turns.iter().filter(|t| t.language == second).count()
    );

    let turns_folder = working.join("turns");
    let spans: Vec<(f64, f64)> = turns.iter().map(|t| (t.from, t.to)).collect();
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
            let moved = shifted(block, turn.from, stamp);
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

    // ------------------------------------------------ the language of each

    fn heard(readings: &[Option<(&str, f64)>]) -> Vec<Option<(String, f64)>> {
        readings
            .iter()
            .map(|r| r.map(|(code, p)| (code.to_string(), p)))
            .collect()
    }

    #[test]
    fn a_confident_reading_in_either_language_is_taken() {
        let languages = language_of_each(
            &heard(&[Some(("cs", 0.99)), Some(("en", 0.97)), Some(("cs", 0.9))]),
            "cs",
            "en",
        );
        assert_eq!(languages, vec!["cs", "en", "cs"]);
    }

    /// Slovak over a Czech recording is Czech, and a reading the detection is
    /// not sure of is whatever came before it. The first piece, with nothing
    /// before it, is the recording's own language.
    #[test]
    fn a_third_language_or_an_unsure_reading_follows_the_piece_before() {
        let languages = language_of_each(
            &heard(&[
                Some(("en", 0.30)),
                Some(("en", 0.95)),
                Some(("sk", 0.99)),
                None,
                Some(("cs", 0.98)),
                Some(("ro", 0.7)),
            ]),
            "cs",
            "en",
        );
        assert_eq!(languages, vec!["cs", "en", "en", "en", "cs", "cs"]);
    }

    /// A recording left on automatic has no language of its own yet, so it is
    /// the one most pieces were confidently heard in, other than the second.
    #[test]
    fn the_own_language_is_the_one_most_pieces_were_heard_in() {
        let own = own_language_heard(
            &heard(&[
                Some(("en", 0.99)),
                Some(("cs", 0.98)),
                Some(("cs", 0.97)),
                Some(("sk", 0.99)),
                Some(("cs", 0.30)),
                None,
                Some(("en", 0.95)),
            ]),
            "en",
        );
        assert_eq!(own.as_deref(), Some("cs"));
        assert_eq!(
            own_language_heard(&heard(&[Some(("en", 0.99))]), "en"),
            None
        );
    }

    // ------------------------------------------------- the voice as the language

    #[test]
    fn one_seed_a_half_minute_and_the_longest_piece_is_it() {
        let pieces = vec![
            (0.0, 2.0),
            (3.0, 6.5),
            (10.0, 11.0),
            (31.0, 33.0),
            (40.0, 41.0),
            (95.0, 97.0),
        ];
        assert_eq!(seeds_of(&pieces), vec![1, 3, 5]);
    }

    fn print(x: f32, y: f32) -> Option<Vec<f32>> {
        Some(vec![x, y])
    }

    fn voices() -> Vec<Option<Vec<f32>>> {
        vec![
            print(1.0, 0.0),   // 0 guest
            print(0.9, 0.1),   // 1 guest
            print(0.95, 0.05), // 2 guest
            print(0.0, 1.0),   // 3 interpreter
            print(0.1, 0.9),   // 4 interpreter
            print(0.05, 0.95), // 5 interpreter
            print(0.85, 0.15), // 6 unknown, sounds like the guest
            print(0.7, 0.7),   // 7 unknown, halfway between
            None,              // 8 too short to describe
        ]
    }

    fn seeds() -> Vec<(usize, String)> {
        vec![
            (0, "en".into()),
            (1, "en".into()),
            (2, "en".into()),
            (3, "cs".into()),
            (4, "cs".into()),
            (5, "cs".into()),
        ]
    }

    /// **The hack.** A piece that sounds like the guest is in the guest's
    /// language, and whisper was never asked about it.
    #[test]
    fn a_piece_takes_the_language_of_the_voices_it_is_most_like() {
        assert_eq!(by_voice(&voices(), &seeds(), 6).as_deref(), Some("en"));
    }

    /// Halfway between two voices, the nearest seeds split, and the voice says
    /// nothing: that piece is asked whisper about.
    #[test]
    fn a_voice_between_two_others_says_nothing() {
        assert_eq!(by_voice(&voices(), &seeds(), 7), None);
    }

    /// No print, or too few seeds to compare with, is nothing as well.
    #[test]
    fn a_piece_with_no_voice_or_too_few_seeds_is_not_answered() {
        assert_eq!(by_voice(&voices(), &seeds(), 8), None);
        assert_eq!(by_voice(&voices(), &seeds()[..2], 6), None);
    }

    // ------------------------------------------------ pieces back into turns

    fn named(languages: &[&str]) -> Vec<String> {
        languages.iter().map(|l| (*l).to_string()).collect()
    }

    #[test]
    fn neighbours_in_one_language_are_one_turn_and_a_change_starts_another() {
        let turns = turns_of(
            &[(0.0, 2.0), (2.0, 4.0), (4.1, 6.0), (6.0, 7.0)],
            &named(&["cs", "cs", "en", "cs"]),
        );
        assert_eq!(turns.len(), 3, "{turns:?}");
        assert_eq!(
            turns[0],
            Spoken {
                from: 0.0,
                to: 4.0,
                language: "cs".into()
            }
        );
        assert_eq!(turns[1].language, "en");
        assert_eq!(turns[2].from, 6.0);
    }

    /// A gap of more than a second is a new turn even in the same language,
    /// and a turn never grows past whisper's window.
    #[test]
    fn a_long_gap_or_a_full_window_starts_a_new_turn() {
        let apart = turns_of(&[(0.0, 2.0), (3.5, 5.0)], &named(&["cs", "cs"]));
        assert_eq!(apart.len(), 2);
        let pieces: Vec<(f64, f64)> = (0..12)
            .map(|n| (n as f64 * 3.0, n as f64 * 3.0 + 3.0))
            .collect();
        let long = turns_of(&pieces, &named(&["en"; 12]));
        assert!(long.len() >= 2, "{long:?}");
        for turn in &long {
            assert!(turn.to - turn.from <= LONGEST_TURN + 1e-9, "{turn:?}");
        }
    }

    // ------------------------------------------------- what whisper makes up

    /// **The credit line.** whisper learnt Czech from subtitle files and gives
    /// their signature back over a breath; the English habit is the sign-off.
    #[test]
    fn a_subtitle_credit_or_a_sign_off_is_not_speech() {
        assert!(sounds_like_nothing("Titulky vytvořil Jirka Kovář"));
        assert!(sounds_like_nothing("Thank you for watching!"));
        assert!(!sounds_like_nothing(
            "Děkuji. Je pro mě velká čest tady být."
        ));
        assert!(!sounds_like_nothing(
            "Thank you, Pastor Tom, for having me."
        ));
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
