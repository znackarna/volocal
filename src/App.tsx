import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";

import { api } from "./api";
import { equalizerAtTime, Waveform, usePlayer } from "./player";
import Library from "./Library";
import Detail from "./Detail";
import SettingsScreen from "./Settings";
import SetupWizard from "./SetupWizard";
import ConfirmationDialog from "./ConfirmationDialog";
import Tooltips from "./Tooltips";
import AddRecordingDialog from "./AddRecordingDialog";
import SpeakerCountDialog from "./SpeakerCountDialog";
import RecordingMetadataIcon from "./RecordingMetadataIcon";
import type { RecordingMetadataKind } from "./RecordingMetadataIcon";
// inlined into the page rather than via <img>, for sharpness and colours
import mark from "./mark.svg?raw";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import { formatTime, applyFonts, fileName } from "./types";
import { useI18n } from "./i18n";
import { useProgressMessage, useUserMessage } from "./messages";
import { useLabels } from "./labels";
import { useFormats } from "./formats";
import type {
  AiEditProgress,
  ToolCheck,
  UserMessage,
  Recording,
  TranscriptionProgress,
  LiveSegment,
  WatchFolderCandidate,
} from "./types";

const SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mkv", "mov", "webm"];





/** The last part of a path, whichever separator the system uses. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function FooterStatusItem({
  kind,
  value,
  label,
  detail,
}: {
  kind: RecordingMetadataKind;
  value: string;
  label: string;
  /** Shown in the tooltip after the label, where the visible value is a
   *  shortened form of something longer. */
  detail?: string;
}) {
  const { t } = useI18n();

  return (
    <span
      className="app-status-item"
      aria-label={t("app.shell.statusItem", { label, value: detail ?? value })}
      title={detail ? `${label}: ${detail}` : label}
    >
      <RecordingMetadataIcon kind={kind} />
      <span>{value}</span>
    </span>
  );
}

/** The order the pipeline goes through. Used only to spot a report that
 *  arrives out of turn. */
const PHASE_ORDER = [
  "preparation",
  "playback",
  "transcription",
  "diarization",
  "saving",
];

/** Phases that end a run. After one of them anything may follow — a new run
 *  legitimately starts from the beginning. */
const FINAL_PHASES = ["complete", "error", "cancelled"];

/**
 * Should this report replace the one currently shown?
 *
 * Progress arrives from several places at once: the conversion, the thread
 * reading whisper's output, diarization. They are not synchronised with each
 * other, so a late report can turn up after a newer one and throw the caption
 * back a step — which looked like the label flicking between "Převádím zvuk"
 * and "Přepisuji" at random. Anything that would move the run backwards is
 * dropped; going back is only allowed once the previous run has ended.
 */
function keepsMovingForward(
  previous: TranscriptionProgress | undefined,
  next: TranscriptionProgress
): boolean {
  if (!previous) return true;
  if (FINAL_PHASES.includes(previous.phase)) return true;
  if (FINAL_PHASES.includes(next.phase)) return true;

  const before = PHASE_ORDER.indexOf(previous.phase);
  const after = PHASE_ORDER.indexOf(next.phase);
  if (before === -1 || after === -1) return true;
  if (after !== before) return after > before;
  return next.percent >= previous.percent;
}

