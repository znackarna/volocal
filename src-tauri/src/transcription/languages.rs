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

// ---------------------------------------------- the multilingual pass

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

/// How far below its own shoulders a moment has to sit to be a boundary.
///
/// **This is what replaced cutting at a fixed length, and the difference is
/// measured.** Between the interpreter and the person she follows there is
/// usually no silence at all — the loudness dips for a tenth of a second and
/// never reaches the noise floor, so a rule that waits for a pause hears one
/// continuous stretch and cuts it wherever the arithmetic says. Cutting at
/// every dip instead put a boundary within half a second of 97.4 % of the 570
/// places where the reference recording actually changes language, median
/// distance 0.10 s. Anything from 4 to 10 decibels gives the same answer, so
/// the rule does not balance on this number.
const DIP_DEPTH: f64 = 6.0;

/// How far either side of a moment its shoulders are looked for.
const DIP_LOOK: f64 = 0.7;

/// No two boundaries closer together than this.
const DIP_APART: f64 = 0.8;

/// A piece shorter than this is not worth cutting out on its own.
const DIP_LEAST: f64 = 0.25;

/// No piece is longer than this.
///
/// **Measured three times, and the number is the whole difference between a
/// transcript that loses speech and one that does not.** A pause is not the
/// only place two languages meet: the interpreter often starts before the room
/// has gone quiet at all, so a piece that runs on holds both of them and takes
/// one language. Over the reference recording, of fourteen sentences known to
/// have gone missing: pieces of up to 25 seconds brought back two, pieces of
/// 3.5 seconds eleven, and pieces of 2 seconds **all fourteen**. Below two
/// there is not enough voice left in a piece to tell the language from.
const LONGEST_PIECE: f64 = 2.0;

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
    cut_speech(samples, rate, Some(LONGEST_PIECE))
}

