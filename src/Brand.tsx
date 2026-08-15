import { useEffect, useId, useState } from "react";
import {
  CLOSED_WIDTH,
  GLYPH,
  PEN,
  PEN_TIMING,
  TM_SHIFT,
  WORDMARK,
} from "./brandArt";

/** Chosen at the screen. The numbers are here rather than in the stylesheet
 *  because two of them decide when a `setTimeout` fires as well as how long a
 *  transition runs, and a duration split across two files goes out of step. */
const HEADER = {
  /** How long the full name stands before it closes. */
  hold: 2500,
  /** The closing itself. */
  collapse: 620,
  /** Opening again under the pointer. Shorter than the closing on purpose: the
   *  intro is staged, this is an answer to a hand, and an answer that takes
   *  600 ms reads as an application that is thinking about it. */
  hover: 310,
  ease: "cubic-bezier(.65,0,.35,1)",
};

const FACE = {
  /** After the header has finished, not with it. Both are the same drawing and
   *  two of them moving at once ask for one pair of eyes twice. */
  after: 260,
  writing: 2000,
  ease: "cubic-bezier(.45,.05,.35,1)",
};

/** Both animations belong to starting the application, not to arriving at a
 *  screen. The archive is left and re-entered all day — from a transcript, from
 *  Settings — and a mark that re-introduced itself every time would be the same
 *  joke told twenty times before lunch. */
let headerIntroPlayed = false;
let faceWritten = false;

const stillWanted = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The application's name in the header, which closes to its own middle.
 *
 * `volocal` holds `olo`, and the smile is already centred under it, so what
 * happens here is not a change of logo but a crop that was always there. `v`
 * and `cal` fade, the middle slides to the left edge, the ™ comes to rest
 * against the second `o`, and the box closes to match.
 */
export function Wordmark({ label }: { label: string }) {
  const [closed, setClosed] = useState(headerIntroPlayed);
  /** Only after the intro has landed does the pointer get to open it again. A
   *  hand already resting on the header at start would otherwise cancel the
   *  intro before anybody saw it. */
  const [ready, setReady] = useState(headerIntroPlayed);
  const [still] = useState(stillWanted);

  useEffect(() => {
    if (headerIntroPlayed) return undefined;
    if (still) {
      headerIntroPlayed = true;
      setClosed(true);
      setReady(true);
      return undefined;
    }
    /* The flag is set when the closing starts rather than when this effect
       runs, so a mount that is torn down again before anything moved does not
       spend the intro. */
    const close = window.setTimeout(() => {
      headerIntroPlayed = true;
      setClosed(true);
    }, HEADER.hold);
    const settle = window.setTimeout(() => setReady(true), HEADER.hold + HEADER.collapse + 60);
    return () => {
      window.clearTimeout(close);
      window.clearTimeout(settle);
    };
  }, [still]);

  return (
    <span
      className={`wordmark${closed ? " closed" : ""}${ready ? " ready" : ""}${still ? " still" : ""}`}
      style={
        {
          "--wordmark-closed": CLOSED_WIDTH,
          "--wordmark-shift": -WORDMARK.oloStart,
          "--wordmark-tm": TM_SHIFT,
          "--wordmark-collapse": `${HEADER.collapse}ms`,
          "--wordmark-hover": `${HEADER.hover}ms`,
          "--wordmark-ease": HEADER.ease,
        } as React.CSSProperties
      }
    >
      <svg
        className="wordmark-svg"
        viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}
        role="img"
        aria-label={label}
      >
        <g className="wordmark-shift">
          <path className="wordmark-v" d={GLYPH.v} />
          <g className="wordmark-olo">
            <path d={GLYPH.o1} />
            <path d={GLYPH.l1} />
            <path d={GLYPH.o2} />
            <path d={GLYPH.smile} />
          </g>
          <g className="wordmark-cal">
            <path d={GLYPH.c} />
            <path d={GLYPH.a} />
            <path d={GLYPH.l2} />
          </g>
          <path className="wordmark-tm" d={GLYPH.tm} />
        </g>
      </svg>
    </span>
  );
}

/**
 * The mark on its own, written rather than placed.
 *
 * The outline stands there in the line colour from the first frame and a pen
 * fills it in: eye, stem, eye, smile — the order a hand takes, with the smile
 * last because it is the point of the drawing. The pen is a white stroke inside
 * a mask, so what advances is the reveal of the black shapes, not a stroke
 * pretending to be them.
 */
export function OloFace({ delayed = false }: { delayed?: boolean }) {
  const maskId = `pen-${useId()}`;
  const [drawn, setDrawn] = useState(faceWritten);
  const [still] = useState(stillWanted);

  useEffect(() => {
    if (faceWritten) return undefined;
    if (still) {
      faceWritten = true;
      setDrawn(true);
      return undefined;
    }
    const wait = delayed ? HEADER.hold + HEADER.collapse + FACE.after : FACE.after;
    const pen = window.setTimeout(() => {
      faceWritten = true;
      setDrawn(true);
    }, wait);
    return () => window.clearTimeout(pen);
  }, [delayed, still]);

  return (
    <span
      className={`olo-face${drawn ? " drawn" : ""}${still ? " still" : ""}`}
      style={
        {
          "--olo-writing": `${FACE.writing}ms`,
          "--olo-ease": FACE.ease,
        } as React.CSSProperties
      }
    >
      <svg className="olo-face-svg" viewBox="11.5 -1 32.3 26.2" role="img" aria-label="olo">
        <g className="olo-face-guide">
          <path d={GLYPH.o1} />
          <path d={GLYPH.l1} />
          <path d={GLYPH.o2} />
          <path d={GLYPH.smile} />
        </g>
        {/* Generous region: the pen is wider than the letters and overshoots
            them at both ends, and a mask clipped to the drawing would cut the
            overshoot that exists precisely so nothing is left unfilled. */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="6" y="-8" width="44" height="42">
          {PEN.map((d, index) => (
            <path
              key={d}
              className={`olo-pen olo-pen-${index + 1}`}
              d={d}
              pathLength="100"
              style={
                {
                  "--pen-start": PEN_TIMING[index].start,
                  "--pen-duration": PEN_TIMING[index].duration,
                } as React.CSSProperties
              }
            />
          ))}
        </mask>
        <g className="olo-face-ink" mask={`url(#${maskId})`}>
          <path d={GLYPH.o1} />
          <path d={GLYPH.l1} />
          <path d={GLYPH.o2} />
          <path d={GLYPH.smile} />
        </g>
      </svg>
    </span>
  );
}
