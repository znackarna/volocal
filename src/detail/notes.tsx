/** Sticky notes on a transcript: their order, their time, and the field that
 *  edits it. */
import { useI18n } from "./../i18n";
import { formatTime } from "./../types";
import type { RecordingNote } from "./../types";
export function fitNoteTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0";
  element.style.height = `${element.scrollHeight}px`;
}

/** Accepts seconds, m:ss, or h:mm:ss. */
export function parseNoteTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.length > 1 && numbers[numbers.length - 1] >= 60) return null;
  if (numbers.length === 3 && numbers[1] >= 60) return null;
  if (numbers.length === 1) return numbers[0];
  if (numbers.length === 2) return numbers[0] * 60 + numbers[1];
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

export function noteTimeIsValid(value: string, duration: number): boolean {
  const parsed = parseNoteTime(value);
  return parsed !== null && (duration <= 0 || parsed <= duration);
}


/** The order the sidebar shows notes in, matching what the database returns.
 *  Notes about the whole recording come first in the order they were written;
 *  the ones tied to a moment follow, in the order they occur. */
export function byNoteOrder(a: RecordingNote, b: RecordingNote): number {
  if ((a.time === null) !== (b.time === null)) return a.time === null ? -1 : 1;
  if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** The time control of a sticky note.
 *
 *  A note does not have to sit anywhere in the recording. When it does, the
 *  chip plays from that moment; opening the note also lets the moment be typed,
 *  which a closed note has no room for. When it does not, the only offer is to
 *  pin it where playback currently stands — that is the position the writer
 *  means nine times out of ten.
 */
export function StickyTime({
  time,
  playbackTime,
  open,
  onPin,
  onUnpin,
  onSeek,
  draft,
  invalid = false,
  pinDisabled = false,
  onDraftChange,
  onDraftCommit,
}: {
  time: number | null;
  playbackTime: number;
  open: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onSeek?: () => void;
  draft?: string;
  invalid?: boolean;
  /** A note with nothing written in it has nothing to pin. */
  pinDisabled?: boolean;
  onDraftChange?: (value: string) => void;
  onDraftCommit?: (value: string) => void;
}) {
  const { t } = useI18n();

  if (time === null) {
    if (!open) return null;
    return (
      <button className="sticky-pin" onClick={onPin} disabled={pinDisabled}>
        {t("detail.notes.pinAt", { time: formatTime(playbackTime) })}
      </button>
    );
  }

  return (
    <>
      <button
        className="sticky-time"
        onClick={onSeek}
        disabled={!onSeek}
        title={t("detail.notes.seekTitle")}
        aria-label={t("detail.notes.seekTo", { time: formatTime(time) })}
      >
        <svg width="9" height="10" viewBox="0 0 10 12" aria-hidden>
          <path d="M2 1.8 8.4 6 2 10.2Z" fill="currentColor" />
        </svg>
        {open && onDraftChange ? null : formatTime(time)}
      </button>
      {open && onDraftChange && (
        <input
          className="sticky-time-input"
          value={draft ?? formatTime(time)}
          aria-label={t("detail.notes.timeLabel")}
          aria-invalid={invalid}
          title={t("detail.notes.timeHint")}
          inputMode="numeric"
          maxLength={8}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={(event) => onDraftCommit?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}
      {open && (
        <button className="sticky-quiet" onClick={onUnpin}>
          {t("detail.notes.unpin")}
        </button>
      )}
    </>
  );
}

