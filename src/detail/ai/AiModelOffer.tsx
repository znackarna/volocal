/**
 * The two dialogs that only exist because language editing could not run.
 *
 * One asks whether to fetch what is missing. The other appears after the
 * machine failed to *load* the model it has, and offers the one below it.
 *
 * They are one file because they are one subject — the model this computer can
 * actually run — and because neither is ever up at the same time as the other.
 */
import { useI18n } from "../../i18n";
import { useDialog } from "../../useDialog";
import { useFormats } from "../../formats";
import type { AiWorkspace } from "./useAiWorkspace";

export function AiModelOffer({ ai }: { ai: AiWorkspace }) {
  const { t } = useI18n();
  const { dataSize } = useFormats();
  const { state, actions } = ai;

  /* Escape closes both. They were among the four dialogs the keyboard could do
     nothing in — closable only by clicking the overlay. One `useDialog` each,
     because a hook cannot live inside the conditional that renders them. */
  const missingDialog = useDialog<HTMLDivElement>(actions.closeDialog, state.dialog === "missing");
  const smallerDialog = useDialog<HTMLDivElement>(actions.dismissSmallerOffer, !!state.smallerOffer);

  return (
    <>
      {state.dialog === "missing" && (
        <div className="dialog-overlay" role="presentation" onMouseDown={actions.closeDialog}>
          <div ref={missingDialog} className="dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-missing-title"
               onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ai-missing-title">
              {t(state.editorDownloading ? "detail.ai.downloadingTitle" : "detail.ai.offerTitle")}
            </h2>
            <p>
              {state.editorDownloading
                ? t("detail.ai.downloadingText")
                : t("detail.ai.offerText", {
                    size: dataSize(state.editorOffer?.megabytes ?? 0),
                  })}
            </p>
            <div className="dialog-footer">
              <button className="button quiet" onClick={actions.closeDialog}>
                {t("common.close")}
              </button>
              {!state.editorDownloading && (
                <button className="button primary" onClick={() => void actions.acceptEditorOffer()}>
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
      {state.smallerOffer && (
        <div className="dialog-overlay" role="presentation"
             onMouseDown={actions.dismissSmallerOffer}>
          <div ref={smallerDialog} className="dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-smaller-title"
               onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ai-smaller-title">{t("detail.smaller.title")}</h2>
            <p>
              {t(state.smallerOffer.installed
                ? "detail.smaller.text"
                : "detail.smaller.textDownload")}
            </p>
            <div className="dialog-footer">
              <button className="button quiet" onClick={actions.dismissSmallerOffer}>
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
              <button className="button quiet" onClick={() => void actions.retrySameEditor()}>
                {t("detail.smaller.again")}
              </button>
              <button className="button primary" onClick={() => void actions.takeSmallerEditor()}>
                {t(state.smallerOffer.installed
                  ? "detail.smaller.switch"
                  : "detail.smaller.download")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
