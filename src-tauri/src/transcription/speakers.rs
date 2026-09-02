//! Who is speaking: voiceprints, grouping them, and giving every word an owner.
//!
//! One stage of the pipeline, lifted out of transcription.rs unchanged when
//! that file had grown to 3 626 lines. Its tests came with it.

use super::*;

// -------------------------------------------------------------- diarisation

pub(crate) struct SpeakerTurn {
    start: f64,
    end: f64,
    key: String,
}

/// How much of this stage's band the log-mel arithmetic takes.
///
/// Measured in a release build over 256 windows: **760 ms of features against
/// 94 ms of model**, so the features are 89 % of the two. Debug says 98.9 %,
/// which is the same finding through an unoptimised FFT and is not the number
/// to set anything from — the model is a native library either way and does not
/// slow down with the profile.
///
/// **It used to be 0.3, and it was not wrong when it was written.** The model
/// then ran on the processor, where it was the expensive half by far. Once the
/// graphics card took it — 13.7x, [`crate::voiceprint`] — the two swapped
/// places and nobody moved the number, so the features had 30 % of the bar for
/// 89 % of the work. That is what a reader saw as a bar that stood still at 10
/// and then jumped to 34.
const FEATURES_SHARE: f64 = 0.85;

/// Where the clustering begins, once the voiceprints are in hand. The gap
/// between this and [`FEATURES_SHARE`] is the model's, and it is small because
/// the model is fast now.
const GROUPING_STARTS_AT: f64 = 0.97;

// The order the three stages report in. Checked here rather than in a test,
// because they are constants: a test asserting a relation between two of them
// is decided at compile time anyway, and this way it fails the build instead of
// a run.
const _: () = assert!(FEATURES_SHARE > 0.0, "the features get a share of the bar");
const _: () = assert!(
    FEATURES_SHARE < GROUPING_STARTS_AT,
    "the model runs after the features and before the grouping"
);
const _: () = assert!(GROUPING_STARTS_AT < 1.0, "the grouping gets a share too");

/// How far through this stage's band the bar stands, `done` windows into the
/// features. A function rather than a line inside the loop so that the test
/// below exercises the arithmetic the loop actually uses.
fn features_progress(done: usize, total: usize) -> f64 {
    FEATURES_SHARE * done as f64 / total.max(1) as f64
}

/// How many windows to do between reports: about fifty over the loop, whatever
/// the recording's length. Never zero, because the loop takes `index % this`
/// and a remainder by zero is a panic rather than a wrong number.
fn report_every(total: usize) -> usize {
    (total / 50).max(1)
}

/// One voice, when the reader has said there is one — and no listening at all.
///
/// Everything below this used to run anyway: a mel window for every second of
/// the recording, then the model over each of them, minutes of work to reach
/// the answer that was given before it started. All it produced was one label
/// on every block, which is what a single turn over the whole transcript says
/// in one line.
///
/// It also means a recording with one speaker needs no speaker model at all —
/// see the two callers, which stop asking for one when the answer is one.
///
/// `None` when the reader did not say one, which is every other case.
/// Asked for on 2026-09-02: *dává to smysl?* It did as an answer, and did not
/// as a price.
pub(crate) fn one_voice_throughout(
    settings: &Settings,
    segments: &[Segment],
) -> Option<Vec<SpeakerTurn>> {
    if settings.speaker_count != 1 {
        return None;
    }
    let last = segments.iter().map(|s| s.end).fold(0.0_f64, f64::max);
    if last <= 0.0 {
        return Some(Vec::new());
    }
    // From nothing to the end of the transcript, so no block falls outside it —
    // not even one whose words start before its own beginning.
    Some(vec![SpeakerTurn {
        start: 0.0,
        end: last,
        key: "speaker_0".to_string(),
    }])
}

