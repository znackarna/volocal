/**
 * The one line that says a language is missing from this transcript.
 *
 * It appears only when a sweep found one and the reader has not answered, which
 * on almost every recording is never. That is deliberate: a feature that shows
 * nothing on an ordinary recording costs its reader no attention at all.
 *
 * One question, one button. The reader is not asked which language, or which
 * part, or how — the sweep already knows, and a question somebody cannot answer
 * from what is in front of them is not a question worth asking.
 */
import { useI18n } from "../i18n";
import { useLabels } from "../labels";
import { LineIcon } from "../icons";
import type { SecondLanguageOffer } from "./useSecondLanguage";

export function SecondLanguageBar({ offer }: { offer: SecondLanguageOffer }) {
  const { t } = useI18n();
  /* The names the whole application uses, rather than a list of its own. This
     bar kept seven of them and shouted the bare code for everything else —
     "V nahrávce se mluví také CY", reported on 2026-09-02 on a recording
     whisper misheard as Welsh. Whisper can name ninety-nine languages and the
     dictionary now names all of them; a list here could only fall behind it
     again. */
  const labels = useLabels();
  const { state, actions } = offer;

  if (!state.offered || !state.found) return null;

  const language = labels.language(state.found.language);

  return (
    <div className="second-language">
      <LineIcon name="transcription" />
      <span className="second-language-text">
        {t("detail.secondLanguage.missing", { language })}
      </span>
      <button className="button" onClick={() => void actions.fill()} disabled={state.filling}>
        {state.filling
          ? t("detail.secondLanguage.filling")
          : t("detail.secondLanguage.fill")}
      </button>
      <button
        className="button quiet"
        onClick={() => void actions.refuse()}
        disabled={state.filling}
      >
        {t("detail.secondLanguage.no")}
      </button>
    </div>
  );
}
