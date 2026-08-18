/* The little Volocal, in four beats.
 *
 * A toy window that tells the whole story on a loop: the mark waiting, a
 * recording dropped on it, the mark turning into the mill while it works, and
 * the transcript arriving with something to play. It is a cartoon and says so —
 * the honest windows further down the page are the application itself.
 *
 * The three states of the mark are the real ones. `.olo-face` and `.working`
 * come from `brand.css`, so the face that blinks here and the mill it becomes
 * are the same drawing the program uses, not a second one.
 */
(function () {
  "use strict";

  var scene = document.getElementById("chibi");
  if (!scene) return;

  var mark = document.getElementById("chibi-mark");
  var words = [].slice.call(scene.querySelectorAll(".chibi-word"));

  /* The timeline is the application's waveform, at the application's numbers:
     `PlaybackControls.tsx` draws 2 px bars on a 7 px pitch, anchored on the
     centre line, with a ceiling of 0.82 of the half height and a floor of two
     pixels. The first version of this was a flexible bar per column at whatever
     width fell out, which is why it did not look like the program.

     The amplitudes are the same fixed formula the live previews use, so the
     cartoon's recording and the preview's recording are the same invented
     recording rather than two different ones. */
  var BAR_PITCH = 7;
  var BAR_WIDTH = 2;
  var AMPLITUDE_CEILING = 0.82;

  function amplitudeAt(x) {
    var a = 0.5 + 0.5 * Math.sin(x * 21.3);
    var b = 0.5 + 0.5 * Math.sin(x * 3.1 + 1.7);
    var c = 0.5 + 0.5 * Math.sin(x * 57.9 + 0.4);
    var speech = Math.pow(b, 0.6) * (0.45 + 0.55 * a) * (0.7 + 0.3 * c);
    /* Speech has gaps in it, and a waveform without them reads as noise. */
    var gap = 0.5 + 0.5 * Math.sin(x * 8.7 + 2.2);
    return Math.max(0.05, speech * (gap > 0.22 ? 1 : 0.18));
  }

  var status = scene.querySelector(".chibi-status");
  var wave = document.getElementById("chibi-wave");
  var bars = [];

  function drawWave() {
    if (!wave) return;
    var width = wave.clientWidth;
    if (!width) return;
    var count = Math.max(8, Math.floor((width + BAR_PITCH - BAR_WIDTH) / BAR_PITCH));
    var half = wave.clientHeight / 2;
    var max = Math.max(2, (half - 1) * AMPLITUDE_CEILING);
    var html = "";
    for (var b = 0; b < count; b += 1) {
      var h = Math.max(1, amplitudeAt(b / count) * max);
      html += '<i style="height:' + (Math.round(h * 2 * 10) / 10) + 'px"></i>';
    }
    wave.innerHTML = html;
    bars = [].slice.call(wave.querySelectorAll("i"));
  }

  drawWave();
  window.addEventListener("resize", function () { drawWave(); playhead(lastRatio); }, { passive: true });

  var lastRatio = 0;

  function playhead(ratio) {
    lastRatio = ratio;
    var upto = Math.round(bars.length * ratio);
    bars.forEach(function (bar, i) { bar.classList.toggle("played", i < upto); });
  }
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");

  /* Written once, then alive: it blinks and now and then smiles, exactly as it
     does in the application's empty archive. */
  var face = window.volocalFace ? volocalFace(mark, { height: "66px" }) : null;

  /* The beats, in milliseconds from the start of a loop. Chosen at the screen:
     long enough that each one is a separate thing that happened, short enough
     that the whole story fits in the time somebody spends looking at a page. */
  var BEATS = {
    drop: 1400,      /* the file arrives */
    work: 2500,      /* the mark turns and starts milling */
    finish: 5300,    /* the mill stops, the mark turns back and smiles */
    done: 6800,      /* only then does the transcript land */
    play: 7300,      /* and starts playing itself */
    hold: 13500      /* how long the finished state stands before it starts again */
  };

  var timers = [];
  var playing = null;

  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function clear() {
    timers.forEach(clearTimeout);
    timers = [];
    if (playing) { clearInterval(playing); playing = null; }
  }

  function state(name) {
    scene.className = "chibi-window is-" + name;
  }

  function loop() {
    clear();
    state("idle");
    mark.classList.remove("working");
    words.forEach(function (w) { w.classList.remove("on"); });
    playhead(0);
    if (status) status.textContent = "Přepisuji…";

    at(BEATS.drop, function () { state("dropping"); });
    at(BEATS.work, function () {
      state("working");
      /* The same turn the application makes while a transcript runs: the two
         `o` become rollers and the stem is the sheet passing between them. */
      mark.classList.add("working");
    });
    /* The work finishing is its own beat, and it used to be swallowed: the
       panel faded at the same moment the mill stopped, so the mark turned back
       and smiled behind a curtain. Now the panel stands while the rollers come
       to rest, the mark turns upright, and the smile arrives last — which is
       how `brand.css` stages it: the smile carries a delay of one whole turn on
       the way back. Only after that does the text appear. */
    at(BEATS.finish, function () {
      state("finishing");
      mark.classList.remove("working");
      if (status) status.textContent = "Hotovo.";
      /* Nothing widens the smile here, and that is the correction. The smile
         swings back about the centre of its own arc, and while it is swinging
         it must be the drawn one — 45 degrees each side, the shape
         `GLYPH.smile` actually is. Opening it to 58 during the return sent the
         wide version round the curve, which is a different mark arriving. The
         face grins on its own later, when `ALIVE` says so. */
    });
    at(BEATS.done, function () { state("done"); });
    at(BEATS.play, function () {
      var i = 0;
      playing = setInterval(function () {
        if (i >= words.length) { clearInterval(playing); playing = null; return; }
        words.forEach(function (w, j) { w.classList.toggle("on", j <= i); });
        /* The peaks fill in step with the words: one playhead, two readings of
           it, which is what the transcript and the timeline are. */
        playhead((i + 1) / words.length);
        i += 1;
      }, 260);
    });
    at(BEATS.hold, loop);
  }

  /* Reduced motion gets the end of the story rather than none of it. */
  if (reduced.matches) {
    state("done");
    words.forEach(function (w) { w.classList.add("on"); });
    playhead(1);
    return;
  }

  /* It plays only while somebody can see it. A cartoon looping in a background
     tab is nobody's idea of a good time. */
  if ("IntersectionObserver" in window) {
    var running = false;
    var watch = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !running) { running = true; loop(); }
        else if (!entry.isIntersecting && running) { running = false; clear(); state("idle"); }
      });
    }, { threshold: 0.4 });
    watch.observe(scene);
  } else {
    loop();
  }
}());
