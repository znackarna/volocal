/**
 * Notes on a recording: the ones that are saved, the one being written, and
 * every way either can change.
 *
 * The first complete feature lifted out of the transcript screen, and a good
 * first one because it has all the parts. Its own data, a draft that is not
 * data yet, four ways to change a saved note, and a rule about destroying one.
 *
 * **What it does not own.** Three things the notes need belong to the screen
 * and are handed in:
 *
 * - `seekTo`, because playing from a moment is the player's business and the
 *   transcript has to scroll with it;
 * - `reveal`, because a note begun from the transcript needs the sidebar's
 *   notes section and the panel itself open, and both of those are the
 *   screen's state;
 * - `onError`, because a failure is told to the reader by the shell.
 *
 * Every write is optimistic and puts itself back when the backend refuses, so
 * that a note never disappears from the screen over a failure nobody saw.
 */
import { useCallback, useState } from "react";
import { api } from "../api";
import { useUserMessage } from "../messages";
import { byNoteOrder, parseNoteTime } from "./notes";
import type { RecordingNote } from "../types";

export interface RecordingNotes {
  state: {
    notes: RecordingNote[];
    /** Whether the composer is up. */
    adding: boolean;
    /** What is written in it, which is not a note until it is saved. */
    draft: string;
    /** The moment it is pinned to, or null for a note about the whole
     *  recording. Zero is a real position, so it cannot stand for "none". */
    draftTime: number | null;
    /** Which saved note is open for editing. */
    openId: string | null;
    /** Half-typed times, by note. A time is only written back when it parses
     *  and fits inside the recording. */
    timeDrafts: Record<string, string>;
  };
  actions: {
    /** Handed the notes that came with the recording. */
    receive: (notes: RecordingNote[]) => void;
    begin: () => void;
    /** A note about this exact moment, written from the transcript. */
    beginAt: (time: number) => void;
    cancel: () => void;
    write: (text: string) => void;
    pinDraft: (time: number | null) => void;
    add: () => Promise<void>;
    open: (id: string | null) => void;
    /** Types into a saved note without writing it back yet. */
    rewrite: (id: string, text: string) => void;
    save: (note: RecordingNote) => Promise<void>;
    setTime: (note: RecordingNote, time: number | null) => Promise<void>;
    writeTime: (id: string, value: string) => void;
    commitTime: (note: RecordingNote, value: string) => Promise<void>;
    remove: (note: RecordingNote) => Promise<void>;
    goTo: (time: number) => void;
  };
}

export function useRecordingNotes({
  recordingId,
  duration,
  seekTo,
  reveal,
  onError,
  reload,
}: {
  recordingId: string;
  /** How long the recording is, so a typed time past its end is refused. */
  duration: number;
  /** Plays from a moment and brings the transcript to it. */
  seekTo: (time: number) => void;
  /** Opens the notes section and the panel, for a note begun elsewhere. */
  reveal: () => void;
  onError: (message: string) => void;
  /** Fetches the recording again, when a refused write has left the screen and
   *  the database disagreeing about more than one note. */
  reload: () => Promise<void>;
}): RecordingNotes {
  const [notes, setNotes] = useState<RecordingNote[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});

  /* A failure from Rust arrives as a code and its values, not as a sentence.
     Turning it into one is the dictionary's job, and doing it here rather than
     handing `String(error)` to the shell is what keeps the message the reader
     sees in their own language. */
  const userMessage = useUserMessage();

  const receive = useCallback((incoming: RecordingNote[]) => setNotes(incoming), []);

  const begin = useCallback(() => {
    // A new note starts loose. Most remarks are about the recording, not about
    // one second of it, and pinning is one click away when it is not.
    setDraft("");
    setDraftTime(null);
    setOpenId(null);
    setAdding(true);
  }, []);

  const beginAt = useCallback(
    (time: number) => {
      setDraft("");
      setDraftTime(time);
      setOpenId(null);
      setAdding(true);
      reveal();
    },
    [reveal]
  );

  const cancel = useCallback(() => {
    setAdding(false);
    setDraft("");
    setDraftTime(null);
  }, []);

  const add = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      const note = await api.addRecordingNote(recordingId, draftTime, text);
      setNotes((current) => [...current, note].sort(byNoteOrder));
      setAdding(false);
      setDraft("");
      setDraftTime(null);
    } catch (error) {
      onError(userMessage(error));
    }
  }, [draft, draftTime, onError, recordingId, userMessage]);

  const rewrite = useCallback((id: string, text: string) => {
    setNotes((current) => current.map((item) => (item.id === id ? { ...item, text } : item)));
  }, []);

  const save = useCallback(
    async (note: RecordingNote) => {
      const text = note.text.trim();
      if (!text) {
        await reload();
        return;
      }
      try {
        await api.updateRecordingNote(note.id, note.time, text, note.done);
        setNotes((current) =>
          current.map((item) => (item.id === note.id ? { ...item, text } : item))
        );
      } catch (error) {
        onError(userMessage(error));
        await reload();
      }
    },
    [onError, reload, userMessage]
  );

  /** Pins a saved note to a moment, or takes it off the timeline entirely. */
  const setTime = useCallback(
    async (note: RecordingNote, next: number | null) => {
      const updated = { ...note, time: next };
      setNotes((current) =>
        current.map((item) => (item.id === note.id ? updated : item)).sort(byNoteOrder)
      );
      try {
        await api.updateRecordingNote(updated.id, updated.time, updated.text, updated.done);
      } catch (error) {
        onError(userMessage(error));
        await reload();
      }
    },
    [onError, reload, userMessage]
  );

  const writeTime = useCallback((id: string, value: string) => {
    setTimeDrafts((current) => ({ ...current, [id]: value }));
  }, []);

  const commitTime = useCallback(
    async (note: RecordingNote, value: string) => {
      const parsed = parseNoteTime(value);
      setTimeDrafts((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
      if (parsed === null || (duration > 0 && parsed > duration)) return;
      await setTime(note, parsed);
    },
    [duration, setTime]
  );

  const remove = useCallback(
    async (note: RecordingNote) => {
      setNotes((current) => current.filter((item) => item.id !== note.id));
      try {
        await api.deleteRecordingNote(note.id);
      } catch (error) {
        onError(userMessage(error));
        setNotes((current) => [...current, note].sort(byNoteOrder));
      }
    },
    [onError, userMessage]
  );

  return {
    state: { notes, adding, draft, draftTime, openId, timeDrafts },
    actions: {
      receive,
      begin,
      beginAt,
      cancel,
      write: setDraft,
      pinDraft: setDraftTime,
      add,
      open: setOpenId,
      rewrite,
      save,
      setTime,
      writeTime,
      commitTime,
      remove,
      goTo: seekTo,
    },
  };
}
