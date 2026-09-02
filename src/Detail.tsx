import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import { api } from "./api";
import InfoNote from "./InfoNote";
import PlaybackControls from "./PlaybackControls";
import ConfirmationDialog from "./ConfirmationDialog";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import { LineIcon, type LineIconName } from "./icons";
import { changedWords } from "./transcriptText";
import { Wordmark } from "./Brand";
import {
  usePlayer,
} from "./player";
import { useI18n } from "./i18n";
import { useProgressMessage, useUserMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import { useLabels } from "./labels";
import {
  formatTime,
  fileName,
} from "./types";
import { useFormats } from "./formats";
import { useProgressiveList } from "./progressiveList";
/* The transcript screen's own parts. They were all in this file until it had
   grown to 3 688 lines; each of these is a piece somebody reads on its own. */
import {
  EXPORT_FORMATS,
} from "./detail/documents";
import { copyPlainText } from "./detail/clipboard";
import type {
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
import { SecondLanguageBar } from "./detail/SecondLanguageBar";
import { NoticeBar } from "./app/NoticeBar";
import type { Notices } from "./app/useNotices";
import { ClipSaveDialog } from "./detail/ClipSaveDialog";
import { selectedSegmentIds, useClipSelection } from "./detail/useClipSelection";
import { useSecondLanguage } from "./detail/useSecondLanguage";
import { DetailProgress } from "./detail/DetailProgress";
import { DetailHeader } from "./detail/DetailHeader";
import { NotesSection } from "./detail/NotesSection";
import { useRecordingNotes } from "./detail/useRecordingNotes";
import { SpeakersSection } from "./detail/SpeakersSection";
import { useSpeakerManagement } from "./detail/useSpeakerManagement";
import { ReviewSections } from "./detail/ReviewSections";
import { useTranscriptEditing } from "./detail/useTranscriptEditing";
import { AiModelOffer } from "./detail/ai/AiModelOffer";
import { AiPreviewDialog } from "./detail/ai/AiPreviewDialog";
import { AiToolsDialog } from "./detail/ai/AiToolsDialog";
import { useAiWorkspace } from "./detail/ai/useAiWorkspace";
import { useTranscriptSearch } from "./detail/useTranscriptSearch";
import { useDetailPlayback } from "./detail/useDetailPlayback";
import { useRecordingDetail } from "./detail/useRecordingDetail";
import type { LoadedRecording } from "./detail/useRecordingDetail";
import { MENU_ICONS, TranscriptContextMenu } from "./detail/TranscriptContextMenu";
import type { TranscriptMenuItem } from "./detail/TranscriptContextMenu";
import { SegmentRow } from "./detail/corrections";
import type {
  Folder,
  AiEditProgress,
  Speaker,
  Segment,
  TranscriptionProgress,
  LiveSegment,
  RecordingNote,
} from "./types";

interface Props {
  id: string;
  /** The window's one notice bar, drawn under this screen's own header. The
   *  archive draws it under the header above; this screen has a header of its
   *  own, so the bar comes down here rather than being left to sit above it. */
  notices: Notices;
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
  /** Opens the one save dialog. The flag says whether the language model's
   *  tidied version is worth offering — this screen is the only place that
   *  knows, and the dialog lives up in the application. */
  onExportAudio: (improved: boolean) => void;
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
  notices,
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
  /* Everything one visit to the backend brings back is given out here, not
     inside the hook that fetched it: six things belonging to five owners, and
     the wiring is meant to be visible.

     Through a ref because the owners are set up below this line — the fetch
     needs the recording's own facts, and the features need its blocks. The ref
     is written on every render, so the call always reaches the current one. */
  const deliverRef = useRef<(loaded: LoadedRecording) => void>(() => {});
  const deliver = useCallback((loaded: LoadedRecording) => deliverRef.current(loaded), []);

  const recording = useRecordingDetail({ recordingId: id, onError, onLoaded: deliver });
  const { title, path, duration, status, folder, error, language, segments,
          sourceMissing, speakersReady } = recording.state;
  const load = recording.actions.load;

  const [renamingTitle, setRenamingTitle] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  // The player is shared across the app so sound survives leaving this
  // screen. Opening another transcript does not touch it — until you press
  // play, whatever was playing keeps playing.
  const player = usePlayer();

  const drawnBlocks = useProgressiveList(segments.length);

  const playback = useDetailPlayback({
    recordingId: id,
    path,
    title,
    duration,
    segments,
    seekTime,
    drawnBlocks,
  });
  const { time, isPlaying, isCurrentRecording, trackDuration, waveform, active } = playback.state;
  const { seek, updateCursor, playFrom, playRange, togglePlayback } = playback.actions;

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
  const listRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- loading
  // Everything is gathered first and only then written to state.
  //
  // State used to be set piecemeal between `await`s, which on an hour-long
  // transcript meant three consecutive renders of a thousand-segment list.
  // Neither the dictionary nor the file check needs to wait for the segments;

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

  // Reload after every terminal transcription state. Completion, cancellation,
  // and failure all change the persisted recording status behind this screen.
  useEffect(() => {
    if (["complete", "cancelled", "error"].includes(progress?.phase ?? "")) load();
  }, [progress?.phase, load]);

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
     through uncertain spots is reading.

     **And it stops at the end of that place.** The question being answered is
     *is this word right*, which the next sentence does not help with; letting
     the recording run on means reaching for pause before the next one can be
     checked. Asked for on 2026-09-02. */
  const hear = useCallback(
    (segment: Segment) => {
      document
        .getElementById(`segment-${segment.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      playRange(segment.start, segment.end);
    },
    [playRange]
  );

  /* Finding a word in this transcript. The whole of it — the bar, the hits and
     the cursor between them — lives in `useTranscriptSearch`; what stays here
     is the keyboard, which belongs to the screen. */
  const search = useTranscriptSearch(segments);

  /* A language the recording holds and the transcript does not. It draws
     nothing at all unless a sweep found one, which on an ordinary recording is
     never. `load` is handed in because filling rewrites every block. */
  const secondLanguage = useSecondLanguage({ recordingId: id, onError, onInfo, reload: load });

  /* One stretch of the transcript, marked to be cut out of it. It draws
     nothing until the reader starts one, and stores nothing when they are
     done: the clip is the file that comes out. */
  const clip = useClipSelection();

  /* Asked again when a run ends, and it has to be: the sweep is the last thing
     a transcription does, so its answer lands *after* this screen asked once
     and was told nothing. Without this a reader watching a run finish would
     have to leave the transcript and come back to be told half of it is
     missing.

     Its own effect, beside the hook it calls, rather than a line inside the
     reload effect further up — that one is declared before this hook exists,
     and reaching it from there needed a ref written during render, which is
     exactly the shape hot reloading turns into `secondLanguageRef is not
     defined` on a screen somebody has open. */
  const rereadSecondLanguage = secondLanguage.actions.reread;
  useEffect(() => {
    if (["complete", "cancelled", "error"].includes(progress?.phase ?? "")) {
      void rereadSecondLanguage();
    }
  }, [progress?.phase, rereadSecondLanguage]);

  /* Saving the transcript in one named format. The header's own button opens
     the dialog instead, but the language model's preview still saves what it
     is showing — one format, already chosen, straight to a file. */
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

  /* The language model comes first of the four, and the order is load-bearing:
     three of them mark its document old when they change the transcript, and
     they are handed `markStale` itself rather than a wrapper around it. A
     wrapper would be a new function on every render, and `useTranscriptEditing`
     lists it among the dependencies of `save` — which every `SegmentRow`
     receives. On an hour-long transcript that is a thousand memoised rows
     failing their comparison on every tick of the clock. */
  const ai = useAiWorkspace({
    recordingId: id,
    onError,
    onInfo,
    onToModule,
    reload: load,
    saveTranscript: exportRecording,
  });

  /** A tidied version worth saving beside the transcript: it exists and the
   *  transcript has not changed under it since. */
  const hasImproved = !!ai.state.document && !ai.state.document.stale;

  const editing = useTranscriptEditing({
    recordingId: id,
    segments,
    updateSegments: recording.actions.update,
    onError,
    onInfo,
    markAiStale: ai.actions.markStale,
    reload: load,
  });

  deliverRef.current = (loaded) => {
    speakers.actions.receive(loaded.detail.speakers);
    notes.actions.receive(loaded.detail.notes);
    editing.actions.receiveDictionary(loaded.dictionary);
    ai.actions.receive(loaded.aiStatus);
    ai.actions.receiveReadiness(
      !!loaded.settings.editor_model,
      !!loaded.settings.editor_model && loaded.tools.issues_editor.length === 0
    );
  };

  /* Tab steps to the next uncertain place after the one being read, so it needs
     the clock — but it must not *depend* on it. The keyboard effect below lists
     this callback, and the clock ticks eight times a second while audio plays;
     a dependency here would tear the window's keydown listener down and put it
     back on every one of those ticks. The ref is written on every render, so
     the step is always taken from where playback actually stands. */
  const now = useRef(time);
  now.current = time;
  const goToNextUncertain = useCallback(() => {
    const uncertain = editing.state.uncertain;
    if (uncertain.length === 0) return;
    goTo(uncertain.find((s) => s.start > now.current + 0.05) ?? uncertain[0]);
  }, [editing.state.uncertain, goTo]);


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
    updateSegments: recording.actions.update,
    playFrom,
    onError,
    markAiStale: ai.actions.markStale,
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
    recording.actions.markTranscribing();
  }, [id, onTranscribe]);

  const startTranscriptionInLanguage = useCallback(async (selectedLanguage: string) => {
    if (!(await onTranscribe(id, selectedLanguage))) return;
    recording.actions.markTranscribing(selectedLanguage);
  }, [id, onTranscribe]);

  const saveRecordingTitle = useCallback(async (value: string) => {
    const trimmed = value.trim();
    setRenamingTitle(false);
    if (!trimmed || trimmed === title) return;
    try {
      await api.renameRecording(id, trimmed);
      recording.actions.rename(trimmed);
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
  const [transcriptMenu, setTranscriptMenu] = useState<{
    x: number;
    y: number;
    segment: Segment;
    time: number;
    /** Ids of the blocks a text selection was touching when the menu opened. */
    selected: string[];
  } | null>(null);

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
      /* Read here rather than when the item is clicked. Opening the menu can
         take the selection away — clicking inside it collapses it in some
         browsers — and by then the reader's passage would be gone. */
      selected: selectedSegmentIds(),
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


  const togglePanel = useCallback(() => {
    setPanelOpen((o) => {
      localStorage.setItem("panel", o ? "zavreny" : "otevreny");
      return !o;
    });
  }, []);

  const diarizeSpeakers = useCallback(() => onDiarize(id), [id, onDiarize]);

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
   *  sidebar's was missing `ai.state.running`, so while the model worked the header
   *  was correctly dead and the sidebar was still pressable — two answers to
   *  one question, several hundred lines apart. It sits under `running` because
   *  that is the one of the four that is derived rather than held. */
  const speakersBusy = segments.length === 0 || running || diarizing || ai.state.running;
  return (
    <main className="detail">
      <DetailHeader
        recording={{
          title,
          path,
          status,
          folder,
          language,
          // What this screen knows about a second language is the standing
          // offer; a language already written in shows on the archive card,
          // which reads the recording's own row.
          secondLanguage: secondLanguage.state.found?.language,
        }}
        busy={{ running, diarizing }}
        menu={{
          folders,
          onMoveToFolder,
          onCreateFolderFor,
          onExportAudio: () => onExportAudio(hasImproved),
          onRetranscribe: startTranscription,
          onTranscribeInLanguage: startTranscriptionInLanguage,
          /* Written on the recording, and on a finished transcript the fill
             starts at once — it reports like a run, so this screen learns of
             it the way it learns of any run, through `progress`. */
          onSecondLanguage: (language) =>
            void api
              .setSecondLanguageChoice(id, language)
              .then(() => secondLanguage.actions.reread())
              .catch((error) => onError(userMessage(error))),
          onDeleteTranscript: () =>
            setConfirmation({
              title: t("detail.header.deleteTranscriptTitle"),
              text: t("detail.header.deleteTranscriptText", { title: title || fileName(path) }),
              confirm: t("detail.header.deleteTranscriptConfirm"),
              destructive: true,
              action: async () => {
                await api.deleteTranscription(id);
                await load();
              },
            }),
          onRemove: () =>
            setConfirmation({
              title: t("detail.header.removeTitle"),
              text: t("detail.header.removeText", { title: title || fileName(path) }),
              confirm: t("detail.header.removeConfirm"),
              destructive: true,
              action: async () => {
                await api.deleteRecording(id);
                if (player.recordingId === id) player.close();
                onBack();
              },
            }),
        }}
        ai={ai}
        renaming={renamingTitle}
        onRenaming={setRenamingTitle}
        onRename={(name) => void saveRecordingTitle(name)}
        onBack={onBack}
        onNew={onNew}
        onSettings={onSettings}
        onOpenRecorder={onOpenRecorder}
        otherRecordingId={
          player.recordingId && player.recordingId !== id ? player.recordingId : null
        }
        onOpenOther={() => {
          if (player.recordingId) onOpenRecording(player.recordingId);
        }}
        onExport={() => onExportAudio(hasImproved)}
        onRecognizeSpeakers={recognizeSpeakers}
        speakersBusy={speakersBusy}
        speakersReady={speakersReady}
        hasSegments={segments.length > 0}
      />

      <DetailProgress
        running={running}
        diarizing={diarizing}
        progress={progress}
        aiRunning={ai.state.running}
        aiProgress={ai.state.progress}
        onCancelTranscription={() => void cancelTranscription()}
        onCancelAi={ai.actions.cancel}
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

      <NoticeBar notices={notices} />

      {/* Above the shortcuts, because it is news about this transcript rather
          than help with reading it — and it is the one thing on this screen
          that says the text in front of the reader is incomplete. */}
      {/* Not while anything runs on this recording. A fill started from the
          menu is a run like any other, and a bar still offering to start it —
          with the button live — beside the bubble that shows it running was
          two doors to one room. When the run ends the answer is read again,
          and a filled one draws nothing. */}
      {!running && segments.length > 0 && <SecondLanguageBar offer={secondLanguage} />}
      <ClipSaveDialog
        clip={clip}
        recordingId={id}
        chooseFile={(name) => save({ defaultPath: name })}
        chooseFolder={async () => {
          const chosen = await open({ directory: true });
          return typeof chosen === "string" ? chosen : null;
        }}
        onError={(message) => onError(userMessage(message))}
        onSaved={(paths) =>
          onInfo(
            paths.length === 1
              ? t("detail.clip.saved", { path: paths[0] })
              : tPlural("detail.clip.savedMany", paths.length)
          )
        }
      />

      {/* Only over a transcript: the shortcuts are about reading one. */}
      {segments.length > 0 && <TranscriptTips />}

      {/* Over the reading column, not in the header — that bar already
          overflows at 1180 px with both pills up — and not permanently, since
          this is wanted now and then rather than always. */}
      <div className={`detail-body ${panelOpen ? "" : "no-panel"}`}>
      <TranscriptSearch search={search} />

        <div className="transcript" ref={playback.state.listRef}>

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

      {transcriptMenu &&
        (() => {
          /* The passage the reader had marked, as its first and last block.
             Nothing to export when the selection touched only what is not a
             block, or when the transcript has moved under it since. */
          const touched = transcriptMenu.selected
            .map((id) => segments.find((s) => s.id === id))
            .filter((s): s is Segment => s !== undefined)
            .sort((a, b) => a.start - b.start);
          const selectedClip: [Segment, Segment] | null =
            touched.length > 0 ? [touched[0], touched[touched.length - 1]] : null;
          return (
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
            /* One item that reads as two, because it is one gesture: the first
               block starts the clip and any later one closes it. Two separate
               items would have made the reader decide which of them applies
               before they had a clip at all. */
            /* One way in, and it is the reader's own: drag over a passage,
               right-click, export it. It shows only when there is a passage,
               so the ordinary menu is no longer for it.

               There was a second way — mark a block, scroll, mark a later one,
               watch a bar over the transcript. It went the evening it was
               tried: a procedure to learn beside a gesture people already
               have. */
            ...(selectedClip
              ? [
                  {
                    label: t("detail.menu.clipSelection"),
                    icon: MENU_ICONS.clip,
                    action: () =>
                      clip.actions.markAndSave(selectedClip[0], selectedClip[1]),
                  },
                ]
              : []),
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
          );
        })()}

      {/* The one question about language editing, asked where it is wanted.
          It used to be a notice saying the feature was not ready and a button
          reading `Vybrat model`, which walked to the component list and asked
          which of three — a second question about something the first run had
          already answered, in a screen the reader had not asked to open. Now it
          is yes or no, with the size in the sentence, and yes starts the
          download behind this screen.

          Pressed again while that download is running it says so rather than
          offering again: asked once means once. */}
      <AiModelOffer ai={ai} />
      <AiToolsDialog ai={ai} />
      <AiPreviewDialog ai={ai} />

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

