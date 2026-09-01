/**
 * The notes section of the transcript sidebar.
 *
 * Draws what `useRecordingNotes` holds. The markup, the class names and the
 * order of everything in it are the ones this section has always had.
 *
 * Two things it owns that the controller does not. The list element, because
 * the measuring below needs a real node; and nothing else — every change to a
 * note goes back through the controller, so there is one answer to what a note
 * says.
 *
 * Deleting asks first, and the question is raised by the screen: the
 * confirmation dialog is the screen's, and a section that opened its own would
 * be a second dialog system. `onConfirmDelete` is how this section asks for it.
 */
import { useLayoutEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { SidebarEmpty, SidebarSection } from "./sidebar";
import { StickyTime, fitNoteTextarea, noteTimeIsValid } from "./notes";
import type { RecordingNotes } from "./useRecordingNotes";
import type { RecordingNote } from "../types";

export function NotesSection({
  notes,
  open,
  onToggle,
  playbackTime,
  duration,
  onConfirmDelete,
}: {
  notes: RecordingNotes;
  /** Whether the sidebar section is unfolded. */
  open: boolean;
  onToggle: () => void;
  /** Where playback stands, which is what an unpinned note is offered. */
  playbackTime: number;
  duration: number;
  onConfirmDelete: (note: RecordingNote) => void;
}) {
  const { t } = useI18n();
  const { state, actions } = notes;

  /* A clamped note unrolls on hover, and CSS can only ease between two lengths
     it knows. The full height of wrapped text is not one of them, so it is
     measured here — `scrollHeight` reports the whole text even while the clamp
     is showing three lines of it — and handed to the stylesheet. The sidebar
     can be resized and a note can be rewritten, so it is measured again
     whenever either changes. */
  const listRef = useRef<HTMLUListElement | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      list.querySelectorAll<HTMLElement>(".sticky-text").forEach((text) => {
        const full = `${text.scrollHeight}px`;
        // Only on change: the observer watches the list this may resize.
        if (text.style.getPropertyValue("--sticky-full") !== full) {
          text.style.setProperty("--sticky-full", full);
        }
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [state.notes, state.openId, state.adding, open]);

  return (
    <SidebarSection
      icon="note"
      title={t("detail.notes.heading")}
      count={state.notes.length}
      open={open}
      onToggle={onToggle}
      action={
        <button
          className="sidebar-text-action"
          onClick={actions.begin}
          disabled={state.adding}
        >
          {/* Drawn on the icon family's own 24 grid with its 1.6 stroke, not on
              the header button's 15 grid. A plus is a full-bleed geometric
              shape: at the header's proportions — arms across 11 of 15, a
              stroke a tenth of the box — it outweighed the speakers glyph
              beside it, which spends its box on detail. Same grid, same
              stroke, same optical weight. */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
               aria-hidden>
            <path d="M12 6v12M6 12h12" />
          </svg>
          {t("detail.notes.add")}
        </button>
      }
    >
      {(state.adding || state.notes.length > 0) && (
        <ul className="stickies" ref={listRef}>
          {state.adding && (
            <li
              className="sticky open"
              /* Leaving an empty composer closes it. Text already written is
                 never thrown away by looking elsewhere. */
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                if (!state.draft.trim()) actions.cancel();
              }}
            >
              <div className="sticky-body">
                <textarea
                  className="sticky-editor"
                  value={state.draft}
                  autoFocus
                  rows={3}
                  ref={fitNoteTextarea}
                  placeholder={t("detail.notes.placeholder")}
                  onChange={(event) => {
                    actions.write(event.target.value);
                    fitNoteTextarea(event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") actions.cancel();
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void actions.add();
                    }
                  }}
                />
                <div className="sticky-tools">
                  <StickyTime
                    time={state.draftTime}
                    playbackTime={playbackTime}
                    open
                    pinDisabled={!state.draft.trim()}
                    onPin={() => actions.pinDraft(playbackTime)}
                    onUnpin={() => actions.pinDraft(null)}
                  />
                  <button
                    className="sticky-confirm"
                    onClick={() => void actions.add()}
                    disabled={!state.draft.trim()}
                  >
                    {t("common.save")}
                  </button>
                </div>
              </div>
            </li>
          )}

          {state.notes.map((note) => {
            const openNote = state.openId === note.id;
            return (
              <li
                key={note.id}
                className={`sticky ${openNote ? "open" : ""}`}
                /* An open note closes when attention moves elsewhere. Moving
                   between its own controls is not leaving. */
                onBlur={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget)) return;
                  if (openNote) actions.open(null);
                }}
              >
                <div className="sticky-body">
                  {openNote ? (
                    <textarea
                      className="sticky-editor"
                      value={note.text}
                      autoFocus
                      rows={1}
                      ref={fitNoteTextarea}
                      onChange={(event) => {
                        actions.rewrite(note.id, event.target.value);
                        fitNoteTextarea(event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" ||
                            (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      onBlur={() => void actions.save(note)}
                    />
                  ) : (
                    /* The whole closed note opens it, so the text is a button
                       rather than a paragraph with a handler. */
                    <button
                      className="sticky-text"
                      onClick={() => actions.open(note.id)}
                      title={t("detail.notes.openTitle")}
                    >
                      {note.text}
                    </button>
                  )}

                  {(openNote || note.time !== null) && (
                    <div className="sticky-tools">
                      <StickyTime
                        time={note.time}
                        playbackTime={playbackTime}
                        open={openNote}
                        onSeek={note.time !== null ? () => actions.goTo(note.time!) : undefined}
                        onPin={() => void actions.setTime(note, playbackTime)}
                        onUnpin={() => void actions.setTime(note, null)}
                        draft={state.timeDrafts[note.id]}
                        invalid={state.timeDrafts[note.id] !== undefined &&
                          !noteTimeIsValid(state.timeDrafts[note.id], duration)}
                        onDraftChange={(value) => actions.writeTime(note.id, value)}
                        onDraftCommit={(value) => void actions.commitTime(note, value)}
                      />
                      {openNote && (
                        <button
                          className="sticky-danger"
                          /* The one place in the application where text a
                             person wrote themselves went on a single click.
                             Deleting a folder asks and offers two answers,
                             removing a recording asks, a re-run asks — and all
                             three destroy something that can be produced
                             again. A note cannot. */
                          onClick={() => onConfirmDelete(note)}
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!state.adding && state.notes.length === 0 && (
        <SidebarEmpty>{t("detail.notes.empty")}</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
