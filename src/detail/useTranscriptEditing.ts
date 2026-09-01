/**
 * Correcting the transcript: rewriting a block, confirming an uncertain one,
 * and the dictionary entry a one-word correction offers to become.
 *
 * **Two editors, two pieces of state.** The transcript and the sidebar's review
 * list show the same block, and sharing one id would open both at once — two
 * textareas over one record, whichever blurred last winning.
 *
 * **The dictionary grows by being used.** When exactly one word changed, the
 * pair is offered as an entry rather than left for somebody to fill in a form
 * later. Saving it applies it to the rest of the recording too, because the
 * same word usually occurs several times and fixing each by hand is wasted
 * work.
 *
 * **What it is given rather than owns.** The blocks and one named way to change
 * them, since a correction is a change to a block. Telling the reader, fetching
 * the recording again, and marking the improved document stale — a rewritten
 * transcript makes the document made from it old.
 */
import { useCallback, useMemo, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { useUserMessage } from "../messages";
import { CONFIDENCE_THRESHOLD } from "../types";
import type { DictionaryEntry, Segment } from "../types";

/** Strips the punctuation off a word, so `slovo,` and `slovo` are one term. */
const bareWord = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

export interface TranscriptEditing {
  state: {
    /** Which block the transcript has open for rewriting. */
    editing: string | null;
    /** Which block the review list has open. Separate on purpose. */
    editingUncertain: string | null;
    /** Blocks the machine was unsure of and nobody has confirmed. */
    uncertain: Segment[];
    /** What this recording was corrected on, in transcript order. Only blocks
     *  whose original is known: a row is `před → po`, and one that cannot say
     *  what changed is a paragraph, not a correction. */
    edited: Segment[];
    dictionary: DictionaryEntry[];
    /** A one-word correction waiting to be offered to the dictionary. */
    suggestion: { z: string; na: string } | null;
  };
  actions: {
    receiveDictionary: (entries: DictionaryEntry[]) => void;
    start: (segment: Segment) => void;
    stop: () => void;
    startUncertain: (id: string | null) => void;
    /** Writes a rewritten block back, and offers the dictionary entry. */
    save: (segment: Segment, text: string) => Promise<void>;
    /** Marks an uncertain block as read and correct. */
    confirm: (segment: Segment) => Promise<void>;
    /** Accepts the offered dictionary entry and applies it to the rest. */
    acceptSuggestion: () => Promise<void>;
    dismissSuggestion: () => void;
  };
}

export function useTranscriptEditing({
  recordingId,
  segments,
  updateSegments,
  onError,
  onInfo,
  markAiStale,
  reload,
}: {
  recordingId: string;
  segments: Segment[];
  updateSegments: (change: (segments: Segment[]) => Segment[]) => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  markAiStale: () => void;
  reload: () => Promise<void>;
}): TranscriptEditing {
  const { t, tPlural } = useI18n();
  const userMessage = useUserMessage();

  const [editing, setEditing] = useState<string | null>(null);
  const [editingUncertain, setEditingUncertain] = useState<string | null>(null);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [suggestion, setSuggestion] = useState<{ z: string; na: string } | null>(null);

  const uncertain = useMemo(
    () => segments.filter((s) => (s.confidence ?? 1) < CONFIDENCE_THRESHOLD && !s.verified),
    [segments]
  );

  const edited = useMemo(
    () => segments.filter((s) => s.edited && s.original !== null),
    [segments]
  );

  const start = useCallback((segment: Segment) => setEditing(segment.id), []);
  const stop = useCallback(() => setEditing(null), []);

  const confirm = useCallback(
    async (segment: Segment) => {
      updateSegments((p) => p.map((x) => (x.id === segment.id ? { ...x, verified: true } : x)));
      try {
        await api.markVerified(segment.id, true);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, updateSegments, userMessage]
  );

  const save = useCallback(
    async (segment: Segment, newText: string) => {
      const trimmedText = newText.trim();
      setEditing(null);
      if (trimmedText === segment.text) return;

      try {
        await api.updateSegment(segment.id, trimmedText);
        updateSegments((s) =>
          s.map((x) =>
            x.id === segment.id
              ? // `words` has to go, not just be left alone. The segment is
                // rendered from the stored word timings, not from `text` —
                // that is what makes clicking a word seek the audio. Keep
                // them and the screen goes on showing the old wording, even
                // though the new one is already saved. The backend drops them
                // for the same reason; this mirrors it so the change is
                // visible at once instead of after a reload.
                //
                // `original` mirrors the backend's COALESCE for the same
                // reason: the first rewrite records what the machine wrote,
                // later ones leave that record alone. Without it the Opravy
                // list — which only shows segments whose original is known —
                // learned about a fresh correction only after a reload.
                {
                  ...x,
                  text: trimmedText,
                  edited: true,
                  verified: true,
                  words: null,
                  original: x.original ?? x.text,
                }
              : x
          )
        );
        markAiStale();

        // When exactly one word changed, offer to remember it. The dictionary
        // then grows by being used, rather than by somebody filling it in.
        const old = segment.text.split(/\s+/);
        const newWords = trimmedText.split(/\s+/);
        if (old.length === newWords.length) {
          const differences = old
            .map((w, i) => [w, newWords[i]] as const)
            .filter(([a, b]) => a !== b);
          if (differences.length === 1) {
            const [z, na] = differences[0];
            const zz = bareWord(z);
            const nn = bareWord(na);
            const alreadyExists = dictionary.some(
              (p) => p.find.toLowerCase() === zz.toLowerCase()
            );
            if (zz && nn && zz.toLowerCase() !== nn.toLowerCase() && !alreadyExists) {
              setSuggestion({ z: zz, na: nn });
            }
          }
        }
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [dictionary, markAiStale, onError, updateSegments, userMessage]
  );

  const acceptSuggestion = useCallback(async () => {
    if (!suggestion) return;
    const { z, na } = suggestion;
    setSuggestion(null);
    try {
      const entry = await api.addDictionaryEntry(z, na);
      setDictionary((s) => [...s, entry]);
      // The dictionary used to take effect only in the next transcription.
      // The same word usually occurs several times in a recording, and fixing
      // each by hand is wasted work.
      const changesApplied = await api.applyDictionary(recordingId);
      if (changesApplied > 0) await reload();
      // Always report, even when nothing else changed. Without confirmation
      // there is no telling whether the term was saved at all.
      // Zero is not a grammatical form of the sentence below, it is a different
      // sentence, so it keeps its own key.
      onInfo(
        changesApplied === 0
          ? t("detail.dictionary.savedNoOther", { from: z, to: na })
          : tPlural("detail.dictionary.savedApplied", changesApplied, { from: z, to: na })
      );
    } catch (e) {
      onError(userMessage(e));
    }
  }, [onError, onInfo, recordingId, reload, suggestion, t, tPlural, userMessage]);

  return {
    state: { editing, editingUncertain, uncertain, edited, dictionary, suggestion },
    actions: {
      receiveDictionary: setDictionary,
      start,
      stop,
      startUncertain: setEditingUncertain,
      save,
      confirm,
      acceptSuggestion,
      dismissSuggestion: () => setSuggestion(null),
    },
  };
}
