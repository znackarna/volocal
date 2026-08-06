import { useEffect, useRef } from "react";

import { useI18n } from "./i18n";

export interface ConfirmationRequest {
  nadpis: string;
  text: string;
  /** Label of the confirming button, for example "Remove" */
  confirm: string;
  /** An irreversible action is set apart by colour */
  nicive?: boolean;
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
  onZavri,
  onError,
}: {
  query: ConfirmationRequest | null;
  onZavri: () => void;
  /** Where a rejected action is reported. Without it the failure is silent. */
  onError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  /** Closes first, then waits: the dialog answered the question and has no
   *  business staying on screen while the work runs. A rejection is reported
   *  rather than dropped. */
  const run = async (action?: () => void | Promise<void>) => {
    onZavri();
    try {
      await action?.();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!query) return;
    // Focus starts on Cancel rather than on the confirming button: for an
    // irreversible action, a blind Enter must not delete anything.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onZavri();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [query, onZavri]);

  if (!query) return null;

  return (
    <div className="prekryv-dialogu" onMouseDown={onZavri}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-nadpis"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-nadpis">{query.nadpis}</h2>
        <p>{query.text}</p>
        <div className="dialog-patka">
          <button className="tlacitko" onClick={onZavri} autoFocus>
            {t("common.cancel")}
          </button>
          {query.alternative && (
            <button
              className="tlacitko"
              onClick={() => {
                void run(query.alternative?.action);
              }}
            >
              {query.alternative.label}
            </button>
          )}
          <button
            ref={confirmButtonRef}
            className={`tlacitko ${query.nicive ? "nicive" : "hlavni"}`}
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
