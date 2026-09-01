/**
 * Which progress bubble the transcript screen shows, in one place.
 *
 * Three runs can be going over this screen and only one bubble is ever drawn:
 * transcription, separating the speakers, and the language model. The first
 * two share a bubble because they share a cancel — the same backend call stops
 * either — and differ only in what they are called.
 *
 * Presentational, and deliberately so. It starts nothing and stops nothing; it
 * is handed a state that is already known and an action to call. Putting the
 * decision about which bubble appears next to the drawing of it is the whole
 * point: it used to be a nested conditional in the middle of the screen, where
 * the two halves of "is anything running" sat four hundred lines apart.
 */
import ProgressBubble from "../ProgressBubble";
import { useI18n } from "../i18n";
import { useProgressMessage } from "../messages";
import type { AiEditProgress, TranscriptionProgress } from "../types";

export function DetailProgress({
  running,
  diarizing,
  progress,
  aiRunning,
  aiProgress,
  onCancelTranscription,
  onCancelAi,
}: {
  running: boolean;
  diarizing: boolean;
  progress?: TranscriptionProgress;
  aiRunning: boolean;
  aiProgress?: AiEditProgress | null;
  onCancelTranscription: () => void;
  onCancelAi: () => void;
}) {
  const { t } = useI18n();
  const progressMessage = useProgressMessage();

  if (running || diarizing) {
    return (
      <ProgressBubble
        variant="transcription"
        description={
          progress
            ? progressMessage(progress.description)
            : diarizing
              ? t("detail.progress.diarizing")
              : t("detail.progress.transcribing")
        }
        percent={progress?.percent ?? 0}
        /* Recognising speakers can be stopped too. It used to have no way out
           at all, and on a long recording it is the slowest thing this
           application does. */
        onCancel={onCancelTranscription}
        cancelLabel={
          diarizing
            ? t("detail.progress.cancelDiarization")
            : t("detail.progress.cancelTranscription")
        }
      />
    );
  }

  if (aiRunning) {
    return (
      <ProgressBubble
        variant="language"
        description={
          aiProgress ? progressMessage(aiProgress.description) : t("detail.progress.editing")
        }
        percent={aiProgress?.percent ?? 0}
        onCancel={onCancelAi}
        cancelLabel={t("detail.progress.cancelAi")}
      />
    );
  }

  return null;
}
