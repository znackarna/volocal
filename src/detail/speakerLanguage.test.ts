/**
 * Which language a voice speaks, as the sidebar shows it.
 *
 * The rule that makes this work at all: **a block with no language written on
 * it is the recording's own.** Only the second-language pass labels what it
 * writes, so Paul Bartlett's transcript holds 539 blocks saying nothing and
 * 610 saying `en`. Read literally that is one language and the codes never
 * appear, which is exactly what happened when this was first built.
 */
import { describe, expect, it } from "vitest";
import { languagesOfVoices } from "./useSpeakerManagement";
import type { Segment } from "../types";

function block(speaker: string, language: string | null, seconds: number): Segment {
  return {
    id: `${speaker}-${language}-${seconds}`,
    recording_id: "r",
    order: 0,
    start: 0,
    end: seconds,
    text: "…",
    speakers: speaker,
    confidence: null,
    edited: false,
    verified: false,
    words: null,
    original: null,
    language,
  } as unknown as Segment;
}

describe("the language a voice speaks", () => {
  it("reads a block with nothing written on it as the recording's own", () => {
    const map = languagesOfVoices(
      [block("a", null, 60), block("b", "en", 60)],
      "cs"
    );
    expect(map.get("a")).toBe("cs");
    expect(map.get("b")).toBe("en");
  });

  /** By time, not by count: a two-second interjection must not outweigh a
   *  minute of speech. */
  it("takes the language a voice spends its time in", () => {
    const map = languagesOfVoices(
      [
        block("a", null, 2),
        block("a", "en", 60),
        block("b", null, 90),
      ],
      "cs"
    );
    expect(map.get("a")).toBe("en");
    expect(map.get("b")).toBe("cs");
  });

  /** On an ordinary transcript the code would repeat the footer under every
   *  voice, so there is nothing to show. */
  it("says nothing when only one language is spoken", () => {
    const map = languagesOfVoices([block("a", null, 60), block("b", null, 60)], "cs");
    expect(map.size).toBe(0);
  });

  it("ignores a block nobody is assigned to", () => {
    const map = languagesOfVoices(
      [block("a", null, 60), { ...block("b", "en", 60), speakers: null } as Segment],
      "cs"
    );
    expect(map.size).toBe(0);
  });
});
