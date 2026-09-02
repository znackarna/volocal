/**
 * The transcript screen's header: the way back, the name, and every pill the
 * screen offers.
 *
 * Pulled last, and the brief says why — earlier it would have been a component
 * with an enormous number of props and no state. It still has more than most,
 * because it *is* the screen's control surface, so what could be grouped has
 * been: the recording's own facts, what is busy, and the menu's actions each
 * arrive as one named thing rather than as six loose ones.
 *
 * It owns nothing. The two destructive items ask a question first, and the
 * question is the screen's — this only says which one was asked for.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { MiniPlayer } from "../player";
import { MiniRecorder } from "../recorder";
import { Wordmark } from "../Brand";
import NameDialog from "../NameDialog";
import RecordingActionsMenu from "../RecordingActionsMenu";
import { ExportMenu } from "./documents";
import { LineIcon } from "../icons";
import { fileName, statusClass } from "../types";
import type { Folder } from "../types";
import type { AiWorkspace } from "./ai/useAiWorkspace";

export function DetailHeader({
  recording,
  busy,
  menu,
  ai,
  renaming,
  onRenaming,
  onRename,
  onBack,
  onNew,
  onSettings,
  onOpenRecorder,
  onOpenOther,
  otherRecordingId,
  onExport,
  onRecognizeSpeakers,
  speakersBusy,
  speakersReady,
  hasSegments,
}: {
  /** What this screen is about. One object, because the header reads five of
   *  its fields and none of them mean anything apart. */
  recording: {
    title: string;
    path: string;
    status: string;
    folder: string | null;
    /** What the transcript is written in, so the menu does not offer it as the
     *  second language too. */
    language: string;
    /** And what it holds beside that, so the menu can show a language its own
     *  list does not offer — Welsh, Mongolian, any of the other eighty-odd
     *  whisper hears. */
    secondLanguage?: string | null;
  };
  /** What is already happening to it. */
  busy: { running: boolean; diarizing: boolean };
  /** Everything behind the three dots. The two destructive ones take no
   *  arguments: the header says what was asked for, the screen asks. */
  menu: {
    folders: Folder[];
    onMoveToFolder: (folder: string | null) => void;
    onCreateFolderFor: () => void;
    onExportAudio: () => void;
    onRetranscribe: () => void;
    onTranscribeInLanguage: (language: string) => void;
    onSecondLanguage: (language: string) => void;
    onDeleteTranscript: () => void;
    onRemove: () => void;
  };
  ai: AiWorkspace;
  renaming: boolean;
  onRenaming: (renaming: boolean) => void;
  onRename: (name: string) => void;
  onBack: () => void;
  onNew: () => void;
  onSettings: () => void;
  onOpenRecorder: () => void;
  /** Travels to whatever else is playing, when something else is. */
  onOpenOther: () => void;
  otherRecordingId: string | null;
  onExport: (format: string) => void;
  onRecognizeSpeakers: () => void;
  speakersBusy: boolean;
  speakersReady: boolean;
  hasSegments: boolean;
}) {
  const { t } = useI18n();

  /* The player pill compacts by measurement, not by a window-width guess
     (which shrank it with visible room to spare): it gives up its words the
     moment the recording's name starts losing letters, and grows back once
     the name is whole again with the pill's full width to spare. The two
     conditions cannot chase each other — expanding needs ~25 px more than
     compacting frees. */
  const leftRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  compactRef.current = compact;

  useEffect(() => {
    const left = leftRef.current;
    if (!left) return;
    /* The full pill is 290, the compact one 83; expanding costs the
       difference, plus breathing room so the pair of rules cannot flap. */
    const EXPAND_NEED = 232;
    const measure = () => {
      const name = left.querySelector<HTMLElement>(".detail-name");
      if (!name) return; // renaming — the span is an input right now
      const clipped = name.scrollWidth > name.clientWidth + 1;
      if (!compactRef.current) {
        if (clipped) setCompact(true);
        return;
      }
      /* The left column stretches, so its free room is the gap between its
         last piece of content and its own right edge. */
      const children = Array.from(left.children) as HTMLElement[];
      const last = children[children.length - 1];
      if (!last) return;
      const slack =
        left.getBoundingClientRect().right - last.getBoundingClientRect().right;
      if (!clipped && slack > EXPAND_NEED) setCompact(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(left);
    return () => observer.disconnect();
    /* `title` re-arms it: a rename changes the name's width without changing
       the observed column's box, so the observer alone would sleep through it. */
  }, [recording.title]);

  return (
      <div className="detail-header">
    <div ref={leftRef} className="detail-header-left">
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
        open={renaming}
        title={t("dialogs.rename.title")}
        text={t("dialogs.rename.text")}
        label={t("dialogs.rename.label")}
        placeholder={t("dialogs.rename.placeholder")}
        submitLabel={t("common.save")}
        initialName={recording.title || fileName(recording.path)}
        onClose={() => onRenaming(false)}
        onSubmit={onRename}
      />
      {(
        <>
          <h1 className="detail-title">
            <span className={`status-mark detail-status ${statusClass(recording.status)}`} aria-hidden />
            <span className="detail-name">{recording.title || fileName(recording.path)}</span>
          </h1>
          {!busy.running && !busy.diarizing && (
            <RecordingActionsMenu
              className="detail-title-menu"
              status={recording.status}
              onRename={() => onRenaming(true)}
              onExportAudio={menu.onExportAudio}
              folders={menu.folders}
              folder={recording.folder}
              onMoveToFolder={menu.onMoveToFolder}
              onCreateFolderFor={menu.onCreateFolderFor}
              onRetranscribe={menu.onRetranscribe}
              onDeleteTranscript={menu.onDeleteTranscript}
              onTranscribeInLanguage={menu.onTranscribeInLanguage}
              language={recording.language}
              secondLanguage={recording.secondLanguage}
              onSecondLanguage={menu.onSecondLanguage}
              onRemove={menu.onRemove}
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
      {otherRecordingId && (
        <MiniPlayer
          compact={compact}
          onOpen={onOpenOther}
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
        onClick={onRecognizeSpeakers}
        disabled={speakersBusy}
        title={speakersReady ? undefined : t("detail.header.speakersMissing")}
      >
        <LineIcon name="speakers" size={15} />
        {/* The name does not change when speakers exist — a door is not
            renamed because there is something behind it, which is the rule
            `AI nástroje` is named on. The running state stays: that is not
            a second name, it is the button saying it is busy. */}
        {busy.diarizing
          ? t("detail.speakers.diarizing")
          : t("detail.header.speakersButton")}
      </button>
      <button
        className={`button ai-edit-button ${ai.state.document ? "ready" : ""}`}
        onClick={() => void ai.actions.open()}
        disabled={!hasSegments || busy.running || ai.state.running}
        title={ai.state.document?.stale ? t("detail.header.staleHint") : undefined}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 1.5 9 5l3.5 1L9 7l-1 3.5L7 7 3.5 6 7 5l1-3.5ZM12.5 10l.55 1.95L15 12.5l-1.95.55L12.5 15l-.55-1.95L10 12.5l1.95-.55L12.5 10Z"
                stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
        </svg>
        {ai.state.document
          ? t("detail.header.improvedButton")
          : t("detail.header.improveButton")}
      </button>
      {/* Five format abbreviations side by side read as a toolbar and
          overpowered the file name. Saving is one action, not five. */}
      <ExportMenu
        disabled={!hasSegments}
        onChoose={onExport}
        hasAiDocument={!!ai.state.document && !ai.state.document.stale}
        onChooseAi={ai.actions.saveImproved}
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
  );
}
