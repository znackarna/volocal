/**
 * The `Soubory` tab: where recordings come from, where they go, and how the
 * archive is copied somewhere safe.
 */
import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { useI18n } from "../i18n";
import { useFormats } from "../formats";
import { useUserMessage } from "../messages";
import InfoNote from "../InfoNote";
import { SettingsToggle } from "./toggle";
import { Backups } from "./Backups";
import { Filled } from "./filled";
import type { Settings, ToolCheck } from "../types";

export function FilesSettings({
  n,
  check,
  machine,
  save,
  onError,
  onInfo,
  onSelectDirectory,
}: {
  n: Settings;
  check: ToolCheck | null;
  /** This computer's name, for the portable copy's sentence. */
  machine: string;
  save: (next: Settings) => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  onSelectDirectory: (key: "watch_folder" | "recording_folder") => void;
}) {
  const { t } = useI18n();
  const formats = useFormats();
  const userMessage = useUserMessage();

  /* Copying the whole application somewhere it can run from — a stick, another
     machine. It reports the file it is on, because on a slow disk a button
     that only greys out looks stuck. */
  const [copying, setCopying] = useState(false);
  const [copiedFile, setCopiedFile] = useState("");
  const [copyComplete, setCopyComplete] = useState<number | null>(null);

  const udelejKopii = useCallback(async () => {
    const destination = await open({
      directory: true,
      title: t("settings.portable.copyDestination"),
    });
    if (typeof destination !== "string") return;

    setCopying(true);
    setCopyComplete(null);
    const unlisten = await listen<string>("copy:file", (u) => setCopiedFile(u.payload));
    try {
      setCopyComplete(await api.createPortableCopy(destination));
    } catch (e) {
      onError(userMessage(e));
    } finally {
      unlisten();
      setCopying(false);
      setCopiedFile("");
    }
  }, [onError, t, userMessage]);

  return (
    <>
      check?.portable && (
        <section className="portable-info settings-card-portable">
          <h2>{t("settings.portable.title")}</h2>
          <p>
            <Filled message={t("settings.portable.description")} name="directory">
              <code>{check?.app_directory}</code>
            </Filled>
          </p>
          <p className="small-text">
            <Filled
              message={t(
                check?.webview2_bundled
                  ? "settings.portable.machineBundled"
                  : "settings.portable.machineSeparate"
              )}
              name="machine"
            >
              <strong>{machine}</strong>
            </Filled>
          </p>
        </section>
      )

      <section className="settings-card-watch-folder">
        <h2>{t("settings.files.watchTitle")}</h2>
        <p className="settings-section-description">
          {t("settings.files.watchDescription")}
        </p>

        <div className="field">
          <label>{t("settings.files.watchDirectory")}</label>
          <div className="input-row">
            <input
              value={n.watch_folder}
              readOnly
              placeholder={t("settings.files.watchPlaceholder")}
              aria-label={t("settings.files.watchTitle")}
            />
            <button className="button" onClick={() => onSelectDirectory("watch_folder")}>
              {t("settings.files.choose")}
            </button>
            {/* Kept, though the plan for this screen struck it out along with
                the switch above. With both gone, choosing a folder once would
                be permanent — there would be no way left to stop watching,
                which is the same one-way door the recordings folder's
                `Výchozí` exists to avoid. It appears only when there is
                something to remove. */}
            {n.watch_folder && (
              <button
                className="button quiet"
                onClick={() =>
                  save({
                    ...n,
                    watch_folder: "",
                    watch_folder_enabled: false,
                    watch_folder_auto: false,
                  })
                }
              >
                {t("settings.files.watchRemove")}
              </button>
            )}
          </div>
        </div>

        {/* One switch where there were two. `Sledovat složku` sat above this
            one and could only ever repeat what the row above it already said: a
            folder is chosen, or it is not. The one question left is what to do
            with what turns up in it — offer it in the Archive, or start.

            Shown whether or not a folder is chosen, rather than appearing with
            one. A switch that materialises after an unrelated press is a switch
            nobody knows exists; disabled, it is visible and says what it will
            be for. */}
        <SettingsToggle
          title={t("settings.files.watchAuto")}
          label={t("settings.files.watchAuto")}
          checked={n.watch_folder_auto}
          disabled={!n.watch_folder}
          onChange={(checked) => save({ ...n, watch_folder_auto: checked })}
          description={t("settings.files.watchAutoNote")}
        />
      </section>

      <section className="settings-card-recordings">
        <h2>{t("settings.recordings.title")}</h2>
        <p className="settings-section-description">
          {t("settings.recordings.description")}
        </p>

        <div className="field">
          <label>{t("settings.recordings.directory")}</label>
          <div className="input-row">
            <input
              value={n.recording_folder}
              readOnly
              placeholder={t("settings.recordings.defaultPlace")}
              aria-label={t("settings.recordings.directory")}
            />
            <button className="button" onClick={() => onSelectDirectory("recording_folder")}>
              {t("settings.files.choose")}
            </button>
            {n.recording_folder && (
              <button
                className="button quiet"
                onClick={() => save({ ...n, recording_folder: "" })}
              >
                {t("settings.recordings.reset")}
              </button>
            )}
          </div>
          {/* Inside the field it belongs to, which is what gives it the
              system's 8 px — and puts the toggle back next to the `.field`, so
              it gets its own 24 px and the divider. Between them it was an
              orphan with no spacing rule at all. */}
          <InfoNote>{t("settings.recordings.movedNote")}</InfoNote>
        </div>

        <SettingsToggle
          title={t("settings.recordings.copyImports")}
          label={t("settings.recordings.copyImports")}
          checked={n.copy_imports}
          onChange={(checked) => save({ ...n, copy_imports: checked })}
          description={t("settings.recordings.copyImportsNote")}
        />
      </section>

      <Backups onError={onError} onInfo={onInfo} />

      !check?.portable && (
        <section className="settings-card-portable-copy">
          <h2>{t("settings.portable.copyTitle")}</h2>
          <p className="settings-section-description">
            <Filled message={t("settings.portable.copyDescription")} name="file">
              {/* i18n-ignore: the name of the file on disk */}
              <code>Volocal.exe</code>
            </Filled>
          </p>

          <div className="settings-action-row separated">
            <InfoNote compact>
              {copying
                ? t("settings.portable.copyingFile", { file: copiedFile })
                : t("settings.portable.copyHint")}
            </InfoNote>
            <button className="button" onClick={udelejKopii} disabled={copying}>
              {copying
                ? t("settings.portable.copying")
                : t("settings.portable.copyAction")}
            </button>
          </div>

          {copyComplete !== null && (
            <p className="small-text settings-success" role="status">
              {t("settings.portable.copied", {
                size: formats.dataSize(copyComplete * 1024),
              })}
            </p>
          )}

        </section>
      )
    </>
  );
}