/// Who speaks when, computed here rather than by a downloaded program.
///
/// Until today this spawned `sherpa-onnx-offline-speaker-diarization.exe`,
/// which ran two models: pyannote to find where speech is, and CAM++ to say
/// whose it is. The first was redundant — Whisper has already timestamped every
/// word, so the blocks *are* the speech — and it is where most of the 95
/// seconds a ten-minute recording used to cost actually went.
///
/// What is left is the second model, in this process and in batches, measured
/// 8.9x faster on the graphics card than on the processor — read that number
/// with [`crate::voiceprint::LEAST_FRAMES_THE_CARD_WILL_RUN`] beside it, since
/// the card was in fact refusing every batch from then until 13 August, and the
/// same comparison run once it stopped says 13.7x. And it hands back
/// the voiceprints themselves, which the executable never could: its stdout was
/// cluster labels and nothing else. That is what the sidebar needs to let
/// somebody name two voices and have the rest assigned by similarity.
///
/// `report` is the app handle, the recording id, and the percentage band this
/// stage occupies.
///
/// How that band is divided is measured rather than assumed, and it was wrong
/// until 13 August: see [`FEATURES_SHARE`].
pub(crate) fn diarize(
    settings: &Settings,
    check: &tools::ToolCheck,
    wav: &Path,
    segments: &[Segment],
    task: &TranscriptionTask,
    recording_id: &str,
    report: Option<(&AppHandle, &str, f64, f64)>,
) -> Reported<Vec<SpeakerTurn>> {
    if let Some(alone) = one_voice_throughout(settings, segments) {
        return Ok(alone);
    }

    let model = check
        .embedding_model
        .as_ref()
        .ok_or_else(|| UserMessage::new("tools.embedding_model_missing"))?;

    let blocks: Vec<(f64, f64)> = segments.iter().map(|s| (s.start, s.end)).collect();
    let windows = crate::voiceprint::windows(&blocks);
    if windows.is_empty() {
        return Ok(Vec::new());
    }

    let Some((samples, rate)) = read_pcm16(wav) else {
        return Err(UserMessage::new("diarization.audio_unreadable"));
    };

    let say = |done: f64| {
        if let Some((app, id, from, to)) = report {
            let overall = (from + (to - from) * done).round() as u32;
            status(app, id, "diarization", overall, step("diarization.running"));
        }
    };

    // Features first. They used to be described here as the cheap half, and
    // that was true while the model ran on the processor. It stopped being true
    // when the graphics card started doing the work: measured in release over
    // 256 windows, 760 ms of arithmetic against 94 ms of model.
    //
    // So this loop is where a recording now spends nearly all of its
    // diarization, and until this change it reported nothing at all while doing
    // it — the bar stood at 10 for as long as the whole stage took, then moved
    // to 34 and finished almost at once. What was reported as a slow start was
    // the only part that was ever slow.
    say(0.0);
    let mut heard = Vec::with_capacity(windows.len());
    let mut kept = Vec::with_capacity(windows.len());
    // Often enough to look alive on a short recording and not so often on a
    // long one that the window spends its time redrawing: about fifty reports,
    // whatever the length.
    let report_every = report_every(windows.len());
    for (index, window) in windows.iter().enumerate() {
        // Cancellation cannot land mid-window, so it is checked between them
        // rather than on every one of a thousand.
        if index % 200 == 0 {
            stop_if_cancelled(task, recording_id)?;
        }
        if index % report_every == 0 {
            say(features_progress(index, windows.len()));
        }
        let (from, to) = crate::voiceprint::enough_audio(
            window.start,
            window.end,
            f64::from(rate),
            samples.len(),
        );
        if to <= from {
            continue;
        }
        let piece: Vec<f32> = samples[from..to]
            .iter()
            .map(|value| f32::from(*value) / 32768.0)
            .collect();
        if let Some(features) = crate::voiceprint::features(&piece) {
            heard.push(features);
            kept.push(*window);
        }
    }
    if heard.is_empty() {
        return Ok(Vec::new());
    }

    say(FEATURES_SHARE);
    stop_if_cancelled(task, recording_id)?;
    // The reason goes three places on purpose. It is in the message the reader
    // sees, because "could not be started" without a why is not a report; it is
    // in `volocal-log.txt`, because a notice that has already gone cannot be
    // asked about; and `{model}` is in there because the path is the first
    // thing that is ever wrong.
    let prints = describe_in_batches(model, &heard, task, recording_id)?;

    say(GROUPING_STARTS_AT);
    stop_if_cancelled(task, recording_id)?;
    // A count somebody actually said is worth more than any threshold: told it,
    // this is measurably reliable; left to guess, it is the weakest part of the
    // whole feature.
    let wanted = if settings.speaker_count > 0 {
        Some(settings.speaker_count as usize)
    } else {
        None
    };
    let labels = crate::voiceprint::group(&prints, wanted);

    Ok(crate::voiceprint::turns(&kept, &labels)
        .into_iter()
        .map(|turn| SpeakerTurn {
            start: turn.start,
            end: turn.end,
            key: format!("speaker_{}", turn.voice),
        })
        .collect())
}

/// How many windows go to the model between two chances to give up.
///
/// `Voices::embed` walks its own batches inside, and on a long recording that
/// is the better part of a minute with nothing watching — `Zrušit` was
/// answered only once it had finished. Two hundred and fifty-six windows is
/// about a second of work on the card.
const BETWEEN_GLANCES: usize = 256;

/// Describes voices in batches, looking up between them to see whether the
/// reader has given up on the whole thing.
fn describe_in_batches(
    model: &str,
    heard: &[crate::voiceprint::Features],
    task: &TranscriptionTask,
    recording_id: &str,
) -> Reported<Vec<Vec<f32>>> {
    let mut voices = crate::voiceprint::Voices::open(Path::new(model)).map_err(|error| {
        crate::note!("speaker model {model} did not open: {error:#}");
        UserMessage::new("diarization.launch_failed").detail(format!("{error:#}"))
    })?;
    let mut prints = Vec::with_capacity(heard.len());
    for batch in heard.chunks(BETWEEN_GLANCES) {
        stop_if_cancelled(task, recording_id)?;
        let described = voices.embed(batch).map_err(|error| {
            let count = batch.len();
            crate::note!("speaker model {model} failed on {count} windows: {error:#}");
            UserMessage::new("diarization.launch_failed").detail(format!("{error:#}"))
        })?;
        prints.extend(described);
    }
    Ok(prints)
}

