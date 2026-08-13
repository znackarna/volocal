// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import {
  forgetSpeakerName,
  rememberSpeakerNames,
  speakerNamesFor,
  useSpeakerNamePool,
} from "./speakerNames";

beforeEach(() => localStorage.clear());

describe("the shortlist of names typed before a run", () => {
  test("what was typed for a recording comes back for it", () => {
    rememberSpeakerNames(["a"], ["Roman", "Janka"]);
    expect(speakerNamesFor("a")).toEqual(["Roman", "Janka"]);
    expect(speakerNamesFor("b")).toEqual([]);
  });

  test("one answer covers every recording the question was asked for", () => {
    rememberSpeakerNames(["a", "b"], ["Roman"]);
    expect(speakerNamesFor("b")).toEqual(["Roman"]);
  });

  test("a name that has been used is not offered again", () => {
    rememberSpeakerNames(["a"], ["Roman", "Janka"]);
    forgetSpeakerName("a", "Roman");
    expect(speakerNamesFor("a")).toEqual(["Janka"]);
  });

  test("an empty answer clears what was there", () => {
    rememberSpeakerNames(["a"], ["Roman"]);
    rememberSpeakerNames(["a"], []);
    expect(speakerNamesFor("a")).toEqual([]);
  });

  test("a shortlist that is not a list at all is no reason to fail", () => {
    localStorage.setItem("speaker-names", "{\"a\":\"Roman\"}");
    expect(speakerNamesFor("a")).toEqual([]);
    localStorage.setItem("speaker-names", "not json");
    expect(speakerNamesFor("a")).toEqual([]);
  });
});

/** The reported defect, and the only test here that would have caught it.
 *
 *  Speaker recognition is started from the transcript that is already open, so
 *  the recording never changes while it runs. Reading the shortlist on the
 *  recording alone therefore read it once — before the dialog that asks for the
 *  names had even been shown — and the reader was offered nothing under either
 *  voice afterwards.
 */
describe("keeping the shortlist in step with a run", () => {
  test("names typed after the screen opened arrive when the run ends", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: string | undefined }) => useSpeakerNamePool("a", phase),
      { initialProps: { phase: undefined as string | undefined } }
    );
    // The screen was open before anybody was asked anything.
    expect(result.current[0]).toEqual([]);

    // The dialog that starts the run writes them, and the run then finishes.
    act(() => rememberSpeakerNames(["a"], ["Roman", "Janka"]));
    rerender({ phase: "diarization" });
    expect(result.current[0]).toEqual([]);

    rerender({ phase: "complete" });
    expect(result.current[0]).toEqual(["Roman", "Janka"]);
  });

  test("a run that was cancelled or failed reads them too", () => {
    for (const phase of ["cancelled", "error"]) {
      localStorage.clear();
      const { result, rerender } = renderHook(
        ({ p }: { p: string | undefined }) => useSpeakerNamePool("a", p),
        { initialProps: { p: undefined as string | undefined } }
      );
      act(() => rememberSpeakerNames(["a"], ["Roman"]));
      rerender({ p: phase });
      expect(result.current[0], `after ${phase}`).toEqual(["Roman"]);
    }
  });

  test("another recording brings its own list, as it always did", () => {
    rememberSpeakerNames(["a"], ["Roman"]);
    rememberSpeakerNames(["b"], ["Janka"]);
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSpeakerNamePool(id, "complete"),
      { initialProps: { id: "a" } }
    );
    expect(result.current[0]).toEqual(["Roman"]);
    rerender({ id: "b" });
    expect(result.current[0]).toEqual(["Janka"]);
  });
});
