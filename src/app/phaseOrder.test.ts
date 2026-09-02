/**
 * A report that arrives out of turn must not throw the caption backwards —
 * and a phase that legitimately comes next must not be mistaken for one.
 *
 * Reported on 2026-09-02: the caption stood at "Hledám druhý jazyk" while the
 * words were already arriving. The question before the transcript reported
 * under the same phase name as the fill, which sits at the end of the order
 * because it runs after the transcript is saved — so the transcription, the
 * diarization and the saving all read as steps backwards and were dropped.
 */
import { describe, expect, it } from "vitest";
import { keepsMovingForward } from "./useTranscriptionRuntime";
import type { TranscriptionProgress } from "../types";

const at = (phase: TranscriptionProgress["phase"], percent: number): TranscriptionProgress => ({
  recording_id: "r",
  phase,
  percent,
  description: { code: `${phase}.running`, params: {}, detail: "" },
});

describe("which report is shown", () => {
  it("lets the transcription follow the question in front of it", () => {
    expect(keepsMovingForward(at("second_language_question", 8), at("transcription", 10))).toBe(
      true
    );
  });

  it("still lets the fill follow the saving behind it", () => {
    expect(keepsMovingForward(at("saving", 95), at("second_language", 5))).toBe(true);
  });

  /** The rule this all exists for: reports come from several threads and a
   *  late one must not undo a newer one. */
  it("drops a report that would move the run backwards", () => {
    expect(keepsMovingForward(at("transcription", 40), at("preparation", 5))).toBe(false);
  });

  it("allows anything once the run has ended", () => {
    expect(keepsMovingForward(at("complete", 100), at("preparation", 2))).toBe(true);
  });
});