/// One voiceprint for each span of speech, from the two seconds at its middle.
///
/// For the multilingual pass, which asks the voice which language a piece is
/// in — see `languages::by_voice`. One window a span rather than the
/// overlapping walk [`diarize`] does: a piece is a few seconds, and one answer
/// for it is all that is asked. A span too short to describe a voice from is
/// answered with nothing, and so is every span when the speaker model is not
/// installed or will not open; the caller then asks whisper instead, which is
/// slower and never wrong for want of a model.
///
/// `progress` is told how many spans have been described so far, every so
/// often: the arithmetic is the slow half in a debug build.
pub(crate) fn voiceprints_of(
    check: &tools::ToolCheck,
    samples: &[i16],
    rate: u32,
    spans: &[(f64, f64)],
    task: &TranscriptionTask,
    recording_id: &str,
    mut progress: impl FnMut(usize),
) -> Reported<Vec<Option<Vec<f32>>>> {
    let mut prints: Vec<Option<Vec<f32>>> = vec![None; spans.len()];
    let Some(model) = check.embedding_model.as_ref() else {
        return Ok(prints);
    };
    let mut heard = Vec::new();
    let mut owners = Vec::new();
    for (index, (from, to)) in spans.iter().enumerate() {
        if index % 200 == 0 {
            stop_if_cancelled(task, recording_id)?;
            progress(index);
        }
        if to - from < crate::voiceprint::SHORTEST {
            continue;
        }
        /* **Only this piece's own audio, and silence for the rest.**
        `enough_audio` grows a short window by reaching into the recording
        around it, which is right for diarization — a block's neighbours are
        usually the same person still talking. Here they are usually not: a
        piece is one turn of an interpreted conversation, and the audio on
        either side of it is the other speaker. A piece shorter than the model's
        window was being described by a blend of both, and the median piece is
        1.5 seconds against a window of 2. So the piece is centred in a window
        of silence instead, and what comes back describes only what is in it. */
        let first = ((from * f64::from(rate)) as usize).min(samples.len());
        let last = ((to * f64::from(rate)) as usize).min(samples.len());
        if last <= first {
            continue;
        }
        let needed = crate::voiceprint::window_samples(f64::from(rate));
        let mut piece: Vec<f32> = vec![0.0; needed.max(last - first)];
        let at = (piece.len() - (last - first)) / 2;
        for (slot, value) in piece[at..].iter_mut().zip(&samples[first..last]) {
            *slot = f32::from(*value) / 32768.0;
        }
        if let Some(features) = crate::voiceprint::features(&piece) {
            heard.push(features);
            owners.push(index);
        }
    }
    if heard.is_empty() {
        return Ok(prints);
    }
    match describe_in_batches(model, &heard, task, recording_id) {
        Ok(described) => {
            for (owner, print) in owners.into_iter().zip(described) {
                prints[owner] = Some(print);
            }
        }
        Err(error) if error.code == "transcription.cancelled" => return Err(error),
        Err(error) => {
            crate::note!("speaker model {model} did not describe the pieces: {error}");
        }
    }
    Ok(prints)
}

/// How much speech inside one sentence has to belong to the second speaker for
/// the change to count as a real handover rather than an inexact boundary.
///
/// Both conditions hold at once. The word count alone is not enough: three
/// short words are half a second, which is no handover at all. And the length
/// alone is not enough either, because a single word before a long pause can
/// last a second and a half.
///
/// Note that this applies only *inside* a sentence. A one-word acknowledgement
/// in a conversation or a phone call — "mhm", "jasně" — comes back from Whisper
/// as a passage of its own, and never travels this path: anything shorter than
/// two words is given its speaker by plain overlap and nothing swallows it.
pub(crate) const MIN_TURN_SECONDS: f64 = 1.4;
pub(crate) const MIN_TURN_WORDS: usize = 3;

/// How far a speaker boundary may move, in words, to land on punctuation.
///
/// Sherpa returns a time and Whisper returns words, and both boundaries are
/// inexact by tenths of a second — which is one or two words. If a sentence is
/// going to be split, let it split where a clause ends anyway.
pub(crate) const PUNCTUATION_SNAP: usize = 2;

/// The unbroken runs of one speaker's words, as pairs of first and last index.
pub(crate) fn speaker_runs(speakers: &[Option<String>]) -> Vec<(usize, usize)> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut i = 0usize;
    while i < speakers.len() {
        let mut j = i;
        while j + 1 < speakers.len() && speakers[j + 1] == speakers[i] {
            j += 1;
        }
        runs.push((i, j));
        i = j + 1;
    }
    runs
}

/// Does the word end with a mark that closes a sentence or a clause?
pub(crate) fn ends_clause(word: &str) -> bool {
    word.trim_end()
        .chars()
        .last()
        .map(|c| matches!(c, ',' | '.' | '!' | '?' | '…' | ';' | ':'))
        .unwrap_or(false)
}

/// A speaker's place in the order, by the number in their key.
///
/// Sorting as text gives `speaker_1, speaker_10, speaker_2`, so "Mluvčí 2" in
/// the transcript would in fact be the tenth. Splitting by words adds speakers,
/// so this stopped being theoretical.
pub(crate) fn order_key(key: &str) -> (i64, String) {
    let number = key
        .rsplit(|z: char| !z.is_ascii_digit())
        .next()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(i64::MAX);
    (number, key.to_string())
}

/// The speaker a given stretch of time overlaps most.
pub(crate) fn speaker_for(start: f64, end: f64, turns: &[SpeakerTurn]) -> Option<String> {
    let mut best: Option<(&str, f64)> = None;
    for u in turns {
        let overlap = (end.min(u.end) - start.max(u.start)).max(0.0);
        if overlap > 0.0 && best.map(|(_, p)| overlap > p).unwrap_or(true) {
            best = Some((&u.key, overlap));
        }
    }
    best.map(|(k, _)| k.to_string())
}

/// Assigns speakers to transcript segments — per word, not per whole sentence.
///
/// A whole sentence used to get one speaker, whoever it overlapped most. In a
/// sentence someone cuts into halfway through, that credited the second half
/// to the first speaker. Whisper gives us a time for every word, though, so
/// the speaker can be decided word by word and the sentence cut exactly where
/// the speech changes hands.
///
/// Returns a new list — there may be more segments than before.
/// Longest gap this will bridge. A block goes unidentified because it is too
/// short to ask the model about — under 0.8 s, in the recording this was
/// measured on — so anything appreciably longer is unidentified for some other
/// reason and is not ours to fill in.
pub(crate) const BRIDGE_LONGEST: f64 = 2.0;

