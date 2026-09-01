// Copying the archive somewhere safe, and putting one back.
import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useI18n } from "../i18n";
import { useUserMessage } from "../messages";
import { useFormats } from "../formats";
import InfoNote from "../InfoNote";
import ConfirmationDialog from "../ConfirmationDialog";
import type { ConfirmationRequest } from "../ConfirmationDialog";
import { SettingsDisclosure } from "./disclosure";
import { RecordingCalendar, RecordingMetadataItem } from "../Library";

/**
 * Backups of the archive.
 *
 * The whole archive is one SQLite file. It is worth saying out loud where the
 * copies are, because the moment anyone needs them is the moment they will not
 * feel like hunting for a folder.
 *
 * The card carries two more things than its title suggests, and they are here
 * rather than on a card of their own because they are the same file. Saving a
 * copy is what the automatic backups are not: those live beside the archive, on
 * this disk, in this profile, and a dead disk takes the lot. Loading one belongs
 * beside restoring, because it is the same act — an archive arrives in place of
 * the one that is open.
 */
export function Backups({
  onError,
  onInfo,
}: {
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const { dataSize, transcriptCount, archiveDuration } = useFormats();
  /** The hour on its own for the row, and the whole moment for the question
   *  that names it — the row already has the day beside it, the dialog does not. */
  const formatTime = (moment: string) =>
    formatDate(new Date(moment), { hour: "2-digit", minute: "2-digit" });
  const formatMoment = (moment: string) =>
    formatDate(new Date(moment), {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const userMessage = useUserMessage();
  /* Its own, rather than a prop threaded down from the application: this is the
     only question this screen asks, and it asks it about its own card. */
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [status, setStatus] = useState<{
    latest: string;
    count: number;
    directory: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  /** Separate from `running`: saving a copy changes nothing, so it must not
   *  disable the buttons that do. */
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<
    {
      file: string;
      taken_at: string;
      size: number;
      recordings: number | null;
      seconds: number | null;
    }[] | null
  >(null);

  const refresh = useCallback(() => {
    api.backupStatus().then(setStatus).catch(() => setStatus(null));
    setList(null);
  }, []);

  useEffect(refresh, [refresh]);

  /* `Zálohovat teď` stood here and is gone with its handler. A copy is taken at
     every start — which is what the card's own description says — so the button
     made a second copy of an archive that had not changed since the first one,
     and the only thing it could do that the automatic copy cannot is make three
     of them in a row. Restoring, exporting and importing are the acts that
     needed a button. */

  /* A name with the day in it, because the folder these land in is the one
     somebody keeps several in. */
  const exportArchive = useCallback(async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      const destination = await save({
        defaultPath: `volocal-${stamp}.db`,
        filters: [{ name: t("settings.archive.fileFilter"), extensions: ["db"] }],
      });
      if (!destination) return;
      setSaving(true);
      await api.exportArchive(destination);
      onInfo(t("settings.archive.exported", { path: destination }));
    } catch (e) {
      onError(userMessage(e));
    } finally {
      setSaving(false);
    }
  }, [onError, onInfo, t, userMessage]);

  /* The question is asked after the file is chosen rather than before, so that
     it can name it. "Replace the archive?" with nothing named is a question
     nobody can answer. */
  const importArchive = useCallback(async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: t("settings.archive.fileFilter"), extensions: ["db"] }],
    });
    if (typeof chosen !== "string") return;
    setConfirmation({
      title: t("settings.archive.importConfirmTitle"),
      text: t("settings.archive.importConfirmText", {
        name: chosen.split(/[\\/]/).pop() ?? chosen,
      }),
      confirm: t("settings.archive.importAction"),
      destructive: true,
      action: async () => {
        setRunning(true);
        try {
          await api.importArchive(chosen);
          // Same reason as restoring: every screen is holding data from the
          // archive that has just been replaced.
          window.location.reload();
        } catch (e) {
          onError(userMessage(e));
          setRunning(false);
        }
      },
    });
  }, [onError, t, userMessage]);

  return (
    <section className="settings-card-backups">
      <h2>{t("settings.backups.title")}</h2>
      <p className="settings-section-description">{t("settings.backups.description")}</p>

      {/* Three facts about one thing, so they are one panel with one rule
          between each: when, how many, where. The folder used to hang under
          the pair as a loose monospace line with nothing naming it — it is a
          row like the others now, and clicking it opens the folder, which is
          the only reason anyone reads a path at all. */}
      <dl className="backup-summary">
        <div className="backup-row">
          <dt>{t("settings.backups.latest")}</dt>
          <dd>{status?.latest || t("settings.backups.none")}</dd>
        </div>
        <div className="backup-row">
          <dt>{t("settings.backups.count")}</dt>
          <dd>{formatNumber(status?.count ?? 0)}</dd>
        </div>
        {status?.directory && (
          <div className="backup-row">
            <dt>{t("settings.backups.directory")}</dt>
            <dd>
              <button
                type="button"
                className="backup-path"
                title={t("settings.backups.reveal")}
                onClick={() => {
                  void revealItemInDir(status.directory).catch((e) => onError(userMessage(e)));
                }}
              >
                <bdi>{status.directory}</bdi>
              </button>
            </dd>
          </div>
        )}
      </dl>

      {/* The archive leaving and arriving, on the face of the card.

          Both were folded away with the list of backups, under a heading that
          had to name two subjects at once — and they are not the same subject.
          Going back to a Tuesday is a list to read; sending the archive to
          another disk is one press. The press is up here; the reading is folded
          under it. One note for the two of them, because they are one archive
          going in either direction. */}
      <div className="settings-action-row spaced">
        <InfoNote compact>{t("settings.archive.note")}</InfoNote>
        <div className="settings-action-row-buttons">
          <button className="button" onClick={exportArchive} disabled={saving || running}>
            {saving ? t("settings.archive.exportSaving") : t("settings.archive.export")}
          </button>
          <button className="button" onClick={importArchive} disabled={running}>
            {t("settings.archive.import")}
          </button>
        </div>
      </div>

      {/* Last band of the card, folded away. Putting a backup back is the
          rarest thing on this screen and the only one that replaces what is
          there — it belongs under everything that is not. */}
      {/* Always here, unlike the list inside it. A machine that has just been
          set up has no backups and is exactly the machine somebody wants to
          load an archive into. */}
      <SettingsDisclosure
        title={t("settings.backups.restoreTitle")}
        className="card-footer"
        onOpen={() => {
          if (list === null) api.backups().then(setList).catch(() => setList([]));
        }}
      >
        {(status?.count ?? 0) > 0 ? (
          <ul className="backup-list">
            {(list ?? []).map((backup) => (
              <li key={backup.file}>
                {/* The same torn-off leaf the archive puts on a recording. A
                    backup is chosen by its day first and its hour second, and
                    the day is what the eye finds without reading. */}
                <RecordingCalendar value={backup.taken_at} />
                {/* No mark on the hour. The leaf beside it already says which
                    day, and with marks on both facts at the right a third one
                    made the row busier than it is informative. */}
                <span className="backup-when">{formatTime(backup.taken_at)}</span>
                {/* dataSize speaks in megabytes; the file system speaks in
                    bytes. Passed straight through, a 1.4 MB archive announced
                    itself as 1 420 GB. */}
                {/* The archive's own pair, with the archive's own marks: how
                    many transcripts and how much audio. Nobody picks a backup
                    by megabytes — those stay in the tooltip, where a file's
                    weight belongs. */}
                {backup.recordings !== null && (
                  <span className="recording-metadata backup-holds"
                        title={dataSize(backup.size / (1024 * 1024))}>
                    <RecordingMetadataItem
                      kind="segments"
                      label={t("library.folders.count")}
                      value={transcriptCount(backup.recordings)}
                    />
                    <RecordingMetadataItem
                      kind="duration"
                      label={t("library.card.duration")}
                      value={archiveDuration(backup.seconds ?? 0)}
                    />
                  </span>
                )}
                <button
                  className="button"
                  disabled={running}
                  onClick={() =>
                    setConfirmation({
                      title: t("settings.backups.restoreConfirmTitle"),
                      text: t("settings.backups.restoreConfirmText", {
                        when: formatMoment(backup.taken_at),
                      }),
                      confirm: t("settings.backups.restoreAction"),
                      destructive: true,
                      action: async () => {
                        setRunning(true);
                        try {
                          await api.restoreBackup(backup.file);
                          // Everything on every screen came from the archive
                          // that was just replaced. Reloading is the honest way
                          // to be sure nothing on screen is from the old one.
                          window.location.reload();
                        } catch (e) {
                          onError(userMessage(e));
                          setRunning(false);
                        }
                      },
                    })
                  }
                >
                  {t("settings.backups.restoreAction")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-section-description">{t("settings.backups.emptyList")}</p>
        )}
        {/* Under the list, not over it. What it says is what happens *after*
            a row is chosen, and it was standing between the reader and the
            dates they came here to look at. */}
        {(status?.count ?? 0) > 0 && <InfoNote>{t("settings.backups.restoreNote")}</InfoNote>}

      </SettingsDisclosure>

      <ConfirmationDialog
        query={confirmation}
        onClose={() => setConfirmation(null)}
        onError={onError}
      />
    </section>
  );
}
