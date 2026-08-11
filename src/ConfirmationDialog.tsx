import { useI18n } from "./i18n";
import { useDialog } from "./useDialog";

export interface ConfirmationRequest {
  title: string;
  text: string;
  /** Label of the confirming button, for example "Remove" */
  confirm: string;
  /** An irreversible action is set apart by colour */
  destructive?: boolean;
  /** May be async: every caller in the application passes one. Typed as
   *  returning `void` it swallowed the rejection — a failed deletion closed
   *  the dialog, left the list unreloaded, and said nothing at all. */
  action: () => void | Promise<void>;
  /** A second way out, for a question with two answers rather than one —
   *  deleting a folder can keep or discard what is inside it. Quiet, so the
   *  named confirming button stays the one the eye lands on. */
  alternative?: { label: string; action: () => void | Promise<void> };
}

/**
 * Confirmation dialog for irreversible actions.
 *
 * The native `confirm()` inside a webview looks like a browser warning and
 * cannot be brought in line with the rest of the app.
 */
export default function ConfirmationDialog({
  query,
  onClose,
  onError,
}: {
  query: ConfirmationRequest | null;
  onClose: () => void;
  /** Where a rejected action is reported. Without it the failure is silent. */
  onError?: (message: string) => void;
}) {
  const { t } = useI18n();
  // Escape and the focus trap are one shared rule now; the focus itself starts
  // on Cancel rather than on the confirming button, because for an
  // irreversible action a blind Enter must not delete anything.
  const dialog = useDialog<HTMLDivElement>(onClose, query != null);

  /** Closes first, then waits: the dialog answered the question and has no
   *  business staying on screen while the work runs. A rejection is reported
   *  rather than dropped. */
  const run = async (action?: () => void | Promise<void>) => {
    onClose();
    try {
      await action?.();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  };

  if (!query) return null;

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title">{query.title}</h2>
        <p>{query.text}</p>
        <div className="dialog-footer">
          <button className="button" onClick={onClose} autoFocus>
            {t("common.cancel")}
          </button>
          {query.alternative && (
            <button
              className="button"
              onClick={() => {
                void run(query.alternative?.action);
              }}
            >
              {query.alternative.label}
            </button>
          )}
          <button
            className={`button ${query.destructive ? "destructive" : "primary"}`}
            onClick={() => {
              void run(query.action);
            }}
          >
            {query.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
