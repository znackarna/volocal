/** Checking for a new version — the one place the application talks to a
 *  server that is not on this computer.
 *
 *  Nothing here runs on a timer or in the background. The button is one way in;
 *  the switch below it is the other, and that one is off until somebody turns
 *  it on. Either way the application asks and stops — the download is always a
 *  second, separate press.
 *
 *  On Windows the installer is what finishes the job: `downloadAndInstall`
 *  hands the downloaded package to NSIS and the application exits itself —
 *  `std::process::exit(0)` inside the plugin — after which the installer
 *  starts it again. So there is no "restart now" to offer, and no need for the
 *  process plugin to offer it with.
 */
import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { api } from "../api";
import InfoNote from "../InfoNote";
import { SettingsToggle } from "./toggle";
import { useI18n } from "../i18n";
import { useDialog } from "../useDialog";
import { readNotes } from "./releaseNotes";

type State =
  | { at: "idle" }
  | { at: "checking" }
  /** `notes` is whatever the release said about itself, and may be nothing:
   *  1.0.4 and everything before it was published without any. */
  | { at: "found"; version: string; notes: string }
  /** `percent` is absent while the server did not say how large the file is. */
  | { at: "downloading"; percent: number | null }
  | { at: "installing" };

/** Whatever came back, said in one line. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** What is in the version, before anybody agrees to it.
 *
 *  On the application's own dialog surface rather than as a block in the
 *  settings panel: this is a question with an answer — install it or not — and
 *  that is what a dialog is for here. It also puts the text in front of the
 *  reader instead of below the button they were about to press.
 *
 *  The focus starts on the way out, as it does in every dialog that offers an
 *  action: installing closes the application and starts an installer, and a
 *  blind Enter should not do that.
 */
function ReleaseNotes({
  version,
  notes,
  onClose,
  onInstall,
}: {
  version: string;
  notes: string;
  onClose: () => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const dialog = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="prekryv-dialogu" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="novinky-nadpis"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="novinky-nadpis">{t("settings.about.updateNotesTitle", { version })}</h2>
        <p>{t("settings.about.updateNotesLead")}</p>
        <div className="novinky">
          {readNotes(notes).map((block, i) =>
            block.kind === "list" ? (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>{block.text}</p>
            )
          )}
        </div>
        <div className="dialog-patka">
          <button className="tlacitko" onClick={onClose} autoFocus>
            {t("settings.about.updateNotesLater")}
          </button>
          <button className="tlacitko hlavni" onClick={onInstall}>
            {t("settings.about.updateInstall")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Where an outcome is said depends on whether anything can be done about it.
 *
 *  A finished check — nothing newer, or it could not be reached — goes to the
 *  notice bar, like every other passing remark the application makes. It has
 *  no follow-up, and leaving it under the button would give this one screen a
 *  second place to look for news.
 *
 *  What stays in the panel is what carries an action or a wait: the version
 *  that was found sits beside the button that installs it, and the progress of
 *  a download sits where the download was asked for. */
export function UpdateCheck({
  onError,
  onInfo,
  automatic,
  onAutomaticChange,
}: {
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  automatic: boolean;
  onAutomaticChange: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ at: "idle" });
  /** Whether what is in the version is on screen. It opens itself when a
   *  version with notes is found, and can be opened again from the panel —
   *  closing it must not be the same as throwing the text away. */
  const [reading, setReading] = useState(false);

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
      if (update) {
        // The version goes to the notice bar too. What stays behind is the
        // button that acts on it, which says what it does without repeating
        // the number.
        const notes = update.body ?? "";
        setState({ at: "found", version: update.version, notes });
        onInfo(t("settings.about.updateFound", { version: update.version }));
        // Straight to what is in it. The reader pressed a button asking what is
        // new; making them press a second one to be told would be a joke. A
        // release published without notes opens nothing.
        if (readNotes(notes).length > 0) setReading(true);
      } else {
        setState({ at: "idle" });
        onInfo(t("settings.about.updateCurrent"));
      }
    } catch (error) {
      failed(error);
    }
  }

  async function install() {
    setReading(false);
    setState({ at: "downloading", percent: null });
    try {
      // `check` is called a second time rather than the first result being
      // held: the download can start minutes after the check, and an `Update`
      // is a handle on the Rust side that the window should not sit on.
      const update = await check();
      if (!update) {
        setState({ at: "idle" });
        onInfo(t("settings.about.updateCurrent"));
        return;
      }
      /* Before a single byte is fetched, because the installer is started by
         this process and would otherwise be killed the moment it exits. The
         window and everything it runs live in a job object so that whisper and
         ffmpeg cannot outlive it; the installer has to be the exception, and
         this is where it is made one. */
      await api.letTheInstallerOut();
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

  const notes = state.at === "found" ? state.notes : "";

  return (
    <div className="about-aktualizace">
      {reading && state.at === "found" && (
        <ReleaseNotes
          version={state.version}
          notes={state.notes}
          onClose={() => setReading(false)}
          onInstall={() => void install()}
        />
      )}

      <div className="about-aktualizace-akce">
        <button className="tlacitko" onClick={look} disabled={busy}>
          {state.at === "checking"
            ? t("settings.about.updateChecking")
            : t("settings.about.updateCheck")}
        </button>
        {state.at === "found" && readNotes(notes).length > 0 && (
          /* Closing the dialog is not the same as being done with it: somebody
             who reads it, thinks about it and comes back should not have to ask
             the server again to see the same three lines. */
          <button className="tlacitko" onClick={() => setReading(true)}>
            {t("settings.about.updateNotesReopen")}
          </button>
        )}
        {state.at === "found" && (
          <button className="tlacitko hlavni" onClick={install}>
            {t("settings.about.updateInstall")}
          </button>
        )}
      </div>

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
