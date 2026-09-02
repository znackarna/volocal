/**
 * One stretch of a transcript, chosen to be cut out of it.
 *
 * **A clip is a selection, not a thing.** Nothing is stored: the reader marks
 * a run of blocks, the files come out, and the selection is gone. Keeping
 * clips would mean a table, a list, and a rule about what becomes of one when
 * its transcript is rewritten — all in service of something whose whole value
 * is the file that was saved.
 *
 * **Blocks, not a drag along the waveform.** The blocks are already the units
 * a person reads and quotes in, their edges are where sentences actually
 * begin, and a click is exact where a drag over an hour of audio is not.
 *
 * The hook is handed `playRange`, the blocks, and the two ways of telling the
 * reader something. It owns neither the player nor the dialog: the screen
 * composes those, as every controller here does.
 */
import { useCallback, useMemo, useState } from "react";
import { api } from "../api";
import type { Segment, UserMessage } from "../types";

export interface ClipSelection {
  state: {
    /** The first block of the clip, once one is chosen. */
    from: Segment | null;
    /** The last, once the reader has closed the range. Equal to `from` while
     *  a single block is selected — one block is a legitimate clip. */
    to: Segment | null;
    /** Whether anything is selected at all, which is what draws the bar. */
    active: boolean;
    /** The clip's bounds in the recording's own clock. */
    start: number;
    end: number;
    seconds: number;
    /** Which blocks are inside, by id, for the highlight on the transcript.
     *  A Set with a stable identity while the selection does not change: the
     *  rows are memoised and a fresh Set every render would repaint the lot on
     *  every tick of the clock. */
    inside: ReadonlySet<string>;
    /** The save dialog is open. */
    saving: boolean;
  };
  actions: {
    /** Start a clip at this block, or — when one is already started and this
     *  block is later — close the range on it. */
    beginOrExtend: (segment: Segment) => void;
    clear: () => void;
    play: () => void;
    openSave: () => void;
    closeSave: () => void;
  };
}

/** The blocks a clip covers: the ones that begin inside it.
 *
 *  A block straddling the end comes whole. Somebody quoting a passage wants
 *  the sentence they pointed at, not its first half. The backend selects by
 *  the same rule, so what is marked on screen is what comes out of the file. */
export function insideClip(segments: Segment[], start: number, end: number): Segment[] {
  return segments.filter((s) => s.start >= start - 0.0005 && s.start < end);
}

export function useClipSelection({
  segments,
  playRange,
}: {
  segments: Segment[];
  playRange: (from: number, to: number) => void;
}): ClipSelection {
  const [from, setFrom] = useState<Segment | null>(null);
  const [to, setTo] = useState<Segment | null>(null);
  const [saving, setSaving] = useState(false);

  const start = from ? Math.min(from.start, to?.start ?? from.start) : 0;
  const end = from ? Math.max(from.end, to?.end ?? from.end) : 0;

  const inside = useMemo(() => {
    if (!from) return new Set<string>();
    return new Set(insideClip(segments, start, end).map((s) => s.id));
  }, [segments, from, start, end]);

  const beginOrExtend = useCallback(
    (segment: Segment) => {
      setFrom((current) => {
        // No clip yet, or the reader pointed at something before the start:
        // this becomes the beginning and the range opens again.
        if (!current || segment.start < current.start) {
          setTo(null);
          return segment;
        }
        setTo(segment);
        return current;
      });
    },
    []
  );

  const clear = useCallback(() => {
    setFrom(null);
    setTo(null);
    setSaving(false);
  }, []);

  const play = useCallback(() => {
    if (!from) return;
    playRange(start, end);
  }, [from, start, end, playRange]);

  const openSave = useCallback(() => {
    if (!from) return;
    setSaving(true);
  }, [from]);

  const closeSave = useCallback(() => setSaving(false), []);

  return useMemo(
    () => ({
      state: {
        from,
        to,
        active: from !== null,
        start,
        end,
        seconds: Math.max(0, end - start),
        inside,
        saving,
      },
      actions: { beginOrExtend, clear, play, openSave, closeSave },
    }),
    [from, to, start, end, inside, saving, beginOrExtend, clear, play, openSave, closeSave]
  );
}

/** Saving one clip, whichever of the four shapes was asked for.
 *
 *  Kept beside the selection rather than inside it: the selection is what the
 *  screen draws from on every render, and writing a file is something that
 *  happens once. `api` is reached directly here — the dialog has no state
 *  worth a controller of its own. */
export async function saveClip({
  recordingId,
  format,
  start,
  end,
  fromZero,
  suggested,
  choose,
  onError,
  onSaved,
}: {
  recordingId: string;
  format: "audio" | "txt" | "md" | "srt" | "vtt";
  start: number;
  end: number;
  fromZero: boolean;
  suggested: string;
  choose: (name: string) => Promise<string | null>;
  onError: (message: UserMessage) => void;
  onSaved: (path: string) => void;
}): Promise<void> {
  try {
    const path = await choose(suggested);
    if (!path) return;
    const written =
      format === "audio"
        ? await api.saveClipAudio(recordingId, start, end, path)
        : await api.saveClipText(recordingId, start, end, format, path, fromZero);
    onSaved(written);
  } catch (error) {
    onError(error as UserMessage);
  }
}
