//! Who is speaking: voiceprints, grouping them, and giving every word an owner.
//!
//! One stage of the pipeline, lifted out of transcription.rs unchanged when
//! that file had grown to 3 626 lines. Its tests came with it.

use super::*;

// ---------------------------------------------------------------- diarizace

pub(crate) struct SpeakerTurn {
    start: f64,
    end: f64,
    key: String,
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
/// 8.9x faster on the graphics card than on the processor. And it hands back
/// the voiceprints themselves, which the executable never could: its stdout was
/// cluster labels and nothing else. That is what the sidebar needs to let
/// somebody name two voices and have the rest assigned by similarity.
///
/// `report` is the app handle, the recording id, and the percentage band this
/// stage occupies.
pub(crate) fn diarize(
    settings: &Settings,
    check: &tools::ToolCheck,
    wav: &Path,
    segments: &[Segment],
    task: &TranscriptionTask,
    recording_id: &str,
    report: Option<(&AppHandle, &str, f64, f64)>,
) -> Reported<Vec<SpeakerTurn>> {
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

    // Features first, and they are the cheap half: arithmetic over audio that
    // is already on disk, in the shape whisper was handed.
    say(0.0);
    let mut heard = Vec::with_capacity(windows.len());
    let mut kept = Vec::with_capacity(windows.len());
    for (index, window) in windows.iter().enumerate() {
        // Cancellation cannot land mid-window, so it is checked between them
        // rather than on every one of a thousand.
        if index % 200 == 0 {
            stop_if_cancelled(task, recording_id)?;
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

    say(0.3);
    stop_if_cancelled(task, recording_id)?;
    // The reason goes three places on purpose. It is in the message the reader
    // sees, because "could not be started" without a why is not a report; it is
    // in `slobot-log.txt`, because a notice that has already gone cannot be
    // asked about; and `{model}` is in there because the path is the first
    // thing that is ever wrong.
    let mut voices = crate::voiceprint::Voices::open(Path::new(model)).map_err(|error| {
        crate::note!("speaker model {model} did not open: {error:#}");
        UserMessage::new("diarization.launch_failed").detail(format!("{error:#}"))
    })?;
    let prints = voices.embed(&heard).map_err(|error| {
        let count = heard.len();
        crate::note!("speaker model {model} failed on {count} windows: {error:#}");
        UserMessage::new("diarization.launch_failed").detail(format!("{error:#}"))
    })?;

    say(0.9);
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

/// Kolik reci musi uvnitr jedne vety pripadnout na druheho mluvciho, aby se
/// zmena povazovala za skutecne prevzeti slova a ne za nepresnou hranici.
///
/// Obe podminky plati zaroven. Samotny pocet slov nestaci: tri kratka slova
/// jsou pul vteriny, coz zadne prevzeti slova neni. A samotna delka nestaci
/// taky, protoze jedno slovo pred dlouhou pauzou muze mit vterinu a pul.
///
/// Pozor, tohle plati jen *uvnitr* vety. Jednoslovne pritakani v rozhovoru
/// nebo v telefonatu — „mhm“, „jasne“ — vraci Whisper jako samostatny usek,
/// a ten touhle cestou vubec neprochazi: useky kratsi nez dve slova dostanou
/// mluvciho prostym prekryvem a nikdo je nepohlti.
pub(crate) const MIN_TURN_SECONDS: f64 = 1.4;
pub(crate) const MIN_TURN_WORDS: usize = 3;

/// O kolik slov se smi hranice mluvcich posunout, aby padla na interpunkci.
///
/// Sherpa vraci cas, Whisper vraci slova, a obe hranice jsou nepresne radove
/// o desetiny vteriny — tedy prave o jedno dve slova. Kdyz uz se veta deli,
/// at se deli tam, kde ma stejne konec vetny celek.
pub(crate) const PUNCTUATION_SNAP: usize = 2;

/// Souvisle sledy slov jednoho mluvciho, jako dvojice prvni a posledni index.
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

/// Konci slovo znamenkem, ktere uzavira vetu nebo vetny celek?
pub(crate) fn ends_clause(word: &str) -> bool {
    word.trim_end()
        .chars()
        .last()
        .map(|c| matches!(c, ',' | '.' | '!' | '?' | '…' | ';' | ':'))
        .unwrap_or(false)
}

/// Poradi mluvciho podle cisla v klici.
///
/// Textove razeni by dalo `speaker_1, speaker_10, speaker_2`, takze by
/// „Mluvci 2“ v prepisu byl ve skutecnosti desaty. Pri deleni po slovech
/// mluvcich pribyva, takze uz to neni jen teoreticka moznost.
pub(crate) fn order_key(key: &str) -> (i64, String) {
    let number = key
        .rsplit(|z: char| !z.is_ascii_digit())
        .next()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(i64::MAX);
    (number, key.to_string())
}

/// Mluvci, s nimz se dany casovy usek nejvic prekryva.
pub(crate) fn speaker_for(start: f64, end: f64, turns: &[SpeakerTurn]) -> Option<String> {
    let mut best: Option<(&str, f64)> = None;
    for u in turns {
        let prekryv = (end.min(u.end) - start.max(u.start)).max(0.0);
        if prekryv > 0.0 && best.map(|(_, p)| prekryv > p).unwrap_or(true) {
            best = Some((&u.key, prekryv));
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