/// A short block nobody could identify, with the same voice on both sides of
/// it, belongs to that voice.
///
/// It is not a guess. "Yeah." and "Okay." are a third of a second, which is far
/// too little to recognise anybody from, so the model is never asked about
/// them — 34 of 371 blocks in the interview this was written for. Of those 34,
/// **25 sat between two blocks of one person**: Damon before, Damon after, a
/// third of a second in between. The remaining 9 lay between two different
/// people and are left alone, because there it really is not known.
///
/// It also settles the repeated name in exports. A block with no speaker used
/// to break the turn, so a label was printed again on the other side of every
/// "Yeah." — and it was exactly those 25 that caused it.
pub(crate) fn bridge_unknown(segments: &mut [Segment]) -> usize {
    let mut filled = 0;
    let mut at = 0;
    while at < segments.len() {
        if segments[at].speakers.is_some() {
            at += 1;
            continue;
        }
        let mut end = at;
        while end < segments.len() && segments[end].speakers.is_none() {
            end += 1;
        }
        // Both sides must exist and agree. A run at either edge of the
        // recording has only one neighbour and stays as it is.
        let before = at.checked_sub(1).and_then(|i| segments[i].speakers.clone());
        let after = segments.get(end).and_then(|s| s.speakers.clone());
        let bridged = match (before, after) {
            (Some(a), Some(b)) if a == b => Some(a),
            _ => None,
        };
        if let Some(voice) = bridged {
            let long = segments[at..end]
                .iter()
                .any(|s| s.end - s.start > BRIDGE_LONGEST);
            if !long {
                for segment in &mut segments[at..end] {
                    segment.speakers = Some(voice.clone());
                    filled += 1;
                }
            }
        }
        at = end.max(at + 1);
    }
    filled
}

/// After the voices are assigned: a block does not belong to a voice that
/// speaks another language.
///
/// **On an interpreted recording the language *is* the speaker.** The voice
/// model listens to sound alone, and where the interpreter starts over the
/// guest's last words its windows hold both of them — so an English line was
/// credited to *Překladatelka* and a Czech one to *Paul*, sitting one under
/// the other. The transcript knows something the model does not: which
/// language each block is in. Every voice is given the language most of its
/// blocks are in, and a block in another language moves to the nearest voice
/// in time that speaks it. A voice with no counterpart — one language, or a
/// transcript nobody filled — is left exactly as it was.
///
/// The recording's own language is `None` on a block, and it is a language
/// like any other here: the interpreter's Czech and the guest's English are
/// two values, and that is all the rule needs.
pub(crate) fn keep_voices_to_one_language(segments: &mut [Segment]) -> usize {
    let mut by_voice: HashMap<String, HashMap<Option<String>, usize>> = HashMap::new();
    for s in segments.iter() {
        if let Some(voice) = &s.speakers {
            *by_voice
                .entry(voice.clone())
                .or_default()
                .entry(s.language.clone())
                .or_default() += 1;
        }
    }
    let speaks: HashMap<String, Option<String>> = by_voice
        .into_iter()
        .map(|(voice, counts)| {
            let language = counts
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                .map(|(language, _)| language)
                .unwrap_or(None);
            (voice, language)
        })
        .collect();
    if speaks.values().collect::<HashSet<_>>().len() < 2 {
        return 0;
    }

    let placed: Vec<(f64, String, Option<String>)> = segments
        .iter()
        .filter_map(|s| {
            s.speakers.clone().map(|voice| {
                (
                    s.start,
                    voice.clone(),
                    speaks.get(&voice).cloned().flatten(),
                )
            })
        })
        .collect();
    let mut moved = 0;
    for s in segments.iter_mut() {
        match s.speakers.clone() {
            /* **A block nobody could be recognised in still says who spoke
            it.** Under 0.8 seconds there is too little voice to ask the model
            about, so a short remark comes back with no speaker at all — 17 of
            1 005 blocks on the reference recording, and every one of them made
            the export print a name twice. On a recording in two languages the
            language answers it: *Yeah.* is English, and only one person here
            speaks English. */
            None => {
                let nearest = placed
                    .iter()
                    .filter(|(_, _, language)| *language == s.language)
                    .min_by(|a, b| (a.0 - s.start).abs().total_cmp(&(b.0 - s.start).abs()))
                    .map(|(_, voice, _)| voice.clone());
                if let Some(voice) = nearest {
                    s.speakers = Some(voice);
                    moved += 1;
                }
            }
            Some(voice) => {
                if speaks.get(&voice) == Some(&s.language) {
                    continue;
                }
                let nearest = placed
                    .iter()
                    .filter(|(_, other, language)| *other != voice && *language == s.language)
                    .min_by(|a, b| (a.0 - s.start).abs().total_cmp(&(b.0 - s.start).abs()))
                    .map(|(_, other, _)| other.clone());
                if let Some(other) = nearest {
                    s.speakers = Some(other);
                    moved += 1;
                }
            }
        }
    }
    moved
}

