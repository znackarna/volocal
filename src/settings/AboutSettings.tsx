// The `Informace` tab: the one page in the application that exists to be read.
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import { useUserMessage } from "../messages";
import InfoNote from "../InfoNote";
import { LineIcon, type LineIconName } from "../icons";

/**
 * What the application is, what it does, and what it is made of.
 *
 * Jakub asked for the three things this answers: which technologies it stands
 * on, under what licences, and what the application can actually do. Nothing
 * here is a setting or an action — it is the one page that exists to be read,
 * which is why the update check moved off it and onto a tab of its own.
 */
/** Where the application comes from, for the one row on `Informace` that leaves
 *  this computer when it is pressed.
 *
 *  The same host the updater already asks — `tauri.conf.json` points at
 *  `github.com/znackarna/volocal/releases` — so this is not a second address to
 *  keep in step with anything, it is the page above the one the application has
 *  been fetching from all along.
 *
 *  i18n-ignore: an address, the same in every language */
const WEBSITE = "https://github.com/znackarna/volocal";

/** Who made this, on the `Autor` row and as the drawn mark's accessible name.
 *
 *  Named once because it is now read twice — the drawing carries it for anybody
 *  listening, the type carries it for anybody looking — and two literals would
 *  be two chances to correct only one of them.
 *
 *  i18n-ignore: a company name, and it mirrors `src-tauri/Cargo.toml` */
const PUBLISHER = "značkárna s.r.o.";

