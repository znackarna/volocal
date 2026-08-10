//! Turning what Whisper said into readable text: the dictionary, and sentences cut into blocks somebody can read.
//!
//! One stage of the pipeline, lifted out of transcription.rs unchanged when
//! that file had grown to 3 626 lines. Its tests came with it.

use super::*;

// ---------------------------------------------------------------- slovnik

/// Applies the dictionary to an already stored transcript. Returns the number
/// of changed segments. Used when someone adds a term afterwards — otherwise
/// the correction would only show up in the next transcription.
pub fn apply_dictionary_to_recording(
    connection: &rusqlite::Connection,
    recording_id: &str,
) -> Result<usize> {
    let dictionary = db::dictionary(connection)?;
    let mut segments = db::segments(connection, recording_id)?;
    let original: Vec<(String, Option<String>)> = segments
        .iter()
        .map(|s| (s.text.clone(), s.words.clone()))
        .collect();

    apply_dictionary(&mut segments, &dictionary);

    let mut changes_applied = 0;
    for (segment, (old_text, old_words)) in segments.iter().zip(original) {
        if segment.text != old_text || segment.words != old_words {
            db::save_segment_text(
                connection,
                &segment.id,
                &segment.text,
                segment.words.as_deref(),
            )?;
            changes_applied += 1;
        }
    }
    Ok(changes_applied)
}

/// Abbreviations after which a full stop does not end the sentence.
pub(crate) const ABBREVIATIONS: &[&str] = &[
    "tzv.", "tzn.", "např.", "resp.", "atd.", "apod.", "mj.", "tj.", "č.", "str.", "kap.", "obr.",
    "sv.", "st.", "mgr.", "ing.", "phdr.", "mudr.", "prof.", "doc.", "mr.", "mrs.", "ms.", "dr.",
    "vs.", "etc.", "e.g.", "i.e.",
];

/// A sentence end is recognised from punctuation, but not every full stop
/// ends a sentence.
pub(crate) fn ends_sentence(word: &str, next: Option<&str>) -> bool {
    let ocesane = word.trim_end_matches(['"', '»', '“', ')']);
    if !ocesane.ends_with(['.', '!', '?', '…']) {
        return false;
    }
    // Question and exclamation marks are unambiguous; a full stop needs care.
    if ocesane.ends_with(['!', '?', '…']) {
        return true;
    }

    let male = ocesane.to_lowercase();
    if ABBREVIATIONS.contains(&male.as_str()) {
        return false;
    }
    // Neither an initial ("J. A. Komenský") nor an ordinal ("3. kapitola").
    let jadro = male.trim_end_matches('.');
    if jadro.chars().count() <= 1 || jadro.chars().all(|z| z.is_ascii_digit()) {
        return false;
    }
    // A sentence end is followed by a capital letter or by nothing.
    match next {
        None => true,
        Some(d) => d
            .chars()
            .find(|z| z.is_alphanumeric())
            .map(|z| z.is_uppercase())
            .unwrap_or(false),
    }
}

/// A natural sentence may run this long without being touched. Beyond this
/// point a comma, clause mark or audible pause becomes a useful visual break.
pub(crate) const SOFT_SENTENCE_SECONDS: f64 = 18.0;

/// Even speech with no punctuation must not produce a block longer than this.
pub(crate) const MAX_SENTENCE_SECONDS: f64 = 28.0;

/// Avoid solving one long block by leaving an unreadable one-line remainder.
pub(crate) const MIN_REMAINDER_SECONDS: f64 = 6.0;

/// A forced split should not create a tiny leading fragment either.
pub(crate) const MIN_BLOCK_SECONDS: f64 = 8.0;

/// Word timestamps mark word starts rather than silence exactly. These values
/// therefore describe unusually wide start-to-start gaps, not literal pauses.
pub(crate) const NOTICEABLE_WORD_GAP_SECONDS: f64 = 0.75;
pub(crate) const LONG_WORD_GAP_SECONDS: f64 = 1.1;

