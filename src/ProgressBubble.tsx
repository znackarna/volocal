import { useI18n } from "./i18n";

/**
 * The bubble that says a long job is running, in the lower right corner.
 *
 * Fixed to the window rather than to a screen, which is what lets it stay put
 * while the reader walks away from the screen that started the work. Three
 * kinds share it because they are one idea; a second copy would have drifted
 * from this one the first time either was touched.
 */
export default function ProgressBubble({
  variant,
  description,
  percent,
  onCancel,
  cancelLabel,
}: {
  variant: "transcription" | "language" | "download";
  description: string;
  percent: number;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const { t } = useI18n();
  const safePercent = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : 0;

  return (
    <div className="detail-progress-bubble">
      <span className="detail-progress-icon" aria-hidden>
        {variant === "language" ? (
          "✦"
        ) : variant === "download" ? (
          /* Into the machine, not out of it: the arrow points at the tray. */
          <svg width="17" height="16" viewBox="0 0 18 18" fill="none">
            <path
              d="M9 2v9m0 0 3.4-3.4M9 11 5.6 7.6M3 14.5h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="19" height="16" viewBox="0 0 19 16" fill="none">
            <path
              d="M1.5 8h2l1.35-4.5L7.2 13l2.15-10 2.3 8 1.5-5 1.25 2H17.5"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <div className="detail-progress-body" role="status" aria-live="polite">
        <div className="detail-progress-row">
          <span>{description}</span>
          <span>{t("detail.progress.percent", { value: Math.round(safePercent) })}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${safePercent}%` }} />
        </div>
      </div>
      {onCancel && (
        <button
          type="button"
          className="detail-progress-cancel"
          onClick={onCancel}
          aria-label={cancelLabel ?? t("common.cancel")}
          title={t("common.cancel")}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor"
                  strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
