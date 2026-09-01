import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";

import { api } from "./api";
import { MiniPlayer, usePlayer } from "./player";
import { MiniRecorder } from "./recorder";
import Library from "./Library";
import ConfirmationDialog from "./ConfirmationDialog";
import NameDialog from "./NameDialog";
import Tooltips from "./Tooltips";
import AddRecordingDialog from "./AddRecordingDialog";
import SpeakerCountDialog from "./SpeakerCountDialog";
import RecordingMetadataIcon from "./RecordingMetadataIcon";
import ProgressBubble from "./ProgressBubble";
import type { RecordingMetadataKind } from "./RecordingMetadataIcon";
import { Wordmark } from "./Brand";
/* Imported plainly rather than behind `await import(...)`. Deferring it looked
   like it kept the updater out of the bundle until somebody turned the check
   on — it did not: the About page imports the same module directly, so it is
   in the main chunk either way, and the build says so. */
/* Renamed: `check` is already the tool-availability state in this component,
   and the two have nothing to do with each other. */
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import { formatTime, applyFonts, applyTheme, fileName, noteUpdateCheck } from "./types";
import { useNotices } from "./app/useNotices";
import { useWatchFolder } from "./app/useWatchFolder";
import { NoticeBar } from "./app/NoticeBar";
import { rememberSpeakerNames } from "./speakerNames";
import { computeFellBack } from "./compute";
import { useI18n } from "./i18n";
import type { TranslationKey } from "./i18n";
import { useProgressMessage, useUserMessage } from "./messages";
import { useLabels } from "./labels";
import { useFormats } from "./formats";
import type {
  AiEditProgress,
  DownloadComponent,
  DownloadProgress,
  ToolCheck,
  UserMessage,
  Recording,
  TranscriptionProgress,
  LiveSegment,
  WatchFolderCandidate,
  Folder,
} from "./types";

/** The three screens the window does not open on.
 *
 *  Everything used to arrive in one 583 kB chunk that the webview parsed and
 *  ran before it drew anything, and the archive — the only screen a start ever
 *  shows — is a small part of it. These three are the big absent ones: 68 kB of
 *  transcript, 45 kB of settings, 17 kB of wizard. What is left to do before
 *  the first paint is 457 kB rather than 583.
 *
 *  **They are fetched a moment later anyway**, by `usePreparedScreens` below,
 *  so this is not the usual trade of a slow first click for a fast start. The
 *  work moves after the window rather than out of the application. The same
 *  idea as `preparePlaybackSource` in `player.tsx`: prepare before it is asked
 *  for, not when.
 *
 *  A previous attempt at deferring the updater is worth remembering here — see
 *  the note above its import. It bought nothing, because another module
 *  imported it plainly and it stayed in the main chunk either way. Nothing but
 *  this file imports these three, which is what makes the split real; the build
 *  output is where to check that, and it now lists them by name.
 */
const Detail = lazy(() => import("./Detail"));
const SettingsScreen = lazy(() => import("./Settings"));
/* A type, so it costs nothing at runtime and does not undo the lazy import
   above — this names which tab to open on, it does not load the screen. */
import type { SettingsTab } from "./Settings";
const SetupWizard = lazy(() => import("./SetupWizard"));

/** Fetches the deferred screens once the window has something on it.
 *
 *  Without this the first press of a recording would wait for its chunk, and
 *  the fallback below is `null` — so the screen would blank for as long as that
 *  took. With it the chunk is almost always already there, and the fallback is
 *  the rare case rather than the normal one.
 *
 *  `requestIdleCallback` rather than a timeout, so it lands after the first
 *  paint rather than after a number somebody picked. The timeout is for a
 *  webview old enough not to have it, which this one is not; it costs one line.
 */
