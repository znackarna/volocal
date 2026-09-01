/**
 * The list of corrections Whisper gets wrong the same way every time — a name,
 * a place, a term from the field. `find` is what comes out of the recording,
 * `replace` is what it should say.
 *
 * The one part of Settings with data of its own and four ways to change it, so
 * it is the one part that becomes a controller rather than a panel.
 *
 * **Two lists, and the difference is the point.** `entries` follows every
 * keystroke, because a row is edited in place. `stored` follows only what was
 * written, and is what a row with an emptied side goes back to.
 *
 * **Leaving a row is what decides it.** There is no separate act of
 * confirming and nothing to cancel — the same rule for the unwritten row at
 * the end and for every saved row above it. An entry with an empty side is not
 * an entry: it would replace everything, or replace it with nothing.
 */
import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api } from "../api";
import { useUserMessage } from "../messages";
import type { DictionaryEntry } from "../types";

const EMPTY_DRAFT = { find: "", replace: "" };

export interface Dictionary {
  state: {
    entries: DictionaryEntry[];
    /** The row that has been asked for and not yet written. It is a row of the
     *  table and not a form above it, so it is held here rather than in the
     *  archive: the archive should never hold an entry with an empty side,
     *  even for the moment between the press and the typing. */
    draft: { find: string; replace: string } | null;
  };
  actions: {
    receive: (entries: DictionaryEntry[]) => void;
    /** The button under the table. One row at a time: pressed while an empty
     *  row is already open, it puts the cursor in that row instead of stacking
     *  a second under it. */
    startDraft: () => void;
    /** The state setter's own shape, because typing into the standing row is
     *  what makes it a draft — the field updates from whatever is there, or
     *  from nothing. */
    writeDraft: Dispatch<SetStateAction<{ find: string; replace: string } | null>>;
    /** Leaving the draft row. Both halves filled, it is written; either one
     *  empty, the row goes away. */
    closeDraft: () => void;
    /** Keeps the unwritten row's first field and puts the cursor in it as it
     *  appears. A stable callback ref runs on mount and unmount and not on
     *  every render, which is what makes it the right place for the focus. */
    holdDraftField: (node: HTMLInputElement | null) => void;
    /** The second field of the unwritten row. On a row being written, Enter is
     *  *next*, not *done*: blurring there would leave a half-filled row, and
     *  half a row is thrown away rather than saved. */
    holdReplaceField: (node: HTMLInputElement | null) => void;
    focusReplaceField: () => void;
    /** Typing in a saved row. Goes no further than the screen. */
    edit: (id: string, change: Partial<DictionaryEntry>) => void;
    /** Leaving a saved row, which is what writes it back. */
    save: (entry: DictionaryEntry) => Promise<void>;
    remove: (id: string) => Promise<void>;
  };
}

export function useDictionary({ onError }: { onError: (message: string) => void }): Dictionary {
  const userMessage = useUserMessage();
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [draft, setDraft] = useState<{ find: string; replace: string } | null>(null);
  const stored = useRef<DictionaryEntry[]>([]);
  const draftField = useRef<HTMLInputElement | null>(null);
  const replaceField = useRef<HTMLInputElement | null>(null);

  const receive = useCallback((incoming: DictionaryEntry[]) => {
    stored.current = incoming;
    setEntries(incoming);
  }, []);

  /* A new entry hints. That is the useful default, and the row's own switch is
     visible the moment the entry appears, so turning it off is one click in the
     place you are already looking. */
  const add = useCallback(
    async (find: string, replace: string) => {
      if (!find || !replace) return;
      try {
        const entry = await api.addDictionaryEntry(find, replace);
        stored.current = [...stored.current, entry];
        setEntries((current) => [...current, entry]);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, userMessage]
  );

  const holdDraftField = useCallback((node: HTMLInputElement | null) => {
    draftField.current = node;
    node?.focus();
  }, []);

  const holdReplaceField = useCallback((node: HTMLInputElement | null) => {
    replaceField.current = node;
  }, []);

  const focusReplaceField = useCallback(() => replaceField.current?.focus(), []);

  const startDraft = useCallback(() => {
    setDraft((current) => current ?? EMPTY_DRAFT);
    /* Only reaches a row that is already open; a row being made this moment is
       focused by the callback ref on its first field, which runs on mount. */
    draftField.current?.focus();
  }, []);

  const closeDraft = useCallback(() => {
    if (!draft) return;
    const find = draft.find.trim();
    const replace = draft.replace.trim();
    setDraft(null);
    void add(find, replace);
  }, [add, draft]);

  const edit = useCallback((id: string, change: Partial<DictionaryEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry))
    );
  }, []);

  /** An entry with an empty side goes back to what is stored rather than being
   *  written. Doing nothing at all was worse than either: the screen showed one
   *  thing, the archive held another, and nobody was told. Deleting an entry
   *  has its own control. */
  const save = useCallback(
    async (entry: DictionaryEntry) => {
      const find = entry.find.trim();
      const replace = entry.replace.trim();
      if (!find || !replace) {
        const kept = stored.current.find((saved) => saved.id === entry.id);
        if (kept) edit(entry.id, { find: kept.find, replace: kept.replace });
        return;
      }
      try {
        await api.updateDictionaryEntry(entry.id, find, replace);
        stored.current = stored.current.map((saved) =>
          saved.id === entry.id ? { ...saved, find, replace } : saved
        );
        edit(entry.id, { find, replace });
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [edit, onError, userMessage]
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.deleteDictionaryEntry(id);
        stored.current = stored.current.filter((entry) => entry.id !== id);
        setEntries((current) => current.filter((entry) => entry.id !== id));
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, userMessage]
  );

  return {
    state: { entries, draft },
    actions: {
      receive,
      startDraft,
      writeDraft: setDraft,
      closeDraft,
      holdDraftField,
      holdReplaceField,
      focusReplaceField,
      edit,
      save,
      remove,
    },
  };
}
