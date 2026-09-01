/**
 * Finding a word in the transcript.
 *
 * Highlighted in place rather than filtered: the archive's search picks a
 * recording, this one is used while reading and correcting, and a block
 * without the ones around it is no use. WebView2 answers Ctrl+F with a find
 * bar of its own, drawn by Windows — the key press is taken before it gets
 * there, in the transcript screen's keyboard handler, which drives this
 * through `open`, `close`, `next` and `previous`.
 *
 * **Whether the bar is up and what is written in it reset together.** Closing
 * forgets the search, so the bar always opens empty. They are two pieces of
 * state and only one owner, which is what keeps that true.
 *
 * Scrolling lives here rather than in the bar. The hit is a block somewhere in
 * a list the bar cannot see, and it is addressed by the id the transcript
 * writes on it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { plain } from "../transcriptText";
import type { Segment } from "../types";

/** Below this a search matches almost everything and means nothing. */
const SHORTEST_SEARCH = 2;

function showBlock(id: string | undefined) {
  if (!id) return;
  document.getElementById(`segment-${id}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

export interface TranscriptSearch {
  state: {
    /** Whether the bar is up. */
    open: boolean;
    query: string;
    /** Which hit is being read, from one. Zero when there are none. */
    at: number;
    total: number;
    /** Whether what is written is long enough to be a search at all. Below the
     *  floor the bar shows no count rather than `0 z 0`, which would read as a
     *  failed search instead of an unfinished word. */
    searching: boolean;
    /** The needle the transcript paints its matches with, or undefined when
     *  there is no search worth painting. */
    needle: string | undefined;
    /** The block being read, so the transcript can mark that one differently
     *  from the others that merely match. */
    hitId: string | undefined;
    /** The bar's field, so the keyboard handler can put the cursor in it. */
    field: React.RefObject<HTMLInputElement>;
  };
  actions: {
    open: () => void;
    close: () => void;
    toggle: () => void;
    write: (query: string) => void;
    next: () => void;
    previous: () => void;
  };
}

export function useTranscriptSearch(segments: Segment[]): TranscriptSearch {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  const needle = plain(query.trim());
  const hits = useMemo(
    () =>
      needle.length < SHORTEST_SEARCH
        ? []
        : segments.filter((s) => plain(s.text).includes(needle)).map((s) => s.id),
    [segments, needle]
  );

  const goTo = useCallback(
    (index: number) => {
      if (hits.length === 0) return;
      const wrapped = (index + hits.length) % hits.length;
      setAt(wrapped);
      showBlock(hits[wrapped]);
    },
    [hits]
  );

  // A new query starts from the top, and the first hit is shown at once
  // rather than waiting for the reader to press the arrow.
  useEffect(() => {
    if (hits.length === 0) return;
    setAt(0);
    showBlock(hits[0]);
  }, [hits]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const raise = useCallback(() => {
    setOpen(true);
    // After the bar exists. Called from the toolbar button, where the press
    // and the render are the same tick.
    window.setTimeout(() => field.current?.focus(), 0);
  }, []);

  const toggle = useCallback(() => {
    if (open) close();
    else raise();
  }, [close, open, raise]);

  const next = useCallback(() => goTo(at + 1), [at, goTo]);
  const previous = useCallback(() => goTo(at - 1), [at, goTo]);

  /* Both halves are memoised, and that is not tidiness.
   *
   * The transcript screen's keyboard handler lists this hook among its
   * dependencies, and the screen re-renders on every tick of the clock — eight
   * times a second while audio plays. A fresh object each render would tear the
   * window's keydown listener down and put it back on every one of them. Before
   * this hook existed the same effect listed `finding`, `findAt` and two stable
   * callbacks, and re-armed only when the search actually changed; these two
   * memos are what keeps that true. */
  const state = useMemo(
    () => ({
      open,
      query,
      at: hits.length === 0 ? 0 : at + 1,
      total: hits.length,
      searching: needle.length >= SHORTEST_SEARCH,
      needle: hits.length > 0 ? needle : undefined,
      hitId: hits[at],
      field,
    }),
    [at, hits, needle, open, query]
  );

  const actions = useMemo(
    () => ({ open: raise, close, toggle, write: setQuery, next, previous }),
    [close, next, previous, raise, toggle]
  );

  return useMemo(() => ({ state, actions }), [actions, state]);
}
