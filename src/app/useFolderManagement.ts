/**
 * The folders the archive is arranged into.
 *
 * The archive shows one level at a time, so `open` is where the person stands.
 * A recording moved out of sight of that level is the point of the feature
 * rather than a surprise.
 *
 * **Deleting a full folder has two answers, not one.** An empty folder is a
 * plain confirmation; a full one asks whether its transcripts go with it. The
 * destructive button is the one that destroys, and keeping them is the quiet
 * way out. The question itself is raised by the shell, because the
 * confirmation dialog is the shell's.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useUserMessage } from "../messages";
import type { Folder } from "../types";

export interface FolderManagement {
  state: {
    folders: Folder[];
    /** Which folder the archive is showing, or the top level. */
    open: string | null;
    /** The naming dialog, when one is up. */
    dialog:
      | { mode: "create"; forRecording: string | null }
      | { mode: "rename"; folder: Folder }
      | null;
  };
  actions: {
    reload: () => Promise<void>;
    show: (folder: string | null) => void;
    beginCreate: (forRecording: string | null) => void;
    beginRename: (folder: Folder) => void;
    closeDialog: () => void;
    /** Answers the naming dialog. */
    submit: (name: string) => Promise<void>;
    move: (id: string, folder: string | null) => Promise<void>;
    /** Removes it, with or without what is inside. */
    remove: (folder: Folder, contents: boolean) => Promise<void>;
  };
}

export function useFolderManagement({
  reloadRecordings,
  onError,
}: {
  reloadRecordings: () => Promise<void>;
  onError: (message: string) => void;
}): FolderManagement {
  const userMessage = useUserMessage();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { mode: "create"; forRecording: string | null } | { mode: "rename"; folder: Folder } | null
  >(null);

  const reload = useCallback(async () => {
    try {
      setFolders(await api.folders());
    } catch (error) {
      onError(userMessage(error));
    }
  }, [onError, userMessage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = useCallback(
    async (name: string) => {
      const request = dialog;
      setDialog(null);
      if (!request) return;
      try {
        if (request.mode === "rename") {
          await api.renameFolder(request.folder.id, name);
        } else {
          const created = await api.createFolder(name);
          // Created from a recording's own menu: it goes straight in, which is
          // what the person was doing when they reached for a new folder.
          if (request.forRecording) {
            await api.moveToFolder([request.forRecording], created.id);
            await reloadRecordings();
          }
        }
        await reload();
      } catch (error) {
        onError(userMessage(error));
      }
    },
    [dialog, onError, reload, reloadRecordings, userMessage]
  );

  const move = useCallback(
    async (id: string, folder: string | null) => {
      try {
        await api.moveToFolder([id], folder);
        await reloadRecordings();
        await reload();
      } catch (error) {
        onError(userMessage(error));
      }
    },
    [onError, reload, reloadRecordings, userMessage]
  );

  const remove = useCallback(
    async (folder: Folder, contents: boolean) => {
      try {
        await api.deleteFolder(folder.id, contents);
        setOpen((current) => (current === folder.id ? null : current));
        await reloadRecordings();
        await reload();
      } catch (error) {
        onError(userMessage(error));
      }
    },
    [onError, reload, reloadRecordings, userMessage]
  );

  return {
    state: { folders, open, dialog },
    actions: {
      reload,
      show: setOpen,
      beginCreate: (forRecording) => setDialog({ mode: "create", forRecording }),
      beginRename: (folder) => setDialog({ mode: "rename", folder }),
      closeDialog: () => setDialog(null),
      submit,
      move,
      remove,
    },
  };
}
