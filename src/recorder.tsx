import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useI18n } from "./i18n";
import { Waveform, usePlayer } from "./player";
import type { Waveform as StoredWaveform } from "./player";

/** How the take's own envelope is recorded: ten frames a second, each of
 *  TAKE_BANDS values. The same shape and rate the backend writes for a stored
 *  recording, so the picture in the dialog and the one under a transcript are
 *  drawn by the same code from the same kind of data. */
const TAKE_POINTS_PER_SECOND = 10;
const TAKE_BANDS = 48;

/**
 * The microphone recorder, owned at application level.
 *
 * The recorder used to live inside the add-recording dialog, which meant
 * closing the dialog killed the take. Held here, the dialog and the header's
 * mini recorder are two views over one recording: the dialog can be closed
 * mid-take and the pill carries the state — exactly the relationship the mini
 * player has to the transport bar.
 */

export type RecorderPhase =
  | "idle"
  | "preparing"
  | "denied"
  | "ready"
  | "recording"
  | "preview"
  | "saving";

interface RecorderValue {
  phase: RecorderPhase;
  /** The take is paused because sound is playing; it resumes by itself. */
  suspended: boolean;
  /** Whole seconds since the take started; the length once it has stopped. */
  seconds: number;
  /** The live analyser, for visualisations. Null until the microphone is open. */
  analyserNode: () => AnalyserNode | null;
  /** What the take sounded like, frame by frame, in the same shape a stored
   *  recording's envelope has. It is what lets the finished take show its
   *  peaks while nothing is playing — the transport bar under a transcript
   *  reads the stored envelope exactly this way. */
  takeWaveform: () => StoredWaveform;
  /** Ask for the microphone. No-op unless idle or previously denied. */
  openMicrophone: () => void;
  /** Let the microphone go. Only meaningful before a take exists. */
  releaseMicrophone: () => void;
  start: () => void;
  stop: () => void;
  /** Throw the finished take away and go back to ready. */
  discard: () => void;
  /** The finished take, once phase is `preview` or `saving`. */
  take: () => Blob | null;
  setSaving: (saving: boolean) => void;
  /** Everything away — after a successful save. */
  reset: () => void;
}

