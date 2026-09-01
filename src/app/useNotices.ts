/**
 * The bar at the top of the window that says what just happened.
 *
 * **Two kinds, and they must not look the same.** A failed transcription is
 * red because something needs attention; confirming a word was added to the
 * dictionary is not a warning, and shouting it in red made a routine action
 * feel like a fault.
 *
 * **A notice that stays until it is dismissed becomes furniture.** It gets
 * long enough to be read twice and then goes on its own; the Close button
 * remains for anyone who has already read it. Errors linger longer than
 * confirmations — a confirmation only says that what you asked for happened,
 * an error asks you to do something about it.
 *
 * **A notice carrying a way on does not leave by itself, and draws no ring.**
 * The ring exists to say *this will go, and this soon*, and a button that walks
 * away while it is being read is worse than no button. One press decides it —
 * the way on, or Close.
 */
import { useCallback, useEffect, useState } from "react";

export const NOTICE_LIFE = { info: 5000, error: 9000 } as const;

/** How long the bar takes to slide out once it has been let go. */
const LEAVING = 280;

export interface Notice {
  text: string;
  kind: "info" | "error";
  /** For the rare notice that names something the reader may want to go and
   *  do. Without it a bar can only describe a place and hope the reader finds
   *  it — which is what the update notice did, in prose, at a tab that has
   *  since been renamed. */
  action?: { label: string; run: () => void };
}

export interface Notices {
  state: {
    notice: Notice | null;
    /** Whether it is on its way out, which is what the stylesheet animates. */
    closing: boolean;
  };
  actions: {
    error: (text: string) => void;
    info: (text: string, action?: { label: string; run: () => void }) => void;
    /** Lets it go. It slides out and then it is gone. */
    dismiss: () => void;
  };
}

export function useNotices(): Notices {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [closing, setClosing] = useState(false);

  const error = useCallback((text: string) => {
    setClosing(false);
    setNotice({ text, kind: "error" });
  }, []);

  const info = useCallback((text: string, action?: { label: string; run: () => void }) => {
    setClosing(false);
    setNotice({ text, kind: "info", action });
  }, []);

  const dismiss = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!notice) return;
    if (notice.action && !closing) return;
    const delay = closing ? LEAVING : NOTICE_LIFE[notice.kind];
    const timer = setTimeout(() => {
      if (closing) {
        setNotice(null);
        setClosing(false);
      } else {
        setClosing(true);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [closing, notice]);

  return { state: { notice, closing }, actions: { error, info, dismiss } };
}
