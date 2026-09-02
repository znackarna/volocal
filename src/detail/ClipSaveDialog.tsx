/**
 * What to save the marked stretch as.
 *
 * Four shapes and one question about the fourth: subtitles laid under a piece
 * of cut-out audio need to start at zero, and subtitles that annotate the
 * whole recording need the recording's own clock. Nobody can be expected to
 * remember which, so it is asked here, where the answer is a click.
 *
 * The preview is the text as it will be written. It is the cheapest way to
 * settle the question above: the reader sees `00:00:00` or `00:12:04` and
 * knows.
 */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import { useDialog } from "../useDialog";
import { api } from "../api";
import { formatTime } from "../types";
import type { UserMessage } from "../types";
import { saveClip } from "./useClipSelection";
import type { ClipSelection } from "./useClipSelection";

type Shape = "audio" | "txt" | "md" | "srt" | "vtt";

/** The four shapes and their words, spelled out rather than built from the
 *  shape's own name. A key assembled in a template string is invisible to
 *  `i18n:check`, which then cannot tell that a shape added later has no word
 *  of its own — and a missing word shows the reader an identifier. */
const SHAPES = [
  ["audio", "detail.clip.shape.audio"],
  ["txt", "detail.clip.shape.txt"],
  ["md", "detail.clip.shape.md"],
  ["srt", "detail.clip.shape.srt"],
  ["vtt", "detail.clip.shape.vtt"],
] as const satisfies ReadonlyArray<readonly [Shape, TranslationKey]>;

export function ClipSaveDialog({
  clip,
  recordingId,
  choose,
  onError,
  onSaved,
}: {
  clip: ClipSelection;
  recordingId: string;
  /** Asks the reader where to put it. Handed in so this dialog does not reach
   *  for the operating system itself. */
  choose: (name: string) => Promise<string | null>;
  onError: (message: UserMessage) => void;
  onSaved: (path: string) => void;
}) {
  const { t } = useI18n();
  const { state, actions } = clip;
  const [shape, setShape] = useState<Shape>("audio");
  const [fromZero, setFromZero] = useState(true);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useDialog<HTMLDivElement>(actions.closeSave, state.saving);

  const open = state.saving && state.active;

  /* The preview follows every change to the question above it. Audio has no
     preview to show — a waveform of two minutes would say nothing the times
     in the bar do not. */
  useEffect(() => {
    if (!open || shape === "audio") {
      setPreview("");
      return;
    }
    let current = true;
    api
      .clipPreview(recordingId, state.start, state.end, shape, fromZero)
      .then((text) => {
        if (current) setPreview(text);
      })
      .catch(() => {
        if (current) setPreview("");
      });
    return () => {
      current = false;
    };
  }, [open, shape, fromZero, recordingId, state.start, state.end]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    const suggested = await api
      .suggestedClipName(recordingId, state.start, state.end, shape)
      .catch(() => "");
    await saveClip({
      recordingId,
      format: shape,
      start: state.start,
      end: state.end,
      fromZero,
      suggested,
      choose,
      onError,
      onSaved: (path) => {
        actions.closeSave();
        actions.clear();
        onSaved(path);
      },
    });
    setBusy(false);
  };

  return (
    <div className="dialog-overlay" onMouseDown={actions.closeSave}>
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
          })}
        </p>

        <div className="clip-shapes">
          {SHAPES.map(([one, word]) => (
            <button
              key={one}
              className={`button ${shape === one ? "primary" : ""}`}
              onClick={() => setShape(one)}
            >
              {t(word)}
            </button>
          ))}
        </div>

        {(shape === "srt" || shape === "vtt") && (
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
          <button className="button" onClick={actions.closeSave} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button className="button primary" onClick={() => void save()} disabled={busy}>
            {busy ? t("detail.clip.saving") : t("detail.clip.saveButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
