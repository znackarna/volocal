/** The drawing the application signs itself with, in the one form the interface
 *  can take apart.
 *
 *  `wordmark.svg` holds the same nine outlines as a flat list, which is right
 *  for a file somebody opens in an editor and wrong for a header that has to
 *  move three of them and leave the rest. So the `d` strings live here as named
 *  constants — copied from that file character for character, never redrawn —
 *  and the components in `Brand.tsx` group them.
 *
 *  If the letterforms are ever redrawn, both this file and `PEN` below have to
 *  follow. Nothing on screen says when they have gone out of step; the mark
 *  simply starts writing itself beside its own outline.
 */

/** The nine outlines of `volocal™`, left to right. */
export const GLYPH = {
  v: "M12.3349 4.63817L8.20079 16.2541H4.2689L0 4.63817H3.46006L6.26855 13.131L8.91976 4.63817H12.3349Z",
  o1: "M18.4742 16.5237C17.3358 16.5237 16.3098 16.2765 15.3961 15.7823C14.4824 15.288 13.7634 14.584 13.2392 13.6703C12.7149 12.7566 12.4528 11.6856 12.4528 10.4574C12.4528 9.22911 12.7149 8.15814 13.2392 7.24445C13.7634 6.31577 14.4824 5.60429 15.3961 5.11C16.3098 4.6157 17.3358 4.36856 18.4742 4.36856C19.6126 4.36856 20.6386 4.6157 21.5523 5.11C22.466 5.60429 23.185 6.31577 23.7092 7.24445C24.2335 8.15814 24.4956 9.22911 24.4956 10.4574C24.4956 11.6856 24.2335 12.7566 23.7092 13.6703C23.185 14.584 22.466 15.288 21.5523 15.7823C20.6386 16.2765 19.6126 16.5237 18.4742 16.5237ZM18.4742 13.8725C19.2531 13.8725 19.8897 13.5654 20.384 12.9513C20.8783 12.3372 21.1254 11.5059 21.1254 10.4574C21.1254 9.39388 20.8783 8.55508 20.384 7.94095C19.8897 7.32683 19.2456 7.01977 18.4518 7.01977C17.6579 7.01977 17.0138 7.32683 16.5195 7.94095C16.0252 8.55508 15.7781 9.39388 15.7781 10.4574C15.7781 11.5059 16.0252 12.3372 16.5195 12.9513C17.0288 13.5654 17.6804 13.8725 18.4742 13.8725Z",
  l1: "M29.3301 16.2541H25.9824V0.077179H29.3301V16.2541Z",
  o2: "M36.8391 16.5237C35.7007 16.5237 34.6747 16.2765 33.761 15.7823C32.8473 15.288 32.1283 14.584 31.6041 13.6703C31.0798 12.7566 30.8177 11.6856 30.8177 10.4574C30.8177 9.22911 31.0798 8.15814 31.6041 7.24445C32.1283 6.31577 32.8473 5.60429 33.761 5.11C34.6747 4.6157 35.7007 4.36856 36.8391 4.36856C37.9775 4.36856 39.0035 4.6157 39.9172 5.11C40.8309 5.60429 41.5499 6.31577 42.0741 7.24445C42.5984 8.15814 42.8605 9.22911 42.8605 10.4574C42.8605 11.6856 42.5984 12.7566 42.0741 13.6703C41.5499 14.584 40.8309 15.288 39.9172 15.7823C39.0035 16.2765 37.9775 16.5237 36.8391 16.5237ZM36.8391 13.8725C37.618 13.8725 38.2546 13.5654 38.7489 12.9513C39.2432 12.3372 39.4903 11.5059 39.4903 10.4574C39.4903 9.39388 39.2432 8.55508 38.7489 7.94095C38.2546 7.32683 37.6105 7.01977 36.8166 7.01977C36.0228 7.01977 35.3787 7.32683 34.8844 7.94095C34.3901 8.55508 34.1429 9.39388 34.1429 10.4574C34.1429 11.5059 34.3901 12.3372 34.8844 12.9513C35.3937 13.5654 36.0452 13.8725 36.8391 13.8725Z",
  smile: "M34.9735 21.1465C34.0131 22.1069 32.8729 22.8687 31.618 23.3885C30.3632 23.9083 29.0182 24.1758 27.66 24.1758C26.3018 24.1758 24.9568 23.9083 23.702 23.3885C22.4471 22.8687 21.3069 22.1069 20.3465 21.1465L22.5406 18.9524C23.2129 19.6247 24.011 20.158 24.8894 20.5219C25.7678 20.8857 26.7092 21.073 27.66 21.073C28.6108 21.073 29.5522 20.8857 30.4306 20.5219C31.309 20.158 32.1071 19.6247 32.7794 18.9524L34.9735 21.1465Z",
  c: "M49.6722 16.5237C48.5338 16.5237 47.5152 16.284 46.6165 15.8047C45.7178 15.3104 45.0138 14.6064 44.5045 13.6927C44.0102 12.7641 43.7631 11.6856 43.7631 10.4574C43.7631 9.21414 44.0102 8.13567 44.5045 7.22198C45.0138 6.29331 45.7178 5.58931 46.6165 5.11C47.5152 4.6157 48.5338 4.36856 49.6722 4.36856C51.2898 4.36856 52.5705 4.77298 53.5142 5.58182C54.4578 6.37569 55.027 7.43168 55.2217 8.7498H51.8515C51.7317 8.16563 51.4846 7.73125 51.1101 7.44666C50.7506 7.16207 50.2563 7.01977 49.6272 7.01977C48.8633 7.01977 48.2567 7.31934 47.8073 7.91849C47.358 8.51763 47.1333 9.34894 47.1333 10.4124C47.1333 11.4909 47.358 12.3372 47.8073 12.9513C48.2567 13.5654 48.8708 13.8725 49.6497 13.8725C50.2788 13.8725 50.7656 13.7302 51.1101 13.4456C51.4546 13.161 51.7018 12.7191 51.8515 12.12H55.1993C54.9896 13.4531 54.4054 14.5241 53.4468 15.3329C52.4881 16.1268 51.2299 16.5237 49.6722 16.5237Z",
  a: "M61.8887 4.36856C63.5663 4.36856 64.8545 4.72804 65.7532 5.44702C66.6669 6.16599 67.1238 7.25943 67.1238 8.72733V16.2541H64.158V14.7937C63.2892 15.947 62.0685 16.5237 60.4957 16.5237C59.6569 16.5237 58.9155 16.3739 58.2714 16.0743C57.6423 15.7748 57.148 15.3629 56.7885 14.8386C56.444 14.2994 56.2718 13.7002 56.2718 13.0412C56.2718 12.0376 56.6013 11.2213 57.2603 10.5922C57.9344 9.94809 58.9979 9.55864 60.4508 9.42383L63.821 9.08682V8.50265C63.821 7.91849 63.6487 7.47662 63.3042 7.17704C62.9747 6.86249 62.5104 6.70522 61.9112 6.70522C61.3121 6.70522 60.8402 6.83254 60.4957 7.08717C60.1662 7.32683 59.9415 7.7013 59.8217 8.21057H56.474C56.6387 6.96734 57.178 6.0162 58.0917 5.35714C59.0203 4.69808 60.286 4.36856 61.8887 4.36856ZM61.3944 14.3892C62.1733 14.3892 62.765 14.1496 63.1694 13.6703C63.5738 13.191 63.776 12.5469 63.776 11.738V10.9741L61.2596 11.3111C60.7204 11.386 60.3085 11.5658 60.0239 11.8504C59.7393 12.12 59.597 12.4645 59.597 12.8839C59.597 13.3183 59.7618 13.6778 60.0913 13.9624C60.4208 14.2469 60.8552 14.3892 61.3944 14.3892Z",
  l2: "M72.4229 16.2541H69.0751V0.077179H72.4229V16.2541Z",
  tm: "M75.5691 0H78.0025V0.671058H77.2095V2.56222H76.3893V0.671058H75.5691V0ZM81.6561 0V2.56222H80.8359V0.725285L80.2665 2.56222H79.6971L79.1277 0.725285V2.56222H78.3075V0H79.6022L79.9818 1.42346L80.3614 0H81.6561Z",
} as const;

