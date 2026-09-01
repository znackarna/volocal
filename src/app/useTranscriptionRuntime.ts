/**
 * Everything the backend says while it is working, and everything the screens
 * read to know that it is.
 *
 * Seven event streams arrive here and nowhere else. Transcription progress,
 * the words as they are written, the two ways a run can end, the language
 * model's own progress, and the two halves of a download. The archive and the
 * transcript screen are both told from here, because a run started on one goes
 * on while the reader walks to the other.
 *
 * **The alive guard is not ceremony.** `listen` resolves asynchronously; if
 * the effect is torn down before it resolves, a naive cleanup unsubscribes
 * nothing and the listener is left hanging — events would then be handled
 * twice.
 *
 * **The listeners are armed once, and everything they need arrives through a
 * ref.** The shell re-renders often — a progress event, a notice, a folder
 * opening — and an effect that listed its callbacks among its dependencies
 * would unsubscribe all seven and re-subscribe them asynchronously on each of
 * those renders, leaving a window in which a backend event has nowhere to
 * land. The ref is written on every render, so a handler armed at mount still
 * calls the current callback.
 *
 * **A run is over for a recording whichever kind it was.** Both terminal
 * events clear the job state. Without that the diarizing flag never comes
 * down: the transcript screen keeps a bubble frozen at 100 %, hides the
 * recording's own actions, and — because the player is drawn only when nothing
 * is running — leaves the recording unplayable until the application is
 * restarted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useProgressMessage, useUserMessage } from "../messages";
import type {
  AiEditProgress,
  DownloadProgress,
  LiveSegment,
  TranscriptionProgress,
  UserMessage,
} from "../types";

/** The order the pipeline goes through. Used only to spot a report that
 *  arrives out of turn. */
const PHASE_ORDER = [
  // A run that found another one ahead of it starts here, before it has done
  // anything. Listing it keeps a late report from throwing the caption back to
  // the queue after the work has begun.
  "queued",
  "preparation",
  "playback",
  "transcription",
  "diarization",
  "saving",
  // Written in after the transcript is saved, so it comes after `saving`: a
  // report from it must not be dropped as a step backwards.
  "second_language",
];

/** Phases that end a run. After one of them anything may follow — a new run
 *  legitimately starts from the beginning. */
const FINAL_PHASES = ["complete", "error", "cancelled"];

/**
 * Should this report replace the one currently shown?
 *
 * Progress arrives from several places at once: the conversion, the thread
 * reading whisper's output, diarization. They are not synchronised with each
 * other, so a late report can turn up after a newer one and throw the caption
 * back a step — which looked like the label flicking between "Převádím zvuk"
 * and "Přepisuji" at random. Anything that would move the run backwards is
 * dropped; going back is only allowed once the previous run has ended.
 */
export function keepsMovingForward(
  previous: TranscriptionProgress | undefined,
  next: TranscriptionProgress
): boolean {
  if (!previous) return true;
  if (FINAL_PHASES.includes(previous.phase)) return true;
  if (FINAL_PHASES.includes(next.phase)) return true;

  const before = PHASE_ORDER.indexOf(previous.phase);
  const after = PHASE_ORDER.indexOf(next.phase);
  if (before === -1 || after === -1) return true;
  if (after !== before) return after > before;
  return next.percent >= previous.percent;
}

export interface TranscriptionRuntime {
  state: {
    /** Where each run stands, by recording. */
    progress: Record<string, TranscriptionProgress>;
    /** Where each language-model run stands, by recording. */
    aiProgress: Record<string, AiEditProgress>;
    /** The words as they are written, the tail of them. */
    liveSegments: Record<string, LiveSegment[]>;
    /** Whose speakers are being separated right now. The screens cannot tell
     *  from the progress alone, because the first event arrives a moment after
     *  the run is asked for. */
    diarizingIds: string[];
    /** What is coming down, if anything. */
    downloading: DownloadProgress | null;
  };
  actions: {
    /** A run is about to start on these recordings. A finished run leaves
     *  `complete` behind, and the screens read that as *the work is over* the
     *  moment a new one starts — so the stale entry goes before the first
     *  event of the new run arrives. The live tail goes with it, and that one
     *  is worse than stale: the screens render it while the new run reports two
     *  percent, so a re-transcription would open with the old text. */
    startingRun: (ids: string[], diarizeOnly: boolean) => void;
    /** The run never began — the shell was refused, or the backend was. */
    runRefused: (ids: string[]) => void;
    clearDownload: () => void;
  };
}

