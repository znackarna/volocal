//! Playback controls: transport button, timeline, time, speed, and waveform.
//!
//! This is separate from `player.tsx`, which owns the shared audio element.
//! Keeping distinct names also avoids case-insensitive filename collisions on Windows.

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import {
  drawBars,
  equalizerAtTime,
  handleRatio,
  prepareCanvas,
  usePlayer,
} from "./player";
import type { Waveform } from "./player";
import { useI18n } from "./i18n";
import { formatTime } from "./types";

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

/** Approximate distance between visual bars on a wide timeline. */
const BAR_SPACING = 7;

/** How much of the half-height the bars may fill. */
const AMPLITUDE_CEILING = 0.82;

/** Shaping of the band values before they are drawn — see `emphasise`.
 *
 * The raw numbers say how much of a spectrum column ffmpeg lit up, and speech
 * only ever occupies its lower half. Drawn as they are, the bars sat around a
 * third of the height and moved by a few pixels — technically alive, visibly
 * dead. Dropping the constant floor and lifting the rest spreads that narrow
 * band across the whole strip. */
const AMPLITUDE_GAMMA = 0.7;
const AMPLITUDE_FLOOR = 0.04;
const AMPLITUDE_PEAK = 0.55;

/**
 * Real equalizer peaks behind the timeline.
 *
 * Frequency bands have fixed horizontal positions. Only their height changes;
 * nothing scrolls, stretches, or behaves like a moving mask.
 */
function AudioBackdrop({
  waveform,
  readTime,
  time,
  duration,
  isPlaying,
  geometry,
}: {
  waveform: Waveform;
  readTime: () => number;
  /** The position React knows about. It only moves while paused when somebody
   *  seeks, which is exactly when a still picture has to be drawn again. */
  time: number;
  duration: number;
  isPlaying: boolean;
  /** Timeline dimensions determine the stable number and placement of bars. */
  geometry: PlayerGeometry;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const liveState = useRef({ waveform, geometry, readTime, duration });
  liveState.current = { waveform, geometry, readTime, duration };

  /* While playing, the position comes from the audio clock inside the loop, so
     the eight ticks a second React receives must not restart it. Standing
     still they are the only thing that can move the picture. */
  const stillTime = isPlaying ? 0 : time;

  useEffect(() => {
    const target = canvas;
    if (!target) return;
    let running = true;
    let color = "";
    let playedColor = "";
    let colorReadAt = 0;
    let frame = 0;
    /* What the last frame drew. Even while playing, two consecutive frames can
       land on the same picture — the audio clock does not advance every frame
       — so the canvas work only happens when the result would differ. */
    let drawn = "";

    const drawFrame = (now: number) => {
      const current = liveState.current;
      const pixelRatio = window.devicePixelRatio || 1;
      if (
        prepareCanvas(
          target,
          current.geometry.timelineWidth,
          current.geometry.height,
          pixelRatio
        )
      ) {
        if (!color || now - colorReadAt > 500) {
          const styles = getComputedStyle(target);
          color = styles.color;
          // The accent lives in a custom property, so it survives a change of
          // theme without anything here knowing about it.
          playedColor = styles.getPropertyValue("--accent").trim() || color;
          colorReadAt = now;
        }
        const barCount = Math.max(
          current.waveform.equalizerBandCount,
          Math.round(current.geometry.timelineWidth / BAR_SPACING)
        );
        const width = current.geometry.timelineWidth;
        const played = current.duration > 0
          ? Math.min(1, Math.max(0, current.readTime() / current.duration))
          : 0;

        /* Every input `drawBars` is about to receive. `readTime()` belongs in
           it whole, not quantised to the played pixel: `equalizerAtTime`
           interpolates the envelope at that moment, so the bars themselves
           move within a single pixel of travel. Rounding it would have frozen
           the picture during playback — the bug this line nearly became. */
        const signature = [
          barCount,
          width,
          current.geometry.height,
          pixelRatio,
          color,
          playedColor,
          current.readTime(),
        ].join("|");
        if (signature === drawn) return;
        drawn = signature;

        drawBars(
          target,
          equalizerAtTime(current.waveform, current.readTime(), barCount),
          {
            ratio: pixelRatio,
            color,
            gain: 1,
            ceiling: AMPLITUDE_CEILING,
            gamma: AMPLITUDE_GAMMA,
            floor: AMPLITUDE_FLOOR,
            peak: AMPLITUDE_PEAK,
            playedRatio: handleRatio(played, width),
            playedColor,
          }
        );
      }
    };

    const tick = (now: number) => {
      if (!running) return;
      drawFrame(now);
      frame = requestAnimationFrame(tick);
    };

    /* The loop belongs to playback, exactly as the sister loop driving the
       handle and the ring does. Silence leaves an unchanging picture, and this
       used to schedule a callback, measure the canvas and assemble a signature
       sixty times a second for as long as a transcript was open. Standing
       still, one frame is drawn and that is the whole of it — the position can
       only move by a seek, and a seek changes `time`, which brings the effect
       back. */
    frame = requestAnimationFrame(isPlaying ? tick : drawFrame);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
    // `stillTime` is what redraws a still picture after a seek; `waveform`,
    // `duration` and `geometry` are the other three things that change it.
  }, [canvas, isPlaying, stillTime, duration, waveform, geometry]);

  if (waveform.equalizer.length === 0) return null;

  return (
    <span
      className={`waves ${isPlaying ? "playing" : ""}`}
      style={{ left: `${geometry.timelineLeft}px`, width: `${geometry.timelineWidth}px` }}
      aria-hidden
    >
      <canvas ref={setCanvas} />
    </span>
  );
}

/** Circumference of the progress ring: radius 20 in a 44 x 44 viewBox. */
const RING_CIRCUMFERENCE = 2 * Math.PI * 20;

/** Transport button with a progress ring around it. */
function PlayButton({
  isPlaying,
  ratio,
  ring,
  onClick,
}: {
  isPlaying: boolean;
  ratio: number;
  /** During playback the ring is advanced by the frame loop, not by React. */
  ring: MutableRefObject<SVGCircleElement | null>;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      className="play"
      onClick={onClick}
      aria-label={isPlaying ? t("player.transport.pause") : t("player.transport.play")}
    >
      <svg className="play-ring" viewBox="0 0 44 44" aria-hidden>
        <circle className="play-track" cx="22" cy="22" r="20" />
        <circle
          ref={ring}
          className="play-progress"
          cx="22"
          cy="22"
          r="20"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
        />
      </svg>
      <span className="play-mark">
        {/* Drawn glyphs rather than font characters: the triangle U+25B6 has
            asymmetric side bearings and sits off-centre inside the ring. */}
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <rect x="3" y="2" width="3.2" height="10" rx="1" fill="currentColor" />
            <rect x="7.8" y="2" width="3.2" height="10" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M4.4 2.4v9.2L11.6 7z" fill="currentColor" />
          </svg>
        )}
      </span>
    </button>
  );
}

