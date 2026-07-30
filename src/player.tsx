//! A single audio element for the whole application.
//!
//! Were the player owned by the detail screen, leaving for the archive would
//! remove it from the DOM and the sound would stop. The element therefore
//! lives above the screens; the detail and the header bar only look at it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "./api";

/** Loudness envelope (0-255) and how many samples fall on one second. */
export interface Waveform {
  points: number[];
  pointsPerSecond: number;
  equalizer: number[];
  equalizerPointsPerSecond: number;
  equalizerBandCount: number;
}

/** Empty placeholder used until the real waveform arrives. */
export const EMPTY_WAVEFORM: Waveform = {
  points: [],
  pointsPerSecond: 12,
  equalizer: [],
  equalizerPointsPerSecond: 10,
  equalizerBandCount: 24,
};

/**
 * Loads a recording waveform.
 *
 * If the backend has not generated it yet, it starts ffmpeg in the
 * background and reports `is_calculating`. The client polls briefly because
 * waveform rendering must never block opening a transcript.
 *
 * `isCancelled` becomes true when the user has navigated away and the result
 * is no longer needed.
 */
export async function loadWaveform(
  recordingId: string,
  complete: (waveform: Waveform) => void,
  isCancelled: () => boolean = () => false
): Promise<void> {
  // Large source videos can take noticeably longer to decode. Keep polling
  // for up to three minutes; navigation cancels the loop immediately.
  for (let attempt = 0; attempt < 120; attempt++) {
    if (isCancelled()) return;
    try {
      const waveform = await api.recordingWaveform(recordingId);
      if (isCancelled()) return;
      if (waveform.points.length > 0 || waveform.equalizer.length > 0) {
        complete({
          points: waveform.points,
          pointsPerSecond: waveform.points_per_second || 12,
          equalizer: waveform.equalizer,
          equalizerPointsPerSecond: waveform.equalizer_points_per_second || 10,
          equalizerBandCount: waveform.equalizer_band_count || 24,
        });
      }
      if (
        !waveform.is_calculating ||
        (waveform.points.length > 0 && waveform.equalizer.length > 0)
      ) {
        return;
      }
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * Returns interpolated real frequency-band peaks for the current audio time.
 *
 * The optional output count resamples the frequency axis for wide or narrow
 * players without moving the bands horizontally.
 */
export function equalizerAtTime(
  waveform: Waveform,
  time: number,
  outputCount = waveform.equalizerBandCount
): number[] {
  const sourceCount = waveform.equalizerBandCount;
  if (
    sourceCount <= 0 ||
    outputCount <= 0 ||
    waveform.equalizer.length < sourceCount
  ) {
    return [];
  }

  const frameCount = Math.floor(waveform.equalizer.length / sourceCount);
  const position = Math.max(0, time * waveform.equalizerPointsPerSecond);
  const firstFrame = Math.min(frameCount - 1, Math.floor(position));
  const secondFrame = Math.min(frameCount - 1, firstFrame + 1);
  const frameRatio = Math.min(1, position - firstFrame);

  const bandValue = (band: number) => {
    const first = waveform.equalizer[firstFrame * sourceCount + band] ?? 0;
    const second = waveform.equalizer[secondFrame * sourceCount + band] ?? first;
    return (first + (second - first) * frameRatio) / 255;
  };

  if (outputCount === sourceCount) {
    return Array.from({ length: sourceCount }, (_, band) => bandValue(band));
  }

  return Array.from({ length: outputCount }, (_, index) => {
    const sourcePosition =
      outputCount === 1 ? 0 : (index / (outputCount - 1)) * (sourceCount - 1);
    const left = Math.floor(sourcePosition);
    const right = Math.min(sourceCount - 1, left + 1);
    const ratio = sourcePosition - left;
    return bandValue(left) + (bandValue(right) - bandValue(left)) * ratio;
  });
}

interface Status {
  /** id of the currently loaded recording; null = nothing is playing */
  recordingId: string | null;
  title: string;
  path: string;
  duration: number;
  time: number;
  isPlaying: boolean;
  rate: number;
  /** Loads a recording and plays it from the given time. Nothing else
      přehrávání nepřepíná — otevřít jiný přepis zvuk nepřeruší. */
  start: (
    recordingId: string,
    path: string,
    title: string,
    duration: number,
    fromTime?: number
  ) => void;
  togglePlayback: () => void;
  seek: (t: number) => void;
  shift: (o: number) => void;
  setRate: (r: number) => void;
  close: () => void;
  /** Waveform of the playing recording. ffmpeg computes it up front, see
      poznámka u Web Audia níž. */
  waveform: Waveform;
  /** The source file could not be opened — most likely it is gone. */
  sourceMissing: boolean;
  /** Instantaneous playback position. Unlike the state value it triggers no
      takže se z ní dá kreslit v každém snímku bez zátěže Reactu. */
  readTime: () => number;
}

const PlayerContext = createContext<Status | null>(null);

export function usePlayer(): Status {
  const k = useContext(PlayerContext);
  if (!k) throw new Error("usePrehravac mimo PrehravacProvider");
  return k;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [waveform, setWaveform] = useState<Waveform>(EMPTY_WAVEFORM);
  const [sourceMissing, setSourceMissing] = useState(false);
  /** Which recording the waveform was last requested for; older replies are dropped. */
  const lastLoadedRecording = useRef<string | null>(null);

  // Note: analysing the audio through Web Audio (AnalyserNode) does not work
  // here. Tauri serves files from a different origin than the window, so the
  // track is treated as cross-origin and createMediaElementSource silences it
  // — without throwing, it simply stops being audible. The loudness envelope
  // is therefore computed by ffmpeg up front and drawn from stored values.

  if (!audio.current && typeof Audio !== "undefined") {
    audio.current = new Audio();
  }

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setTime(a.currentTime);
    const handleLoadedMetadata = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    a.addEventListener("play", handlePlay);
    a.addEventListener("pause", handlePause);
    a.addEventListener("ended", handlePause);
    a.addEventListener("timeupdate", handleTimeUpdate);
    // Without this, a deleted file would show up only as a play button that
    // does nothing: play() returns a rejected promise nobody reads.
    const handleError = () => {
      if (a.currentSrc) {
        setSourceMissing(true);
        setIsPlaying(false);
      }
    };
    a.addEventListener("error", handleError);
    a.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => {
      a.removeEventListener("error", handleError);
      a.removeEventListener("play", handlePlay);
      a.removeEventListener("pause", handlePause);
      a.removeEventListener("ended", handlePause);
      a.removeEventListener("timeupdate", handleTimeUpdate);
      a.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, []);

  // Word highlighting needs a finer step than `timeupdate` provides (that
  // fires roughly four times a second and words would light up late). Sixty
  // times a second is needlessly often, though: the time sits in the context
  // value, so every change repaints the whole detail screen along with its
  // thousand segments. Eight times a second is indistinguishable to the eye
  // and an eighth of the work.
  //
  // This does not limit the waveform — it takes the time through `readTime`
  // straight off the audio element and keeps drawing every frame.
  useEffect(() => {
    if (!isPlaying) return;
    let running = true;
    let lastFrameTime = 0;
    const step = (current: number) => {
      if (!running) return;
      if (audio.current && current - lastFrameTime >= 125) {
        lastFrameTime = current;
        setTime(audio.current.currentTime);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
      running = false;
    };
  }, [isPlaying]);

  const start = useCallback(
    (
      id: string,
      newPath: string,
      newTitle: string,
      newDuration: number,
      fromTime = 0
    ) => {
      const a = audio.current;
      if (!a) return;

      if (id !== recordingId) {
        a.pause();
        setSourceMissing(false);
        setWaveform(EMPTY_WAVEFORM);
        // Write first, then call: the loader asks right at the start whether
        // anyone still wants the result.
        lastLoadedRecording.current = id;
        loadWaveform(id, setWaveform, () => id !== lastLoadedRecording.current);
        a.src = convertFileSrc(newPath);
        a.playbackRate = rate;
        a.load();
        setRecordingId(id);
        setPath(newPath);
        setTitle(newTitle);
        setDuration(newDuration);
        setTime(fromTime);
      }

      // Seeking is only possible once the browser knows the track length.
      const startPlayback = () => {
        a.currentTime = Math.max(0, fromTime);
        a.play().catch(() => setSourceMissing(true));
      };
      if (a.readyState >= 1) startPlayback();
      else a.addEventListener("loadedmetadata", startPlayback, { once: true });
    },
    [recordingId, rate]
  );

  const readTime = useCallback(() => audio.current?.currentTime ?? 0, []);

  const togglePlayback = useCallback(() => {
    const a = audio.current;
    if (!a || !a.src) return;
    if (a.paused) {
      a.play().catch(() => setSourceMissing(true));
    } else a.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, t);
    setTime(a.currentTime);
  }, []);

  const shift = useCallback((o: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, a.currentTime + o);
    setTime(a.currentTime);
  }, []);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    if (audio.current) audio.current.playbackRate = r;
  }, []);

  const close = useCallback(() => {
    const a = audio.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setRecordingId(null);
    setPath("");
    setTitle("");
    setTime(0);
    setDuration(0);
    setWaveform(EMPTY_WAVEFORM);
    setSourceMissing(false);
  }, []);

  const value = useMemo<Status>(
    () => ({
      recordingId,
      title,
      path,
      duration,
      time,
      isPlaying,
      rate,
      start,
      togglePlayback,
      seek,
      shift,
      setRate,
      close,
      waveform,
      sourceMissing,
      readTime,
    }),
    [
      recordingId,
      title,
      path,
      duration,
      time,
      isPlaying,
      rate,
      start,
      togglePlayback,
      seek,
      shift,
      setRate,
      close,
      waveform,
      sourceMissing,
      readTime,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/**
 * Returns `count` normalized amplitude values ending at the current time.
 *
 * Linear interpolation prevents the waveform from jumping between stored
 * samples as playback advances.
 */
export function windowAmplitude(
  waveform: { points: number[]; pointsPerSecond: number },
  time: number,
  count: number
): number[] {
  const end = time * waveform.pointsPerSecond;
  const output: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const position = end - (count - 1 - i);
    if (position < 0) {
      output[i] = 0;
      continue;
    }
    const full = Math.floor(position);
    const fraction = position - full;
    const a = waveform.points[full] ?? 0;
    const b = waveform.points[full + 1] ?? a;
    output[i] = (a + (b - a) * fraction) / 255;
  }
  return output;
}

/**
 * Returns a waveform window around the current time.
 *
 * `anchor` (0–1) determines where the current time appears within the
 * returned width. Values before it have already played; values after it are
 * upcoming. Samples are interpolated for smooth movement.
 */
export function waveformWindowAroundTime(
  waveform: { points: number[]; pointsPerSecond: number },
  time: number,
  count: number,
  windowSeconds: number,
  anchor: number
): number[] {
  const output: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const ratio = count === 1 ? 0 : i / (count - 1);
    const position = (time + (ratio - anchor) * windowSeconds) * waveform.pointsPerSecond;
    if (position < 0 || position >= waveform.points.length) {
      output[i] = 0;
      continue;
    }
    const full = Math.floor(position);
    const fraction = position - full;
    const a = waveform.points[full] ?? 0;
    const b = waveform.points[full + 1] ?? a;
    output[i] = (a + (b - a) * fraction) / 255;
  }
  return output;
}

/**
 * Condenses the entire recording into `count` normalized values.
 *
 * Each bucket uses its peak rather than its average so short, loud sounds
 * remain visible.
 */
export function fullWaveform(
  waveform: { points: number[]; pointsPerSecond: number },
  count: number
): number[] {
  const n = waveform.points.length;
  if (n === 0 || count === 0) return [];
  const output: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * n) / count);
    const to_ = Math.max(from + 1, Math.floor(((i + 1) * n) / count));
    let peak = 0;
    for (let j = from; j < to_ && j < n; j++) {
      if (waveform.points[j] > peak) peak = waveform.points[j];
    }
    output[i] = peak / 255;
  }
  return output;
}

