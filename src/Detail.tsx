import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import { api } from "./api";
import InfoNote from "./InfoNote";
import PlaybackControls from "./PlaybackControls";
import ConfirmationDialog from "./ConfirmationDialog";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import RecordingActionsMenu from "./RecordingActionsMenu";
import NameDialog from "./NameDialog";
import Select from "./Select";
import { LineIcon, type LineIconName } from "./icons";
import { changedWords } from "./transcriptText";
import { Wordmark } from "./Brand";
import {
  EMPTY_WAVEFORM,
  MiniPlayer,
  loadWaveform,
  preparePlaybackSource,
  usePlayer,
  usePlayerTime,
} from "./player";
import { MiniRecorder } from "./recorder";
import type { Waveform } from "./player";
import { useI18n } from "./i18n";
import { localMessage, useProgressMessage, useUserMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import { useLabels } from "./labels";
import { useDialog } from "./useDialog";
import {
  EDITOR_MODELS,
  EDITOR_TIER,
  UNOFFERED_COMPONENTS,
  formatTime,
  fileName,
  qualityChoice,
  statusClass,
} from "./types";
import { useFormats } from "./formats";
import { useProgressiveList } from "./progressiveList";
/* The transcript screen's own parts. They were all in this file until it had
   grown to 3 688 lines; each of these is a piece somebody reads on its own. */
import {
  DiscardIcon,
  DocumentSaveMenu,
  DocumentViewIcon,
  EXPORT_FORMATS,
  RegenerateIcon,
  SUMMARY_LENGTHS,
  SUMMARY_LENGTH_KEYS,
  TRANSLATION_LANGUAGES,
  ExportMenu,
} from "./detail/documents";
import { ClipboardRefused, copyPlainText } from "./detail/clipboard";
import type {
  ExportFormat,
  PreviewTab,
  SummaryLength,
  TranslationLanguage,
} from "./detail/documents";
import {
  PlayMark,
  SIDEBAR_SECTIONS,
  SidebarEmpty,
  SidebarSection,
  readOpenSections,
} from "./detail/sidebar";
import type { SidebarOpenSections, SidebarSectionName } from "./detail/sidebar";
import { transcriptKey } from "./detail/keys";
import { TranscriptSearch } from "./detail/TranscriptSearch";
import { TranscriptTips } from "./detail/TranscriptTips";
import { DetailProgress } from "./detail/DetailProgress";
import { NotesSection } from "./detail/NotesSection";
import { useRecordingNotes } from "./detail/useRecordingNotes";
import { SpeakersSection } from "./detail/SpeakersSection";
import { useSpeakerManagement } from "./detail/useSpeakerManagement";
import { ReviewSections } from "./detail/ReviewSections";
import { useTranscriptEditing } from "./detail/useTranscriptEditing";
import { useTranscriptSearch } from "./detail/useTranscriptSearch";
import { MENU_ICONS, TranscriptContextMenu } from "./detail/TranscriptContextMenu";
import type { TranscriptMenuItem } from "./detail/TranscriptContextMenu";
import { SegmentRow } from "./detail/corrections";
import type {
  AiCustomDocument,
  AiDocument,
  AiEditProgress,
  AiOutput,
  Speaker,
  Segment,
  TranscriptionProgress,
  LiveSegment,
  RecordingNote,
  Folder,
} from "./types";

/**
 * One document in the preview window.
 *
 * Five tabs showed the same four lines each — split on blank lines, one
 * paragraph per piece — and the scroll listener that the fade above needs would
 * have been a sixth copy of the same thing. Splitting text into paragraphs is
 * one decision and belongs in one place.
 */
function PreviewText({
  text,
  onScrolled,
}: {
  text: string;
  onScrolled: (scrolled: boolean) => void;
}) {
  return (
    <article
      className="ai-preview-text"
      onScroll={(event) => onScrolled(event.currentTarget.scrollTop > 0)}
    >
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </article>
  );
}

interface Props {
  id: string;
  seekTime: number | null;
  progress?: TranscriptionProgress;
  liveSegments: LiveSegment[];
  onBack: () => void;
  onNew: () => void;
  /** Opens the add dialog straight on the recorder view. */
  onOpenRecorder: () => void;
  /** Travels to another recording's detail — the mini player's click. */
  onOpenRecording: (recordingId: string) => void;
  /** Hands this recording's audio file over to a place of the user's choosing. */
  onExportAudio: () => void;
  folders: Folder[];
  onMoveToFolder: (folder: string | null) => void;
  onCreateFolderFor: () => void;
  onSettings: () => void;
  onError: (z: string) => void;
  /** A confirmation, not a fault. Shown in the calm colour. */
  onInfo: (z: string) => void;
  /** Opens module management when local language editing is not installed. */
  onToModule: (module?: string) => void;
  /** Transcription is started through the shell, which asks about speakers
   *  first when they are being separated. Detail must not call the backend
   *  directly, or that question would be skipped from this screen. */
  /** Answers whether a run actually started, so this screen only shows itself
   *  as busy when something is. A question may be asked first. */
  onTranscribe: (id: string, language?: string) => Promise<boolean>;
  /** Speaker separation also goes through the shell, which asks how many
   *  people speak before it starts. */
  onDiarize: (id: string) => void;
  /** Owned by the shell, because the run is asked for there and its first
   *  progress event arrives a moment later. */
  diarizing: boolean;
}


export default function Detail({
  id,
  seekTime,
  progress,
  liveSegments,
  onBack,
  onNew,
  onOpenRecorder,
  onOpenRecording,
  onExportAudio,
  folders,
  onMoveToFolder,
  onCreateFolderFor,
  onSettings,
  onError,
  onInfo,
  onToModule,
  onTranscribe,
  onDiarize,
  diarizing,
}: Props) {
  const { t, tPlural } = useI18n();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();
  const labels = useLabels();
  /** For the one sentence that names how large the language editor is. */
  const { dataSize } = useFormats();
  const [title, setTitle] = useState("");
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("");
  /** Which folder holds this recording, so its menu can offer to move it. */
  const [folder, setFolder] = useState<string | null>(null);
  /** Why the last transcription failed. Only set when status is "error". */
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [aiDocument, setAiDocument] = useState<AiDocument | null>(null);
  const [aiOutputs, setAiOutputs] = useState<AiOutput[]>([]);
  /** Everything this recording has been asked for in somebody's own words,
   *  each row keyed by the instruction that produced it. */
  const [aiCustomDocuments, setAiCustomDocuments] = useState<AiCustomDocument[]>([]);
  /** The instruction in the field right now. It arrives from Settings, where
   *  the last one written was kept, and goes back there as it is typed. */
  const [customPrompt, setCustomPrompt] = useState("");
  /** What Settings last said, so typing is told apart from loading. */
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiEditProgress | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  /* `aiModel` stood here — which language-editing model was resolved on disk.
     Its only reader was the missing-model dialog, which used it to guess which
     of three tiers to ask the component list for. Nothing asks which any more. */
  const [aiReady, setAiReady] = useState(false);
  /** Whether the speaker-separation tools are installed. Its card offers to
   *  fetch them when they are not, rather than failing on the way out. */
  const [speakersReady, setSpeakersReady] = useState(false);
  const [aiDialog, setAiDialog] = useState<"configure" | "preview" | "missing" | null>(null);
  /** The offer made after this computer failed to start the chosen editor
   *  model: which smaller one there is, and whether it is already here.
   *
   *  **Nothing is guessed and nothing is switched.** `tools.rs` says beside
   *  `memory_gb` that nothing decides anything by it, *because nothing here has
   *  ever measured what a model needs* — so this does not weigh the machine
   *  against a number somebody invented. It waits for the model to fail to
   *  load, which is a measurement, and then offers. The press is the reader's,
   *  which is what makes changing their setting theirs. */
  const [smallerOffer, setSmallerOffer] = useState<{
    smaller: string;
    installed: boolean;
  } | null>(null);
  /** What was last asked of the language model, so the offer can carry the run
   *  over rather than switching the setting and leaving somebody to press the
   *  same button again. The arguments and not a closure: the two functions that
   *  start a run cannot name themselves from inside their own bodies. */
  const lastRun = useRef<
    | { kind: "edit"; mode: "faithful" | "clean" }
    | { kind: "output"; output: "summary" | "translation" | "custom"; variant: string }
    | null
  >(null);
  /** What language editing would cost on this machine, worked out the moment
   *  somebody first wants a document: which components are missing and how many
   *  megabytes that is. Which model is not among the questions — the size
   *  follows the one answer given in the wizard. */
  const [editorOffer, setEditorOffer] = useState<{
    ids: string[];
    megabytes: number;
    model: string;
  } | null>(null);
  /** The offer was accepted and the download is running behind this screen.
   *  Asking a second time would be asking twice; the dialog says so instead. */
  const [editorDownloading, setEditorDownloading] = useState(false);
  /* Three modals, three traps. They were the four dialogs Escape did nothing
     in — closable only by clicking the overlay, which is not a thing the
     keyboard can do. One `useDialog` each, because a hook cannot live inside
     the conditional that renders them. */
  const closeAiDialog = useCallback(() => setAiDialog(null), []);
  const missingDialog = useDialog<HTMLDivElement>(closeAiDialog, aiDialog === "missing");
  const configureDialog = useDialog<HTMLDivElement>(closeAiDialog, aiDialog === "configure");
  const previewDialog = useDialog<HTMLDivElement>(closeAiDialog, aiDialog === "preview");
  const smallerDialog = useDialog<HTMLDivElement>(
    useCallback(() => setSmallerOffer(null), []),
    !!smallerOffer
  );
  /* Two, not three. `custom` was one of these while the instruction stood in
     the same dialog; it is a document made *from* the improved transcript now,
     so it is not a way of making one. */
  const [aiMode, setAiMode] = useState<"faithful" | "clean">("faithful");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("improved");
  /** Whether the document under the toolbar has been scrolled at all. The strip
   *  that dissolves the text into the controls above it is only right while
   *  something is actually passing underneath — the archive's own fade carries
   *  the same argument, and there it is the first row of a folder that a
   *  permanent band would blur. */
  const [previewScrolled, setPreviewScrolled] = useState(false);
  /* Each tab mounts its own article at the top, and the flag belongs to the
     document being read rather than to the window. Without this, opening a
     scrolled tab and switching leaves the fade over a document that starts at
     its first line. */
  useEffect(() => setPreviewScrolled(false), [previewTab]);
  const [summaryLength, setSummaryLength] = useState<SummaryLength>("standard");
  const [translationLanguage, setTranslationLanguage] =
    useState<TranslationLanguage>("en");
  const [originalPreview, setOriginalPreview] = useState("");

  // The player is shared across the app so sound survives leaving this
  // screen. Opening another transcript does not touch it — until you press
  // play, whatever was playing keeps playing.
  const player = usePlayer();
  // Asked for separately from the player: this is the one screen that follows
  // the clock, and it is what makes the tick worth paying for here.
  const playerTime = usePlayerTime();

  /* The player pill compacts by measurement, not by a window-width guess
     (which shrank it with visible room to spare): it gives up its words the
     moment the recording's name starts losing letters, and grows back once
     the name is whole again with the pill's full width to spare. The two
     conditions cannot chase each other — expanding needs ~25 px more than
     compacting frees. */
  const headerLeftRef = useRef<HTMLDivElement | null>(null);
  const [pillsCompact, setPillsCompact] = useState(false);
  const pillsCompactRef = useRef(false);
  pillsCompactRef.current = pillsCompact;

  useEffect(() => {
    const left = headerLeftRef.current;
    if (!left) return;
    /* The full pill is 290, the compact one 83; expanding costs the
       difference, plus breathing room so the pair of rules cannot flap. */
    const EXPAND_NEED = 232;
    const measure = () => {
      const name = left.querySelector<HTMLElement>(".detail-name");
      if (!name) return; // renaming — the span is an input right now
      const clipped = name.scrollWidth > name.clientWidth + 1;
      if (!pillsCompactRef.current) {
        if (clipped) setPillsCompact(true);
        return;
      }
      /* The left column stretches, so its free room is the gap between its
         last piece of content and its own right edge. */
      const children = Array.from(left.children) as HTMLElement[];
      const last = children[children.length - 1];
      if (!last) return;
      const slack =
        left.getBoundingClientRect().right - last.getBoundingClientRect().right;
      if (!clipped && slack > EXPAND_NEED) setPillsCompact(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(left);
    return () => observer.disconnect();
    /* `title` re-arms it: a rename changes the name's width without changing
       the observed column's box, so the observer alone would sleep through it. */
  }, [title]);
  const isCurrentRecording = player.recordingId === id;
  // Cursor in a transcript that does not own the audio yet.
  const [localTime, setLocalTime] = useState(0);
  const time = isCurrentRecording ? playerTime : localTime;
  const isPlaying = isCurrentRecording && player.isPlaying;
  // The duration in the database comes from ffprobe at import time and may be
  // unknown. Once audio plays, the player knows it exactly — and without it
  // the played ratio would be zero, so neither ring nor handle would render.
  const trackDuration = isCurrentRecording && player.duration > 0 ? player.duration : duration;

  // The screen loads the waveform itself rather than through the player. The
  // player only knows the one currently playing, so the waveform would appear
  // only after pressing play, leaving an empty track under the slider.
  const [waveform, setWaveform] = useState<Waveform>(EMPTY_WAVEFORM);
  useEffect(() => {
    let disposed = false;
    setWaveform(EMPTY_WAVEFORM);
    loadWaveform(id, setWaveform, () => disposed);
    return () => {
      disposed = true;
    };
  }, [id]);

  // Everything the handlers need comes from a ref, not from dependencies.
  //
  // The player context value changes on every tick of the clock. Were `seek`
  // to depend on it, that function would change several times a second — and
  // since every transcript segment receives it, none of them would pass the
  // `memo` comparison and the whole transcript would repaint over and over.
  // On an hour-long sermon that is a thousand segments and twenty thousand
  // elements per tick.
  const current = useRef({ isCurrentRecording, player, id, path, title, duration, localTime });
  current.current = { isCurrentRecording, player, id, path, title, duration, localTime };

  /**
   * Jump to a position in the recording.
   *
   * When the audio belongs to this recording it simply moves. When it does
   * not, the player takes the recording over and starts it there — clicking a
   * word is an instruction, not an accident, and waiting for the play button
   * afterwards makes no sense. The quiet variant, which only moves the cursor,
   * is used where audio should not start: dragging the slider, and arriving
   * from search.
   */
  const seek = useCallback((t: number, silently = false) => {
    const s = current.current;
    if (s.isCurrentRecording) {
      s.player.seek(t);
    } else if (!silently && s.path) {
      s.player.start(s.id, s.path, s.title, s.duration, Math.max(0, t));
    } else {
      setLocalTime(Math.max(0, t));
    }
  }, []);

  const updateCursor = useCallback((t: number) => seek(t, true), [seek]);

  /** Moves to a position and makes sure the audio is running.
   *
   *  `seek` deliberately stays quiet when the recording is already loaded,
   *  because stepping through uncertain places is reading. A note's timestamp
   *  is the opposite: it is asked for in order to hear that moment. */
  const playFrom = useCallback((t: number) => {
    const s = current.current;
    if (s.isCurrentRecording) {
      s.player.seek(t);
      if (!s.player.isPlaying) s.player.togglePlayback();
    } else if (s.path) {
      s.player.start(s.id, s.path, s.title, s.duration, Math.max(0, t));
    } else {
      setLocalTime(Math.max(0, t));
    }
  }, []);

  const togglePlayback = useCallback(() => {
    const s = current.current;
    if (s.isCurrentRecording) s.player.togglePlayback();
    else if (s.path) s.player.start(s.id, s.path, s.title, s.duration, s.localTime);
  }, []);
  /** The strip of shortcuts under the player. Useful the first few times and
   *  then just a line of text in the way, so it is dismissed here — and brought
   *  back here, by a button that appears in the player's row only once the strip
   *  is gone.
   *
   *  Settings used to carry `Zobrazovat tipy nad přepisem`, and it was right to
   *  delete it: a switch on another screen undoing a press made on this one is a
   *  setting for a decision nobody revisits. What was wrong was leaving the press
   *  with no way back at all — the entry that removed the switch called that "the
   *  trade", and it is not one anybody needs to make. The way back belongs where
   *  the thing disappeared, and it costs nothing while the strip is up because it
   *  is not drawn then.
   *
   *  Kept in `localStorage` beside the panel's own preference rather than in the
   *  database: it is a habit of this machine, not of the archive. */
  // The panel is remembered between recordings: whoever closes it wants quiet.
  const [openSections, setOpenSections] = useState<SidebarOpenSections>(readOpenSections);
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem("panel") !== "zavreny"
  );
  // The source file may have been deleted after transcription — the text
  // stays in the database, but there is nothing to play.
  const [sourceMissing, setSourceMissing] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- loading
  // Everything is gathered first and only then written to state.
  //
  // State used to be set piecemeal between `await`s, which on an hour-long
  // transcript meant three consecutive renders of a thousand-segment list.
  // Neither the dictionary nor the file check needs to wait for the segments;
  // both can be fetched alongside them.
  const load = useCallback(async () => {
    try {
      const d = await api.detail(id);
      // The transcription pipeline prepares the precise MP3 playback copy
      // itself. Starting the detail prewarm as well would run a second ffmpeg
      // conversion for the same source. Finished and legacy recordings still
      // use this best-effort fallback when their cache does not exist yet.
      if (d.recording.status !== "transcribing") {
        preparePlaybackSource(id, d.recording.path);
      }
      const [dictionaryEntries, exists, aiStatus, settings, tools] = await Promise.all([
        api.dictionary(),
        api.fileExists(d.recording.path),
        api.aiEditStatus(id),
        api.loadSettings(),
        api.checkTools(),
      ]);
      setTitle(d.recording.title);
      setPath(d.recording.path);
      setDuration(d.recording.duration);
      setStatus(d.recording.status);
      setFolder(d.recording.folder);
      setError(d.recording.error ? userMessage(d.recording.error) : null);
      setLanguage(d.recording.language);
      setSegments(d.segments);
      speakers.actions.receive(d.speakers);
      notes.actions.receive(d.notes);
      editing.actions.receiveDictionary(dictionaryEntries);
      setSourceMissing(!exists);
      setAiDocument(aiStatus.document);
      setAiOutputs(aiStatus.outputs);
      setAiCustomDocuments(aiStatus.custom);
      setAiRunning(aiStatus.running);
      setAiConfigured(!!settings.editor_model);
      setAiReady(!!settings.editor_model && tools.issues_editor.length === 0);
      setSpeakersReady(tools.issues_diarization.length === 0);
      if (aiStatus.running) {
        setAiProgress(aiStatus.progress ?? {
          recording_id: id,
          phase: "preparing",
          percent: 2,
          description: localMessage(t("detail.progress.preparingModel")),
        });
      }
    } catch (e) {
      onError(userMessage(e));
    }
  }, [id, onError, t, userMessage]);

  useEffect(() => {
    load();
  }, [load]);

  /* The instruction is not remembered between recordings — *v okně vlastního
     promptu mi zůstalo tohle, měl by se pokaždé vyresetovat*.
     
     It used to be written back to Settings as it was typed and read again on
     every transcript, so that four sentences somebody thought better of were not
     lost by closing the dialog. That protection was real and it is kept where it
     belongs: `customPrompt` is state on this screen, so the draft still survives
     opening and closing the window. What it stops surviving is the recording it
     was written for — and an instruction about one interview standing over
     another is worse than retyping it, because it can be run by accident.

     `settings.custom_prompt` is no longer read or written from here. The column
     stays in the record: removing it is a migration, and it buys nothing today. */

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<AiEditProgress>("ai-edit:progress", (event) => {
      if (!active || event.payload.recording_id !== id) return;
      setAiProgress(event.payload);
      const terminal = ["complete", "error", "cancelled"].includes(event.payload.phase);
      setAiRunning(!terminal);
      if (event.payload.phase === "complete") {
        api.aiEditStatus(id).then((status) => {
          if (!active) return;
          setAiDocument(status.document);
          setAiOutputs(status.outputs);
          setAiCustomDocuments(status.custom);
          setAiDialog("preview");
        });
      } else if (event.payload.phase === "error") {
        /* These two are the machine saying it could not hold the model: the
           server died while loading, or never answered `/health` at all. They
           are already distinct from a missing binary and from a server that
           fell over mid-answer, so nothing new had to be measured to tell them
           apart — the names were there.

           Everything else is reported the ordinary way. A notice for a fault
           somebody can do nothing about is right; a dialog for it would be a
           second thing to dismiss. */
        const code = event.payload.description.code;
        if (code === "ai.model_load_timeout" || code === "ai.server_exited_while_loading") {
          void (async () => {
            try {
              const [components, settings] = await Promise.all([
                api.catalog(),
                api.loadSettings(),
              ]);
              const ladder = Object.keys(EDITOR_MODELS);
              const at = ladder.findIndex((tier) => EDITOR_MODELS[tier] === settings.editor_model);
              /* Everything below the one that failed, and the first of those
                 that is offered at all — `editor-model-balanced` is in
                 `UNOFFERED_COMPONENTS` and must not be proposed by name here
                 when nothing else proposes it. */
              const smaller = ladder
                .slice(at + 1)
                .find((tier) => !UNOFFERED_COMPONENTS.includes(tier));
              if (at === -1 || !smaller) {
                onError(progressMessage(event.payload.description));
                return;
              }
              setSmallerOffer({
                smaller,
                installed: !!components.find((item) => item.id === smaller)?.complete,
              });
            } catch {
              /* The offer could not be worked out, so the fault is reported as
                 it would have been. Never nothing: a run that stopped must say
                 so however this goes. */
              onError(progressMessage(event.payload.description));
            }
          })();
        } else {
          onError(progressMessage(event.payload.description));
        }
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [id, onError, progressMessage]);

  /* The language editor landing while this screen is open. Nothing else on it
     depends on a download, so the listener exists only while one of ours is
     running — and if the reader walks away before it finishes, the setting was
     already written and the next visit reads the files off the disk. */
  useEffect(() => {
    if (!editorDownloading) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    listen("download:complete", () => {
      if (!active) return;
      setEditorDownloading(false);
      void load();
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [editorDownloading, load]);

  // Events can be emitted between starting the backend thread and resolving
  // the invoke call. Polling the small status object keeps the displayed phase
  // truthful even when that first event raced past the WebView listener.
  useEffect(() => {
    if (!aiRunning) return;
    let active = true;
    const refresh = async () => {
      try {
        const status = await api.aiEditStatus(id);
        if (!active) return;
        setAiRunning(status.running);
        if (status.progress) setAiProgress(status.progress);
        if (status.document) setAiDocument(status.document);
        setAiOutputs(status.outputs);
      } catch {
        /* The event listener still reports terminal errors. */
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [aiRunning, id]);

  // Reload after every terminal transcription state. Completion, cancellation,
  // and failure all change the persisted recording status behind this screen.
  useEffect(() => {
    if (["complete", "cancelled", "error"].includes(progress?.phase ?? "")) load();
  }, [progress?.phase, load]);

  // ---------------------------------------------------------------- player
  // Jump to the spot this screen was opened for, coming from search.
  //
  // Going through a ref is deliberate. The player context value changes on
  // every tick, and the seek function changes with it. Were it in the
  // dependencies, running audio would tear down and re-arm this effect
  // constantly — and the deferred jump would never get its turn.
  useEffect(() => {
    if (seekTime == null) return;
    // A short delay waits for the segments to render; without them there is
    // nowhere to scroll. Quietly: arriving from search should place the
    // cursor, not start playback.
    const t = setTimeout(() => updateCursor(seekTime), 200);
    return () => clearTimeout(t);
  }, [seekTime, updateCursor]);

  // When playback moves elsewhere, the cursor stays where it left off.
  //
  // Through a ref, and that is the whole point: the effect must not re-run
  // eight times a second, so a cleanup reading the clock directly would close
  // over whatever it said when this recording *took* the audio over — the
  // moment it started, not the moment it stopped.
  const lastPlayedTime = useRef(0);
  if (isCurrentRecording) lastPlayedTime.current = playerTime;
  useEffect(() => {
    if (!isCurrentRecording) return;
    return () => setLocalTime(lastPlayedTime.current);
  }, [isCurrentRecording]);

  // -------------------------------------------------------------- the keyboard
  const goTo = useCallback(
    (segment: Segment) => {
      // Quietly: stepping through uncertain spots is reading, not listening.
      updateCursor(segment.start);
      document
        .getElementById(`segment-${segment.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [updateCursor]
  );

  /* An interjection is clicked in order to *hear* it — a third of a second of
     text says nothing about whose voice it is. Same reasoning as a note's time
     chip, and the opposite of `goTo`, which stays quiet because stepping
     through uncertain spots is reading. */
  const hear = useCallback(
    (segment: Segment) => {
      document
        .getElementById(`segment-${segment.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      playFrom(segment.start);
    },
    [playFrom]
  );

  /* Finding a word in this transcript. The whole of it — the bar, the hits and
     the cursor between them — lives in `useTranscriptSearch`; what stays here
     is the keyboard, which belongs to the screen. */
  const search = useTranscriptSearch(segments);

  const editing = useTranscriptEditing({
    recordingId: id,
    segments,
    updateSegments: setSegments,
    onError,
    onInfo,
    markAiStale: () =>
      setAiDocument((document) => (document ? { ...document, stale: true } : null)),
    reload: load,
  });

  const goToNextUncertain = useCallback(() => {
    if (editing.state.uncertain.length === 0) return;
    goTo(editing.state.uncertain.find((s) => s.start > time + 0.05) ?? editing.state.uncertain[0]);
  }, [editing.state.uncertain, time, goTo]);


  /** Plays from a moment and brings the transcript with it. The position
   *  played is the one asked for, not the start of the block that happens to
   *  contain it. Given to the notes, which is the only thing that asks. */
  const goToMoment = useCallback((moment: number) => {
    const exact = segments.find((segment) => segment.start <= moment && moment < segment.end);
    const previous = [...segments].reverse().find((segment) => segment.start <= moment);
    const target = exact ?? previous;
    if (target) {
      document
        .getElementById(`segment-${target.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    playFrom(moment);
  }, [playFrom, segments]);

  /** Opens the notes section and the panel, so a note begun from the transcript
   *  arrives somewhere the reader can see it. Both are the screen's state, so
   *  the notes ask for it rather than reaching in. */
  const revealNotes = useCallback(() => {
    setOpenSections((current) => {
      const next = { ...current, notes: true };
      localStorage.setItem("sidebar-sections", JSON.stringify(next));
      return next;
    });
    setPanelOpen((open) => {
      if (!open) localStorage.setItem("panel", "otevreny");
      return true;
    });
  }, []);

  const notes = useRecordingNotes({
    recordingId: id,
    duration,
    seekTo: goToMoment,
    reveal: revealNotes,
    onError,
    reload: load,
  });

  /** Opens the speakers section, for a voice made from the transcript. */
  const revealSpeakers = useCallback(() => {
    setOpenSections((s) => ({ ...s, speakers: true }));
  }, []);

  const speakers = useSpeakerManagement({
    recordingId: id,
    segments,
    updateSegments: setSegments,
    playFrom,
    onError,
    markAiStale: () =>
      setAiDocument((document) => (document ? { ...document, stale: true } : null)),
    reveal: revealSpeakers,
    reload: load,
    progressPhase: progress?.phase,
  });


  const toggleSection = useCallback((name: SidebarSectionName) => {
    setOpenSections((current) => {
      const next = { ...current, [name]: !current[name] };
      localStorage.setItem("sidebar-sections", JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      /* What the press means is decided in `detail/keys.ts`, where it can be
         read and tested on its own. Everything gathered here is what only the
         live window knows. */
      const response = transcriptKey(e, {
        finding: search.state.open,
        hits: search.state.total,
        isTyping: Boolean(
          target &&
            (target.tagName === "TEXTAREA" ||
              target.tagName === "INPUT" ||
              target.isContentEditable)
        ),
        onAControl:
          target?.closest("button, a[href], select, summary, [role='button'], [tabindex]") != null,
        dialogOpen: document.querySelector(".dialog-overlay") != null,
      });
      if (!response) return;
      if (response.preventDefault) e.preventDefault();

      switch (response.act) {
        case "openFind":
          search.actions.open();
          search.state.field.current?.select();
          break;
        case "closeFind":
          search.actions.close();
          break;
        case "stopEditing":
          editing.actions.stop();
          break;
        case "togglePlayback":
          togglePlayback();
          break;
        case "findNext":
          search.actions.next();
          break;
        case "findPrevious":
          search.actions.previous();
          break;
        case "nextUncertain":
          goToNextUncertain();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayback, goToNextUncertain, search]);

  const locateSourceFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: t("detail.source.fileFilter"),
          extensions: ["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "mp4", "mkv", "mov"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    try {
      await api.changeRecordingPath(id, selected);
      await load();
    } catch (e) {
      onError(userMessage(e));
    }
  }, [id, load, onError, t, userMessage]);

  const startTranscription = useCallback(async () => {
    // Only once the shell says a run began. It may open a confirmation or the
    // speaker question first, and declining either used to leave this screen
    // busy for ever: a bubble frozen at zero, no player, no actions, and a
    // cancel button the backend answers with "nothing is running".
    if (!(await onTranscribe(id))) return;
    setStatus("transcribing");
    // Clear the previous failure, or the old message would linger under a
    // progress bar for a run that is going fine.
    setError(null);
  }, [id, onTranscribe]);

  const startTranscriptionInLanguage = useCallback(async (selectedLanguage: string) => {
    if (!(await onTranscribe(id, selectedLanguage))) return;
    setLanguage(selectedLanguage);
    setStatus("transcribing");
    setError(null);
  }, [id, onTranscribe]);

  const saveRecordingTitle = useCallback(async (value: string) => {
    const trimmed = value.trim();
    setRenamingTitle(false);
    if (!trimmed || trimmed === title) return;
    try {
      await api.renameRecording(id, trimmed);
      setTitle(trimmed);
      player.updateTitle(id, trimmed);
    } catch (e) {
      onError(userMessage(e));
    }
  }, [id, onError, player, title, userMessage]);

  const cancelTranscription = useCallback(async () => {
    try {
      await api.cancelTranscription(id);
    } catch (error) {
      onError(userMessage(error));
    }
  }, [id, onError, userMessage]);

  /** What was pointed at, and where the menu should appear. */
  const [transcriptMenu, setTranscriptMenu] = useState<
    { x: number; y: number; segment: Segment; time: number } | null
  >(null);

  const openTranscriptMenu = useCallback((segment: Segment, event: ReactMouseEvent) => {
    event.preventDefault();
    // The word carries its own moment; the block start is the fallback for
    // the gaps between words and for transcripts with no word timings.
    const word = (event.target as HTMLElement).closest<HTMLElement>(".word");
    const spoken = Number(word?.dataset.time);
    setTranscriptMenu({
      x: event.clientX,
      y: event.clientY,
      segment,
      time: Number.isFinite(spoken) ? spoken : segment.start,
    });
  }, []);

  const copyFromTranscript = useCallback(async (segment: Segment) => {
    // A selection is an explicit request for exactly that text; without one
    // the block is what was pointed at.
    const selected = window.getSelection()?.toString().trim();
    try {
      await copyPlainText(selected || segment.text);
      onInfo(t("detail.menu.copied"));
    } catch {
      onError(t("detail.preview.copyFailed"));
    }
  }, [onError, onInfo, t]);

  const drawnBlocks = useProgressiveList(segments.length);

  const togglePanel = useCallback(() => {
    setPanelOpen((o) => {
      localStorage.setItem("panel", o ? "zavreny" : "otevreny");
      return !o;
    });
  }, []);

  const diarizeSpeakers = useCallback(() => onDiarize(id), [id, onDiarize]);

  // ---------------------------------------------------------------- export
  /** Ask, once, before the first document.
   *
   *  The language editor is the largest thing this application downloads and it
   *  is wanted by some people and never by others, which is why it left the
   *  first run: it was 81 % of a first installation for a feature its own screen
   *  calls optional. It is asked for here instead, at the moment somebody wants
   *  what it makes, with one sentence naming the size.
   *
   *  There is no second question about which model. The runtime follows the
   *  drivers — the same rule `tools.rs` uses when it looks for `llama-cli` —
   *  and the model follows what has already been said: whatever was chosen on
   *  `Jazyková úprava`, and where nothing has been, the tier the wizard's one
   *  answer implies. That order matters and is the reason this is not simply
   *  `EDITOR_TIER`: this offer is also reached with a model already chosen but
   *  its runtime missing, and fetching the tier there would replace somebody's
   *  choice with an inference, and download several gigabytes to do it.
   *
   *  What is asked is the only thing the reader knows better than the machine:
   *  whether they want it.
   */
  const askForEditor = useCallback(async () => {
    try {
      const [components, settings, tools] = await Promise.all([
        api.catalog(),
        api.loadSettings(),
        api.checkTools(),
      ]);
      const chosen = Object.keys(EDITOR_MODELS).find(
        (id) => EDITOR_MODELS[id] === settings.editor_model
      );
      const tier = chosen ?? EDITOR_TIER[qualityChoice(settings)];
      const runtime = tools.vulkan_driver ? "editor-vulkan" : "editor-cpu";
      const ids = [tier, runtime].filter(
        (component) => !components.find((item) => item.id === component)?.complete
      );
      setEditorOffer({
        ids,
        megabytes: ids.reduce(
          (total, component) =>
            total + (components.find((item) => item.id === component)?.megabytes ?? 0),
          0
        ),
        model: EDITOR_MODELS[tier],
      });
      setAiDialog("missing");
    } catch (error) {
      onError(userMessage(error));
    }
  }, [onError, userMessage]);

  const openAiAction = useCallback(async () => {
    // A generated document remains useful even if the source transcript or
    // selected model changed later. Let the user inspect and save it first;
    // regeneration is a separate, explicit choice inside the preview.
    if (aiDocument) {
      setPreviewTab("improved");
      setAiDialog("preview");
      return;
    }
    /* This branch used to open the reading window whenever any document made
       from an instruction was saved, improved transcript or not — and the
       reported defect is what that costs. Improve a transcript, delete the
       result, press `Vylepšit`: the press landed in the preview, whose first
       three tabs are gated on the improved transcript that had just been
       deleted, so the window opened with `Vlastní prompt` as its only pill and
       an empty state under it. A transcript never improved at all, but with one
       custom document saved, met the same thing by the other road.

       **The offer is fixed.** What `Vylepšit` opens cannot depend on what
       happens to be stored beside the recording, because the button's whole
       promise is that the three improvements are available. With no improved
       transcript it goes to the choice, every time.

       The one case that is not about making anything: the model is gone from
       this machine and something was already made with it. Offering a
       multi-gigabyte download to somebody who wants to read their own saved
       text is the wrong answer, so that press opens the window it can. */
    if (!aiConfigured || !aiReady) {
      if (aiCustomDocuments.length > 0) {
        setPreviewTab("custom");
        setAiDialog("preview");
      } else if (editorDownloading) setAiDialog("missing");
      else await askForEditor();
      return;
    }
    setAiMode("faithful");
    setAiDialog("configure");
  }, [aiConfigured, aiReady, aiCustomDocuments, aiDocument, askForEditor, editorDownloading]);

  /** Speaker recognition, from its own button.
   *
   *  It used to be a card in the language-editing dialog, among two ways of
   *  rewriting the text — and it is not language editing at all: no model is
   *  loaded, nothing is rewritten, the transcript is divided between the voices
   *  that produced it. Its own button is what it always was.
   *
   *  The components may not be installed. Then the press goes where they are
   *  fetched, as the card's own `Stáhnout` badge did. */
  const recognizeSpeakers = useCallback(() => {
    if (!speakersReady) {
      onToModule("model-hlasy");
      return;
    }
    diarizeSpeakers();
  }, [diarizeSpeakers, onToModule, speakersReady]);


  /** Yes. Fetch what is missing and record that the feature is wanted.
   *
   *  The download runs behind this screen — `download` in `downloads.rs` starts
   *  a thread and returns — so the reader goes on reading, and the
   *  application's own progress bubble reports it with a way to stop.
   *
   *  The setting is written now rather than when the files land. It says what
   *  was asked for; `resolve_editor_model` in `tools.rs` falls back to whatever
   *  model is actually on the disk, so a name written ahead of its file is not
   *  a dead end — and a listener that had to survive the reader walking to the
   *  Archive would not have survived it. */
  const acceptEditor = useCallback(async () => {
    if (!editorOffer) return;
    setAiDialog(null);
    try {
      if (editorOffer.ids.length > 0) {
        await api.download(editorOffer.ids);
        setEditorDownloading(true);
      }
      const settings = await api.loadSettings();
      await api.saveSettings({ ...settings, editor_model: editorOffer.model });
      await load();
      // Everything was already on the disk: there is nothing to wait for, so
      // the press that asked for a document goes on to ask what kind.
      if (editorOffer.ids.length === 0) {
        setAiMode("faithful");
        setAiDialog("configure");
      }
    } catch (error) {
      /* This used to be about `download.already_running` — whether a refusal
         should be shown here as well as in the wizard. There is no refusal any
         more: a download asked for while another is running joins the queue.
         What is left is an ordinary failure, and an ordinary failure is said. */
      onError(userMessage(error));
    }
  }, [editorOffer, load, onError, userMessage]);

  /** The improved transcript, in one of the two prepared ways. The mode is
   *  passed rather than read from state, so the caller — the one place that
   *  also knows about the third card — says which of the two it means. */
  const startAiEdit = useCallback(async (mode: "faithful" | "clean") => {
    lastRun.current = { kind: "edit", mode };
    setAiDialog(null);
    setPreviewTab("improved");
    setAiRunning(true);
    setAiProgress({
      recording_id: id,
      phase: "preparing",
      percent: 2,
      description: localMessage(t("detail.progress.preparingModel")),
    });
    try {
      await api.startAiEdit(id, mode);
      const status = await api.aiEditStatus(id);
      setAiRunning(status.running);
      if (status.progress) setAiProgress(status.progress);
    } catch (error) {
      setAiRunning(false);
      onError(userMessage(error));
    }
  }, [id, onError, t, userMessage]);

  const startAiOutput = useCallback(async (
    kind: "summary" | "translation" | "custom",
    variant: string
  ) => {
    lastRun.current = { kind: "output", output: kind, variant };
    if (!aiConfigured || !aiReady) {
      if (editorDownloading) setAiDialog("missing");
      else await askForEditor();
      return;
    }
    setAiDialog(null);
    setAiRunning(true);
    setAiProgress({
      recording_id: id,
      phase: "preparing",
      percent: 2,
      description: localMessage(
        kind === "summary"
          ? t("detail.progress.preparingSummary")
          : kind === "custom"
            ? t("detail.progress.preparingCustom")
            : t("detail.progress.preparingTranslation")
      ),
    });
    try {
      await api.startAiOutput(id, kind, variant);
      const status = await api.aiEditStatus(id);
      setAiRunning(status.running);
      setAiOutputs(status.outputs);
      setAiCustomDocuments(status.custom);
      if (status.progress) setAiProgress(status.progress);
    } catch (error) {
      setAiRunning(false);
      onError(userMessage(error));
    }
  }, [aiConfigured, aiReady, askForEditor, editorDownloading, id, onError, t, userMessage]);

  /** The instruction as it will be stored and looked up: without the spaces
   *  and newlines a field collects, so the same instruction typed twice is one
   *  instruction and not two. */
  const writtenPrompt = customPrompt.trim();
  /** What this recording already answered to exactly this instruction. Change
   *  a word of it and this is nothing, which is the honest answer: the text
   *  below would otherwise be somebody else's question. */
  const customDocument = aiCustomDocuments.find((document) => document.prompt === writtenPrompt);

  /** Run the reader's own instruction over the transcript.
   *
   *  An empty field never starts a run — the buttons that call this are
   *  disabled without one, and Rust refuses it a second time. Falling back to a
   *  prepared mode was the alternative and it is worse: a document nobody
   *  described is a document nobody can trust. */
  const startCustomDocument = useCallback(() => {
    const prompt = customPrompt.trim();
    if (!prompt) return;
    setPreviewTab("custom");
    void startAiOutput("custom", prompt);
  }, [customPrompt, startAiOutput]);

  /** Decline the offer and run the same model again, changing nothing.
   *
   *  A failed load is a measurement of one moment, not of the computer. What is
   *  known is that it did not start; what is not known is whether something
   *  else held the memory while it tried. This is the press for the reader who
   *  thinks it was that. */
  const retrySameEditor = useCallback(() => {
    setSmallerOffer(null);
    const last = lastRun.current;
    if (last?.kind === "edit") void startAiEdit(last.mode);
    else if (last?.kind === "output") void startAiOutput(last.output, last.variant);
  }, [startAiEdit, startAiOutput]);

  /** Take the offer: write the smaller model into the settings and carry the
   *  run over. One press, and the thing that failed happens.
   *
   *  **The setting is written rather than used once, and the way back matters
   *  because of it.** A machine that could not load the model now will probably
   *  not load it in a minute, and repeating a load that ends in
   *  `ai.model_load_timeout` costs five minutes each time — which is what the
   *  writing avoids. But *probably* is the whole of it: this may have been one
   *  bad moment, so `Zkusit znovu` stands beside this button, and the sentence
   *  above them says the choice can be changed back on `Jazyková úprava`, where
   *  the two cards are one click apart. */
  const takeSmallerEditor = useCallback(async () => {
    const offer = smallerOffer;
    if (!offer) return;
    setSmallerOffer(null);
    if (!offer.installed) {
      /* Not here yet, so the offer is a download and that screen owns it —
         the same route the missing-editor dialog takes, with the component
         already named. */
      onToModule(offer.smaller);
      return;
    }
    try {
      const settings = await api.loadSettings();
      await api.saveSettings({ ...settings, editor_model: EDITOR_MODELS[offer.smaller] });
      const last = lastRun.current;
      if (last?.kind === "edit") void startAiEdit(last.mode);
      else if (last?.kind === "output") void startAiOutput(last.output, last.variant);
    } catch (error) {
      onError(userMessage(error));
    }
  }, [onError, onToModule, smallerOffer, startAiEdit, startAiOutput, userMessage]);

  const openOriginalPreview = useCallback(async () => {
    setPreviewTab("original");
    if (originalPreview) return;
    try {
      setOriginalPreview(await api.exportPreview(id, "txt"));
    } catch (error) {
      onError(userMessage(error));
    }
  }, [id, onError, originalPreview, userMessage]);

  const saveAiExport = useCallback(
    async (format: "txt" | "md") => {
      try {
        const name = await api.suggestedAiName(id, format);
        const destination = await save({ defaultPath: name });
        if (!destination) return;
        await api.saveAiDocument(id, format, destination);
        onInfo(t("detail.saved.improved", { path: destination }));
      } catch (error) {
        onError(userMessage(error));
      }
    },
    [id, onError, onInfo, t, userMessage]
  );

  const saveAiOutput = useCallback(async (
    kind: "summary" | "translation" | "custom",
    variant: string,
    format: "txt" | "md"
  ) => {
    try {
      const name = await api.suggestedAiOutputName(id, kind, variant, format);
      const destination = await save({ defaultPath: name });
      if (!destination) return;
      await api.saveAiOutput(id, kind, variant, format, destination);
      // A whole sentence per kind. Czech declines the verb with the noun, so
      // there is nothing here to assemble from two halves.
      onInfo(t(
        kind === "summary"
          ? "detail.saved.summary"
          : kind === "custom"
            ? "detail.saved.custom"
            : "detail.saved.translation",
        { path: destination }
      ));
    } catch (error) {
      onError(userMessage(error));
    }
  }, [id, onError, onInfo, t, userMessage]);

  const exportRecording = useCallback(
    async (format: string) => {
      try {
        const name = await api.suggestedName(id, format);
        const destination = await save({ defaultPath: name });
        if (!destination) return;
        await api.saveExport(id, format, destination);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [id, onError, userMessage]
  );

  // ---------------------------------------------------------------- render
  /* Busy is a fact about the run, not about the click that may have started
     it. The local status covers the moment between starting and the first
     event; the phase covers a run this screen did not start — from the
     archive, from the watched folder, or after a confirmation was accepted. */
  const running =
    status === "transcribing" ||
    (progress != null && !["complete", "cancelled", "error"].includes(progress.phase));
  /** When speaker recognition may not be started: nothing to divide yet, or
   *  something already has this recording — a transcription, a diarization
   *  under way, or the language model.
   *
   *  **One expression for both ways in.** The header pill and the sidebar's own
   *  action each carried their own list, and the lists had drifted: the
   *  sidebar's was missing `aiRunning`, so while the model worked the header
   *  was correctly dead and the sidebar was still pressable — two answers to
   *  one question, several hundred lines apart. It sits under `running` because
   *  that is the one of the four that is derived rather than held. */
  const speakersBusy = segments.length === 0 || running || diarizing || aiRunning;
  // The segment that last began, rather than the one the playhead sits
  // inside. Between two sentences there is a pause that belongs to neither,
  // and demanding a strict match made the highlight blink out for it before
  // reappearing a line lower. Holding the previous line until the next one
  // starts turns that flicker into a plain step down the page.
  //
  // Binary search rather than a scan: this runs on every frame of playback,
  // and segments arrive ordered by their position in the recording.
  const active = useMemo(() => {
    let low = 0;
    let high = segments.length - 1;
    let found: Segment | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (segments[middle].start <= time) {
        found = segments[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }, [segments, time]);

  // Keep the active segment on screen, but only while audio is actually
  // playing — during reading and editing, self-scrolling gets in the way.
  //
  // And only when it is genuinely out of sight. Clicking a word in the middle
  // of the screen used to re-centre the whole transcript for no reason; now
  // the text under your hand moves only when it would otherwise disappear.
  useEffect(() => {
    if (!isPlaying || !active) return;
    const element = document.getElementById(`segment-${active.id}`);
    const list = listRef.current;
    if (!element || !list) return;

    const box = element.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    // Band near the edges where a segment counts as "on its way out".
    const margin = Math.min(120, view.height * 0.15);
    if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    /* `drawnBlocks` is in here because on arrival the block being read is
       usually past the first screenful, has no element yet, and this leaves
       above without doing anything.

       It is not the difference between working and not — that was the first
       guess and it was wrong. The audio keeps running, so a few seconds later
       the reading crosses into the next block, `active` changes, and it lands
       then. This is the difference between immediate and one block late. */
  }, [active?.id, isPlaying, drawnBlocks]);

  // Language names come from the shared dictionary, so a language change moves
  // them too — a module constant would keep whatever it was born with.
  const translationLanguageItems = useMemo(
    () => TRANSLATION_LANGUAGES.map((code) => ({
      value: code,
      label: labels.languageCapitalized(code),
    })),
    [labels]
  );

  const summaryOutput = aiOutputs.find(
    (output) => output.kind === "summary" && output.variant === summaryLength
  );
  const translationOutput = aiOutputs.find(
    (output) => output.kind === "translation" && output.variant === translationLanguage
  );
  const previewText = previewTab === "improved"
    ? aiDocument?.text ?? ""
    : previewTab === "original"
      ? originalPreview
      : previewTab === "summary"
        ? summaryOutput?.text ?? ""
        : previewTab === "custom"
          ? customDocument?.text ?? ""
          : translationOutput?.text ?? "";

  const copyPreviewText = async () => {
    if (!previewText.trim()) return;
    try {
      await copyPlainText(previewText);
      // One whole sentence per document, not a name glued in front of a verb:
      // the verb agrees with the noun.
      onInfo(t(
        previewTab === "improved"
          ? "detail.copied.improved"
          : previewTab === "original"
            ? "detail.copied.original"
            : previewTab === "summary"
              ? "detail.copied.summary"
              : previewTab === "custom"
                ? "detail.copied.custom"
                : "detail.copied.translation"
      ));
    } catch (error) {
      onError(error instanceof ClipboardRefused
        ? t("detail.preview.copyFailed")
        : userMessage(error));
    }
  };

  const savePreview = async (format: "txt" | "md") => {
    if (previewTab === "improved") {
      await saveAiExport(format);
    } else if (previewTab === "original") {
      await exportRecording(format);
    } else if (previewTab === "summary") {
      await saveAiOutput("summary", summaryLength, format);
    } else if (previewTab === "custom") {
      await saveAiOutput("custom", writtenPrompt, format);
    } else {
      await saveAiOutput("translation", translationLanguage, format);
    }
  };

  return (
    <main className="detail">
      <div className="detail-header">
        <div ref={headerLeftRef} className="detail-header-left">
          {/* The mark goes back to the archive here as it does in the archive's
              own header — *logo volocal by taky mělo vést do archivu na
              kliknutí*. It was a decorative `span` and the back button beside it
              carried the whole job, which made the same drawing clickable on one
              screen and inert on the next.

              So it stops being `aria-hidden` and carries a name: a control that
              does something has to say what. The back button stays, and the two
              saying the same thing is not a repetition — one is the way back
              somebody looks for, the other is the way back everybody already
              tries. */}
          <button
            className="mark detail-mark header-brand-mark"
            onClick={onBack}
            title={t("common.archive")}
          >
            <Wordmark label={t("common.archive")} />
          </button>
          <button className="button quiet detail-back-button" onClick={onBack}>
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
              <path d="M6 1L1 6l5 5M1 6h12" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("common.archive")}
          </button>
          {/* The name is changed in the shared dialog, the same one that names
              a folder. The header keeps one shape whether or not a rename is
              under way. */}
          <NameDialog
            open={renamingTitle}
            title={t("dialogs.rename.title")}
            text={t("dialogs.rename.text")}
            label={t("dialogs.rename.label")}
            placeholder={t("dialogs.rename.placeholder")}
            submitLabel={t("common.save")}
            initialName={title || fileName(path)}
            onClose={() => setRenamingTitle(false)}
            onSubmit={(name) => void saveRecordingTitle(name)}
          />
          {(
            <>
              <h1 className="detail-title">
                <span className={`status-mark detail-status ${statusClass(status)}`} aria-hidden />
                <span className="detail-name">{title || fileName(path)}</span>
              </h1>
              {!running && !diarizing && (
                <RecordingActionsMenu
                  className="detail-title-menu"
                  status={status}
                  onRename={() => setRenamingTitle(true)}
                  onExportAudio={onExportAudio}
                  folders={folders}
                  folder={folder}
                  onMoveToFolder={onMoveToFolder}
                  onCreateFolderFor={onCreateFolderFor}
                  onRetranscribe={startTranscription}
                  onDeleteTranscript={() => setConfirmation({
                    title: t("detail.header.deleteTranscriptTitle"),
                    text: t("detail.header.deleteTranscriptText", { title: title || fileName(path) }),
                    confirm: t("detail.header.deleteTranscriptConfirm"),
                    destructive: true,
                    action: async () => {
                      await api.deleteTranscription(id);
                      await load();
                    },
                  })}
                  onTranscribeInLanguage={(selectedLanguage) =>
                    startTranscriptionInLanguage(selectedLanguage)
                  }
                  onRemove={() => setConfirmation({
                    title: t("detail.header.removeTitle"),
                    text: t("detail.header.removeText", { title: title || fileName(path) }),
                    confirm: t("detail.header.removeConfirm"),
                    destructive: true,
                    action: async () => {
                      await api.deleteRecording(id);
                      if (player.recordingId === id) player.close();
                      onBack();
                    },
                  })}
                />
              )}
            </>
          )}
        </div>
        <div className="detail-actions">
          {/* Detail replaces the application header, so its right-edge pills
              must reappear here: the mini player whenever a different
              recording than this one is playing — the full player covers only
              the open recording — and a take minimised out of the dialog,
              which would otherwise record with no sign of it on the whole
              screen. */}
          {player.recordingId && player.recordingId !== id && (
            <MiniPlayer
              compact={pillsCompact}
              onOpen={() => {
                if (player.recordingId) onOpenRecording(player.recordingId);
              }}
            />
          )}
          <MiniRecorder onOpen={onOpenRecorder} />
          {/* Speaker recognition, beside the other things that are done to this
              recording rather than among the ways of rewriting its text. It
              was a card in the dialog next door and it never belonged there:
              nothing is rewritten, no language model is loaded, the transcript
              is divided between the voices that produced it. The sidebar's
              section keeps its own action — that one is the way back out of a
              corner, next to the speakers it would change; this is the way in.

              They no longer say the same words, and the reason is the header
              rather than the act. `Rozpoznat mluvčí` is right in the sidebar,
              under a heading that has already said what these are and beside a
              list it would change. In the header it stood between `Uložit` and
              `AI nástroje` as the one verb in a row of names. So the pill has a
              key of its own — `detail.header.speakersButton`, `Mluvčí` — and
              the sidebar keeps the verb it was written for. */}
          <button
            className="button"
            onClick={recognizeSpeakers}
            disabled={speakersBusy}
            title={speakersReady ? undefined : t("detail.header.speakersMissing")}
          >
            <LineIcon name="speakers" size={15} />
            {/* The name does not change when speakers exist — a door is not
                renamed because there is something behind it, which is the rule
                `AI nástroje` is named on. The running state stays: that is not
                a second name, it is the button saying it is busy. */}
            {diarizing
              ? t("detail.speakers.diarizing")
              : t("detail.header.speakersButton")}
          </button>
          <button
            className={`button ai-edit-button ${aiDocument ? "ready" : ""}`}
            onClick={openAiAction}
            disabled={segments.length === 0 || running || aiRunning}
            title={aiDocument?.stale ? t("detail.header.staleHint") : undefined}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 1.5 9 5l3.5 1L9 7l-1 3.5L7 7 3.5 6 7 5l1-3.5ZM12.5 10l.55 1.95L15 12.5l-1.95.55L12.5 15l-.55-1.95L10 12.5l1.95-.55L12.5 10Z"
                    stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
            </svg>
            {aiDocument
              ? t("detail.header.improvedButton")
              : t("detail.header.improveButton")}
          </button>
          {/* Five format abbreviations side by side read as a toolbar and
              overpowered the file name. Saving is one action, not five. */}
          <ExportMenu
            disabled={segments.length === 0}
            onChoose={exportRecording}
            hasAiDocument={!!aiDocument && !aiDocument.stale}
            onChooseAi={saveAiExport}
          />
          <button
            className="icon-button header-icon-button"
            onClick={onNew}
            aria-label={t("detail.header.newTranscript")}
            title={t("detail.header.newTranscript")}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
              <path d="M7.5 2v11M2 7.5h11" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="icon-button header-icon-button"
            onClick={onSettings}
            aria-label={t("common.settings")}
            title={t("common.settings")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M2 4.5h3.2M8.8 4.5H14M2 11.5h6.2M11.8 11.5H14"
                    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="7" cy="4.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="11.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      <DetailProgress
        running={running}
        diarizing={diarizing}
        progress={progress}
        aiRunning={aiRunning}
        aiProgress={aiProgress}
        onCancelTranscription={() => void cancelTranscription()}
        onCancelAi={() => void api.cancelAiEdit(id)}
      />

      {status === "new" && !sourceMissing ? (
        /* The strip only states the situation. The call to action stands in
           the middle of the empty transcript area — where the text will be —
           so the fact and the button are not said twice. */
        <div className="player player-prompt">
          <InfoNote compact>{t("detail.empty.notTranscribed")}</InfoNote>
        </div>
      ) : status === "error" && segments.length === 0 && !sourceMissing ? (
        /* A transcription that failed or was interrupted. Without a way out
           from here, the only route back would be the library. */
        <div className="player player-prompt">
          <span>{error || t("detail.empty.failed")}</span>
          <button className="button primary" onClick={startTranscription}>
            {t("common.retry")}
          </button>
        </div>
      ) : sourceMissing ? (
        /* The transcript stays usable without audio; it just cannot be played. */
        <div className="player player-missing">
          <span>{t("detail.source.missing")}</span>
          <button className="button" onClick={locateSourceFile}>
            {t("detail.source.locate")}
          </button>
        </div>
      ) : running || diarizing ? null : (
        <PlaybackControls
          isCurrentRecording={isCurrentRecording}
          waveform={waveform}
          time={time}
          duration={trackDuration}
          isPlaying={isPlaying}
          onPlayPauza={togglePlayback}
          /* Dragging the slider does not start audio, it only moves the cursor. */
          onSeek={updateCursor}
          trailingControl={(
            <>
            {/* A keyboard button stood here — the way back to the shortcut
                strip, put beside the player on the reasoning that a way back
                belongs where the thing disappeared rather than three clicks
                away in Settings. The owner has now seen both and prefers the
                switch: *dejme jim toggle v nastavení rozhraní tak, jak jsme ho
                měly*. The principle was not wrong; it lost to the screen. The
                switch is on `Rozhraní` and reads the same
                `localStorage["rychle-tipy"]` this strip writes. */}
            {/* Beside the panel toggle, because both are tools of the screen
                rather than of playback — and without a target of its own the
                find bar existed only for whoever knew Ctrl+F. */}
            <button
              className="icon-button"
              onClick={search.actions.toggle}
              aria-pressed={search.state.open}
              aria-label={t("detail.find.open")}
              title={t("detail.find.open")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.4 10.4 14 14" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className="icon-button"
              onClick={togglePanel}
              aria-pressed={panelOpen}
              aria-label={panelOpen ? t("detail.player.hidePanel") : t("detail.player.showPanel")}
              title={panelOpen ? t("detail.player.hidePanel") : t("detail.player.showPanel")}
            >
              <svg width="17" height="15" viewBox="0 0 17 15" aria-hidden>
                <rect x="0.75" y="0.75" width="15.5" height="13.5" rx="3"
                      fill="none" stroke="currentColor" strokeWidth="1.4" />
                <line x1="11" y1="0.75" x2="11" y2="14.25"
                      stroke="currentColor" strokeWidth="1.4" />
                {panelOpen && (
                  <rect x="11" y="0.75" width="5.25" height="13.5"
                        fill="currentColor" opacity="0.25" />
                )}
              </svg>
            </button>
            </>
          )}
        />
      )}

      {/* Only over a transcript: the shortcuts are about reading one. */}
      {segments.length > 0 && <TranscriptTips />}

      {/* Over the reading column, not in the header — that bar already
          overflows at 1180 px with both pills up — and not permanently, since
          this is wanted now and then rather than always. */}
      <div className={`detail-body ${panelOpen ? "" : "no-panel"}`}>
      <TranscriptSearch search={search} />

        <div className="transcript" ref={listRef}>

          {running && segments.length === 0 && (
            /* No placeholder while the first words are still on their way —
               the progress bubble already says what is happening, and a serif
               `Příprava…` sitting where the transcript will be read as part
               of it. The area simply stays empty until text arrives. */
            <div className="live-transcript">
              {liveSegments.map((s, i) => (
                <p key={i}>{s.text}</p>
              ))}
            </div>
          )}

          {/* The first screenful, then the rest a frame later. See
              `useProgressiveList`: on a forty-five minute recording the window
              was drawing 359 blocks before showing any of them. Slicing keeps
              the indices, so `segments[i - 1]` below still reaches the real
              previous block rather than the previous drawn one. */}
          {segments.slice(0, drawnBlocks).map((s, i) => {
            const previous = segments[i - 1];
            const newSpeakers = s.speakers !== (previous?.speakers ?? null);
            const m = s.speakers ? speakers.state.byKey.get(s.speakers) : undefined;
            return (
              <div key={s.id}>
                {newSpeakers && m && (
                  <div className="speaker-header" style={{ color: m.color }}>
                    {m.name}
                  </div>
                )}
                {/* The handlers must not be created here. Were they built
                    fresh for every segment on every render, the `memo`
                    comparison would never pass and a ticking clock would
                    repaint the whole transcript. Hence the segment is passed
                    as an argument instead. */}
                <SegmentRow
                  segment={s}
                  active={active?.id === s.id}
                  time={time}
                  editing={editing.state.editing === s.id}
                  color={m?.color}
                  onSeek={seek}
                  onStartUpravu={editing.actions.start}
                  onConfirm={editing.actions.confirm}
                  onSave={editing.actions.save}
                  onContextMenu={openTranscriptMenu}
                  find={search.state.needle}
                  foundHere={search.state.hitId === s.id}
                />
              </div>
            );
          })}

          {!running && segments.length === 0 && (
            status === "new" && !sourceMissing ? (
              /* The empty area names what it is for and offers the one action
                 that fills it. A missing source falls through to the plain
                 line: a file that is gone cannot be transcribed. */
              <div className="transcript-empty">
                <span className="transcript-empty-mark" aria-hidden>
                  <LineIcon name="transcription" />
                </span>
                <h2>{t("detail.empty.heading")}</h2>
                <button className="button primary" onClick={startTranscription}>
                  {t("detail.empty.transcribe")}
                </button>
              </div>
            ) : (
              <p className="small-text">{t("detail.empty.noTranscript")}</p>
            )
          )}
        </div>

        {panelOpen && (
        <aside className="sidebar" aria-label={t("detail.sidebar.label")}>
          {/* One page, three lists. Each section keeps its own open state, so
              a reader who never names speakers can fold that section away and
              still see notes and uncertain places at the same time. */}
          <SpeakersSection
            speakers={speakers}
            open={openSections.speakers}
            onToggle={() => toggleSection("speakers")}
            onDiarize={diarizeSpeakers}
            busy={speakersBusy}
            diarizing={diarizing}
            onConfirmRemove={(speaker) => {
              // Asked about only when there is something to lose. A person just
              // added by a slip of the hand holds a placeholder name and
              // nothing else, and a dialog about that would be in the way.
              if (!segments.some((s) => s.speakers === speaker.key)) {
                void speakers.actions.removeVoice(speaker);
                return;
              }
              setConfirmation({
                title: t("detail.speakers.removeTitle"),
                text: t("detail.speakers.removeText", { name: speaker.name }),
                confirm: t("detail.speakers.removeConfirm"),
                destructive: true,
                action: () => speakers.actions.removeVoice(speaker),
              });
            }}
          />

          {/* Only where there is something to do. An empty list of a thing the
              reader has never heard of is worse than no section at all. */}
          {speakers.state.unassigned.length > 0 && (
            <SidebarSection
              icon="unnamed"
              title={t("detail.unassigned.heading")}
              count={speakers.state.unassigned.length}
              open={openSections.unassigned}
              onToggle={() => toggleSection("unassigned")}
            >
              <p className="sidebar-empty">{t("detail.unassigned.hint")}</p>
              <ul className="unassigned">
                {speakers.state.unassigned.map((s) => {
                  /* Only the two neighbours, not every voice in the recording.
                     A gap between two blocks of one person is already filled
                     by the backend, so what is left lies between two different
                     people — and the right answer is one of those two. Listing
                     all five under all thirty rows would be 150 buttons, and
                     none of the other 148 is a plausible answer. Somebody who
                     needs a third voice has the transcript's own menu. */
                  const above = speakers.actions.neighbourVoice(s, -1);
                  const below = speakers.actions.neighbourVoice(s, 1);
                  const choices = below && below.key !== above?.key
                    ? [above, below]
                    : [above];
                  return (
                    <li key={s.id}>
                      <button
                        className={`interjection ${s.start <= time && time < s.end ? "current" : ""}`}
                        onClick={() => hear(s)}
                        title={t("detail.unassigned.hearTitle")}
                      >
                        <PlayMark />
                        <span className="uncertain-time">{formatTime(s.start)}</span>
                        <span className="uncertain-text">{s.text}</span>
                      </button>
                      <div className="unassigned-voices">
                        {choices.map((voice) =>
                          voice ? (
                            <button
                              key={voice.key}
                              className="voice-choice"
                              style={{
                                color: speakers.state.byKey.get(voice.key)?.color,
                                borderColor: speakers.state.byKey.get(voice.key)?.color,
                              }}
                              onClick={() => void speakers.actions.giveToVoice(s, voice.key)}
                            >
                              {voice.name}
                            </button>
                          ) : null
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </SidebarSection>
          )}

          <ReviewSections
            editing={editing}
            openSections={openSections}
            onToggle={toggleSection}
            time={time}
            onHear={hear}
          />

          <NotesSection
            notes={notes}
            open={openSections.notes}
            onToggle={() => toggleSection("notes")}
            playbackTime={time}
            duration={duration}
            onConfirmDelete={(note) =>
              setConfirmation({
                title: t("detail.notes.deleteTitle"),
                text: note.text.trim(),
                confirm: t("common.delete"),
                destructive: true,
                action: () => notes.actions.remove(note),
              })
            }
          />
        </aside>
        )}
      </div>

      {transcriptMenu && (
        <TranscriptContextMenu
          x={transcriptMenu.x}
          y={transcriptMenu.y}
          onClose={() => setTranscriptMenu(null)}
          items={[
            {
              label: t("detail.menu.play"),
              icon: MENU_ICONS.play,
              action: () => playFrom(transcriptMenu.time),
            },
            {
              label: t("detail.menu.copy"),
              icon: MENU_ICONS.copy,
              action: () => void copyFromTranscript(transcriptMenu.segment),
            },
            {
              label: t("detail.menu.edit"),
              icon: MENU_ICONS.edit,
              action: () => editing.actions.start(transcriptMenu.segment),
            },
            {
              label: t("detail.menu.note", { time: formatTime(transcriptMenu.time) }),
              icon: MENU_ICONS.note,
              action: () => notes.actions.beginAt(transcriptMenu.time),
            },
            /* One question — who said this — and every answer to it in one
               place. The speakers by name, rather than the block above and the
               block below: those two were the machine's way of pointing at a
               person, and the reader had to work out who "above" was before
               they could agree with it.

               Somebody new is the last answer rather than a second question at
               the top. It is the same decision, reached when none of the names
               fit, and it is where the eye already is by then.

               The only name missing is whoever already has this block. */
            {
              label: t("detail.menu.toSpeaker"),
              icon: MENU_ICONS.speaker,
              children: [
                ...speakers.state.speakers
                  .filter((m) => m.key !== transcriptMenu.segment.speakers)
                  .map((m) => ({
                    label: m.name,
                    icon: MENU_ICONS.speaker,
                    color: m.color,
                    action: () => void speakers.actions.giveToVoice(transcriptMenu.segment, m.key),
                  })),
                {
                  label: t("detail.menu.newSpeaker"),
                  icon: MENU_ICONS.newVoice,
                  action: () => void speakers.actions.giveToNewVoice(transcriptMenu.segment),
                },
              ],
            },
          ]}
        />
      )}

      {/* The one question about language editing, asked where it is wanted.
          It used to be a notice saying the feature was not ready and a button
          reading `Vybrat model`, which walked to the component list and asked
          which of three — a second question about something the first run had
          already answered, in a screen the reader had not asked to open. Now it
          is yes or no, with the size in the sentence, and yes starts the
          download behind this screen.

          Pressed again while that download is running it says so rather than
          offering again: asked once means once. */}
      {aiDialog === "missing" && (
        <div className="dialog-overlay" role="presentation" onMouseDown={() => setAiDialog(null)}>
          <div ref={missingDialog} className="dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-missing-title"
               onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ai-missing-title">
              {t(editorDownloading ? "detail.ai.downloadingTitle" : "detail.ai.offerTitle")}
            </h2>
            <p>
              {editorDownloading
                ? t("detail.ai.downloadingText")
                : t("detail.ai.offerText", {
                    size: dataSize(editorOffer?.megabytes ?? 0),
                  })}
            </p>
            <div className="dialog-footer">
              <button className="button quiet" onClick={() => setAiDialog(null)}>
                {t("common.close")}
              </button>
              {!editorDownloading && (
                <button className="button primary" onClick={() => void acceptEditor()}>
                  {t("common.download")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The machine could not start the chosen model, and this says so and
          offers the one below it. It is not a warning worked out in advance —
          `tools.rs` refuses to decide anything by `memory_gb`, on the grounds
          that nothing here has ever measured what a model needs, and that
          refusal is right. A model that would not load is a measurement, and
          it is the only one this application can honestly make: the graphics
          card's memory, which is what usually runs out, is not readable at
          all.

          The reader presses. Nothing is switched behind their back, and it is
          the press that makes the changed setting theirs — the same bargain
          `Grafická karta je vybraná, ale…` makes on the settings screen. */}
      {smallerOffer && (
        <div className="dialog-overlay" role="presentation" onMouseDown={() => setSmallerOffer(null)}>
          <div ref={smallerDialog} className="dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-smaller-title"
               onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ai-smaller-title">{t("detail.smaller.title")}</h2>
            <p>
              {t(smallerOffer.installed
                ? "detail.smaller.text"
                : "detail.smaller.textDownload")}
            </p>
            <div className="dialog-footer">
              <button className="button quiet" onClick={() => setSmallerOffer(null)}>
                {t("common.close")}
              </button>
              {/* Because one failed load is not a verdict on the machine. The
                  paint may have been momentary — another program holding the
                  graphics memory, a transcription running beside this, a driver
                  that stumbled — and the application cannot tell that from a
                  computer too small, so it must not decide. Trying the same
                  model again is the answer it would be arrogant not to offer.

                  Quiet, and the switch stays primary: retrying costs another
                  wait and may end here again, while switching is the answer
                  most likely to end with a document. Which is a reason to rank
                  them, not a reason to leave one out. */}
              <button className="button quiet" onClick={() => void retrySameEditor()}>
                {t("detail.smaller.again")}
              </button>
              <button className="button primary" onClick={() => void takeSmallerEditor()}>
                {t(smallerOffer.installed
                  ? "detail.smaller.switch"
                  : "detail.smaller.download")}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiDialog === "configure" && (
        <div className="dialog-overlay" role="presentation" onMouseDown={() => setAiDialog(null)}>
          <div ref={configureDialog} className="dialog ai-edit-dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-configure-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ai-configure-title">{t("detail.ai.configureTitle")}</h2>
            <p>{t("detail.ai.configureText")}</p>
            <div className="choices ai-edit-modes">
              <button className={`choice with-icon ${aiMode === "faithful" ? "chosen" : ""}`}
                      onClick={() => setAiMode("faithful")}>
                <span className="choice-icon" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                       strokeLinejoin="round">
                    <path d="M6 3.5h8l4 4V20.5H6z M14 3.5v4h4 M8.7 14l2.1 2.1 4.6-5" />
                  </svg>
                </span>
                <span className="choice-body">
                  <span className="choice-title">{t("detail.ai.modeFaithful")}</span>
                  <span className="small-text">{t("detail.ai.modeFaithfulDescription")}</span>
                </span>
                <em className="badge">{t("detail.ai.recommended")}</em>
              </button>
              <button className={`choice with-icon ${aiMode === "clean" ? "chosen" : ""}`}
                      onClick={() => setAiMode("clean")}>
                <span className="choice-icon" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                       strokeLinejoin="round">
                    <path d="M12 5.5c-1-2.4-4.7-2-4.7.8v.5A3.3 3.3 0 0 0 5.5 12c-1.4 2.2.1 5 2.6 5.1.4 2.7 3.9 2.5 3.9.1V5.5Z M12 5.5c1-2.4 4.7-2 4.7.8v.5a3.3 3.3 0 0 1 1.8 5.2c1.4 2.2-.1 5-2.6 5.1-.4 2.7-3.9 2.5-3.9.1 M8.2 9.1c1.2 0 2.1.7 2.1 1.8 M15.8 9.1c-1.2 0-2.1.7-2.1 1.8 M8.1 17.1c.1-1.5.9-2.5 2.2-2.8 M15.9 17.1c-.1-1.5-.9-2.5-2.2-2.8" />
                  </svg>
                </span>
                <span className="choice-body">
                  <span className="choice-title">{t("detail.ai.modeClean")}</span>
                  <span className="small-text">{t("detail.ai.modeCleanDescription")}</span>
                </span>
              </button>
              {/* Speaker recognition stood here, and then `Vlastní prompt`
                  stood in its place with its own field under these cards. Both
                  are gone and this dialog is one question again: which of two
                  ways the transcript is rewritten.

                  The instruction left on the owner's realisation, not on a
                  preference — *nejdřív prostě MUSÍ být vylepšený přepis a pak
                  teprve další věci*. A document made from an instruction is one
                  of the further things, so offering it beside the two cards
                  that make the thing it needs was offering step two next to
                  step one. It lives in the window's fourth tab, which has had
                  the field, the button and the regenerate all along. */}
            </div>
            <p className="small-text ai-edit-note">
              <svg className="ai-edit-note-icon" width="16" height="16" viewBox="0 0 16 16"
                   fill="none" aria-hidden>
                <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.35" />
                <path d="M8 7.1v3.7M8 4.8h.01" stroke="currentColor" strokeWidth="1.55"
                      strokeLinecap="round" />
              </svg>
              <span>{t("detail.ai.configureNote")}</span>
            </p>
            <div className="dialog-footer">
              <button className="button quiet" onClick={() => setAiDialog(null)}>
                {t("common.cancel")}
              </button>
              {/* `Zobrazit uložený` stood here, added this morning: with the
                  instruction living in this dialog, a document made from it had
                  no other way back once `Vylepšit` stopped routing to the
                  window. The instruction does not live here any more, and the
                  window's fourth tab is reached the ordinary way — through the
                  tabs — so there is nothing left to rescue.

                  A correction of a correction, and both were right about the
                  arrangement they were written for. */}
              <button className="button primary" onClick={() => void startAiEdit(aiMode)}>
                {t("detail.ai.startEdit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The window opens for a document made from an instruction as well as
          for the improved transcript: without that, the first is written,
          shown once and unreachable afterwards. */}
      {aiDialog === "preview" && (aiDocument || aiCustomDocuments.length > 0) && (
        <div className="dialog-overlay" role="presentation" onMouseDown={() => setAiDialog(null)}>
          <div ref={previewDialog}
               className={`dialog ai-preview-dialog${previewScrolled ? " scrolled" : ""}`}
               role="dialog" aria-modal="true"
               aria-labelledby="ai-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ai-preview-header">
              {/* One name, both states. It used to switch, because with no
                  improved transcript the window held exactly one document and
                  it was the custom one — naming it `Vylepšený přepis` would
                  have named the thing the reader did not ask for.

                  Neither half of that is true now: every visit shows four tabs,
                  and with no improved transcript the window holds nothing at
                  all. `Dokument podle vašeho pokynu` over an empty window would
                  name a document that does not exist and is not what is being
                  asked for anyway. */}
              <div>
                <h2 id="ai-preview-title">{t("detail.preview.title")}</h2>
                <p>{t("detail.preview.subtitle")}</p>
              </div>
              <button className="icon-button" onClick={() => setAiDialog(null)}
                      aria-label={t("detail.preview.closeLabel")} title={t("common.close")}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor"
                        strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {previewTab !== "custom" && aiDocument?.stale && (
              <div className="ai-preview-warning">{t("detail.preview.staleWarning")}</div>
            )}
            {/* A custom document is compared against the transcript alone: no
                model is named in it, and nothing about it becomes wrong
                because a different editing model was chosen since. */}
            {previewTab === "custom" && aiDocument && customDocument?.stale && (
              <div className="ai-preview-warning">{t("detail.custom.staleWarning")}</div>
            )}
            {/* The header's own buttons, and the playback speeds' own selected
                state: a row of pills where the chosen one is filled. A
                segmented control is right in the archive, where it switches how
                a list is drawn; hanging under a header made of pills it read as
                a borrowed part. */}
            {/* All four, always — *myslím, že i po kliknutí na hotový vlastní
                prompt vidět ostatní záložky*.

                The first three used to be drawn only with the improved
                transcript, because the middle two are made *from* it and Rust
                refuses them without one (`ai.document_required`). That is a
                true statement about what can be produced and it was answered in
                the wrong place: hiding the tab hides the subject, and a window
                showing one pill reads as broken rather than as empty. Where a
                document cannot be made yet, the tab says so and offers the step
                that comes first — which is what the two empty states below
                already did for their own documents. */}
            <nav className="ai-document-tabs" role="tablist"
                 aria-label={t("detail.preview.tabsLabel")}>
              <button className={previewTab === "improved" || previewTab === "original" ? "active" : ""}
                      onClick={() => setPreviewTab("improved")} role="tab"
                      aria-selected={previewTab === "improved" || previewTab === "original"}>
                <DocumentViewIcon view="improved" />
                {t("detail.preview.transcriptTab")}
              </button>
              <button className={previewTab === "summary" ? "active" : ""}
                      onClick={() => setPreviewTab("summary")} role="tab"
                      aria-selected={previewTab === "summary"}>
                <DocumentViewIcon view="summary" />
                {t("detail.preview.summaryTab")}
              </button>
              <button className={previewTab === "translation" ? "active" : ""}
                      onClick={() => setPreviewTab("translation")} role="tab"
                      aria-selected={previewTab === "translation"}>
                <DocumentViewIcon view="translation" />
                {t("detail.preview.translationTab")}
              </button>
              <button className={previewTab === "custom" ? "active" : ""}
                      onClick={() => setPreviewTab("custom")} role="tab"
                      aria-selected={previewTab === "custom"}>
                <DocumentViewIcon view="custom" />
                {t("detail.preview.customTab")}
              </button>
            </nav>

            {/* The three toolbars pick a variant of a document. With no
                improved transcript there is no document to vary, so they stay
                down and the empty state below carries the whole tab — a length
                chosen for a summary that cannot be made is a control with
                nothing behind it. */}
            {(previewTab === "improved" || previewTab === "original") && aiDocument && (
              <div className="ai-output-toolbar">
                <div className="ai-output-options" role="radiogroup"
                     aria-label={t("detail.preview.versionLabel")}>
                  <button className={previewTab === "improved" ? "active" : ""}
                          onClick={() => setPreviewTab("improved")} role="radio"
                          aria-checked={previewTab === "improved"}>
                    {t("detail.preview.versionImproved")}
                  </button>
                  <button className={previewTab === "original" ? "active" : ""}
                          onClick={openOriginalPreview} role="radio"
                          aria-checked={previewTab === "original"}>
                    {t("detail.preview.versionOriginal")}
                  </button>
                </div>
              </div>
            )}
            {previewTab === "summary" && aiDocument && (
              <div className="ai-output-toolbar">
                {/* The three names say what they are. The group keeps its
                    accessible label for anyone who cannot see them. */}
                <div className="ai-output-options" role="radiogroup"
                     aria-label={t("detail.preview.lengthGroupLabel")}>
                  {SUMMARY_LENGTHS.map((option) => (
                    <button key={option}
                            className={summaryLength === option ? "active" : ""}
                            onClick={() => setSummaryLength(option)}
                            title={t(SUMMARY_LENGTH_KEYS[option].description)} role="radio"
                            aria-checked={summaryLength === option}>
                      {t(SUMMARY_LENGTH_KEYS[option].label)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {previewTab === "translation" && aiDocument && (
              <div className="ai-output-toolbar">
                {/* No visible label: the tab above says Překlad and the value
                    in the control is a language. `Select` carries its own
                    accessible name through `description`. */}
                <Select
                  value={translationLanguage}
                  items={translationLanguageItems}
                  description={t("detail.preview.translationLanguageLabel")}
                  onChange={(value) => setTranslationLanguage(value as TranslationLanguage)}
                />
              </div>
            )}

            {/* The instruction stands above its answer and stays editable
                there: rewriting it is how the next document is asked for, and
                the moment it changes the answer below is no longer to this
                question — the tab says so by going back to its empty state. */}
            {previewTab === "custom" && aiDocument && (
              <div className="ai-output-toolbar ai-custom-bar">
                <div className="field ai-custom-field">
                  <label htmlFor="ai-custom-prompt-preview">{t("detail.custom.label")}</label>
                  <textarea
                    id="ai-custom-prompt-preview"
                    rows={3}
                    value={customPrompt}
                    placeholder={t("detail.custom.placeholder")}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                  />
                  {/* The same note under the same field, from the same key. The
                      tab is reached after the dialog, but it is also where the
                      instruction is rewritten, and a reassurance that appears
                      only the first time is one the reader cannot go back to. */}
                  <InfoNote>{t("detail.custom.privacy")}</InfoNote>
                </div>
              </div>
            )}

            {previewTab === "improved" && aiDocument && (
              <PreviewText text={aiDocument.text} onScrolled={setPreviewScrolled} />
            )}
            {previewTab === "original" && (
              <PreviewText text={originalPreview || t("common.loading")} onScrolled={setPreviewScrolled} />
            )}
            {previewTab === "summary" && summaryOutput && (
              <PreviewText text={summaryOutput.text} onScrolled={setPreviewScrolled} />
            )}
            {previewTab === "translation" && translationOutput && (
              <PreviewText text={translationOutput.text} onScrolled={setPreviewScrolled} />
            )}
            {/* Every tab, when there is no improved transcript. One block for
                all four rather than four: what is missing is the same thing,
                and the step that fixes it is the same press. Only the sentence
                changes — the first tab is the document itself, the other three
                are made from it.

                The fourth joined the other two when the instruction started
                reading the improved document instead of the timed transcript.
                That is the whole of *nejdřív prostě MUSÍ být vylepšený přepis*
                on this screen: one precondition, said once, in front of
                everything that has it.

                The button goes to the choice rather than starting an edit,
                because there is a choice: `Věrný` and `Vyčištěný` are two
                different documents and one of them is only recommended. The
                dialog that asks is the one this window's own button opens, so
                nothing here invents a second way to decide. */}
            {!aiDocument && (
              <div className="ai-preview-empty">
                <span className="ai-preview-empty-icon" aria-hidden>
                  <DocumentViewIcon view="improved" />
                </span>
                <h3>{t("detail.preview.emptyTitle")}</h3>
                <p>
                  {t(previewTab === "improved" || previewTab === "original"
                    ? "detail.preview.emptyText"
                    : "detail.preview.emptyDerived")}
                </p>
                <button className="button primary"
                        onClick={() => {
                          setAiMode("faithful");
                          setAiDialog("configure");
                        }}>
                  {t("detail.ai.startEdit")}
                </button>
              </div>
            )}
            {previewTab === "summary" && aiDocument && !summaryOutput && (
              <div className="ai-preview-empty">
                <span className="ai-preview-empty-icon" aria-hidden>
                  <DocumentViewIcon view="summary" />
                </span>
                {/* A whole sentence per length: the adjective is declined and
                    lower-casing a label is not a translation. */}
                <h3>{t(SUMMARY_LENGTH_KEYS[summaryLength].heading)}</h3>
                <p>{t("detail.summary.emptyText")}</p>
                <button className="button primary"
                        onClick={() => startAiOutput("summary", summaryLength)}>
                  {t("detail.summary.create")}
                </button>
              </div>
            )}
            {previewTab === "translation" && aiDocument && !translationOutput && (
              <div className="ai-preview-empty">
                <span className="ai-preview-empty-icon" aria-hidden>
                  <DocumentViewIcon view="translation" />
                </span>
                <h3>{t("detail.translation.emptyTitle")}</h3>
                <p>{t("detail.translation.emptyText")}</p>
                <button className="button primary"
                        onClick={() => startAiOutput("translation", translationLanguage)}>
                  {t("detail.translation.create")}
                </button>
              </div>
            )}
            {previewTab === "custom" && aiDocument && customDocument && (
              <PreviewText text={customDocument.text} onScrolled={setPreviewScrolled} />
            )}
            {previewTab === "custom" && aiDocument && !customDocument && (
              <div className="ai-preview-empty">
                <span className="ai-preview-empty-icon" aria-hidden>
                  <DocumentViewIcon view="custom" />
                </span>
                <h3>{t("detail.custom.title")}</h3>
                <p>{t("detail.custom.emptyText")}</p>
                <button className="button primary" onClick={startCustomDocument}
                        disabled={!writtenPrompt}>
                  {t("detail.custom.create")}
                </button>
              </div>
            )}

            {/* Copy and Save act on a text, so the footer follows whether
                there is one. With no improved transcript there is none on any
                tab — the empty state has the whole window and carries its own
                single button, which is the only thing to do from here. */}
            {aiDocument
              && (previewTab === "improved" || previewTab === "original"
                || (previewTab === "summary" && summaryOutput)
                || (previewTab === "translation" && translationOutput)
                || (previewTab === "custom" && customDocument)) && (
              <div className="dialog-footer ai-preview-actions">
                {previewTab === "improved" && aiDocument && (
                  <button className="button quiet danger" onClick={async () => {
                    await api.deleteAiDocument(id);
                    setAiDocument(null);
                    setAiOutputs([]);
                    setAiDialog(null);
                  }}>
                    <DiscardIcon />
                    {t("detail.preview.discard")}
                  </button>
                )}
                {previewTab === "improved" && aiDocument && (
                  <button className="button quiet" onClick={() => {
                    setAiMode(aiDocument.mode === "clean" ? "clean" : "faithful");
                    setAiDialog("configure");
                  }}>
                    <RegenerateIcon />
                    {t("detail.preview.regenerateImproved")}
                  </button>
                )}
                {previewTab === "custom" && customDocument && (
                  <button className="button quiet" onClick={startCustomDocument}>
                    <RegenerateIcon />
                    {t("detail.preview.regenerateCustom")}
                  </button>
                )}
                {previewTab === "summary" && summaryOutput && (
                  <button className="button quiet"
                          onClick={() => startAiOutput("summary", summaryLength)}>
                    <RegenerateIcon />
                    {t("detail.preview.regenerateSummary")}
                  </button>
                )}
                {previewTab === "translation" && translationOutput && (
                  <button className="button quiet"
                          onClick={() => startAiOutput("translation", translationLanguage)}>
                    <RegenerateIcon />
                    {t("detail.preview.regenerateTranslation")}
                  </button>
                )}
                <button className="button" onClick={copyPreviewText}
                        disabled={!previewText.trim()}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6"
                          stroke="currentColor" strokeWidth="1.35" />
                    <path d="M10.8 5.2V3.9c0-.8-.7-1.4-1.5-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.4c0 .8.6 1.5 1.4 1.5h1.3"
                          stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
                  </svg>
                  {t("common.copy")}
                </button>
                <DocumentSaveMenu disabled={!previewText.trim()} onChoose={savePreview} />
              </div>
            )}
          </div>
        </div>
      )}

      {editing.state.suggestion && (
        <div className="menu">
          <span>
            {t("detail.dictionary.prompt", {
              from: editing.state.suggestion.z,
              to: editing.state.suggestion.na,
            })}
          </span>
          <button className="button" onClick={editing.actions.acceptSuggestion}>
            {t("detail.dictionary.confirm")}
          </button>
          <button className="button quiet" onClick={editing.actions.dismissSuggestion}>
            {t("detail.dictionary.decline")}
          </button>
        </div>
      )}
      <ConfirmationDialog
        query={confirmation}
        onClose={() => setConfirmation(null)}
        onError={onError}
      />
    </main>
  );
}

