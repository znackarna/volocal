import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api } from "./api";
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
}: {
  onClose: () => void;
  onLocalFile: () => void;
  onImported: (recording: Recording) => void;
}) {
  const { t, formatNumber } = useI18n();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();
  const [view, setView] = useState<"source" | "online">("source");
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
      onMouseDown={() => !running && onClose()}
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
                  <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
                    <path d="M8 12l4-4M6.8 14.6l-1.4 1.3a3 3 0 01-4.3-4.3l3-3a3 3 0 014.3 0"
                          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M13.2 5.4l1.4-1.3a3 3 0 014.3 4.3l-3 3a3 3 0 01-4.3 0"
                          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="volba-telo">
                  <span className="volba-nazev">{t("dialogs.addRecording.onlineVideo")}</span>
                  <span className="drobne">{t("dialogs.addRecording.onlineVideoNote")}</span>
                </span>
              </button>
            </div>
            <div className="dialog-patka">
              <button className="tlacitko" onClick={onClose}>{t("common.cancel")}</button>
            </div>
          </>
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
