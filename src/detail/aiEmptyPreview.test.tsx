// @vitest-environment jsdom
/**
 * The reading window reached without an enhanced transcript.
 *
 * A saved document made from the reader's own instruction is enough to open the
 * window, and then its first three tabs have nothing behind them — which is the
 * arrangement the empty states were written for. The one on the transcript tab
 * carries the only button there is, and the split left it setting a mode
 * without opening anything: the press did nothing at all.
 *
 * This is that path, end to end.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  RECORDING_ID,
  aiEditStatus,
  conversation,
  customDocument,
  installBrowserStubs,
  listeners,
  setDetail,
} from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { resetScreen, say, show, transcriptShown } from "./screen.harness";

beforeEach(() => {
  resetScreen();
  setDetail(conversation());
  // Something made from an instruction, and no enhanced transcript.
  aiEditStatus.mockResolvedValue({
    document: null,
    outputs: [],
    custom: [customDocument()],
    running: false,
    progress: null,
  });
});
afterEach(cleanup);

const aiButton = (container: HTMLElement) =>
  container.querySelector(".ai-edit-button") as HTMLButtonElement;
const choiceDialog = () => document.querySelector("#ai-configure-title");

/** The application's own way into the window on this path: a run finishes and
 *  the screen fetches what is stored. */
async function openTheWindow() {
  await act(async () => {
    listeners.get("ai-edit:progress")?.({
      payload: {
        recording_id: RECORDING_ID,
        phase: "complete",
        percent: 100,
        description: { code: "ai.done" },
      },
    });
  });
  await screen.findByText(say("detail.preview.customTab"));
}

describe("the reading window with nothing enhanced behind it", () => {
  test("opens on a saved custom document, and the transcript tab is empty", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await openTheWindow();

    fireEvent.click(screen.getByText(say("detail.preview.transcriptTab")));
    expect(await screen.findByText(say("detail.preview.emptyTitle"))).toBeTruthy();
  });

  test("and its one button opens the choice, on the faithful mode", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await openTheWindow();

    fireEvent.click(screen.getByText(say("detail.preview.transcriptTab")));
    await screen.findByText(say("detail.preview.emptyTitle"));

    // The only thing to do from here.
    fireEvent.click(screen.getByText(say("detail.ai.startEdit")));

    await waitFor(() => expect(choiceDialog()).not.toBeNull());
    const chosen = document.querySelector(".ai-edit-modes .choice.chosen");
    expect(chosen?.textContent).toContain(say("detail.ai.modeFaithful"));
  });

  test("the button reaches the backend once the choice is answered", async () => {
    const { api } = await import("./screen.fixtures");
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await openTheWindow();

    fireEvent.click(screen.getByText(say("detail.preview.transcriptTab")));
    await screen.findByText(say("detail.preview.emptyTitle"));
    fireEvent.click(screen.getByText(say("detail.ai.startEdit")));
    await waitFor(() => expect(choiceDialog()).not.toBeNull());

    const dialog = choiceDialog()!.closest(".dialog") as HTMLElement;
    fireEvent.click(
      [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent === say("detail.ai.startEdit")
      )!
    );

    await waitFor(() => expect(api.startAiEdit).toHaveBeenCalledWith(RECORDING_ID, "faithful"));
  });
});
