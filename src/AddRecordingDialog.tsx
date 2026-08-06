import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api } from "./api";
import { equalizerAtTime, handleRatio, Waveform } from "./player";
import { LineIcon } from "./icons";
import { recorderTime, useRecorder, useSpectrum } from "./recorder";
import { useI18n } from "./i18n";
import { useProgressMessage, useUserMessage } from "./messages";
import type { DownloadProgress, Recording, UserMessage } from "./types";

type OnlineImportPhase =
  | "preparing"
  | "downloading"
  | "converting"
  | "complete"
  | "cancelled";

/** What the backend sends. */
interface OnlineImportReport {
  phase: OnlineImportPhase;
  percent: number;
  message: UserMessage;
}

/** What this dialog keeps: the caption is put into words as it arrives, so the
 *  steps this dialog reports itself and the ones Rust reports look the same. */
interface OnlineImportProgress {
  phase: OnlineImportPhase;
  percent: number;
  message: string;
}

export default function AddRecordingDialog({
  onClose,
  onLocalFile,
  onImported,
  onRecorded,
  initialView = "source",
}: {
  onClose: () => void;
  onLocalFile: () => void;
  onImported: (recording: Recording) => void;
  /** A finished microphone take, and whether to transcribe it right away. */
  onRecorded: (recording: Recording, transcribe: boolean) => void;
  /** Opened from the mini recorder, the dialog starts on the recorder view. */
  initialView?: "source" | "microphone";
}) {
  const { t, formatNumber } = useI18n();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();
  const [view, setView] = useState<"source" | "online" | "microphone">(initialView);
  const recorder = useRecorder();
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OnlineImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const cancelImport = useCallback(async (after: () => void) => {
    cancelled.current = true;
    try {
      await api.cancelOnlineImport();
    } finally {
      setRunning(false);
      setProgress(null);
      setError(null);
      after();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (view === "microphone") {
        // The recorder owns Escape: stopping a take must not close the dialog.
        return;
      }
      if (running) {
        void cancelImport(() => setView("source"));
      } else if (view === "online") {
        setView("source");
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelImport, onClose, running, view]);

  useEffect(() => {
    let alive = true;
    const unlisten: Array<() => void> = [];
    listen<OnlineImportReport>("online-import:progress", (event) => {
      if (!alive) return;
      setProgress({
        phase: event.payload.phase,
        percent: event.payload.percent,
        message: progressMessage(event.payload.message),
      });
    }).then((stop) => (alive ? unlisten.push(stop) : stop()));
    // The downloader is installed lazily on first use. Fold its own progress
    // into the first tenth of this operation so the bar never appears stuck.
    listen<DownloadProgress>("download:progress", (event) => {
      if (!alive || !["yt-dlp", "deno"].includes(event.payload.id)) return;
      const base = event.payload.id === "deno" ? 4 : 0;
      const span = event.payload.id === "deno" ? 5 : 4;
      setProgress({
        phase: "preparing",
        percent: Math.max(1, base + Math.round(event.payload.percent * span / 100)),
        message:
          event.payload.phase === "extracting"
            ? t("dialogs.addRecording.finishingSupport")
            : t("dialogs.addRecording.preparingSupport", {
                percent: formatNumber(event.payload.percent),
              }),
      });
    }).then((stop) => (alive ? unlisten.push(stop) : stop()));
    return () => {
      alive = false;
      unlisten.forEach((stop) => stop());
    };
  }, [t, formatNumber, progressMessage]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError(t("dialogs.addRecording.invalidUrl"));
      return;
    }

    setError(null);
    cancelled.current = false;
    setRunning(true);
    setProgress({
      phase: "preparing",
      percent: 1,
      message: t("dialogs.addRecording.preparingVideo"),
    });
    try {
      const recording = await api.importOnlineRecording(value);
      if (cancelled.current) return;
      onImported(recording);
    } catch (reason) {
      if (cancelled.current) return;
      setError(userMessage(reason));
      setRunning(false);
    }
  };

  return (
    <div
      className="prekryv-dialogu"
      role="presentation"
      onMouseDown={() => {
        if (running) return;
        // A finished take must be decided, not clicked away; a running one
        // minimises into the header's pill, so closing loses nothing.
        if (view === "microphone" && ["preview", "saving"].includes(recorder.phase)) return;
        onClose();
      }}
    >
      <div
        className="dialog add-recording-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-recording-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {view === "source" ? (
          <>
            <h2 id="add-recording-title">{t("dialogs.addRecording.title")}</h2>
            <p>{t("dialogs.addRecording.prompt")}</p>
            <div className="volby add-recording-options">
              <button className="volba s-ikonou" onClick={onLocalFile} autoFocus>
                <span className="volba-ikona" aria-hidden>
                  <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
                    <path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4" stroke="currentColor"
                          strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M7.5 12.5c1.4-1.9 3.6-1.9 5 0" stroke="currentColor"
                          strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="volba-telo">
                  <span className="volba-nazev">{t("dialogs.addRecording.localFile")}</span>
                  <span className="drobne">{t("dialogs.addRecording.localFileNote")}</span>
                </span>
              </button>
              <button className="volba s-ikonou" onClick={() => setView("online")}>
                <span className="volba-ikona" aria-hidden>
                  <LineIcon name="video" size={19} />
                </span>
                <span className="volba-telo">
                  <span className="volba-nazev">{t("dialogs.addRecording.onlineVideo")}</span>
                  <span className="drobne">{t("dialogs.addRecording.onlineVideoNote")}</span>
                </span>
              </button>
              <button className="volba s-ikonou" onClick={() => setView("microphone")}>
                <span className="volba-ikona" aria-hidden>
                  <MicrophoneIcon />
                </span>
                <span className="volba-telo">
                  <span className="volba-nazev">{t("dialogs.addRecording.microphone")}</span>
                  <span className="drobne">{t("dialogs.addRecording.microphoneNote")}</span>
                </span>
              </button>
            </div>
            <div className="dialog-patka">
              <button className="tlacitko" onClick={onClose}>{t("common.cancel")}</button>
            </div>
          </>
        ) : view === "microphone" ? (
          <MicrophoneView
            onBack={() => setView("source")}
            onClose={onClose}
            onRecorded={onRecorded}
          />
        ) : (
          <form onSubmit={submit}>
            <button
              type="button"
              className="add-recording-back"
              onClick={() => {
                if (running) void cancelImport(() => setView("source"));
                else setView("source");
              }}
            >
              <svg width="13" height="12" viewBox="0 0 14 12" aria-hidden>
                <path d="M6 1L1 6l5 5M1 6h12" fill="none" stroke="currentColor"
                      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("common.back")}
            </button>
            <h2 id="add-recording-title">{t("dialogs.addRecording.onlineTitle")}</h2>
            <p>{t("dialogs.addRecording.onlinePrompt")}</p>

            <div className="pole add-recording-url">
              <label htmlFor="online-recording-url">{t("dialogs.addRecording.urlLabel")}</label>
              <input
                id="online-recording-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("dialogs.addRecording.urlPlaceholder")}
                disabled={running}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {!running && (
              <p className="drobne add-recording-note">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.35" />
                  <path d="M8 7.1v3.7M8 4.8h.01" stroke="currentColor" strokeWidth="1.55"
                        strokeLinecap="round" />
                </svg>
                <span>{t("dialogs.addRecording.downloadNote")}</span>
              </p>
            )}

            {running && progress && (
              <div className="add-recording-progress" role="status" aria-live="polite">
                <div className="prubeh-lista">
                  <div className="prubeh-vypln" style={{ width: `${progress.percent}%` }} />
                </div>
                <div className="prubeh-popis">
                  <span>{progress.message}</span>
                  <span>
                    {t("dialogs.addRecording.percent", {
                      value: formatNumber(progress.percent),
                    })}
                  </span>
                </div>
              </div>
            )}

            {error && <p className="add-recording-error" role="alert">{error}</p>}

            <div className="dialog-patka">
              <button
                type="button"
                className="tlacitko"
                onClick={() => {
                  if (running) void cancelImport(onClose);
                  else onClose();
                }}
              >
                {t("common.cancel")}
              </button>
              <button className="tlacitko hlavni" type="submit" disabled={running || !url.trim()}>
                {running
                  ? t("dialogs.addRecording.submitting")
                  : t("dialogs.addRecording.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** The same capsule microphone in the source card and in the recorder view. */
function MicrophoneIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="7.25" y="1.75" width="5.5" height="10" rx="2.75"
            stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The recorder view — a window onto the application-level recorder.
 *
 * The state lives in `RecorderProvider`, so closing this dialog mid-take does
 * not end the take: it minimises into the header's mini recorder. This
 * component only opens the microphone when nothing is happening yet, draws
 * the shared state, and saves the finished take.
 *
 * Escape minimises a running take (never stops it — the pill still shows it)
 * and a finished take leaves only through its named buttons: audio that
 * cannot be re-made must not die to a stray key.
 */
function MicrophoneView({
  onBack,
  onClose,
  onRecorded,
}: {
  onBack: () => void;
  onClose: () => void;
  onRecorded: (recording: Recording, transcribe: boolean) => void;
}) {
  const { t } = useI18n();
  const userMessage = useUserMessage();
  const recorder = useRecorder();
  const [error, setError] = useState<string | null>(null);
  const { phase } = recorder;
  const phaseNow = useRef(phase);
  phaseNow.current = phase;

  /* One bar per 7 px with a 2 px stroke — the numbers the transport bar under
     the detail's slider draws with (`BAR_SPACING`), so the two spectra are the
     same picture at different sizes. The count follows the stage's real width
     rather than guessing one. */
  const stage = useRef<HTMLDivElement | null>(null);
  /* The strip's own width, not the stage's: the band count and the position of
     the dot are both measured from it, so the colour cannot end up on a
     different pixel than the dot that causes it. */
  const [stripWidth, setStripWidth] = useState(0);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setStripWidth(Math.max(0, element.clientWidth - 32));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const bands = Math.max(24, Math.round((stripWidth || 420) / 7));
  const liveSpectrum = useSpectrum(bands);

  /* Playing the finished take back, right here, before deciding. The picture
     comes from the take's own recorded envelope rather than from a live
     analyser, so the peaks are there whether the playback runs or stands —
     the same way the transport bar under a transcript reads a stored
     recording. */
  const [playing, setPlaying] = useState(false);
  /* Fractional seconds, so the dot over the spectrum moves smoothly; the
     clock floors it. The take's length comes from the recorder's own clock —
     MediaRecorder's WebM reports Infinity for `audio.duration`. */
  const [position, setPosition] = useState(0);
  const playbackAudio = useRef<HTMLAudioElement | null>(null);
  const playbackUrl = useRef<string | null>(null);
  const playbackFrame = useRef(0);

  /* Once the take exists, the strip stops being a live meter and becomes the
     take's own picture, read at whatever position the dot stands on. */
  const finished = phase === "preview" || phase === "saving";
  const takeBars = useMemo(
    () => (finished ? equalizerAtTime(recorder.takeWaveform(), position, bands) : []),
    [finished, recorder, position, bands]
  );

  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(playbackFrame.current);
    playbackAudio.current?.pause();
    playbackAudio.current = null;
    if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
    playbackUrl.current = null;
    setPlaying(false);
    setPosition(0);
  }, []);

  /* Both the play button and the slider need the element; whichever is
     touched first creates it. No analyser hangs off it any more: the bars come
     from what the take recorded about itself, so playing it back needs nothing
     but the audio. */
  const ensurePlayback = useCallback(() => {
    if (playbackAudio.current) return playbackAudio.current;
    const blob = recorder.take();
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const element = new Audio(url);
    playbackAudio.current = element;
    playbackUrl.current = url;
    element.ontimeupdate = () => setPosition(element.currentTime);
    element.onended = () => {
      element.currentTime = 0;
      setPlaying(false);
      setPosition(0);
    };
    return element;
  }, [recorder]);

  const togglePlayback = useCallback(() => {
    const audio = ensurePlayback();
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [ensurePlayback]);

  const seekTo = useCallback(
    (value: number) => {
      const audio = ensurePlayback();
      if (!audio) return;
      audio.currentTime = value;
      setPosition(value);
    },
    [ensurePlayback]
  );

  /* A frame loop only for the position, so the dot glides instead of stepping
     in the ~250 ms hops `timeupdate` fires at. The picture follows from the
     position, so this one loop moves both. */
  useEffect(() => {
    if (!playing) return;
    const step = () => {
      const audio = playbackAudio.current;
      if (audio) setPosition(audio.currentTime);
      playbackFrame.current = requestAnimationFrame(step);
    };
    playbackFrame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(playbackFrame.current);
  }, [playing]);

  // A new take, a discard or a save all invalidate the old playback.
  useEffect(() => {
    if (phase !== "preview" && phase !== "saving") stopPlayback();
  }, [phase, stopPlayback]);
  useEffect(() => () => stopPlayback(), [stopPlayback]);

  // Ask for the microphone as the view opens — a permission prompt appearing
  // the instant after pressing start would eat the first seconds of speech.
  // When the view reopens over a running or finished take, there is nothing
  // to ask; and leaving with nothing recorded lets the microphone go.
  useEffect(() => {
    recorder.openMicrophone();
    return () => {
      if (["preparing", "ready", "denied"].includes(phaseNow.current)) {
        recorder.releaseMicrophone();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    async (transcribe: boolean) => {
      const blob = recorder.take();
      if (!blob) return;
      recorder.setSaving(true);
      setError(null);
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const saved = await api.saveMicrophoneRecording(bytes);
        recorder.reset();
        onRecorded(saved, transcribe);
      } catch (reason) {
        setError(userMessage(reason));
        recorder.setSaving(false);
      }
    },
    [onRecorded, recorder, userMessage]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (phaseNow.current === "recording") onClose();
      else if (["preparing", "ready", "denied"].includes(phaseNow.current)) onBack();
      // A finished take only leaves through its named buttons.
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack, onClose]);

  const status =
    phase === "preparing" || phase === "idle"
      ? t("dialogs.addRecording.micPreparing")
      : phase === "denied"
        ? t("dialogs.addRecording.micDenied")
        : phase === "recording"
          ? recorder.suspended
            ? t("dialogs.addRecording.micSuspended")
            : t("dialogs.addRecording.micRecording")
          : phase === "preview" || phase === "saving"
            ? t("dialogs.addRecording.micStopped")
            : t("dialogs.addRecording.micReady");

  return (
    <>
      {["preparing", "idle", "denied", "ready"].includes(phase) && (
        <button type="button" className="add-recording-back" onClick={onBack}>
          <svg width="13" height="12" viewBox="0 0 14 12" aria-hidden>
            <path d="M6 1L1 6l5 5M1 6h12" fill="none" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("common.back")}
        </button>
      )}
      <h2 id="add-recording-title">{t("dialogs.addRecording.microphone")}</h2>
      <p>{t("dialogs.addRecording.micIntro")}</p>

      <div
        ref={stage}
        className={`mic-stage ${phase === "recording" && !recorder.suspended ? "bezi" : ""}`}
      >
        {phase === "preview" || phase === "saving" ? (
          <button
            className="volba-ikona mic-znak mic-prehrat"
            onClick={togglePlayback}
            disabled={phase === "saving"}
            aria-label={playing
              ? t("dialogs.addRecording.micPause")
              : t("dialogs.addRecording.micPlay")}
            title={playing
              ? t("dialogs.addRecording.micPause")
              : t("dialogs.addRecording.micPlay")}
          >
            {playing ? (
              <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
                <rect x="2.5" y="2" width="2.8" height="8" rx="0.9" fill="currentColor" />
                <rect x="6.7" y="2" width="2.8" height="8" rx="0.9" fill="currentColor" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
                <path d="M3.2 2v8l6.6-4z" fill="currentColor" />
              </svg>
            )}
          </button>
        ) : (
          <span className="volba-ikona mic-znak" aria-hidden>
            <MicrophoneIcon />
          </span>
        )}
        <div className="mic-udaje">
          <span className={phase === "denied" ? "mic-stav chyba" : "mic-stav"}>
            {status}
          </span>
          {(phase === "recording" || phase === "preview" || phase === "saving") && (
            <span className="mic-cas">
              {(playing || position > 0) &&
                `${recorderTime(Math.floor(position))} / `}
              {recorderTime(recorder.seconds)}
            </span>
          )}
        </div>
        {/* The spectrum doubles as the take's timeline once it is finished:
            the position dot rides on it and dragging seeks (Jakub's ask — a
            longer take needs to show where in it the playback stands). */}
        <div className="mic-spektrum-obal">
          {/* While recording every bar is accent — there is no position yet,
              and the colour says the microphone hears something. Once the take
              is finished the strip is a timeline, so it takes the transport
              bar's logic instead: what the dot has passed is accent, what is
              still ahead of it stays grey. */}
          <Waveform
            values={finished ? takeBars : liveSpectrum}
            className={`mic-spektrum ${phase === "recording" ? "bezi" : ""}`}
            waveformStyle="bars"
            anchoring="bottom"
            ceiling={0.82}
            gamma={0.85}
            floor={0.15}
            peak={0.95}
            thickness={2}
            playedRatio={
              (phase === "preview" || phase === "saving") && recorder.seconds > 0
                ? handleRatio(
                    Math.min(1, Math.max(0, position / recorder.seconds)),
                    stripWidth
                  )
                : 0
            }
          />
          {(phase === "preview" || phase === "saving") && recorder.seconds > 0 && (
            <input
              type="range"
              className="posuvnik mic-posuvnik"
              min={0}
              max={recorder.seconds}
              step={0.1}
              value={Math.min(position, recorder.seconds)}
              onChange={(event) => seekTo(Number(event.target.value))}
              disabled={phase === "saving"}
              aria-label={t("dialogs.addRecording.micSeek")}
            />
          )}
        </div>
      </div>

      {error && <p className="add-recording-error" role="alert">{error}</p>}

      <div className="dialog-patka">
        {phase === "recording" ? (
          <>
            <button className="tlacitko tichy" onClick={onClose}>
              {t("dialogs.addRecording.micMinimize")}
            </button>
            <button className="tlacitko hlavni" onClick={recorder.stop}>
              {t("dialogs.addRecording.micStop")}
            </button>
          </>
        ) : phase === "preview" || phase === "saving" ? (
          <>
            <button className="tlacitko tichy" onClick={recorder.discard}
                    disabled={phase === "saving"}>
              {t("dialogs.addRecording.micDiscard")}
            </button>
            <button className="tlacitko" onClick={() => void save(false)}
                    disabled={phase === "saving"}>
              {t("common.add")}
            </button>
            <button className="tlacitko hlavni" onClick={() => void save(true)}
                    disabled={phase === "saving"}>
              {phase === "saving"
                ? t("dialogs.addRecording.micSaving")
                : t("dialogs.addRecording.micTranscribe")}
            </button>
          </>
        ) : (
          <>
            <button className="tlacitko" onClick={onBack}>{t("common.cancel")}</button>
            {/* The record dot rather than a red button: red means destructive
                everywhere else here (Smazat, Odebrat, Včetně přepisů), and a
                whole red surface on the one action that destroys nothing would
                spend that meaning. The dot is the same red and the same size
                as the one the mini recorder pulses with, so the mark that says
                "this is recording" and the mark that starts it are one idea. */}
            <button className="tlacitko hlavni mic-start" onClick={recorder.start}
                    disabled={phase !== "ready"}>
              <span className="mic-start-tecka" aria-hidden />
              {t("dialogs.addRecording.micStart")}
            </button>
          </>
        )}
      </div>
    </>
  );
}
