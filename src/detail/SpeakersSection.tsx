/**
 * The speakers section of the transcript sidebar, and the list of blocks
 * nobody has been given.
 *
 * Draws what `useSpeakerManagement` holds. The markup and the class names are
 * the ones both sections have always had.
 *
 * Two things it asks the screen for rather than doing itself. Starting speaker
 * separation, which goes through the shell so the question about how many
 * people speak is put first; and the confirmation before removing a voice that
 * owns part of the transcript, because the dialog is the screen's.
 */
import { useI18n } from "../i18n";
import InfoNote from "../InfoNote";
import { LineIcon } from "../icons";
import { SidebarEmpty, SidebarSection } from "./sidebar";
import type { SpeakerManagement } from "./useSpeakerManagement";
import type { Speaker } from "../types";

export function SpeakersSection({
  speakers,
  open,
  onToggle,
  onDiarize,
  busy,
  diarizing,
  onConfirmRemove,
}: {
  speakers: SpeakerManagement;
  open: boolean;
  onToggle: () => void;
  /** Through the shell, which asks how many people speak before it starts. */
  onDiarize: () => void;
  busy: boolean;
  diarizing: boolean;
  /** Asked only when the voice owns something; the screen decides how. */
  onConfirmRemove: (speaker: Speaker) => void;
}) {
  const { t } = useI18n();
  const { state, actions } = speakers;

  return (
    <SidebarSection
      icon="speakers"
      title={t("detail.speakers.heading")}
      count={state.speakers.length}
      open={open}
      onToggle={onToggle}
      action={
        /* Both actions on the heading's own line, rather than one of them
           taking a row of its own under the list: the panel is a column of
           three sections and every row spent here is one the reader has to
           scroll past to reach the other two. */
        <div className="speaker-actions">
          {/* "Přidat", like the notes section's own, and second: this is the
              way out of a corner — a recording nobody diarized, or a person the
              clustering folded into somebody else — not the ordinary way in.
              The tooltip says what is being added; the word alone is
              unambiguous inside a card called Mluvčí. */}
          <button
            type="button"
            className="sidebar-text-action speaker-add"
            title={t("detail.speakers.addTitle")}
            onClick={() => void actions.addVoice()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14 M5 12h14" stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" />
            </svg>
            {t("detail.speakers.add")}
          </button>
          <button className="sidebar-text-action" onClick={onDiarize} disabled={busy}>
            <LineIcon name="speakers" size={15} />
            {diarizing
              ? t("detail.speakers.diarizing")
              : state.speakers.length > 0
                ? t("detail.speakers.diarizeAgain")
                : t("detail.speakers.diarize")}
          </button>
        </div>
      }
    >
      {state.speakers.length > 0 ? (
        <>
          <ul className="speaker-list">
            {state.speakers.map((speaker) => (
              <li key={speaker.key}>
                <button
                  type="button"
                  className="speaker-sample"
                  style={{ background: speaker.color }}
                  title={t("detail.speakers.playSample")}
                  aria-label={t("detail.speakers.playSample")}
                  onClick={() => actions.playSample(speaker.key)}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    <path d="M2.5 1.5 L8.5 5 L2.5 8.5 Z" fill="currentColor" />
                  </svg>
                </button>
                <input
                  ref={(field) => {
                    if (!field || state.focusNewName.current !== speaker.key) return;
                    state.focusNewName.current = null;
                    field.focus();
                    field.select();
                  }}
                  value={speaker.name}
                  aria-label={t("detail.speakers.nameLabel")}
                  onChange={(event) => actions.rename(speaker.key, event.target.value)}
                  onFocus={(event) => actions.beginNaming(speaker.key, event.target.value)}
                  onBlur={async (event) => {
                    const typed = event.target.value;
                    actions.endNaming(speaker.key);
                    await actions.commitName(speaker.key, typed);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  spellCheck={false}
                />
                {/* The code of the language this voice speaks, and only on a
                    transcript holding two. Grey and small on purpose: it is a
                    hint about who is who while the reader names them, not a
                    fact the row is about. */}
                {state.languages.get(speaker.key) && (
                  <span className="speaker-language">
                    {state.languages.get(speaker.key)?.toUpperCase()}
                  </span>
                )}
                <span className="speaker-share">
                  {Math.round((state.share.get(speaker.key) ?? 0) * 100)} %
                </span>
                <button
                  type="button"
                  className="speaker-remove"
                  title={t("detail.speakers.remove")}
                  aria-label={t("detail.speakers.remove")}
                  onClick={() => onConfirmRemove(speaker)}
                >
                  <LineIcon name="remove" size={15} />
                </button>
                {state.naming === speaker.key && state.namePool.length > 0 && (
                  <div className="speaker-name-chips">
                    {state.namePool.map((name) => (
                      <button
                        key={name}
                        className="voice-choice"
                        style={{ color: speaker.color, borderColor: speaker.color }}
                        /* Keeps the field focused, so the chips are still
                           mounted when the click lands. */
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void actions.takeName(speaker.key, name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {state.speakers.length > 1 && (
            <div className="speaker-hint">
              <InfoNote>{t("detail.speakers.nameHint")}</InfoNote>
            </div>
          )}
        </>
      ) : (
        <SidebarEmpty>{t("detail.speakers.empty")}</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
