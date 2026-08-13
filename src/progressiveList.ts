import { useEffect, useState } from "react";

/** How many blocks go out in the first drawing.
 *
 *  A screenful and then some. The point is not to guess the window's height
 *  exactly — it is that the first drawing should be bounded by something other
 *  than the length of the recording.
 */
export const FIRST_BLOCKS = 40;

/** How much of a long list to draw now, and the rest a frame later.
 *
 *  **The reported symptom**: opening a transcript from the archive or the
 *  miniplayer took a visible moment, *"instant on a short one, plainly late on
 *  Janka"*. That is the shape of the answer as much as the complaint is. The
 *  chunk the screen lives in is one size whatever is opened, and the archive
 *  answers in 2.6 ms with 338 kB — neither of those grows with the recording.
 *  The drawing does: 359 blocks and 6845 words against 16 blocks and 379.
 *
 *  So the first screenful is drawn on its own and the remainder follows on the
 *  next frame, by which time there is already something to read. The total work
 *  is unchanged — slightly more, since it is two drawings rather than one — and
 *  that is the trade: the window stops waiting for the end of a recording
 *  before showing the beginning of it.
 *
 *  **What makes this safe here** is that nothing scrolls on arrival. Every
 *  `scrollIntoView` in `Detail.tsx` is inside a handler somebody has to press,
 *  and `seekTime` moves the player's cursor rather than the page. A list that
 *  jumped to a block on opening could not be cut short this way without the
 *  jump missing the blocks that had not been drawn yet.
 */
export function useProgressiveList(total: number): number {
  const [drawn, setDrawn] = useState(FIRST_BLOCKS);

  useEffect(() => {
    if (drawn >= total) return;
    // A frame rather than an idle callback: the rest should arrive while the
    // reader is still looking at the top of the transcript, not whenever the
    // window next has nothing to do.
    const frame = requestAnimationFrame(() => setDrawn(total));
    return () => cancelAnimationFrame(frame);
  }, [drawn, total]);

  return Math.min(drawn, total);
}
