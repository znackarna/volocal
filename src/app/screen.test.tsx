// @vitest-environment jsdom
/**
 * The application shell, rendered whole.
 *
 * `App.tsx` is 1 960 lines and 33 pieces of state, and until these nothing
 * rendered it at all — the two screens it owns had tests, the thing that
 * decides which of them is open and what may start had none.
 *
 * That is what is pinned here, because it is exactly what the split moves.
 * Which screen is showing, which recording is chosen, what arrives from the
 * backend event streams, and the one question that has to be asked before a
 * run rather than after it.
 *
 * The shell stays the composition root. These tests are written so that
 * `useAppNavigation`, `useTranscriptionRuntime`, `useWatchFolder` and
 * `useNotices` can be lifted out of it without a line of them changing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  api,
  dropHandler,
  installBrowserStubs,
  recording,
  resetApp,
  setRecordings,
  setSettings,
  setTranscribed,
  settings,
} from "./screen.fixtures";

vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());
vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/api/webview", async () => (await import("./screen.fixtures")).webviewMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.23") }));

installBrowserStubs();

import { emit, show } from "./screen.harness";

beforeEach(resetApp);
afterEach(cleanup);

/** The one recording in the archive, as the row that opens it. */
async function openTheRecording(container: HTMLElement) {
  const row = await waitFor(() => {
    const found = [...container.querySelectorAll("button.row-main")].find((b) =>
      b.textContent?.includes("Porada")
    );
    if (!found) throw new Error("the archive has not drawn the recording yet");
    return found as HTMLElement;
  });
  fireEvent.click(row);
}

const onDetail = () => document.querySelector("main.detail") !== null;

describe("moving between the screens", () => {
  test("opens on the archive, with what the backend lists", async () => {
    setRecordings([recording()]);
    const { container } = show();

    await waitFor(() => expect(container.textContent).toContain("Porada"));
    expect(onDetail()).toBe(false);
  });

  test("a recording opens its transcript, and the way back returns to the archive", async () => {
    setRecordings([recording()]);
    const { container } = show();

    await openTheRecording(container);
    await waitFor(() => expect(onDetail()).toBe(true));

    fireEvent.click(container.querySelector(".detail-back-button") as HTMLElement);

    await waitFor(() => expect(onDetail()).toBe(false));
    expect(container.textContent).toContain("Porada");
  });
});

describe("what arrives from the backend", () => {
  test("progress for a run reaches the archive it is listed in", async () => {
    // The shell owns the progress of every recording, not only the one being
    // read: a run started here goes on while the reader walks away to the
    // archive, and the row has to keep saying so.
    setRecordings([recording({ status: "transcribing" })]);
    const { container } = show();
    await waitFor(() => expect(container.textContent).toContain("Porada"));

    await emit("transcription:status", {
      recording_id: "r1",
      phase: "transcribing",
      percent: 42,
      description: { code: "progress.transcribing" },
    });

    await waitFor(() => expect(container.textContent).toContain("42"));
  });

  test("a live segment arrives before the run has finished", async () => {
    setRecordings([recording({ status: "transcribing" })]);
    const { container } = show();
    await waitFor(() => expect(container.textContent).toContain("Porada"));

    await emit("transcription:segment", {
      recording_id: "r1",
      text: "první věta, ještě za běhu",
      start: 0,
      end: 3,
    });

    await waitFor(() => expect(container.textContent).toContain("ještě za běhu"));
  });

  test("a failure is told to the reader rather than swallowed", async () => {
    setRecordings([recording({ status: "transcribing" })]);
    const { container } = show();
    await waitFor(() => expect(container.textContent).toContain("Porada"));

    await emit("transcription:error", ["r1", { code: "errors.transcriptionFailed", values: {} }]);

    await waitFor(() => expect(document.querySelector(".notice")).not.toBeNull());
  });

  test("a notice can be put away", async () => {
    setRecordings([recording()]);
    const { container } = show();
    await waitFor(() => expect(container.textContent).toContain("Porada"));

    await emit("transcription:error", ["r1", { code: "errors.transcriptionFailed", values: {} }]);
    const notice = await waitFor(() => {
      const found = document.querySelector(".notice");
      if (!found) throw new Error("no notice yet");
      return found as HTMLElement;
    });

    fireEvent.click(
      [...notice.querySelectorAll("button")].find((b) => b.textContent === "Close")!
    );
    await waitFor(() => expect(document.querySelector(".notice")).toBeNull(), { timeout: 3000 });
  });
});

