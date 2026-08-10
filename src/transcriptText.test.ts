import { describe, expect, test } from "vitest";
import { changedWords, plain } from "./transcriptText";

/** These describe what the reading screen promises, not what the code happens
 *  to do today. Both functions fail quietly when they are wrong — the search
 *  finds nothing, or the wrong word carries the dashed underline — so nothing
 *  else would notice. */

describe("plain", () => {
  test("a query typed without diacritics finds the Czech word", () => {
    expect(plain("řeknu")).toBe(plain("reknu"));
    expect(plain("Přepiš MĚ")).toBe("prepis me");
  });

  test("every Czech diacritic is removed, including ů and ě", () => {
    expect(plain("ěščřžýáíéúůďťň")).toBe("escrzyaieuudtn");
  });

  test("case alone is not a difference", () => {
    expect(plain("Volocal")).toBe(plain("VOLOCAL"));
  });

  test("letters that are not Czech are left as they are", () => {
    expect(plain("Ångström")).toBe("angstrom");
    expect(plain("naïve")).toBe("naive");
  });

  test("spacing and punctuation are untouched, so a phrase still matches", () => {
    expect(plain("dva  dny předtím,")).toBe("dva  dny predtim,");
  });
});

describe("changedWords", () => {
  test("one word swapped marks that word and no other", () => {
    expect([...changedWords("součas DNA svého života", "součást DNA svého života")]).toEqual([0]);
  });

  test("nothing changed marks nothing", () => {
    expect(changedWords("a b c", "a b c").size).toBe(0);
  });

  /** The reason it is a subsequence walk. A word inserted near the front shifts
   *  every later word by one, and a position-by-position compare would then
   *  mark the whole rest of the sentence. */
  test("a word inserted shifts the rest without marking it", () => {
    expect([...changedWords("přišel domů", "přišel pozdě domů")]).toEqual([1]);
  });

  test("a word removed leaves nothing to underline", () => {
    expect(changedWords("přišel pozdě domů", "přišel domů").size).toBe(0);
  });

  test("one word corrected into two marks both", () => {
    expect([...changedWords("současDNA je", "součást DNA je")]).toEqual([0, 1]);
  });

  test("added punctuation counts as a correction, because it is one", () => {
    expect([...changedWords("ale to si lidé", "ale to si, lidé")]).toEqual([2]);
  });

  test("text appended at the end is all marked", () => {
    expect([...changedWords("a b", "a b c d")]).toEqual([2, 3]);
  });

  test("an empty original marks the whole line", () => {
    expect([...changedWords("", "dvě slova")]).toEqual([0, 1]);
  });

  /** Indices address the whitespace split the transcript renders, so irregular
   *  spacing must not shift them. */
  test("the indices are the ones the transcript renders", () => {
    expect([...changedWords("a   b\n c", "a   x\n c")]).toEqual([1]);
  });

  /** The table is quadratic. A block this long is not a hand correction, and
   *  refusing to diff it is deliberate — the transcript falls back to its
   *  pencil mark. */
  test("a block too long to diff is left unmarked rather than guessed at", () => {
    const long = Array.from({ length: 401 }, (_, i) => `w${i}`).join(" ");
    expect(changedWords(long, `${long} more`).size).toBe(0);
  });

  test("a block at the limit is still diffed", () => {
    const at = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    expect(changedWords(at, at.replace("w0", "x0")).size).toBe(1);
  });
});
