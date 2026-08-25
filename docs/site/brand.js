/* volocal-brand.js — the Volocal brand animation as one vanilla module.
 *
 * Outlines, pen paths and the smile generator are copied character for
 * character from src/brandArt.ts. Timings and staging are Brand.tsx's, which
 * wins wherever the tuning prototype (docs/prototypes/volocal-olo.html)
 * disagrees; each such place says so.
 */
(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- art
     The nine outlines of `volocal™`, left to right. Copied from brandArt.ts. */
  var GLYPH = {
    v: "M12.3349 4.63817L8.20079 16.2541H4.2689L0 4.63817H3.46006L6.26855 13.131L8.91976 4.63817H12.3349Z",
    o1: "M18.4742 16.5237C17.3358 16.5237 16.3098 16.2765 15.3961 15.7823C14.4824 15.288 13.7634 14.584 13.2392 13.6703C12.7149 12.7566 12.4528 11.6856 12.4528 10.4574C12.4528 9.22911 12.7149 8.15814 13.2392 7.24445C13.7634 6.31577 14.4824 5.60429 15.3961 5.11C16.3098 4.6157 17.3358 4.36856 18.4742 4.36856C19.6126 4.36856 20.6386 4.6157 21.5523 5.11C22.466 5.60429 23.185 6.31577 23.7092 7.24445C24.2335 8.15814 24.4956 9.22911 24.4956 10.4574C24.4956 11.6856 24.2335 12.7566 23.7092 13.6703C23.185 14.584 22.466 15.288 21.5523 15.7823C20.6386 16.2765 19.6126 16.5237 18.4742 16.5237ZM18.4742 13.8725C19.2531 13.8725 19.8897 13.5654 20.384 12.9513C20.8783 12.3372 21.1254 11.5059 21.1254 10.4574C21.1254 9.39388 20.8783 8.55508 20.384 7.94095C19.8897 7.32683 19.2456 7.01977 18.4518 7.01977C17.6579 7.01977 17.0138 7.32683 16.5195 7.94095C16.0252 8.55508 15.7781 9.39388 15.7781 10.4574C15.7781 11.5059 16.0252 12.3372 16.5195 12.9513C17.0288 13.5654 17.6804 13.8725 18.4742 13.8725Z",
    l1: "M29.3301 16.2541H25.9824V0.077179H29.3301V16.2541Z",
    o2: "M36.8391 16.5237C35.7007 16.5237 34.6747 16.2765 33.761 15.7823C32.8473 15.288 32.1283 14.584 31.6041 13.6703C31.0798 12.7566 30.8177 11.6856 30.8177 10.4574C30.8177 9.22911 31.0798 8.15814 31.6041 7.24445C32.1283 6.31577 32.8473 5.60429 33.761 5.11C34.6747 4.6157 35.7007 4.36856 36.8391 4.36856C37.9775 4.36856 39.0035 4.6157 39.9172 5.11C40.8309 5.60429 41.5499 6.31577 42.0741 7.24445C42.5984 8.15814 42.8605 9.22911 42.8605 10.4574C42.8605 11.6856 42.5984 12.7566 42.0741 13.6703C41.5499 14.584 40.8309 15.288 39.9172 15.7823C39.0035 16.2765 37.9775 16.5237 36.8391 16.5237ZM36.8391 13.8725C37.618 13.8725 38.2546 13.5654 38.7489 12.9513C39.2432 12.3372 39.4903 11.5059 39.4903 10.4574C39.4903 9.39388 39.2432 8.55508 38.7489 7.94095C38.2546 7.32683 37.6105 7.01977 36.8166 7.01977C36.0228 7.01977 35.3787 7.32683 34.8844 7.94095C34.3901 8.55508 34.1429 9.39388 34.1429 10.4574C34.1429 11.5059 34.3901 12.3372 34.8844 12.9513C35.3937 13.5654 36.0452 13.8725 36.8391 13.8725Z",
    smile: "M34.9735 21.1465C34.0131 22.1069 32.8729 22.8687 31.618 23.3885C30.3632 23.9083 29.0182 24.1758 27.66 24.1758C26.3018 24.1758 24.9568 23.9083 23.702 23.3885C22.4471 22.8687 21.3069 22.1069 20.3465 21.1465L22.5406 18.9524C23.2129 19.6247 24.011 20.158 24.8894 20.5219C25.7678 20.8857 26.7092 21.073 27.66 21.073C28.6108 21.073 29.5522 20.8857 30.4306 20.5219C31.309 20.158 32.1071 19.6247 32.7794 18.9524L34.9735 21.1465Z",
    c: "M49.6722 16.5237C48.5338 16.5237 47.5152 16.284 46.6165 15.8047C45.7178 15.3104 45.0138 14.6064 44.5045 13.6927C44.0102 12.7641 43.7631 11.6856 43.7631 10.4574C43.7631 9.21414 44.0102 8.13567 44.5045 7.22198C45.0138 6.29331 45.7178 5.58931 46.6165 5.11C47.5152 4.6157 48.5338 4.36856 49.6722 4.36856C51.2898 4.36856 52.5705 4.77298 53.5142 5.58182C54.4578 6.37569 55.027 7.43168 55.2217 8.7498H51.8515C51.7317 8.16563 51.4846 7.73125 51.1101 7.44666C50.7506 7.16207 50.2563 7.01977 49.6272 7.01977C48.8633 7.01977 48.2567 7.31934 47.8073 7.91849C47.358 8.51763 47.1333 9.34894 47.1333 10.4124C47.1333 11.4909 47.358 12.3372 47.8073 12.9513C48.2567 13.5654 48.8708 13.8725 49.6497 13.8725C50.2788 13.8725 50.7656 13.7302 51.1101 13.4456C51.4546 13.161 51.7018 12.7191 51.8515 12.12H55.1993C54.9896 13.4531 54.4054 14.5241 53.4468 15.3329C52.4881 16.1268 51.2299 16.5237 49.6722 16.5237Z",
    a: "M61.8887 4.36856C63.5663 4.36856 64.8545 4.72804 65.7532 5.44702C66.6669 6.16599 67.1238 7.25943 67.1238 8.72733V16.2541H64.158V14.7937C63.2892 15.947 62.0685 16.5237 60.4957 16.5237C59.6569 16.5237 58.9155 16.3739 58.2714 16.0743C57.6423 15.7748 57.148 15.3629 56.7885 14.8386C56.444 14.2994 56.2718 13.7002 56.2718 13.0412C56.2718 12.0376 56.6013 11.2213 57.2603 10.5922C57.9344 9.94809 58.9979 9.55864 60.4508 9.42383L63.821 9.08682V8.50265C63.821 7.91849 63.6487 7.47662 63.3042 7.17704C62.9747 6.86249 62.5104 6.70522 61.9112 6.70522C61.3121 6.70522 60.8402 6.83254 60.4957 7.08717C60.1662 7.32683 59.9415 7.7013 59.8217 8.21057H56.474C56.6387 6.96734 57.178 6.0162 58.0917 5.35714C59.0203 4.69808 60.286 4.36856 61.8887 4.36856ZM61.3944 14.3892C62.1733 14.3892 62.765 14.1496 63.1694 13.6703C63.5738 13.191 63.776 12.5469 63.776 11.738V10.9741L61.2596 11.3111C60.7204 11.386 60.3085 11.5658 60.0239 11.8504C59.7393 12.12 59.597 12.4645 59.597 12.8839C59.597 13.3183 59.7618 13.6778 60.0913 13.9624C60.4208 14.2469 60.8552 14.3892 61.3944 14.3892Z",
    l2: "M72.4229 16.2541H69.0751V0.077179H72.4229V16.2541Z",
    tm: "M75.5691 0H78.0025V0.671058H77.2095V2.56222H76.3893V0.671058H75.5691V0ZM81.6561 0V2.56222H80.8359V0.725285L80.2665 2.56222H79.6971L79.1277 0.725285V2.56222H78.3075V0H79.6022L79.9818 1.42346L80.3614 0H81.6561Z"
  };

  /* The mark is the middle of the word, not a second drawing of it: `olo` runs
     from x 12.4528 to x 42.8605 and the smile is centred at x 27.66, which is
     the centre of those two. Everything the wordmark does follows from that. */
  var WORDMARK = {
    width: 82,
    height: 25,
    oloStart: 12.4528,
    oloEnd: 42.8605,
    tmStart: 75.5691,
    tmWidth: 6.087
  };
  /* Chosen at the screen: the ™ sits hard against the `o`. The two never meet —
     ™ occupies y 0 to 2.56 and the `o` starts at 4.37 — so zero lines them up on
     a common right edge instead of colliding. */
  var TM_GAP = 0;
  var CLOSED_WIDTH = WORDMARK.oloEnd - WORDMARK.oloStart + TM_GAP + WORDMARK.tmWidth;
  var TM_SHIFT =
    WORDMARK.oloEnd - WORDMARK.oloStart + TM_GAP - (WORDMARK.tmStart - WORDMARK.oloStart);

  /* The smile as a shape that can open wider: an annulus sector, two concentric
     arcs closed by radial cuts. The numbers are read off GLYPH.smile, not
     chosen. **Only the angle changes** — the radii are fixed, so the smile
     lengthens along the circle it is already made of. Scaling the drawn shape
     changes the radius, and a larger radius reads as a face that has moved
     closer, not as a wider smile. */
  var SMILE = { cx: 27.66, cy: 13.833, inner: 7.24, outer: 10.3428, rest: 45 };

  /* The smile opened to `degrees` each side of the bottom of its arc. At
     SMILE.rest this reproduces GLYPH.smile to a ten-thousandth of a unit. */
  function smileArc(degrees) {
    var angle = (degrees * Math.PI) / 180;
    var sin = Math.sin(angle);
    var cos = Math.cos(angle);
    var x = function (radius, side) { return (SMILE.cx + side * radius * sin).toFixed(4); };
    var y = function (radius) { return (SMILE.cy + radius * cos).toFixed(4); };
    /* Past 90 degrees a side the sector is more than a half circle and the arc
       flag has to turn over, or the curve takes the short way round instead. */
    var large = degrees > 90 ? 1 : 0;
    return (
      "M" + x(SMILE.outer, 1) + " " + y(SMILE.outer) +
      "A" + SMILE.outer + " " + SMILE.outer + " 0 " + large + " 1 " +
        x(SMILE.outer, -1) + " " + y(SMILE.outer) +
      "L" + x(SMILE.inner, -1) + " " + y(SMILE.inner) +
      "A" + SMILE.inner + " " + SMILE.inner + " 0 " + large + " 0 " +
        x(SMILE.inner, 1) + " " + y(SMILE.inner) + "Z"
    );
  }

  /* The centreline of each stroke, for the pen that writes the mark. Every path
     is longer than the shape it fills, deliberately: the pen has a flat front,
     so wherever it stops short it leaves the outline showing. The ellipses run
     380°, the stem overshoots 0.5 at both ends, the smile runs 13° past each
     tip. Overshoot is always safe — the letterform clips it. */
  var PEN = [
    "M18.4742 5.6961A4.35 4.75 0 0 0 18.4742 15.1961A4.35 4.75 0 0 0 18.4742 5.6961A4.35 4.75 0 0 0 16.986 5.9825",
    "M27.6563 -0.5V16.8",
    "M36.8391 5.6961A4.35 4.75 0 0 0 36.8391 15.1961A4.35 4.75 0 0 0 36.8391 5.6961A4.35 4.75 0 0 0 35.3509 5.9825",
    "M20.196 18.491A8.812 8.812 0 0 0 35.124 18.491"
  ];
  /* Length of each stroke in the drawing's units, in PEN order. A stroke's
     share of the writing time is its share of this total, so the pen keeps one
     speed and the short stem does not take as long as a whole eye. */
  var PEN_LENGTH = [28.6, 16.2, 28.6, 13.8];
  /* How much of a stroke is still running when the next one starts. 35 %: the
     hand does not stop between letters, and at 0 it visibly did. Above 48 % the
     smile would finish before the eye above it — the punchline before the
     setup; at 35 % it lands 123 ms after, last of everything. */
  var PEN_OVERLAP = 0.35;
  /* Normalised against the latest finish rather than the last stroke's,
     because past 48 % overlap the last stroke to *start* is no longer the last
     to *end*. */
  var PEN_TIMING = (function () {
    var total = PEN_LENGTH.reduce(function (sum, length) { return sum + length; }, 0);
    var share = PEN_LENGTH.map(function (length) { return length / total; });
    var start = [0];
    for (var i = 1; i < share.length; i += 1) {
      start[i] = start[i - 1] + share[i - 1] * (1 - PEN_OVERLAP);
    }
    var span = Math.max.apply(null, share.map(function (value, j) { return start[j] + value; }));
    return share.map(function (value, j) {
      return { start: start[j] / span, duration: value / span };
    });
  })();

  /* ------------------------------------------------------------- timings
     All four groups are Brand.tsx's, not the prototype's sliders. */

  var HEADER = {
    /** Five seconds. Two and a half was too quick and ten turned out to be
     *  long — the name is the only place the application says what it is
     *  called, so it has to outlast a glance away. */
    hold: 5000,
    collapse: 1000,
    /** Shorter than the closing on purpose: the intro is staged, this is an
     *  answer to a hand, and an answer that takes 600 ms reads as an
     *  application that is thinking about it. */
    hover: 500,
    ease: "cubic-bezier(.65,0,.35,1)"
  };

  var FACE = { after: 400, writing: 1800, ease: "cubic-bezier(.45,.05,.35,1)" };

  /** Turned on its side the mark stops being a face and becomes a machine: the
   *  two `o` are rollers, the stem is sheet metal, and the smile leaves because
   *  a mill does not smile until it is done. `lead` is 0 — the sheet sets off
   *  with the turn and reaches the rollers 30 ms after it finishes. */
  var MILL = { turn: 520, pass: 1100, lead: 0, smileTurn: 62 };

  /** Intervals carry ±40 % of jitter rather than firing on the number: a real
   *  eye does not blink to a metronome. */
  var ALIVE = {
    blinkEvery: 6000,
    blinkFor: 120,
    grinEvery: 14000,
    /** 55 degrees each side of the bottom of the arc; the drawing rests at 45. */
    grinTo: 55,
    grinFor: 420,
    /** How long an unprompted smile holds. One under the pointer holds until
     *  the pointer leaves instead. */
    grinHold: 1200
  };

  /* A small overshoot on the way out, none on the way back: a smile that
     arrives and stops dead is mechanical, and coming back the face has no
     reason to shoot the smile inward. */
  function easeOutBack(t) { return 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function jitter(ms) { return ms * (0.6 + Math.random() * 0.8); }

  /* Unique per instance, the way `useId` is in the React component: a page may
     carry more than one mark, and two masks under one id would leave the second
     face writing through the first one's pen. */
  var seq = 0;
  function uid(prefix) { seq += 1; return prefix + "-" + seq; }

  function stillWanted(opts) {
    if (opts && typeof opts.reducedMotion === "boolean") return opts.reducedMotion;
    return typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function path(d, cls) {
    return '<path' + (cls ? ' class="' + cls + '"' : "") + ' d="' + d + '"/>';
  }

  /** The four shapes of the mark, in the grouping every state needs: eyes that
   *  blink or roll, a stem that is a nose or a sheet, a smile that is generated
   *  rather than copied. */
  function markInk(maskId) {
    return (
      '<g class="olo-face-ink"' + (maskId ? ' mask="url(#' + maskId + ')"' : "") + ">" +
        '<g class="olo-rot">' +
          '<g class="olo-eyes">' +
            path(GLYPH.o1, "olo-eye") + path(GLYPH.o2, "olo-eye") +
          "</g>" +
          '<g class="olo-sheet">' + path(GLYPH.l1) + "</g>" +
          '<g class="olo-smile">' + path(smileArc(SMILE.rest)) + "</g>" +
        "</g>" +
      "</g>"
    );
  }

  /** The variables both the face and the mill read out of CSS. */
  function markVariables(el) {
    el.style.setProperty("--olo-writing", FACE.writing + "ms");
    el.style.setProperty("--olo-ease", FACE.ease);
    el.style.setProperty("--olo-blink", ALIVE.blinkFor + "ms");
    el.style.setProperty("--olo-turn", MILL.turn + "ms");
    el.style.setProperty("--olo-pass", MILL.pass + "ms");
    el.style.setProperty("--olo-lead", String(MILL.lead));
    el.style.setProperty("--olo-smile-turn", MILL.smileTurn + "deg");
  }

  /* ============================================================ wordmark
   *
   * The application's name, which closes to its own middle. `v` and `cal` leave
   * the frame, the middle slides to the left edge, the ™ comes to rest against
   * the second `o`, and the box closes to match. Under the pointer it opens
   * again, quicker than it closed.
   */
  function volocalWordmark(el, opts) {
    opts = opts || {};
    var still = stillWanted(opts);
    var hold = typeof opts.hold === "number" ? opts.hold : HEADER.hold;
    var label = opts.label || "volocal";

    el.classList.add("volocal-brand");
    el.innerHTML =
      '<span class="wordmark' + (still ? " closed ready still" : "") + '">' +
        '<svg class="wordmark-svg" viewBox="0 0 ' + WORDMARK.width + " " + WORDMARK.height +
          '" role="img" aria-label="' + label + '">' +
          '<g class="wordmark-shift">' +
            path(GLYPH.v, "wordmark-v") +
            '<g class="wordmark-olo">' +
              path(GLYPH.o1) + path(GLYPH.l1) + path(GLYPH.o2) + path(GLYPH.smile) +
            "</g>" +
            '<g class="wordmark-cal">' +
              path(GLYPH.c) + path(GLYPH.a) + path(GLYPH.l2) +
            "</g>" +
            path(GLYPH.tm, "wordmark-tm") +
          "</g>" +
        "</svg>" +
      "</span>";

    var mark = el.firstChild;
    /* Rounded to four places only to keep the attribute readable; the geometry
       is in the constants above, not here. */
    mark.style.setProperty("--wordmark-closed", CLOSED_WIDTH.toFixed(4));
    mark.style.setProperty("--wordmark-shift", (-WORDMARK.oloStart).toFixed(4));
    mark.style.setProperty("--wordmark-tm", TM_SHIFT.toFixed(4));
    mark.style.setProperty("--wordmark-collapse", HEADER.collapse + "ms");
    mark.style.setProperty("--wordmark-hover", HEADER.hover + "ms");
    mark.style.setProperty("--wordmark-ease", HEADER.ease);
    if (opts.scale) mark.style.setProperty("--wordmark-unit", String(opts.scale));

    var close = 0;
    var settle = 0;
    if (!still) {
      /* Each instance stages itself from here. The application counts from a
         module-level APP_STARTED so the header does not re-introduce itself on
         every navigation; a page that drops this module in has no navigation to
         survive, so the clock starts at init. */
      close = setTimeout(function () { mark.classList.add("closed"); }, hold);
      /* Only after the intro has landed does the pointer get to open it again:
         a hand already resting here at start would otherwise cancel the intro
         before anybody saw it. */
      settle = setTimeout(function () { mark.classList.add("ready"); },
        hold + HEADER.collapse + 60);
    }

    return {
      element: mark,
      destroy: function () {
        clearTimeout(close);
        clearTimeout(settle);
        el.classList.remove("volocal-brand");
        el.innerHTML = "";
      }
    };
  }

  /* ================================================================ face
   *
   * The mark on its own, written rather than placed. The outline stands there
   * from the first frame and a pen fills it in: eye, stem, eye, smile — the
   * order a hand takes, with the smile last because it is the point of the
   * drawing. The pen is a white stroke inside a mask, so what advances is the
   * reveal of the shapes, not a stroke pretending to be them. Once written the
   * face lives: it blinks, and now and then it smiles.
   */
  function volocalFace(el, opts) {
    opts = opts || {};
    var still = stillWanted(opts);
    var maskId = uid("volocal-pen");
    var label = opts.label || "olo";

    var pens = "";
    for (var i = 0; i < PEN.length; i += 1) {
      pens +=
        '<path class="olo-pen olo-pen-' + (i + 1) + '" d="' + PEN[i] + '" pathLength="100"' +
        ' style="--pen-start:' + PEN_TIMING[i].start.toFixed(4) +
        ";--pen-duration:" + PEN_TIMING[i].duration.toFixed(4) + '"/>';
    }

    el.classList.add("olo-face");
    if (still) el.classList.add("still", "drawn");
    markVariables(el);
    if (opts.height) el.style.setProperty("--olo-height", opts.height);
    el.innerHTML =
      '<svg class="olo-face-svg" viewBox="11.5 -1 32.3 26.2" role="img" aria-label="' +
        label + '">' +
        /* The outline is the pen's own target and has no business being there
           once the pen has finished. */
        (still ? "" :
          '<g class="olo-face-guide">' +
            path(GLYPH.o1) + path(GLYPH.l1) + path(GLYPH.o2) + path(GLYPH.smile) +
          "</g>") +
        /* Generous region: the pen is wider than the letters and overshoots
           them at both ends, and a mask clipped to the drawing would cut the
           overshoot that exists precisely so nothing is left unfilled. */
        (still ? "" :
          '<mask id="' + maskId + '" maskUnits="userSpaceOnUse" x="6" y="-8"' +
            ' width="44" height="42">' + pens + "</mask>") +
        markInk(still ? null : maskId) +
      "</svg>";

    var svg = el.firstChild;
    var guide = svg.querySelector(".olo-face-guide");
    var mask = svg.querySelector("mask");
    var ink = svg.querySelector(".olo-face-ink");
    var smileNode = svg.querySelector(".olo-smile path");

    /* The smile's own state, off the DOM's transitions on purpose: the path is
       recomputed rather than transformed, so it cannot be handed to CSS. */
    var grin = { at: SMILE.rest, frame: 0, back: 0, hovering: false };
    function setSmile(degrees) {
      grin.at = degrees;
      smileNode.setAttribute("d", smileArc(degrees));
    }
    function glide(to, ms, ease) {
      cancelAnimationFrame(grin.frame);
      var from = grin.at;
      var started = performance.now();
      var step = function (now) {
        var t = Math.min(1, (now - started) / ms);
        setSmile(from + (to - from) * ease(t));
        if (t < 1) grin.frame = requestAnimationFrame(step);
      };
      grin.frame = requestAnimationFrame(step);
    }

    /* Two states rather than one, and the one was a defect. `drawn` starts the
       pen; `written` takes away the outline and the mask — and the mask is what
       makes the pen visible at all. The writing has to keep both until it has
       finished, not until it has begun. */
    var written = still;
    var blinkTimer = 0;
    var unblinkTimer = 0;
    var grinTimer = 0;
    var penTimer = 0;
    var homeTimer = 0;

    /* Not while the mark is the mill. Turned on its side the two `o` are
       rollers, and a roller does not blink — the squash still fires, so what
       the eye sees is the machine twitching. The clock keeps running rather
       than being stopped and restarted, for the same reason the grin's does:
       a beat skipped is quieter than a beat that lands the moment the work
       ends. */
    function working() { return el.classList.contains("working"); }

    function blinkOnce() {
      if (!working()) {
        el.classList.add("blinking");
        unblinkTimer = setTimeout(function () {
          el.classList.remove("blinking");
        }, ALIVE.blinkFor);
      }
      blinkTimer = setTimeout(blinkOnce, jitter(ALIVE.blinkEvery));
    }
    function grinOnce() {
      /* Skipped under the pointer, but the clock keeps running. Stopping it and
         starting again on the way out would mean the face smiles a second time
         the moment the pointer leaves — which reads as an answer to having been
         there, and the unprompted smile is meant to be a mood. */
      /* And no unprompted smile while the mill runs: `.working` hides the
         smile, so the glide would happen behind a curtain and the shape that
         swings back when the work ends would be whatever the grin left there. */
      if (!grin.hovering && !working()) {
        glide(ALIVE.grinTo, ALIVE.grinFor, easeOutBack);
        grin.back = setTimeout(function () {
          glide(SMILE.rest, ALIVE.grinFor * 1.6, easeOut);
        }, ALIVE.grinFor + ALIVE.grinHold);
      }
      grinTimer = setTimeout(grinOnce, jitter(ALIVE.grinEvery));
    }

    /* Only a written, idle face is alive. It does not blink while it is being
       written, because the pen has not reached the eyes yet. */
    var alive = false;
    function startLiving() {
      if (alive || still) return;
      alive = true;
      /* A pointer already resting on the mark when it finishes being written
         gets its smile straight away rather than waiting for the next hover. */
      if (grin.hovering) glide(ALIVE.grinTo, ALIVE.grinFor, easeOutBack);
      blinkTimer = setTimeout(blinkOnce, jitter(ALIVE.blinkEvery));
      grinTimer = setTimeout(grinOnce, jitter(ALIVE.grinEvery));
    }
    function stopLiving() {
      alive = false;
      clearTimeout(blinkTimer);
      clearTimeout(unblinkTimer);
      clearTimeout(grinTimer);
      clearTimeout(grin.back);
      cancelAnimationFrame(grin.frame);
      el.classList.remove("blinking");
      setSmile(SMILE.rest);
    }

    /* The smile answers the pointer and holds while it is there. That is the
       difference from the unprompted one, which leaves by itself: a mood ends
       on its own, an answer ends when the question does.

       `mouseenter` rather than `pointerenter` — on a touch screen the pointer
       events would open the smile on a tap and `pointerleave` may never arrive,
       leaving it stuck open. This is decoration, not information, which is also
       why it is not on the keyboard. */
    function onEnter() {
      grin.hovering = true;
      if (!alive) return;
      clearTimeout(grin.back);
      glide(ALIVE.grinTo, ALIVE.grinFor, easeOutBack);
    }
    function onLeave() {
      grin.hovering = false;
      if (!alive) return;
      glide(SMILE.rest, ALIVE.grinFor * 1.6, easeOut);
    }
    svg.addEventListener("mouseenter", onEnter);
    svg.addEventListener("mouseleave", onLeave);

    if (still) {
      written = true;
    } else {
      penTimer = setTimeout(function () {
        /* A frame of its own, or the class lands in the same style resolution
           as the markup and the transition never runs. */
        requestAnimationFrame(function () { el.classList.add("drawn"); });
      }, FACE.after);
      /* A little past the last stroke's end. The margin is there because the
         outline sits exactly under the ink: taking it away a frame early would
         show nothing, and a frame late costs nothing. */
      homeTimer = setTimeout(function () {
        written = true;
        if (guide) guide.remove();
        /* The mask goes with the outline. It is the shape of a pen's travel,
           and once the travel is over it can only get in the way — the sheet
           leaves the drawing's own box on every pass, and a mask sized to that
           box would cut it off mid-journey. */
        if (mask) mask.remove();
        ink.removeAttribute("mask");
        startLiving();
      }, FACE.after + FACE.writing + 120);
    }

    return {
      element: el,
      svg: svg,
      /** The mark's own smile, for a page that wants to drive it. */
      setSmile: setSmile,
      isWritten: function () { return written; },
      destroy: function () {
        clearTimeout(penTimer);
        clearTimeout(homeTimer);
        stopLiving();
        svg.removeEventListener("mouseenter", onEnter);
        svg.removeEventListener("mouseleave", onLeave);
        el.classList.remove("olo-face", "drawn", "blinking", "still", "working");
        el.innerHTML = "";
      }
    };
  }

  /* ================================================================ mill
   *
   * The running state. Nothing is drawn for it: the same four shapes seen from
   * another side, which is the only reason the idea works at all — anything
   * that had to be added would be a second mark rather than a state of the
   * first.
   */
  function volocalMill(el, opts) {
    opts = opts || {};
    var still = stillWanted(opts);
    var label = opts.label || "olo";

    el.classList.add("olo-face");
    if (still) el.classList.add("still");
    markVariables(el);
    if (opts.height) el.style.setProperty("--olo-height", opts.height);
    el.innerHTML =
      '<svg class="olo-face-svg" viewBox="11.5 -1 32.3 26.2" role="img" aria-label="' +
        label + '">' + markInk(null) + "</svg>";

    var running = false;
    var stopTimer = 0;

    function start() {
      if (still) return;
      clearTimeout(stopTimer);
      running = true;
      el.classList.add("working");
    }

    /* Starting is immediate; stopping waits.
     *
     * **The last sheet through stays as the nose.** A pass runs from +26 to −26,
     * so the nose is exactly halfway, and stopping means waiting for the next
     * time the loop reaches that halfway point and dropping the animation there.
     * The resting state carries no offset, so the sheet simply stays where it
     * had got to — and only then does the mark turn back and the smile return.
     *
     * Cutting the loop the moment the work finishes would snap the sheet from
     * wherever it was to the nose, which is the one frame that would say the
     * whole thing was a trick. */
    function stop() {
      clearTimeout(stopTimer);
      if (!running) return;
      running = false;
      var sheet = el.querySelector(".olo-sheet");
      var animation = sheet && sheet.getAnimations && sheet.getAnimations()[0];
      if (!animation) {
        el.classList.remove("working");
        return;
      }
      var timing = animation.effect && animation.effect.getComputedTiming();
      var progress = timing && timing.progress != null ? timing.progress : null;
      var wait = progress === null
        ? MILL.lead * MILL.turn - Number(animation.currentTime || 0) + MILL.pass / 2
        : (progress <= 0.5 ? 0.5 - progress : 1.5 - progress) * MILL.pass;
      stopTimer = setTimeout(function () {
        el.classList.remove("working");
      }, Math.max(0, wait));
    }

    if (opts.running) start();

    return {
      element: el,
      start: start,
      stop: stop,
      isRunning: function () { return running; },
      destroy: function () {
        clearTimeout(stopTimer);
        el.classList.remove("olo-face", "working", "still");
        el.innerHTML = "";
      }
    };
  }

  global.volocalWordmark = volocalWordmark;
  global.volocalFace = volocalFace;
  global.volocalMill = volocalMill;
  global.Volocal = {
    wordmark: volocalWordmark,
    face: volocalFace,
    mill: volocalMill,
    GLYPH: GLYPH,
    PEN: PEN,
    PEN_TIMING: PEN_TIMING,
    SMILE: SMILE,
    smileArc: smileArc,
    HEADER: HEADER,
    FACE: FACE,
    MILL: MILL,
    ALIVE: ALIVE
  };
})(typeof window !== "undefined" ? window : this);