/// Longest silence across which two segments are still treated as one
/// sentence.
///
/// Deliberately generous. The first attempt used two seconds, on the reasoning
/// that a longer pause means the sentence ended and nobody wrote the full stop
/// down. Real recordings said otherwise: a phrase as tight as "That'll mess |
/// with them" came back split by 2.3 seconds, and eight such joins in a single
/// ten-minute conversation would have been missed. Speakers pause mid-sentence
/// for breath and for effect, and VAD widens the gap further by cutting the
/// silence out.
///
/// So the text decides, not the clock: an unfinished sentence continuing in
/// lower case is one sentence however long the pause. This is only a backstop
/// against a genuinely dropped full stop.
pub(crate) const MAX_JOIN_GAP: f64 = 10.0;

/// Stored segment layout is derived data. Incrementing this version rebuilds
/// completed transcripts once from their preserved word timestamps without
/// running Whisper again.
pub(crate) const SENTENCE_LAYOUT_KEY: &str = "sentence-layout-version";
pub(crate) const SENTENCE_LAYOUT_VERSION: &str = "2";

/// One word with the time it is spoken at.
pub(crate) struct TimedWord {
    text: String,
    time: f64,
}

/// How suitable the boundary after `word` is for a visual block break.
/// Natural sentence endings are handled before this function; these are the
/// softer places available when Whisper punctuates a long thought with commas.
pub(crate) fn boundary_strength(word: &str, next: &str, gap: f64) -> u8 {
    let trimmed = word.trim_end_matches(['"', '»', '“', '”', ')', ']']);
    let clause_mark = trimmed.ends_with([';', ':', '—', '–']);
    let comma = trimmed.ends_with(',');
    let next_core = next
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase();
    let next_core_length = next_core.chars().count();
    // A block beginning with one of these words almost always continues the
    // preceding verb, noun or list item. The short cross-language core also
    // covers common equivalents such as "of", "to", "in", "on" and "zu".
    const DEPENDENT_OPENERS: &[&str] = &[
        "v", "ve", "na", "do", "od", "z", "ze", "s", "se", "k", "ke", "o", "u", "po", "pro",
        "před", "za", "pod", "nad", "mezi", "přes", "bez", "kvůli", "of", "to", "in", "on", "at",
        "from", "with", "for", "by", "into", "zu", "im", "am", "an", "von", "mit", "für",
    ];
    let dependent_opener = next_core_length <= 2 || DEPENDENT_OPENERS.contains(&next_core.as_str());

    // Written structure is more dependable than a pause. Speakers regularly
    // pause before a prepositional complement ("soustředíme | na ty malé"),
    // while a comma remains a useful clause boundary even when spoken without
    // silence. A pause or comma before a dependent opener is especially
    // likely to sit inside one grammatical phrase or list, so it is demoted.
    if clause_mark {
        4
    } else if comma && dependent_opener {
        1
    } else if comma {
        3
    } else if dependent_opener
        && next
            .chars()
            .find(|character| character.is_alphanumeric())
            .is_some_and(|character| character.is_lowercase())
    {
        0
    } else if gap >= LONG_WORD_GAP_SECONDS {
        2
    } else if gap >= NOTICEABLE_WORD_GAP_SECONDS {
        1
    } else {
        0
    }
}

