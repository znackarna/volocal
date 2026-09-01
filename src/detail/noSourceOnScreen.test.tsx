// @vitest-environment jsdom
/**
 * The transcript screen shows no source code either.
 *
 * The companion of `settings/noSourceOnScreen.test.tsx`, and here because this
 * screen had the most markup moved out of it. The fault it guards against —
 * a doubly guarded block losing only its outer brace and rendering its own
 * condition as text — compiles and type-checks, so nothing else would catch it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  RECORDING_ID,
  aiEditStatus,
  conversationWithSpeakers,
  customDocument,
  installBrowserStubs,
  listeners,
  note,
  setDetail,
} from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { finishAiRun, resetScreen, say, show, transcriptShown } from "./screen.harness";

/** Shapes that belong in a source file and never in a sentence. */
const CODE = ["&&", "?.", "=>", "className", "undefined", "[object Object]"];

const clean = (text: string) => {
  for (const shape of CODE) expect(text).not.toContain(shape);
};

beforeEach(() => {
  resetScreen();
  setDetail({ ...conversationWithSpeakers(), notes: [note()] });
});
afterEach(cleanup);

describe("the transcript screen", () => {
  test("shows no source code, with a transcript and a full sidebar", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await waitFor(() =>
      expect(container.querySelectorAll(".speaker-list li").length).toBe(2)
    );

    clean(container.textContent ?? "");
  });

  test("nor with the find bar up", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    fireEvent.click(screen.getByLabelText(say("detail.find.open")));
    const field = await screen.findByPlaceholderText(say("detail.find.placeholder"));
    fireEvent.change(field, { target: { value: "porad" } });

    clean(container.textContent ?? "");
  });

  test("nor in the reading window", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await finishAiRun([]);
    await screen.findByText("Upravený přepis.");

    // Every tab of it, including the three with nothing behind them.
    for (const tab of [
      "detail.preview.summaryTab",
      "detail.preview.translationTab",
      "detail.preview.customTab",
      "detail.preview.transcriptTab",
    ] as const) {
      fireEvent.click(screen.getByText(say(tab)));
      await waitFor(() => expect(document.querySelector(".ai-document-tabs")).not.toBeNull());
      clean(document.querySelector(".ai-preview-dialog")?.textContent ?? "");
    }
  });

  test("nor in the window reached without an enhanced transcript", async () => {
    aiEditStatus.mockResolvedValue({
      document: null,
      outputs: [],
      custom: [customDocument()],
      running: false,
      progress: null,
    });
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    /* The application's own way in, delivered directly: `finishAiRun` answers
       with an enhanced transcript, which is the one thing this test must not
       have. */
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

    fireEvent.click(screen.getByText(say("detail.preview.transcriptTab")));
    await screen.findByText(say("detail.preview.emptyTitle"));

    clean(document.querySelector(".ai-preview-dialog")?.textContent ?? "");
  });
});
