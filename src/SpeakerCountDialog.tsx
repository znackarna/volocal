import { useState } from "react";
import { useI18n } from "./i18n";
import { useDialog } from "./useDialog";
import InfoNote from "./InfoNote";

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
 *
 *  A second step then asks for their names. Those cannot tell the clustering
 *  which group is whom — it produces anonymous groups and nothing in them
 *  points at Roman — so they are not a constraint but a shortlist: after the
 *  run, the speakers panel offers them under whichever voice is being named,
 *  one click after hearing its sample. Skipping the step costs nothing.
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
  onConfirm: (speakerCount: number | null, names: string[]) => void;
  onCancel: () => void;
}) {
  const { t, tPlural } = useI18n();
  const [choice, setChoice] = useState<number>(suggested > 0 ? suggested : 2);
  const [naming, setNaming] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const dialog = useDialog<HTMLDivElement>(onCancel);

  const quick = [1, 2, 3, 4];

  /* Empty is a perfectly good answer for any one of them: somebody may know
     two of the four names. Only what was written is carried on. */
  const written = names.map((n) => n.trim()).filter(Boolean);

  if (naming) {
    return (
      <div className="prekryv-dialogu" onMouseDown={onCancel}>
        <div
          ref={dialog}
          className="dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.speakers.namesTitle")}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <h2>{t("dialogs.speakers.namesTitle")}</h2>
          <p>{t("dialogs.speakers.namesIntro")}</p>

          <div className="pole speaker-names">
            {Array.from({ length: choice }, (_, i) => (
              <input
                key={i}
                type="text"
                autoFocus={i === 0}
                value={names[i] ?? ""}
                aria-label={t("dialogs.speakers.nameLabel", { number: i + 1 })}
                placeholder={t("dialogs.speakers.namePlaceholder", { number: i + 1 })}
                onChange={(event) => {
                  const next = [...names];
                  next[i] = event.target.value;
                  setNames(next);
                }}
              />
            ))}
          </div>

          <InfoNote>{t("dialogs.speakers.namesNote")}</InfoNote>

          <div className="dialog-patka">
            <button className="tlacitko tichy" onClick={() => setNaming(false)}>
              {t("common.back")}
            </button>
            <button className="tlacitko hlavni" onClick={() => onConfirm(choice, written)}>
              {t("dialogs.speakers.confirm")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="prekryv-dialogu" onMouseDown={onCancel}>
      <div
        ref={dialog}
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
          <button className="tlacitko tichy" onClick={() => onConfirm(null, [])}>
            {t("dialogs.speakers.unknown")}
          </button>
          {/* Not knowing how many there are means not knowing how many name
              fields to draw, so that answer skips the second step entirely. */}
          <button className="tlacitko hlavni" onClick={() => setNaming(true)}>
            {t("common.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
