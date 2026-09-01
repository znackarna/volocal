// @vitest-environment jsdom
/**
 * What the corrections hand back keeps its identity between renders.
 *
 * The same reason as `useTranscriptSearch.test.ts`, and a sharper one. Every
 * `SegmentRow` receives `actions.save`, and `SegmentRow` is memoised — on an
 * hour-long transcript that is a thousand rows. A `save` that changed on every
 * render would fail every one of those comparisons, eight times a second while
 * audio plays.
 *
 * It changed on every render while `markAiStale` was passed as a fresh arrow
 * rather than as the stable function itself. Passing the function is what keeps
 * this true, and this is the test that says so.
 */
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { useTranscriptEditing } from "./useTranscriptEditing";
import type { Segment } from "../types";

vi.mock("../api", () => ({ api: { updateSegment: vi.fn(), markVerified: vi.fn() } }));

function block(id: string): Segment {
  return {
    id,
    recording_id: "r1",
    order: 0,
    start: 0,
    end: 4,
    text: "Dobrý den.",
    speakers: null,
    confidence: 0.9,
    edited: false,
    verified: false,
    words: null,
    original: null,
  };
}

const segments = [block("s1")];

/** Everything the hook is handed, all of it stable — which is the arrangement
 *  the screen is supposed to give it. */
const stable = {
  recordingId: "r1",
  segments,
  updateSegments: () => {},
  onError: () => {},
  onInfo: () => {},
  markAiStale: () => {},
  reload: async () => {},
};

describe("what the corrections hand back", () => {
  test("keeps `save` through a render that changes nothing", () => {
    const { result, rerender } = renderHook(() => useTranscriptEditing(stable), {
      wrapper: I18nProvider,
    });

    const first = result.current.actions.save;
    rerender();
    rerender();

    expect(result.current.actions.save).toBe(first);
  });

  test("and gives it up when a fresh `markAiStale` arrives", () => {
    // The shape the bug had: a new function every render. Pinned so that the
    // reason the screen must not do it is visible here too.
    const { result, rerender } = renderHook(
      ({ mark }) => useTranscriptEditing({ ...stable, markAiStale: mark }),
      { wrapper: I18nProvider, initialProps: { mark: () => {} } }
    );

    const first = result.current.actions.save;
    rerender({ mark: () => {} });

    expect(result.current.actions.save).not.toBe(first);
  });
});