/** The mark is the middle of the word, not a second drawing of it.
 *
 *  `olo` runs from x 12.4528 to x 42.8605, and the smile — measured off its own
 *  outline — is centred at x 27.66, which is the centre of those two numbers to
 *  the hundredth. It was never centred under `volocal`, whose centre is x 41.
 *  Everything the header does follows from that one fact.
 */
export const WORDMARK = {
  /** Full drawing, from `wordmark.svg`'s own viewBox. */
  width: 82,
  height: 25,
  /** Left edge of the first `o` — how far left the mark travels when it closes. */
  oloStart: 12.4528,
  /** Right edge of the second `o`, where the ™ comes to rest beside. */
  oloEnd: 42.8605,
  tmStart: 75.5691,
  tmWidth: 6.087,
} as const;

/** Chosen at the screen, not derived: the ™ sits hard against the `o`.
 *
 *  In the full word the ™ stands 3.15 after a straight `l`; a first attempt
 *  carried that number over and the owner said it read too far. The reason it
 *  can go to nothing is that the two never meet — the ™ occupies y 0 to 2.56 and
 *  the `o` starts at 4.37, so at zero they line up on a common right edge
 *  instead of colliding.
 */
export const TM_GAP = 0;

/** What the closed state costs in the header, in the drawing's own units. */
export const CLOSED_WIDTH = WORDMARK.oloEnd - WORDMARK.oloStart + TM_GAP + WORDMARK.tmWidth;

