/**
 * The strip of tabs across the top of Settings.
 *
 * Draws the seven names and reports which one was pressed. It owns nothing —
 * where the reader is and where they were last are both the screen's, because
 * arriving from a notice is not the same as going somewhere, and only one of
 * those two is written down.
 *
 * The dot on `Nástroje` follows the status band, which stands there because
 * that is where what is installed is read.
 */
import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";

export function SettingsNavigation<Tab extends string>({
  tabs,
  labels,
  active,
  onSelect,
  alertOn,
  alertLabel,
}: {
  tabs: readonly Tab[];
  labels: Record<Tab, TranslationKey>;
  active: Tab;
  onSelect: (tab: Tab) => void;
  /** Which tab wears the dot, when anything does. */
  alertOn?: Tab | null;
  alertLabel: string;
}) {
  const { t } = useI18n();

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const current = tabs.findIndex((tab) => tab === active);
      let next = current;
      if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      const tab = tabs[next];
      onSelect(tab);
      // After the render that moves `tabIndex`, or the focus lands on a button
      // the strip has just made unreachable by keyboard.
      requestAnimationFrame(() => document.getElementById(`settings-tab-${tab}`)?.focus());
    },
    [active, onSelect, tabs]
  );

  return (
    <nav className="settings-tabs" role="tablist" aria-label={t("settings.groups")}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`settings-tab-${tab}`}
          aria-selected={active === tab}
          aria-controls="settings-panel"
          className={active === tab ? "active" : ""}
          tabIndex={active === tab ? 0 : -1}
          onClick={() => onSelect(tab)}
          onKeyDown={onKeyDown}
        >
          <span>{t(labels[tab])}</span>
          {alertOn === tab && (
            <span className="settings-tab-alert" aria-label={alertLabel} />
          )}
        </button>
      ))}
    </nav>
  );
}
