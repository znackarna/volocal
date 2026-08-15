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
  /** How long the full name stands before it closes.
   *
   *  Ten seconds, on the owner's word after watching two and a half: *je to moc
   *  rychlé*. The full name is the only place the application says what it is
   *  called, and a reader who looked away for a moment had missed it. */
  hold: 10_000,
  /** The closing itself. */
  collapse: 620,
  /** Opening again under the pointer. Shorter than the closing on purpose: the
   *  intro is staged, this is an answer to a hand, and an answer that takes
   *  600 ms reads as an application that is thinking about it. */
  hover: 310,
  ease: "cubic-bezier(.65,0,.35,1)",
};

const FACE = {
  /** Straight away, and it used to wait for the header.
   *
   *  The reason for waiting was that both are the same drawing and two of them
   *  moving at once ask for one pair of eyes twice. What the hold going to ten
   *  seconds showed is that the objection was to two things *moving*, and during
   *  the hold the header does not move — it stands. Sequencing them now would
   *  leave the empty state as a grey outline for eleven seconds, which reads as
   *  a screen that failed to load rather than as a mark waiting its turn. */
  after: 400,
  writing: 2000,
  ease: "cubic-bezier(.45,.05,.35,1)",
};

/** When the application started, near enough.
 *
 *  The intro is counted from here rather than from the header mounting, because
 *  the header unmounts on the way into a transcript and mounts again on the way
 *  back. At two and a half seconds that hardly mattered; at ten it would mean
 *  the countdown restarting on every navigation, so the name would keep
 *  re-introducing itself to anybody moving around the application. */
const APP_STARTED = Date.now();

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
    const left = Math.max(0, APP_STARTED + HEADER.hold - Date.now());
    const close = window.setTimeout(() => {
      headerIntroPlayed = true;
      setClosed(true);
    }, left);
    const settle = window.setTimeout(() => setReady(true), left + HEADER.collapse + 60);
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
 * The publisher's mark: a red triangle, a green circle, a blue square.
 *
 * Its colours are fixed rather than `currentColor`, which is the opposite of
 * what the product's own mark does and is right for the same reason — a
 * publisher's mark is a signature and keeps its colours in both themes, where
 * the product's takes the colour of the text it stands in.
 *
 * The three are also where this application's palette came from. The cube that
 * stood in the header until today was built out of exactly these three values
 * and no others, so what changed when it left is not that the colours went but
 * that they stopped belonging to the product.
 */
export function ZnackarnaMark({ label }: { label: string }) {
  return (
    <svg className="znackarna-mark" viewBox="0 0 88 28" role="img" aria-label={label}>
      <path d="M31.4428 27.5216H0L15.801 0L31.4428 27.5216Z" fill="#FF1C26" />
      <path
        d="M50.7702 1.89426C52.903 3.1567 54.5945 4.86591 55.8459 7.01948C57.0961 9.17304 57.7219 11.5141 57.7219 14.039C57.7219 16.565 57.0961 18.8988 55.8459 21.039C54.5945 23.1791 52.903 24.875 50.7702 26.124C48.6375 27.3743 46.319 27.9988 43.8174 27.9988C41.3157 27.9988 39.0045 27.3743 36.885 26.124C34.7643 24.875 33.0861 23.1791 31.8479 21.039C30.6097 18.8988 29.9912 16.565 29.9912 14.039C29.9912 11.5129 30.6097 9.17304 31.8479 7.01948C33.0861 4.86591 34.7643 3.1567 36.885 1.89426C39.0057 0.631826 41.3169 0 43.8186 0C46.3202 0 48.6375 0.631826 50.7702 1.89426Z"
        fill="#7AC942"
      />
      <path d="M88 27.5215H61.1784V0.438232H87.9988V27.5215H88Z" fill="#007AFF" />
    </svg>
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
export function OloFace() {
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
    const pen = window.setTimeout(() => {
      faceWritten = true;
      setDrawn(true);
    }, FACE.after);
    return () => window.clearTimeout(pen);
  }, [still]);

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
