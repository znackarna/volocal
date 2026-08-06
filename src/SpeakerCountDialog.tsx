import { useState } from "react";
import { useI18n } from "./i18n";

/** How many people speak, asked once before a transcription that will separate
 *  them.
 *
 *  Left to itself, the clustering decides the number from the audio, and on a
 *  two-person interview it has been seen to find sixteen. The person starting
 *  the transcription almost always knows the real answer, and knowing it turns
 *  the guess into a constraint — so it is worth one question rather than an
 *  hour of merging speakers afterwards.
 *
 *  The answer belongs to this recording. It is not written to settings, so the
 *  next recording is asked again instead of inheriting an answer that was true
 *  once.
 */
export default function SpeakerCountDialog({
  recordingCount,
  suggested,
  onConfirm,
  onCancel,
}: {
  recordingCount: number;
  /** The stored default, offered as the starting point when it is a real count. */
  suggested: number;
  onConfirm: (speakerCount: number | null) => void;
  onCancel: () => void;
}) {
  const { t, tPlural } = useI18n();
  const [choice, setChoice] = useState<number>(suggested > 0 ? suggested : 2);

  const quick = [1, 2, 3, 4];

  return (
    <div className="prekryv-dialogu" onMouseDown={onCancel}>
      <div
        className="dialog speaker-count-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("dialogs.speakers.title")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{t("dialogs.speakers.title")}</h2>
        <p>
          {recordingCount > 1
            ? tPlural("dialogs.speakers.introMany", recordingCount)
            : t("dialogs.speakers.intro")}
        </p>

        <div className="speaker-count-choices">
          {quick.map((value) => (
            <button
              key={value}
              type="button"
              className={`tlacitko ${choice === value ? "aktivni" : ""}`}
              aria-pressed={choice === value}
              onClick={() => setChoice(value)}
            >
              {value}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={20}
            className="speaker-count-input"
            aria-label={t("dialogs.speakers.exactLabel")}
            value={quick.includes(choice) ? "" : String(choice)}
            placeholder={t("dialogs.speakers.morePlaceholder")}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 1) setChoice(Math.min(20, Math.round(value)));
            }}
          />
        </div>

        <p className="drobne">{t("dialogs.speakers.note")}</p>

        <div className="dialog-patka">
          <button className="tlacitko tichy" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          {/* Not knowing is a real answer, and the honest one for a recording
              whose participants the user has not heard yet. */}
          <button className="tlacitko tichy" onClick={() => onConfirm(null)}>
            {t("dialogs.speakers.unknown")}
          </button>
          <button className="tlacitko hlavni" onClick={() => onConfirm(choice)}>
            {t("dialogs.speakers.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
