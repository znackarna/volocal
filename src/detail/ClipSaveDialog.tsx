/**
 * What to make of the passage the reader marked.
 *
 * A list of lines with a box on each, because the answer is often more than
 * one: the audio for the podcast, the subtitles for the video and the text for
 * the quote come out of the same two minutes. A row of five buttons asked the
 * reader to pick exactly one and then come back for the next — which is what
 * they were objecting to when they called it ugly, on 2 September.
 *
 * One question hangs off the two subtitle lines. Laid under a cut-out piece of
 * audio, subtitles have to start at zero; annotating the whole recording, they
 * need the recording's own clock. The preview settles it at a glance, which is
 * cheaper than explaining it.
 */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import { useDialog } from "../useDialog";
import { api } from "../api";
import { formatTime } from "../types";
import type { UserMessage } from "../types";
import { saveClip } from "./useClipSelection";
import type { ClipSelection, Shape } from "./useClipSelection";

/** The shapes, their words and the line under each. Spelled out rather than
 *  built from the shape's own name: a key assembled in a template string is
 *  invisible to `i18n:check`, which then cannot tell that a shape added later
 *  has no word of its own — and a missing word shows the reader an identifier. */
const SHAPES = [
  ["audio", "detail.clip.shape.audio", "detail.clip.shapeNote.audio"],
  ["txt", "detail.clip.shape.txt", "detail.clip.shapeNote.txt"],
  ["md", "detail.clip.shape.md", "detail.clip.shapeNote.md"],
  ["srt", "detail.clip.shape.srt", "detail.clip.shapeNote.srt"],
  ["vtt", "detail.clip.shape.vtt", "detail.clip.shapeNote.vtt"],
] as const satisfies ReadonlyArray<readonly [Shape, TranslationKey, TranslationKey]>;

const SUBTITLES: Shape[] = ["srt", "vtt"];

export function ClipSaveDialog({
  clip,
  recordingId,
  chooseFile,
  chooseFolder,
  onError,
  onSaved,
}: {
  clip: ClipSelection;
  recordingId: string;
  /** Where to put it. Handed in so this dialog does not reach for the
   *  operating system itself. */
  chooseFile: (name: string) => Promise<string | null>;
  chooseFolder: () => Promise<string | null>;
  onError: (message: UserMessage) => void;
  onSaved: (paths: string[]) => void;
}) {
  const { t } = useI18n();
  const { state, actions } = clip;
  const [ticked, setTicked] = useState<Shape[]>(["audio"]);
  const [fromZero, setFromZero] = useState(true);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useDialog<HTMLDivElement>(actions.close, state.saving);

  const open = state.saving && state.from !== null;
  const subtitles = ticked.some((shape) => SUBTITLES.includes(shape));
  /* The preview shows the first text shape ticked. Audio has none worth
     drawing: two minutes of waveform says nothing the span above does not. */
  const shown = ticked.find((shape) => shape !== "audio");

  useEffect(() => {
    if (!open || !shown) {
      setPreview("");
      return;
    }
    let current = true;
    api
      .clipPreview(recordingId, state.start, state.end, shown, fromZero)
      .then((text) => {
        if (current) setPreview(text);
      })
      .catch(() => {
        if (current) setPreview("");
      });
    return () => {
      current = false;
    };
  }, [open, shown, fromZero, recordingId, state.start, state.end]);

  if (!open) return null;

  const toggle = (shape: Shape) =>
    setTicked((current) =>
      current.includes(shape) ? current.filter((s) => s !== shape) : [...current, shape]
    );

  const save = async () => {
    setBusy(true);
    await saveClip({
      recordingId,
      // In the order the dialog lists them, so a folder of files comes out in
      // the order the reader read.
      shapes: SHAPES.map(([shape]) => shape).filter((shape) => ticked.includes(shape)),
      start: state.start,
      end: state.end,
      fromZero,
      chooseFile,
      chooseFolder,
      onError,
      onSaved: (paths) => {
        actions.close();
        onSaved(paths);
      },
    });
    setBusy(false);
  };

  return (
    <div className="dialog-overlay" onMouseDown={actions.close}>
      <div
        ref={dialog}
        className="dialog clip-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clip-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="clip-dialog-title">{t("detail.clip.dialogTitle")}</h2>
        <p>
          {t("detail.clip.dialogText", {
            from: formatTime(state.start),
            to: formatTime(state.end),
            length: formatTime(state.seconds),
          })}
        </p>

        <ul className="clip-shapes">
          {SHAPES.map(([shape, word, note]) => (
            <li key={shape}>
              <label className="clip-shape">
                <input
                  type="checkbox"
                  checked={ticked.includes(shape)}
                  onChange={() => toggle(shape)}
                />
                <span className="clip-shape-name">{t(word)}</span>
                <span className="clip-shape-note">{t(note)}</span>
              </label>
            </li>
          ))}
        </ul>

        {subtitles && (
          <label className="clip-zero">
            <input
              type="checkbox"
              checked={fromZero}
              onChange={(event) => setFromZero(event.target.checked)}
            />
            <span>{t("detail.clip.fromZero")}</span>
          </label>
        )}

        {preview && <pre className="clip-preview">{preview.slice(0, 4000)}</pre>}

        <div className="dialog-footer">
          <button className="button" onClick={actions.close} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            className="button primary"
            onClick={() => void save()}
            disabled={busy || ticked.length === 0}
          >
            {busy ? t("detail.clip.saving") : t("detail.clip.saveButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