/**
 * Loudness envelope drawn onto a canvas — a ribbon of nested outlines.
 *
 * Individual lines made of `div`s did not work out: Windows commonly scales to
 * 125 or 150 %, the pixel ratio is then fractional, and the browser rounds each
 * line differently, so they end up different widths. The canvas is sized by the
 * pixel ratio and filled with an area, where rounding does not matter.
 */
/** Volby kresby obrysu. */
export interface WaveformOptions {
  layers: number;
  mirrored: boolean;
  gain: number;
  /** device pixel ratio */
  ratio: number;
  /** Line colour. When absent it is read from CSS, which is expensive and in
      snímků se to nevyplatí, protože to nutí přepočítat styly. */
  color?: string;
}

/**
 * Draws the envelope onto a canvas. Kept apart from the component so it can
 * also be driven from a frame loop, without React repainting.
 */
export function drawWaveform(
  c: HTMLCanvasElement,
  values: number[],
  { layers, mirrored, gain, ratio, color }: WaveformOptions
) {
  const widthPx = c.width;
  const heightPx = c.height;
  const ctx = c.getContext("2d");
  if (!ctx || widthPx === 0 || heightPx === 0) return;

  ctx.clearRect(0, 0, widthPx, heightPx);
  if (values.length < 2) return;

  ctx.strokeStyle = color ?? getComputedStyle(c).color;
  ctx.lineWidth = Math.max(1, Math.round(ratio));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const centerLine = mirrored ? heightPx / 2 : heightPx - ctx.lineWidth;
  const range = centerLine - ctx.lineWidth;

  const x = (i: number) => (i / (values.length - 1)) * widthPx;
  const height = (i: number) =>
    (0.05 + Math.min(1, values[i] * gain) * 0.95) * range;

  /** One outline at a reduced scale. `direction` is -1 up, +1 down. */
  const drawLayer = (ratio: number, opacity: number, direction: number) => {
    const y = (i: number) => centerLine + direction * height(i) * ratio;
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    // Quadratic curves through the midpoints between samples: a polyline
    // would look jittery at fine sampling.
    for (let i = 0; i < values.length - 1; i++) {
      ctx.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
    }
    ctx.lineTo(x(values.length - 1), y(values.length - 1));
    ctx.stroke();
  };

  for (let k = 0; k < layers; k++) {
    const ratio = 1 - k / layers;
    // Inner lines fade so the ribbon has depth.
    const opacity = 0.35 + 0.65 * ratio;
    drawLayer(ratio, opacity, -1);
    if (mirrored) drawLayer(ratio, opacity, 1);
  }
  ctx.globalAlpha = 1;
}