pub(crate) fn assign_speakers(segments: Vec<Segment>, turns: &[SpeakerTurn]) -> Vec<Segment> {
    let mut output: Vec<Segment> = Vec::with_capacity(segments.len());

    for mut s in segments {
        // Without word timings, only the original per-sentence guess is left.
        let words: Vec<serde_json::Value> = s
            .words
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        if words.len() < 2 {
            s.speakers = speaker_for(s.start, s.end, turns);
            output.push(s);
            continue;
        }

        // Copy the sentence bounds out as plain numbers. Were the closures to
        // read them off `s`, they would hold a borrow on it and the segment
        // could then be neither modified nor moved into the result.
        let sentence_from = s.start;
        let sentence_to = s.end;
        let text_words = |i: usize| words[i]["s"].as_str().unwrap_or("").to_string();
        let time_words = |i: usize| words[i]["t"].as_f64().unwrap_or(sentence_from);

        // A word lasts until the next one starts; the last until the sentence ends.
        let mut speakers_by_word: Vec<Option<String>> = (0..words.len())
            .map(|i| {
                let from = time_words(i);
                let word_end = if i + 1 < words.len() {
                    time_words(i + 1)
                } else {
                    sentence_to
                };
                speaker_for(from, word_end.max(from), turns)
            })
            .collect();

        // Words in silence or outside any recognised span have nobody. They
        // inherit the previous speaker — speech continues until taken over.
        let mut last: Option<String> = None;
        for speaker in speakers_by_word.iter_mut() {
            match speaker {
                Some(key) => last = Some(key.clone()),
                None => *speaker = last.clone(),
            }
        }
        // And at the start of the sentence, backwards from the first known one.
        if speakers_by_word
            .first()
            .map(|speaker| speaker.is_none())
            .unwrap_or(false)
        {
            if let Some(first_speaker) = speakers_by_word.iter().flatten().next().cloned() {
                for speaker in speakers_by_word.iter_mut() {
                    if speaker.is_none() {
                        *speaker = Some(first_speaker.clone());
                    } else {
                        break;
                    }
                }
            }
        }

        let word_end = |i: usize| {
            if i + 1 < words.len() {
                time_words(i + 1)
            } else {
                sentence_to
            }
        };
        let run_seconds = |from: usize, to: usize| (word_end(to) - time_words(from)).max(0.0);
        let taken_over = |from: usize, to: usize| {
            run_seconds(from, to) >= MIN_TURN_SECONDS && to - from + 1 >= MIN_TURN_WORDS
        };

        // Smoothing. A change of speaker inside one sentence is believed only
        // when the newcomer holds the floor long enough to have actually taken
        // it. Anything shorter is an imprecise boundary and goes back to
        // whichever neighbour speaks more.
        //
        // One change is undone per pass, the least believable one first, and
        // the runs are rebuilt each time: absorbing an island joins the speech
        // on both sides of it, and the joined run may well clear the bar that
        // neither half cleared alone.
        for _ in 0..speakers_by_word.len() {
            let runs = speaker_runs(&speakers_by_word);
            if runs.len() < 2 {
                break;
            }
            let weakest = runs
                .iter()
                .copied()
                .enumerate()
                .filter(|&(_, (from, to))| !taken_over(from, to))
                .min_by(|&(_, (a, b)), &(_, (c, d))| {
                    run_seconds(a, b).total_cmp(&run_seconds(c, d))
                });
            let Some((index, (from, to))) = weakest else {
                break;
            };
            let before = index.checked_sub(1).map(|k| runs[k]);
            let after = runs.get(index + 1).copied();
            let host = match (before, after) {
                (Some(b), Some(a)) => {
                    if run_seconds(b.0, b.1) >= run_seconds(a.0, a.1) {
                        Some(b)
                    } else {
                        Some(a)
                    }
                }
                (Some(b), None) => Some(b),
                (None, Some(a)) => Some(a),
                (None, None) => None,
            };
            let Some(host) = host else {
                break;
            };
            let key = speakers_by_word[host.0].clone();
            for speaker in speakers_by_word.iter_mut().take(to + 1).skip(from) {
                *speaker = key.clone();
            }
        }

        // Whatever changes survived, put them where a clause ends.
        //
        // Sherpa returns a moment in time and Whisper returns words; both are
        // imprecise by roughly the length of one or two of them, which is why
        // the cut lands mid-phrase — `for 35 | years` — as often as not. The
        // handover is audible at the comma either way, so the boundary is
        // moved there when one is within reach.
        let runs = speaker_runs(&speakers_by_word);
        for pair in runs.windows(2) {
            let (left, right) = (pair[0], pair[1]);
            let boundary = left.1;
            if ends_clause(&text_words(boundary)) {
                continue;
            }
            let mut target = None;
            for step in 1..=PUNCTUATION_SNAP {
                // Neither side may be swallowed whole: this moves a boundary,
                // it does not undo a change the pass above chose to keep.
                if boundary >= step
                    && boundary - step >= left.0
                    && ends_clause(&text_words(boundary - step))
                {
                    target = Some(boundary - step);
                    break;
                }
                if boundary + step < right.1 && ends_clause(&text_words(boundary + step)) {
                    target = Some(boundary + step);
                    break;
                }
            }
            let Some(target) = target else { continue };
            // Read the two keys off the boundary itself. An earlier pair may
            // have moved its own boundary into this run's opening words, so
            // `left.0` no longer reliably holds this run's speaker.
            let (key, range) = if target < boundary {
                (
                    speakers_by_word[boundary + 1].clone(),
                    target + 1..=boundary,
                )
            } else {
                (speakers_by_word[boundary].clone(), boundary + 1..=target)
            };
            for index in range {
                speakers_by_word[index] = key.clone();
            }
        }

        // Boundaries between speakers inside the sentence.
        let mut cuts: Vec<usize> = Vec::new();
        for i in 0..speakers_by_word.len() - 1 {
            if speakers_by_word[i] != speakers_by_word[i + 1] {
                cuts.push(i);
            }
        }
        if cuts.is_empty() {
            s.speakers = speakers_by_word[0].clone();
            output.push(s);
            continue;
        }

        let mut from = 0usize;
        let mut order_offset = 0i64;
        for end_parts in cuts
            .into_iter()
            .chain(std::iter::once(speakers_by_word.len() - 1))
        {
            if end_parts < from {
                continue;
            }
            let chunks: Vec<String> = (from..=end_parts).map(text_words).collect();
            let text = chunks.join(" ").trim().to_string();
            if text.is_empty() {
                from = end_parts + 1;
                continue;
            }
            let start = time_words(from);
            let end = if end_parts + 1 < words.len() {
                time_words(end_parts + 1)
            } else {
                sentence_to
            };
            let word_data: Vec<serde_json::Value> = (from..=end_parts)
                .map(|i| serde_json::json!({ "t": time_words(i), "s": text_words(i) }))
                .collect();

            output.push(Segment {
                // The original identity goes to the first part that actually
                // materialises. Keying off the start index would lose it when
                // the opening piece comes out empty — and with it any
                // references to the segment, such as signed-off spots.
                id: if order_offset == 0 {
                    s.id.clone()
                } else {
                    uuid::Uuid::new_v4().to_string()
                },
                recording_id: s.recording_id.clone(),
                order: s.order * 1000 + order_offset,
                start,
                end: end.max(start),
                text,
                speakers: speakers_by_word[from].clone(),
                confidence: s.confidence,
                edited: s.edited,
                verified: s.verified,
                words: serde_json::to_string(&word_data).ok(),
                original: s.original.clone(),
                // Carried, like `original` above it. Splitting a block by who
                // is speaking does not change what language it is in, and a
                // part that forgot would stop being findable as one the
                // second-language pass wrote.
                language: s.language.clone(),
            });
            order_offset += 1;
            from = end_parts + 1;
        }
    }

    for (i, s) in output.iter_mut().enumerate() {
        s.order = i as i64;
    }
    output
}

