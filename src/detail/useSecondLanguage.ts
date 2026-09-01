/**
 * A language this recording holds that the transcript does not.
 *
 * whisper is given one language for the whole file, so a recording where two
 * people speak two languages comes back as one of them with the other silently
 * absent — and the text still looks complete, because the blocks' end times run
 * over the speech nobody wrote down. Measured on an interpreted talk: one
 * caption out of 494 was the second language, and close to half the speech was
 * missing.
 *
 * The backend notices it at the end of a transcription. This holds the answer
 * and the two things a reader can do about it, and it is the whole of the
 * feature on this screen — the work itself is a run like a transcription, with
 * the same progress, the same queue and the same cancelling.
 *
 * **What it is given rather than owns.** Telling the reader, and fetching the
 * recording again once the fill has rewritten it. Both belong to the screen.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useUserMessage } from "../messages";
import type { SecondLanguage } from "../types";

export interface SecondLanguageOffer {
  state: {
    /** What the sweep found, or null — which is the ordinary answer and draws
     *  nothing at all. */
    found: SecondLanguage | null;
    /** Whether the offer is one the reader has still to answer. A filled or
     *  refused one is kept in the archive but says nothing on screen. */
    offered: boolean;
    /** The fill has been asked for and has not come back. */
    filling: boolean;
    /** How many blocks the last fill added, until the reader moves on. */
    added: number | null;
  };
  actions: {
    /** Asks again, for a transcript made before any of this existed. */
    look: () => Promise<void>;
    fill: () => Promise<void>;
    refuse: () => Promise<void>;
    /** The reader has read the count; stop saying it. */
    clearCount: () => void;
  };
}

export function useSecondLanguage({
  recordingId,
  onError,
  reload,
}: {
  recordingId: string;
  onError: (message: string) => void;
  /** Fetches the recording again. The fill rewrites every block, so nothing on
   *  screen is right until this has run. */
  reload: () => Promise<void> | void;
}): SecondLanguageOffer {
  const userMessage = useUserMessage();
  const [found, setFound] = useState<SecondLanguage | null>(null);
  const [filling, setFilling] = useState(false);
  const [added, setAdded] = useState<number | null>(null);

  /* Asked for on its own rather than arriving with the recording. The detail
     command is what every screen waits for before it draws anything, and a
     question about a transcript is not worth holding that up — it may not even
     have an answer. */
  useEffect(() => {
    let alive = true;
    api
      .secondLanguage(recordingId)
      .then((answer) => {
        if (alive) setFound(answer);
      })
      .catch(() => {
        /* Being unable to ask is not something to interrupt a reader with.
           The offer simply does not appear. */
      });
    return () => {
      alive = false;
    };
  }, [recordingId]);

  const look = useCallback(async () => {
    setFilling(true);
    try {
      setFound(await api.sweepSecondLanguage(recordingId));
    } catch (error) {
      onError(userMessage(error));
    } finally {
      setFilling(false);
    }
  }, [onError, recordingId, userMessage]);

  const fill = useCallback(async () => {
    setFilling(true);
    setAdded(null);
    try {
      const count = await api.fillSecondLanguage(recordingId);
      setAdded(count);
      /* The transcript on screen is the one from before the fill — every block
         was rewritten, including the ones that did not change, because their
         order did. */
      await reload();
      setFound(await api.secondLanguage(recordingId));
    } catch (error) {
      onError(userMessage(error));
    } finally {
      setFilling(false);
    }
  }, [onError, recordingId, reload, userMessage]);

  const refuse = useCallback(async () => {
    /* Off the screen at once. The write is what makes it stay gone; waiting
       for it would leave the bar standing under a press that did work. */
    setFound((current) => (current ? { ...current, state: "refused" } : current));
    try {
      await api.refuseSecondLanguage(recordingId);
    } catch (error) {
      onError(userMessage(error));
      setFound(await api.secondLanguage(recordingId).catch(() => null));
    }
  }, [onError, recordingId, userMessage]);

  const clearCount = useCallback(() => setAdded(null), []);

  return {
    state: {
      found,
      offered: found?.state === "offered",
      filling,
      added,
    },
    actions: { look, fill, refuse, clearCount },
  };
}
