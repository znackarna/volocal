// @vitest-environment jsdom
/**
 * Marking a stretch of transcript to cut out of it.
 *
 * Two things are worth holding here. Which blocks a clip covers — because the
 * screen and the backend select by the same rule and a difference between them
 * would mean the file is not what was highlighted. And the identity of the set
 * of chosen ids, because the transcript rows are memoised: a fresh Set on
 * every render fails their comparison and repaints a thousand rows on every
 * tick of the clock. That trap has already been paid for once in this screen.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { insideClip, useClipSelection } from "./useClipSelection";
import type { Segment } from "../types";

function block(id: string, start: number, end: number): Segment {
  return {
    id,
    recording_id: "r",
    order: 0,
    start,
    end,
    text: id,
    speakers: null,
    confidence: null,
    edited: false,
    verified: false,
    words: null,
    original: null,
    language: null,
  } as unknown as Segment;
}

const TRANSCRIPT = [
  block("a", 0, 4),
  block("b", 4, 9),
  block("c", 9, 14),
  block("d", 14, 20),
];

describe("which blocks a clip covers", () => {
  /** A block counts as inside when it *starts* inside. One straddling the end
   *  therefore comes whole — somebody quoting a passage wants the sentence
   *  they pointed at, not its first half. */
  it("takes every block that begins inside it", () => {
    expect(insideClip(TRANSCRIPT, 4, 14).map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("takes a single block when that is the whole clip", () => {
    expect(insideClip(TRANSCRIPT, 4, 9).map((s) => s.id)).toEqual(["b"]);
  });

  /** Floating point: a bound taken from a block's own start must include that
   *  block, and the rule allows half a millisecond either way for it. */
  it("includes the block its own start came from", () => {
    expect(insideClip(TRANSCRIPT, 9.0000001, 20).map((s) => s.id)).toEqual(["c", "d"]);
  });
});

function selection() {
  return renderHook(() =>
    useClipSelection({ segments: TRANSCRIPT, playRange: vi.fn() })
  );
}

describe("marking one", () => {
  it("starts on the first block and closes on a later one", () => {
    const { result } = selection();
    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[1]));
    expect(result.current.state.active).toBe(true);
    expect(result.current.state.to).toBe(null);
    expect([...result.current.state.inside]).toEqual(["b"]);

    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[2]));
    expect(result.current.state.start).toBe(4);
    expect(result.current.state.end).toBe(14);
    expect([...result.current.state.inside]).toEqual(["b", "c"]);
    expect(result.current.state.seconds).toBe(10);
  });

  /** Pointing at something earlier is the reader saying "no, from here" —
   *  not an empty clip running backwards. */
  it("moves the start when the reader points at an earlier block", () => {
    const { result } = selection();
    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[2]));
    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[0]));
    expect(result.current.state.start).toBe(0);
    expect(result.current.state.to).toBe(null);
  });

  it("clears away entirely", () => {
    const { result } = selection();
    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[1]));
    act(() => result.current.actions.clear());
    expect(result.current.state.active).toBe(false);
    expect(result.current.state.inside.size).toBe(0);
  });

  /** The one that would not be noticed until an hour-long transcript went
   *  slow: the set handed to a thousand memoised rows has to be the same
   *  object while the selection has not changed. */
  it("keeps the same set of ids while nothing changes", () => {
    const { result, rerender } = selection();
    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[1]));
    const first = result.current.state.inside;
    rerender();
    rerender();
    expect(result.current.state.inside).toBe(first);
  });

  it("plays the stretch and stops at its end", () => {
    const playRange = vi.fn();
    const { result } = renderHook(() =>
      useClipSelection({ segments: TRANSCRIPT, playRange })
    );
    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[1]));
    act(() => result.current.actions.beginOrExtend(TRANSCRIPT[3]));
    act(() => result.current.actions.play());
    expect(playRange).toHaveBeenCalledWith(4, 20);
  });
});