describe("the question asked before a run", () => {
  test("with speaker separation off, transcription starts straight away", async () => {
    setSettings(settings({ diarization: false }));
    setRecordings([recording({ status: "new", segment_count: 0 })]);
    setTranscribed(false);
    const { container } = show();
    await openTheRecording(container);
    await waitFor(() => expect(onDetail()).toBe(true));

    fireEvent.click(await screen.findByText("Transcribe"));

    await waitFor(() => expect(api.startTranscription).toHaveBeenCalledWith("r1", null));
    expect(document.querySelector(".speaker-count-dialog")).toBeNull();
  });

  test("with it on, the question comes first and nothing starts until it is answered", async () => {
    // The rule the split has to keep. `Detail` calls a prop and waits for the
    // answer; the shell is where the question lives, because the same question
    // is asked from the archive for several recordings at once.
    setSettings(settings({ diarization: true }));
    setRecordings([recording({ status: "new", segment_count: 0 })]);
    setTranscribed(false);
    const { container } = show();
    await openTheRecording(container);
    await waitFor(() => expect(onDetail()).toBe(true));

    fireEvent.click(await screen.findByText("Transcribe"));

    await waitFor(() => expect(document.querySelector(".dialog")).not.toBeNull());
    expect(api.startTranscription).not.toHaveBeenCalled();
  });

  test("and declining it starts nothing at all", async () => {
    setSettings(settings({ diarization: true }));
    setRecordings([recording({ status: "new", segment_count: 0 })]);
    setTranscribed(false);
    const { container } = show();
    await openTheRecording(container);
    await waitFor(() => expect(onDetail()).toBe(true));

    fireEvent.click(await screen.findByText("Transcribe"));
    const dialog = await waitFor(() => {
      const found = document.querySelector(".dialog");
      if (!found) throw new Error("no dialog yet");
      return found as HTMLElement;
    });

    fireEvent.click(
      [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!
    );

    await waitFor(() => expect(document.querySelector(".dialog")).toBeNull());
    expect(api.startTranscription).not.toHaveBeenCalled();
  });
});

describe("a file dropped on the window", () => {
  test("the window says what will happen to it", async () => {
    setRecordings([]);
    show();
    await waitFor(() => expect(dropHandler).not.toBeNull());

    await act(async () => {
      dropHandler?.({ payload: { type: "over", position: { x: 10, y: 10 } } });
    });

    // With automatic transcription off, the promise is the archive and not a
    // transcript — saying otherwise was a plain untruth.
    await waitFor(() => expect(document.querySelector(".drag-overlay")).not.toBeNull());
  });

  test("and leaving the window takes the promise back", async () => {
    setRecordings([]);
    show();
    await waitFor(() => expect(dropHandler).not.toBeNull());

    await act(async () => {
      dropHandler?.({ payload: { type: "over", position: { x: 10, y: 10 } } });
    });
    await waitFor(() => expect(document.querySelector(".drag-overlay")).not.toBeNull());

    await act(async () => {
      dropHandler?.({ payload: { type: "leave" } });
    });
    await waitFor(() => expect(document.querySelector(".drag-overlay")).toBeNull());
  });

  test("a dropped file is added to the archive", async () => {
    setRecordings([]);
    api.addRecording.mockResolvedValue(recording({ id: "r2", title: "Nahrávka" }));
    show();
    await waitFor(() => expect(dropHandler).not.toBeNull());

    await act(async () => {
      dropHandler?.({ payload: { type: "drop", paths: ["C:\\zvuk\\porada.mp3"] } });
    });

    await waitFor(() => expect(api.addRecording).toHaveBeenCalled());
  });
});

describe("the watched folder", () => {
  /* The poll is not gated on the setting here. The shell asks every five
     seconds, starting 1.2 s after it opens, and the backend answers with
     nothing when the folder is switched off — which is why `scan_watch_folder`
     is safe to call unconditionally. Recorded because it is the kind of thing
     a move can quietly "improve": a `useWatchFolder` that reads the setting
     and skips the call would change when the shell notices a folder switched
     on in Settings. */
  test("is asked about on its own, without anybody pressing anything", async () => {
    vi.useFakeTimers();
    try {
      setSettings(settings({ watch_folder_enabled: true, watch_folder: "C:\sledovana" }));
      setRecordings([]);
      show();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1300);
      });
      expect(api.scanWatchFolder).toHaveBeenCalled();

      // And again, on its own, five seconds later.
      const first = api.scanWatchFolder.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      expect(api.scanWatchFolder.mock.calls.length).toBeGreaterThan(first);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a file found there is offered rather than taken", async () => {
    vi.useFakeTimers();
    try {
      setSettings(settings({ watch_folder_enabled: true, watch_folder: "C:\sledovana" }));
      setRecordings([]);
      api.scanWatchFolder.mockResolvedValue([
        { path: "C:\sledovana\porada.mp3", name: "porada.mp3", fingerprint: "f1" },
      ]);
      const { container } = show();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1300);
      });

      // With automatic transcription off, nothing is started. The file waits
      // in the archive for somebody to say what to do with it.
      expect(api.startTranscription).not.toHaveBeenCalled();

      // Drawn once the state settles. Asked without `waitFor`, which fights
      // the fake clock this test needs.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(container.textContent).toContain("porada.mp3");
    } finally {
      vi.useRealTimers();
    }
  });
});
