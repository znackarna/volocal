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
import { useI18n } from "../i18n";
import { messageCode, useUserMessage } from "../messages";
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
  };
  actions: {
    /** Reads the answer again without doing any work.
     *
     *  **A run that finishes under the open screen would otherwise say
     *  nothing.** The sweep happens at the very end of a transcription, so the
     *  answer arrives after this screen has already asked once and been told
     *  nothing. Without this the reader would have to leave the transcript and
     *  come back to be told half of it was missing. */
    reread: () => Promise<void>;
    fill: () => Promise<void>;
    refuse: () => Promise<void>;
  };
}

export function useSecondLanguage({
  recordingId,
  onError,
  onInfo,
  reload,
}: {
  recordingId: string;
  onError: (message: string) => void;
  /** How many blocks a fill added is said the way every other confirmation on
   *  this screen is said — in the notice bar, which leaves on its own. A strip
   *  of this feature's own with a Close button stood here first, and it was
   *  the one thing on the screen the design system did not have. */
  onInfo: (message: string) => void;
  /** Fetches the recording again. The fill rewrites every block, so nothing on
   *  screen is right until this has run. */
  reload: () => Promise<void> | void;
}): SecondLanguageOffer {
  const userMessage = useUserMessage();
  const { tPlural } = useI18n();
  const [found, setFound] = useState<SecondLanguage | null>(null);
  const [filling, setFilling] = useState(false);

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

  const reread = useCallback(async () => {
    try {
      setFound(await api.secondLanguage(recordingId));
    } catch {
      /* Being unable to ask is not something to interrupt a reader with. */
    }
  }, [recordingId]);

  /* **Stopping it is not a failure.** A fill or a sweep is a run, and the
     bubble's Zrušit reaches it like any other; the backend then answers the
     call that started it with `transcription.cancelled`, because the work it
     was asked for was not done. Every other cancelled run in the application
     is silent, and this one is too: the bar with the question stays, since
     the question was not answered. Asked for on 2026-09-02, the morning a
     cancelled fill put a red notice over the header. */
  const cancelled = (error: unknown) => messageCode(error) === "transcription.cancelled";

  const fill = useCallback(async () => {
    setFilling(true);
    try {
      const count = await api.fillSecondLanguage(recordingId);
      onInfo(tPlural("detail.secondLanguage.added", count));
      /* The transcript on screen is the one from before the fill — every block
         was rewritten, including the ones that did not change, because their
         order did. */
      await reload();
      setFound(await api.secondLanguage(recordingId));
    } catch (error) {
      if (!cancelled(error)) onError(userMessage(error));
    } finally {
      setFilling(false);
    }
  }, [onError, onInfo, recordingId, reload, tPlural, userMessage]);

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

  return {
    state: {
      found,
      offered: found?.state === "offered",
      filling,
    },
    actions: { reread, fill, refuse },
  };
}