/**
 * Draws bars like an equalizer.
 *
 * Either symmetrically around a centre line, or — in the narrow pill, where
 * mirroring would collapse into a grey band — upwards from the bottom edge.
 *
 * Cheaper than curves: the rectangles go into a single path and are filled at
 * once, whereas every arc is computed separately.
 */
export function drawBars(
  c: HTMLCanvasElement,
  values: number[],
  {
    ratio,
    color,
    gain = 1.6,
    ceiling = 1,
    anchoring = "center",
    startRatio = 0,
  }: {
    ratio: number;
    color?: string;
    gain?: number;
    /** What share of the available height a bar may fill. A smaller number
     *  keeps the envelope lower without changing the drawing surface. */
    ceiling?: number;
    /** Where bars grow from: the centre line both ways, or the bottom edge
     *  upwards. */
    anchoring?: "center" | "bottom";
    /** How far from the left drawing starts, as a fraction of the width.
     *  Above zero the envelope is limited to what is yet to be heard, leaving
     *  the area left of the handle empty. */
    startRatio?: number;
  }
) {
  const widthPx = c.width;
  const heightPx = c.height;
  const ctx = c.getContext("2d");
  if (!ctx || widthPx === 0 || heightPx === 0) return;

  ctx.clearRect(0, 0, widthPx, heightPx);
  if (values.length === 0) return;

  ctx.fillStyle = color ?? getComputedStyle(c).color;

  const fromBottom = anchoring === "bottom";
  const widthBars = Math.max(1, Math.round(2 * ratio));
  const step = widthPx / values.length;
  const centerLine = fromBottom ? heightPx : heightPx / 2;
  const maxHeight = (centerLine - Math.round(ratio)) * ceiling;
  const minHeight = Math.max(widthBars, Math.round(2 * ratio));
  const r = widthBars / 2;

  const fromX = startRatio > 0 ? startRatio * widthPx : 0;

  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const height = Math.max(
      minHeight,
      Math.round(Math.min(1, values[i] * gain) * maxHeight)
    );
    const x = Math.round(i * step + (step - widthBars) / 2);
    if (x < fromX) continue;
    if (fromBottom) {
      // No rounding at the bottom: the bar rests on the edge there and a
      // curve would make it look as if it were not touching.
      ctx.roundRect(x, centerLine - height, widthBars, height, [r, r, 0, 0]);
    } else {
      ctx.roundRect(x, centerLine - height, widthBars, height * 2, r);
    }
  }
  ctx.fill();
}

