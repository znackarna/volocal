// @vitest-environment jsdom
/**
 * The language-editing button, and the window it opens.
 *
 * The largest and most tangled area of this screen, and the last one the split
 * reaches. What is pinned here is not the machinery but two decisions that
 * were reached after the fact and that a move could quietly undo.
 *
 * **The offer is fixed.** With no enhanced transcript, pressing the button
 * goes to the choice — every time, whatever else happens to be saved beside
 * the recording. It once depended on that: enhance a transcript, delete the
 * result, press the button, and the press landed in the reading window, whose
 * first three tabs are made *from* the transcript that had just been deleted.
 *
 * **A window showing one pill reads as broken.** All four tabs are drawn
 * whether or not there is anything behind them; a tab with nothing behind it
 * says so and offers the step that comes first.
 *
 * `screen.test.tsx` covers the summary lengths, which are the same rule one
 * level down. Nothing here repeats them.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  RECORDING_ID,
  aiEditStatus,
  conversation,
  installBrowserStubs,
  listeners,
  setDetail,
} from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { finishAiRun, resetScreen, say, show, transcriptShown } from "./screen.harness";

beforeEach(() => {
  resetScreen();
  setDetail(conversation());
});
afterEach(cleanup);

const aiButton = (container: HTMLElement) =>
  container.querySelector(".ai-edit-button") as HTMLButtonElement;

const tabs = () => document.querySelector(".ai-document-tabs") as HTMLElement;

/** The choice dialog, asked for by its own heading rather than by its wording:
 *  `AI nástroje` is written both on the button and on the dialog it opens. */
const choiceDialog = () => document.querySelector("#ai-configure-title");

describe("the language-editing button", () => {
  test("with nothing enhanced yet, it opens the choice", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    fireEvent.click(aiButton(container));

    await waitFor(() => expect(choiceDialog()).toBeTruthy());
    expect(choiceDialog()?.textContent).toBe(say("detail.ai.configureTitle"));
  });

  test("with an enhanced transcript, it opens the reading window on it", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    // The application's own way in: the model reports it has finished, the
    // screen fetches the result and opens the window over it.
    await finishAiRun([]);
    expect(await screen.findByText("Upravený přepis.")).toBeTruthy();

    // Closing it and pressing the button again comes back to the same place,
    // rather than offering to make what already exists.
    fireEvent.click(screen.getByLabelText(say("detail.preview.closeLabel")));
    await waitFor(() => expect(screen.queryByText("Upravený přepis.")).toBeNull());

    fireEvent.click(aiButton(container));
    expect(await screen.findByText("Upravený přepis.")).toBeTruthy();
    expect(choiceDialog()).toBeNull();
  });

  test("it is dead while a run is going", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    aiEditStatus.mockResolvedValue({
      document: null,
      outputs: [],
      custom: [],
      running: true,
      progress: null,
    });
    await act(async () => {
      listeners.get("ai-edit:progress")?.({
        payload: {
          recording_id: RECORDING_ID,
          phase: "editing",
          percent: 40,
          description: { code: "ai.editing" },
        },
      });
    });

    expect(aiButton(container).disabled).toBe(true);
  });
});

describe("the reading window", () => {
  test("draws all four tabs, even with only the transcript behind them", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await finishAiRun([]);

    // One pill reads as broken. Four pills, three of them empty, read as a
    // window with work still to do in it.
    const names = [...tabs().querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(names).toEqual([
      say("detail.preview.transcriptTab"),
      say("detail.preview.summaryTab"),
      say("detail.preview.translationTab"),
      say("detail.preview.customTab"),
    ]);
  });

  test("a tab with nothing behind it offers the step that comes first", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await finishAiRun([]);

    fireEvent.click(await screen.findByText(say("detail.preview.translationTab")));

    // Not a blank panel: the subject, and the button that makes it.
    expect(await screen.findByText(say("detail.translation.emptyTitle"))).toBeTruthy();
    expect(screen.getByText(say("detail.translation.create"))).toBeTruthy();
  });

  test("the transcript tab offers both versions, and the original is the transcript itself", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await finishAiRun([]);

    expect(await screen.findByText("Upravený přepis.")).toBeTruthy();

    fireEvent.click(screen.getByText(say("detail.preview.versionOriginal")));

    // What the machine wrote, not what the model made of it. Asked of the
    // window's own text, which must exist — a fallback to the document would
    // pass on the transcript showing behind it.
    await waitFor(() => {
      const body = document.querySelector(".ai-preview-text");
      expect(body).toBeTruthy();
      expect(body?.textContent).toContain("rozpočet");
      expect(body?.textContent).not.toContain("Upravený přepis.");
    });

    fireEvent.click(screen.getByText(say("detail.preview.versionImproved")));
    expect(await screen.findByText("Upravený přepis.")).toBeTruthy();
  });

  test("the window closes and leaves the screen as it was", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await finishAiRun([]);

    fireEvent.click(await screen.findByLabelText(say("detail.preview.closeLabel")));

    await waitFor(() => expect(document.querySelector(".ai-document-tabs")).toBeNull());
    // The transcript is still there behind it.
    expect(container.textContent).toContain("rozpočet");
  });
});
