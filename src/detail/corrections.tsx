/** Reading and correcting one block of the transcript: which words a person
 *  changed, how that reads in the sidebar, and the row itself. */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "./../i18n";
import { changedWords, plain } from "./../transcriptText";
import { CONFIDENCE_THRESHOLD, formatTime } from "./../types";
import type { Segment } from "./../types";
/** The words of `text`, with the ones that were not in `original` underlined. */
export function MarkedWords({ original, text }: { original: string; text: string }) {
  const changed = useMemo(() => changedWords(original, text), [original, text]);
  const words = useMemo(() => text.trim().split(/(\s+)/).filter(Boolean), [text]);
  let index = -1;
  return (
    <>
      {words.map((word, i) => {
        if (/^\s+$/.test(word)) return <span key={i}>{word}</span>;
        index += 1;
        return changed.has(index) ? (
          <span key={i} className="corrected">{word}</span>
        ) : (
          <span key={i}>{word}</span>
        );
      })}
    </>
  );
}

/**
 * The narrowest honest description of a manual correction.
 *
 * When the rewrite kept the same number of words and changed exactly one, that
 * word is the whole story and the sentence around it is noise. Anything else —
 * a word added, a clause rebuilt, punctuation moved — cannot be reduced without
 * lying about it, so both versions are shown whole and the reader decides.
 */
export function describeEdit(
  original: string | null,
  text: string
): { before: string; after: string; narrowed: boolean } | null {
  if (!original) return null;
  const before = original.trim();
  const after = text.trim();
  if (!before || before === after) return null;

  const beforeWords = before.split(/\s+/);
  const afterWords = after.split(/\s+/);
  if (beforeWords.length === afterWords.length) {
    const changed = beforeWords
      .map((word, i) => [word, afterWords[i]] as const)
      .filter(([a, b]) => a !== b);
    if (changed.length === 1)
      return { before: changed[0][0], after: changed[0][1], narrowed: true };
  }
  return { before, after, narrowed: false };
}

// --------------------------------------------- correcting a doubtful spot

/**
 * An uncertain spot, rewritten where it is listed.
 *
 * The panel exists to say which places are worth checking. Making the reader
 * travel to the transcript and back for each one turns a list of small chores
 * into a list of interruptions, so double-click opens the text here — the same
 * gesture that opens a segment in the transcript.
 *
 * It saves through the transcript's own `saveText`, not through a second path
 * to the database. That is what makes the transcript, the dictionary
 * suggestion and the "improved document is out of date" flag all react as if
 * the edit had happened down there. Saving also marks the segment checked, so
 * the row leaves the list — which is the point of a worklist.
 */
export function UncertainEditor({
  segment,
  onSave,
  onCancel,
}: {
  segment: Segment;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(segment.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /* Escape blurs the field on its way out, and blur saves. Without this flag
     cancelling would write the very draft it is meant to throw away. */
  const cancelled = useRef(false);

  const grow = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    element.focus();
    // The caret at the end, not the whole text selected: the reader opened
    // this to repair a word, not to retype the sentence.
    element.setSelectionRange(element.value.length, element.value.length);
    grow(element);
  }, []);

  return (
    <div className="uncertain-actions">
      <span className="uncertain-time">{formatTime(segment.start)}</span>
      <textarea
        ref={areaRef}
        value={draft}
        rows={1}
        aria-label={segment.text}
        onChange={(event) => {
          setDraft(event.target.value);
          grow(event.target);
        }}
        onBlur={() => {
          if (!cancelled.current) onSave(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSave(draft);
          } else if (event.key === "Escape") {
            event.preventDefault();
            // The window handler reads Escape as "close the transcript's
            // editor". It must not also see this one.
            event.stopPropagation();
            cancelled.current = true;
            onCancel();
          }
        }}
      />
    </div>
  );
}

// --------------------------------------------------------------- one segment

/**
 * One transcript segment.
 *
 * Wrapped in `memo` with a custom comparison: the clock ticks many times a
 * second and without this the whole transcript — easily a thousand segments —
 * would repaint along with it. Only the segment currently sounding cares about
 * the time; the rest ignore it.
 */
