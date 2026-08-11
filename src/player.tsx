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
import { useI18n } from "./i18n";
import { formatTime } from "./types";

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

// One conversion promise per recording/source pair. The detail screen starts
// it in the background; pressing a word while it is still running joins the
// same promise instead of starting a second ffmpeg process.
const playbackSourceRequests = new Map<string, Promise<string>>();

function resolvedPlaybackSource(recordingId: string, path: string): Promise<string> {
  /* Every recording asks, not only the MP3s that get a converted proxy. The
  backend hands a non-MP3 back unchanged, so the answer is the same — but it is
  also the one place that opens the asset protocol for the file about to be
  played, and a shortcut here would leave everything else unable to load. */
  const key =`${recordingId}\u0000${path}`;
  const existing = playbackSourceRequests.get(key);
  if (existing) return existing;
  const request = api.playbackSource(recordingId).catch((error) => {
    playbackSourceRequests.delete(key);
    throw error;
  });
  playbackSourceRequests.set(key, request);
  return request;
}

/** Starts preparing precise MP3 seeking before the user presses a word. */
export function preparePlaybackSource(recordingId: string, path: string): void {
  void resolvedPlaybackSource(recordingId, path).catch(() => {
    // Playback still falls back to the original below. Preloading is best
    // effort and has nowhere useful to show an error of its own.
  });
}

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
  isPlaying: boolean;
  /** ffmpeg is creating the seek-accurate playback copy for a VBR MP3. */
  isPreparing: boolean;
  rate: number;
  /** Loads a recording and plays it from the given time. Nothing else
      switches playback over — opening another transcript does not stop the
      sound. */
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
  /** Updates display copy without reloading audio or changing playback. */
  updateTitle: (recordingId: string, title: string) => void;
  close: () => void;
  /** Waveform of the playing recording. ffmpeg computes it up front, see
      the note on Web Audio below. */
  waveform: Waveform;
  /** The source file could not be opened — most likely it is gone. */
  sourceMissing: boolean;
  /** Instantaneous playback position. Unlike the state value it triggers no
      re-render, so it can be drawn from on every frame without loading
      React. */
  readTime: () => number;
}

const PlayerContext = createContext<Status | null>(null);

/**
 * The clock, on its own.
 *
 * It moves eight times a second and almost nothing needs it: the archive, the
 * recorder and the transport bar all take the player for its identity and its
 * controls, and would have repainted with every tick purely for sitting in the
 * same context as a number they never read. Held apart, `Status` keeps one
 * identity for as long as the recording does, and only the three consumers
 * that draw a position follow the clock.
 */
const PlayerTimeContext = createContext(0);

export function usePlayer(): Status {
  const k = useContext(PlayerContext);
  if (!k) throw new Error("usePlayer must be used inside PlayerProvider");
  return k;
}

/** Playback position in seconds. Re-renders the caller on every tick, which is
 *  why it is asked for separately from {@link usePlayer}. */
