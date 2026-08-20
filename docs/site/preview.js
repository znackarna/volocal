/* The two live previews: real application markup under the application's own
 * stylesheet (`app-shot.css`), doing what the running program does. This file
 * only does what the program would: it scales the window to the column, plays
 * the transcript, paints the waveform with `PlaybackControls.tsx`'s numbers,
 * and lets a click on a word move the playhead — the gesture the product
 * exists for.
 */
(function () {
  "use strict";

  var reduced = matchMedia("(prefers-reduced-motion: reduce)");

  /* ----------------------------------------------------- the window, to scale
     The application is drawn at the size it has on a screen and the whole
     drawing is scaled to the column. Scaling rather than reflowing is the
     point: the proportions stay the program's. */
  var viewports = [].slice.call(
    document.querySelectorAll(".preview-viewport")
  );

  /* The stage's own size comes from the stylesheet, and `offsetWidth` reports
     it unchanged by the transform, so this reads it back rather than carrying
     a second copy of the numbers. */
  function fit() {
    viewports.forEach(function (viewport) {
      var stage = viewport.firstElementChild;
      var k = viewport.clientWidth / stage.offsetWidth;
      var height = stage.offsetHeight;
      stage.style.transform = "scale(" + k + ")";
      viewport.style.height = Math.round(height * k) + "px";
    });
  }
  fit();
  window.addEventListener("resize", fit, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

  /* ------------------------------------------------------------- the brand */
  var shotWordmark = document.getElementById("shot-wordmark");
  /* The same staging as the page header: the application's five second hold
     and one second close. It is the same mark doing the same thing. */
  if (shotWordmark && window.volocalWordmark) volocalWordmark(shotWordmark, { label: "Archiv" });

  /* The first-run view carries the same header, so it carries the same mark. */
  var wizardWordmark = document.getElementById("wizard-wordmark");
  if (wizardWordmark && window.volocalWordmark) volocalWordmark(wizardWordmark, { label: "Archiv" });

  var millHost = document.getElementById("shot-mill");
  /* The archive window shows a recording being transcribed, and while that
     runs the mark turns on its side and becomes the mill. */
  if (millHost && window.volocalMill) volocalMill(millHost, { running: true });

  /* ---------------------------------------------------------- the waveform
     `PlaybackControls.tsx`'s numbers: 2 px bars every 7 px, anchored on the
     centre line, ceiling 0.82 of the half height, the played part in the
     accent colour up to the handle. The amplitudes are the one invented thing
     — the real ones come out of decoded audio — so they are a fixed formula,
     identical on every load, and the page's footer says the recordings are
     made up. */
  var BAR_SPACING = 7;
  var BAR_THICKNESS = 2;
  var AMPLITUDE_CEILING = 0.82;
  var SLIDER_THUMB = 13;

  function amplitudeAt(t) {
    var a = 0.5 + 0.5 * Math.sin(t * 21.3);
    var b = 0.5 + 0.5 * Math.sin(t * 3.1 + 1.7);
    var c = 0.5 + 0.5 * Math.sin(t * 57.9 + 0.4);
    var speech = Math.pow(b, 0.6) * (0.45 + 0.55 * a) * (0.7 + 0.3 * c);
    /* Speech has gaps in it, and a waveform without them reads as noise. */
    var gap = 0.5 + 0.5 * Math.sin(t * 8.7 + 2.2);
    return Math.max(0.05, speech * (gap > 0.22 ? 1 : 0.18));
  }

  function paintWaves(waves, played) {
    var canvas = waves.querySelector("canvas");
    if (!canvas) return;
    var width = waves.clientWidth;
    var height = waves.clientHeight;
    if (!width || !height) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var barCount = Math.max(24, Math.round(width / BAR_SPACING));
    var step = (width * dpr) / barCount;
    var barWidth = BAR_THICKNESS * dpr;
    var radius = barWidth / 2;
    var centre = (height * dpr) / 2;
    var maxHeight = (centre - Math.round(dpr)) * AMPLITUDE_CEILING;
    var minHeight = Math.max(barWidth, Math.round(2 * dpr));

    var rest = getComputedStyle(waves).color;
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || rest;
    var handle = (SLIDER_THUMB / 2 + Math.max(0, width - SLIDER_THUMB) * played) / width;

    for (var i = 0; i < barCount; i += 1) {
      var t = i / barCount;
      var h = Math.max(minHeight, amplitudeAt(t) * maxHeight);
      var x = i * step + (step - barWidth) / 2;
      ctx.fillStyle = t <= handle ? accent : rest;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, centre - h, barWidth, h * 2, radius);
      else ctx.rect(x, centre - h, barWidth, h * 2);
      ctx.fill();
    }
  }

  /* The application measures where the timeline starts and ends and lays the
     waveform over exactly that span (`usePlayerGeometry`). So does this. */
  function layoutWaves(shot) {
    var waves = shot.querySelector(".waves");
    var player = shot.querySelector(".player");
    var axis = shot.querySelector(".axis-wrap");
    if (!waves || !player || !axis) return null;
    var playerBox = player.getBoundingClientRect();
    var axisBox = axis.getBoundingClientRect();
    var k = playerBox.width / player.offsetWidth || 1;
    waves.style.left = Math.round((axisBox.left - playerBox.left) / k) + "px";
    waves.style.width = Math.round(axisBox.width / k) + "px";
    return waves;
  }

  /* -------------------------------------------------- the transcript, playing
     What the program does while audio runs: the words that have sounded take
     the accent colour, the segment under the playhead is current, the ring
     fills, the clock counts, the waveform colours up to the handle. */
  var RING_CIRCUMFERENCE = 125.66370614359172;
  var DURATION = 2704;

  var detail = document.querySelector('.shot[data-shot="detail"]');
  if (detail) startTranscript(detail);

  function startTranscript(shot) {
    var words = [].slice.call(shot.querySelectorAll(".word"));
    var segments = [].slice.call(shot.querySelectorAll(".segment"));
    var clock = shot.querySelector(".time");
    var ring = shot.querySelector(".play-progress");
    var slider = shot.querySelector(".slider");
    var waves = layoutWaves(shot);
    var at = 5;
    var timer = null;

    function stamp(seconds) {
      var m = Math.floor(seconds / 60);
      var s = Math.floor(seconds % 60);
      return m + ":" + (s < 10 ? "0" : "") + s;
    }

    function show(index) {
      at = index;
      var word = words[index];
      var time = Number(word.dataset.time);
      var segment = word.closest(".segment");

      segments.forEach(function (s) { s.classList.toggle("current", s === segment); });
      words.forEach(function (w, i) {
        var same = w.closest(".segment") === segment;
        w.classList.toggle("sounded", same && i <= index);
      });
      if (clock) clock.textContent = stamp(time) + " / 45:04";
      if (ring) ring.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE * (1 - time / DURATION)));
      if (slider) slider.value = String(time);
      if (waves) paintWaves(waves, time / DURATION);
    }

    function step() {
      var next = at + 1 >= words.length ? 0 : at + 1;
      show(next);
      var gap = next === 0 ? 2200
        : Math.max(180, (Number(words[next].dataset.time) - Number(words[next - 1].dataset.time)) * 1000);
      timer = setTimeout(step, Math.min(gap, 900));
    }

    /* Clicking a word moves the playhead — the transcript's own gesture, kept
       working here rather than drawn. */
    words.forEach(function (word, i) {
      word.addEventListener("click", function () {
        clearTimeout(timer);
        show(i);
        if (!reduced.matches) timer = setTimeout(step, 700);
      });
    });

    show(at);
    window.addEventListener("resize", function () {
      waves = layoutWaves(shot);
      if (waves) paintWaves(waves, Number(words[at].dataset.time) / DURATION);
    }, { passive: true });

    if (reduced.matches) return;
    /* Only while the window is on screen: it is a preview standing on a page,
       not a player anybody left running. */
    if ("IntersectionObserver" in window) {
      var watch = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !timer) timer = setTimeout(step, 600);
          else if (!entry.isIntersecting && timer) { clearTimeout(timer); timer = null; }
        });
      }, { threshold: 0.25 });
      watch.observe(shot);
    } else {
      timer = setTimeout(step, 600);
    }
  }

  /* -------------------------------------------------- the archive, working
     One recording is being transcribed, so its bar advances. Slowly, and only
     while the window is on screen. */
  var library = document.querySelector('.shot[data-shot="library"]');
  if (library && !reduced.matches) {
    var fill = library.querySelector(".progress-fill");
    var count = library.querySelector(".p-progress-count");
    var percent = 62;
    var creeping = null;
    var creep = function () {
      percent += 1;
      if (percent > 96) percent = 62;
      if (fill) fill.style.width = percent + "%";
      if (count) count.textContent = percent + " %";
    };
    /* The hero stands when the view opens and rolls up a moment later, which
       is what the application does the first time somebody scrolls the list:
       the mark drops to 38 px and the heading to 15, both on the transitions
       the program already carries. Once — a header that reopened itself would
       be a window nobody is touching, moving on its own. */
    var sticky = library.querySelector(".archive-sticky");
    var hero = library.querySelector(".archive-drop-zone");
    var rolled = false;
    var roll = function () {
      if (rolled || !sticky || !hero) return;
      rolled = true;
      sticky.classList.add("collapsed");
      hero.classList.add("compact");
    };

    if ("IntersectionObserver" in window) {
      var libraryWatch = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !creeping) {
            creeping = setInterval(creep, 2400);
            setTimeout(roll, 2200);
          } else if (!entry.isIntersecting && creeping) { clearInterval(creeping); creeping = null; }
        });
      }, { threshold: 0.25 });
      libraryWatch.observe(library);
    }
  }

  /* ------------------------------------------------- the third view, standing
     The same window as the first, with the dialog over it. Nothing in it moves,
     but the waveform is painted on a canvas, so without this the player would
     be an empty strip. 0.86 is where the markup leaves the handle. */
  var stills = [].slice.call(
    document.querySelectorAll('.shot[data-shot="detail-still"], .shot[data-shot="detail-still2"]')
  ).map(layoutWaves).filter(Boolean);
  var paintStills = function () {
    stills.forEach(function (waves) { paintWaves(waves, 0.86); });
  };
  paintStills();

  /* ------------------------------------------------------------ the carousel
     Hand-driven, which is the whole point: a window that changed on its own
     would move under somebody reading it. Arrows, dots, and the arrow keys. */
  var carousel = document.querySelector(".carousel");
  if (carousel) {
    var track = carousel.querySelector(".carousel-track");
    var slides = [].slice.call(carousel.querySelectorAll(".slide"));
    var dotBox = carousel.querySelector(".carousel-dots");
    var at = 0;
    /* The gap between slides in the stylesheet — the track shifts by a slide
       plus one of these, or the next window arrives short of the frame. */
    var SLIDE_GAP = 120;

    var dots = slides.map(function (slide, i) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", "Pohled " + (i + 1) + " ze " + slides.length);
      dot.addEventListener("click", function () { go(i); });
      dotBox.appendChild(dot);
      return dot;
    });

    function go(next) {
      at = (next + slides.length) % slides.length;
      track.style.transform =
        "translateX(calc(" + (-at * 100) + "% - " + (at * SLIDE_GAP) + "px))";
      slides.forEach(function (slide, i) { slide.setAttribute("aria-hidden", String(i !== at)); });
      dots.forEach(function (dot, i) { dot.setAttribute("aria-selected", String(i === at)); });
      /* The stages are measured, and a slide that was hidden while the window
         was resized carries the old scale until it is asked again. */
      fit();
      paintStills();
    }

    [].slice.call(carousel.querySelectorAll(".carousel-arrow")).forEach(function (button) {
      button.addEventListener("click", function () { go(at + Number(button.dataset.step)); });
    });
    carousel.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { go(at - 1); event.preventDefault(); }
      if (event.key === "ArrowRight") { go(at + 1); event.preventDefault(); }
    });
    go(0);
  }

}());
