/**
 * The windows that stand over whichever screen is open.
 *
 * Presentational, and deliberately kept that way: the brief that asked for
 * this file also warned that it must not become a second manager of the
 * application. Nothing here decides anything — the folder dialog reports a
 * name, the speaker question reports an answer, the drag overlay reports
 * nothing at all.
 *
 * **What is not here.** `AddRecordingDialog` stayed in the shell. Its handler
 * is the shell's own gate — a fresh take goes through the same door as every
 * other start, so the speaker question and the busy guard apply to it — and
 * moving the markup here would have left the decision behind and carried only
 * the frame.
 */
import { useI18n } from "../i18n";
import ConfirmationDialog from "../ConfirmationDialog";
import NameDialog from "../NameDialog";
import SpeakerCountDialog from "../SpeakerCountDialog";
import Tooltips from "../Tooltips";
import type { ConfirmationRequest } from "../ConfirmationDialog";
import type { FolderManagement } from "./useFolderManagement";

export function AppDialogs({
  folders,
  query,
  onCloseQuery,
  onError,
  pendingTranscription,
  suggestedSpeakers,
  onCancelSpeakers,
  onAnswerSpeakers,
  dragging,
  automatic,
}: {
  folders: FolderManagement;
  query: ConfirmationRequest | null;
  onCloseQuery: () => void;
  onError: (message: string) => void;
  /** Recordings waiting for the speaker question before they start. */
  pendingTranscription: { ids: string[] } | null;
  suggestedSpeakers: number;
  onCancelSpeakers: () => void;
  onAnswerSpeakers: (count: number | null, names: string[]) => void;
  dragging: boolean;
  /** Whether a dropped file is transcribed by itself, which is what the
   *  overlay promises. */
  automatic: boolean;
}) {
  const { t } = useI18n();
  const dialog = folders.state.dialog;

  return (
    <>
      <NameDialog
        open={dialog !== null}
        title={t(
          dialog?.mode === "rename"
            ? "dialogs.folder.renameTitle"
            : "dialogs.folder.createTitle"
        )}
        text={t("dialogs.folder.text")}
        label={t("dialogs.folder.label")}
        placeholder={t("dialogs.folder.placeholder")}
        submitLabel={t(dialog?.mode === "rename" ? "common.save" : "dialogs.folder.create")}
        initialName={dialog?.mode === "rename" ? dialog.folder.name : ""}
        onClose={folders.actions.closeDialog}
        onSubmit={(name) => void folders.actions.submit(name)}
      />

      <ConfirmationDialog query={query} onClose={onCloseQuery} onError={onError} />

      {pendingTranscription && (
        <SpeakerCountDialog
          recordingCount={pendingTranscription.ids.length}
          suggested={suggestedSpeakers}
          onCancel={onCancelSpeakers}
          onConfirm={onAnswerSpeakers}
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
    </>
  );
}
