import { useEffect, useId, useRef, useState } from "react";
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
   *  Five seconds. Two and a half was *moc rychlé* and ten was tried and turned
   *  out to be long — the name is the only place the application says what it is
   *  called, so it has to outlast a glance away, and it also has to stop being
   *  the thing on screen that has not settled yet. */
  hold: 5_000,
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
  writing: 1800,
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

/** What the mark does while a transcript is running.
 *
 *  **Turned on its side it stops being a face and becomes a machine.** The two
 *  `o` are rollers, the stem is sheet metal passing between them, and the smile
 *  leaves because a mill does not smile until it is done. Nothing is drawn for
 *  this: it is the same four shapes seen from another side, which is the only
 *  reason the idea works at all — anything that had to be added would be a
 *  second mark rather than a state of the first.
 *
 *  `scale`: the drawing is 30.41 long and its frame is 26.2 tall, so turning it
 *  upright would push the rollers out through the top and bottom. 26.2 / 30.41
 *  is what it has to come down by to turn inside its own box.
 *
 *  `lead` is 0 — the sheet starts with the turn rather than after it. The rule
 *  is not *do not set off early*, it is *do not reach the rollers early*: the
 *  sheet begins 26 units outside the frame and takes half a pass to arrive, so
 *  at these durations it reaches them 30 ms after the turn has finished. There
 *  is no moment when nothing is happening.
 */
const MILL = {
  turn: 520,
  pass: 1100,
  lead: 0,
  /** How far the smile swings about the centre of its own arc on the way out. */
  smileTurn: 62,
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
export function OloFace({ working = false }: { working?: boolean }) {
  const maskId = `pen-${useId()}`;
  /** The pen has been told to go. */
  const [drawn, setDrawn] = useState(faceWritten);
  /** The pen has arrived, and the outline and the mask can go.
   *
   *  **Two states rather than one, and the one was a defect.** `drawn` did three
   *  jobs at once: it started the pen, and it also took away the outline and the
   *  mask — and the mask is what makes the pen visible at all. So the moment the
   *  pen was told to draw, the thing it draws on disappeared and the face simply
   *  appeared. The writing has to keep both until it has finished, not until it
   *  has begun. */
  const [written, setWritten] = useState(faceWritten);
  const [still] = useState(stillWanted);
  /** Lags `working` on the way down, so the last sheet can come to rest. */
  const [milling, setMilling] = useState(false);
  const face = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (faceWritten) return undefined;
    if (still) {
      faceWritten = true;
      setDrawn(true);
      setWritten(true);
      return undefined;
    }
    const pen = window.setTimeout(() => {
      faceWritten = true;
      setDrawn(true);
    }, FACE.after);
    /* A little past the last stroke's end. The margin is there because the
       outline sits exactly under the ink: taking it away a frame early would
       show nothing, and a frame late costs nothing. */
    const home = window.setTimeout(() => setWritten(true), FACE.after + FACE.writing + 120);
    return () => {
      window.clearTimeout(pen);
      window.clearTimeout(home);
    };
  }, [still]);

  /* Starting is immediate; stopping waits.
   *
   * **The last sheet through stays as the nose.** A pass runs from +26 to −26,
   * so the nose is exactly halfway, and stopping means waiting for the next
   * time the loop reaches that halfway point and dropping the animation there.
   * The resting state carries no offset, so the sheet simply stays where it had
   * got to — and only then does the mark turn back and the smile return.
   *
   * Cutting the loop the moment the transcript finishes would snap the sheet
   * from wherever it was to the nose, which is the one frame that would say the
   * whole thing was a trick. */
  useEffect(() => {
    if (still) return undefined;
    if (working) {
      setMilling(true);
      return undefined;
    }
    if (!milling) return undefined;
    const sheet = face.current?.querySelector(".olo-sheet");
    const animation = sheet?.getAnimations()[0];
    if (!animation) {
      setMilling(false);
      return undefined;
    }
    const progress = animation.effect?.getComputedTiming().progress ?? null;
    const wait =
      progress === null
        ? MILL.lead * MILL.turn - Number(animation.currentTime ?? 0) + MILL.pass / 2
        : (progress <= 0.5 ? 0.5 - progress : 1.5 - progress) * MILL.pass;
    const home = window.setTimeout(() => setMilling(false), Math.max(0, wait));
    return () => window.clearTimeout(home);
  }, [working, milling, still]);

  return (
    <span
      ref={face}
      className={`olo-face${drawn ? " drawn" : ""}${still ? " still" : ""}${
        milling ? " working" : ""
      }`}
      style={
        {
          "--olo-writing": `${FACE.writing}ms`,
          "--olo-ease": FACE.ease,
          "--olo-turn": `${MILL.turn}ms`,
          "--olo-pass": `${MILL.pass}ms`,
          "--olo-lead": MILL.lead,
          "--olo-smile-turn": `${MILL.smileTurn}deg`,
        } as React.CSSProperties
      }
    >
      <svg className="olo-face-svg" viewBox="11.5 -1 32.3 26.2" role="img" aria-label="olo">
        {/* The outline is the pen's own target and has no business being there
            once the pen has finished: while the mark is turning, an unmoved grey
            copy of the face would sit behind the machine. */}
        {!written && (
          <g className="olo-face-guide">
            <path d={GLYPH.o1} />
            <path d={GLYPH.l1} />
            <path d={GLYPH.o2} />
            <path d={GLYPH.smile} />
          </g>
        )}
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
        {/* The mask goes with the outline. It is the shape of a pen's travel,
            and once the travel is over it can only get in the way — the sheet
            leaves the drawing's own box on every pass, and a mask sized to that
            box would cut it off mid-journey. */}
        <g className="olo-face-ink" mask={written ? undefined : `url(#${maskId})`}>
          <g className="olo-rot">
            <g className="olo-eyes">
              <path d={GLYPH.o1} />
              <path d={GLYPH.o2} />
            </g>
            <g className="olo-sheet">
              <path d={GLYPH.l1} />
            </g>
            <g className="olo-smile">
              <path d={GLYPH.smile} />
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
