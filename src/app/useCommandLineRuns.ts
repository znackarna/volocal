import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const NONE: ReadonlySet<string> = new Set();

/** How often the window looks. A look is one directory listing beside the
 *  archive, usually of a folder that does not exist. */
const EVERY_MS = 3000;

function same(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/**
 * The recordings `volocal-cli` is transcribing beside the window.
 *
 * The archive marks them as transcribing, as it marks the window's own runs,
 * but no progress reaches this window from the other program: without this,
 * the card showed a bar that never moved and a *Zrušit* that could not stop
 * anything. The backend answers from the locks the command line holds while
 * it works (`run_lock.rs`), which go when its process goes.
 *
 * **The archive is read again when the set changes**, in either direction: a
 * run that started in the terminal appears on its card, and one that finished
 * there arrives with its transcript, without anybody pressing anything. With
 * no command line running, the set stays empty and nothing is ever reloaded.
 *
 * The set keeps its identity until its contents change, so a screen may list
 * it among an effect's dependencies.
 */
export function useCommandLineRuns(reload: () => void): ReadonlySet<string> {
  const [held, setHeld] = useState<ReadonlySet<string>>(NONE);
  const heldRef = useRef<ReadonlySet<string>>(NONE);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    let alive = true;
    const look = async () => {
      let ids: string[];
      try {
        ids = await api.transcriptionsElsewhere();
      } catch {
        return;
      }
      if (!alive) return;
      const next: ReadonlySet<string> = ids.length ? new Set(ids) : NONE;
      if (same(heldRef.current, next)) return;
      heldRef.current = next;
      setHeld(next);
      reloadRef.current();
    };
    void look();
    const timer = setInterval(() => void look(), EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return held;
}