export function usePlayerTime(): number {
  return useContext(PlayerTimeContext);
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [rate, setRateState] = useState(1);
  const [waveform, setWaveform] = useState<Waveform>(EMPTY_WAVEFORM);
  const [sourceMissing, setSourceMissing] = useState(false);
  /** Which recording the waveform was last requested for; older replies are dropped. */
  const lastLoadedRecording = useRef<string | null>(null);
  const sourceRequest = useRef(0);
  const pendingSeek = useRef(0);
  const preparing = useRef(false);

  const markPreparing = useCallback((value: boolean) => {
    preparing.current = value;
    setIsPreparing(value);
  }, []);

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
        markPreparing(false);
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
  }, [markPreparing]);

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

      pendingSeek.current = Math.max(0, fromTime);
      const sameSource = id === recordingId && path === newPath;

      if (sameSource && a.currentSrc && !preparing.current) {
        a.currentTime = pendingSeek.current;
        setTime(a.currentTime);
        a.play().catch(() => setSourceMissing(true));
        return;
      }

      const request = ++sourceRequest.current;

      if (!sameSource) {
        a.pause();
        a.removeAttribute("src");
        a.load();
        setSourceMissing(false);
        setWaveform(EMPTY_WAVEFORM);
        // Write first, then call: the loader asks right at the start whether
        // anyone still wants the result.
        lastLoadedRecording.current = id;
        loadWaveform(id, setWaveform, () => id !== lastLoadedRecording.current);
        setRecordingId(id);
        setPath(newPath);
        setTitle(newTitle);
        setDuration(newDuration);
        setTime(fromTime);
      }
      markPreparing(true);

      const loadAndPlay = (playbackPath: string) => {
        if (sourceRequest.current !== request) return;
        a.src = convertFileSrc(playbackPath);
        a.playbackRate = rate;
        a.load();

        // Seeking is only possible once the browser knows the track length.
        const startPlayback = () => {
          if (sourceRequest.current !== request) return;
          a.currentTime = pendingSeek.current;
          setTime(a.currentTime);
          markPreparing(false);
          a.play().catch(() => setSourceMissing(true));
        };
        if (a.readyState >= 1) startPlayback();
        else a.addEventListener("loadedmetadata", startPlayback, { once: true });
      };

      void resolvedPlaybackSource(id, newPath)
        .then(loadAndPlay)
        .catch((error) => {
          // Loss of ffmpeg or a full disk must not make the original recording
          // unplayable. It may seek coarsely, but it remains available.
          console.error("Could not prepare precise playback", error);
          loadAndPlay(newPath);
        });
    },
    [markPreparing, path, rate, recordingId]
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
    pendingSeek.current = Math.max(0, t);
    if (preparing.current || !a.currentSrc) {
      setTime(pendingSeek.current);
      return;
    }
    a.currentTime = pendingSeek.current;
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

  const updateTitle = useCallback((id: string, newTitle: string) => {
    if (id === recordingId) setTitle(newTitle);
  }, [recordingId]);

  const close = useCallback(() => {
    sourceRequest.current += 1;
    markPreparing(false);
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
  }, [markPreparing]);

  const value = useMemo<Status>(
    () => ({
      recordingId,
      title,
      path,
      duration,
      isPlaying,
      isPreparing,
      rate,
      start,
      togglePlayback,
      seek,
      shift,
      setRate,
      updateTitle,
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
      isPlaying,
      isPreparing,
      rate,
      start,
      togglePlayback,
      seek,
      shift,
      setRate,
      updateTitle,
      close,
      waveform,
      sourceMissing,
      readTime,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={time}>{children}</PlayerTimeContext.Provider>
    </PlayerContext.Provider>
  );
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
/** Options for drawing the outline. */
export interface WaveformOptions {
  layers: number;
  mirrored: boolean;
  gain: number;
  /** device pixel ratio */
  ratio: number;
  /** Line colour. When absent it is read from CSS, which is expensive and in
      a frame loop does not pay off, because it forces a style recalculation. */
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
/**
 * Stretches the part of the range speech actually occupies over the full bar.
 *
 * The stored values are absolute: how much of a 32-pixel-tall spectrum column
 * ffmpeg lit up. Ordinary speech never comes near the top of that, so it lived
 * between roughly a twentieth and a half — the bars were moving, but within a
 * band too narrow for the eye to notice.
 *
 * Cutting at both ends is what does the work. `floor` throws away the constant
 * hiss underneath; `peak` throws away the headroom above, which nothing ever
 * reaches. What is left is stretched over the whole height, so the same speech
 * swings across most of the strip instead of a third of it. `gamma` below one
 * then softens the result so loud consonants do not slam into the ceiling.
 */
export function emphasise(
  value: number,
  gamma: number,
  floor: number,
  peak: number
): number {
  const above = (value - floor) / Math.max(0.001, peak - floor);
  return above <= 0 ? 0 : Math.min(1, above ** gamma);
}

/** Diameter of the slider handle, matching `.posuvnik::-webkit-slider-thumb`
 *  in the stylesheet. The handle never reaches the very edge of its track, so
 *  its centre travels only between half that and the width less half. */
export const SLIDER_THUMB = 13;

/** Where the handle sits as a fraction of the track — not a plain percentage
 *  of the duration, or the colour would run ahead of the dot at the start and
 *  lag behind it at the end. Shared by the transport bar and the recorder, so
 *  the bars and the dot cannot disagree in one place and agree in the other. */
export function handleRatio(played: number, width: number): number {
  if (!(width > 0)) return played;
  return (SLIDER_THUMB / 2 + Math.max(0, width - SLIDER_THUMB) * played) / width;
}

export function drawBars(
  c: HTMLCanvasElement,
  values: number[],
  {
    ratio,
    color,
    gain = 1.6,
    ceiling = 1,
    gamma = 1,
    floor = 0,
    peak = 1,
    thickness = 2,
    anchoring = "center",
    startRatio = 0,
    playedRatio = 0,
    playedColor,
  }: {
    ratio: number;
    color?: string;
    gain?: number;
    /** Below one, quiet passages are lifted. See `emphasise`. */
    gamma?: number;
    /** Values at or below this count as silence. */
    floor?: number;
    /** Value treated as a full bar. Below one, unused headroom is cut off. */
    peak?: number;
    /** Bar width in logical pixels before the device ratio is applied. */
    thickness?: number;
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
    /** Bars up to this fraction of the width are painted in `playedColor`.
     *  That is what shows the position — there is no separate track line. */
    playedRatio?: number;
    playedColor?: string;
  }
) {
  const widthPx = c.width;
  const heightPx = c.height;
  const ctx = c.getContext("2d");
  if (!ctx || widthPx === 0 || heightPx === 0) return;

  ctx.clearRect(0, 0, widthPx, heightPx);
  if (values.length === 0) return;

  const fromBottom = anchoring === "bottom";
  const widthBars = Math.max(1, Math.round(thickness * ratio));
  const step = widthPx / values.length;
  const centerLine = fromBottom ? heightPx : heightPx / 2;
  const maxHeight = (centerLine - Math.round(ratio)) * ceiling;
  const minHeight = Math.max(widthBars, Math.round(2 * ratio));
  const r = widthBars / 2;

  const fromX = startRatio > 0 ? startRatio * widthPx : 0;
  const playedX = playedColor && playedRatio > 0 ? playedRatio * widthPx : -1;

  /** Traces the bars in one range of x into a single path and fills it.
   *  Two passes rather than a fill per bar: one path with a hundred
   *  rectangles costs about the same as one rectangle. */
  const paint = (from: number, to: number, fillStyle: string) => {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    let drawn = false;
    for (let i = 0; i < values.length; i++) {
      const x = Math.round(i * step + (step - widthBars) / 2);
      if (x < fromX || x < from || x >= to) continue;
      const shaped = gamma === 1 && floor === 0 && peak === 1
        ? values[i]
        : emphasise(values[i], gamma, floor, peak);
      const height = Math.max(
        minHeight,
        Math.round(Math.min(1, shaped * gain) * maxHeight)
      );
      if (fromBottom) {
        // No rounding at the bottom: the bar rests on the edge there and a
        // curve would make it look as if it were not touching.
        ctx.roundRect(x, centerLine - height, widthBars, height, [r, r, 0, 0]);
      } else {
        ctx.roundRect(x, centerLine - height, widthBars, height * 2, r);
      }
      drawn = true;
    }
    if (drawn) ctx.fill();
  };

  const base = color ?? getComputedStyle(c).color;
  if (playedX < 0) {
    paint(0, widthPx, base);
  } else {
    // Everything the handle has passed takes the accent colour. That is the
    // whole indication of position — the slider has no track of its own.
    paint(0, playedX, playedColor!);
    paint(playedX, widthPx, base);
  }
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
  gamma = 1,
  floor = 0,
  peak = 1,
  thickness = 2,
  playedRatio = 0,
  playedColor,
}: {
  /** loudness 0–1, from left to right */
  values: number[];
  className?: string;
  style?: CSSProperties;
  /** Draw downwards too, symmetrically around the horizontal centre line. */
  mirrored?: boolean;
  /** Loudness multiplier. Above one, quieter passages rise and loud ones
      hit the ceiling, so the outline stands out more. */
  gain?: number;
  /** How many nested outlines the ribbon has. A wide surface needs fewer
      layers — densely packed, nearly parallel lines ripple into a moire
      pattern. */
  layers?: number;
  /** A continuous ribbon, or separate bars like an equalizer. */
  waveformStyle?: "ribbon" | "bars";
  /** Bars only: where they grow from. */
  anchoring?: "center" | "bottom";
  /** Bars only: what share of the height they may take. */
  ceiling?: number;
  /** Bars only: shaping of the values before drawing — see `emphasise`.
   *  Without it the mini player drew the raw numbers, which is why its bars
   *  sat low and barely moved while the big one had come alive. */
  gamma?: number;
  floor?: number;
  peak?: number;
  /** Bars only: bar width in logical pixels. */
  thickness?: number;
  /** Bars only: bars up to this fraction of the width are painted as played.
   *  The rest stays in the strip's own colour, so the picture says what is
   *  behind the position and what is still ahead of it. */
  playedRatio?: number;
  /** Defaults to the accent colour from CSS, cached — reading a custom
   *  property forces a style recalculation, and this draws every frame. */
  playedColor?: string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const accent = useRef({ value: "", readAt: 0 });
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
      let played = playedColor;
      if (playedRatio > 0 && !played) {
        const now = performance.now();
        if (!accent.current.value || now - accent.current.readAt > 500) {
          accent.current = {
            value: getComputedStyle(c).getPropertyValue("--accent").trim(),
            readAt: now,
          };
        }
        played = accent.current.value || undefined;
      }
      drawBars(c, values, {
        ratio: size.ratio,
        gain,
        ceiling,
        anchoring,
        gamma,
        floor,
        peak,
        thickness,
        playedRatio,
        playedColor: played,
      });
    } else {
      drawWaveform(c, values, {
        layers,
        mirrored,
        gain,
        ratio: size.ratio,
      });
    }
    // `className` is a dependency because the colour comes from CSS: when the
    // recorder stops, the strip loses `.bezi` and the accent with it, but the
    // canvas keeps whatever it last painted until something repaints it.
  }, [values, size, layers, mirrored, gain, waveformStyle, anchoring, ceiling, gamma,
      floor, peak, thickness, playedRatio, playedColor, className]);

  return (
    <span ref={container} className={className} style={style} aria-hidden>
      <canvas ref={canvas} />
    </span>
  );
}