function usePreparedScreens() {
  useEffect(() => {
    const fetchThem = () => {
      void import("./Detail");
      void import("./Settings");
      void import("./SetupWizard");
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(fetchThem);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(fetchThem, 200);
    return () => window.clearTimeout(id);
  }, []);
}

const SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mkv", "mov", "webm"];

/** Sources that hold audio and nothing else: saving one in its own format is
 *  a copy rather than a re-encode. Everything else is a video container. */
const AUDIO_ONLY_EXTENSIONS = ["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac", "wma"];

/** What the export can write, in the order the save dialog offers it. */
const AUDIO_EXPORT_FORMATS = ["mp3", "m4a", "wav"];

const AUDIO_FORMAT_LABELS: Record<string, TranslationKey> = {
  mp3: "app.audioFormat.mp3",
  m4a: "app.audioFormat.m4a",
  wav: "app.audioFormat.wav",
};





/** Does the watch folder hold the same files as a moment ago? Compared by
 *  content, because every scan returns a fresh array and the poll runs every
 *  five seconds. The fingerprint carries size and modification time, so a file
 *  rewritten at the same path is a different candidate. */
function sameCandidates(a: WatchFolderCandidate[], b: WatchFolderCandidate[]): boolean {
  return (
    a.length === b.length &&
    a.every((one, i) => one.path === b[i].path && one.fingerprint === b[i].fingerprint)
  );
}

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

/** How long the notice bar stays before it leaves on its own. The countdown
 *  ring in the bar is handed the same number, so the picture and the timer
 *  cannot disagree. */
/** The order the pipeline goes through. Used only to spot a report that
 *  arrives out of turn. */
const PHASE_ORDER = [
  // A run that found another one ahead of it starts here, before it has done
  // anything. Listing it keeps a late report from throwing the caption back to
  // the queue after the work has begun.
  "queued",
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
  const { t, tPlural, tDynamic } = useI18n();
  const labels = useLabels();
  const formats = useFormats();
  usePreparedScreens();
  const [screen, setScreen] = useState<
    "library" | "detail" | "settings" | "wizard"
  >("library");
  const [wizardReturnScreen, setWizardReturnScreen] = useState<"library" | "detail" | "settings">("library");
  /** Which tab Settings opens on when something sent the reader there — the
   *  update notice is the first such thing. Null is the ordinary way in, where
   *  the screen picks up wherever the reader left it. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  /** What the check at start-up found, kept so the notice's button can hand it
   *  over. Told about a waiting version and sent to the tab that offers it, a
   *  reader used to arrive at a panel in its resting state and have to ask for
   *  the same answer again. */
  const [foundUpdate, setFoundUpdate] =
    useState<{ version: string; notes: string } | null>(null);
  /** The first-run question, as a dialog over whatever is on screen.
   *
   *  **It is a separate state and not a fourth `screen`, because it is not a
   *  screen.** It used to be: a required first run replaced the archive with
   *  the wizard, and the reader met an application they had not seen yet by
   *  being shown something else instead. The dialog leaves the archive drawn
   *  behind it — *you have arrived*, with one errand in front of you, rather
   *  than *you are blocked*.
   *
   *  `screen === "wizard"` still exists and is now only ever the by-hand
   *  component listing, which is a page reached from Settings or from a
   *  document asking for its model. That is why `required` can be read straight
   *  off which of the two rendered it, and why `wizardRequired` is gone: it
   *  said the same thing twice and the two could disagree. */
  const [setupOpen, setSetupOpen] = useState(false);
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
  /** Whether the watched folder starts transcribing on its own. Read from the
   *  settings rather than from the archive's own toggle: that one belongs to
   *  files chosen by hand, this one to files that arrive without anybody
   *  looking at the screen. */
  const [watchAuto, setWatchAuto] = useState(false);
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
  /* A download outlives the screen that started it, so the application holds
     it rather than the wizard. Without this, walking out of Settings hid the
     work and the obvious next move was to start it again. */
  const [downloading, setDownloading] = useState<DownloadProgress | null>(null);
  /* Only so the bubble can say which component, by the name the catalogue
     gives it rather than by its id. */
  const [catalogItems, setCatalogItems] = useState<DownloadComponent[]>([]);
  const [liveSegments, setLiveSegments] = useState<Record<string, LiveSegment[]>>({});
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
  const notices = useNotices();
  const reportError = notices.actions.error;
  const reportInfo = notices.actions.info;

  // Rust sends a code, not a sentence; these turn one into the other.
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();
  const [query, setQuery] = useState<ConfirmationRequest | null>(null);
  const [addRecordingOpen, setAddRecordingOpen] = useState(false);

  // Fonts and text size live in the settings, not in CSS, so each person can
  // fit them to their eyes rather than the other way round.
  const automaticRef = useRef(automatic);
  automaticRef.current = automatic;

  const [archiveSetup, setArchiveSetup] = useState({ model: "", watchFolder: "" });
  /* Which view the add dialog opens on. The mini recorder reopens it straight
     on the recorder; every other entry starts at the source cards. */
  const [addRecordingView, setAddRecordingView] = useState<"source" | "microphone">("source");

  const loadAppearance = useCallback(async () => {
    try {
      const settings = await api.loadSettings();
      applyFonts(settings);
      applyTheme(settings.theme);
      setSpeakerSetup({
        separates: settings.diarization,
        count: settings.speaker_count,
      });
      setWatchAuto(settings.watch_folder_enabled && settings.watch_folder_auto);
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

  /* The only thing in the application that reaches a server on its own, and it
     does so only if somebody has said it may. Off by default; see
     `update_check_automatic` in db.rs for why the default is the promise.

     It asks and stops there. A found version is a line in the notice bar
     pointing at Settings, never a download — that press stays the reader's.
     Once per start, never on a timer. */
  const offerUpdate = useCallback(async () => {
    try {
      const settings = await api.loadSettings();
      if (!settings.update_check_automatic) return;
      const update = await checkForUpdate();
      /* The same moment the button on `Aktualizace` writes, from the other way
         of asking: a start that asked must move it, or that row would say
         *nikdy* on a machine checking every morning. Not through the settings
         record — see `UPDATE_CHECKED_AT`. */
      noteUpdateCheck();
      /* The bar carries the way there rather than describing it. It used to
         end *Najdete ji v Nastavení → O aplikaci* — a sentence that was one
         reorganisation away from being wrong, and by the time this was written
         it was: updates have a tab of their own now. A button cannot go stale
         about where it leads.

         It opens the tab and not the download. What is in a version is read
         before it is agreed to, which is what the release notes dialog on that
         tab is for; a start-up bar is the wrong place to begin something that
         closes the application and runs an installer. */
      if (update) {
        setFoundUpdate({ version: update.version, notes: update.body ?? "" });
        reportInfo(t("app.updateAvailable", { version: update.version }), {
          label: t("app.updateOpen"),
          /* No `loadToolCheck()`, unlike the two ordinary ways into Settings.
             That call refreshes the *archive's* view of what is installed, and
             `onComplete` runs it again on the way out; Settings reads its own
             `checkTools` on mount either way. It is also declared below this
             one, so naming it here would be a dependency on a `const` that
             does not exist yet. */
          run: () => {
            setSettingsTab("updates");
            setScreen("settings");
          },
        });
      }
    } catch {
      /* An unreachable server is not worth interrupting a start for. The
         button on the `Aktualizace` tab reports what went wrong; this does
         not. */
    }
  }, [reportInfo, t]);

  const loadRecordings = useCallback(async () => {
    try {
      setRecordings(await api.listRecordings());
    } catch (e) {
      reportError(userMessage(e));
    }
  }, [userMessage]);

  /** Runs the transcriptions once the speaker question is settled. Answers
   *  whether they actually started: the backend refuses a recording another
   *  worker already holds, and a screen that lights itself up on the strength
   *  of the click would then stay lit with nothing behind it. */
  const runTranscription = useCallback(
    async (
      ids: string[],
      language: string | undefined,
      speakerCount: number | null,
      diarizeOnly = false
    ): Promise<boolean> => {
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
      let started = true;
      try {
        for (const id of ids) {
          if (diarizeOnly) await api.diarizeSpeakers(id, speakerCount);
          else if (language) await api.transcribeInLanguage(id, language, speakerCount);
          else await api.startTranscription(id, speakerCount);
        }
      } catch (e) {
        started = false;
        if (diarizeOnly) setDiarizingIds((current) => current.filter((x) => !ids.includes(x)));
        reportError(userMessage(e));
      }
      await loadRecordings();
      return started;
    },
    [loadRecordings, reportError, userMessage]
  );

  /** The single door every transcription goes through. Separating speakers is
   *  the only thing that needs an answer first, so it is the only thing that
   *  stops here; otherwise this is a direct call. */
  const askAboutSpeakers = useCallback(
    async (ids: string[], language?: string) => {
      if (!speakerSetup.separates) {
        return await runTranscription(ids, language, null);
      }
      setPendingTranscription({ ids, language });
      return false;
    },
    [runTranscription, speakerSetup.separates]
  );

  /** Returns whether a run actually started. `false` means a question was
   *  asked first — a screen that lights itself up on the strength of the click
   *  would then stay lit for ever if the answer is Cancel. */
  const beginTranscription = useCallback(
    async (ids: string[], language?: string): Promise<boolean> => {
      if (ids.length === 0) return false;
      /* Nothing stopped a run that could not work.
       *
       * The archive has said *Volocal je skoro připravený* over a missing
       * component since the notice was written, and pressing Transcribe under
       * it started anyway: the interface stated the thing was impossible and
       * then attempted it, so the refusal arrived from the core, minutes later,
       * as a failed transcription. Deleting a component in Nastavení and going
       * straight back is the way in.
       *
       * `check.issues` is read here rather than `blockingIssues`, which is the
       * same list one memo later and is declared five hundred lines below this.
       * The notice is drawn from it too, so the two cannot disagree, and the
       * answer carries the way out rather than only the news. */
      /* **Asked of the disk, not of memory.** `check` is a snapshot taken at
         startup and after a handful of actions, and files can leave underneath
         it: emptying the models folder in Explorer left the application
         believing it was ready, because nothing had told it otherwise.

         It is a few filesystem probes and this is the one moment they matter.
         If the call itself fails the cached answer stands — being unable to ask
         is not evidence that something is missing, and refusing a run on that
         would be worse than attempting one. */
      let missing = check?.issues ?? [];
      try {
        const fresh = await api.checkTools();
        setCheck(fresh);
        /* And told to the same memory the poll reads. Without it the next
           sixty-second check saw `before === 0`, decided something had just
           gone missing, and raised a second bar about the file this refusal had
           already named. */
        knownMissing.current = fresh.issues.length;
        missing = fresh.issues;
      } catch {
        // Keep what we had.
      }
      if (missing.length > 0) {
        reportInfo(t("app.setupFirst"), {
          label: t("library.issues.finish"),
          run: () => setSetupOpen(true),
        });
        return false;
      }
      /* Transcribing again replaces the text, and with it every manual
         correction and every uncertain spot already signed off. Deleting the
         transcript from the same menu asks first; doing it as a side effect of
         starting a new run did not. */
      const finished = ids.filter(
        (id) => recordings.find((r) => r.id === id)?.status === "done"
      );
      if (finished.length > 0) {
        const only = finished.length === 1
          ? recordings.find((r) => r.id === finished[0])
          : undefined;
        setQuery({
          title: t("dialogs.retranscribe.title"),
          text: only
            ? t("dialogs.retranscribe.textOne", {
                title: only.title || fileName(only.path),
              })
            : tPlural("dialogs.retranscribe.textMany", finished.length),
          confirm: t("dialogs.retranscribe.confirm"),
          destructive: true,
          action: () => void askAboutSpeakers(ids, language),
        });
        return false;
      }
      return await askAboutSpeakers(ids, language);
    },
    [askAboutSpeakers, check, recordings, reportInfo, t, tPlural]
  );

  /** Separating speakers on its own. It is entirely about how many people
   *  speak, so it always asks, whatever the settings say. */
  const beginDiarization = useCallback((id: string) => {
    setPendingTranscription({ ids: [id], diarizeOnly: true });
  }, []);

  /** How many things were missing the last time anybody asked.
   *
   *  `null` until the first answer arrives, which is what keeps a first run
   *  quiet: on a machine that has never been set up everything is missing, and
   *  the wizard opens by itself to say so. What this remembers is the other
   *  case — it was all here a minute ago and now it is not. */
  const knownMissing = useRef<number | null>(null);

  /** Whether the graphics card sitting out a run has already been said.
   *
   *  The start-up effect re-runs whenever `t` changes identity — which is every
   *  time the interface language is switched — and *once per launch* has to
   *  mean once, not once per language. The state being reported does not pass:
   *  a build never fetched, a driver that stopped loading. Saying it twice
   *  would be a bar about something the reader has already read. */
  const computeSaid = useRef(false);

  const loadToolCheck = useCallback(async () => {
    try {
      const k = await api.checkTools();
      setCheck(k);
      /* **Say it, rather than only redrawing.** The check has always updated
         the archive's notice silently, so a component deleted while the window
         was open changed a banner nobody was looking at, and the next thing
         that happened was a transcription refusing for reasons that seemed to
         come from nowhere.
         Only on the way from *nothing missing* to *something missing*: repeating
         it on every poll would be a bar that never goes away. */
      const before = knownMissing.current;
      knownMissing.current = k.issues.length;
      if (before === 0 && k.issues.length > 0) {
        reportInfo(t("app.setupBroke"), {
          label: t("settings.modules.add"),
          run: () => setSetupOpen(true),
        });
      }
      return k;
    } catch {
      return null;
    }
  }, [reportInfo, t]);

  /* The archive's notice is drawn from the same check and was equally capable
     of standing there out of date — a folder emptied in Explorer while the
     window sat behind it, and the application still offering to transcribe.

     Coming back to the window is when somebody has most likely just been
     elsewhere doing exactly that, so it is where the question is worth asking
     again. A few probes, once per return, not on a timer. */
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void loadToolCheck();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [loadToolCheck]);

  /* A modest poll for the same reason the watched folder uses one: a permanent
     operating-system watcher on the tools and models folders would fire through
     every download and every unpack — hundreds of events for the one that
     matters — and would have to be told which of them to ignore.

     A minute is slow enough to cost nothing and quick enough that somebody who
     deletes a folder and comes back to the window is told before they try to
     transcribe. Focus covers the common case; this covers the window that was
     never left. */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadToolCheck();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [loadToolCheck]);

  useEffect(() => {
    loadAppearance();
    loadRecordings();
    offerUpdate();
    // With tools missing, showing an empty archive and waiting for the user
    // to find Settings makes no sense. Open the wizard straight away.
    // Names for the download bubble. One call at start-up; the catalogue is a
    // constant list compiled into the backend, not something that changes.
    api.catalog().then(setCatalogItems).catch(() => {});
    loadToolCheck().then(async (k) => {
      // Over the archive rather than instead of it. The reader sees the
      // application they have just installed, with the one question they have
      // to answer standing in front of it.
      if (k && k.issues.length > 0) {
        setSetupOpen(true);
        return;
      }
      /* **The graphics card sitting out a run is said here, once.**
         `choose_compute` substitutes the processor in silence by design, because
         a transcription must run — and a transcription several times slower with
         nothing said reads as how the application is rather than as a stand-in.
         `Výkon` has explained it since 14 August, on a card nobody has a reason
         to open, which is the same thing the setup notice was doing before it
         moved here: *tak to patří do notifikační lišty*.

         Once per launch, at start-up, not on every check. The state it reports
         is not a passing one — a build that was never fetched, a driver that
         stopped loading — so repeating it on the sixty-second poll would be a
         bar that never goes away about something the reader has already read.

         Not while the wizard is open: a first run has not chosen anything yet
         and is about to download the graphics build itself. */
      if (!k) return;
      try {
        const settings = await api.loadSettings();
        if (!computeSaid.current && computeFellBack(settings.compute, k)) {
          computeSaid.current = true;
          reportInfo(t("app.computeFellBack"), {
            label: t("app.computeFellBack.where"),
            run: () => {
              setSettingsTab("performance");
              setScreen("settings");
            },
          });
        }
      } catch {
        // Being unable to ask is not evidence of anything to report.
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRecordings, loadToolCheck]);

  // -------------------------------------------------- transcription events
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
      listen<DownloadProgress>("download:progress", (u) => {
        const next = u.payload;
        /* `complete` here is one component of the bundle finishing, not the
           bundle — only `download:complete` says that. Keeping the last
           component up until then is what stops the bubble flickering off and
           on between files.

           `waiting` is the one that must not take the bubble: it arrives for
           every component put in the queue, including the ones behind the one
           being fetched, and the bubble would have named the last of them at
           0 % while another was at 40. It is the row in the listing that says
           a queued component is queued; here the bubble goes on reporting what
           is actually moving. */
        if (next.phase === "waiting") return;
        /* **Cleared only by the component it is naming.** Stopping a queued row
           while another one downloads used to take the bubble down with it, and
           during an `extracting` phase there are no further ticks to bring it
           back — so the one thing still working reported nothing until it
           finished. */
        if (["error", "cancelled"].includes(next.phase)) {
          setDownloading((current) => (current && current.id !== next.id ? current : null));
          return;
        }
        setDownloading(next);
      })
    );

    add(
      listen<string[]>("download:complete", async (u) => {
        setDownloading(null);
        /* **Nothing writes the chosen model here any more, and nothing
           needs to.** What stood here read a `localStorage` record and wrote
           `settings.model` when the component was absent from this run's list
           of failures - which is not the same question as *did the file
           arrive*. A component that was never part of the run is absent from
           that list too, so an unrelated download finishing could write a
           model that had never landed; a record left by a run interrupted at
           the window closing survived a restart and waited to do exactly that.

           `resolve_transcription_model` in `tools.rs` asks the disk instead,
           every time anything is checked. Choosing a quality records the
           choice; the model that arrives is found because it is there. There
           is no note to keep in step, so there is no note to go stale. */
        loadToolCheck();
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

  // ------------------------------------------------------ dragging files in
  /** Where the person stands in the archive, for the handlers created above
   *  the folder state itself. A recording added by hand belongs to the folder
   *  that is open — the watched folder deliberately does not go through this,
   *  because those files arrive without anybody standing anywhere. */
  const openFolderRef = useRef<string | null>(null);
  const fileIntoOpenFolder = useCallback(
    async (ids: string[]) => {
      const folder = openFolderRef.current;
      if (!folder || ids.length === 0) return;
      try {
        await api.moveToFolder(ids, folder);
      } catch (error) {
        /* The recording is in the archive either way; only its place failed. */
        reportError(userMessage(error));
      }
    },
    [reportError, userMessage]
  );

  /* `acceptFiles` is held by the window's drop listener, so it has to keep one
     identity — and it therefore cannot list `beginTranscription` among its
     dependencies without re-arming that listener on every recording list
     change. A ref gives it the current one, exactly as `automaticRef` does
     beside it. Without this it froze on the first render's callback, which had
     closed over `separates: false`, so a dropped file never asked how many
     people speak while the microphone and the online import both did. */
  const beginTranscriptionRef = useRef(beginTranscription);
  beginTranscriptionRef.current = beginTranscription;

  const acceptFiles = useCallback(
    async (paths: string[]) => {
      const audio = paths.filter((c) => SUPPORTED_EXTENSIONS.includes(c.split(".").pop()?.toLowerCase() ?? ""));
      if (audio.length === 0) {
        reportError(t("app.notice.unsupportedFormat"));
        return;
      }
      let added = 0;
      const fresh: string[] = [];
      for (const c of audio) {
        try {
          const n = await api.addRecording(c);
          added += 1;
          fresh.push(n.id);
          await fileIntoOpenFolder([n.id]);
          // The status changes on the backend side, so the list has to be
          // reloaded. Without it the row keeps looking untranscribed even
          // while a transcription is running.
          await loadRecordings();
        } catch (e) {
          reportError(userMessage(e));
        }
      }
      // One call for the whole drop, after the loop. Per file it would open
      // the speaker question once per recording and each would replace the
      // one before it, so only the last file would ever be transcribed.
      /* Say it out loud (Jakub's ask): from a detail, an added file lands in
         an archive that is not on screen, so without this notice nothing
         visible happens at all. The watched-folder import already says
         exactly this sentence; one meaning, one key.

         **The plain one first, and the transcription one only if a run really
         began.** It used to choose between them on `automatic` — the switch —
         which says what the application would *like* to do rather than what it
         did, so a recording added while the model was still downloading was
         announced with *Volocal zahájil přepis* over a card offering to
         transcribe it.

         Order matters here. If the run is refused, `beginTranscription` puts
         its own message in the bar, and it arrives after this one and stays:
         *why nothing is happening* is more use than *something was added*,
         which the list already shows. */
      if (added > 0) {
        reportInfo(tPlural("app.watchFolder.added", added));
      }
      if (automaticRef.current && fresh.length > 0) {
        const started = await beginTranscriptionRef.current(fresh);
        if (started && added > 0) {
          reportInfo(tPlural("app.watchFolder.transcribing", added));
        }
        await loadRecordings();
      }
    },
    [fileIntoOpenFolder, loadRecordings, reportError, reportInfo, t, tPlural, userMessage]
  );

  useEffect(() => {
    /* A dropped file joins the archive, so the archive is the only screen that
       answers a drag. On a transcript, in Settings or in the by-hand listing
       there is nothing for it to land in, and the overlay promised one all the
       same: a full-window veil offering to transcribe, over a screen that was
       going to send the reader somewhere else to see the result. The listener
       is not registered off the archive, so those screens do not answer a drag
       at all rather than answering it invisibly. */
    if (screen !== "library") {
      // A drag cannot outlive the screen it started on: without this the veil
      // would still be standing on whatever comes next.
      setDragging(false);
      return;
    }
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
  }, [acceptFiles, screen]);

  const selectFile = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: t("app.filePicker.audioAndVideo"), extensions: SUPPORTED_EXTENSIONS }],
    });
    if (!selected) return;
    await acceptFiles(Array.isArray(selected) ? selected : [selected]);
  }, [acceptFiles, t]);

  /* Saving a recording's own audio somewhere findable. Microphone takes and
     downloaded videos live inside the application's data directory, which is
     not a place to send anyone digging — so the archive offers to hand the
     file over. One implementation for both screens; Library and Detail only
     say which recording. */
  /* Folders. The archive shows one level at a time, so `openFolder` is where
     the person stands; a recording moved out of sight of that level is the
     point of the feature rather than a surprise. */
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  useEffect(() => {
    openFolderRef.current = openFolder;
  }, [openFolder]);
  const [folderDialog, setFolderDialog] = useState<
    { mode: "create"; forRecording: string | null } | { mode: "rename"; folder: Folder } | null
  >(null);

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await api.folders());
    } catch (error) {
      reportError(userMessage(error));
    }
  }, [reportError, userMessage]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const submitFolderDialog = useCallback(
    async (name: string) => {
      const request = folderDialog;
      setFolderDialog(null);
      if (!request) return;
      try {
        if (request.mode === "rename") {
          await api.renameFolder(request.folder.id, name);
        } else {
          const created = await api.createFolder(name);
          // Created from a recording's own menu: it goes straight in, which
          // is what the person was doing when they reached for a new folder.
          if (request.forRecording) {
            await api.moveToFolder([request.forRecording], created.id);
            await loadRecordings();
          }
        }
        await loadFolders();
      } catch (error) {
        reportError(userMessage(error));
      }
    },
    [folderDialog, loadFolders, loadRecordings, reportError, userMessage]
  );

  const moveToFolder = useCallback(
    async (id: string, folder: string | null) => {
      try {
        await api.moveToFolder([id], folder);
        await loadRecordings();
        await loadFolders();
      } catch (error) {
        reportError(userMessage(error));
      }
    },
    [loadFolders, loadRecordings, reportError, userMessage]
  );

  const askAboutFolder = useCallback(
    (folder: Folder) => {
      const remove = async (contents: boolean) => {
        try {
          await api.deleteFolder(folder.id, contents);
          setOpenFolder((current) => (current === folder.id ? null : current));
          await loadRecordings();
          await loadFolders();
        } catch (error) {
          reportError(userMessage(error));
        }
      };
      /* Two answers, not one: an empty folder is a plain confirmation, a full
         one asks whether its transcripts go with it. The destructive button
         is the one that destroys; keeping them is the quiet way out. */
      setQuery({
        title: t("dialogs.folder.deleteTitle", { name: folder.name }),
        text: folder.recording_count === 0
          ? t("dialogs.folder.deleteEmpty")
          : tPlural("dialogs.folder.deleteText", folder.recording_count),
        confirm: folder.recording_count === 0
          ? t("common.delete")
          : t("dialogs.folder.deleteAll"),
        destructive: true,
        action: () => void remove(folder.recording_count > 0),
        ...(folder.recording_count > 0
          ? { alternative: { label: t("dialogs.folder.deleteKeep"), action: () => void remove(false) } }
          : {}),
      });
    },
    [loadFolders, loadRecordings, reportError, t, tPlural, userMessage]
  );

  const exportAudio = useCallback(
    async (id: string) => {
      const recording = recordings.find((item) => item.id === id);
      if (!recording) return;
      const source = recording.path.split(".").pop()?.toLowerCase() ?? "";
      const name = (recording.title || fileName(recording.path)).replace(/\.[^.]+$/, "");
      /* An audio-only source keeps its own format first, because that one is
         handed over untouched; a video's audio has to be written out, and
         MP3 is the format nobody has to think about. */
      const offered = AUDIO_ONLY_EXTENSIONS.includes(source)
        ? [source, ...AUDIO_EXPORT_FORMATS.filter((format) => format !== source)]
        : [...AUDIO_EXPORT_FORMATS];
      const destination = await save({
        defaultPath: `${name}.${offered[0]}`,
        filters: offered.map((format) => ({
          name: AUDIO_FORMAT_LABELS[format]
            ? t(AUDIO_FORMAT_LABELS[format])
            : t("app.audioFormat.same", { format: format.toUpperCase() }),
          extensions: [format],
        })),
      });
      if (!destination) return;
      try {
        await api.exportAudio(id, destination);
        reportInfo(t("app.notice.audioSaved", { path: destination }));
      } catch (error) {
        reportError(userMessage(error));
      }
    },
    [recordings, reportError, reportInfo, t, userMessage]
  );

  // -------------------------------------------------- navigation
  const openRecording = useCallback((id: string, time?: number) => {
    setSelectedId(id);
    setSeekTime(time ?? null);
    setScreen("detail");
  }, []);

  /* Where the reader has been, so the mouse's own back and forward buttons
     mean something here. A place is the three things that decide what is on
     screen: which screen, which recording, which folder.
     The list is kept by an effect watching that triple rather than by calling
     something at each of the two dozen places that navigate — one of them
     would be forgotten, and a history with a hole in it is worse than none.
     Travelling sets the index first, so the effect finds the tuple it already
     holds and adds nothing. */
  type Place = { screen: "library" | "detail" | "settings"; recording: string | null; folder: string | null };
  const trail = useRef<Place[]>([{ screen: "library", recording: null, folder: null }]);
  const trailAt = useRef(0);
  /* `travel` is handed to a window listener, so it must not be rebuilt on
     every navigation — it reads the current screen through a ref instead. */
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    /* The wizard is an errand, not a place: it can be required, and walking
       out of it backwards would leave the application unable to transcribe. */
    if (screen === "wizard") return;
    const place: Place = {
      screen,
      // Leaving a detail does not clear the selection, and a library entry
      // that remembers one would differ from the same library without it.
      recording: screen === "detail" ? selectedId : null,
      folder: openFolder,
    };
    const here = trail.current[trailAt.current];
    if (here && here.screen === place.screen && here.recording === place.recording
        && here.folder === place.folder) return;
    trail.current = [...trail.current.slice(0, trailAt.current + 1), place].slice(-60);
    trailAt.current = trail.current.length - 1;
  }, [screen, selectedId, openFolder]);

  const travel = useCallback(
    (step: number) => {
      if (screenRef.current === "wizard") return;
      // A dialog is the top of the stack; the buttons belong to it, not to the
      // screen underneath. Asking the DOM covers every modal without listing
      // them, which is what keeps the next one from being forgotten here.
      if (document.querySelector(".dialog-overlay")) return;
      const place = trail.current[trailAt.current + step];
      if (!place) return;
      trailAt.current += step;
      setScreen(place.screen);
      setSelectedId(place.recording);
      setSeekTime(null);
      setOpenFolder(place.folder);
      if (place.screen === "library") loadRecordings();
    },
    [loadRecordings]
  );

  useEffect(() => {
    const walk = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      travel(event.button === 3 ? -1 : 1);
    };
    /* The press and the click are swallowed as well: WebView2 would otherwise
       do its own history navigation on the same button, and this window has
       exactly one document to go back to — none. */
    const swallow = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };
    window.addEventListener("mouseup", walk);
    window.addEventListener("mousedown", swallow);
    window.addEventListener("auxclick", swallow);
    return () => {
      window.removeEventListener("mouseup", walk);
      window.removeEventListener("mousedown", swallow);
      window.removeEventListener("auxclick", swallow);
    };
  }, [travel]);

  const blockingIssues = useMemo(() => check?.issues ?? [], [check]);
  const player = usePlayer();

  const watch = useWatchFolder({
    automatic: watchAuto,
    beginTranscription,
    runTranscription,
    reload: loadRecordings,
    onError: reportError,
    onInfo: reportInfo,
  });

  const archiveFooterStatus = useMemo(() => {
    const completed = recordings.filter((recording) => recording.status === "done");
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
      segments: recording.status === "done" ? formats.segmentCount(recording.segment_count) : null,
      /* `Uloženo` used to be a constant, lit for every detail — including a
         recording with no transcript at all, where there is nothing saved to
         speak of. It is a statement about a stored document, so it appears
         where one exists. There is no unsaved state to report: every edit is
         written as it is made, which is what makes this a fact rather than a
         progress indicator. */
      saved: recording.status === "done",
    };
  }, [formats, labels, recordings, selectedId]);

  const leaveWizard = useCallback(() => {
    setMissingModule(null);
    loadToolCheck();
    if (wizardReturnScreen === "library") loadRecordings();
    if (wizardReturnScreen === "settings") loadAppearance();
    setScreen(wizardReturnScreen);
  }, [loadAppearance, loadRecordings, loadToolCheck, wizardReturnScreen]);

  /* Finishing is not the same as leaving. `Jdeme přepisovat` promises exactly
     that, so it lands in the Archive whatever screen the wizard was opened
     from — `Zpět` is what returns to the origin. */
  const finishWizard = useCallback(() => {
    setMissingModule(null);
    loadToolCheck();
    loadAppearance();
    loadRecordings();
    setScreen("library");
  }, [loadAppearance, loadRecordings, loadToolCheck]);

  /** Closing the first-run dialog, whichever button did it.
   *
   *  One callback for both `Zavřít` and `Hotovo`, because from out here they
   *  are the same event: the dialog is gone and whatever it downloaded has to
   *  be noticed. There is no screen to return to — the archive was never left —
   *  so this is the whole of it. `loadToolCheck` is what makes the archive's own
   *  band say what is still missing, or stop saying it. */
  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    loadToolCheck();
    loadAppearance();
    loadRecordings();
  }, [loadAppearance, loadRecordings, loadToolCheck]);

  return (
    <div className={`app ${dragging ? "dragging" : ""}`}>
      {screen !== "detail" && (
      <header className="bar">
        <div className="bar-left">
        <button
          className="mark header-brand-mark"
          onClick={() => {
            setScreen("library");
            loadRecordings();
          }}
        >
          {/* One drawing, on every screen this header appears on. The cube and
              the wordmark stood here as a pair, and the wordmark only in the
              archive, because two marks side by side were too much anywhere
              else. There is no pair to ration now: the name closes to `olo™`
              and stays that size, which is what made the cube unnecessary.

              The drawn letterforms rather than the name set in the interface
              font — they carry the smile under the `o` and the ™, neither of
              which type can reproduce — and `currentColor` throughout, so one
              file serves the light theme and the dark one. */}
          <Wordmark label={t("app.name")} />
        </button>

        {/* Back navigation follows the brand and precedes the current screen
            context. The required setup wizard keeps it: an errand nobody can
            leave is worse than one they can, as long as the way back in is
            obvious — and it is, because the Archive says what is missing and
            offers to finish for as long as transcription cannot run. */}
        {(screen !== "library" || openFolder !== null) && (
          <button
            className="button quiet"
            onClick={() => {
              if (screen === "wizard") {
                leaveWizard();
                return;
              }
              /* An open folder is a place inside the archive, so the way out of
                 it is the way out of every other screen: this button. It used
                 to live in the breadcrumb, which meant two different places to
                 look for one idea. */
              if (screen === "library") {
                setOpenFolder(null);
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

        </div>

        <div className="bar-right">
          {/* Sound and recording keep the right edge, beside the actions —
              the same corner of every header, at Jakub's ask. */}
          {player.recordingId && (
            <MiniPlayer
              onOpen={() => {
                if (player.recordingId) openRecording(player.recordingId);
              }}
            />
          )}
          {/* A take minimised out of the dialog. Hidden while the dialog is
              open — the dialog is the same state, larger. */}
          {!addRecordingOpen && (
            <MiniRecorder
              onOpen={() => {
                setAddRecordingView("microphone");
                setAddRecordingOpen(true);
              }}
            />
          )}
          {screen !== "settings" && screen !== "wizard" && (
            <button className="button quiet" onClick={() => {
              setAddRecordingView("source");
              setAddRecordingOpen(true);
            }}>
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
                <path d="M7.5 2v11M2 7.5h11" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {t("app.newTranscript")}
            </button>
          )}
          <button
            className={`button quiet ${blockingIssues.length ? "danger" : ""}`}
            onClick={() => {
              setScreen("settings");
              loadToolCheck();
            }}
          >
            {/* Sliders, not a cog: at 16 px a cog is fine detail nobody can read. */}
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

      <NoticeBar notices={notices} />

      {screen === "library" && (
        <Library
          recordings={recordings}
          progress={progress}
          aiProgress={aiProgress}
          liveSegments={liveSegments}
          issues={blockingIssues}
          fetching={!!downloading}
          watchCandidates={watch.state.candidates}
          watchDecisionRunning={watch.state.deciding}
          onTranscribeWatchCandidates={watch.actions.transcribe}
          onIgnoreWatchCandidates={watch.actions.ignore}
          onAddWatchCandidates={watch.actions.add}
          onOpen={openRecording}
          onExportAudio={exportAudio}
          folders={folders}
          openFolder={openFolder}
          onOpenFolder={setOpenFolder}
          onCreateFolder={() => setFolderDialog({ mode: "create", forRecording: null })}
          onRenameFolder={(folder) => setFolderDialog({ mode: "rename", folder })}
          onDeleteFolder={askAboutFolder}
          onMoveToFolder={(id, folder) => void moveToFolder(id, folder)}
          onCreateFolderFor={(id) => setFolderDialog({ mode: "create", forRecording: id })}
          onDelete={(id) => {
            const n = recordings.find((x) => x.id === id);
            setQuery({
              title: t("app.confirm.removeTitle"),
              /* `title` alone is empty for a recording nobody renamed, and the
                 question then reads "Přepis  bude smazán." Everywhere else
                 the name falls back to the file, and a destructive question
                 is the last place that should stop doing it. */
              text: t("app.confirm.removeText", {
                title: n ? n.title || fileName(n.path) : "",
              }),
              confirm: t("app.confirm.removeAction"),
              destructive: true,
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
              title: t("app.confirm.deleteTranscriptTitle"),
              /* `title` alone is empty for a recording nobody renamed, and the
                 question then reads "Přepis  bude smazán." Everywhere else
                 the name falls back to the file, and a destructive question
                 is the last place that should stop doing it. */
              text: t("app.confirm.deleteTranscriptText", {
                title: n ? n.title || fileName(n.path) : "",
              }),
              confirm: t("app.confirm.deleteTranscriptAction"),
              destructive: true,
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
          onAdd={() => {
            setAddRecordingView("source");
            setAddRecordingOpen(true);
          }}
          onFinishSetup={() => setSetupOpen(true)}
        />
      )}

      {screen === "detail" && selectedId && (
        <Suspense fallback={null}>
          <Detail
            /* A new recording means a new screen. Without a key React would
               reuse the old one, and until the data arrives it would sit there
               showing the previous recording's text, status and waveform. */
            key={selectedId}
            id={selectedId}
            seekTime={seekTime}
            progress={progress[selectedId]}
            liveSegments={liveSegments[selectedId] ?? []}
            onBack={() => {
              setScreen("library");
              loadRecordings();
            }}
            onNew={() => {
              setAddRecordingView("source");
              setAddRecordingOpen(true);
            }}
            onOpenRecorder={() => {
              setAddRecordingView("microphone");
              setAddRecordingOpen(true);
            }}
            onOpenRecording={openRecording}
            onExportAudio={() => void exportAudio(selectedId)}
            folders={folders}
            onMoveToFolder={(folder) => void moveToFolder(selectedId, folder)}
            onCreateFolderFor={() =>
              setFolderDialog({ mode: "create", forRecording: selectedId })
            }
            onSettings={() => {
              setScreen("settings");
              loadToolCheck();
            }}
            onError={reportError}
            onInfo={reportInfo}
            onTranscribe={(id, language) => beginTranscription([id], language)}
            onDiarize={beginDiarization}
            diarizing={diarizingIds.includes(selectedId)}
            onToModule={(module) => {
              setMissingModule(module ?? null);
              setWizardReturnScreen("detail");
              setScreen("wizard");
            }}
          />
        </Suspense>
      )}

      {/* The by-hand component listing, as a page. `required` is false by
          construction here — every way in sets `missingModule` or comes from
          `Spravovat modely a nástroje` — and the wizard reads it to know it is
          drawing a page rather than the first-run dialog. */}
      {screen === "wizard" && (
        <Suspense fallback={null}>
          <SetupWizard
            required={false}
            missingModule={missingModule}
            onBack={leaveWizard}
            onComplete={finishWizard}
            onError={reportError}
            alreadyFetching={!!downloading}
          />
        </Suspense>
      )}

      {screen === "settings" && (
        <Suspense fallback={null}>
          <SettingsScreen
            /* Cleared on the way out so the next manual visit is a manual
               visit again — otherwise one press on an update notice would fix
               where Settings opens for good. */
            initialTab={settingsTab ?? undefined}
            foundUpdate={foundUpdate}
            /* Which component, not just whether something is coming down: a
               card saying *stahuje se…* has to mean this one. */
            fetchingComponent={downloading?.id ?? ""}
            fetching={!!downloading}
            onComplete={() => {
              loadToolCheck();
              loadAppearance();
              setSettingsTab(null);
              setScreen("library");
            }}
            onError={reportError}
            onInfo={reportInfo}
            onToModule={(module) => {
              setMissingModule(module ?? null);
              setWizardReturnScreen("settings");
              setScreen("wizard");
            }}
          />
        </Suspense>
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
              {detailFooterStatus?.saved && (
                <FooterStatusItem
                  kind="saved"
                  value={t("common.saved")}
                  label={t("app.shell.documentState")}
                />
              )}
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

      {/* The first run, over whatever is behind it — which is the archive,
          because that is where a fresh installation lands. It is rendered here
          with the other dialogs rather than among the screens, since that is
          what it is; `setupOpen` and `screen === "wizard"` are never both true,
          the first being the guided question and the second the by-hand list. */}
      {setupOpen && (
        <Suspense fallback={null}>
          <SetupWizard
            required
            missingModule={null}
            onBack={closeSetup}
            onComplete={closeSetup}
            onError={reportError}
            alreadyFetching={!!downloading}
          />
        </Suspense>
      )}

      {addRecordingOpen && (
        <AddRecordingDialog
          initialView={addRecordingView}
          onClose={() => setAddRecordingOpen(false)}
          onLocalFile={() => {
            setAddRecordingOpen(false);
            selectFile();
          }}
          onRecorded={(recording, transcribe) => {
            setAddRecordingOpen(false);
            void (async () => {
              try {
                await fileIntoOpenFolder([recording.id]);
                // Through the same gate as every other start, so the speaker
                // question and the busy guard apply to a fresh take too.
                if (transcribe) await beginTranscription([recording.id]);
                await loadRecordings();
                reportInfo(
                  transcribe
                    ? t("app.notice.recordingAddedTranscribing")
                    : t("app.notice.recordingAdded")
                );
              } catch (error) {
                await loadRecordings();
                reportError(userMessage(error));
              }
            })();
          }}
          onImported={(recording) => {
            setAddRecordingOpen(false);
            void (async () => {
              try {
                await fileIntoOpenFolder([recording.id]);
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

      <NameDialog
        open={folderDialog !== null}
        title={t(
          folderDialog?.mode === "rename"
            ? "dialogs.folder.renameTitle"
            : "dialogs.folder.createTitle"
        )}
        text={t("dialogs.folder.text")}
        label={t("dialogs.folder.label")}
        placeholder={t("dialogs.folder.placeholder")}
        submitLabel={t(folderDialog?.mode === "rename" ? "common.save" : "dialogs.folder.create")}
        initialName={folderDialog?.mode === "rename" ? folderDialog.folder.name : ""}
        onClose={() => setFolderDialog(null)}
        onSubmit={(name) => void submitFolderDialog(name)}
      />

      {/* Not on the wizard: that screen lists every component with its own
          progress, and a bubble repeating one of them would be noise. */}
      {downloading && screen !== "wizard" && (
        <ProgressBubble
          variant="download"
          description={t("app.download.running", {
            name:
              catalogItems.find((item) => item.id === downloading.id)?.name_code
                ? tDynamic(
                    catalogItems.find((item) => item.id === downloading.id)!.name_code,
                    downloading.id
                  )
                : downloading.id,
          })}
          percent={downloading.percent}
          /* The one it names, not the queue behind it. The bubble says
             *Stahuji {name}*, so its cross has to mean that one — stopping
             four more the reader cannot see from here would be a control
             doing more than it says. */
          onCancel={() => {
            void api.cancelComponent(downloading.id);
            setDownloading(null);
          }}
          cancelLabel={t("app.download.cancel")}
        />
      )}

      <ConfirmationDialog
        query={query}
        onClose={() => setQuery(null)}
        onError={reportError}
      />

      {pendingTranscription && (
        <SpeakerCountDialog
          recordingCount={pendingTranscription.ids.length}
          suggested={speakerSetup.count}
          onCancel={() => setPendingTranscription(null)}
          onConfirm={(speakerCount, names) => {
            const pending = pendingTranscription;
            setPendingTranscription(null);
            rememberSpeakerNames(pending.ids, names);
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
        <div className="drag-overlay">
          <div className="overlay-content">
            <div className="overlay-icon">↓</div>
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
