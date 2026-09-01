/**
 * The two sidebar sections that stand over the corrections: the places the
 * machine was unsure of, and what has already been changed.
 *
 * They are one file because they are one subject read from two ends — what
 * still needs a look, and what has had one. Both draw from
 * `useTranscriptEditing`, both send the reader to a moment, and neither owns
 * anything.
 *
 * An interjection is clicked in order to *hear* it — a third of a second of
 * text says nothing about whose voice it is — so `onHear` plays rather than
 * just scrolling.
 */
import { useI18n } from "../i18n";
import { PlayMark, SidebarEmpty, SidebarSection } from "./sidebar";
import { MarkedWords, UncertainEditor, describeEdit } from "./corrections";
import { formatTime } from "../types";
import type { TranscriptEditing } from "./useTranscriptEditing";
import type { Segment } from "../types";

export function ReviewSections({
  editing,
  openSections,
  onToggle,
  time,
  onHear,
}: {
  editing: TranscriptEditing;
  openSections: { review: boolean; edits: boolean };
  onToggle: (name: "review" | "edits") => void;
  /** Where playback stands, so the row being played is marked. */
  time: number;
  onHear: (segment: Segment) => void;
}) {
  const { t } = useI18n();
  const { state, actions } = editing;

  return (
    <>
      <SidebarSection
        icon="review"
        title={t("detail.review.heading")}
        count={state.uncertain.length}
        open={openSections.review}
        onToggle={() => onToggle("review")}
      >
        {state.uncertain.length > 0 ? (
          <ul className="uncertain-places">
            {state.uncertain.map((uncertain) => (
              <li key={uncertain.id}>
                {state.editingUncertain === uncertain.id ? (
                  <UncertainEditor
                    segment={uncertain}
                    onSave={(text) => {
                      actions.startUncertain(null);
                      void actions.save(uncertain, text);
                    }}
                    onCancel={() => actions.startUncertain(null)}
                  />
                ) : (
                  <>
                    <button onClick={() => onHear(uncertain)}
                            onDoubleClick={() => actions.startUncertain(uncertain.id)}
                            title={t("detail.review.editHint")}
                            className={uncertain.start <= time && time < uncertain.end ? "current" : ""}>
                      <PlayMark />
                      <span className="uncertain-time">{formatTime(uncertain.start)}</span>
                      <span className="uncertain-text">{uncertain.text}</span>
                    </button>
                    <button className="confirm" title={t("detail.review.markCorrectTitle")}
                            aria-label={t("detail.review.markCorrectLabel")}
                            onClick={() => actions.confirm(uncertain)}>
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                        <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor"
                              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <SidebarEmpty>{t("detail.review.empty")}</SidebarEmpty>
        )}
      </SidebarSection>

      <SidebarSection
        icon="edits"
        title={t("detail.edits.heading")}
        count={state.edited.length}
        open={openSections.edits}
        onToggle={() => onToggle("edits")}
      >
        {state.edited.length > 0 ? (
          <ul className="corrections">
            {state.edited.map((segment) => {
              const change = describeEdit(segment.original, segment.text);
              if (!change) return null;
              return (
                <li key={segment.id}>
                  <button
                    onClick={() => onHear(segment)}
                    title={t("detail.edits.seekTitle")}
                    className={segment.start <= time && time < segment.end ? "current" : ""}
                  >
                    <PlayMark />
                    <span className="correction-time">{formatTime(segment.start)}</span>
                    <span className="correction-change">
                      <span className="correction-before">{change.before}</span>
                      <span className="correction-arrow" aria-hidden>→</span>
                      <span className="correction-after">
                        {/* One word changed: the row is already only that word,
                            so underlining it would say nothing. Both versions
                            whole: the reader would otherwise have to spot the
                            difference. */}
                        {change.narrowed ? (
                          change.after
                        ) : (
                          <MarkedWords original={change.before} text={change.after} />
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <SidebarEmpty>{t("detail.edits.empty")}</SidebarEmpty>
        )}
      </SidebarSection>
    </>
  );
}
