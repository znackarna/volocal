// @vitest-environment jsdom
/**
 * What the search hook hands back keeps its identity between renders.
 *
 * This pins an implementation property on purpose, and the reason is a
 * regression this refactoring introduced and then took back out.
 *
 * The transcript screen re-renders on every tick of the clock — eight times a
 * second while audio plays — and its keyboard effect lists the search among its
 * dependencies. While the hook returned a fresh object each render, that effect
 * tore the window's keydown listener down and put it back on every one of them.
 * Before the hook existed the same effect listed `finding`, `findAt` and two
 * stable callbacks and re-armed only when the search changed.
 *
 * Referential stability is not behaviour a reader can see, which is why this is
 * the one test here that reaches for it. Written against the screen it was
 * flaky: how many times the screen renders while its promises settle is not
 * something a test can pin down, so the property is asked of the hook directly.
 */
import { describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTranscriptSearch } from "./useTranscriptSearch";
import type { Segment } from "../types";

function block(id: string, text: string): Segment {
  return {
    id,
    recording_id: "r1",
    order: 0,
    start: 0,
    end: 4,
    text,
    speakers: null,
    confidence: 0.9,
    edited: false,
    verified: false,
    words: null,
    original: null,
  };
}

const segments = [block("s1", "Dobrý den, začneme poradu."), block("s2", "Tím poradu končíme.")];

describe("what the search hands back", () => {
  test("keeps its identity through a render that changes nothing about it", () => {
    const { result, rerender } = renderHook(({ s }) => useTranscriptSearch(s), {
      initialProps: { s: segments },
    });

    const first = result.current;
    rerender({ s: segments });
    rerender({ s: segments });

    expect(result.current).toBe(first);
  });

  test("and gives up that identity when the search actually moves", () => {
    const { result } = renderHook(() => useTranscriptSearch(segments));

    const before = result.current;
    act(() => result.current.actions.write("porad"));

    expect(result.current).not.toBe(before);
    expect(result.current.state.total).toBe(2);
  });
});