/** Sizes the canvas drawing surface by the pixel ratio. Returns whether it
 *  has a size at all. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  ratio: number,
) {
  if (width === 0 || height === 0) return false;
  const widthPx = Math.round(width * ratio);
  const heightPx = Math.round(height * ratio);
  if (canvas.width !== widthPx) canvas.width = widthPx;
  if (canvas.height !== heightPx) canvas.height = heightPx;
  return true;
}

export function Waveform({
  values,
  className,
  style,
  layers = 9,
  mirrored = false,
  gain = 1.25,
  waveformStyle = "ribbon",
  anchoring = "center",
  ceiling = 1,
}: {
  /** hlasitost 0–1, zleva doprava */
  values: number[];
  className?: string;
  style?: CSSProperties;
  /** Draw downwards too, symmetrically around the horizontal centre line. */
  mirrored?: boolean;
  /** Loudness multiplier. Above one, quieter passages rise and loud ones
      se zarazí o strop, takže je obrys výraznější. */
  gain?: number;
  /** How many nested outlines the ribbon has. A wide surface needs fewer
      vrstev — hustě položené skoro rovnoběžné čáry se rozvlní do moaré. */
  layers?: number;
  /** A continuous ribbon, or separate bars like an equalizer. */
  waveformStyle?: "ribbon" | "bars";
  /** Jen pro sloupce: odkud rostou. */
  anchoring?: "center" | "bottom";
  /** Bars only: what share of the height they may take. */
  ceiling?: number;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, ratio: 1 });

  // Measure the wrapper, never the canvas itself.
  //
  // A canvas is a replaced element: padding does not stretch it, its size comes
  // from its own `width` attribute. Were it measured directly, every repaint
  // would grow it, the observer would report that back, and the canvas would
  // keep growing until memory ran out.
  useEffect(() => {
    const o = container.current;
    if (!o) return;
    const benchmark = () =>
      setSize((p) => {
        const width = o.clientWidth;
        const height = o.clientHeight;
        const ratio = window.devicePixelRatio || 1;
        return p.width === width && p.height === height && p.ratio === ratio
          ? p
          : { width, height, ratio };
      });
    benchmark();
    const observer = new ResizeObserver(benchmark);
    observer.observe(o);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!prepareCanvas(c, size.width, size.height, size.ratio)) return;
    if (waveformStyle === "bars") {
      drawBars(c, values, {
        ratio: size.ratio,
        gain,
        ceiling,
        anchoring,
      });
    } else {
      drawWaveform(c, values, {
        layers,
        mirrored,
        gain,
        ratio: size.ratio,
      });
    }
  }, [values, size, layers, mirrored, gain, waveformStyle, anchoring, ceiling]);

  return (
    <span ref={container} className={className} style={style} aria-hidden>
      <canvas ref={canvas} />
    </span>
  );
}
