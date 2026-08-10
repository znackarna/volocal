/** Checking for a new version — the one place the application talks to a
 *  server that is not on this computer.
 *
 *  It happens on a button press and nowhere else: nothing here runs on start,
 *  on a timer, or in the background. That is a promise the README makes about
 *  what leaves the machine, and the shape of this file is what keeps it. If a
 *  later change wants an automatic check, it changes the promise first.
 *
 *  On Windows the installer is what finishes the job: `downloadAndInstall`
 *  hands the downloaded package to NSIS and the application exits itself —
 *  `std::process::exit(0)` inside the plugin — after which the installer
 *  starts it again. So there is no "restart now" to offer, and no need for the
 *  process plugin to offer it with.
 */
import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import InfoNote from "../InfoNote";
import { SettingsToggle } from "./toggle";
import { useI18n } from "../i18n";

type State =
  | { at: "idle" }
  | { at: "checking" }
  | { at: "current" }
  | { at: "found"; version: string }
  /** `percent` is absent while the server did not say how large the file is. */
  | { at: "downloading"; percent: number | null }
  | { at: "installing" };

/** Whatever came back, said in one line. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A failed check goes to the notice bar, like every other failure in the
 *  application. Saying it inside the panel instead would give this one screen
 *  a second place errors can appear, and the reader would have to learn where
 *  to look for each kind. */
export function UpdateCheck({
  onError,
  automatic,
  onAutomaticChange,
}: {
  onError: (message: string) => void;
  automatic: boolean;
  onAutomaticChange: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ at: "idle" });

  const busy = state.at === "checking" || state.at === "downloading" || state.at === "installing";

  /* One sentence for every failure, in the reader's language. The technical
     reason from Tauri is English, unhelpful and often about a JSON file — it
     goes to the console for whoever is debugging, not onto the screen. */
  function failed(error: unknown) {
    setState({ at: "idle" });
    console.error("update check failed:", describe(error));
    onError(t("settings.about.updateFailed"));
  }

  async function look() {
    setState({ at: "checking" });
    try {
      const update = await check();
      setState(update ? { at: "found", version: update.version } : { at: "current" });
    } catch (error) {
      failed(error);
    }
  }

  async function install() {
    setState({ at: "downloading", percent: null });
    try {
      // `check` is called a second time rather than the first result being
      // held: the download can start minutes after the check, and an `Update`
      // is a handle on the Rust side that the window should not sit on.
      const update = await check();
      if (!update) {
        setState({ at: "current" });
        return;
      }
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setState({ at: "downloading", percent: total ? 0 : null });
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          setState({
            at: "downloading",
            percent: total ? Math.min(100, Math.round((received / total) * 100)) : null,
          });
        } else if (event.event === "Finished") {
          setState({ at: "installing" });
        }
      });
    } catch (error) {
      failed(error);
    }
  }

  return (
    <div className="about-aktualizace">
      <div className="about-aktualizace-akce">
        <button className="tlacitko" onClick={look} disabled={busy}>
          {state.at === "checking"
            ? t("settings.about.updateChecking")
            : t("settings.about.updateCheck")}
        </button>
        {state.at === "found" && (
          <button className="tlacitko hlavni" onClick={install}>
            {t("settings.about.updateInstall")}
          </button>
        )}
      </div>

      {state.at === "current" && <p className="about-stav">{t("settings.about.updateCurrent")}</p>}
      {state.at === "found" && (
        <p className="about-stav">{t("settings.about.updateFound", { version: state.version })}</p>
      )}
      {state.at === "downloading" && (
        <p className="about-stav">
          {state.percent === null
            ? t("settings.about.updateDownloadingUnknown")
            : t("settings.about.updateDownloading", { percent: state.percent })}
        </p>
      )}
      {state.at === "installing" && (
        <p className="about-stav">{t("settings.about.updateInstalling")}</p>
      )}

      <InfoNote>{t("settings.about.updateNote")}</InfoNote>

      <SettingsToggle
        separated
        title={t("settings.about.updateAuto")}
        label={t("settings.about.updateAuto")}
        description={t("settings.about.updateAutoDescription")}
        checked={automatic}
        onChange={onAutomaticChange}
      />
    </div>
  );
}