/// Picks a readable boundary inside an over-long run of words.
///
/// Once the soft limit is reached, a real clause boundary may end the block.
/// If no such boundary appears before the hard limit, the best earlier comma
/// or pause wins; with no linguistic clue at all, cut nearest the soft target.
pub(crate) fn readable_cut(words: &[TimedWord]) -> Option<usize> {
    if words.len() < 2 {
        return None;
    }

    let start = words.first()?.time;
    let last = words.last()?.time;
    let span = last - start;
    if span < SOFT_SENTENCE_SECONDS {
        return None;
    }

    let target = start + SOFT_SENTENCE_SECONDS;
    let hard_end = start + MAX_SENTENCE_SECONDS;
    let latest_with_remainder = last - MIN_REMAINDER_SECONDS;

    let score = |index: usize| {
        let boundary = words[index + 1].time;
        let gap = boundary - words[index].time;
        let strength = boundary_strength(&words[index].text, &words[index + 1].text, gap) as f64;
        // One quality step is worth ten seconds of distance from the target.
        strength * 10.0 - (boundary - target).abs()
    };

    // A preferred break happens only after the soft limit and leaves enough
    // speech for the next block. This prevents a comma near the beginning or
    // end from creating a runt.
    let preferred = (0..words.len() - 1)
        .filter(|&index| {
            let boundary = words[index + 1].time;
            boundary >= target
                && boundary <= hard_end
                && boundary <= latest_with_remainder
                // Soft splitting is deliberately limited to written clause
                // boundaries. Choosing a pause as soon as it has six seconds
                // of trailing context is greedy: a better comma can be the
                // very next word but not yet have enough remainder itself.
                && boundary_strength(
                    &words[index].text,
                    &words[index + 1].text,
                    boundary - words[index].time,
                ) >= 3
        })
        .max_by(|&left, &right| score(left).total_cmp(&score(right)));
    if preferred.is_some() || span <= MAX_SENTENCE_SECONDS {
        return preferred;
    }

    // The hard limit was crossed. Reconsider useful boundaries before the
    // soft target as well, because a slightly short clause is better than a
    // mechanical cut through the middle of one.
    let forced_candidates: Vec<usize> = (0..words.len() - 1)
        .filter(|&index| {
            let boundary = words[index + 1].time;
            boundary >= start + MIN_BLOCK_SECONDS && boundary <= hard_end
        })
        .collect();
    if forced_candidates.is_empty() {
        return Some(0);
    }

    forced_candidates
        .iter()
        .copied()
        .filter(|&index| {
            let boundary = words[index + 1].time;
            boundary_strength(
                &words[index].text,
                &words[index + 1].text,
                boundary - words[index].time,
            ) > 0
        })
        .max_by(|&left, &right| score(left).total_cmp(&score(right)))
        .or_else(|| {
            forced_candidates.into_iter().min_by(|&left, &right| {
                let left_distance = (words[left + 1].time - target).abs();
                let right_distance = (words[right + 1].time - target).abs();
                left_distance.total_cmp(&right_distance)
            })
        })
}

/// Rebuilds the transcript into sentences.
///
/// Whisper divides text by its own thirty-second window, not by meaning. Two
/// things follow from that, and both need fixing:
///
/// * a stretch of speech with no pauses arrives as one long block, awkward to
///   work with in the editor and hard to follow when highlighted;
/// * a sentence that happens to straddle the end of a window is torn in two,
///   so its last words appear at the start of the next segment.
///
/// Splitting alone fixed the first and left the second. So the words are put
/// back into one stream and cut afresh at sentence ends. Times come from the
/// stored word timings, so nothing moves.
pub(crate) fn rebuild_sentences(segments: Vec<Segment>) -> Vec<Segment> {
    let mut output: Vec<Segment> = Vec::with_capacity(segments.len());
    let mut buffer: Vec<TimedWord> = Vec::new();
    // The segment the buffered words started in — it lends its identity and
    // its confidence to the sentences that come out.
    let mut origin: Option<Segment> = None;
    // Where the last segment that fed the buffer ended. Needed because a word
    // timing marks a beginning, so the final word of a sentence would
    // otherwise have no duration at all.
    let mut collected_end = 0.0f64;

    for s in segments {
        let words: Vec<serde_json::Value> = s
            .words
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();

        // Without word timings there is nothing to cut by. A hand-edited or
        // explicitly verified segment is user-owned and must keep its exact
        // boundaries during a later layout upgrade. All three act as barriers.
        if words.is_empty() || s.edited || s.verified {
            flush(&mut buffer, &mut origin, &mut output, collected_end);
            output.push(s);
            continue;
        }

        let incoming: Vec<TimedWord> = words
            .iter()
            .filter_map(|w| {
                Some(TimedWord {
                    text: w["s"].as_str()?.to_string(),
                    time: w["t"].as_f64().unwrap_or(s.start),
                })
            })
            .collect();
        if incoming.is_empty() {
            flush(&mut buffer, &mut origin, &mut output, collected_end);
            output.push(s);
            continue;
        }

        // Does this segment continue the sentence being collected, or start
        // its own? Whisper's source chunks are implementation windows, not
        // grammatical units. In particular, their first token may be
        // capitalised even when the window starts mid-sentence, so capital
        // letters must not become hard barriers here.
        //
        // A change of speaker always ends the collection, whatever the
        // wording says. Two people finishing each other's sentence is still
        // two segments — merging them would credit one person's words to the
        // other. Matters when this runs over an already diarized transcript;
        // straight after transcription nobody has a speaker yet.
        let different_speaker = origin
            .as_ref()
            .map(|o| o.speakers != s.speakers)
            .unwrap_or(false);

        if let (Some(last), Some(first_word)) = (buffer.last(), incoming.first()) {
            let gap = first_word.time - last.time;

            if different_speaker || gap > MAX_JOIN_GAP {
                flush(&mut buffer, &mut origin, &mut output, collected_end);
            }
        }

        if origin.is_none() {
            origin = Some(s.clone());
        }
        buffer.extend(incoming);
        collected_end = s.end;

        // Everything up to the last complete sentence can be emitted now; the
        // tail waits for the next segment to finish it.
        emit_complete_sentences(&mut buffer, &mut origin, &mut output, s.end);
    }
    flush(&mut buffer, &mut origin, &mut output, collected_end);

    // The ordering was only ever provisional. Renumber from scratch.
    for (i, s) in output.iter_mut().enumerate() {
        s.order = i as i64;
    }
    output
}

