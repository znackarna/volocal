/**
 * The strip along the bottom that says what is on the screen in numbers.
 *
 * It never acts, only reports — which is why `Uloženo` appears where a stored
 * document exists rather than always. There is no unsaved state to report:
 * every edit is written as it is made, which is what makes it a fact rather
 * than a progress indicator.
 */
import { useMemo } from "react";
import { useI18n } from "../i18n";
import { useLabels } from "../labels";
import { useFormats } from "../formats";
import { formatTime } from "../types";
import RecordingMetadataIcon from "../RecordingMetadataIcon";
import type { RecordingMetadataKind } from "../RecordingMetadataIcon";
import type { Recording } from "../types";

/** The last part of a path, whichever separator the system uses. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function FooterStatusItem({
  kind,
  value,
  label,
  detail,
}: {
  kind: RecordingMetadataKind;
  value: string;
  label: string;
  /** Shown in the tooltip after the label, where the visible value is a
   *  shortened form of something longer. */
  detail?: string;
}) {
  const { t } = useI18n();

  return (
    <span
      className="app-status-item"
      aria-label={t("app.shell.statusItem", { label, value: detail ?? value })}
      title={detail ? `${label}: ${detail}` : label}
    >
      <RecordingMetadataIcon kind={kind} />
      <span>{value}</span>
    </span>
  );
}

export function AppFooter({
  screen,
  recordings,
  selectedId,
  archiveSetup,
}: {
  screen: string;
  recordings: Recording[];
  selectedId: string | null;
  /** What the archive is set up with, drawn beside its counts. */
  archiveSetup: { model: string; watchFolder: string };
}) {
  const { t } = useI18n();
  const labels = useLabels();
  const formats = useFormats();

  const archiveFooterStatus = useMemo(() => {
    const completed = recordings.filter((recording) => recording.status === "done");
    const duration = completed.reduce((sum, recording) => sum + recording.duration, 0);
    return {
      transcripts: formats.transcriptCount(completed.length),
      duration: formats.archiveDuration(duration),
    };
  }, [formats, recordings]);

  const detailFooterStatus = useMemo(() => {
    const recording = recordings.find((item) => item.id === selectedId);
    if (!recording) return null;
    return {
      duration: recording.duration > 0 ? formatTime(recording.duration) : null,
      /* Both languages once a second one has been written in. One sentence
         from the dictionary rather than two names glued with a conjunction,
         because the conjunction is a word and words are translated. */
      language: !recording.language
        ? null
        : recording.second_language
          ? t("app.shell.twoLanguages", {
              first: labels.languageCapitalized(recording.language),
              second: labels.language(recording.second_language),
            })
          : labels.languageCapitalized(recording.language),
      segments: recording.status === "done" ? formats.segmentCount(recording.segment_count) : null,
      /* `Uloženo` used to be a constant, lit for every detail — including a
         recording with no transcript at all, where there is nothing saved to
         speak of. It is a statement about a stored document, so it appears
         where one exists. */
      saved: recording.status === "done",
    };
  }, [formats, labels, recordings, selectedId, t]);

  return (
    <footer className="app-status-footer" aria-label={t("app.shell.statusBar")}>
      {screen === "library" ? (
        <div className="app-status-footer-group">
          <FooterStatusItem
            kind="segments"
            value={archiveFooterStatus.transcripts}
            label={t("app.shell.transcriptCount")}
          />
          <FooterStatusItem
            kind="duration"
            value={archiveFooterStatus.duration}
            label={t("app.shell.totalDuration")}
          />
        </div>
      ) : (
        <div className="app-status-footer-group">
          {detailFooterStatus?.saved && (
            <FooterStatusItem
              kind="saved"
              value={t("common.saved")}
              label={t("app.shell.documentState")}
            />
          )}
        </div>
      )}
      {screen === "library" && (archiveSetup.watchFolder || archiveSetup.model) && (
        <div className="app-status-footer-group">
          {archiveSetup.watchFolder && (
            <FooterStatusItem
              kind="folder"
              /* The folder's own name, not its path. A status strip 30 px
                 tall cannot hold `C:\Users\…` and the name is what the
                 reader recognises; the whole path is in the tooltip. */
              value={folderName(archiveSetup.watchFolder)}
              label={t("app.shell.watchFolder")}
              detail={archiveSetup.watchFolder}
            />
          )}
          {archiveSetup.model && (
            <FooterStatusItem
              kind="model"
              value={labels.model(archiveSetup.model)}
              label={t("app.shell.model")}
            />
          )}
        </div>
      )}

      {screen === "detail" && detailFooterStatus && (
        <div className="app-status-footer-group">
          {detailFooterStatus.duration && (
            <FooterStatusItem
              kind="duration"
              value={detailFooterStatus.duration}
              label={t("app.shell.recordingDuration")}
            />
          )}
          {detailFooterStatus.language && (
            <FooterStatusItem
              kind="language"
              value={detailFooterStatus.language}
              label={t("app.shell.language")}
            />
          )}
          {detailFooterStatus.segments && (
            <FooterStatusItem
              kind="segments"
              value={detailFooterStatus.segments}
              label={t("app.shell.segmentCount")}
            />
          )}
        </div>
      )}
    </footer>
  );
}
