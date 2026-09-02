/**
 * The passage the reader marked, on its way out as files.
 *
 * **A clip is a selection that makes files, not a stored object.** Keeping
 * clips would mean a table, a list, and a rule about what becomes of one when
 * its transcript is rewritten — all in service of something whose whole value
 * is the file that was saved. Nothing here is written to the archive.
 *
 * **And the selection is the reader's own.** Dragging over the words is the
 * gesture people already have for *this bit*; the two-click way that came
 * first — mark a block, mark a later one, watch a bar — was a procedure to
 * learn, and it went on 2 September, the evening it was tried.
 *
 * The clip lands on whole blocks even so: a selection that stops mid-sentence
 * would otherwise cut the audio mid-syllable.
 */
import { useCallback, useMemo, useState } from "react";
import { api } from "../api";
import type { Segment, UserMessage } from "../types";

/** What may come out of one passage. Audio is first because it is the one
 *  thing no other program can make from a transcript. */
export type Shape = "audio" | "txt" | "md" | "srt" | "vtt";

export interface ClipSelection {
  state: {
    /** The passage, once the reader has asked to export one. */
    from: Segment | null;
    to: Segment | null;
    start: number;
    end: number;
    seconds: number;
    /** The dialog is up. */
    saving: boolean;
  };
  actions: {
    /** Take the marked passage and go straight to saving it: *export this* is
     *  not a request to mark something and then think about it. */
    markAndSave: (first: Segment, last: Segment) => void;
    close: () => void;
  };
}

export function useClipSelection(): ClipSelection {
  const [from, setFrom] = useState<Segment | null>(null);
  const [to, setTo] = useState<Segment | null>(null);
  const [saving, setSaving] = useState(false);

  const start = from ? Math.min(from.start, to?.start ?? from.start) : 0;
  const end = from ? Math.max(from.end, to?.end ?? from.end) : 0;

  const markAndSave = useCallback((first: Segment, last: Segment) => {
    // A passage dragged upwards arrives with its ends the other way round.
    const [earlier, later] = first.start <= last.start ? [first, last] : [last, first];
    setFrom(earlier);
    setTo(later);
    setSaving(true);
  }, []);

  const close = useCallback(() => {
    setSaving(false);
    setFrom(null);
    setTo(null);
  }, []);

  return useMemo(
    () => ({
      state: { from, to, start, end, seconds: Math.max(0, end - start), saving },
      actions: { markAndSave, close },
    }),
    [from, to, start, end, saving, markAndSave, close]
  );
}

/** The blocks a text selection touches, read off the screen.
 *
 * Empty when nothing is selected, which is the ordinary case — and why the
 * menu item only appears when there is a passage to export.
 */
export function selectedSegmentIds(): string[] {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  const touched: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>("[id^='segment-']")) {
    if (range.intersectsNode(element)) touched.push(element.id.slice("segment-".length));
  }
  return touched;
}

/** Saving one passage in every shape that was ticked.
 *
 * Several shapes go to a folder and take their suggested names; a single one
 * goes to a file the reader names, which is what anybody exporting one thing
 * expects. The first failure stops the rest, and the reader is told which
 * files did arrive.
 */
export async function saveClip({
  recordingId,
  shapes,
  start,
  end,
  fromZero,
  chooseFile,
  chooseFolder,
  onError,
  onSaved,
}: {
  recordingId: string;
  shapes: Shape[];
  start: number;
  end: number;
  fromZero: boolean;
  chooseFile: (name: string) => Promise<string | null>;
  chooseFolder: () => Promise<string | null>;
  onError: (message: UserMessage) => void;
  onSaved: (paths: string[]) => void;
}): Promise<void> {
  if (shapes.length === 0) return;
  const written: string[] = [];
  try {
    const names = await Promise.all(
      shapes.map((shape) => api.suggestedClipName(recordingId, start, end, shape))
    );

    let destinations: string[];
    if (shapes.length === 1) {
      const chosen = await chooseFile(names[0]);
      if (!chosen) return;
      destinations = [chosen];
    } else {
      const folder = await chooseFolder();
      if (!folder) return;
      destinations = names.map((name) => `${folder}\\${name}`);
    }

    for (const [index, shape] of shapes.entries()) {
      const path = destinations[index];
      written.push(
        shape === "audio"
          ? await api.saveClipAudio(recordingId, start, end, path)
          : await api.saveClipText(recordingId, start, end, shape, path, fromZero)
      );
    }
    onSaved(written);
  } catch (error) {
    if (written.length > 0) onSaved(written);
    onError(error as UserMessage);
  }
}