/// Emits every finished sentence from the buffer and keeps the rest.
pub(crate) fn emit_complete_sentences(
    buffer: &mut Vec<TimedWord>,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
    fallback_end: f64,
) {
    let mut last_cut = 0usize;
    let mut cuts: Vec<usize> = Vec::new();
    for i in 0..buffer.len().saturating_sub(1) {
        if ends_sentence(&buffer[i].text, Some(&buffer[i + 1].text)) {
            cuts.push(i);
        }
    }
    for cut in cuts {
        push_readable_run(
            &buffer[last_cut..=cut],
            buffer.get(cut + 1).map(|w| w.time).unwrap_or(fallback_end),
            origin,
            output,
        );
        last_cut = cut + 1;
    }
    if last_cut > 0 {
        buffer.drain(0..last_cut);
    }
    // Once the buffer is empty, the next source segment must lend its own id
    // and metadata. Previously the capital-letter barrier happened to reset
    // this state; sentence completion now does so explicitly.
    if buffer.is_empty() {
        *origin = None;
    }
}

/// Emits one complete sentence or barrier-delimited run, splitting it only
/// when the adaptive readability limits require it.
pub(crate) fn push_readable_run(
    words: &[TimedWord],
    end: f64,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
) {
    let mut from = 0usize;
    while let Some(relative_cut) = readable_cut(&words[from..]) {
        let cut = from + relative_cut;
        let boundary = words.get(cut + 1).map(|word| word.time).unwrap_or(end);
        push_sentence(&words[from..=cut], boundary, origin, output);
        from = cut + 1;
    }
    if from < words.len() {
        push_sentence(&words[from..], end, origin, output);
    }
}

/// Emits whatever is left, sentence end or not, and empties the buffer.
pub(crate) fn flush(
    buffer: &mut Vec<TimedWord>,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
    collected_end: f64,
) {
    if buffer.is_empty() {
        *origin = None;
        return;
    }
    // The end of the last segment that contributed, not the last word's own
    // time. A word timing says when the word *starts*; using it as the end
    // cut the final word off — the highlight never reached it and a subtitle
    // disappeared while it was still being said.
    let last_word = buffer.last().map(|w| w.time).unwrap_or(0.0);
    push_readable_run(&buffer[..], collected_end.max(last_word), origin, output);
    buffer.clear();
    *origin = None;
}

/// Turns a run of words into one segment.
pub(crate) fn push_sentence(
    words: &[TimedWord],
    end: f64,
    origin: &mut Option<Segment>,
    output: &mut Vec<Segment>,
) {
    let text = words
        .iter()
        .map(|w| w.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if text.is_empty() {
        return;
    }
    let Some(template) = origin.as_mut() else {
        return;
    };

    let start = words[0].time;
    let word_data: Vec<serde_json::Value> = words
        .iter()
        .map(|w| serde_json::json!({ "t": w.time, "s": w.text }))
        .collect();

    // The first sentence out of a segment inherits its identity, so anything
    // pointing at it still resolves; the rest get fresh ones. The identity is
    // handed over exactly once — taking it empties it, which is cheaper and
    // safer than searching the output for it every time.
    let id = if template.id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        std::mem::take(&mut template.id)
    };

    output.push(Segment {
        id,
        recording_id: template.recording_id.clone(),
        order: output.len() as i64,
        start,
        end: end.max(start),
        text,
        speakers: template.speakers.clone(),
        confidence: template.confidence,
        edited: template.edited,
        verified: template.verified,
        words: serde_json::to_string(&word_data).ok(),
        original: template.original.clone(),
    });
}

