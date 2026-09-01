// @vitest-environment jsdom
/**
 * The way into a folder on an empty archive, over the owner's question of
 * 26 August: with no transcripts there is no way to make one.
 *
 * `Nová složka` lives in the folder block, and the block was drawn only where
 * `folders.length > 0 || recordings.length > 0`. It is also the only button in
 * the application that makes a folder not made for a recording already in hand
 * — so on an empty archive nothing could be created, and nothing ever
 * satisfied the condition.
 *
 * Rendered rather than reasoned about, because the fault was a condition that
 * reads as sensible in the source and is only wrong from in front of the
 * screen.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import { enLibrary } from "./locales/en/library";
import type { Folder, Recording } from "./types";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("./api", () => ({
  api: {
    search: () => Promise.resolve([]),
  },
}));

import Library from "./Library";

const say = (key: keyof typeof enLibrary) => enLibrary[key]!;

function recording(id: string): Recording {
  return {
    id,
    path: `C:\\nahravky\\${id}.mp3`,
    title: `Nahrávka ${id}`,
    duration: 60,
    created_at: "2026-08-26T10:00:00Z",
    status: "done",
    model: "large-v3",
    language: "cs",
    language_choice: "cs",
    error: null,
    segment_count: 4,
    folder: null,
    source_url: null,
  second_language_choice: "",
  };
}

function folder(id: string): Folder {
  return {
    id,
    name: `Složka ${id}`,
    created_at: "2026-08-26T10:00:00Z",
    recording_count: 0,
    duration: 0,
  };
}

function show({
  recordings = [] as Recording[],
  folders = [] as Folder[],
} = {}) {
  const onCreateFolder = vi.fn();
  render(
    <I18nProvider>
      <Library
        recordings={recordings}
        progress={{}}
        aiProgress={{}}
        liveSegments={{}}
        issues={[]}
        watchCandidates={[]}
        watchDecisionRunning={false}
        onTranscribeWatchCandidates={() => {}}
        onIgnoreWatchCandidates={() => {}}
        onAddWatchCandidates={() => {}}
        onOpen={() => {}}
        onExportAudio={() => {}}
        folders={folders}
        openFolder={null}
        onOpenFolder={() => {}}
        onCreateFolder={onCreateFolder}
        onRenameFolder={() => {}}
        onDeleteFolder={() => {}}
        onMoveToFolder={() => {}}
        onCreateFolderFor={() => {}}
        onDelete={() => {}}
        onTranscription={() => {}}
        onCancel={() => {}}
        onDeleteTranscription={() => {}}
        onRename={() => {}}
        onAdd={() => {}}
        onFinishSetup={() => {}}
        fetching={false}
        automatic={false}
        onAutomatic={() => {}}
        onTranscriptionLanguage={() => {}}
      onSecondLanguage={() => {}}
      />
    </I18nProvider>
  );
  return { onCreateFolder };
}

afterEach(cleanup);

describe("making a folder", () => {
  /** The reported fault. Nothing in the archive at all — which is every
   *  installation on its first day. */
  test("is offered on an empty archive", () => {
    show();

    expect(screen.getByText(say("library.folders.create"))).toBeTruthy();
    expect(screen.getByText(say("library.folders.empty"))).toBeTruthy();
  });

  /** And the button is the real one, not a heading that looks like it. */
  test("the button on an empty archive asks for a folder", () => {
    const { onCreateFolder } = show();

    screen.getByText(say("library.folders.create")).click();

    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });

  /** The states that already worked, so removing the condition is not read as
   *  removing the block's other reasons to be quiet. */
  test("is offered once there are recordings", () => {
    show({ recordings: [recording("a")] });

    expect(screen.getByText(say("library.folders.create"))).toBeTruthy();
  });

  test("is offered once there are folders", () => {
    show({ folders: [folder("f")] });

    expect(screen.getByText(say("library.folders.create"))).toBeTruthy();
    expect(screen.queryByText(say("library.folders.empty"))).toBeNull();
  });
});
