/** Taking something away from a recording: the audio, the transcript, or both. */
export const csSave = {
  "save.title": "Jak chcete nahrávku uložit?",
  "save.text": "Můžete vybrat víc možností najednou.",
  "save.shape.audio": "Zvuk",
  "save.shapeNote.audio": "Původní nahrávka",
  "save.shape.txt": "Text",
  "save.shapeNote.txt": "Čistý přepis",
  "save.shape.md": "Markdown",
  "save.shapeNote.md": "Text s mluvčími a časy",
  "save.shape.srt": "Titulky SRT",
  "save.shapeNote.srt": "Pro střihové programy a přehrávače",
  "save.shape.vtt": "Titulky VTT",
  "save.shapeNote.vtt": "Pro web a videa v prohlížeči",
  "save.shape.improvedTxt": "Upravený text",
  "save.shape.improvedMd": "Upravený text (Markdown)",
  "save.shapeNote.improved": "Verze, kterou srovnal jazykový model",
  "save.shape.json": "JSON",
  "save.shapeNote.json": "Všechna data přepisu pro další zpracování",
  "save.needsTranscript": "Až bude hotový přepis",
  "save.button": "Uložit",
  "save.saving": "Ukládám…",
  "save.saved": "Uloženo do {path}.",
  "save.savedMany.one": "Uložen {count} soubor.",
  "save.savedMany.few": "Uloženy {count} soubory.",
  "save.savedMany.many": "Uloženo {count} souboru.",
  "save.savedMany.other": "Uloženo {count} souborů.",
} as const;

/** Notes for the translator, for keys whose meaning the text alone does
 *  not carry. Leave a whole, plain sentence without one. */
export const csSaveContext: Partial<Record<keyof typeof csSave, string>> = {
  "save.text": "Věta pod nadpisem u seznamu se zaškrtávátky.",
  "save.needsTranscript":
    "Stojí místo popisu u tvarů, které potřebují přepis, dokud nahrávka žádný nemá.",
};
