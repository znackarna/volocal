import { useEffect, useRef } from "react";

export interface ConfirmationRequest {
  nadpis: string;
  text: string;
  /** Label of the confirming button, for example "Odebrat" */
  confirm: string;
  /** An irreversible action is set apart by colour */
  nicive?: boolean;
  action: () => void;
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
}: {
  query: ConfirmationRequest | null;
  onZavri: () => void;
}) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

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
            Zrušit
          </button>
          <button
            ref={confirmButtonRef}
            className={`tlacitko ${query.nicive ? "nicive" : "hlavni"}`}
            onClick={() => {
              query.action();
              onZavri();
            }}
          >
            {query.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
