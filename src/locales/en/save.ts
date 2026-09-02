import type { csSave } from "../cs/save";

/** Filled by `npm run i18n:import`. Missing keys fall back to Czech. */
export const enSave: Partial<Record<keyof typeof csSave, string>> = {
  "save.title": "What should be saved from this recording?",
  "save.text": "From {name}.",
  "save.shape.audio": "Audio",
  "save.shapeNote.audio": "The recording itself",
  "save.shape.txt": "Text",
  "save.shapeNote.txt": "Plain transcript",
  "save.shape.md": "Markdown",
  "save.shapeNote.md": "Text with speakers and times",
  "save.shape.srt": "SRT subtitles",
  "save.shapeNote.srt": "For editing software and players",
  "save.shape.vtt": "VTT subtitles",
  "save.shapeNote.vtt": "For the web and browser video",
  "save.shape.improvedTxt": "Tidied text",
  "save.shape.improvedMd": "Tidied text (Markdown)",
  "save.shapeNote.improved": "The version the language model straightened out",
  "save.shape.json": "JSON",
  "save.shapeNote.json": "Everything in the transcript, for other tools",
  "save.needsTranscript": "Once there is a transcript",
  "save.button": "Save",
  "save.saving": "Saving…",
  "save.saved": "Saved to {path}.",
  "save.savedMany.one": "{count} file saved.",
  "save.savedMany.other": "{count} files saved.",
};