pub(crate) fn same_sentence_layout(before: &[Segment], after: &[Segment]) -> bool {
    before.len() == after.len()
        && before.iter().zip(after).all(|(left, right)| {
            (left.start - right.start).abs() < 0.001
                && (left.end - right.end).abs() < 0.001
                && left.text == right.text
                && left.speakers == right.speakers
                && left.edited == right.edited
                && left.verified == right.verified
        })
}

/// Whether the archive still contains segment layout produced by an older
/// version of the sentence builder.
pub fn sentence_layout_upgrade_needed(connection: &rusqlite::Connection) -> Result<bool> {
    Ok(
        db::metadata_value(connection, SENTENCE_LAYOUT_KEY)?.as_deref()
            != Some(SENTENCE_LAYOUT_VERSION),
    )
}

/// Rebuilds visual transcript blocks from already stored word timestamps.
///
/// This is intentionally one atomic transaction. The words, their times and
/// the recording are not re-transcribed; only derived segment boundaries are
/// replaced. Edited and verified segments remain hard barriers.
pub fn upgrade_sentence_layout(connection: &mut rusqlite::Connection) -> Result<usize> {
    if !sentence_layout_upgrade_needed(connection)? {
        return Ok(0);
    }

    let transaction = connection.transaction()?;
    let recording_ids = db::completed_recording_ids_with_segments(&transaction)?;
    let mut changed = 0usize;

    for recording_id in recording_ids {
        let before = db::segments(&transaction, &recording_id)?;
        let after = rebuild_sentences(before.clone());
        if same_sentence_layout(&before, &after) {
            continue;
        }

        db::delete_segments(&transaction, &recording_id)?;
        for segment in &after {
            db::insert_segment(&transaction, segment)?;
        }
        changed += 1;
    }

    db::save_metadata_value(&transaction, SENTENCE_LAYOUT_KEY, SENTENCE_LAYOUT_VERSION)?;
    transaction.commit()?;
    Ok(changed)
}

#[cfg(test)]
mod sentence_block_tests {
    use super::*;