/** How far the ™ travels on top of the shift the whole group already makes. */
export const TM_SHIFT =
  WORDMARK.oloEnd - WORDMARK.oloStart + TM_GAP - (WORDMARK.tmStart - WORDMARK.oloStart);

/** The centreline of each stroke, for the pen that writes the mark.
 *
 *  These are not in `wordmark.svg` — that file has outlines, and an outline
 *  cannot be drawn progressively. Each one is the middle between a shape's
 *  outer and inner edge:
 *
 *  - `o` is an ellipse rx 4.35 ry 4.75. Not a circle: this drawing's horizontal
 *    strokes are 2.65 thick and its vertical ones 3.35, so a circle would leave
 *    the ring uncovered at the sides.
 *  - the stem is the vertical at x 27.66.
 *  - the smile is an arc of radius 8.81 centred at (27.66, 13.81).
 *
 *  **Every path is longer than the shape it fills, and that is deliberate.**
 *  The pen has a flat front (`butt`), so wherever it stops short it leaves the
 *  outline showing. The ellipses run 380° rather than 360 — a pen that starts at
 *  the top and returns to the top from the right left a notch in each eye — the
 *  stem overshoots 0.5 at both ends, and the smile runs 13° past each tip,
 *  whose real ends are cut at an angle a flat front cannot reach. Overshoot is
 *  always safe: the letterform clips it. Falling short never is.
 */
export const PEN = [
  "M18.4742 5.6961A4.35 4.75 0 0 0 18.4742 15.1961A4.35 4.75 0 0 0 18.4742 5.6961A4.35 4.75 0 0 0 16.986 5.9825",
  "M27.6563 -0.5V16.8",
  "M36.8391 5.6961A4.35 4.75 0 0 0 36.8391 15.1961A4.35 4.75 0 0 0 36.8391 5.6961A4.35 4.75 0 0 0 35.3509 5.9825",
  "M20.196 18.491A8.812 8.812 0 0 0 35.124 18.491",
] as const;

/** Length of each stroke in the drawing's units, in `PEN` order.
 *
 *  A stroke's share of the writing time is its share of this total, so the pen
 *  keeps one speed and the short stem does not take as long as a whole eye.
 */
const PEN_LENGTH = [28.6, 16.2, 28.6, 13.8];

/** How much of a stroke is still running when the next one starts.
 *
 *  35%, chosen at the screen. The hand does not stop between letters, and at 0
 *  it visibly did. Above 48% — the ratio of the smile's length to the second
 *  eye's — the smile would finish before the eye above it, which puts the
 *  punchline before the setup; at 35% it lands 123 ms after, last of everything.
 */
const PEN_OVERLAP = 0.35;

/** Start and duration of each stroke as a fraction of the whole writing time.
 *
 *  Normalised against the latest finish rather than the last stroke's, because
 *  past 48% overlap the last stroke to *start* is no longer the last to *end*,
 *  and normalising against the wrong one makes the animation outrun its own
 *  stated duration.
 */
export const PEN_TIMING = (() => {
  const total = PEN_LENGTH.reduce((sum, length) => sum + length, 0);
  const share = PEN_LENGTH.map((length) => length / total);
  const start = [0];
  for (let i = 1; i < share.length; i += 1) {
    start[i] = start[i - 1] + share[i - 1] * (1 - PEN_OVERLAP);
  }
  const span = Math.max(...share.map((value, i) => start[i] + value));
  return share.map((value, i) => ({
    start: start[i] / span,
    duration: value / span,
  }));
})();
