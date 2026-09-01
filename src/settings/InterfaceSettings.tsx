/**
 * The `Rozhraní` tab: the language the application speaks, and how it looks.
 *
 * Everything on it writes through `save`, which is the screen's one path to
 * the settings record — a panel that wrote its own field would drop what the
 * other six hold.
 */
import { useState } from "react";
import { useI18n } from "../i18n";
import type { AppLanguage, TranslationKey } from "../i18n";
import { useLabels } from "../labels";
import InfoNote from "../InfoNote";
import Select from "../Select";
import { SettingsToggle } from "./toggle";
import { FONTS } from "../types";
import type { Settings } from "../types";

const THEMES = [
  { value: "system", label: "settings.appearance.themeSystem" },
  { value: "light", label: "settings.appearance.themeLight" },
  { value: "dark", label: "settings.appearance.themeDark" },
] as const satisfies ReadonlyArray<{ value: string; label: TranslationKey }>;

/** Settings written by an older version have no theme at all, and a stored
 *  value we do not know is not a palette we can draw. Both are the system. */
function themeChoice(stored: string): string {
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function InterfaceSettings({
  n,
  save,
}: {
  n: Settings;
  save: (next: Settings) => void;
}) {
  const { language, setLanguage, t, formatNumber } = useI18n();
  const labels = useLabels();

  /** Whether the transcript screen shows its shortcut strip. Mirrors
   *  `localStorage["rychle-tipy"]`, which is where it actually lives — the same
   *  arrangement as the interface language, and for the same reason: it is a
   *  habit of this machine rather than something the archive carries. The
   *  strip's own dismiss button writes the same key, and the two agree because
   *  they agree on one pair of values. */
  const [tipsVisible, setTipsVisible] = useState(
    () => localStorage.getItem("rychle-tipy") !== "skryte"
  );

  return (
    <>
      <section className="settings-card-app-language">
        <h2>{t("settings.language.title")}</h2>

        <div className="field">
          <Select
            value={language}
            description={t("settings.language.title")}
            onChange={(value) => setLanguage(value as AppLanguage)}
            items={[
              { value: "cs", label: t("domain.appLanguage.cs") },
              { value: "en", label: t("domain.appLanguage.en") },
            ]}
          />
          <InfoNote>{t("settings.language.description")}</InfoNote>
        </div>
      </section>

      <section className="settings-card-appearance">
        <h2>{t("settings.appearance.title")}</h2>
        <p className="settings-section-description">
          {t("settings.appearance.description")}
        </p>

        <div className="field">
          <label>{t("settings.appearance.theme")}</label>
          <Select
            value={themeChoice(n.theme)}
            onChange={(value) => save({ ...n, theme: value })}
            items={THEMES.map((choice) => ({
              value: choice.value,
              label: t(choice.label),
            }))}
          />
        </div>

        {/* Both fonts, and the reasoning that removed this one was wrong.

            It was taken out as a vanity choice over the chrome — the argument
            being that what somebody wants to read comfortably is the
            transcript, which the field below covers. The owner asked for it
            back the moment he saw the screen without it, and he is right: the
            application's own type is not decoration to the person who looks at
            it all day, and *derivable* was never the same as *unwanted*. Only
            sans faces are offered, because a serif menu is a different claim
            from a serif transcript. */}
        <div className="field">
          <label>{t("settings.appearance.fontUi")}</label>
          <Select
            value={n.font_ui}
            onChange={(v) => save({ ...n, font_ui: v })}
            items={Object.entries(FONTS)
              .filter(([, p]) => p.category === "sans")
              .map(([id]) => ({ value: id, label: labels.fontTitle(id) }))}
          />
        </div>

        <div className="field">
          <label>{t("settings.appearance.fontText")}</label>
          <Select
            value={n.font_text}
            onChange={(v) => save({ ...n, font_text: v })}
            items={[
              ...Object.entries(FONTS)
                .filter(([, p]) => p.category === "serif")
                .map(([id]) => ({
                  value: id,
                  label: labels.fontTitle(id),
                  group: t("settings.appearance.fontGroupSerif"),
                })),
              ...Object.entries(FONTS)
                .filter(([, p]) => p.category === "sans")
                .map(([id]) => ({
                  value: id,
                  label: labels.fontTitle(id),
                  group: t("settings.appearance.fontGroupSans"),
                })),
            ]}
          />
        </div>

        <div className="field">
          <label>
            {t("settings.appearance.fontSize")} <em className="value">
              {t("settings.appearance.fontSizeValue", {
                value: formatNumber(n.transcript_font_size, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })}
            </em>
          </label>
          <input
            type="range"
            min={14}
            max={26}
            step={0.5}
            value={n.transcript_font_size}
            onChange={(e) => save({ ...n, transcript_font_size: Number(e.target.value) })}
          />
        </div>

        {/* `Řádkování` was a second slider, and it is a consequence of the
            first: large type needs proportionally less leading than small type
            to read as the same block. `transcriptLineHeight` derives it, and
            the line it draws passes exactly through the pair that shipped —
            17.5 px at 1.72 — so nothing moves for anyone who never touched it. */}

        <div className="preview-font">
          <div className="preview-speakers">{t("settings.appearance.previewSpeaker")}</div>
          <p>{t("settings.appearance.previewText")}</p>
          <p className="preview-label">{t("settings.appearance.previewDiacritics")}</p>
        </div>

        {/* The shortcut strip's switch, back where it was before the
            simplification took it out — *dejme jim toggle v nastavení rozhraní
            tak, jak jsme ho měly*. It was replaced for a while by a keyboard
            button beside the player, on the reasoning that a way back belongs
            where the thing disappeared; the owner has seen both and this is the
            one he wants.

            **Like the app's language, this is not in the settings record.** It
            lives in `localStorage["rychle-tipy"]` and `Detail.tsx` reads the
            same key — `skryte` is hidden and anything else, including absent,
            is shown. So a strip somebody dismissed stays dismissed across this
            change: the button never wrote a different value, and this switch
            writes the pair the strip has always read. Do not move it into
            `save(n)` to make the card uniform. */}
        <SettingsToggle
          title={t("settings.tips.toggle")}
          label={t("settings.tips.toggle")}
          description={t("settings.tips.description")}
          checked={tipsVisible}
          onChange={(wanted) => {
            localStorage.setItem("rychle-tipy", wanted ? "viditelne" : "skryte");
            setTipsVisible(wanted);
          }}
        />
      </section>
    </>
  );
}