/** Writes a position into the slider. Both React and the frame loop go
 *  through here so the two can never disagree on how it is done. */
function applyPosition(input: HTMLInputElement, time: number, duration: number) {
  input.value = String(Math.min(time, duration || 0));
}

/**
 * Timeline with a bubble showing the time under the cursor.
 *
 * The slider is uncontrolled on purpose. Were React to own it, it could
 * overwrite the handle with a value a fraction of a second behind the audio,
 * because playback state is only refreshed a few times per second for
 * performance. The handle would then stutter against the sound it is meant
 * to point at. This way there is a single source: the time read straight
 * off the audio element.
 */
function Timeline({
  time,
  duration,
  isPlaying,
  input,
  onSeek,
  container,
}: {
  time: number;
  duration: number;
  isPlaying: boolean;
  input: MutableRefObject<HTMLInputElement | null>;
  onSeek: (t: number) => void;
  /** Handle placement is derived from the container's measurements. */
  container: MutableRefObject<HTMLDivElement | null>;
}) {
  // On an hour-long recording, seeking without a readout is guesswork.
  const [preview, setPreview] = useState<{ x: number; time: number } | null>(null);

  // While paused, the position follows the cursor in the transcript: after
  // clicking a word, after dragging, after opening the screen. During
  // playback we keep out of it and let the frame loop drive.
  useEffect(() => {
    if (isPlaying || !input.current) return;
    applyPosition(input.current, time, duration);
  }, [time, duration, isPlaying, input]);

  return (
    <div
      className="axis-wrap"
      ref={container}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const position = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        setPreview({ x: position * r.width, time: position * duration });
      }}
      onMouseLeave={() => setPreview(null)}
    >
      <input
        ref={input}
        className="slider"
        type="range"
        min={0}
        max={Math.max(duration, 0.1)}
        // Fine step: a coarser one would move the handle in visible stairs
        // during playback.
        step={0.01}
        defaultValue={0}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      {preview && duration > 0 && (
        <span className="slider-preview" style={{ left: `${preview.x}px` }}>
          {formatTime(preview.time)}
        </span>
      )}
    </div>
  );
}

