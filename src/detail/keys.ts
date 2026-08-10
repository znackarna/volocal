/** What a key press over the transcript means.
 *
 *  Lifted out of the listener in `Detail.tsx` so it can be examined without a
 *  window, a player and a screenful of state. Every rule in here was written
 *  because of something that went wrong once, and every one of them is a
 *  silent failure when it goes wrong again: a key that does nothing, or two
 *  things at once, and nothing on screen says why. The comments on the branches
 *  are the reasons; `keys.test.ts` is the proof.
 */

/** The one thing a press asks for. */
export type TranscriptAct =
  | "openFind"
  | "closeFind"
  | "stopEditing"
  | "togglePlayback"
  | "findNext"
  | "findPrevious"
  | "nextUncertain";

export type TranscriptKeyResponse = {
  act: TranscriptAct;
  /** Whether the browser must be stopped from doing its own thing as well. */
  preventDefault: boolean;
};

/** Only the parts of a KeyboardEvent that decide anything. */
export type TranscriptPress = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export type TranscriptContext = {
  /** The find bar is open. */
  finding: boolean;
  /** How many blocks the current query matches. */
  hits: number;
  /** The press landed in a text field, so the letters belong to it. */
  isTyping: boolean;
  /** The press landed on something the browser already answers keys for. */
  onAControl: boolean;
  /** A dialog is on top and owns the keyboard. */
  dialogOpen: boolean;
};

export function transcriptKey(
  press: TranscriptPress,
  { finding, hits, isTyping, onAControl, dialogOpen }: TranscriptContext
): TranscriptKeyResponse | null {
  const escape = (): TranscriptKeyResponse => ({
    act: finding ? "closeFind" : "stopEditing",
    preventDefault: false,
  });

  /* Ctrl+F first, and before the typing guard: it has to work from inside the
     find field itself, and WebView2 answers it with a find bar drawn by
     Windows unless the key is taken here. */
  if ((press.ctrlKey || press.metaKey) && press.key.toLowerCase() === "f" && !dialogOpen) {
    return { act: "openFind", preventDefault: true };
  }

  /* While typing, the letters are the field's. Escape still gets out — but not
     from under a dialog, whose keys are its own. This listener sits on the
     window and used to fire straight through one: with a confirmation on
     screen, Space played audio behind it. */
  if (isTyping || dialogOpen) {
    return press.key === "Escape" && !dialogOpen ? escape() : null;
  }

  /* A control the browser already owns: Space activates a button, a checkbox,
     a link, a summary. Taking it to start the audio instead means the control
     silently does nothing — and on the shared `Select` it did both at once. */
  if (press.code === "Space" && !onAControl) {
    return { act: "togglePlayback", preventDefault: true };
  }

  /* Not Tab. Tab belongs to the browser, and taking it disabled the keyboard
     on the whole screen. F3 is the conventional "find next" and collides with
     nothing here. With the find bar open it keeps that meaning; closed, it
     goes on stepping through the uncertain spots. */
  if (press.key === "F3") {
    if (finding && hits > 0) {
      return { act: press.shiftKey ? "findPrevious" : "findNext", preventDefault: true };
    }
    return { act: "nextUncertain", preventDefault: true };
  }

  if (press.key === "Escape") return escape();

  return null;
}
