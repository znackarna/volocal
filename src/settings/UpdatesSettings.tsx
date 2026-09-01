/**
 * The `Aktualizace` tab: which version is running, and whether there is a
 * newer one.
 *
 * `UpdateCheck` does the asking and the fetching; this is the card around it.
 * The version stood on `Informace` and moved here, because this is the tab
 * where it can be acted on.
 */
import { useI18n } from "../i18n";
import { UpdateCheck } from "./updates";
import type { Settings } from "../types";

export function UpdatesSettings({
  n,
  save,
  found,
  onError,
  onInfo,
}: {
  n: Settings;
  save: (next: Settings) => void;
  /** What the check at start-up found, so arriving from the notice shows the
   *  version rather than an empty panel. */
  found: { version: string; notes: string } | null;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}) {
  const { t } = useI18n();

  return (
      (
        <section className="settings-card-updates">
          <h2>{t("settings.tab.updates")}</h2>
          <p className="settings-section-description">{t("settings.updates.description")}</p>
          <UpdateCheck
            onError={onError}
            onInfo={onInfo}
            automatic={n.update_check_automatic}
            onAutomaticChange={(on) => save({ ...n, update_check_automatic: on })}
            found={found}
          />
        </section>
      )
  );
}
