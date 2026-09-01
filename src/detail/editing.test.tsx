// @vitest-environment jsdom
/**
 * Correcting a block of the transcript, and the two operations this screen is
 * not allowed to start by itself.
 *
 * The first half is what `editing` and `saveText` do today, pinned before they
 * move into a controller of their own.
 *
 * The second half is a boundary rather than a feature, and it is the one worth
 * being careful about. Transcription and speaker separation are started
 * through the shell, which asks a question first — how many people speak, or
 * whether an existing transcript may be thrown away. `Detail` calls a prop and
 * waits for the answer. Should a later split let this screen reach the backend
 * directly, both questions would be skipped from here and nothing would fail
 * to compile.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { RECORDING_ID, api, conversation, installBrowserStubs, setDetail } from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { resetScreen, say, show, transcriptShown } from "./screen.harness";
import { enDialogs } from "../locales/en/dialogs";

beforeEach(() => {
  resetScreen();
  setDetail(conversation());
});
afterEach(cleanup);

const block = (container: HTMLElement, id: string) =>
  container.querySelector(`#segment-${id}`) as HTMLElement;

const editorIn = (container: HTMLElement, id: string) =>
  block(container, id).querySelector("textarea") as HTMLTextAreaElement;

/** Double-clicking a block is how a correction begins — there is no button. */
async function edit(container: HTMLElement, id: string) {
  fireEvent.doubleClick(block(container, id));
  await waitFor(() => expect(editorIn(container, id)).toBeTruthy());
  return editorIn(container, id);
}

describe("correcting a block of the transcript", () => {
  test("a double click opens the block for writing, with its own text in it", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const editor = await edit(container, "s3");
    expect(editor.value).toBe("První je rozpočet.");
    expect(block(container, "s3").className).toContain("editing");
  });

  test("Enter saves the correction", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const editor = await edit(container, "s3");
    fireEvent.change(editor, { target: { value: "První je rozpočet na příští rok." } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() =>
      expect(api.updateSegment).toHaveBeenCalledWith("s3", "První je rozpočet na příští rok.")
    );
    // And the transcript shows it without waiting for a reload. The word is
    // on the screen twice by then — the block itself, and the corrections list
    // that a rewritten block joins — so the question is asked of the block.
    await waitFor(() => expect(block(container, "s3").textContent).toContain("příští"));
  });

  test("Shift+Enter is a new line, not a save", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const editor = await edit(container, "s3");
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });

    expect(api.updateSegment).not.toHaveBeenCalled();
    expect(editorIn(container, "s3")).toBeTruthy();
  });

  test("looking away saves too", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const editor = await edit(container, "s3");
    fireEvent.change(editor, { target: { value: "První je rozvaha." } });
    fireEvent.blur(editor);

    await waitFor(() => expect(api.updateSegment).toHaveBeenCalledWith("s3", "První je rozvaha."));
  });

  test("text that did not change is not written back", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const editor = await edit(container, "s3");
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(editorIn(container, "s3")).toBeNull());
    expect(api.updateSegment).not.toHaveBeenCalled();
  });

  test("Escape gives the correction up", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const editor = await edit(container, "s3");
    fireEvent.change(editor, { target: { value: "něco jiného" } });
    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(editorIn(container, "s3")).toBeNull());
    expect(api.updateSegment).not.toHaveBeenCalled();
    // The block reads as it did before.
    expect(block(container, "s3").textContent).toContain("rozpočet");
  });

  test("only one block is open at a time", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    await edit(container, "s2");
    await edit(container, "s3");

    await waitFor(() => expect(editorIn(container, "s2")).toBeNull());
    expect(editorIn(container, "s3")).toBeTruthy();
  });
});

describe("the operations this screen does not start itself", () => {
  test("speaker separation goes through the shell", async () => {
    const onDiarize = vi.fn();
    const { container } = show({ onDiarize });
    await transcriptShown(container, "rozpočet");

    // `Mluvčí` is written both on the header button and on the sidebar's own
    // section, so the query says which.
    fireEvent.click(
      [...container.querySelectorAll("button.button")].find(
        (b) => b.textContent === say("detail.header.speakersButton")
      )!
    );

    // The shell asks how many people speak and starts the run. This screen
    // must not have gone to the backend on its own.
    expect(onDiarize).toHaveBeenCalledWith(RECORDING_ID);
  });

  test("transcription goes through the shell, and a declined one leaves no bubble", async () => {
    // `onTranscribe` answering false is the shell saying the question was
    // declined — an existing transcript would be thrown away, and the person
    // said no. The screen used to believe a run had begun anyway: a bubble
    // frozen at zero, no player, and a cancel the backend answered with
    // "nothing is running".
    const onTranscribe = vi.fn().mockResolvedValue(false);
    const { container } = show({ onTranscribe });
    await transcriptShown(container, "rozpočet");

    fireEvent.click(screen.getByLabelText(enDialogs["dialogs.recordingMenu.more"]!));
    fireEvent.click(await screen.findByText(enDialogs["dialogs.recordingMenu.retranscribe"]!));

    await waitFor(() => expect(onTranscribe).toHaveBeenCalledWith(RECORDING_ID));
    // Through the shell and only the shell.
    expect(api.cancelTranscription).not.toHaveBeenCalled();

    // And nothing on the screen says a run is going.
    await waitFor(() =>
      expect(screen.queryByLabelText(say("detail.progress.cancelTranscription"))).toBeNull()
    );
  });
});
