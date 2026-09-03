/**
 * Whether a transcript holds two languages.
 *
 * **The rule that is easy to get wrong, and was.** A block carries a language
 * only where the second-language pass wrote it, so Paul Bartlett's transcript
 * is 539 blocks saying nothing and 610 saying `en`. Counting distinct values
 * finds one language and the codes never appear — which is exactly what
 * happened the first time this was built.
 */
import { describe, expect, it } from "vitest";
import { holdsTwoLanguages } from "./SpeakerHeader";
import type { Segment } from "../types";

const block = (language: string | null): Segment =>
  ({ id: `${language}`, language } as unknown as Segment);

describe("does the transcript hold two languages", () => {
  it("sees one where a block says something other than the recording's own", () => {
    expect(holdsTwoLanguages([block(null), block("en")], "cs")).toBe(true);
  });

  it("sees none where every block is the recording's own, written or not", () => {
    expect(holdsTwoLanguages([block(null), block("cs")], "cs")).toBe(false);
  });

  it("does not mind how the language is cased or spaced", () => {
    expect(holdsTwoLanguages([block(" CS ")], "cs")).toBe(false);
    expect(holdsTwoLanguages([block("EN")], "cs")).toBe(true);
  });

  it("sees none in an empty transcript", () => {
    expect(holdsTwoLanguages([], "cs")).toBe(false);
  });
});