export function useTranscriptionRuntime({
  reload,
  reloadToolCheck,
  onError,
}: {
  reload: () => void;
  reloadToolCheck: () => void;
  onError: (message: string) => void;
}): TranscriptionRuntime {
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();

  /* Everything the handlers reach for, kept current without being a reason to
     re-arm them. See the note at the top. */
  const latest = useRef({ reload, reloadToolCheck, onError, userMessage, progressMessage });
  latest.current = { reload, reloadToolCheck, onError, userMessage, progressMessage };

  const [progress, setProgress] = useState<Record<string, TranscriptionProgress>>({});
  const [aiProgress, setAiProgress] = useState<Record<string, AiEditProgress>>({});
  const [liveSegments, setLiveSegments] = useState<Record<string, LiveSegment[]>>({});
  const [diarizingIds, setDiarizingIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<DownloadProgress | null>(null);

  const startingRun = useCallback((ids: string[], diarizeOnly: boolean) => {
    setProgress((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
    setLiveSegments((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
    if (diarizeOnly) setDiarizingIds((current) => [...new Set([...current, ...ids])]);
  }, []);

  const runRefused = useCallback((ids: string[]) => {
    setDiarizingIds((current) => current.filter((x) => !ids.includes(x)));
  }, []);

  useEffect(() => {
    let alive = true;
    const unlisten: Array<() => void> = [];
    const add = (p: Promise<() => void>) => p.then((f) => (alive ? unlisten.push(f) : f()));

    add(
      listen<TranscriptionProgress>("transcription:status", (u) => {
        setProgress((p) => {
          const previous = p[u.payload.recording_id];
          if (!keepsMovingForward(previous, u.payload)) return p;
          return { ...p, [u.payload.recording_id]: u.payload };
        });
      })
    );

    add(
      listen<LiveSegment>("transcription:segment", (u) => {
        const s = u.payload;
        setLiveSegments((z) => {
          const existing = z[s.recording_id] ?? [];
          // Guard against the same event arriving twice. Identical text at the
          // same time is a duplicate, not something said twice.
          const last = existing[existing.length - 1];
          if (last && last.text === s.text && last.start === s.start) return z;
          // Keep only the tail: a few lines are all the archive can show.
          return { ...z, [s.recording_id]: [...existing, s].slice(-40) };
        });
      })
    );

    const finishJob = (id: string) => {
      if (!id) return;
      setDiarizingIds((current) => current.filter((x) => x !== id));
      setLiveSegments((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    };

    add(
      listen<string>("transcription:complete", (u) => {
        finishJob(u.payload);
        latest.current.reload();
      })
    );

    add(
      listen<AiEditProgress>("ai-edit:progress", (u) => {
        const next = u.payload;
        const terminal = ["complete", "error", "cancelled"].includes(next.phase);
        setAiProgress((current) => {
          if (!terminal) return { ...current, [next.recording_id]: next };
          if (!(next.recording_id in current)) return current;
          const updated = { ...current };
          delete updated[next.recording_id];
          return updated;
        });
        if (next.phase === "error")
          latest.current.onError(latest.current.progressMessage(next.description));
      })
    );

    add(
      listen<DownloadProgress>("download:progress", (u) => {
        const next = u.payload;
        /* `complete` here is one component of the bundle finishing, not the
           bundle — only `download:complete` says that. Keeping the last
           component up until then is what stops the bubble flickering off and
           on between files.

           `waiting` is the one that must not take the bubble: it arrives for
           every component put in the queue, including the ones behind the one
           being fetched, and the bubble would have named the last of them at
           0 % while another was at 40. */
        if (next.phase === "waiting") return;
        /* **Cleared only by the component it is naming.** Stopping a queued row
           while another one downloads used to take the bubble down with it, and
           during an `extracting` phase there are no further ticks to bring it
           back — so the one thing still working reported nothing until it
           finished. */
        if (["error", "cancelled"].includes(next.phase)) {
          setDownloading((current) => (current && current.id !== next.id ? current : null));
          return;
        }
        setDownloading(next);
      })
    );

    add(
      listen<string[]>("download:complete", () => {
        setDownloading(null);
        /* **Nothing writes the chosen model here, and nothing needs to.** What
           stood here read a `localStorage` record and wrote `settings.model`
           when the component was absent from this run's list of failures —
           which is not the same question as *did the file arrive*. A component
           that was never part of the run is absent from that list too, so an
           unrelated download finishing could write a model that had never
           landed.

           `resolve_transcription_model` in `tools.rs` asks the disk instead,
           every time anything is checked. There is no note to keep in step, so
           there is no note to go stale. */
        latest.current.reloadToolCheck();
      })
    );

    add(
      listen<[string, UserMessage]>("transcription:error", (u) => {
        finishJob(u.payload[0]);
        latest.current.onError(latest.current.userMessage(u.payload[1]));
        latest.current.reload();
      })
    );

    return () => {
      alive = false;
      unlisten.forEach((f) => f());
    };
    // Armed once. Everything that changes is read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state: { progress, aiProgress, liveSegments, diarizingIds, downloading },
    actions: {
      startingRun,
      runRefused,
      clearDownload: () => setDownloading(null),
    },
  };
}