    fn segment(id: &str, speaker: Option<&str>, words: Vec<(f64, String)>, end: f64) -> Segment {
        let start = words.first().map(|word| word.0).unwrap_or(0.0);
        let text = words
            .iter()
            .map(|word| word.1.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let word_data: Vec<serde_json::Value> = words
            .iter()
            .map(|(time, text)| serde_json::json!({ "t": time, "s": text }))
            .collect();
        Segment {
            id: id.to_string(),
            recording_id: "recording".to_string(),
            order: 0,
            start,
            end,
            text,
            speakers: speaker.map(str::to_string),
            confidence: Some(0.9),
            edited: false,
            verified: false,
            words: serde_json::to_string(&word_data).ok(),
            original: None,
        }
    }

    fn plain_words(count: usize, comma_after: Option<usize>) -> Vec<(f64, String)> {
        (0..count)
            .map(|index| {
                let suffix = if comma_after == Some(index) { "," } else { "" };
                (index as f64, format!("slovo{index}{suffix}"))
            })
            .collect()
    }

    #[test]
    fn keeps_short_natural_sentences_as_sentences() {
        let input = segment(
            "one",
            None,
            vec![
                (0.0, "První".into()),
                (1.0, "věta.".into()),
                (2.0, "Druhá".into()),
                (3.0, "věta.".into()),
            ],
            4.0,
        );

        let output = rebuild_sentences(vec![input]);

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].text, "První věta.");
        assert_eq!(output[1].text, "Druhá věta.");
    }

    #[test]
    fn splits_a_long_comma_joined_thought_at_the_clause() {
        let input = segment("one", None, plain_words(41, Some(19)), 41.0);

        let output = rebuild_sentences(vec![input]);

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].end, 20.0);
        assert_eq!(output[1].start, 20.0);
        assert!(output
            .iter()
            .all(|block| block.end - block.start <= MAX_SENTENCE_SECONDS));
    }

    #[test]
    fn hard_limit_handles_speech_without_any_punctuation() {
        let input = segment("one", None, plain_words(61, None), 61.0);

        let output = rebuild_sentences(vec![input]);

        assert!(output.len() >= 3);
        assert!(output
            .iter()
            .all(|block| block.end - block.start <= MAX_SENTENCE_SECONDS));
        let word_count: usize = output
            .iter()
            .map(|block| {
                block
                    .words
                    .as_deref()
                    .and_then(|words| serde_json::from_str::<Vec<serde_json::Value>>(words).ok())
                    .map(|words| words.len())
                    .unwrap_or(0)
            })
            .sum();
        assert_eq!(word_count, 61);
    }

    #[test]
    fn does_not_leave_a_tiny_remainder_after_a_soft_split() {
        let input = segment("one", None, plain_words(23, Some(19)), 23.0);

        let output = rebuild_sentences(vec![input]);

        assert_eq!(output.len(), 1);
    }

    #[test]
    fn waits_for_a_comma_instead_of_cutting_the_phrase_before_it() {
        let mut words = vec![
            TimedWord {
                text: "začátek".into(),
                time: 0.0,
            },
            TimedWord {
                text: "pokračuje".into(),
                time: 8.0,
            },
            TimedWord {
                text: "z".into(),
                time: 17.5,
            },
            TimedWord {
                text: "jednoho".into(),
                time: 18.0,
            },
            TimedWord {
                text: "prostého".into(),
                time: 18.5,
            },
            TimedWord {
                text: "důvodu,".into(),
                time: 19.6,
            },
            TimedWord {
                text: "protože".into(),
                time: 20.2,
            },
            TimedWord {
                text: "pokračování".into(),
                time: 25.7,
            },
        ];

        // At this point only the pause before "důvodu" has enough following
        // context. It must not win merely because the comma one word later is
        // not eligible yet.
        assert_eq!(readable_cut(&words), None);

        words.push(TimedWord {
            text: "dál".into(),
            time: 26.3,
        });
        let cut = readable_cut(&words).expect("the comma should now be eligible");
        assert_eq!(words[cut].text, "důvodu,");
    }

    #[test]
    fn comma_outranks_a_pause_inside_a_prepositional_phrase() {
        let words = vec![
            TimedWord {
                text: "začátek".into(),
                time: 0.0,
            },
            TimedWord {
                text: "pokračuje".into(),
                time: 9.0,
            },
            TimedWord {
                text: "boji,".into(),
                time: 18.0,
            },
            TimedWord {
                text: "o".into(),
                time: 18.5,
            },
            TimedWord {
                text: "čase,".into(),
                time: 19.0,
            },
            TimedWord {
                text: "o".into(),
                time: 19.5,
            },
            TimedWord {
                text: "tom,".into(),
                time: 20.0,
            },
            TimedWord {
                text: "že".into(),
                time: 20.5,
            },
            TimedWord {
                text: "to".into(),
                time: 20.8,
            },
            TimedWord {
                text: "nejde".into(),
                time: 21.2,
            },
            TimedWord {
                text: "hned,".into(),
                time: 21.5,
            },
            TimedWord {
                text: "ale".into(),
                time: 22.0,
            },
            TimedWord {
                text: "když".into(),
                time: 22.5,
            },
            TimedWord {
                text: "se".into(),
                time: 23.0,
            },
            TimedWord {
                text: "soustředíme".into(),
                time: 24.0,
            },
            TimedWord {
                text: "na".into(),
                time: 25.2,
            },
            TimedWord {
                text: "ty".into(),
                time: 25.4,
            },
            TimedWord {
                text: "malé,".into(),
                time: 26.0,
            },
            TimedWord {
                text: "tak".into(),
                time: 26.4,
            },
            TimedWord {
                text: "pokračujeme".into(),
                time: 31.5,
            },
        ];

        let cut = readable_cut(&words).expect("the long run needs a readable split");
        assert_eq!(words[cut].text, "hned,");
        assert_ne!(words[cut].text, "boji,");
        assert_ne!(words[cut].text, "soustředíme");
    }

    #[test]
    fn source_window_capitalization_does_not_break_an_unfinished_sentence() {
        let first = segment(
            "one",
            None,
            vec![
                (0.0, "Tohle".into()),
                (1.0, "je".into()),
                (2.0, "nedokončené".into()),
            ],
            3.0,
        );
        let second = segment(
            "two",
            None,
            vec![(3.1, "Pokračování".into()), (4.0, "věty.".into())],
            5.0,
        );

        let output = rebuild_sentences(vec![first, second]);

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].text, "Tohle je nedokončené Pokračování věty.");
    }

    #[test]
    fn layout_upgrade_rebuilds_existing_segments_once() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE nahravky (
                    id TEXT PRIMARY KEY, stav TEXT NOT NULL, vytvoreno TEXT NOT NULL
                 );
                 CREATE TABLE segmenty (
                    id TEXT PRIMARY KEY, nahravka_id TEXT NOT NULL, poradi INTEGER NOT NULL,
                    zacatek REAL NOT NULL, konec REAL NOT NULL, text TEXT NOT NULL,
                    mluvci TEXT, jistota REAL, upraveno INTEGER NOT NULL DEFAULT 0,
                    slova TEXT, overeno INTEGER NOT NULL DEFAULT 0, puvodni TEXT
                 );
                 CREATE VIRTUAL TABLE segmenty_fts USING fts5(
                    text, segment_id UNINDEXED, nahravka_id UNINDEXED
                 );
                 CREATE TABLE klice (klic TEXT PRIMARY KEY, hodnota TEXT NOT NULL);
                 INSERT INTO nahravky (id, stav, vytvoreno)
                 VALUES ('recording', 'hotova', '2026-08-02 00:00:00');",
            )
            .unwrap();

        let first = segment(
            "one",
            None,
            vec![
                (0.0, "začátek".into()),
                (8.0, "pokračuje".into()),
                (17.5, "z".into()),
                (18.0, "jednoho".into()),
                (18.5, "prostého".into()),
            ],
            19.6,
        );
        let second = segment(
            "two",
            None,
            vec![
                (19.6, "důvodu,".into()),
                (20.2, "protože".into()),
                (25.7, "pokračování".into()),
                (26.3, "jde".into()),
                (30.5, "dál.".into()),
            ],
            31.0,
        );
        db::insert_segment(&connection, &first).unwrap();
        db::insert_segment(&connection, &second).unwrap();

        assert_eq!(upgrade_sentence_layout(&mut connection).unwrap(), 1);
        let upgraded = db::segments(&connection, "recording").unwrap();
        assert_eq!(upgraded.len(), 2);
        assert!(upgraded[0].text.ends_with("prostého důvodu,"));
        assert!(upgraded[1].text.starts_with("protože"));
        assert_eq!(upgrade_sentence_layout(&mut connection).unwrap(), 0);
    }

    #[test]
    fn a_speaker_change_remains_a_hard_boundary() {
        let first = segment("one", Some("A"), plain_words(5, None), 5.0);
        let second_words = plain_words(5, None)
            .into_iter()
            .map(|(time, text)| (time + 5.0, text))
            .collect();
        let second = segment("two", Some("B"), second_words, 10.0);

        let output = rebuild_sentences(vec![first, second]);

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].speakers.as_deref(), Some("A"));
        assert_eq!(output[1].speakers.as_deref(), Some("B"));
    }
}