#[cfg(test)]
mod one_voice_tests {
    use super::*;

    fn block(start: f64, end: f64) -> Segment {
        Segment {
            id: format!("{start}"),
            recording_id: "r".into(),
            order: 0,
            start,
            end,
            text: "…".into(),
            speakers: None,
            confidence: None,
            edited: false,
            verified: false,
            words: None,
            original: None,
            language: None,
        }
    }

    fn asking_for(count: i64) -> Settings {
        Settings {
            speaker_count: count,
            ..Settings::default()
        }
    }

    /// The whole point: told there is one speaker, nothing below is run. What
    /// comes back has to cover every block, or the shortcut would cost the
    /// reader the speaker they asked for.
    #[test]
    fn one_speaker_is_answered_without_listening() {
        let blocks = vec![block(0.4, 2.0), block(2.0, 5.5), block(9.0, 12.25)];
        let turns = one_voice_throughout(&asking_for(1), &blocks).expect("answered");

        let given = assign_speakers(blocks, &turns);
        assert_eq!(
            given
                .iter()
                .map(|s| s.speakers.as_deref().unwrap_or("-"))
                .collect::<Vec<_>>(),
            ["speaker_0", "speaker_0", "speaker_0"]
        );
    }

    #[test]
    fn any_other_answer_is_listened_to() {
        for count in [0, 2, 3, 9] {
            assert!(
                one_voice_throughout(&asking_for(count), &[block(0.0, 1.0)]).is_none(),
                "{count} speakers cannot be answered from the number alone"
            );
        }
    }

    /// A transcript with nothing in it has nobody in it either, and must not
    /// hand back a turn that ends where it starts.
    #[test]
    fn one_speaker_and_no_blocks_is_nobody() {
        assert!(one_voice_throughout(&asking_for(1), &[])
            .expect("answered")
            .is_empty());
    }
}

#[cfg(test)]
mod language_voice_tests {
    use super::*;

    fn block(start: f64, voice: &str, language: Option<&str>) -> Segment {
        Segment {
            id: format!("{start}"),
            recording_id: "r".into(),
            order: 0,
            start,
            end: start + 2.0,
            text: "…".into(),
            speakers: Some(voice.into()),
            confidence: None,
            edited: false,
            verified: false,
            words: None,
            original: None,
            language: language.map(str::to_string),
        }
    }

    fn voices(segments: &[Segment]) -> Vec<&str> {
        segments
            .iter()
            .map(|s| s.speakers.as_deref().unwrap_or("-"))
            .collect()
    }

    /// **The screenshot.** English credited to the interpreter and Czech to the
    /// guest, one under the other. Each block goes to the voice that speaks
    /// its language.
    #[test]
    fn a_block_moves_to_the_voice_that_speaks_its_language() {
        let mut blocks = vec![
            block(310.0, "paul", Some("en")),
            block(313.0, "prekladatelka", Some("en")), // wrong: English under her
            block(314.0, "prekladatelka", None),
            block(321.0, "paul", Some("en")),
            block(323.0, "prekladatelka", None),
            block(330.0, "paul", Some("en")),
            block(331.0, "paul", None), // wrong: Czech under him
        ];
        let moved = keep_voices_to_one_language(&mut blocks);
        assert_eq!(moved, 2);
        assert_eq!(
            voices(&blocks),
            vec![
                "paul",
                "paul",
                "prekladatelka",
                "paul",
                "prekladatelka",
                "paul",
                "prekladatelka"
            ]
        );
    }

    /// **The seventeen orphans.** Under 0.8 seconds there is too little voice
    /// to ask the model about, so a short remark comes back with nobody on it
    /// — and in the export that prints the speaker's name a second time. Its
    /// language says who said it.
    #[test]
    fn a_block_nobody_was_recognised_in_goes_to_the_voice_of_its_language() {
        let mut blocks = vec![
            block(600.0, "paul", Some("en")),
            block(603.0, "prekladatelka", None),
            block(610.0, "paul", Some("en")),
            block(613.0, "prekladatelka", None),
        ];
        let mut orphan = block(611.0, "paul", Some("en"));
        orphan.speakers = None;
        blocks.insert(3, orphan);
        let mut czech = block(614.0, "prekladatelka", None);
        czech.speakers = None;
        blocks.push(czech);

        keep_voices_to_one_language(&mut blocks);
        assert_eq!(blocks[3].speakers.as_deref(), Some("paul"));
        assert_eq!(blocks[5].speakers.as_deref(), Some("prekladatelka"));
    }

