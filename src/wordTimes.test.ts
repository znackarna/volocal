import { describe, expect, test } from "vitest";
import { spreadTiedWords, type StoredWord } from "./wordTimes";

const said = (pairs: Array<[number, string]>): StoredWord[] =>
  pairs.map(([t, s]) => ({ t, s }));

/** Words that several of them share one timestamp, and what may be done to it.
 *
 *  The rule this is guarding is not "the numbers come out nicer". It is that a
 *  measured timestamp is never moved and an estimated one never lands after the
 *  next measured one — everything else here is the estimate being useful.
 */
describe("words that share a timestamp", () => {
  test("words with times of their own are handed back untouched", () => {
    const words = said([[1, "a"], [2, "b"], [3, "c"]]);
    expect(spreadTiedWords(words, 4)).toEqual([1, 2, 3]);
  });

  test("a tied pair is spread, and the first of them does not move", () => {
    // Two words on 10, the next measured word on 12. The first keeps 10; the
    // second is a word-length into the gap, less the lead.
    const times = spreadTiedWords(said([[10, "ab"], [10, "cd"], [12, "e"]]), 20);
    expect(times[0]).toBe(10);
    expect(times[1]).toBeGreaterThan(10);
    expect(times[1]).toBeLessThan(12);
    expect(times[2]).toBe(12);
  });

  /** The invariant that matters most. A measured value is evidence; an
   *  estimate is not, and the two must not be confused by this function. */
  test("the first word of every group keeps its measured value exactly", () => {
    const words = said([[5, "a"], [5, "b"], [5, "c"], [9, "d"], [9, "e"]]);
    const times = spreadTiedWords(words, 12);
    expect(times[0]).toBe(5);
    expect(times[3]).toBe(9);
  });

  test("no estimate lands at or after the next measured word", () => {
    const words = said([[0, "aaaa"], [0, "b"], [0, "c"], [1, "d"]]);
    const times = spreadTiedWords(words, 2);
    for (const t of times.slice(0, 3)) expect(t).toBeLessThan(1);
  });

  test("a group closing the list is spread over what is left of the segment", () => {
    // Nothing measured follows, so the segment's end is the boundary.
    const times = spreadTiedWords(said([[10, "a"], [10, "b"]]), 14);
    expect(times[0]).toBe(10);
    expect(times[1]).toBeGreaterThan(10);
    expect(times[1]).toBeLessThan(14);
  });

  test("a longer word is given more of the gap than a short one", () => {
    // Same group, same span; only the lengths differ. The word after the long
    // one must start later than the word after the short one.
    const afterLong = spreadTiedWords(said([[0, "dlouhatanske"], [0, "x"], [1, "z"]]), 2)[1];
    const afterShort = spreadTiedWords(said([[0, "x"], [0, "dlouhatanske"], [1, "z"]]), 2)[1];
    expect(afterLong).toBeGreaterThan(afterShort);
  });

  /** The case that would produce nonsense if it were not stopped: the next
   *  measured time is not after this one, so there is no gap to spread into
   *  and no honest estimate to make. */
  test("a group with no room keeps the old behaviour", () => {
    expect(spreadTiedWords(said([[7, "a"], [7, "b"], [7, "c"]]), 7)).toEqual([7, 7, 7]);
  });

  test("a boundary that runs backwards moves nothing", () => {
    expect(spreadTiedWords(said([[7, "a"], [7, "b"]]), 3)).toEqual([7, 7]);
  });

  test("the lead cannot push a word before the moment the group starts", () => {
    // A gap far smaller than the lead: every estimate would go negative if the
    // clamp were missing, and the first word would stop being its measured self.
    const times = spreadTiedWords(said([[100, "a"], [100, "b"], [100.01, "c"]]), 101);
    for (const t of times) expect(t).toBeGreaterThanOrEqual(100);
  });

  test("words with no text at all fall back to sharing the gap evenly", () => {
    const times = spreadTiedWords(said([[0, ""], [0, ""], [2, "z"]]), 3);
    expect(times[0]).toBe(0);
    expect(times[1]).toBeGreaterThan(0);
    expect(times[1]).toBeLessThan(2);
  });

  test("an empty list is not a special case anybody has to think about", () => {
    expect(spreadTiedWords([], 5)).toEqual([]);
  });
});
