/**
 * The one question `Vylepšit` asks: which of two ways the transcript is
 * rewritten.
 *
 * It used to carry more. Speaker recognition stood in it, and then an
 * instruction field stood where that had been. Both left on the owner's
 * realisation that a document made from an instruction is a *further* thing —
 * *nejdřív prostě MUSÍ být vylepšený přepis a pak teprve další věci* — so
 * offering it beside the two cards that make what it needs was offering step
 * two next to step one. It lives in the reading window's fourth tab.
 */
import { useI18n } from "../../i18n";
import { useDialog } from "../../useDialog";
import type { AiWorkspace } from "./useAiWorkspace";

export function AiToolsDialog({ ai }: { ai: AiWorkspace }) {
  const { t } = useI18n();
  const { state, actions } = ai;

  /* Escape closes it. A hook cannot live inside the conditional that renders
     the dialog, so it stands here and is told whether the dialog is up. */
  const dialog = useDialog<HTMLDivElement>(actions.closeDialog, state.dialog === "configure");

  if (state.dialog !== "configure") return null;

  return (
      
    <div className="dialog-overlay" role="presentation" onMouseDown={() => actions.closeDialog()}>
      <div ref={dialog} className="dialog ai-edit-dialog" role="dialog" aria-modal="true"
           aria-labelledby="ai-configure-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="ai-configure-title">{t("detail.ai.configureTitle")}</h2>
        <p>{t("detail.ai.configureText")}</p>
        <div className="choices ai-edit-modes">
          <button className={`choice with-icon ${state.mode === "faithful" ? "chosen" : ""}`}
                  onClick={() => actions.chooseMode("faithful")}>
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
          <button className={`choice with-icon ${state.mode === "clean" ? "chosen" : ""}`}
                  onClick={() => actions.chooseMode("clean")}>
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
          <button className="button quiet" onClick={() => actions.closeDialog()}>
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
          <button className="button primary" onClick={() => void actions.startEdit(state.mode)}>
            {t("detail.ai.startEdit")}
          </button>
        </div>
      </div>
    </div>
  );
}
