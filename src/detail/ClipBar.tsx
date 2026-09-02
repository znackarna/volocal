/**
 * The line that stands over the transcript while a clip is marked.
 *
 * It says what is selected and offers the three things a person does with it:
 * hear it, save it, drop it. Nothing else — the choice of what to save is one
 * dialog further on, because most of the time the answer is "listen first".
 *
 * The same band as the missing-language bar, and deliberately not the same
 * colour: that one is news to act on, this one is a state the reader put the
 * screen into and can see the whole time.
 */
import { useI18n } from "../i18n";
import { formatTime } from "../types";
import type { ClipSelection } from "./useClipSelection";

export function ClipBar({ clip }: { clip: ClipSelection }) {
  const { t, tPlural } = useI18n();
  const { state, actions } = clip;

  if (!state.active) return null;

  return (
    <div className="clip-bar">
      <span className="clip-span">
        {formatTime(state.start)} → {formatTime(state.end)}
      </span>
      <span className="clip-length">{t("detail.clip.length", {
        length: formatTime(state.seconds),
      })}</span>
      <span className="clip-hint">
        {state.to
          ? tPlural("detail.clip.blocks", state.inside.size)
          : t("detail.clip.pickEnd")}
      </span>
      <button className="button" onClick={actions.play}>
        {t("detail.clip.play")}
      </button>
      <button className="button primary" onClick={actions.openSave}>
        {t("detail.clip.save")}
      </button>
      <button className="button quiet" onClick={actions.clear}>
        {t("common.cancel")}
      </button>
    </div>
  );
}