    /// One language — every voice speaks the same one — is left alone. This is
    /// every recording that was never filled, and it must not be touched.
    #[test]
    fn a_transcript_in_one_language_is_left_as_it_was() {
        let mut blocks = vec![
            block(0.0, "a", None),
            block(2.0, "b", None),
            block(4.0, "a", None),
        ];
        assert_eq!(keep_voices_to_one_language(&mut blocks), 0);
        assert_eq!(voices(&blocks), vec!["a", "b", "a"]);
    }

    /// A voice that is the only one speaking its language keeps everything,
    /// including a stray block in the other language: there is nowhere better
    /// to put it than where the voice model put it.
    #[test]
    fn a_block_with_no_voice_to_go_to_stays() {
        let mut blocks = vec![
            block(0.0, "a", None),
            block(2.0, "a", Some("en")),
            block(4.0, "a", None),
        ];
        assert_eq!(keep_voices_to_one_language(&mut blocks), 0);
    }

    /// Three voices: the Czech MC at the start, the interpreter and the guest.
    /// A Czech block credited to the guest goes to the nearest Czech voice in
    /// time, which deep into the talk is the interpreter, not the MC.
    #[test]
    fn a_moved_block_goes_to_the_nearest_voice_in_time() {
        let mut blocks = vec![
            block(0.0, "mc", None),
            block(10.0, "mc", None),
            block(600.0, "paul", Some("en")),
            block(603.0, "prekladatelka", None),
            block(610.0, "paul", Some("en")),
            block(613.0, "paul", None), // wrong
            block(620.0, "prekladatelka", None),
        ];
        keep_voices_to_one_language(&mut blocks);
        assert_eq!(blocks[5].speakers.as_deref(), Some("prekladatelka"));
    }
}

#[cfg(test)]
mod bridge_tests {
    use super::*;

    /// A block of `length` seconds credited to `voice`, or to nobody.
    fn block(start: f64, length: f64, voice: Option<&str>) -> Segment {
        Segment {
            id: format!("{start}"),
            recording_id: "r".into(),
            order: 0,
            start,
            end: start + length,
            text: "…".into(),
            speakers: voice.map(str::to_string),
            confidence: None,
            edited: false,
            verified: false,
            original: None,
            words: None,
            language: None,
        }
    }

    fn voices(segments: &[Segment]) -> Vec<Option<&str>> {
        segments.iter().map(|s| s.speakers.as_deref()).collect()
    }

    /// The reported case, and three quarters of them: "Yeah." between two
    /// blocks of one person.
    #[test]
    fn a_short_gap_between_one_voice_is_that_voice() {
        let mut s = vec![
            block(0.0, 5.0, Some("speaker_0")),
            block(5.0, 0.3, None),
            block(5.3, 5.0, Some("speaker_0")),
        ];
        assert_eq!(bridge_unknown(&mut s), 1);
        assert_eq!(voices(&s), vec![Some("speaker_0"); 3]);
    }

    /// Between two different people it really is not known, and a guess there
    /// would be a wrong name rather than a missing one.
    #[test]
    fn a_gap_between_two_voices_is_left_alone() {
        let mut s = vec![
            block(0.0, 5.0, Some("speaker_0")),
            block(5.0, 0.3, None),
            block(5.3, 5.0, Some("speaker_1")),
        ];
        assert_eq!(bridge_unknown(&mut s), 0);
        assert_eq!(s[1].speakers, None);
    }

    #[test]
    fn a_run_of_short_gaps_is_filled_together() {
        let mut s = vec![
            block(0.0, 5.0, Some("speaker_2")),
            block(5.0, 0.3, None),
            block(5.3, 0.4, None),
            block(5.7, 5.0, Some("speaker_2")),
        ];
        assert_eq!(bridge_unknown(&mut s), 2);
        assert_eq!(
            voices(&s),
            vec![Some("speaker_2"); 4],
            "the whole run takes the voice on both sides of it"
        );
    }

    /// One neighbour is not two. A run at either edge stays as it is.
    #[test]
    fn a_gap_at_the_edge_of_the_recording_is_left_alone() {
        let mut s = vec![block(0.0, 0.3, None), block(0.3, 5.0, Some("speaker_0"))];
        assert_eq!(bridge_unknown(&mut s), 0);
        let mut s = vec![block(0.0, 5.0, Some("speaker_0")), block(5.0, 0.3, None)];
        assert_eq!(bridge_unknown(&mut s), 0);
    }

    /// A block goes unidentified because it is too short to ask about. A long
    /// one is unidentified for some other reason and is not ours to fill in.
    #[test]
    fn a_long_gap_is_not_bridged() {
        let mut s = vec![
            block(0.0, 5.0, Some("speaker_0")),
            block(5.0, 9.0, None),
            block(14.0, 5.0, Some("speaker_0")),
        ];
        assert_eq!(bridge_unknown(&mut s), 0);
    }

    #[test]
    fn a_transcript_with_nobody_in_it_is_not_a_crash() {
        let mut s = vec![block(0.0, 1.0, None), block(1.0, 1.0, None)];
        assert_eq!(bridge_unknown(&mut s), 0);
        assert_eq!(bridge_unknown(&mut []), 0);
    }
}

/// What the bar does while the speakers are being found.
///
/// The reported defect was that it stood at 10 for the length of the whole
/// stage, moved to 34, and then finished at once. Two things caused it: the
/// features reported nothing at all while they ran, and they had been given
/// 30 % of the band for what is now 89 % of the work.
#[cfg(test)]
mod diarization_progress_tests {
    use super::*;