/**
 * Dimensions of the strip and of the track inside it.
 *
 * The backdrop spans the whole strip, but the handle only travels the track
 * between the button and the time readout — and inside that, inset by its own
 * radius. Without accounting for it, the moment under the handle would differ
 * from the one being heard.
 */
interface PlayerGeometry {
  trackWidth: number;
  height: number;
  timelineLeft: number;
  timelineWidth: number;
}

function usePlayerGeometry(): {
  track: MutableRefObject<HTMLDivElement | null>;
  centerLine: MutableRefObject<HTMLDivElement | null>;
  geometry: PlayerGeometry;
} {
  const track = useRef<HTMLDivElement | null>(null);
  const centerLine = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<PlayerGeometry>({
    trackWidth: 0,
    height: 0,
    timelineLeft: 0,
    timelineWidth: 0,
  });

  useEffect(() => {
    const p = track.current;
    const o = centerLine.current;
    if (!p || !o) return;
    const benchmark = () => {
      const rp = p.getBoundingClientRect();
      const ro = o.getBoundingClientRect();
      setGeometry({
        trackWidth: rp.width,
        height: rp.height,
        timelineLeft: ro.left - rp.left,
        timelineWidth: ro.width,
      });
    };
    benchmark();
    const observer = new ResizeObserver(benchmark);
    observer.observe(p);
    observer.observe(o);
    return () => observer.disconnect();
  }, []);

  return { track, centerLine, geometry };
}

export default function PlaybackControls({
  isCurrentRecording,
  waveform,
  time,
  duration,
  isPlaying,
  onPlayPauza,
  onSeek,
  trailingControl,
}: {
  /** Does the audio belong to this recording? Decides where time comes from. */
  isCurrentRecording: boolean;
  /** Waveform of this recording. The screen loads it itself so it is visible
   *  immediately on open, not only once playback has started. */
  waveform: Waveform;
  time: number;
  duration: number;
  isPlaying: boolean;
  onPlayPauza: () => void;
  onSeek: (t: number) => void;
  /** A screen-level action placed after playback speed controls. */
  trailingControl?: ReactNode;
}) {
  const { t, formatNumber } = useI18n();
  const player = usePlayer();
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
  const { track, centerLine, geometry } = usePlayerGeometry();
  const input = useRef<HTMLInputElement | null>(null);
  const ring = useRef<SVGCircleElement | null>(null);
  const readTime = isCurrentRecording ? player.readTime : () => time;

  // The handle and the progress ring run in the same frame loop as the
  // backdrop and read the same clock. While React state drove them they
  // trailed behind: it is refreshed only a few times per second for
  // performance, whereas the backdrop repaints every frame. The handle then
  // moved in visible stairs and did not sit on the moment being played.
  const live = useRef({ readTime, duration });
  live.current = { readTime, duration };

  useEffect(() => {
    if (!isPlaying) return;
    let running = true;
    const step = () => {
      if (!running) return;
      const { readTime: read, duration: total } = live.current;
      const now = read();
      if (input.current) applyPosition(input.current, now, total);
      if (ring.current) {
        const done = total > 0 ? Math.min(1, Math.max(0, now / total)) : 0;
        ring.current.setAttribute(
          "stroke-dashoffset",
          String(RING_CIRCUMFERENCE * (1 - done))
        );
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
      running = false;
    };
  }, [isPlaying]);

  return (
    <div className="player" ref={track}>
      {/* The backdrop underlies the whole strip; it is not a row item. */}
      <AudioBackdrop
        waveform={waveform}
        readTime={readTime}
        time={time}
        duration={duration}
        isPlaying={isPlaying}
        geometry={geometry}
      />

      <PlayButton isPlaying={isPlaying} ratio={ratio} ring={ring} onClick={onPlayPauza} />
      <Timeline
        time={time}
        duration={duration}
        isPlaying={isPlaying}
        input={input}
        onSeek={onSeek}
        container={centerLine}
      />

      <span className="time">
        {t("player.timeline.position", {
          current: formatTime(time),
          total: formatTime(duration),
        })}
      </span>

      <div className="speeds">
        {PLAYBACK_RATES.map((r) => (
          <button
            key={r}
            className={`button button-small ${player.rate === r ? "current" : ""}`}
            onClick={() => player.setRate(r)}
          >
            {t("player.speed.rate", { value: formatNumber(r) })}
          </button>
        ))}
      </div>

      {trailingControl && (
        <div className="player-end">
          {trailingControl}
        </div>
      )}

    </div>
  );
}