/// Where a stretch of speech dips deeply enough to be a change of speaker.
///
/// A moment counts when it is the quietest of its immediate neighbours and
/// sits [`DIP_DEPTH`] below the loudest moment within [`DIP_LOOK`] on *both*
/// sides — one shoulder is not enough, or the run-up to every pause would
/// count twice. Of two candidates closer than [`DIP_APART`] the deeper one
/// wins: a handover has one bottom, not three.
///
/// The curve is smoothed over three frames first, so a single quiet frame
/// inside a vowel is not a boundary.
pub(crate) fn dips_in(db: &[f64], from: usize, to: usize) -> Vec<usize> {
    let frames = |seconds: f64| (seconds / FRAME).round() as usize;
    let look = frames(DIP_LOOK).max(1);
    let apart = frames(DIP_APART).max(1);
    if to <= from + 2 * (apart / 2) + 1 {
        return Vec::new();
    }
    let smooth = |at: usize| -> f64 {
        let first = at.saturating_sub(1).max(from);
        let last = (at + 1).min(to - 1);
        let window = &db[first..=last];
        window.iter().sum::<f64>() / window.len() as f64
    };

    let mut found: Vec<(usize, f64)> = Vec::new();
    for at in (from + apart / 2)..(to - apart / 2) {
        let here = smooth(at);
        // The bottom of its own dip, not a slope.
        let bottom = (at.saturating_sub(2).max(from)..=(at + 2).min(to - 1))
            .map(smooth)
            .fold(f64::INFINITY, f64::min);
        if here > bottom + f64::EPSILON {
            continue;
        }
        let left = (at.saturating_sub(look).max(from)..at)
            .map(smooth)
            .fold(f64::NEG_INFINITY, f64::max);
        let right = ((at + 1)..(at + look + 1).min(to))
            .map(smooth)
            .fold(f64::NEG_INFINITY, f64::max);
        if !left.is_finite() || !right.is_finite() {
            continue;
        }
        let depth = left.min(right) - here;
        if depth < DIP_DEPTH {
            continue;
        }
        match found.last_mut() {
            Some(last) if at - last.0 < apart => {
                if depth > last.1 {
                    *last = (at, depth);
                }
            }
            _ => found.push((at, depth)),
        }
    }
    found
        .into_iter()
        .map(|(at, _)| at)
        .filter(|at| at - from >= frames(DIP_LEAST) && to - at >= frames(DIP_LEAST))
        .collect()
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

    // Each stretch cut at every dip deep enough to be a change of speaker,
    // and — when a length was asked for — cut down further at its quietest
    // frame until nothing is longer than that.
    let edge = frames(CUT_EDGE);
    let mut out: Vec<(usize, usize)> = Vec::new();
    for (from, to) in pieces {
        let mut edges = vec![from];
        edges.extend(dips_in(&db, from, to));
        edges.push(to);
        for pair in edges.windows(2) {
            let (mut a, b) = (pair[0], pair[1]);
            let mut work = vec![(a, b)];
            while let Some((x, y)) = work.pop() {
                let Some(longest) = longest.map(frames) else {
                    out.push((x, y));
                    continue;
                };
                if y - x <= longest || y - x < 2 * edge + 1 {
                    out.push((x, y));
                    continue;
                }
                let cut = (x + edge..y - edge)
                    .min_by(|left, right| db[*left].total_cmp(&db[*right]))
                    .unwrap_or(x + edge);
                work.push((cut, y));
                work.push((x, cut));
            }
            a = b;
            let _ = a;
        }
    }
    out.sort_unstable();

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
pub(crate) fn seeds_of(pieces: &[(f64, f64)], every: f64) -> Vec<usize> {
    let mut longest: Vec<Option<usize>> = Vec::new();
    for (index, (from, to)) in pieces.iter().enumerate() {
        let bucket = (from / every) as usize;
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

/// What was heard along a recording before a word of it is transcribed: where
/// the pieces of speech are, whose voice each is, and what whisper said about
/// the few it was asked.
///
/// The step both ways in share — the pass that writes a bilingual transcript,
/// and the question asked beforehand of whether there is a second language at
/// all. Both need the same listening; only what they conclude differs.
pub(crate) struct Heard {
    pub(crate) pieces: Vec<(f64, f64)>,
    /// The file each piece was written to, so more of them can be asked about
    /// without cutting the audio again.
    pub(crate) names: Vec<String>,
    pub(crate) folder: PathBuf,
    /// One voiceprint per piece — empty until [`Heard::describe_the_voices`]
    /// is called, because the question asked before a transcription does not
    /// need them and most recordings answer it with one language.
    pub(crate) prints: Vec<Option<Vec<f32>>>,
    /// The pieces whisper was asked about, and what it said about each.
    pub(crate) seeds: Vec<usize>,
    pub(crate) readings: Vec<Option<(String, f64)>>,
}

impl Heard {
    /// The audio can go once nothing more will be asked about it.
    pub(crate) fn done_with_the_audio(&self) {
        let _ = std::fs::remove_dir_all(&self.folder);
    }

    /// Describes the voice of every piece, which is what lets the language of
    /// most of them be answered without asking whisper.
    ///
    /// Separate from the listening, and after it, because of what it costs on
    /// a recording in one language: describing the voices of a 47-minute talk
    /// takes about three quarters of a minute, and a recording that turns out
    /// to hold only one language never needs them at all. Asking the seeds
    /// first answers that question for a fifth of the price.
    pub(crate) fn describe_the_voices(
        &mut self,
        check: &tools::ToolCheck,
        samples: &[i16],
        rate: u32,
        task: &TranscriptionTask,
        recording_id: &str,
        say: &dyn Fn(u32, &str),
    ) -> Reported<()> {
        if !self.prints.is_empty() {
            return Ok(());
        }
        let total = self.pieces.len().max(1);
        self.prints = voiceprints_of(
            check,
            samples,
            rate,
            &self.pieces,
            task,
            recording_id,
            |done| {
                say(14 + (10 * done / total) as u32, "second_language.listening");
            },
        )?;
        Ok(())
    }
}

/// Cuts the recording into pieces, hears whose voice each is, and asks whisper
/// about one piece in every [`SEED_EVERY`] seconds.
///
/// The expensive half of the pass and the only half either caller needs before
/// it can decide anything.
pub(crate) fn listen_to_pieces(
    run: &Run,
    settings: &Settings,
    check: &tools::ToolCheck,
    samples: &[i16],
    rate: u32,
    working: &Path,
    say: &dyn Fn(u32, &str),
) -> Reported<Heard> {
    let pieces = pieces_of_speech(samples, rate);
    if pieces.is_empty() {
        return Err(UserMessage::new("transcription.empty_result"));
    }
    let folder = working.join("pieces");
    let names = write_pieces(&folder, samples, rate, &pieces)?;
    stop_if_cancelled(run.task, run.recording_id)?;

    let seeds = seeds_of(&pieces, SEED_EVERY);
    let seed_names: Vec<String> = seeds.iter().map(|at| names[*at].clone()).collect();
    let readings = languages_of_files(run, settings, check, &folder, &seed_names, |done| {
        say(
            6 + (8 * done / seeds.len().max(1)) as u32,
            "second_language.listening",
        );
    })?;
    Ok(Heard {
        pieces,
        names,
        folder,
        prints: Vec::new(),
        seeds,
        readings,
    })
}

/// How often a sample is taken when the only question is whether there is a
/// second language at all.
///
/// One a minute, against one every half minute for the labelling that follows.
/// The two questions are not the same size: labelling needs an anchor near
/// every piece, and this needs only to notice that somebody speaks something
/// else. Measured on the reference recording, samples a minute apart heard
/// English 17 times and samples three minutes apart still heard it 6 times.
const ASK_EVERY: f64 = 60.0;

/// However short the recording, at least this many samples — otherwise a
/// four-minute one would be judged on four.
const LEAST_ASKED: usize = 16;

/// Are two languages spoken here? Asked *before* an ordinary transcription, so
/// that a bilingual recording is never transcribed twice.
///
/// Until this existed, a recording with detection switched on was transcribed
/// whole in one language, then swept, then transcribed again in two — and the
/// first transcript, minutes of work, was thrown away unread.
///
/// **It is deliberately the cheap version of the listening.** Only the samples
/// are cut out and asked about, not every piece, and there are half as many of
/// them; no voice is described at all. On a recording in one language — which
/// is nearly all of them — that is the whole cost of having the setting on:
/// about four seconds against the forty-nine an ordinary transcription of a
/// forty-seven-minute talk takes. A recording that turns out to be bilingual
/// pays those four seconds twice over, and against its own three minutes that
/// is nothing.
///
/// The second language has to come back from more than one place: a single
/// answer is a name, a quotation, a song. A language spoken in less than about
/// one part in twenty of a recording may go unnoticed, which is the same as it
/// ever was.
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
    let pieces = pieces_of_speech(&samples, rate);
    if pieces.is_empty() {
        return Ok(None);
    }
    let seconds = samples.len() as f64 / f64::from(rate.max(1));
    let mut asked = seeds_of(&pieces, ASK_EVERY);
    if asked.len() < LEAST_ASKED {
        asked = seeds_of(&pieces, (seconds / LEAST_ASKED as f64).max(1.0));
    }
    let folder = working.join("asking");
    let spans: Vec<(f64, f64)> = asked.iter().map(|at| pieces[*at]).collect();
    let names = write_pieces(&folder, &samples, rate, &spans)?;
    let readings = languages_of_files(run, settings, check, &folder, &names, |done| {
        say(
            2 + (6 * done / names.len().max(1)) as u32,
            "second_language.listening",
        );
    })?;
    let _ = std::fs::remove_dir_all(&folder);

    let mut tally: HashMap<String, usize> = HashMap::new();
    for (code, probability) in readings.iter().flatten() {
        if *probability >= CONFIDENT {
            *tally.entry(code.to_ascii_lowercase()).or_default() += 1;
        }
    }
    let mut heard: Vec<(String, usize)> = tally.into_iter().collect();
    heard.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    crate::note!(
        "second language: {} pieces, {} asked, heard {:?}",
        pieces.len(),
        asked.len(),
        heard
    );
    match heard.as_slice() {
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
}

/// What whisper is handed for a turn: the turn, exactly as it is.
///
/// **The padding is already in it.** Every piece is cut with [`PAD`] added at
/// each end so that no first consonant is lost, and a turn is a run of pieces,
/// so its edges carry that margin too. Adding it a second time here was
/// measured and it costs: whisper then writes down a little of the neighbour's
/// speech at each end, in the wrong language, and whichever rule throws that
/// away takes a real sentence with it about once in seven.
pub(crate) fn heard_between(turn: &Spoken, duration: f64) -> (f64, f64) {
    (turn.from.max(0.0), turn.to.min(duration))
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

/// A block that belongs to the turn beside this one rather than to it.
///
/// whisper is handed the turn plus [`PAD`] at each end so that it does not bite
/// off the first consonant, and it writes down whatever it hears in the extra —
/// which at a change of speaker is the neighbour's speech, in the neighbour's
/// language, already transcribed there. A block whose middle falls outside the
/// turn is exactly that: it came back twice, and this is the wrong copy.
///
/// **Nothing inside a block is cut.** Trimming word by word was tried and
/// measured: whisper times the first word of a turn from the start of the audio
/// it was given, which is inside the padding, so the rule threw away the first
/// word of every turn — and with it two of the fourteen sentences the reference
/// recording is scored on. The block is the unit; it goes somewhere whole or
/// not at all.
fn borrowed_from_the_neighbour(segment: &Segment, from: f64, to: f64) -> bool {
    let middle = (segment.start + segment.end) / 2.0;
    middle < from - PAD || middle > to + PAD
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

    say(6, "second_language.listening");
    // Whatever the question before the transcription already heard is handed
    // over rather than listened to again: the pieces, the voices and the first
    // answers are the same ones.
    let mut heard = listen_to_pieces(
        &run,
        settings,
        check,
        &samples,
        rate,
        working,
        &|percent, code| say(percent, code),
    )?;
    heard.describe_the_voices(
        check,
        &samples,
        rate,
        task,
        recording_id,
        &|percent, code| say(percent, code),
    )?;
    let pieces = &heard.pieces;
    stop_if_cancelled(task, recording_id)?;

    /* The recording's own language: what it says, or what the seeds said.
    Only *decided* here — it is written with everything else at the end, so a
    pass that fails leaves the row saying what the stored transcript is in
    rather than what this attempt was going to make it. */
    let said = crate::ai_edit::effective_language(recording);
    let learnt = (said.is_empty() || said == "auto")
        .then(|| own_language_heard(&heard.readings, &second).unwrap_or_else(|| second.clone()));
    let own = learnt.clone().unwrap_or(said);
    if learnt.is_some() {
        crate::note!("second language: the recording's own language read as {own}");
    }
    let spoken_languages: Vec<&str> = if own == second {
        vec![own.as_str()]
    } else {
        vec![own.as_str(), second.as_str()]
    };
    let allowed =
        |code: &str| code.eq_ignore_ascii_case(&own) || code.eq_ignore_ascii_case(&second);

    /* **The voice answers for the pieces whisper was not asked about.** whisper
    takes about eighty milliseconds to say what language a piece is in whatever
    its length, because it runs its whole encoder over a thirty-second window
    every time; the voice model already on the disk answers in a few. So one
    piece in every half minute is asked about, and every other piece takes the
    language of the seeds its voice is most like. Measured over the reference
    recording at this piece length: 261 questions instead of 2 073, and the
    voice agreed with whisper on 98.2 % of the pieces whisper was sure about. */
    let mut readings: Vec<Option<(String, f64)>> = vec![None; pieces.len()];
    let mut how: Vec<&str> = vec!["inherited"; pieces.len()];
    let mut known: Vec<(usize, String)> = Vec::new();
    for (seed, reading) in heard.seeds.iter().zip(&heard.readings) {
        if let Some((code, probability)) = reading {
            if *probability >= CONFIDENT && allowed(code) {
                readings[*seed] = Some((code.to_ascii_lowercase(), *probability));
                how[*seed] = "asked";
                known.push((*seed, code.to_ascii_lowercase()));
            }
        }
    }
    let mut doubtful: Vec<usize> = Vec::new();
    for index in 0..pieces.len() {
        if readings[index].is_some() {
            continue;
        }
        match by_voice(&heard.prints, &known, index) {
            Some(language) => {
                readings[index] = Some((language, 1.0));
                how[index] = "voice";
            }
            None => doubtful.push(index),
        }
    }
    if !doubtful.is_empty() {
        let names: Vec<String> = doubtful.iter().map(|at| heard.names[*at].clone()).collect();
        let more = languages_of_files(&run, settings, check, &heard.folder, &names, |done| {
            say(
                24 + (6 * done / names.len()) as u32,
                "second_language.listening",
            );
        })?;
        for (index, reading) in doubtful.iter().zip(more) {
            if let Some((code, probability)) = reading {
                if probability >= CONFIDENT && allowed(&code) {
                    readings[*index] = Some((code.to_ascii_lowercase(), probability));
                    how[*index] = "asked";
                }
            }
        }
    }
    heard.done_with_the_audio();
    stop_if_cancelled(task, recording_id)?;

    let languages = language_of_each(&readings, &own, &second);
    let turns = turns_of(pieces, &languages);
    crate::note!(
        "second language: {} pieces, {} asked whisper, {} told by the voice, {} turns, {} in {second}",
        pieces.len(),
        how.iter().filter(|h| **h == "asked").count(),
        how.iter().filter(|h| **h == "voice").count(),
        turns.len(),
        turns.iter().filter(|t| t.language == second).count()
    );
    // For measuring the voice's answers against whisper's, piece by piece.
    if let Some(dump) = std::env::var_os("VOLOCAL_LANGUAGE_DUMP") {
        let rows: Vec<String> = pieces
            .iter()
            .zip(&languages)
            .zip(&how)
            .map(|(((from, to), language), how)| format!("{from:.3}	{to:.3}	{language}	{how}"))
            .collect();
        let _ = std::fs::write(
            dump,
            rows.join(
                "
",
            ),
        );
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
            let moved = shifted(block, heard_from, stamp);
            if borrowed_from_the_neighbour(&moved, turn.from, turn.to) {
                continue;
            }
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
                keep_voices_to_one_language(&mut segments);
                bridge_unknown(&mut segments);
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
        /* **The row says what the archive holds, and it is written here or
        not at all.** It used to be put down as `offered` before the work
        started, so a pass that then failed left the archive claiming a
        language its transcript did not have — and, on a recording that was
        already bilingual, stopped showing the language still in it. */
        if learnt.is_some() {
            db::set_language(connection, recording_id, &own)?;
        }
        db::save_second_language(
            connection,
            &db::SecondLanguage {
                recording_id: recording_id.to_string(),
                language: second.clone(),
                share: 0.0,
                state: db::second_language_state::FILLED.to_string(),
                filled_at: None,
            },
        )?;
        // The row above puts the language there; this stamps the moment, which
        // is what `set_second_language_state` is for and where that stamp is
        // written everywhere else.
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
    let _sweepings = Sweepings(working.clone());
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
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------- cutting speech into pieces

    /// A signal at 16 kHz: loud noise where `speech` says, a whisper of it
    /// everywhere else, so the quiet has a floor of its own.
    ///
    /// Noise rather than a tone, and the difference matters now that a dip in
    /// the loudness is what ends a piece: a pure tone's energy wobbles from
    /// frame to frame as the period slides against the frame, which reads as a
    /// dip every second. Speech does not do that, and neither does this.
    fn sound(seconds: f64, speech: &[(f64, f64)]) -> Vec<i16> {
        let rate = 16_000.0;
        let mut seed = 1_u32;
        (0..(seconds * rate) as usize)
            .map(|n| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                let noise = ((seed >> 16) & 0x7fff) as f64 / 32_768.0 - 0.5;
                let t = n as f64 / rate;
                let loud = speech.iter().any(|(from, to)| t >= *from && t < *to);
                if loud {
                    (12_000.0 * noise) as i16
                } else {
                    (12.0 * noise) as i16
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

    /// **The rule this replaced said a tenth of a second was a breath inside
    /// one person's speech.** It is not: between the interpreter and the
    /// person she follows the loudness dips for 0.10 to 0.20 seconds and never
    /// reaches the noise floor, and a piece that runs across such a dip holds
    /// both of them. Both lengths of quiet end a piece now.
    #[test]
    fn a_dip_of_a_tenth_of_a_second_ends_a_piece_as_surely_as_a_pause() {
        let apart = pieces_of_speech(&sound(6.0, &[(1.0, 2.5), (3.0, 4.5)]), 16_000);
        assert_eq!(apart.len(), 2, "{apart:?}");
        let close = pieces_of_speech(&sound(6.0, &[(1.0, 2.5), (2.6, 4.0)]), 16_000);
        assert_eq!(close.len(), 2, "{close:?}");
        // The boundary sits in the dip, not at an arbitrary length.
        assert!(
            (close[0].1 - close[1].0 - 2.0 * PAD).abs() < 0.1,
            "{close:?}"
        );
        assert!(close[1].0 > 2.3 && close[1].0 < 2.8, "{close:?}");
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

    /// A click a long way from any speech is nothing and is dropped. A
    /// syllable close behind speech is kept — as its own piece now, since the
    /// dip in front of it may be where the speech changed hands; it is joined
    /// back on afterwards if it turns out to be the same language.
    #[test]
    fn a_distant_click_is_dropped_and_a_close_syllable_is_kept() {
        let alone = pieces_of_speech(&sound(12.0, &[(1.0, 3.0), (10.0, 10.2)]), 16_000);
        assert_eq!(alone.len(), 1, "{alone:?}");
        let close = pieces_of_speech(&sound(6.0, &[(1.0, 3.0), (3.3, 3.5)]), 16_000);
        assert!(near(close[close.len() - 1].1, 3.5 + PAD), "{close:?}");
    }

    // ------------------------------------------------------- the measuring bench

    /// **Not a test: a way to get the real numbers out of a real recording.**
    ///
    /// The thresholds a handover is found by cannot be reasoned out — they are
    /// properties of one voice model on one kind of recording, and the only
    /// honest place to get them is a recording where the answer is known. This
    /// writes one row per window: the moment, and the voiceprint heard there.
    /// Everything else — how far apart to listen, how many neighbours to
    /// average, where to put the line — is then swept over that file without
    /// running the model again.
    ///
    /// Ignored, because it needs an audio file and a model that are not in the
    /// repository. To run it:
    ///
    /// ```text
    /// VOLOCAL_MEASURE_WAV=... VOLOCAL_MEASURE_MODEL=... VOLOCAL_MEASURE_OUT=...
    /// cargo test --release -- --ignored measure_voices --nocapture
    /// ```
    #[test]
    #[ignore]
    fn measure_voices_along_a_real_recording() {
        let spans_file = std::env::var("VOLOCAL_MEASURE_SPANS").ok();
        let (Ok(wav), Ok(model), Ok(out)) = (
            std::env::var("VOLOCAL_MEASURE_WAV"),
            std::env::var("VOLOCAL_MEASURE_MODEL"),
            std::env::var("VOLOCAL_MEASURE_OUT"),
        ) else {
            println!("nothing to measure: set VOLOCAL_MEASURE_WAV, _MODEL and _OUT");
            return;
        };
        let (samples, rate) = read_pcm16(Path::new(&wav)).expect("the audio reads");
        let regions = pieces_of_speech(&samples, rate);
        println!("{} stretches of speech", regions.len());

        // Finer than the pass listens, so the sweep can thin it out afterwards.
        const BENCH_EVERY: f64 = 0.2;
        let half = crate::voiceprint::WINDOW / 2.0;
        let mut times: Vec<f64> = Vec::new();
        let mut spans: Vec<(f64, f64)> = Vec::new();
        // Given a file of spans, describe exactly those instead of walking.
        if let Some(file) = spans_file {
            for row in std::fs::read_to_string(&file)
                .expect("the spans read")
                .lines()
            {
                let mut parts = row.split('\t');
                let (Some(from), Some(to)) = (parts.next(), parts.next()) else {
                    continue;
                };
                let (from, to) = (from.parse().unwrap(), to.parse().unwrap());
                times.push((from + to) / 2.0);
                spans.push((from, to));
            }
        }
        let walk_them = spans.is_empty();
        for (from, to) in regions.iter().filter(|_| walk_them) {
            if to - from < crate::voiceprint::SHORTEST {
                continue;
            }
            let reach = half.min((to - from) / 2.0);
            let mut at = from + reach;
            let last = to - reach;
            loop {
                times.push(at);
                spans.push((at - half, at + half));
                if at >= last - 1e-9 {
                    break;
                }
                at = (at + BENCH_EVERY).min(last);
            }
        }
        println!("{} windows", spans.len());

        let check = tools::ToolCheck {
            embedding_model: Some(model),
            ..Default::default()
        };
        let task = TranscriptionTask::default();
        let started = std::time::Instant::now();
        let prints = voiceprints_of(&check, &samples, rate, &spans, &task, "measure", |done| {
            if done % 2000 == 0 {
                println!("  {done} of {}", spans.len());
            }
        })
        .expect("the voices are described");
        println!("described in {:.0} s", started.elapsed().as_secs_f64());

        let mut rows: Vec<String> = Vec::with_capacity(prints.len());
        for ((at, (from, to)), print) in times.iter().zip(&spans).zip(&prints) {
            let Some(print) = print else { continue };
            let values: Vec<String> = print.iter().map(|v| format!("{v:.4}")).collect();
            rows.push(format!("{at:.3}	{from:.3}	{to:.3}	{}", values.join(",")));
        }
        println!("{} windows described", rows.len());
        std::fs::write(
            &out,
            rows.join(
                "
",
            ),
        )
        .expect("the measurements are written");

        let stretches: Vec<String> = regions
            .iter()
            .map(|(from, to)| format!("{from:.3}	{to:.3}"))
            .collect();
        std::fs::write(
            format!("{out}.regions"),
            stretches.join(
                "
",
            ),
        )
        .expect("written");
    }

    /// **The whole pass, run by the real functions, over a real recording.**
    ///
    /// The Python harness beside this measured the design; this measures the
    /// code. Everything between the audio and the text is the shipping path —
    /// the pieces, the voiceprints, the seeds, the questions, the turns, the
    /// transcription and the rules about what to keep. Only the database and
    /// the progress reporting are missing, and neither decides a word.
    ///
    /// ```text
    /// VOLOCAL_PASS_WAV=... VOLOCAL_PASS_MODEL=... VOLOCAL_PASS_WHISPER=...
    /// VOLOCAL_PASS_VOICES=... VOLOCAL_PASS_OUT=... VOLOCAL_PASS_SECOND=en
    /// cargo test --release -- --ignored measure_the_whole_pass --nocapture
    /// ```
    #[test]
    #[ignore]
    fn measure_the_whole_pass() {
        let (Ok(wav), Ok(model), Ok(whisper), Ok(voices), Ok(out)) = (
            std::env::var("VOLOCAL_PASS_WAV"),
            std::env::var("VOLOCAL_PASS_MODEL"),
            std::env::var("VOLOCAL_PASS_WHISPER"),
            std::env::var("VOLOCAL_PASS_VOICES"),
            std::env::var("VOLOCAL_PASS_OUT"),
        ) else {
            println!("nothing to measure");
            return;
        };
        let own = std::env::var("VOLOCAL_PASS_OWN").unwrap_or_else(|_| "cs".into());
        let second = std::env::var("VOLOCAL_PASS_SECOND").unwrap_or_else(|_| "en".into());
        let mut settings = Settings::default();
        if let Ok(beam) = std::env::var("VOLOCAL_PASS_BEAM") {
            settings.beam = beam.parse().unwrap_or(settings.beam);
        }
        let check = tools::ToolCheck {
            whisper_cli: Some(whisper.clone()),
            model_whisper: Some(model),
            embedding_model: Some(voices),
            ..Default::default()
        };
        let task = TranscriptionTask::default();
        let working = std::env::temp_dir().join("volocal-whole-pass");
        let _ = std::fs::remove_dir_all(&working);
        std::fs::create_dir_all(&working).unwrap();

        let (samples, rate) = read_pcm16(Path::new(&wav)).expect("the audio reads");
        let started = std::time::Instant::now();
        let pieces = pieces_of_speech(&samples, rate);
        println!(
            "{} pieces, cut in {:.1} s",
            pieces.len(),
            started.elapsed().as_secs_f64()
        );

        // What the question before a transcription costs: these samples cut
        // out and asked about, and nothing else.
        let question = std::time::Instant::now();
        let mut asked = seeds_of(&pieces, ASK_EVERY);
        if asked.len() < LEAST_ASKED {
            let seconds = samples.len() as f64 / f64::from(rate.max(1));
            asked = seeds_of(&pieces, (seconds / LEAST_ASKED as f64).max(1.0));
        }
        let asking = working.join("asking");
        let spans: Vec<(f64, f64)> = asked.iter().map(|at| pieces[*at]).collect();
        let sample_names = write_pieces(&asking, &samples, rate, &spans).unwrap();

        let folder = working.join("pieces");
        let names = write_pieces(&folder, &samples, rate, &pieces).unwrap();

        let program = Path::new(&whisper);
        let available = program_help(program);
        let ask = |folder: &Path, names: &[String]| -> Vec<Option<(String, f64)>> {
            let mut heard: HashMap<String, (String, f64)> = HashMap::new();
            for batch in names.chunks(MOST_FILES_AT_ONCE) {
                let mut cmd = files_command(
                    program,
                    &settings,
                    &check,
                    &Over::Languages,
                    batch,
                    &available,
                );
                cmd.current_dir(folder);
                let out = cmd.output().expect("whisper runs");
                let log = format!(
                    "{}{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
                for (name, code, probability) in languages_reported(&log) {
                    heard.insert(name, (code, probability));
                }
            }
            names.iter().map(|n| heard.get(n).cloned()).collect()
        };

        let _ = ask(&asking, &sample_names);
        println!(
            "the question before a transcription: {} samples, {:.1} s",
            sample_names.len(),
            question.elapsed().as_secs_f64()
        );
        let _ = std::fs::remove_dir_all(&asking);

        let described = std::time::Instant::now();
        let prints =
            voiceprints_of(&check, &samples, rate, &pieces, &task, "measure", |_| {}).unwrap();
        println!(
            "voices described in {:.0} s",
            described.elapsed().as_secs_f64()
        );

        let seeds = seeds_of(&pieces, SEED_EVERY);
        let seed_names: Vec<String> = seeds.iter().map(|at| names[*at].clone()).collect();
        let seed_readings = ask(&folder, &seed_names);
        let allowed =
            |code: &str| code.eq_ignore_ascii_case(&own) || code.eq_ignore_ascii_case(&second);
        let mut readings: Vec<Option<(String, f64)>> = vec![None; pieces.len()];
        let mut known: Vec<(usize, String)> = Vec::new();
        for (seed, reading) in seeds.iter().zip(&seed_readings) {
            if let Some((code, probability)) = reading {
                if *probability >= CONFIDENT && allowed(code) {
                    readings[*seed] = Some((code.to_ascii_lowercase(), *probability));
                    known.push((*seed, code.to_ascii_lowercase()));
                }
            }
        }
        let mut doubtful = Vec::new();
        let mut by_the_voice = 0;
        for (index, reading) in readings.iter_mut().enumerate() {
            if reading.is_some() {
                continue;
            }
            match by_voice(&prints, &known, index) {
                Some(language) => {
                    *reading = Some((language, 1.0));
                    by_the_voice += 1;
                }
                None => doubtful.push(index),
            }
        }
        if !doubtful.is_empty() {
            let more: Vec<String> = doubtful.iter().map(|at| names[*at].clone()).collect();
            for (index, reading) in doubtful.iter().zip(ask(&folder, &more)) {
                if let Some((code, probability)) = reading {
                    if probability >= CONFIDENT && allowed(&code) {
                        readings[*index] = Some((code.to_ascii_lowercase(), probability));
                    }
                }
            }
        }
        println!(
            "{} asked, {by_the_voice} told by the voice, {:.0} s so far",
            seeds.len() + doubtful.len(),
            started.elapsed().as_secs_f64()
        );

        let languages = language_of_each(&readings, &own, &second);
        let turns = turns_of(&pieces, &languages);
        let duration = samples.len() as f64 / f64::from(rate);
        let turns_folder = working.join("turns");
        let spans: Vec<(f64, f64)> = turns.iter().map(|t| heard_between(t, duration)).collect();
        let turn_names = write_pieces(&turns_folder, &samples, rate, &spans).unwrap();
        println!("{} turns", turns.len());

        for language in [own.as_str(), second.as_str()] {
            let mine: Vec<String> = turns
                .iter()
                .zip(&turn_names)
                .filter(|(turn, _)| turn.language == language)
                .map(|(_, name)| name.clone())
                .collect();
            if mine.is_empty() {
                continue;
            }
            for batch in mine.chunks(MOST_FILES_AT_ONCE) {
                let over = Over::Transcript { language };
                let mut cmd = files_command(program, &settings, &check, &over, batch, &available);
                cmd.current_dir(&turns_folder);
                cmd.output().expect("whisper runs");
            }
            println!("  {language}: {} turns", mine.len());
        }

        let mut rows: Vec<(f64, String, String)> = Vec::new();
        for (turn, name) in turns.iter().zip(&turn_names) {
            let file = turns_folder.join(format!("{name}.json"));
            let blocks = load_segments_from_json(&file, "measure").unwrap_or_default();
            let stamp = (turn.language != own).then_some(turn.language.as_str());
            let (heard_from, _) = heard_between(turn, duration);
            for block in blocks {
                if sounds_like_nothing(&block.text) {
                    continue;
                }
                let moved = shifted(block, heard_from, stamp);
                if borrowed_from_the_neighbour(&moved, turn.from, turn.to) {
                    continue;
                }
                rows.push((moved.start, turn.language.clone(), moved.text));
            }
        }
        rows.sort_by(|left, right| left.0.total_cmp(&right.0));
        println!(
            "{} blocks, {} in {second}, whole pass {:.0} s",
            rows.len(),
            rows.iter().filter(|r| r.1 == second).count(),
            started.elapsed().as_secs_f64()
        );
        let text: Vec<String> = rows
            .iter()
            .map(|(at, language, text)| {
                format!(
                    "{:02}:{:02} [{language}] {text}",
                    *at as u64 / 60,
                    *at as u64 % 60
                )
            })
            .collect();
        std::fs::write(&out, text.join("\n")).expect("written");
        let _ = std::fs::remove_dir_all(&working);
    }

    // ------------------------------------ a block that came back twice

    fn spoken(start: f64, end: f64, text: &str) -> Segment {
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
            words: None,
            original: None,
            language: None,
        }
    }

    /// **The measured mistake this rule replaced.** whisper times the first
    /// word of a turn from the start of the audio it was given, so a rule that
    /// dropped words starting before the turn threw away the first word of
    /// every turn — and two of the fourteen sentences the reference recording
    /// is scored on with them. A block is kept or dropped whole.
    #[test]
    fn a_block_starting_at_the_very_edge_is_still_this_turns_own() {
        let block = spoken(99.98, 103.0, "We have three children.");
        assert!(!borrowed_from_the_neighbour(&block, 100.0, 104.0));
    }

    /// A block whose middle is past the turn came back from the neighbour's
    /// run as well, and that copy is the one in the right language.
    #[test]
    fn a_block_beyond_the_turn_belongs_to_the_neighbour() {
        let after = spoken(104.4, 105.4, "Two boys, one girl.");
        assert!(borrowed_from_the_neighbour(&after, 100.0, 104.0));
        let before = spoken(98.0, 99.4, "Je nám stejně let.");
        assert!(borrowed_from_the_neighbour(&before, 100.0, 104.0));
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