export function AboutSettings({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  /* The one thing on this page that can fail. Without a way to say so, a
     refused `openUrl` is a row that does nothing when it is pressed, which is
     indistinguishable from a row that is not a control at all. */
  const userMessage = useUserMessage();

  /* The version stood here in a row of its own and is on `Aktualizace` now.
     It belongs on the tab where it can be acted on — the button under it
     fetches a newer one — and this page is the one page that exists only to be
     read. What was moved rather than removed: nothing else on this tab names
     the number, and the licence sentence beside it never did. */

  /* Project and licence names are proper nouns — the same string in every
     language — so they stand here rather than in the dictionary, where a
     translator would be invited to change them. Only the group headings and
     the one licence that is a Czech phrase come from keys.
     i18n-ignore: names of projects and of licences */
  const credits: ReadonlyArray<{ label: TranslationKey; items: [string, string][] }> = [
    {
      label: "settings.about.groupApp",
      items: [
        ["Tauri 2", "MIT / Apache 2.0"],
        ["React 18", "MIT"],
        ["SQLite", t("settings.about.publicDomain")],
      ],
    },
    {
      label: "settings.about.groupTranscription",
      items: [
        ["whisper.cpp (ggml)", "MIT"],
        ["Whisper (OpenAI)", "MIT"],
        ["Silero VAD", "MIT"],
      ],
    },
    {
      label: "settings.about.groupSpeakers",
      items: [
        ["ONNX Runtime", "MIT"],
        ["3D-Speaker CAM++", "Apache 2.0"],
      ],
    },
    {
      label: "settings.about.groupEditor",
      items: [
        ["llama.cpp", "MIT"],
        ["Gemma (Google)", "Gemma Terms of Use"],
      ],
    },
    {
      label: "settings.about.groupMedia",
      items: [
        ["FFmpeg", "GPL v3"],
        ["yt-dlp", "Unlicense"],
        ["Deno", "MIT"],
      ],
    },
    {
      label: "settings.about.groupFonts",
      items: [
        ["Geist, Inter, Schibsted Grotesk", "SIL OFL 1.1"],
        ["Literata, Source Serif 4", "SIL OFL 1.1"],
      ],
    },
  ];

  /** One line each, with the mark of the part of the application it belongs
   *  to — the same drawings those screens carry. */
  const abilities: ReadonlyArray<{ icon: LineIconName; text: TranslationKey }> = [
    { icon: "transcription", text: "settings.about.abilityTranscribe" },
    { icon: "speakers", text: "settings.about.abilitySpeakers" },
    { icon: "editor", text: "settings.about.abilityEditor" },
    { icon: "review", text: "settings.about.abilityReview" },
    { icon: "note", text: "settings.about.abilityNotes" },
    { icon: "video", text: "settings.about.abilitySources" },
    { icon: "folder", text: "settings.about.abilityExport" },
  ];

  return (
    <>
      <section className="settings-card-about">
        {/* i18n-ignore: the name of the product, the same word in every language */}
        <h2>Volocal</h2>
        <p className="settings-section-description">{t("settings.about.description")}</p>

        {/* Both rows carry a mark, and both is the point: a panel where some
            rows have one and some do not reads as an accident rather than as a
            distinction. These two are the whole panel and they are the two
            things somebody opens this page to find, so the circle is the same
            `.about-mark` the abilities list below uses — 30 px, `--accent-light`
            — rather than a size invented here.

            The other `.about-panel` on this screen, the licence list, stays
            plain: its rows are one per component and a glyph on each would be a
            column of marks saying nothing the name beside it does not. */}
        <dl className="about-panel about-panel-marked">
          <div className="about-row">
            <dt>
              <span className="about-mark"><LineIcon name="author" size={17} /></span>
              {t("settings.about.author")}
            </dt>
            {/* The publisher's drawn mark stood here beside the name and is out
                again, on the owner's word and for now rather than for good.
                `ZnackarnaMark` stays in `Brand.tsx` unimported, the way
                `mark.svg` is kept: it is still the publisher's mark and putting
                it back is one line.

                **The `aria-hidden` on the name went with it, and had to.** The
                accessible name used to live on the drawing so a screen reader
                heard the publisher once rather than twice; with the drawing gone
                that argument takes the name away entirely and the row answering
                *who made this* answers nobody. */}
            <dd className="about-author">
              <span>{PUBLISHER}</span>
            </dd>
          </div>
          <div className="about-row">
            <dt>
              <span className="about-mark"><LineIcon name="link" size={17} /></span>
              {t("settings.about.website")}
            </dt>
            <dd>
              {/* A button and not an `<a href>`, deliberately. An anchor the
                  webview follows would open the page inside the application
                  window — no address bar, no back, nothing to close — which is
                  a room somebody cannot leave. `openUrl` hands it to whatever
                  browser this computer already uses, where all of that is.

                  The whole address, scheme included. Trimming `https://` makes
                  the row show something that is not what it opens, and this
                  panel is the application stating facts about itself.

                  The failure is reported rather than swallowed, the same way
                  `revealItemInDir` reports its own on the backups card. A `void`
                  on this promise is exactly how it came to do nothing at all
                  when the capability had not been granted yet: the rejection
                  went nowhere and the row simply did not respond. */}
              <button
                type="button"
                className="about-link"
                onClick={() =>
                  void openUrl(WEBSITE).catch((e) => onError(userMessage(e)))
                }
              >
                {/* i18n-ignore: an address, the same in every language */}
                {WEBSITE}
              </button>
            </dd>
          </div>
        </dl>
      </section>

      <section className="settings-card-abilities">
        <h2>{t("settings.about.abilities")}</h2>
        <ul className="about-abilities">
          {abilities.map((ability) => (
            <li key={ability.icon}>
              <span className="about-mark">
                <LineIcon name={ability.icon} size={17} />
              </span>
              {t(ability.text)}
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-card-credits">
        <h2>{t("settings.about.credits")}</h2>
        <p className="settings-section-description">
          {t("settings.about.creditsDescription")}
        </p>

        {credits.map((group) => (
          <div className="about-group" key={group.label}>
            <p className="about-group-label">{t(group.label)}</p>
            <dl className="about-panel">
              {group.items.map(([name, licence]) => (
                <div className="about-row" key={name}>
                  <dt>{name}</dt>
                  <dd>{licence}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        <InfoNote>{t("settings.about.licenceNote")}</InfoNote>
      </section>
    </>
  );
}
