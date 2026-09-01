/**
 * The folder the application watches, and what it does with what it finds.
 *
 * **The poll is not gated on the setting.** The shell asks every five seconds
 * whatever the setting says, and the backend answers with nothing when the
 * folder is switched off. That is what makes `scan_watch_folder` safe to call
 * unconditionally, and it is why a folder switched on in Settings is noticed
 * without anything having to tell this hook. Do not add the check here: it
 * would change when that happens, and a test pins the current behaviour.
 *
 * A modest poll rather than a permanent operating-system watcher, deliberately.
 * It keeps the feature portable and, together with the backend's two-scan
 * stability check, never opens a file midway through a copy.
 *
 * **Three answers to a found file, and one of them is not asked.** Transcribe,
 * add without transcribing, ignore — and, with automatic transcription on, the
 * run starts by itself: the files arrive while nobody is looking at the screen,
 * so a question in the archive would only keep them waiting.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { useUserMessage } from "../messages";
import type { WatchFolderCandidate } from "../types";

/** The scan answers every five seconds, almost always with the same thing —
 *  usually with nothing at all. A fresh array is a new reference, and storing
 *  it re-rendered the whole application twelve times a minute for a list that
 *  had not changed. */
function sameCandidates(a: WatchFolderCandidate[], b: WatchFolderCandidate[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (candidate, index) =>
      candidate.path === b[index].path && candidate.fingerprint === b[index].fingerprint
  );
}

const key = (candidate: WatchFolderCandidate) => `${candidate.path}:${candidate.fingerprint}`;

export interface WatchFolder {
  state: {
    candidates: WatchFolderCandidate[];
    /** Something is being decided about them right now, so the scan holds off
     *  and the archive's buttons go quiet. */
    deciding: boolean;
  };
  actions: {
    /** Imports them and starts a run, asking whatever the shell asks first. */
    transcribe: (candidates: WatchFolderCandidate[]) => Promise<void>;
    /** Imports them and leaves them alone. */
    add: (candidates: WatchFolderCandidate[]) => Promise<void>;
    ignore: (candidates: WatchFolderCandidate[]) => Promise<void>;
  };
}

export function useWatchFolder({
  automatic,
  beginTranscription,
  runTranscription,
  reload,
  onError,
  onInfo,
}: {
  /** Whether a found file is transcribed without being asked about. */
  automatic: boolean;
  /** The shell's door, which asks about speakers when they are being
   *  separated. */
  beginTranscription: (ids: string[]) => Promise<boolean>;
  /** The same run without the questions, for the automatic path — an automatic
   *  import that opens a modal is not automatic. */
  runTranscription: (ids: string[], language: undefined, speakers: null) => Promise<unknown>;
  reload: () => Promise<void>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}): WatchFolder {
  const { tPlural } = useI18n();
  const userMessage = useUserMessage();

  const [candidates, setCandidates] = useState<WatchFolderCandidate[]>([]);
  const [deciding, setDeciding] = useState(false);

  const scanning = useRef(false);
  const decidingRef = useRef(false);
  const lastError = useRef("");

  /* Read through refs, because the poll must not be torn down and re-armed
     every time the setting changes or a decision starts. */
  const automaticRef = useRef(automatic);
  automaticRef.current = automatic;
  const autoRef = useRef<((files: WatchFolderCandidate[]) => void) | null>(null);

  /** Runs one decision at a time, and takes the files it handled off the list
   *  when it is done. */
  const decide = useCallback(
    async (
      chosen: WatchFolderCandidate[],
      act: (chosen: WatchFolderCandidate[]) => Promise<void>,
      clearAll = false
    ) => {
      if (chosen.length === 0 || decidingRef.current) return;
      decidingRef.current = true;
      setDeciding(true);
      try {
        await act(chosen);
        if (clearAll) {
          setCandidates([]);
        } else {
          const handled = new Set(chosen.map(key));
          setCandidates((current) => current.filter((c) => !handled.has(key(c))));
        }
      } catch (error) {
        onError(userMessage(error));
      } finally {
        decidingRef.current = false;
        setDeciding(false);
      }
    },
    [onError, userMessage]
  );

  const transcribe = useCallback(
    (chosen: WatchFolderCandidate[]) =>
      decide(chosen, async (files) => {
        const added = await api.importWatchFolderFiles(files);
        // One question for the whole batch: they came out of the same folder
        // and are almost always the same kind of recording.
        await beginTranscription(added.map((recording) => recording.id));
        await reload();
        onInfo(tPlural("app.watchFolder.transcribing", added.length));
      }),
    [beginTranscription, decide, onInfo, reload, tPlural]
  );

  const add = useCallback(
    (chosen: WatchFolderCandidate[]) =>
      decide(chosen, async (files) => {
        const added = await api.importWatchFolderFiles(files);
        await reload();
        onInfo(tPlural("app.watchFolder.added", added.length));
      }),
    [decide, onInfo, reload, tPlural]
  );

  const ignore = useCallback(
    (chosen: WatchFolderCandidate[]) =>
      decide(chosen, (files) => api.ignoreWatchFolderFiles(files)),
    [decide]
  );

  const autoTranscribe = useCallback(
    (chosen: WatchFolderCandidate[]) =>
      void decide(
        chosen,
        async (files) => {
          const added = await api.importWatchFolderFiles(files);
          await runTranscription(added.map((recording) => recording.id), undefined, null);
          await reload();
          onInfo(tPlural("app.watchFolder.transcribing", added.length));
        },
        true
      ),
    [decide, onInfo, reload, runTranscription, tPlural]
  );

  useEffect(() => {
    autoRef.current = autoTranscribe;
  }, [autoTranscribe]);

  useEffect(() => {
    let alive = true;
    const scan = async () => {
      if (scanning.current || decidingRef.current) return;
      scanning.current = true;
      try {
        const found = await api.scanWatchFolder();
        if (!alive || decidingRef.current) return;
        lastError.current = "";
        if (found.length > 0 && automaticRef.current && autoRef.current) {
          autoRef.current(found);
          return;
        }
        setCandidates((current) => (sameCandidates(current, found) ? current : found));
      } catch (error) {
        const message = userMessage(error);
        if (alive && lastError.current !== message) {
          lastError.current = message;
          onError(message);
        }
      } finally {
        scanning.current = false;
      }
    };

    const initial = window.setTimeout(scan, 1200);
    const interval = window.setInterval(scan, 5000);
    return () => {
      alive = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [onError, userMessage]);

  return { state: { candidates, deciding }, actions: { transcribe, add, ignore } };
}