pub(crate) fn apply_dictionary(segments: &mut [Segment], dictionary: &[db::DictionaryEntry]) {
    let rules: Vec<(Regex, String)> = dictionary
        .iter()
        .filter(|p| !p.find.trim().is_empty())
        .filter_map(|p| {
            let pattern = format!(r"(?i)\b{}\b", regex::escape(p.find.trim()));
            Regex::new(&pattern)
                .ok()
                .map(|regex| (regex, p.replace.clone()))
        })
        .collect();

    if rules.is_empty() {
        return;
    }
    for s in segments.iter_mut() {
        for (re, replacement) in &rules {
            // `NoExpand`: the replacement is what the person typed, not a
            // template. Without it `$` starts a capture-group reference, so a
            // dictionary entry replacing something with `cena $5` writes
            // `cena ` — and this runs over every transcript, including one
            // already corrected by hand.
            s.text = re
                .replace_all(&s.text, regex::NoExpand(replacement.as_str()))
                .to_string();
        }

        // Word timings carry the word text too. Without this, highlighting
        // would keep lighting up the old wording.
        let Some(json) = s.words.as_deref() else {
            continue;
        };
        let Ok(mut chunks) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
            continue;
        };
        let mut change = false;
        for chunk in chunks.iter_mut() {
            let Some(text) = chunk["s"].as_str() else {
                continue;
            };
            let mut new = text.to_string();
            for (re, replacement) in &rules {
                new = re
                    .replace_all(&new, regex::NoExpand(replacement.as_str()))
                    .to_string();
            }
            if new != text {
                chunk["s"] = serde_json::Value::String(new);
                change = true;
            }
        }
        if change {
            if let Ok(t) = serde_json::to_string(&chunks) {
                s.words = Some(t);
            }
        }
    }
}

