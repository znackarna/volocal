/**
 * The `Nástroje` tab: what is on the disk, and where it lives.
 *
 * The band of components stood at the foot of `Přepis`, one card away from the
 * model chooser it feeds — but whether anything is missing is a fact about
 * this machine, not about how a transcript is made.
 */
import { useI18n } from "../i18n";
import { useFormats } from "../formats";
import InfoNote from "../InfoNote";
import { LineIcon } from "../icons";
import { UNOFFERED_COMPONENTS } from "../types";
import type { DownloadComponent, Settings, ToolCheck } from "../types";

export function ToolsSettings({
  n,
  check,
  modules,
  diskUsed,
  fetching,
  onToModule,
  onSelectDirectory,
}: {
  n: Settings;
  check: ToolCheck | null;
  /** Every component the catalogue knows, with what is on the disk. */
  modules: DownloadComponent[];
  /** How much room they take, once it has been counted. */
  diskUsed: number | null;
  /** Something is being fetched right now. */
  fetching: boolean;
  onToModule: (module?: string) => void;
  onSelectDirectory: (key: "bin_directory" | "models_directory") => void;
}) {
  const { t, tPlural, formatNumber } = useI18n();
  const formats = useFormats();

  const missingRequired = check?.issues ?? [];
  /** What the fraction counts. The components nobody is offered do appear once
   *  they are on the disk, because a machine set up before 14 August 2026 may
   *  be running on one. */
  const offeredModules = modules.filter(
    (module) => module.complete || !UNOFFERED_COMPONENTS.includes(module.id)
  );

  return (
    <>
      <section className="settings-card-modules">
        <h2>{t("settings.modules.title")}</h2>
        <p className="settings-section-description">
          {t("settings.modules.description")}
        </p>

        {/* What you have, and what it costs — *chtělo by to tam nějaký
            dashboard, třeba 33 modelů, celkem zabraného místa*. Two rows and
            not six: this answers the question somebody arrives with, and a
            column of statistics is a diagnostics panel, which is the kind of
            thing this branch deleted today.

            `.about-panel about-panel-marked` — the `dl` of label and
            right-aligned value that `Informace` uses, in its variant with a
            30 px `.about-mark` on every row, at the owner's ask for icons.
            **Both rows carry one or neither would**, which is the rule that
            panel was given this morning: a panel where some rows have a mark
            and some do not reads as an accident. The two glyphs are the two
            subjects — what arrived, and the disk it sits on — rather than
            decoration; a mark a reader tries to read and cannot is worse than
            no mark.

            **The count is a fraction**, `12 z 13`, and it is counted here
            rather than in Rust: it is installed out of *offered*, and which
            components the application offers is this screen's own knowledge —
            `UNOFFERED_COMPONENTS`. Counted from the same rows the by-hand
            listing draws, so a reader who doubts the number can go and count
            them. A bare total answers nothing anybody wanted; the fraction
            answers *is anything missing*, which is the question this card is
            about and what the sentence below it says in words.

            **The size is measured on the disk**, in Rust, and is the size of the
            tools and models folders. Adding up the catalogue's own `megabytes`
            would have been one line of TypeScript and a number that is wrong:
            they are hand-written constants, ffmpeg's said 85 against an actual
            106 for months, and a total labelled *zabrané místo* that nobody can
            reconcile with their own disk is worse than no total at all. */}
        {diskUsed !== null && modules.length > 0 && (
          <dl className="about-panel about-panel-marked">
            <div className="about-row">
              <dt>
                <span className="about-mark"><LineIcon name="download" size={17} /></span>
                {t("settings.modules.installedCount")}
              </dt>
              <dd>
                {t("settings.modules.installedOf", {
                  count: formatNumber(modules.filter((module) => module.complete).length),
                  total: formatNumber(offeredModules.length),
                })}
              </dd>
            </div>
            <div className="about-row">
              <dt>
                <span className="about-mark"><LineIcon name="disk" size={17} /></span>
                {t("settings.modules.diskUsed")}
              </dt>
              <dd>{formats.dataSize(diskUsed)}</dd>
            </div>
          </dl>
        )}

        {/* Three states, not two. What is missing, what is arriving, and what is
            complete — and until 2026-08-17 the middle one wore the clothes of
            the first: *Chybí 1 položka nutná pro přepis* beside *Doplnit*,
            while the bar in the corner counted that same item to 25 %. The
            count was true and the button was not, and a button offering an
            errand already under way is the fault this day has spent itself
            on. */}
        <div className="settings-action-row spaced">
          {fetching ? (
            <InfoNote compact>{t("settings.modules.fetching")}</InfoNote>
          ) : missingRequired.length > 0 ? (
            <span className="warning-row">
              {tPlural("settings.modules.missingRequired", missingRequired.length)}
            </span>
          ) : (
            <InfoNote compact>{t("settings.modules.complete")}</InfoNote>
          )}
          <button
            className={`button ${!fetching && missingRequired.length > 0 ? "primary" : ""}`}
            onClick={() => onToModule()}
          >
            {fetching
              ? t("settings.modules.watch")
              : missingRequired.length > 0
                ? t("settings.modules.add")
                : t("settings.modules.manage")}
          </button>
        </div>

      </section>

      <section className="settings-card-locations">
        <h2>{t("settings.files.locationsTitle")}</h2>
        {/* A card's opening sentence, so it takes the card's own class rather
            than the `small-text` it wore inside the disclosure. */}
        <p className="settings-section-description">
          {t(check?.portable
            ? "settings.files.locationsPortable"
            : "settings.files.locationsDescription")}
        </p>

        <div className="field">
          <label>{t("settings.files.binDirectory")}</label>
          <div className="input-row">
            <input
              value={n.bin_directory}
              readOnly
              aria-label={t("settings.files.binDirectory")}
            />
            <button className="button" onClick={() => onSelectDirectory("bin_directory")}>
              {t("settings.files.choose")}
            </button>
          </div>
        </div>

        <div className="field">
          <label>{t("settings.files.modelsDirectory")}</label>
          <div className="input-row">
            <input
              value={n.models_directory}
              readOnly
              aria-label={t("settings.files.modelsDirectory")}
            />
            <button className="button" onClick={() => onSelectDirectory("models_directory")}>
              {t("settings.files.choose")}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
