/**
 * The strip of keyboard shortcuts over the transcript.
 *
 * Nobody discovers them otherwise, and Tab is the most useful thing this
 * screen does.
 *
 * It owns whether it is up, because nothing else on the screen reads that.
 * What it must not own is the preference: `localStorage["rychle-tipy"]` is
 * also written by the switch on `Rozhraní` in Settings, and the two agree
 * because they agree on one key and one pair of values — `skryte` is hidden
 * and anything else, absent included, is shown. A strip somebody dismissed
 * stays dismissed.
 *
 * The way back is deliberately not here. It used to be, beside the player, and
 * the owner preferred the switch in Settings once he had seen both. Hiding
 * without a way back at all is the one thing neither of them wanted.
 */
import { useCallback, useState } from "react";
import { useI18n } from "../i18n";

const KEY = "rychle-tipy";

export function TranscriptTips() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(() => localStorage.getItem(KEY) !== "skryte");

  const hide = useCallback(() => {
    localStorage.setItem(KEY, "skryte");
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="shortcuts">
      <span className="shortcuts-title">{t("detail.tips.title")}</span>
      {/* A shortcut is a key and what it does, not a sentence: the key name
          sits in <kbd> and the action beside it. */}
      <span><kbd>{t("detail.tips.spaceKey")}</kbd> {t("detail.tips.spaceAction")}</span>
      <span><kbd>{t("detail.tips.clickKey")}</kbd> {t("detail.tips.clickAction")}</span>
      <span>
        <kbd>{t("detail.tips.doubleClickKey")}</kbd> {t("detail.tips.doubleClickAction")}
      </span>
      <span className="shortcut-emphasis">
        <kbd>{t("detail.tips.tabKey")}</kbd> {t("detail.tips.tabAction")}
      </span>
      <button
        className="shortcuts-hide"
        onClick={hide}
        aria-label={t("detail.tips.hide")}
        title={t("detail.tips.hideHint")}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