const RecorderContext = createContext<RecorderValue | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [seconds, setSeconds] = useState(0);

  /* Read through a ref so `start` stays a stable callback: taking the player
     from the closure would rebuild the context value on every playback tick
     and re-render every consumer of the recorder. */
  const player = usePlayer();
  const playerRef = useRef(player);
  playerRef.current = player;

  /* Sound wins, the take waits (Jakub's rule, superseding the hard lock that
     briefly lived here): starting playback anywhere pauses a running take,
     and the take resumes on its own when the sound stops. Nothing from the
     speakers can end up inside the recording, and no play button ever has to
     be dead. Opening the recorder still pauses whatever is playing once. */
  const [suspended, setSuspended] = useState(false);
  const suspendedRef = useRef(false);
  suspendedRef.current = suspended;

  useEffect(() => {
    if (phase === "preparing" && playerRef.current.isPlaying) {
      playerRef.current.togglePlayback();
    }
  }, [phase]);

  /* The take's clock survives pauses: `elapsedBase` holds the milliseconds
     of finished segments, `begun` stamps the running one. */
  const elapsedBase = useRef(0);
  const begun = useRef(0);

  const stream = useRef<MediaStream | null>(null);
  const capture = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const takeRef = useRef<Blob | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  /* Frames of TAKE_BANDS values, 0–255, appended while the take runs. */
  const equalizer = useRef<number[]>([]);
  const tick = useRef<number | undefined>(undefined);
  const phaseRef = useRef<RecorderPhase>("idle");
  phaseRef.current = phase;

  const releaseMicrophone = useCallback(() => {
    window.clearInterval(tick.current);
    if (capture.current && capture.current.state !== "inactive") {
      capture.current.stop();
    }
    capture.current = null;
    chunks.current = [];
    takeRef.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioContext.current?.close();
    audioContext.current = null;
    analyser.current = null;
    equalizer.current = [];
    setSeconds(0);
    setSuspended(false);
    setPhase("idle");
  }, []);

  const openMicrophone = useCallback(() => {
    if (phaseRef.current !== "idle" && phaseRef.current !== "denied") return;
    setPhase("preparing");
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((media) => {
        // The view that asked may be gone by the time the prompt is answered.
        if (phaseRef.current !== "preparing") {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        const context = new AudioContext();
        /* getUserMedia resolves outside any user gesture, and a context born
           there starts suspended — the analyser would read eternal silence
           while MediaRecorder records happily. */
        void context.resume();
        const analyse = context.createAnalyser();
        analyse.fftSize = 1024;
        analyse.smoothingTimeConstant = 0.75;
        /* The sensitivity of the whole strip lives here, not in the drawing.
           `getByteFrequencyData` maps decibels linearly across this window, so
           with the defaults (-100 to -30) every band louder than about -30 dB
           already returns 255 — and ordinary speech is louder than that in its
           strong bands. The bars were therefore pinned to the ceiling the
           moment anybody spoke, which is what Jakub reported.
           -85 to -20 gives speech the room to move: measured through this same
           analyser, a band at -55 dB now reads 0.24 and one at -10 dB 0.93,
           where before both read 1.00. */
        analyse.minDecibels = -85;
        analyse.maxDecibels = -20;
        context.createMediaStreamSource(media).connect(analyse);
        audioContext.current = context;
        analyser.current = analyse;
        setPhase("ready");
      })
      .catch(() => {
        if (phaseRef.current === "preparing") setPhase("denied");
      });
  }, []);

  const start = useCallback(() => {
    const media = stream.current;
    if (!media || phaseRef.current !== "ready") return;
    equalizer.current = [];
    // Opus in WebM is what Chromium records natively; the backend converts,
    // so the container only has to be something ffmpeg reads.
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
      (candidate) => MediaRecorder.isTypeSupported(candidate)
    );
    const recorder = new MediaRecorder(media, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 96000,
    });
    chunks.current = [];
    takeRef.current = null;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    recorder.onstop = () => {
      takeRef.current = new Blob(chunks.current, { type: recorder.mimeType });
      setPhase("preview");
    };
    capture.current = recorder;
    /* Recording is asked for explicitly, so it outranks the sound: pause
       whatever is playing rather than refusing to start. */
    if (playerRef.current.isPlaying) playerRef.current.togglePlayback();
    setSeconds(0);
    setSuspended(false);
    elapsedBase.current = 0;
    begun.current = Date.now();
    setPhase("recording");
    recorder.start();
    tick.current = window.setInterval(
      () =>
        setSeconds(
          Math.floor((elapsedBase.current + Date.now() - begun.current) / 1000)
        ),
      250
    );
  }, []);

  /* The coordination itself: the player's state is the single source of
     truth, so a take pauses whichever way sound was started — mini player,
     transport, a word click — and resumes whichever way it stopped,
     including the track simply ending. */
  useEffect(() => {
    const recorder = capture.current;
    if (phase !== "recording" || !recorder) return;
    if (player.isPlaying && recorder.state === "recording") {
      recorder.pause();
      window.clearInterval(tick.current);
      elapsedBase.current += Date.now() - begun.current;
      setSeconds(Math.floor(elapsedBase.current / 1000));
      setSuspended(true);
    } else if (!player.isPlaying && recorder.state === "paused") {
      recorder.resume();
      begun.current = Date.now();
      tick.current = window.setInterval(
        () =>
          setSeconds(
            Math.floor((elapsedBase.current + Date.now() - begun.current) / 1000)
          ),
        250
      );
      setSuspended(false);
    }
  }, [phase, player.isPlaying]);

  /* The take writes down what it sounded like, frame by frame. Without it the
     finished take could only show a live analyser — which says nothing at all
     while the playback is paused, and a strip of flat stubs looks broken
     rather than stopped. Nothing is recorded while the take is suspended,
     because its clock does not advance then either; the frames and the clock
     have to agree, or the position would point into the wrong part of the
     picture. */
  useEffect(() => {
    if (phase !== "recording" || suspended) return;
    const analyse = analyser.current;
    if (!analyse) return;
    const bins = new Uint8Array(analyse.frequencyBinCount);
    const edges = spectrumEdges(analyse, TAKE_BANDS);
    const timer = window.setInterval(() => {
      for (const value of sampleSpectrum(analyse, bins, edges)) {
        equalizer.current.push(Math.round(Math.min(1, value) * 255));
      }
    }, 1000 / TAKE_POINTS_PER_SECOND);
    return () => window.clearInterval(timer);
  }, [phase, suspended]);

  const stop = useCallback(() => {
    window.clearInterval(tick.current);
    // Stopping a paused MediaRecorder is legal and finalises the take.
    if (capture.current && capture.current.state !== "inactive") {
      capture.current.stop();
    }
    setSuspended(false);
  }, []);

  const discard = useCallback(() => {
    takeRef.current = null;
    chunks.current = [];
    setSeconds(0);
    setPhase("ready");
  }, []);

  const setSaving = useCallback((saving: boolean) => {
    setPhase(saving ? "saving" : "preview");
  }, []);

  const value = useMemo<RecorderValue>(
    () => ({
      phase,
      suspended,
      seconds,
      analyserNode: () => analyser.current,
      takeWaveform: () => ({
        points: [],
        pointsPerSecond: 0,
        equalizer: equalizer.current,
        equalizerPointsPerSecond: TAKE_POINTS_PER_SECOND,
        equalizerBandCount: TAKE_BANDS,
      }),
      openMicrophone,
      releaseMicrophone,
      start,
      stop,
      discard,
      take: () => takeRef.current,
      setSaving,
      reset: releaseMicrophone,
    }),
    [
      phase,
      suspended,
      seconds,
      openMicrophone,
      releaseMicrophone,
      start,
      stop,
      discard,
      setSaving,
    ]
  );

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

