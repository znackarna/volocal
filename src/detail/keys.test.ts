import { describe, expect, test } from "vitest";
import { transcriptKey } from "./keys";
import type { TranscriptContext, TranscriptPress } from "./keys";

/** The keyboard over the transcript. Nothing here has a visible failure: a key
 *  that stops working looks exactly like a key nobody pressed, and a key that
 *  does two things looks like a bug somewhere else entirely. Most of these
 *  rules exist because one of those happened. */

const press = (over: Partial<TranscriptPress> = {}): TranscriptPress => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

const at = (over: Partial<TranscriptContext> = {}): TranscriptContext => ({
  finding: false,
  hits: 0,
  isTyping: false,
  onAControl: false,
  dialogOpen: false,
  ...over,
});

const SPACE = press({ key: " ", code: "Space" });
const ESCAPE = press({ key: "Escape" });
const F3 = press({ key: "F3" });
const CTRL_F = press({ key: "f", ctrlKey: true });

describe("Ctrl+F", () => {
  test("opens the find bar and takes the key from Windows", () => {
    // WebView2 answers Ctrl+F with a find bar of its own, drawn by the system
    // over the application, unless the press is taken here.
    expect(transcriptKey(CTRL_F, at())).toEqual({ act: "openFind", preventDefault: true });
  });

  test("works from inside the find field, which is why it comes before the typing guard", () => {
    expect(transcriptKey(CTRL_F, at({ isTyping: true, finding: true }))?.act).toBe("openFind");
  });

  test("Cmd+F is the same key on the other keyboard", () => {
    expect(transcriptKey(press({ key: "f", metaKey: true }), at())?.act).toBe("openFind");
  });

  test("capitals are the same key", () => {
    expect(transcriptKey(press({ key: "F", ctrlKey: true }), at())?.act).toBe("openFind");
  });

  test("a dialog keeps it, because the dialog owns the keyboard", () => {
    expect(transcriptKey(CTRL_F, at({ dialogOpen: true }))).toBeNull();
  });

  test("f on its own is a letter", () => {
    expect(transcriptKey(press({ key: "f" }), at())).toBeNull();
  });
});

describe("Space", () => {
  test("plays and pauses, and does not scroll the page as well", () => {
    expect(transcriptKey(SPACE, at())).toEqual({ act: "togglePlayback", preventDefault: true });
  });

  test("on a button it belongs to the button", () => {
    // Taken here instead, the control silently did nothing — and on the shared
    // Select it did both at once.
    expect(transcriptKey(SPACE, at({ onAControl: true }))).toBeNull();
  });

  test("while typing it is a space", () => {
    expect(transcriptKey(SPACE, at({ isTyping: true }))).toBeNull();
  });

  test("under a dialog it does not play audio behind it", () => {
    expect(transcriptKey(SPACE, at({ dialogOpen: true }))).toBeNull();
  });
});

describe("F3", () => {
  test("with the find bar open and something found, it steps to the next hit", () => {
    expect(transcriptKey(F3, at({ finding: true, hits: 3 }))).toEqual({
      act: "findNext",
      preventDefault: true,
    });
  });

  test("with Shift it steps back", () => {
    expect(
      transcriptKey(press({ key: "F3", shiftKey: true }), at({ finding: true, hits: 3 }))?.act
    ).toBe("findPrevious");
  });

  test("with the find bar open but nothing found, it goes back to the uncertain spots", () => {
    expect(transcriptKey(F3, at({ finding: true, hits: 0 }))?.act).toBe("nextUncertain");
  });

  test("with the find bar closed it walks the uncertain spots", () => {
    expect(transcriptKey(F3, at())).toEqual({ act: "nextUncertain", preventDefault: true });
  });

  test("Shift alone does not turn it into stepping back through uncertain spots", () => {
    expect(transcriptKey(press({ key: "F3", shiftKey: true }), at())?.act).toBe("nextUncertain");
  });

  test("while typing it does nothing, and under a dialog likewise", () => {
    expect(transcriptKey(F3, at({ isTyping: true }))).toBeNull();
    expect(transcriptKey(F3, at({ dialogOpen: true }))).toBeNull();
  });
});

describe("Escape", () => {
  test("with the find bar open it closes the find bar", () => {
    expect(transcriptKey(ESCAPE, at({ finding: true }))).toEqual({
      act: "closeFind",
      preventDefault: false,
    });
  });

  test("otherwise it leaves the block being edited", () => {
    expect(transcriptKey(ESCAPE, at())?.act).toBe("stopEditing");
  });

  test("it works from inside a field — that is the whole point of it", () => {
    expect(transcriptKey(ESCAPE, at({ isTyping: true }))?.act).toBe("stopEditing");
    expect(transcriptKey(ESCAPE, at({ isTyping: true, finding: true }))?.act).toBe("closeFind");
  });

  test("a dialog closes itself; this listener must not reach past it", () => {
    // The dialog has its own Escape. Answering here as well closed both at
    // once — the dialog and the editor behind it.
    expect(transcriptKey(ESCAPE, at({ dialogOpen: true }))).toBeNull();
    expect(transcriptKey(ESCAPE, at({ dialogOpen: true, isTyping: true }))).toBeNull();
    expect(transcriptKey(ESCAPE, at({ dialogOpen: true, finding: true }))).toBeNull();
  });

  test("it never takes the key from the browser", () => {
    expect(transcriptKey(ESCAPE, at())?.preventDefault).toBe(false);
  });
});

describe("everything else", () => {
  test("Tab is the browser's, so the rest of the screen stays reachable", () => {
    // Taken here once, and it disabled the keyboard on the whole screen: back,
    // the title menu, both document actions and the entire sidebar.
    expect(transcriptKey(press({ key: "Tab", code: "Tab" }), at())).toBeNull();
    expect(transcriptKey(press({ key: "Tab", shiftKey: true }), at())).toBeNull();
  });

  test("ordinary typing is nobody's business here", () => {
    for (const key of ["a", "Enter", "ArrowDown", "Delete", "F5", "Home"]) {
      expect(transcriptKey(press({ key, code: key }), at())).toBeNull();
    }
  });
});