/// Sample density of the waveform. Twelve per second is enough for lively
/// bars; on a very long recording it drops so the total stays under thirty
/// thousand.
/// Must match what the waveform command in main.rs computes, or the same
/// recording would get a different envelope depending on which path made it.
pub const MAX_WAVEFORM_POINTS: f64 = 30_000.0;
pub const EQUALIZER_BAND_COUNT: usize = 24;
pub const EQUALIZER_POINTS_PER_SECOND: usize = 10;

pub fn waveform_density(duration: f64) -> (f64, usize) {
    let points_per_second = if duration > 0.0 {
        (MAX_WAVEFORM_POINTS / duration).min(12.0)
    } else {
        12.0
    };
    let count =
        ((duration * points_per_second).ceil() as usize).clamp(1, MAX_WAVEFORM_POINTS as usize);
    (points_per_second, count)
}

pub(crate) fn waveform_from_wav(
    check: &tools::ToolCheck,
    wav: &Path,
    duration: f64,
) -> Reported<db::WaveformData> {
    let ffmpeg = check
        .ffmpeg
        .as_ref()
        .ok_or_else(|| UserMessage::new("tools.ffmpeg_missing"))?;
    let (points_per_second, count) = waveform_density(duration);
    let points = tools::waveform_amplitude(Path::new(ffmpeg), wav, count)?;
    let equalizer = tools::equalizer_peaks(
        Path::new(ffmpeg),
        wav,
        EQUALIZER_BAND_COUNT,
        EQUALIZER_POINTS_PER_SECOND,
    )?;
    Ok(db::WaveformData {
        points,
        points_per_second,
        equalizer,
        equalizer_points_per_second: EQUALIZER_POINTS_PER_SECOND as f64,
        equalizer_band_count: EQUALIZER_BAND_COUNT,
    })
}

#[cfg(test)]
mod dictionary_tests {
    use super::*;

    fn entry(find: &str, replace: &str) -> db::DictionaryEntry {
        db::DictionaryEntry {
            id: "e".into(),
            find: find.into(),
            replace: replace.into(),
        }
    }

    fn spoken(text: &str) -> Segment {
        Segment {
            id: "s".into(),
            recording_id: "r".into(),
            order: 0,
            start: 0.0,
            end: 1.0,
            text: text.into(),
            speakers: None,
            confidence: None,
            edited: false,
            words: None,
            verified: false,
            original: None,
        }
    }

    /// The defect: `$` in a replacement is a capture-group reference to the
    /// regex crate, so the money the person typed was replaced by nothing.
    #[test]
    fn a_replacement_holding_a_dollar_keeps_it() {
        let mut segments = vec![spoken("stálo to pět set")];
        apply_dictionary(&mut segments, &[entry("pět set", "cena $5")]);
        assert_eq!(segments[0].text, "stálo to cena $5");
    }

    #[test]
    fn a_replacement_is_never_read_as_a_group_reference() {
        // `$1` would have expanded to the first capture group — here the whole
        // match — and written the error back over the correction.
        let mut segments = vec![spoken("součas DNA")];
        apply_dictionary(&mut segments, &[entry("součas", "$1")]);
        assert_eq!(segments[0].text, "$1 DNA");
    }

    #[test]
    fn an_ordinary_replacement_still_works() {
        let mut segments = vec![spoken("součas DNA svého života")];
        apply_dictionary(&mut segments, &[entry("součas", "součást")]);
        assert_eq!(segments[0].text, "součást DNA svého života");
    }

    #[test]
    fn the_word_timings_are_corrected_with_the_same_rule() {
        let mut segment = spoken("cena pět set");
        segment.words = Some(r#"[{"s":"cena","t":0.0},{"s":"pět set","t":0.5}]"#.into());
        let mut segments = vec![segment];
        apply_dictionary(&mut segments, &[entry("pět set", "$500")]);
        let words: Vec<serde_json::Value> =
            serde_json::from_str(segments[0].words.as_deref().unwrap()).unwrap();
        assert_eq!(words[1]["s"].as_str(), Some("$500"));
    }
}
