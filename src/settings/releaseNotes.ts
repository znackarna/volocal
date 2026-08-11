/** Reading the text that comes with an update.
 *
 *  The notes are written by hand into `latest.json` and are a few lines long.
 *  A markdown library to render three bullet points would be a dependency, a
 *  parser and a sanitising problem for something the release script already
 *  documents the shape of: a line starting with a dash is an item, an empty
 *  line separates blocks, everything else is prose.
 *
 *  Nothing here interprets emphasis, links or headings. If a release ever needs
 *  them, that is the moment to argue for a library — not before.
 */
export type NotesBlock =
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

/** Anything a hand might have typed in front of an item. */
const ITEM = /^[-*•]\s+/;

export function readNotes(notes: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  // Lines rather than characters, and \r\n as well: the notes travel through a
  // PowerShell string, a JSON file and an HTTP response before arriving here.
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];

    if (!line) {
      // A blank line ends whatever was open. Without this, a paragraph after a
      // list would be swallowed into the sentence before it.
      if (last) blocks.push({ kind: "paragraph", text: "" });
      continue;
    }

    if (ITEM.test(line)) {
      const item = line.replace(ITEM, "");
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      continue;
    }

    // Consecutive prose lines are one paragraph: a hand-wrapped sentence is
    // still one sentence, and breaking it at the wrap would space it out as
    // though every line were a thought of its own.
    if (last?.kind === "paragraph" && last.text) last.text += ` ${line}`;
    else if (last?.kind === "paragraph") last.text = line;
    else blocks.push({ kind: "paragraph", text: line });
  }

  // The empty paragraphs the separators left behind have done their work.
  return blocks.filter((b) => b.kind !== "paragraph" || b.text !== "");
}