/** Miniature player in the header bar — the application header in the
 *  archive and settings, the detail's own header when a different recording
 *  than the open one is playing. It lives here beside the player state it
 *  renders, the same relationship `MiniRecorder` has to the recorder.
 *
 *  Progress is a ring around the button:
 *  a separate strip under the title pushed the text upward and there was no
 *  room for it in a thirty-pixel bar. */
export function MiniPlayer({
  onOpen,
  compact = false,
}: {
  onOpen: () => void;
  /** Squeezed into play, a three-bar equalizer and the cross. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const {
    title,
    duration,
    isPlaying,
    isPreparing,
    sourceMissing,
    togglePlayback,
    close,
  } = usePlayer();
  const time = usePlayerTime();

  const R = 12.5;
  const circumference = 2 * Math.PI * R;
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div className={`mini-player ${compact ? "dense" : ""}`}>
      <AudioBars compact={compact} />
      <button
        className="mini-play"
        onClick={togglePlayback}
        disabled={isPreparing}
        aria-label={
          isPreparing
            ? t("app.player.preparing")
            : isPlaying
              ? t("app.player.pause")
              : t("app.player.play")
        }
      >
        <svg className="mini-ring" width="30" height="30" viewBox="0 0 30 30" aria-hidden>
          <circle className="mini-track" cx="15" cy="15" r={R} />
          <circle
            className="mini-progress"
            cx="15"
            cy="15"
            r={R}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        </svg>
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="2.5" y="2" width="2.8" height="8" rx="0.9" fill="currentColor" />
            <rect x="6.7" y="2" width="2.8" height="8" rx="0.9" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3.2 2v8l6.6-4z" fill="currentColor" />
          </svg>
        )}
      </button>

      <button className="mini-label" onClick={onOpen} title={t("app.player.openTranscript")}>
        {title}
      </button>

      <span className={`mini-time ${sourceMissing ? "destructive-item" : ""}`}>
        {sourceMissing
          ? t("app.player.sourceMissing")
          : isPreparing
            ? t("app.player.preparingShort")
            : formatTime(time)}
      </span>

      <button className="mini-close" onClick={close} aria-label={t("app.player.stop")}>
        {/* Stejná kresebná velikost jako u přehrát — menší glyf by
            opticky odskočil od okraje, i když má stejnou plochu. */}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** More bands than the recording actually has: the pill is narrow, and thin
 *  bars close together read as a spectrum, where a few wide ones read as a
 *  bar chart. `equalizerAtTime` interpolates between the real bands, so the
 *  extra ones cost nothing and invent nothing. */
const MINI_BANDS = 44;

/** The same shaping as the big player. The values are absolute and speech
 *  only ever occupies the lower part of the range, so without cutting both
 *  ends the bars sit low and hardly move. See `emphasise`. */
const MINI_GAMMA = 0.7;
const MINI_FLOOR = 0.04;
const MINI_PEAK = 0.55;

function AudioBars({ compact = false }: { compact?: boolean }) {
  const { waveform, isPlaying, sourceMissing } = usePlayer();
  const time = usePlayerTime();

  /* Three bands in the compact pill. The 44 the full pill uses would be a
     smear in an 18 px window; three are readable and still move with the
     sound, which is the whole job there. */
  const bands = compact ? 3 : MINI_BANDS;
  const values = useMemo(
    () => equalizerAtTime(waveform, time, bands),
    [waveform, time, bands]
  );

  if (values.length === 0 || sourceMissing) return null;

  // Real frequency bands stay in place and only change height.
  return (
    <Waveform
      values={values}
      className={`mini-waves ${isPlaying ? "playing" : ""}`}
      waveformStyle="bars"
      anchoring="bottom"
      ceiling={0.78}
      gamma={MINI_GAMMA}
      floor={MINI_FLOOR}
      peak={MINI_PEAK}
      thickness={compact ? 2.5 : 1.5}
    />
  );
}
