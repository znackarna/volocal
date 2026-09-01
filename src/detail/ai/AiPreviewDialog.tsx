/**
 * The reading window: the improved transcript and everything made from it.
 *
 * All four tabs are drawn whether or not there is anything behind them. The
 * first three used to appear only with an improved transcript, because the
 * middle two are made *from* it and Rust refuses them without one — a true
 * statement about what can be produced, answered in the wrong place. Hiding a
 * tab hides the subject, and a window showing one pill reads as broken rather
 * than as empty. Where a document cannot be made yet, the tab says so and
 * offers the step that comes first.
 *
 * It draws what `useAiWorkspace` holds and owns nothing itself.
 */
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { useDialog } from "../../useDialog";
import { useLabels } from "../../labels";
import InfoNote from "../../InfoNote";
import Select from "../../Select";
import {
  DiscardIcon,
  DocumentSaveMenu,
  DocumentViewIcon,
  RegenerateIcon,
  SUMMARY_LENGTHS,
  SUMMARY_LENGTH_KEYS,
  TRANSLATION_LANGUAGES,
} from "../documents";

import type { AiWorkspace } from "./useAiWorkspace";
import type { TranslationLanguage } from "../documents";

/**
 * One document, in paragraphs, with the scroll the fade above it needs.
 *
 * Five tabs showed the same four lines each — split on blank lines, one
 * paragraph per piece — and the scroll listener would have been a sixth copy of
 * the same thing. Splitting text into paragraphs is one decision and belongs in
 * one place.
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

export function AiPreviewDialog({ ai }: { ai: AiWorkspace }) {
  const { t } = useI18n();
  const labels = useLabels();
  const { state, actions } = ai;

  /* Escape closes it. A hook cannot live inside the conditional that renders
     the dialog, so it stands here and is told whether the dialog is up. */
  const dialog = useDialog<HTMLDivElement>(actions.closeDialog, state.dialog === "preview");

  // Language names come from the shared dictionary, so a language change moves
  // them too — a module constant would keep whatever it was born with.
  const translationLanguageItems = useMemo(
    () => TRANSLATION_LANGUAGES.map((code) => ({
      value: code,
      label: labels.languageCapitalized(code),
    })),
    [labels]
  );

  if (state.dialog !== "preview") return null;
  if (!state.document && state.customDocuments.length === 0) return null;

  return (
        <div className="dialog-overlay" role="presentation" onMouseDown={() => actions.closeDialog()}>
      <div ref={dialog}
           className={`dialog ai-preview-dialog${state.previewScrolled ? " scrolled" : ""}`}
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
          <button className="icon-button" onClick={() => actions.closeDialog()}
                  aria-label={t("detail.preview.closeLabel")} title={t("common.close")}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {state.previewTab !== "custom" && state.document?.stale && (
          <div className="ai-preview-warning">{t("detail.preview.staleWarning")}</div>
        )}
        {/* A custom document is compared against the transcript alone: no
            model is named in it, and nothing about it becomes wrong
            because a different editing model was chosen since. */}
        {state.previewTab === "custom" && state.document && state.customDocument?.stale && (
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
          <button className={state.previewTab === "improved" || state.previewTab === "original" ? "active" : ""}
                  onClick={() => actions.showTab("improved")} role="tab"
                  aria-selected={state.previewTab === "improved" || state.previewTab === "original"}>
            <DocumentViewIcon view="improved" />
            {t("detail.preview.transcriptTab")}
          </button>
          <button className={state.previewTab === "summary" ? "active" : ""}
                  onClick={() => actions.showTab("summary")} role="tab"
                  aria-selected={state.previewTab === "summary"}>
            <DocumentViewIcon view="summary" />
            {t("detail.preview.summaryTab")}
          </button>
          <button className={state.previewTab === "translation" ? "active" : ""}
                  onClick={() => actions.showTab("translation")} role="tab"
                  aria-selected={state.previewTab === "translation"}>
            <DocumentViewIcon view="translation" />
            {t("detail.preview.translationTab")}
          </button>
          <button className={state.previewTab === "custom" ? "active" : ""}
                  onClick={() => actions.showTab("custom")} role="tab"
                  aria-selected={state.previewTab === "custom"}>
            <DocumentViewIcon view="custom" />
            {t("detail.preview.customTab")}
          </button>
        </nav>

        {/* The three toolbars pick a variant of a document. With no
            improved transcript there is no document to vary, so they stay
            down and the empty state below carries the whole tab — a length
            chosen for a summary that cannot be made is a control with
            nothing behind it. */}
        {(state.previewTab === "improved" || state.previewTab === "original") && state.document && (
          <div className="ai-output-toolbar">
            <div className="ai-output-options" role="radiogroup"
                 aria-label={t("detail.preview.versionLabel")}>
              <button className={state.previewTab === "improved" ? "active" : ""}
                      onClick={() => actions.showTab("improved")} role="radio"
                      aria-checked={state.previewTab === "improved"}>
                {t("detail.preview.versionImproved")}
              </button>
              <button className={state.previewTab === "original" ? "active" : ""}
                      onClick={actions.showOriginal} role="radio"
                      aria-checked={state.previewTab === "original"}>
                {t("detail.preview.versionOriginal")}
              </button>
            </div>
          </div>
        )}
        {state.previewTab === "summary" && state.document && (
          <div className="ai-output-toolbar">
            {/* The three names say what they are. The group keeps its
                accessible label for anyone who cannot see them. */}
            <div className="ai-output-options" role="radiogroup"
                 aria-label={t("detail.preview.lengthGroupLabel")}>
              {SUMMARY_LENGTHS.map((option) => (
                <button key={option}
                        className={state.summaryLength === option ? "active" : ""}
                        onClick={() => actions.chooseSummaryLength(option)}
                        title={t(SUMMARY_LENGTH_KEYS[option].description)} role="radio"
                        aria-checked={state.summaryLength === option}>
                  {t(SUMMARY_LENGTH_KEYS[option].label)}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.previewTab === "translation" && state.document && (
          <div className="ai-output-toolbar">
            {/* No visible label: the tab above says Překlad and the value
                in the control is a language. `Select` carries its own
                accessible name through `description`. */}
            <Select
              value={state.translationLanguage}
              items={translationLanguageItems}
              description={t("detail.preview.translationLanguageLabel")}
              onChange={(value) => actions.chooseTranslationLanguage(value as TranslationLanguage)}
            />
          </div>
        )}

        {/* The instruction stands above its answer and stays editable
            there: rewriting it is how the next document is asked for, and
            the moment it changes the answer below is no longer to this
            question — the tab says so by going back to its empty state. */}
        {state.previewTab === "custom" && state.document && (
          <div className="ai-output-toolbar ai-custom-bar">
            <div className="field ai-custom-field">
              <label htmlFor="ai-custom-prompt-preview">{t("detail.custom.label")}</label>
              <textarea
                id="ai-custom-prompt-preview"
                rows={3}
                value={state.customPrompt}
                placeholder={t("detail.custom.placeholder")}
                onChange={(event) => actions.writePrompt(event.target.value)}
              />
              {/* The same note under the same field, from the same key. The
                  tab is reached after the dialog, but it is also where the
                  instruction is rewritten, and a reassurance that appears
                  only the first time is one the reader cannot go back to. */}
              <InfoNote>{t("detail.custom.privacy")}</InfoNote>
            </div>
          </div>
        )}

        {state.previewTab === "improved" && state.document && (
          <PreviewText text={state.document.text} onScrolled={actions.noteScrolled} />
        )}
        {state.previewTab === "original" && (
          <PreviewText text={state.originalPreview || t("common.loading")} onScrolled={actions.noteScrolled} />
        )}
        {state.previewTab === "summary" && state.summaryOutput && (
          <PreviewText text={state.summaryOutput.text} onScrolled={actions.noteScrolled} />
        )}
        {state.previewTab === "translation" && state.translationOutput && (
          <PreviewText text={state.translationOutput.text} onScrolled={actions.noteScrolled} />
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
        {!state.document && (
          <div className="ai-preview-empty">
            <span className="ai-preview-empty-icon" aria-hidden>
              <DocumentViewIcon view="improved" />
            </span>
            <h3>{t("detail.preview.emptyTitle")}</h3>
            <p>
              {t(state.previewTab === "improved" || state.previewTab === "original"
                ? "detail.preview.emptyText"
                : "detail.preview.emptyDerived")}
            </p>
            <button className="button primary"
                    onClick={() => actions.openConfiguration("faithful")}>
              {t("detail.ai.startEdit")}
            </button>
          </div>
        )}
        {state.previewTab === "summary" && state.document && !state.summaryOutput && (
          <div className="ai-preview-empty">
            <span className="ai-preview-empty-icon" aria-hidden>
              <DocumentViewIcon view="summary" />
            </span>
            {/* A whole sentence per length: the adjective is declined and
                lower-casing a label is not a translation. */}
            <h3>{t(SUMMARY_LENGTH_KEYS[state.summaryLength].heading)}</h3>
            <p>{t("detail.summary.emptyText")}</p>
            <button className="button primary"
                    onClick={() => actions.startOutput("summary", state.summaryLength)}>
              {t("detail.summary.create")}
            </button>
          </div>
        )}
        {state.previewTab === "translation" && state.document && !state.translationOutput && (
          <div className="ai-preview-empty">
            <span className="ai-preview-empty-icon" aria-hidden>
              <DocumentViewIcon view="translation" />
            </span>
            <h3>{t("detail.translation.emptyTitle")}</h3>
            <p>{t("detail.translation.emptyText")}</p>
            <button className="button primary"
                    onClick={() => actions.startOutput("translation", state.translationLanguage)}>
              {t("detail.translation.create")}
            </button>
          </div>
        )}
        {state.previewTab === "custom" && state.document && state.customDocument && (
          <PreviewText text={state.customDocument.text} onScrolled={actions.noteScrolled} />
        )}
        {state.previewTab === "custom" && state.document && !state.customDocument && (
          <div className="ai-preview-empty">
            <span className="ai-preview-empty-icon" aria-hidden>
              <DocumentViewIcon view="custom" />
            </span>
            <h3>{t("detail.custom.title")}</h3>
            <p>{t("detail.custom.emptyText")}</p>
            <button className="button primary" onClick={actions.startCustomDocument}
                    disabled={!state.writtenPrompt}>
              {t("detail.custom.create")}
            </button>
          </div>
        )}

        {/* Copy and Save act on a text, so the footer follows whether
            there is one. With no improved transcript there is none on any
            tab — the empty state has the whole window and carries its own
            single button, which is the only thing to do from here. */}
        {state.document
          && (state.previewTab === "improved" || state.previewTab === "original"
            || (state.previewTab === "summary" && state.summaryOutput)
            || (state.previewTab === "translation" && state.translationOutput)
            || (state.previewTab === "custom" && state.customDocument)) && (
          <div className="dialog-footer ai-preview-actions">
            {state.previewTab === "improved" && state.document && (
              <button className="button quiet danger" onClick={() => void actions.discard()}>
                <DiscardIcon />
                {t("detail.preview.discard")}
              </button>
            )}
            {state.previewTab === "improved" && state.document && (
              <button className="button quiet" onClick={actions.regenerate}>
                <RegenerateIcon />
                {t("detail.preview.regenerateImproved")}
              </button>
            )}
            {state.previewTab === "custom" && state.customDocument && (
              <button className="button quiet" onClick={actions.startCustomDocument}>
                <RegenerateIcon />
                {t("detail.preview.regenerateCustom")}
              </button>
            )}
            {state.previewTab === "summary" && state.summaryOutput && (
              <button className="button quiet"
                      onClick={() => actions.startOutput("summary", state.summaryLength)}>
                <RegenerateIcon />
                {t("detail.preview.regenerateSummary")}
              </button>
            )}
            {state.previewTab === "translation" && state.translationOutput && (
              <button className="button quiet"
                      onClick={() => actions.startOutput("translation", state.translationLanguage)}>
                <RegenerateIcon />
                {t("detail.preview.regenerateTranslation")}
              </button>
            )}
            <button className="button" onClick={actions.copyPreview}
                    disabled={!state.previewText.trim()}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6"
                      stroke="currentColor" strokeWidth="1.35" />
                <path d="M10.8 5.2V3.9c0-.8-.7-1.4-1.5-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.4c0 .8.6 1.5 1.4 1.5h1.3"
                      stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
              </svg>
              {t("common.copy")}
            </button>
            <DocumentSaveMenu disabled={!state.previewText.trim()} onChoose={actions.savePreview} />
          </div>
        )}
      </div>
    </div>
  );
}