export default function App() {
  const { t, tPlural } = useI18n();
  const labels = useLabels();
  const formats = useFormats();
  const [screen, setScreen] = useState<
    "library" | "detail" | "settings" | "wizard"
  >("library");
  const [wizardReturnScreen, setWizardReturnScreen] = useState<"library" | "detail" | "settings">("library");
  const [wizardRequired, setWizardRequired] = useState(false);
  // When settings sends the user to the modules for one specific thing, the
  // wizard preselects it instead of walking through every step.
  const [missingModule, setMissingModule] = useState<string | null>(null);
  // Transcribe on add, or wait for the word. The choice survives restarts.
  const [automatic, setAutomatic] = useState(
    () => localStorage.getItem("prepisovat-rovnou") !== "ne"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  /** Enough of the settings to know whether a transcription must ask about
   *  speakers, and what to offer as the starting answer. */
  const [speakerSetup, setSpeakerSetup] = useState({ separates: false, count: 0 });
  /** Recordings waiting for that answer before they start. */
  /** Recordings whose speakers are being separated right now. The screens
   *  cannot tell from the progress alone, because the first event arrives a
   *  moment after the run is asked for. */
  const [diarizingIds, setDiarizingIds] = useState<string[]>([]);
  const [pendingTranscription, setPendingTranscription] =
    useState<{ ids: string[]; language?: string; diarizeOnly?: boolean } | null>(null);

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [progress, setProgress] = useState<Record<string, TranscriptionProgress>>({});
  const [aiProgress, setAiProgress] = useState<Record<string, AiEditProgress>>({});
  const [liveSegments, setLiveSegments] = useState<Record<string, LiveSegment[]>>({});
  const [watchCandidates, setWatchCandidates] = useState<WatchFolderCandidate[]>([]);
  const [watchDecisionRunning, setWatchDecisionRunning] = useState(false);
  const [check, setCheck] = useState<ToolCheck | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * The bar across the top of the window.
   *
   * It carries two kinds of message and they must not look the same. A failed
   * transcription is red because something needs attention; confirming a word
   * was added to the dictionary is not a warning, and shouting it in red made
   * a routine action feel like a fault.
   */
  const [notice, setNotice] = useState<{ text: string; kind: "info" | "error" } | null>(
    null
  );
  const [noticeClosing, setNoticeClosing] = useState(false);
  // Rust sends a code, not a sentence; these turn one into the other.
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();
  const reportError = useCallback((text: string) => {
    setNoticeClosing(false);
    setNotice({ text, kind: "error" });
  }, []);
  const reportInfo = useCallback((text: string) => {
    setNoticeClosing(false);
    setNotice({ text, kind: "info" });
  }, []);

  // A notice that stays until it is dismissed becomes furniture. Give it long
  // enough to be read twice and then let it go on its own; the Close button
  // remains for anyone who has already read it.
  //
  // Errors linger longer than confirmations — a confirmation only says that
  // what you asked for happened, an error asks you to do something about it.
  useEffect(() => {
    if (!notice) return;
    const delay = noticeClosing ? 280 : notice.kind === "error" ? 9000 : 5000;
    const timer = setTimeout(() => {
      if (noticeClosing) {
        setNotice(null);
        setNoticeClosing(false);
      } else {
        setNoticeClosing(true);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [notice, noticeClosing]);
  const [query, setQuery] = useState<ConfirmationRequest | null>(null);
  const [addRecordingOpen, setAddRecordingOpen] = useState(false);

  // Fonts and text size live in the settings, not in CSS, so each person can
  // fit them to their eyes rather than the other way round.
  const automaticRef = useRef(automatic);
  automaticRef.current = automatic;
  const watchScanRunning = useRef(false);
  const watchDecisionRunningRef = useRef(false);
  const lastWatchError = useRef("");

  const [archiveSetup, setArchiveSetup] = useState({ model: "", watchFolder: "" });
  /* Read once from the bundle rather than typed here, so bumping
     `tauri.conf.json` is the only thing anyone has to remember. */
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const loadAppearance = useCallback(async () => {
    try {
      const settings = await api.loadSettings();
      applyFonts(settings);
      setSpeakerSetup({
        separates: settings.diarization,
        count: settings.speaker_count,
      });
      /* The Archive footer's left side says what the archive holds. Its right
         side says what will happen to the next recording — where they arrive
         from and which model will read them. Both are standing settings, which
         is what a status strip is for. */
      setArchiveSetup({
        model: settings.model,
        watchFolder: settings.watch_folder_enabled ? settings.watch_folder : "",
      });
    } catch {
      /* on a first run there may be nothing to load yet */
    }
  }, []);

  const loadRecordings = useCallback(async () => {
    try {
      setRecordings(await api.listRecordings());
    } catch (e) {
      reportError(userMessage(e));
    }
  }, [userMessage]);

  /** Runs the transcriptions once the speaker question is settled. */
  const runTranscription = useCallback(
    async (
      ids: string[],
      language: string | undefined,
      speakerCount: number | null,
      diarizeOnly = false
    ) => {
      // A finished run leaves `complete` behind for this recording. The screens
      // read that as "the work is over" the moment a new one starts, so the
      // stale entry goes before the first event of the new run arrives.
      setProgress((current) => {
        const next = { ...current };
        for (const id of ids) delete next[id];
        return next;
      });
      // The live tail of the previous run is stale for the same reason, and it
      // is worse than stale: the screens render it while the new run reports
      // two percent, so a re-transcription opens with the old text.
      setLiveSegments((current) => {
        const next = { ...current };
        for (const id of ids) delete next[id];
        return next;
      });
      if (diarizeOnly) setDiarizingIds((current) => [...new Set([...current, ...ids])]);
      try {
        for (const id of ids) {
          if (diarizeOnly) await api.diarizeSpeakers(id, speakerCount);
          else if (language) await api.transcribeInLanguage(id, language, speakerCount);
          else await api.startTranscription(id, speakerCount);
        }
      } catch (e) {
        if (diarizeOnly) setDiarizingIds((current) => current.filter((x) => !ids.includes(x)));
        reportError(userMessage(e));
      }
      await loadRecordings();
    },
    [loadRecordings, reportError, userMessage]
  );

  /** The single door every transcription goes through. Separating speakers is
   *  the only thing that needs an answer first, so it is the only thing that
   *  stops here; otherwise this is a direct call. */
  const askAboutSpeakers = useCallback(
    async (ids: string[], language?: string) => {
      if (!speakerSetup.separates) {
        await runTranscription(ids, language, null);
        return;
      }
      setPendingTranscription({ ids, language });
    },
    [runTranscription, speakerSetup.separates]
  );

  const beginTranscription = useCallback(
    async (ids: string[], language?: string) => {
      if (ids.length === 0) return;
      /* Transcribing again replaces the text, and with it every manual
         correction and every uncertain spot already signed off. Deleting the
         transcript from the same menu asks first; doing it as a side effect of
         starting a new run did not. */
      const finished = ids.filter(
        (id) => recordings.find((r) => r.id === id)?.status === "hotova"
      );
      if (finished.length > 0) {
        const only = finished.length === 1
          ? recordings.find((r) => r.id === finished[0])
          : undefined;
        setQuery({
          nadpis: t("dialogs.retranscribe.title"),
          text: only
            ? t("dialogs.retranscribe.textOne", {
                title: only.title || fileName(only.path),
              })
            : tPlural("dialogs.retranscribe.textMany", finished.length),
          confirm: t("dialogs.retranscribe.confirm"),
          nicive: true,
          action: () => void askAboutSpeakers(ids, language),
        });
        return;
      }
      await askAboutSpeakers(ids, language);
    },
    [askAboutSpeakers, recordings, t, tPlural]
  );

  /** Separating speakers on its own. It is entirely about how many people
   *  speak, so it always asks, whatever the settings say. */
  const beginDiarization = useCallback((id: string) => {
    setPendingTranscription({ ids: [id], diarizeOnly: true });
  }, []);

  const loadToolCheck = useCallback(async () => {
    try {
      const k = await api.checkTools();
      setCheck(k);
      return k;
    } catch {
      return null;
    }
  }, []);

  // The watch folder deliberately uses a modest poll instead of a permanent
  // operating-system watcher. It keeps the feature portable and, together
  // with the backend's two-scan stability check, never opens a file midway
  // through a copy.
  useEffect(() => {
    let alive = true;
    const scan = async () => {
      if (watchScanRunning.current || watchDecisionRunningRef.current) return;
      watchScanRunning.current = true;
      try {
        const found = await api.scanWatchFolder();
        if (!alive || watchDecisionRunningRef.current) return;
        lastWatchError.current = "";
        setWatchCandidates(found);
      } catch (error) {
        const message = userMessage(error);
        if (alive && lastWatchError.current !== message) {
          lastWatchError.current = message;
          reportError(message);
        }
      } finally {
        watchScanRunning.current = false;
      }
    };

    const initial = window.setTimeout(scan, 1200);
    const interval = window.setInterval(scan, 5000);
    return () => {
      alive = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [reportError, userMessage]);

  useEffect(() => {
    loadAppearance();
    loadRecordings();
    // With tools missing, showing an empty archive and waiting for the user
    // to find Settings makes no sense. Open the wizard straight away.
    loadToolCheck().then((k) => {
      if (k && k.issues.length > 0) {
        setWizardRequired(true);
        setWizardReturnScreen("library");
        setScreen("wizard");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRecordings, loadToolCheck]);

  // ---------------------------------------------------- udalosti z prepisu
  useEffect(() => {
    // `listen` returns a promise. If the component unmounts before it
    // resolves, a naive cleanup unsubscribes nothing and the listener is left
    // hanging — events would then be handled twice. Hence the alive guard.
    let liveSegments = true;
    const unlisten: Array<() => void> = [];
    const add = (p: Promise<() => void>) =>
      p.then((f) => (liveSegments ? unlisten.push(f) : f()));

    add(
      listen<TranscriptionProgress>("transcription:status", (u) => {
        setProgress((p) => {
          const previous = p[u.payload.recording_id];
          if (!keepsMovingForward(previous, u.payload)) return p;
          return { ...p, [u.payload.recording_id]: u.payload };
        });
      })
    );

    add(
      listen<LiveSegment>("transcription:segment", (u) => {
        const s = u.payload;
        setLiveSegments((z) => {
          const existing = z[s.recording_id] ?? [];
          // Guard against the same event arriving twice. Identical text at
          // the same time is a duplicate, not something said twice.
          const last = existing[existing.length - 1];
          if (last && last.text === s.text && last.start === s.start) {
            return z;
          }
          // keep only the tail: a few lines are all the library can show
          return { ...z, [s.recording_id]: [...existing, s].slice(-40) };
        });
      })
    );

    /* A run is over for that recording whichever kind it was, so both terminal
       events clear the job state the screens read. Without this the diarizing
       flag never comes down: the detail keeps a bubble frozen at 100 %, hides
       the recording's own actions, and — because the player is rendered only
       when nothing is running — leaves the recording unplayable until the
       application is restarted. The backend has always sent the id; this
       listener used to throw it away. */
    const finishJob = (id: string) => {
      if (!id) return;
      setDiarizingIds((current) => current.filter((x) => x !== id));
      setLiveSegments((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    };

    add(
      listen<string>("transcription:complete", (u) => {
        finishJob(u.payload);
        loadRecordings();
      })
    );

    add(
      listen<AiEditProgress>("ai-edit:progress", (u) => {
        const next = u.payload;
        const terminal = ["complete", "error", "cancelled"].includes(next.phase);
        setAiProgress((current) => {
          if (!terminal) return { ...current, [next.recording_id]: next };
          if (!(next.recording_id in current)) return current;
          const updated = { ...current };
          delete updated[next.recording_id];
          return updated;
        });
        if (next.phase === "error") reportError(progressMessage(next.description));
      })
    );

    add(
      listen<[string, UserMessage]>("transcription:error", (u) => {
        finishJob(u.payload[0]);
        reportError(userMessage(u.payload[1]));
        loadRecordings();
      })
    );

    return () => {
      liveSegments = false;
      unlisten.forEach((f) => f());
    };
  }, [loadRecordings, progressMessage, reportError, userMessage]);

  // ---------------------------------------------------- pretahovani souboru
  const acceptFiles = useCallback(
    async (paths: string[]) => {
      const audio = paths.filter((c) => SUPPORTED_EXTENSIONS.includes(c.split(".").pop()?.toLowerCase() ?? ""));
      if (audio.length === 0) {
        reportError(t("app.notice.unsupportedFormat"));
        return;
      }
      for (const c of audio) {
        try {
          const n = await api.addRecording(c);
          if (automaticRef.current) await beginTranscription([n.id]);
          // The status changes on the backend side, so the list has to be
          // reloaded. Without it the row keeps looking untranscribed even
          // while a transcription is running.
          await loadRecordings();
        } catch (e) {
          reportError(userMessage(e));
        }
      }
    },
    [loadRecordings, t, userMessage]
  );

  useEffect(() => {
    // The same guard as above, and it matters more here: two stray listeners
    // would mean every dropped file gets added and transcribed twice.
    let liveSegments = true;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((u) => {
        if (u.payload.type === "over") setDragging(true);
        else if (u.payload.type === "drop") {
          setDragging(false);
          acceptFiles(u.payload.paths);
        } else setDragging(false);
      })
      .then((f) => {
        if (liveSegments) unlisten = f;
        else f();
      });
    return () => {
      liveSegments = false;
      unlisten?.();
    };
  }, [acceptFiles]);

  const selectFile = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: t("app.filePicker.audioAndVideo"), extensions: SUPPORTED_EXTENSIONS }],
    });
    if (!selected) return;
    await acceptFiles(Array.isArray(selected) ? selected : [selected]);
  }, [acceptFiles, t]);

  // ---------------------------------------------------- navigace
  const openRecording = useCallback((id: string, time?: number) => {
    setSelectedId(id);
    setSeekTime(time ?? null);
    setScreen("detail");
  }, []);

  const blockingIssues = useMemo(() => check?.issues ?? [], [check]);
  const player = usePlayer();

  const transcribeWatchCandidates = useCallback(async (candidates: WatchFolderCandidate[]) => {
    if (candidates.length === 0 || watchDecisionRunningRef.current) return;
    watchDecisionRunningRef.current = true;
    setWatchDecisionRunning(true);
    try {
      const added = await api.importWatchFolderFiles(candidates);
      // One question for the whole batch: they came out of the same folder and
      // are almost always the same kind of recording.
      await beginTranscription(added.map((recording) => recording.id));
      const handled = new Set(candidates.map((candidate) => `${candidate.path}:${candidate.fingerprint}`));
      setWatchCandidates((current) => current.filter(
        (candidate) => !handled.has(`${candidate.path}:${candidate.fingerprint}`)
      ));
      await loadRecordings();
      reportInfo(tPlural("app.watchFolder.transcribing", added.length));
    } catch (error) {
      reportError(userMessage(error));
    } finally {
      watchDecisionRunningRef.current = false;
      setWatchDecisionRunning(false);
    }
  }, [loadRecordings, reportError, reportInfo, tPlural, userMessage]);

  const addWatchCandidates = useCallback(async (candidates: WatchFolderCandidate[]) => {
    if (candidates.length === 0 || watchDecisionRunningRef.current) return;
    watchDecisionRunningRef.current = true;
    setWatchDecisionRunning(true);
    try {
      const added = await api.importWatchFolderFiles(candidates);
      const handled = new Set(candidates.map((candidate) => `${candidate.path}:${candidate.fingerprint}`));
      setWatchCandidates((current) => current.filter(
        (candidate) => !handled.has(`${candidate.path}:${candidate.fingerprint}`)
      ));
      await loadRecordings();
      reportInfo(tPlural("app.watchFolder.added", added.length));
    } catch (error) {
      reportError(userMessage(error));
    } finally {
      watchDecisionRunningRef.current = false;
      setWatchDecisionRunning(false);
    }
  }, [loadRecordings, reportError, reportInfo, tPlural, userMessage]);

  const ignoreWatchCandidates = useCallback(async (candidates: WatchFolderCandidate[]) => {
    if (candidates.length === 0 || watchDecisionRunningRef.current) return;
    watchDecisionRunningRef.current = true;
    setWatchDecisionRunning(true);
    try {
      await api.ignoreWatchFolderFiles(candidates);
      const handled = new Set(candidates.map((candidate) => `${candidate.path}:${candidate.fingerprint}`));
      setWatchCandidates((current) => current.filter(
        (candidate) => !handled.has(`${candidate.path}:${candidate.fingerprint}`)
      ));
    } catch (error) {
      reportError(userMessage(error));
    } finally {
      watchDecisionRunningRef.current = false;
      setWatchDecisionRunning(false);
    }
  }, [reportError, userMessage]);

  const archiveFooterStatus = useMemo(() => {
    const completed = recordings.filter((recording) => recording.status === "hotova");
    const duration = completed.reduce((sum, recording) => sum + recording.duration, 0);
    return {
      transcripts: formats.transcriptCount(completed.length),
      duration: formats.archiveDuration(duration),
    };
  }, [formats, recordings]);

  const detailFooterStatus = useMemo(() => {
    const recording = recordings.find((item) => item.id === selectedId);
    if (!recording) return null;
    return {
      duration: recording.duration > 0 ? formatTime(recording.duration) : null,
      language: recording.language ? labels.languageCapitalized(recording.language) : null,
      segments: recording.status === "hotova" ? formats.segmentCount(recording.segment_count) : null,
    };
  }, [formats, labels, recordings, selectedId]);

  const leaveWizard = useCallback(() => {
    setWizardRequired(false);
    setMissingModule(null);
    loadToolCheck();
    if (wizardReturnScreen === "library") loadRecordings();
    if (wizardReturnScreen === "settings") loadAppearance();
    setScreen(wizardReturnScreen);
  }, [loadAppearance, loadRecordings, loadToolCheck, wizardReturnScreen]);

  return (
    <div className={`aplikace ${dragging ? "pretahuje" : ""}`}>
      {screen !== "detail" && (
      <header className="lista">
        <div className="lista-levo">
        <button
          className="znacka header-brand-mark"
          onClick={() => {
            setScreen("library");
            loadRecordings();
          }}
        >
          <span
            className="logotyp"
            aria-label={t("app.name")}
            dangerouslySetInnerHTML={{ __html: mark }}
          />
          {/* Only in the Archive. Deeper in, the header carries the recording
              or the screen the reader is in, and a wordmark repeated there
              would take room from what actually changes. */}
          {screen === "library" && (
            <span className="header-brand-name">
              {/* i18n-ignore: a product name, not copy — it is the same word in
                  every language. The version comes from tauri.conf.json, so the
                  two cannot drift apart. */}
              Whisp
              {version && <span className="header-brand-version">v{version}</span>}
            </span>
          )}
        </button>

        {/* Back navigation follows the brand and precedes the current screen
            context. The required setup wizard omits it until transcription can run. */}
        {screen !== "library" && !(screen === "wizard" && wizardRequired) && (
          <button
            className="tlacitko tichy"
            onClick={() => {
              if (screen === "wizard") {
                leaveWizard();
                return;
              }
              loadToolCheck();
              loadAppearance();
              loadRecordings();
              setScreen("library");
            }}
          >
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
              <path d="M6 1L1 6l5 5M1 6h12" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {screen === "wizard" && wizardReturnScreen === "settings"
              ? t("common.settings")
              : t("common.archive")}
          </button>
        )}

        {/* Detail owns its complete contextual header and full player, so this
            generic application header (including the mini player) is absent there. */}
        {player.recordingId && (
          <MiniPlayer
            onOpen={() => {
              if (player.recordingId) openRecording(player.recordingId);
            }}
          />
        )}

        </div>

        <div className="lista-pravo">
          {screen !== "settings" && screen !== "wizard" && (
            <button className="tlacitko tichy" onClick={() => setAddRecordingOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
                <path d="M7.5 2v11M2 7.5h11" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {t("app.newTranscript")}
            </button>
          )}
          <button
            className={`tlacitko tichy ${blockingIssues.length ? "vystraha" : ""}`}
            onClick={() => {
              setScreen("settings");
              loadToolCheck();
            }}
          >
            {/* Táhla, ne ozubené kolo — to je při 16 px nečitelná drobnokresba. */}
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M2 4.5h3.2M8.8 4.5H14M2 11.5h6.2M11.8 11.5H14"
                    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="7" cy="4.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="11.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {t("common.settings")}{blockingIssues.length > 0 ? " •" : ""}
          </button>
        </div>
      </header>
      )}

      {notice && (
        <div
          className={`hlaska ${notice.kind}${noticeClosing ? " odchazi" : ""}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNoticeClosing(true)}>{t("common.close")}</button>
        </div>
      )}

      {screen === "library" && (
        <Library
          recordings={recordings}
          progress={progress}
          aiProgress={aiProgress}
          liveSegments={liveSegments}
          issues={blockingIssues}
          watchCandidates={watchCandidates}
          watchDecisionRunning={watchDecisionRunning}
          onTranscribeWatchCandidates={transcribeWatchCandidates}
          onIgnoreWatchCandidates={ignoreWatchCandidates}
          onAddWatchCandidates={addWatchCandidates}
          onOpen={openRecording}
          onDelete={(id) => {
            const n = recordings.find((x) => x.id === id);
            setQuery({
              nadpis: t("app.confirm.removeTitle"),
              text: t("app.confirm.removeText", { title: n?.title ?? "" }),
              confirm: t("app.confirm.removeAction"),
              nicive: true,
              action: async () => {
                await api.deleteRecording(id);
                // A deleted recording has no business still playing.
                if (player.recordingId === id) player.close();
                loadRecordings();
              },
            });
          }}
          onTranscription={(id) => void beginTranscription([id])}
          onCancel={async (id) => {
            await api.cancelTranscription(id);
            loadRecordings();
          }}
          onDeleteTranscription={(id) => {
            const n = recordings.find((x) => x.id === id);
            setQuery({
              nadpis: t("app.confirm.deleteTranscriptTitle"),
              text: t("app.confirm.deleteTranscriptText", { title: n?.title ?? "" }),
              confirm: t("app.confirm.deleteTranscriptAction"),
              nicive: true,
              action: async () => {
                await api.deleteTranscription(id);
                loadRecordings();
              },
            });
          }}
          onRename={async (id, title) => {
            await api.renameRecording(id, title);
            player.updateTitle(id, title);
            loadRecordings();
          }}
          onTranscriptionLanguage={(id, j) => void beginTranscription([id], j)}
          automatic={automatic}
          onAutomatic={(z) => {
            setAutomatic(z);
            localStorage.setItem("prepisovat-rovnou", z ? "ano" : "ne");
          }}
          onAdd={() => setAddRecordingOpen(true)}
          onToSettings={() => {
            setWizardRequired(true);
            setWizardReturnScreen("library");
            setScreen("wizard");
          }}
        />
      )}

      {screen === "detail" && selectedId && (
        <Detail
          /* A new recording means a new screen. Without a key React would
             jen přepoužil a než dorazí data, svítil by na ní text, stav
             a křivka té předchozí. */
          key={selectedId}
          id={selectedId}
          seekTime={seekTime}
          progress={progress[selectedId]}
          liveSegments={liveSegments[selectedId] ?? []}
          onBack={() => {
            setScreen("library");
            loadRecordings();
          }}
          onNew={() => setAddRecordingOpen(true)}
          onSettings={() => {
            setScreen("settings");
            loadToolCheck();
          }}
          onError={reportError}
          onInfo={reportInfo}
          onTranscribe={(id, language) => void beginTranscription([id], language)}
          onDiarize={beginDiarization}
          diarizing={diarizingIds.includes(selectedId)}
          onToModule={(module) => {
            setWizardRequired(false);
            setMissingModule(module ?? null);
            setWizardReturnScreen("detail");
            setScreen("wizard");
          }}
        />
      )}

      {screen === "wizard" && (
        <SetupWizard
          required={wizardRequired}
          missingModule={missingModule}
          onBack={leaveWizard}
          onComplete={() => {
            leaveWizard();
          }}
        />
      )}

      {screen === "settings" && (
        <SettingsScreen
          onComplete={() => {
            loadToolCheck();
            loadAppearance();
            setScreen("library");
          }}
          onError={reportError}
          onToModule={(module) => {
            setWizardRequired(false);
            setMissingModule(module ?? null);
            setWizardReturnScreen("settings");
            setScreen("wizard");
          }}
        />
      )}

      {(screen === "library" || screen === "detail") && (
        <footer className="app-status-footer" aria-label={t("app.shell.statusBar")}>
          {screen === "library" ? (
            <div className="app-status-footer-group">
              <FooterStatusItem
                kind="segments"
                value={archiveFooterStatus.transcripts}
                label={t("app.shell.transcriptCount")}
              />
              <FooterStatusItem
                kind="duration"
                value={archiveFooterStatus.duration}
                label={t("app.shell.totalDuration")}
              />
            </div>
          ) : (
            <div className="app-status-footer-group">
              <FooterStatusItem
                kind="saved"
                value={t("common.saved")}
                label={t("app.shell.documentState")}
              />
            </div>
          )}
          {screen === "library" && (archiveSetup.watchFolder || archiveSetup.model) && (
            <div className="app-status-footer-group">
              {archiveSetup.watchFolder && (
                <FooterStatusItem
                  kind="folder"
                  /* The folder's own name, not its path. A status strip 30 px
                     tall cannot hold `C:\Users\…` and the name is what the
                     reader recognises; the whole path is in the tooltip. */
                  value={folderName(archiveSetup.watchFolder)}
                  label={t("app.shell.watchFolder")}
                  detail={archiveSetup.watchFolder}
                />
              )}
              {archiveSetup.model && (
                <FooterStatusItem
                  kind="model"
                  value={labels.model(archiveSetup.model)}
                  label={t("app.shell.model")}
                />
              )}
            </div>
          )}

          {screen === "detail" && detailFooterStatus && (
            <div className="app-status-footer-group">
              {detailFooterStatus.duration && (
                <FooterStatusItem
                  kind="duration"
                  value={detailFooterStatus.duration}
                  label={t("app.shell.recordingDuration")}
                />
              )}
              {detailFooterStatus.language && (
                <FooterStatusItem
                  kind="language"
                  value={detailFooterStatus.language}
                  label={t("app.shell.language")}
                />
              )}
              {detailFooterStatus.segments && (
                <FooterStatusItem
                  kind="segments"
                  value={detailFooterStatus.segments}
                  label={t("app.shell.segmentCount")}
                />
              )}
            </div>
          )}
        </footer>
      )}

      {addRecordingOpen && (
        <AddRecordingDialog
          onClose={() => setAddRecordingOpen(false)}
          onLocalFile={() => {
            setAddRecordingOpen(false);
            selectFile();
          }}
          onImported={(recording) => {
            setAddRecordingOpen(false);
            void (async () => {
              try {
                if (automaticRef.current) await beginTranscription([recording.id]);
                await loadRecordings();
                reportInfo(
                  automaticRef.current
                    ? t("app.notice.onlineAddedTranscribing")
                    : t("app.notice.onlineAdded")
                );
              } catch (error) {
                await loadRecordings();
                reportError(userMessage(error));
              }
            })();
          }}
        />
      )}

      <ConfirmationDialog query={query} onZavri={() => setQuery(null)} />

      {pendingTranscription && (
        <SpeakerCountDialog
          recordingCount={pendingTranscription.ids.length}
          suggested={speakerSetup.count}
          onCancel={() => setPendingTranscription(null)}
          onConfirm={(speakerCount) => {
            const pending = pendingTranscription;
            setPendingTranscription(null);
            void runTranscription(
              pending.ids,
              pending.language,
              speakerCount,
              pending.diarizeOnly
            );
          }}
        />
      )}

      {/* Last in the tree, so its own stacking context sits above everything
          the application draws. */}
      <Tooltips />

      {dragging && (
        <div className="prekryv-pretazeni">
          <div className="prekryv-obsah">
            <div className="prekryv-ikona">↓</div>
            {/* What is about to happen, not what usually happens. With
                automatic transcription off the file only lands in the archive,
                and promising a transcript there was a plain untruth. */}
            <p>{t(automatic ? "app.dropZone.hint" : "app.dropZone.hintManual")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Miniature player in the header bar. Progress is a ring around the button:
 *  a separate strip under the title pushed the text upward and there was no
 *  room for it in a thirty-pixel bar. */
function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const {
    title,
    time,
    duration,
    isPlaying,
    isPreparing,
    sourceMissing,
    togglePlayback,
    close,
  } = usePlayer();

  const R = 12.5;
  const circumference = 2 * Math.PI * R;
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div className="mini-prehravac">
      <AudioBars />
      <button
        className="mini-prehrat"
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
        <svg className="mini-prstenec" width="30" height="30" viewBox="0 0 30 30" aria-hidden>
          <circle className="mini-drazka" cx="15" cy="15" r={R} />
          <circle
            className="mini-postup"
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

      <button className="mini-popis" onClick={onOpen} title={t("app.player.openTranscript")}>
        {title}
      </button>

      <span className={`mini-cas ${sourceMissing ? "varovne" : ""}`}>
        {sourceMissing
          ? t("app.player.sourceMissing")
          : isPreparing
            ? t("app.player.preparingShort")
            : formatTime(time)}
      </span>

      <button className="mini-zavrit" onClick={close} aria-label={t("app.player.stop")}>
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

function AudioBars() {
  const { waveform, time, isPlaying, sourceMissing } = usePlayer();

  const values = useMemo(
    () => equalizerAtTime(waveform, time, MINI_BANDS),
    [waveform, time]
  );

  if (values.length === 0 || sourceMissing) return null;

  // Real frequency bands stay in place and only change height.
  return (
    <Waveform
      values={values}
      className={`mini-vlny ${isPlaying ? "hraje" : ""}`}
      waveformStyle="bars"
      anchoring="bottom"
      ceiling={0.78}
      gamma={MINI_GAMMA}
      floor={MINI_FLOOR}
      peak={MINI_PEAK}
      thickness={1.5}
    />
  );
}
