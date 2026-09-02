/**
 * What to take away from a whole recording.
 *
 * The same question the clip dialog asks about a passage, so it wears the same
 * list: the audio for the podcast, the subtitles for the video and the text for
 * the quote come out of one recording at one moment, and a control that asks
 * for one of them at a time asks the reader to come back four times.
 *
 * It replaces `Uložit zvuk…`, which was the audio alone behind a menu item
 * that named it — one door for one format while the transcript's own formats
 * sat behind another. Asked for on 2026-09-02: *Uložit zvuk bych změnil na
 * Uložit jako*.
 */
import { useState } from "react";
import { useI18n } from "./i18n";
import type { TranslationKey } from "./i18n";
import { useDialog } from "./useDialog";
import { CheckBox } from "./CheckBox";
import { api } from "./api";
import type { Recording, UserMessage } from "./types";

/** What may come out of a recording. Audio first: it is the one thing here
 *  that is not the transcript. The last two are the language model's tidied
 *  version, and appear only when there is one. */
export type SaveShape =
  | "audio"
  | "txt"
  | "md"
  | "srt"
  | "vtt"
  | "json"
  | "improved-txt"
  | "improved-md";

/** The shapes, their words and the line under each — spelled out rather than
 *  built from the shape's name, so `i18n:check` can see the keys and catch a
 *  shape added later without a word of its own. */
const SHAPES = [
  ["audio", "save.shape.audio", "save.shapeNote.audio"],
  ["txt", "save.shape.txt", "save.shapeNote.txt"],
  ["md", "save.shape.md", "save.shapeNote.md"],
  ["srt", "save.shape.srt", "save.shapeNote.srt"],
  ["vtt", "save.shape.vtt", "save.shapeNote.vtt"],
  ["json", "save.shape.json", "save.shapeNote.json"],
] as const satisfies ReadonlyArray<readonly [SaveShape, TranslationKey, TranslationKey]>;

/** Shown only over a recording that has one. */
const IMPROVED = [
  ["improved-txt", "save.shape.improvedTxt", "save.shapeNote.improved"],
  ["improved-md", "save.shape.improvedMd", "save.shapeNote.improved"],
] as const satisfies ReadonlyArray<readonly [SaveShape, TranslationKey, TranslationKey]>;

/** The name a file gets when several are written at once and nobody is asked
 *  for one. The recording's title, minus the characters a file name cannot
 *  hold. */
function nameFor(recording: Recording, shape: SaveShape): string {
  const plain = (recording.title || "nahravka").replace(/[\\/:*?"<>|]/g, "-");
  // The tidied version is a second file beside the plain one, so its name has
  // to differ. `-upraveny` rather than a word from the dictionary: a file name
  // is not interface copy, and it goes onto a disk that may not speak Czech.
  if (shape.startsWith("improved-")) return `${plain}-upraveny.${shape.slice(9)}`;
  if (shape !== "audio") return `${plain}.${shape}`;
  // Audio keeps the source's own container, so it plays wherever the recording
  // plays and is handed over without being re-encoded.
  const extension = recording.path.split(".").pop()?.toLowerCase() || "mp3";
  return `${plain}.${extension}`;
}

export async function saveRecording({
  recording,
  shapes,
  chooseFile,
  chooseFolder,
  onError,
  onSaved,
}: {
  recording: Recording;
  shapes: SaveShape[];
  chooseFile: (name: string) => Promise<string | null>;
  chooseFolder: () => Promise<string | null>;
  onError: (message: UserMessage) => void;
  onSaved: (paths: string[]) => void;
}): Promise<void> {
  if (shapes.length === 0) return;
  const written: string[] = [];
  try {
    const names = shapes.map((shape) => nameFor(recording, shape));

    let destinations: string[];
    if (shapes.length === 1) {
      const chosen = await chooseFile(names[0]);
      if (!chosen) return;
      destinations = [chosen];
    } else {
      const folder = await chooseFolder();
      if (!folder) return;
      destinations = names.map((name) => `${folder}\\${name}`);
    }

    for (const [index, shape] of shapes.entries()) {
      const path = destinations[index];
      if (shape === "audio") {
        await api.exportAudio(recording.id, path);
        written.push(path);
      } else if (shape.startsWith("improved-")) {
        written.push(
          await api.saveAiDocument(recording.id, shape.slice(9) as "txt" | "md", path)
        );
      } else {
        written.push(await api.saveExport(recording.id, shape, path));
      }
    }
    onSaved(written);
  } catch (error) {
    if (written.length > 0) onSaved(written);
    onError(error as UserMessage);
  }
}

export function SaveRecordingDialog({
  recording,
  chooseFile,
  chooseFolder,
  improved,
  onClose,
  onError,
  onSaved,
}: {
  /** The recording being saved, or null when the dialog is shut. */
  recording: Recording | null;
  /** Whether the language model's tidied version exists and is current. Two
   *  more rows when it does — it used to live in a dropdown of its own in the
   *  transcript header, which is the second door this dialog closed. */
  improved?: boolean;
  chooseFile: (name: string) => Promise<string | null>;
  chooseFolder: () => Promise<string | null>;
  onClose: () => void;
  onError: (message: UserMessage) => void;
  onSaved: (paths: string[]) => void;
}) {
  const { t } = useI18n();
  const [ticked, setTicked] = useState<SaveShape[]>(["audio"]);
  const [busy, setBusy] = useState(false);
  const dialog = useDialog<HTMLDivElement>(onClose, recording !== null);

  if (!recording) return null;

  /* Nothing to write but the audio until there is a transcript. The rows stay
     visible rather than disappearing: a reader who has not transcribed yet
     should be able to see what saving will offer once they have. */
  const noTranscript = recording.segment_count === 0;

  const toggle = (shape: SaveShape) =>
    setTicked((current) =>
      current.includes(shape) ? current.filter((s) => s !== shape) : [...current, shape]
    );

  const rows = improved ? [...SHAPES, ...IMPROVED] : SHAPES;
  const offered = (shape: SaveShape) => !(noTranscript && shape !== "audio");
  const chosen = rows
    .map(([shape]) => shape)
    .filter((shape) => ticked.includes(shape) && offered(shape));

  const save = async () => {
    setBusy(true);
    await saveRecording({
      recording,
      shapes: chosen,
      chooseFile,
      chooseFolder,
      onError,
      onSaved: (paths) => {
        onClose();
        onSaved(paths);
      },
    });
    setBusy(false);
  };

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="dialog save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="save-dialog-title">{t("save.title")}</h2>
        <p>{t("save.text", { name: recording.title })}</p>

        <ul className="save-choices">
          {rows.map(([shape, word, note]) => (
            <li key={shape}>
              <label className="save-choice">
                <input
                  type="checkbox"
                  className="check-box-input"
                  checked={ticked.includes(shape) && offered(shape)}
                  disabled={!offered(shape)}
                  onChange={() => toggle(shape)}
                />
                <CheckBox />
                <span className="save-choice-name">{t(word)}</span>
                <span className="save-choice-note">
                  {offered(shape) ? t(note) : t("save.needsTranscript")}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="dialog-footer">
          <button className="button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            className="button primary"
            onClick={() => void save()}
            disabled={busy || chosen.length === 0}
          >
            {busy ? t("save.saving") : t("save.button")}
          </button>
        </div>
      </div>
    </div>
  );
}
