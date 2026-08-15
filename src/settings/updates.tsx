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
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../api";
import { LineIcon } from "../icons";
import { SettingsToggle } from "./toggle";
import { useI18n } from "../i18n";
import { useDialog } from "../useDialog";
import { lastUpdateCheck, noteUpdateCheck } from "../types";
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
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="dialog release-notes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="release-notes-title">{t("settings.about.updateNotesTitle", { version })}</h2>
        <p>{t("settings.about.updateNotesLead")}</p>
        <div className="release-notes">
          {readNotes(notes).map((block, i) =>
            block.kind === "list" ? (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    {/* The green tick from the components list, at 16 px rather
                        than 22: there it marks one row of a checklist, here it
                        runs down a column beside single lines of text. */}
                    <span className="release-notes-mark" aria-hidden>
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7.2 5.7 10 11 4.5" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i}>{block.text}</p>
            )
          )}
        </div>
        <div className="dialog-footer">
          <button className="button" onClick={onClose} autoFocus>
            {t("settings.about.updateNotesLater")}
          </button>
          <button className="button primary" onClick={onInstall}>
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
  found,
}: {
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  automatic: boolean;
  onAutomaticChange: (on: boolean) => void;
  /** What the check at start-up already found, if it found anything.
   *
   *  **The notice carries a way here and this is what it hands over.** Without
   *  it the reader is told a version is waiting, presses the button that says so,
   *  and arrives at a panel in its resting state with nothing to press —
   *  having to ask again for an answer the application already had.
   *
   *  The version and its notes rather than the update object itself, because
   *  that is all this panel shows: installing calls `check` again for its own
   *  reasons, which are written where it does so. */
  found?: { version: string; notes: string } | null;
}) {
  const { t, formatDate } = useI18n();
  const [state, setState] = useState<State>(
    found ? { at: "found", version: found.version, notes: found.notes } : { at: "idle" }
  );
  /** Read once and kept in state so the row moves the moment the button
   *  answers, rather than waiting for somebody to leave the tab and come back.
   *  `localStorage` is the store; this is only what is on screen. */
  const [lastChecked, setLastChecked] = useState(lastUpdateCheck);
  /** The number of the build that is running. From the bundle rather than
   *  typed here: `tauri.conf.json` already carries it, and a second copy is the
   *  one that would be wrong on release day. `core:default` grants
   *  `core:app:allow-version`, so no capability changed for this. */
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
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
      /* An answer came back, so the row above can say when. Written here and
         not in `install`, which calls `check` again as a technical necessity
         rather than as an errand. Deliberately not through `save` in
         `Settings.tsx`: that raises the *Uloženo* confirmation, and pressing
         *Zkontrolovat aktualizace* is not somebody saving a setting. */
      noteUpdateCheck();
      setLastChecked(lastUpdateCheck());
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


  const readMoment = (value: string) => {
    const moment = new Date(value);
    if (!value || Number.isNaN(moment.getTime())) return null;
    return formatDate(moment, {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  /* Two facts, in the panel the `Modely` card and `Informace` already use: a
     label on the left with its mark, a value on the right in 600 tabular. The
     version is here rather than on `Informace` because this is the tab where a
     number can be acted on — the button under it fetches a newer one — and one
     number in two places is a number that will disagree with itself. */
  const facts: ReadonlyArray<{ icon: "tag" | "clock"; label: string; value: string }> = [
    { icon: "tag", label: t("settings.about.version"), value: version || "—" },
    {
      icon: "clock",
      label: t("settings.updates.lastCheck"),
      // Empty is itself the answer, and it is a sentence rather than a dash:
      // a dash reads as "not available", and this is "nobody has ever asked",
      // which is the resting state of an application whose automatic check is
      // off by default.
      // The `Number.isNaN` is not decoration: this comes out of
      // `localStorage`, where anything at all can be written by hand, and
      // `Intl.DateTimeFormat` throws on an invalid date rather than returning
      // something odd — which would take the whole tab down with it.
      value: readMoment(lastChecked) ?? t("settings.updates.lastCheckNever"),
    },
  ];

  return (
    <div className="about-updates">
      {/* First in the block, though it is drawn over the whole window: it is a
          fixed overlay and takes no space, and anywhere else it would land
          between two siblings and break the `+` that spaces them apart. */}
      {reading && state.at === "found" && (
        <ReleaseNotes
          version={state.version}
          notes={state.notes}
          onClose={() => setReading(false)}
          onInstall={() => void install()}
        />
      )}

      <dl className="about-panel about-panel-marked">
        {facts.map((fact) => (
          <div className="about-row" key={fact.icon}>
            <dt>
              <span className="about-mark"><LineIcon name={fact.icon} size={17} /></span>
              {fact.label}
            </dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      {/* `Aplikace hledá novou verzi pouze na vaši žádost.` stood here, above
          the button, as one fixed sentence.

          It was false half the time. With the switch at the foot of this card
          on, the application looks after every start — which is what that switch
          exists to do and what its own sentence says two lines further down. The
          owner sent the screen back with the line and the button ringed and an
          arrow drawn from them to the switch.

          A two-state version of this line was built earlier and turned down for
          a reason that still holds: *místo toho se přepíná ta jedna věta s
          ikonkou nad, to nechci* — what a switch does is said under the switch.
          Which leaves nothing for this line to say that is both true and not
          already said. The switch says when the application looks by itself; the
          button says the press is available; a line claiming the switch is off
          says only what the switch itself shows. So it goes rather than being
          rewritten a third time.

          The button stays, and that was the owner's call in as many words:
          *nevím co udělat s klasickým tlačítkem když je aktivní auto kontrola,
          asi nic*. It is right — the automatic check happens at start, and
          wanting to ask now is a different question from wanting to be told at
          start. */}
      <div className="about-updates-actions">
        <button className="button" onClick={look} disabled={busy}>
          {state.at === "checking"
            ? t("settings.about.updateChecking")
            : t("settings.about.updateCheck")}
        </button>
        {state.at === "found" && readNotes(notes).length > 0 && (
          /* Closing the dialog is not the same as being done with it: somebody
             who reads it, thinks about it and comes back should not have to ask
             the server again to see the same three lines. */
          <button className="button" onClick={() => setReading(true)}>
            {t("settings.about.updateNotesReopen")}
          </button>
        )}
        {state.at === "found" && (
          <button className="button primary" onClick={install}>
            {t("settings.about.updateInstall")}
          </button>
        )}
      </div>

      {state.at === "downloading" && (
        <p className="about-status">
          {state.percent === null
            ? t("settings.about.updateDownloadingUnknown")
            : t("settings.about.updateDownloading", { percent: state.percent })}
        </p>
      )}
      {state.at === "installing" && (
        <p className="about-status">{t("settings.about.updateInstalling")}</p>
      )}

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
