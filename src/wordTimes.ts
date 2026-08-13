/** When Whisper gives several adjacent words one timestamp.
 *
 *  It happens because the alignment works on tokens, not words, and a run of
 *  short tokens can decode to a single frame. Measured on the archive as it
 *  stands: 812 of 8393 words — 9.7 % — sit in such a group, in 335 groups of
 *  two to six words.
 *
 *  Until now every word in a group carried the group's time, so all of them
 *  seeked to the first one, all of them lit up at once while the audio ran, and
 *  the context menu offered the same moment for each. The median cost of that
 *  is 0.13 s, which nobody can hear; the tail is what this is for. The worst
 *  group in the archive is *A to téma je věrnost,* at 3:36 — five words over
 *  3.14 s, so clicking the last of them began two and a half seconds early.
 *
 *  **This does not touch what is stored.** `CLAUDE.md` forbids stretching or
 *  offsetting stored word timestamps, and rightly: they were measured against
 *  decoded audio and `speakers.rs` assigns speakers by them. This is a reading
 *  of them, applied at the point they become something to click, and the first
 *  word of every group keeps its measured value exactly. Only the words that
 *  never had one of their own are given an estimate.
 */

/** A word as the archive stores it: `{"t":1.23,"s":"slovo"}`. */
export interface StoredWord {
  t: number;
  s: string;
}

/** How far ahead of the estimate to land, in seconds.
 *
 *  The estimate assumes an even speaking rate across the group, so it is wrong
 *  in both directions by a tenth or so. The two directions are not equally bad:
 *  landing late clips the start of the very word that was clicked, while
 *  landing early costs a moment of the word before it — which is what the old
 *  behaviour did all the time and nobody minded. So the estimate is pulled
 *  this much earlier, and clamped so it can never precede the group's own
 *  measured start.
 *
 *  0.08 was measured rather than picked, against 6905 control words — three
 *  measured times in a row, the middle one hidden and then predicted:
 *
 *  | lead | mean error | lands late | late by, 90th |
 *  |------|-----------|------------|---------------|
 *  | 0.00 |   0.073 s |     57.2 % |       0.150 s |
 *  | 0.08 |   0.101 s |     15.4 % |       0.207 s |
 *  | 0.12 |   0.132 s |      8.6 % |       0.237 s |
 *  | 0.25 |   0.251 s |      2.0 % |       0.350 s |
 *
 *  This is the knee. Below it the error is barely smaller and more than half
 *  of all clicks clip; above it the clipping keeps falling but every click
 *  drifts. Anybody moving it should re-run that measurement rather than argue
 *  from taste.
 */
const LEAD = 0.08;

/** The time to use for each word, in the order given.
 *
 *  `until` is where the run of words ends — the next segment's first word, or
 *  the segment's end when this is the last one. A group is spread over the gap
 *  between its measured time and the next measured time, weighted by how long
 *  the words are: a longer word takes longer to say. Characters rather than
 *  syllables because they are what is here, and the difference between the two
 *  is far below the error this is correcting.
 */
export function spreadTiedWords(words: StoredWord[], until: number): number[] {
  const times = words.map((w) => w.t);

  let start = 0;
  while (start < words.length) {
    let last = start;
    while (last + 1 < words.length && words[last + 1].t === words[start].t) last++;

    if (last > start) {
      // Where the group has to fit: up to the next word that has a measured
      // time of its own, or `until` when the group closes the list.
      const end = last + 1 < words.length ? words[last + 1].t : until;
      const span = end - words[start].t;
      // A non-positive span means the next measured time is not after this one
      // — nothing to spread into, so the old behaviour is also the only honest
      // one. Leaving every word on the group's time is that behaviour.
      if (span > 0) {
        const lengths = words.slice(start, last + 1).map((w) => w.s.length);
        const total = lengths.reduce((a, b) => a + b, 0);
        let before = 0;
        for (let i = start; i <= last; i++) {
          // The first word of the group is the measured one and keeps its
          // value: `before` is still zero, so the fraction is zero.
          const fraction = total > 0 ? before / total : (i - start) / (last - start + 1);
          times[i] = Math.max(words[start].t, words[start].t + span * fraction - LEAD);
          before += lengths[i - start];
        }
      }
    }

    start = last + 1;
  }

  return times;
}