export const SegmentRow = memo(function SegmentRow({
  segment,
  active,
  time,
  editing,
  color,
  onSeek,
  onStartUpravu,
  onConfirm,
  onSave,
  onContextMenu,
  find,
  foundHere,
}: {
  segment: Segment;
  active: boolean;
  time: number;
  editing: boolean;
  color?: string;
  /** Already normalised: lower case and stripped of diacritics. */
  find?: string;
  /** This block is the match the reader is standing on. */
  foundHere?: boolean;
  onSeek: (t: number) => void;
  // The segment passes itself to the handlers. That lets the parent keep them
  // stable, giving the `memo` comparison a chance to succeed at all.
  onStartUpravu: (s: Segment) => void;
  onConfirm: (s: Segment) => void;
  onSave: (s: Segment, text: string) => void;
  onContextMenu: (s: Segment, event: ReactMouseEvent) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(segment.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(segment.text);
  }, [segment.text]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editing]);

  // Word timings come straight from Whisper. Estimating from text length
  // drifted towards the end of a segment, because a segment usually runs on
  // past the final syllable.
  const words = useMemo(() => {
    if (segment.words) {
      try {
        const storedWords = JSON.parse(segment.words) as Array<{ t: number; s: string }>;
        if (storedWords.length > 0) {
          const output: Array<{ text: string; time: number; space: boolean }> = [];
          storedWords.forEach((w, i) => {
            if (i > 0) output.push({ text: " ", time: w.t, space: true });
            output.push({ text: w.s, time: w.t, space: false });
          });
          return output;
        }
      } catch {
        /* corrupt record — fall through to the estimate below */
      }
    }
    // Fallback for older transcripts and manually edited segments.
    const chunks = segment.text.split(/(\s+)/).filter((x) => x.length > 0);
    const total = chunks.reduce((a, k) => a + k.length, 0) || 1;
    let characterPosition = 0;
    return chunks.map((k) => {
      const ratio = characterPosition / total;
      characterPosition += k.length;
      return {
        text: k,
        time: segment.start + ratio * (segment.end - segment.start),
        space: /^\s+$/.test(k),
      };
    });
  }, [segment.words, segment.text, segment.start, segment.end]);

  const uncertain = (segment.confidence ?? 1) < CONFIDENCE_THRESHOLD && !segment.verified;

  /* Which words this segment was corrected on. A manual rewrite clears the
     stored word timings, so the words rendered below are always the plain
     whitespace split — the same one the diff walks, which is what lets an
     index from one address the other. */
  const corrected = useMemo(
    () => (segment.original ? changedWords(segment.original, segment.text) : null),
    [segment.original, segment.text]
  );
  /* The rendered list interleaves spaces, so its position is not the word's.
     Counting them once beats recounting inside the map for every word. */
  const wordOrdinals = useMemo(() => {
    let ordinal = -1;
    return words.map((w) => (w.space ? -1 : ++ordinal));
  }, [words]);

  if (editing) {
    return (
      <div className="segment editing" id={`segment-${segment.id}`}>
        <button className="time-mark" onClick={() => onSeek(segment.start)}>
          {formatTime(segment.start)}
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onBlur={() => onSave(segment, draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSave(segment, draft);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`segment ${active ? "current" : ""} ${uncertain ? "uncertain" : ""} ${
        foundHere ? "found" : ""
      }`}
      id={`segment-${segment.id}`}
      style={color ? { borderLeftColor: color } : undefined}
      onDoubleClick={() => onStartUpravu(segment)}
      onContextMenu={(event) => onContextMenu(segment, event)}
    >
      <button className="time-mark" onClick={() => onSeek(segment.start)}>
        {formatTime(segment.start)}
      </button>

      <p className="segment-text">
        {words.map((s, i) =>
          s.space ? (
            <span key={i}>{s.text}</span>
          ) : (
            <span
              key={i}
              /* A word is marked when it contains what is being looked for.
                 A query with a space in it marks nothing — the words are
                 separate elements and a phrase runs across them — but the
                 block still counts as a match and can be travelled to. */
              className={`word ${active && time >= s.time ? "sounded" : ""} ${
                corrected?.has(wordOrdinals[i]) ? "corrected" : ""
              } ${find && plain(s.text).includes(find) ? "hit" : ""}`}
              onClick={() => onSeek(s.time)}
              /* The context menu reads the moment off the word that was
                 pointed at, so it can play, note or re-transcribe from
                 exactly there rather than from the start of the block. */
              data-time={s.time}
              title={t("detail.segment.wordHint")}
            >
              {s.text}
            </span>
          )
        )}
        {/* The pencil only earns its place when nothing in the line is
            underlined — a segment edited before the archive kept originals.
            Otherwise it repeats what the marks below the words already say. */}
        {segment.edited && !corrected?.size && (
          <span className="edited-mark" title={t("detail.segment.editedHint")}>✎</span>
        )}
      </p>

      {uncertain && (
        <div className="segment-actions">
          <button title={t("detail.review.markCorrectTitle")}
                  aria-label={t("detail.review.markCorrectLabel")}
                  onClick={() => onConfirm(segment)}>
            <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden>
              <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button title={t("detail.review.fixText")} aria-label={t("detail.review.fixText")}
                  onClick={() => onStartUpravu(segment)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z M13.5 6.5l4 4"
                    stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
},
(a, b) =>
  a.segment === b.segment &&
  a.active === b.active &&
  a.editing === b.editing &&
  a.color === b.color &&
  a.onSeek === b.onSeek &&
  a.onStartUpravu === b.onStartUpravu &&
  a.onConfirm === b.onConfirm &&
  a.onSave === b.onSave &&
  a.onContextMenu === b.onContextMenu &&
  a.find === b.find &&
  a.foundHere === b.foundHere &&
  // Only the segment currently sounding cares about the time.
  (!b.active || a.time === b.time)
);
