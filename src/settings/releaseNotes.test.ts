import { describe, expect, test } from "vitest";
import { readNotes } from "./releaseNotes";

/** The notes arrive as one string from a JSON file somebody typed on a command
 *  line. Everything here is about that journey: what a hand actually writes,
 *  and what the string looks like by the time it gets here. */
describe("readNotes", () => {
  test("a dash starts an item, and the dash itself is not part of it", () => {
    expect(readNotes("- Mluvčího jde odstranit.\n- Plus sedí uprostřed.")).toEqual([
      { kind: "list", items: ["Mluvčího jde odstranit.", "Plus sedí uprostřed."] },
    ]);
  });

  test("a star and a bullet mean the same thing", () => {
    expect(readNotes("* jedna\n• dvě")).toEqual([{ kind: "list", items: ["jedna", "dvě"] }]);
  });

  test("a sentence before the list stays a sentence", () => {
    expect(readNotes("Tahle verze opravuje přehrávání.\n\n- rychlejší start")).toEqual([
      { kind: "paragraph", text: "Tahle verze opravuje přehrávání." },
      { kind: "list", items: ["rychlejší start"] },
    ]);
  });

  test("a paragraph after a list is not swallowed by it", () => {
    // Without the blank line rule this came back as one list whose last item
    // was the closing sentence.
    expect(readNotes("- jedna\n\nA to je vše.")).toEqual([
      { kind: "list", items: ["jedna"] },
      { kind: "paragraph", text: "A to je vše." },
    ]);
  });

  test("a wrapped sentence is one paragraph, not one per line", () => {
    expect(readNotes("Tohle je dlouhá věta,\nkterou někdo zalomil.")).toEqual([
      { kind: "paragraph", text: "Tohle je dlouhá věta, kterou někdo zalomil." },
    ]);
  });

  test("windows line endings are lines too", () => {
    // The text goes through a PowerShell string on the way in.
    expect(readNotes("- jedna\r\n- dvě")).toEqual([
      { kind: "list", items: ["jedna", "dvě"] },
    ]);
  });

  test("nothing in, nothing out — the dialog uses this to stay closed", () => {
    expect(readNotes("")).toEqual([]);
    expect(readNotes("   \n\n  ")).toEqual([]);
  });
});
