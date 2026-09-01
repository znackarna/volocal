/**
 * What the transcript screen is about: one recording, its blocks, and the few
 * facts drawn from the disk beside them.
 *
 * **It does not distribute what it fetches.** One round trip brings back the
 * recording, its blocks, the speakers, the notes, the dictionary and the tool
 * check — six things belonging to five different owners — and handing them out
 * is the composition root's job, not this hook's. So `load` fetches, keeps the
 * part that is its own, and passes the whole answer to `onLoaded`. A hook that
 * called into the notes, the speakers, the corrections and the language model
 * would be the concentration this split exists to undo, moved one file across.
 *
 * The blocks live here rather than beside the corrections because three
 * features change them — a correction, a speaker being given a block, a live
 * segment arriving mid-run — and each of those is handed `update` rather than
 * a copy of the list.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { preparePlaybackSource } from "../player";
import { useUserMessage } from "../messages";
import type { Detail as DetailData, Segment, Settings, ToolCheck } from "../types";
import type { DictionaryEntry } from "../types";

/** Everything one visit to the backend brought back. */
export interface LoadedRecording {
  detail: DetailData;
  dictionary: DictionaryEntry[];
  aiStatus: Awaited<ReturnType<typeof api.aiEditStatus>>;
  settings: Settings;
  tools: ToolCheck;
}

export interface RecordingDetail {
  state: {
    title: string;
    path: string;
    duration: number;
    status: string;
    /** Which folder holds it, so the menu can offer to move it. */
    folder: string | null;
    /** Why the last transcription failed. Only set when status is `error`. */
    error: string | null;
    language: string;
    segments: Segment[];
    /** The source file may have been deleted after transcription — the text
     *  stays in the database, but there is nothing to play. */
    sourceMissing: boolean;
    /** Whether the speaker-separation tools are installed. */
    speakersReady: boolean;
  };
  actions: {
    load: () => Promise<void>;
    update: (change: (segments: Segment[]) => Segment[]) => void;
    /** A run has begun: the status says so and the old failure goes, or the
     *  message would linger under a progress bar for a run that is going
     *  fine. */
    markTranscribing: (language?: string) => void;
    rename: (title: string) => void;
    /** The source has been found again somewhere else. */
    markSourceFound: () => void;
  };
}

export function useRecordingDetail({
  recordingId,
  onError,
  onLoaded,
}: {
  recordingId: string;
  onError: (message: string) => void;
  /** Handed everything the visit brought back, so the screen can give each
   *  part to whoever owns it. */
  onLoaded: (loaded: LoadedRecording) => void;
}): RecordingDetail {
  const userMessage = useUserMessage();

  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [speakersReady, setSpeakersReady] = useState(false);

  /* State used to be set piecemeal between `await`s, which on an hour-long
     transcript meant three consecutive renders of a thousand-block list.
     Neither the dictionary nor the file check needs to wait for the blocks;
     both are fetched alongside them. */
  const load = useCallback(async () => {
    try {
      const d = await api.detail(recordingId);
      /* The transcription pipeline prepares the precise MP3 playback copy
         itself. Starting the detail prewarm as well would run a second ffmpeg
         conversion for the same source. Finished and legacy recordings still
         use this best-effort fallback when their cache does not exist yet. */
      if (d.recording.status !== "transcribing") {
        preparePlaybackSource(recordingId, d.recording.path);
      }
      const [dictionary, exists, aiStatus, settings, tools] = await Promise.all([
        api.dictionary(),
        api.fileExists(d.recording.path),
        api.aiEditStatus(recordingId),
        api.loadSettings(),
        api.checkTools(),
      ]);
      setTitle(d.recording.title);
      setPath(d.recording.path);
      setDuration(d.recording.duration);
      setStatus(d.recording.status);
      setFolder(d.recording.folder);
      setError(d.recording.error ? userMessage(d.recording.error) : null);
      setLanguage(d.recording.language);
      setSegments(d.segments);
      setSourceMissing(!exists);
      setSpeakersReady(tools.issues_diarization.length === 0);
      onLoaded({ detail: d, dictionary, aiStatus, settings, tools });
    } catch (e) {
      onError(userMessage(e));
    }
  }, [onError, onLoaded, recordingId, userMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const markTranscribing = useCallback((chosenLanguage?: string) => {
    if (chosenLanguage !== undefined) setLanguage(chosenLanguage);
    setStatus("transcribing");
    // Clear the previous failure, or the old message would linger under a
    // progress bar for a run that is going fine.
    setError(null);
  }, []);

  return {
    state: {
      title,
      path,
      duration,
      status,
      folder,
      error,
      language,
      segments,
      sourceMissing,
      speakersReady,
    },
    actions: {
      load,
      update: setSegments,
      markTranscribing,
      rename: setTitle,
      markSourceFound: () => setSourceMissing(false),
    },
  };
}