    #[test]
    fn the_features_move_the_bar_the_whole_way_through_themselves() {
        let total = 1000;
        // The bar starts where the stage starts and never reaches the model's
        // share while there is still a window left to do.
        assert_eq!(features_progress(0, total), 0.0);
        let mut last = 0.0;
        for done in (0..total).step_by(report_every(total)) {
            let now = features_progress(done, total);
            assert!(
                now >= last,
                "the bar never goes backwards: {now} after {last}"
            );
            assert!(now < FEATURES_SHARE, "{now} is still inside the features");
            last = now;
        }
        assert!(
            last > FEATURES_SHARE * 0.9,
            "and it gets most of the way: {last}"
        );
    }

    /// The stride is a divisor, so a recording short enough to make it zero
    /// would be a panic rather than a wrong number.
    #[test]
    fn a_recording_of_almost_nothing_does_not_divide_by_zero() {
        for total in [0, 1, 2, 49, 50, 51] {
            assert!(report_every(total) >= 1, "stride for {total} windows");
            assert_eq!(features_progress(0, total), 0.0);
        }
        assert!(features_progress(1, 1) <= FEATURES_SHARE);
    }

    /// Fifty-ish reports whatever the length: enough to look alive on a short
    /// recording, not so many on a long one that the window spends its time
    /// redrawing instead of working.
    #[test]
    fn the_bar_moves_about_fifty_times_whatever_the_recording() {
        for total in [200, 1000, 5000, 20_000] {
            let reports = (0..total).step_by(report_every(total)).count();
            assert!(
                (40..=60).contains(&reports),
                "{reports} reports for {total} windows"
            );
        }
    }
}

#[cfg(test)]
mod speaker_assignment_tests {
    use super::*;

    fn turn(start: f64, end: f64, key: &str) -> SpeakerTurn {
        SpeakerTurn {
            start,
            end,
            key: key.to_string(),
        }
    }

    /// One word per second, the sentence ending one second after the last.
    fn spoken(id: &str, words: &[&str]) -> Segment {
        let word_data: Vec<serde_json::Value> = words
            .iter()
            .enumerate()
            .map(|(index, text)| serde_json::json!({ "t": index as f64, "s": text }))
            .collect();
        Segment {
            id: id.to_string(),
            recording_id: "recording".to_string(),
            order: 0,
            start: 0.0,
            end: words.len() as f64,
            text: words.join(" "),
            speakers: None,
            confidence: Some(0.9),
            edited: false,
            verified: false,
            words: serde_json::to_string(&word_data).ok(),
            original: None,
            language: None,
        }
    }

    /// The reported defect: two words in the middle of a sentence fell to the
    /// other speaker and became a turn of their own, so one sentence left the
    /// pipeline as three. Two words is well under the second and a half it
    /// takes to claim the floor and give it back.
    #[test]
    fn a_two_word_island_does_not_break_the_sentence() {
        let input = spoken(
            "one",
            &[
                "Nepotřebují",
                "další",
                "obsah,",
                "potřebují",
                "obsah",
                "proti",
                "očekávání",
                "a",
                "to",
                "vytváří",
                "novou",
                "cestu",
            ],
        );
        let turns = vec![
            turn(0.0, 7.0, "speaker_0"),
            turn(7.0, 8.6, "speaker_1"),
            turn(8.6, 12.0, "speaker_0"),
        ];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(
            output.len(),
            1,
            "a two-word island must not split a sentence"
        );
        assert_eq!(output[0].speakers.as_deref(), Some("speaker_0"));
        assert_eq!(
            output[0].text,
            "Nepotřebují další obsah, potřebují obsah proti očekávání a to vytváří novou cestu"
        );
    }

    /// The other half of the same rule: someone who really does take the floor
    /// still gets their own segment.
    #[test]
    fn a_real_handover_still_splits_the_sentence() {
        let input = spoken(
            "one",
            &[
                "tak", "co", "chceš", "udělat", "je", "míň", "obsahu", "a", "přidat", "otázky",
                "tam",
            ],
        );
        let turns = vec![
            turn(0.0, 4.0, "speaker_0"),
            turn(4.0, 8.0, "speaker_1"),
            turn(8.0, 11.0, "speaker_0"),
        ];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(output.len(), 3);
        assert_eq!(output[0].speakers.as_deref(), Some("speaker_0"));
        assert_eq!(output[1].speakers.as_deref(), Some("speaker_1"));
        assert_eq!(output[1].text, "je míň obsahu a");
        assert_eq!(output[2].speakers.as_deref(), Some("speaker_0"));
    }

    /// The reported `for 35 | years` break: the change is real, its position is
    /// off by a word, and a clause ends within reach.
    #[test]
    fn a_surviving_cut_moves_to_the_end_of_the_clause() {
        let input = spoken(
            "one",
            &[
                "Byl",
                "jsem",
                "kazatelem",
                "pětatřicet",
                "let,",
                "z",
                "toho",
                "pětadvacet",
                "ve",
                "vlastním",
                "sboru.",
            ],
        );
        let turns = vec![turn(0.0, 4.0, "speaker_0"), turn(4.0, 11.0, "speaker_1")];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(output.len(), 2);
        assert_eq!(
            output[0].text, "Byl jsem kazatelem pětatřicet let,",
            "the cut belongs after the comma, not between the number and its noun"
        );
        assert_eq!(output[1].text, "z toho pětadvacet ve vlastním sboru.");
    }

    /// A short reply Whisper returned as its own segment never reaches the
    /// smoothing above, and must keep the speaker it overlaps.
    #[test]
    fn a_standalone_short_reply_keeps_its_own_speaker() {
        let input = spoken("one", &["Jasně."]);
        let turns = vec![turn(0.0, 0.4, "speaker_0"), turn(0.4, 1.0, "speaker_1")];

        let output = assign_speakers(vec![input], &turns);

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].speakers.as_deref(), Some("speaker_1"));
    }
}
