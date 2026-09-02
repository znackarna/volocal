// @vitest-environment jsdom
/**
 * Getting back into a transcript while something is running over it.
 *
 * Reported on 2026-09-02: starting the fill for another language shut the card
 * in the archive, and the only way back to the text was the mouse's back
 * button. The card is disabled while a recording transcribes, which is right
 * for a first transcription — there is nothing behind it yet — and wrong for
 * everything that runs over a transcript that already exists.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import type { Recording } from "./types";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("./api", () => ({ api: { search: () => Promise.resolve([]) } }));

import Library from "./Library";

function recording(status: string, segment_count: number): Recording {
  return {
    id: "r",
    path: "C:\nahravky\paul.mp3",
    title: "Paul Bartlett",
    duration: 2861,
    created_at: "2026-09-02T10:00:00Z",
    status,
    model: "large-v3-turbo-q5_0",
    language: "cs",
    language_choice: "",
    error: null,
    segment_count,
    folder: null,
    source_url: null,
    second_language_choice: "",
    second_language_by_reader: false,
    second_language: null,
    second_language_missing: null,
  };
}

function card(one: Recording) {
  render(
    <I18nProvider>
      <Library
        recordings={[one]}
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
        folders={[]}
        openFolder={null}
        onOpenFolder={() => {}}
        onCreateFolder={() => {}}
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
  return screen.getByText("Paul Bartlett").closest("button") as HTMLButtonElement;
}

afterEach(cleanup);

describe("opening a recording something is running over", () => {
  /** The reported fault. A fill writes its blocks at the end rather than one
   *  by one, so nothing streams in and the card stayed shut for its whole
   *  length — over a transcript sitting right there. */
  test("a transcript that already exists opens while a fill runs", () => {
    expect(card(recording("transcribing", 964)).disabled).toBe(false);
  });

  /** And the rule it came from still holds: a first transcription has nothing
   *  to show, and an empty screen reads as a fault. */
  test("a first transcription stays shut until it has something to show", () => {
    expect(card(recording("transcribing", 0)).disabled).toBe(true);
  });

  test("a finished recording opens, as it always did", () => {
    expect(card(recording("done", 964)).disabled).toBe(false);
  });
});