export function useRecorder(): RecorderValue {
  const value = useContext(RecorderContext);
  if (!value) throw new Error("useRecorder needs RecorderProvider");
  return value;
}

/** m:ss, the format every clock in this interface uses. */
export function recorderTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The live spectrum, sampled while the microphone listens or records.
 *
 * Bands are log-spaced over roughly 90 Hz – 15 kHz, because pitch is heard in
 * octaves: linear spacing would spend most bars on hiss above 8 kHz and cram
 * every voiced sound into the first three. Each band averages its slice of
 * FFT bins; `getByteFrequencyData` is already dB-mapped, so the numbers land
 * in the range the shared `Waveform` shaping expects.
 */
export function spectrumEdges(analyse: AnalyserNode, bands: number): number[] {
  const firstBin = 1;
  const lastBin = Math.min(analyse.frequencyBinCount - 1, 320);
  return Array.from({ length: bands + 1 }, (_, index) =>
    Math.round(firstBin * Math.pow(lastBin / firstBin, index / bands))
  );
}

/** The buffer `getByteFrequencyData` will accept, taken from its own signature.
 *
 *  Not written out as a type: TypeScript 5.7 made the typed arrays generic over
 *  their buffer, so this is `Uint8Array<ArrayBuffer>` there and a plain
 *  `Uint8Array` on 5.6 — and each spelling is an error under the other version.
 *  Reading the parameter off the DOM signature is correct under both, and stays
 *  correct if the lib changes it again. */
type FrequencyBins = Parameters<AnalyserNode["getByteFrequencyData"]>[0];

export function sampleSpectrum(
  analyse: AnalyserNode,
  bins: FrequencyBins,
  edges: number[]
): number[] {
  analyse.getByteFrequencyData(bins);
  return Array.from({ length: edges.length - 1 }, (_, band) => {
    const from = edges[band];
    const to = Math.max(from + 1, edges[band + 1]);
    let sum = 0;
    for (let bin = from; bin < to; bin++) sum += bins[bin];
    return sum / (to - from) / 255;
  });
}

export function useSpectrum(bands: number): number[] {
  const { phase, suspended, analyserNode } = useRecorder();
  const [values, setValues] = useState<number[]>(() =>
    new Array<number>(bands).fill(0)
  );
  const frame = useRef(0);

  useEffect(() => {
    /* A suspended take keeps its microphone open, so the analyser would go
       on dancing to the room — and dancing bars say "recording", which
       would be a lie right then. Flat says paused. */
    if ((phase !== "ready" && phase !== "recording") || suspended) {
      setValues(new Array<number>(bands).fill(0));
      return;
    }
    const analyse = analyserNode();
    if (!analyse) return;
    const bins = new Uint8Array(analyse.frequencyBinCount);
    const edges = spectrumEdges(analyse, bands);
    const step = () => {
      setValues(sampleSpectrum(analyse, bins, edges));
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [phase, suspended, bands, analyserNode]);

  return values;
}

/**
 * The running take as a header pill — the mini player's sibling.
 *
 * Same surface, same order of parts: a mark, a name, the time, one control at
 * the trailing edge. The mark is a pulsing record dot rather than play, the
 * bars behind the text are the live spectrum rather than the stored envelope,
 * and the trailing control stops the take — which also reopens the recorder,
 * so a stopped take is never stranded out of sight.
 */
export function MiniRecorder({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { phase, suspended, seconds, stop } = useRecorder();
  const values = useSpectrum(30);

  if (phase !== "recording") return null;

  return (
    <div className={`mini-player mini-recorder ${suspended ? "paused" : ""}`}>
      <Waveform
        values={values}
        className="mini-waves playing"
        waveformStyle="bars"
        anchoring="bottom"
        ceiling={0.78}
        gamma={0.85}
        floor={0.15}
        peak={0.95}
        thickness={1.5}
      />
      <span className="mini-recorder-dot" aria-hidden />
      <button className="mini-label" onClick={onOpen} title={t("app.recorder.open")}>
        {t("app.recorder.label")}
      </button>
      <span className="mini-time">{recorderTime(seconds)}</span>
      <button
        className="mini-close"
        onClick={() => {
          stop();
          onOpen();
        }}
        aria-label={t("app.recorder.stop")}
        title={t("app.recorder.stop")}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.6" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
