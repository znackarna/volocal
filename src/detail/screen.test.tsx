// @vitest-environment jsdom
/**
 * The transcript screen, rendered whole.
 *
 * `Detail.tsx` is the largest screen in the application — 3 507 lines and 53
 * pieces of state — and until now nothing rendered it. Every fault of its
 * shape that has actually reached the owner was found by eye: the `Výkon` card
 * flashing a refusal, the folder button missing from an empty archive. Both
 * were two correct halves wired apart, and a test of either half alone passes.
 *
 * `docs/cleanup-plan-2026-08-28.md` point C named three places here where a
 * selector and the data it selects from are set independently. Read against
 * the screen on 31 August, all three draw correctly today — so what these
 * tests pin is the behaviour that is right, and they are the thing that will
 * notice when a later change makes one of them wrong.
 *
 * The setup they were written with now lives in `fixtures.ts` and
 * `harness.tsx`, so that the tests written to protect the splitting of this
 * screen share it rather than copying it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { RECORDING_ID, aiEditStatus, installBrowserStubs, listeners, summaryFor } from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { finishAiRun, notes, resetScreen, say, show, transcriptShown } from "./screen.harness";

beforeEach(resetScreen);
afterEach(cleanup);

describe("the transcript screen", () => {
  test("renders whole, with the transcript in it", async () => {
    // Nothing here asserts a layout. What is being pinned is that the largest
    // screen in the application mounts at all — 53 pieces of state, thirty-six
    // backend calls — which is the thing no test did before.
    const { container } = show();
    await transcriptShown(container);
  });

  test("a summary length with nothing behind it offers to make one, rather than showing a blank", async () => {
    const { container } = show();
    await transcriptShown(container);

    // A summary exists for `standard`, which is where the screen starts.
    await finishAiRun([summaryFor("standard")]);

    fireEvent.click(await screen.findByText(say("detail.preview.summaryTab")));
    expect(await screen.findByText("Souhrn (standard).")).toBeTruthy();

    // `Stručný` has no summary. The selector moves and the data does not
    // follow it — the exact pair the plan named. The screen must say so and
    // offer the step that comes first, not hand back an empty panel.
    fireEvent.click(screen.getByText(say("detail.summaryLength.short")));

    expect(await screen.findByText(say("detail.summary.createShortTitle"))).toBeTruthy();
    expect(screen.getByText(say("detail.summary.create"))).toBeTruthy();
    expect(screen.queryByText("Souhrn (standard).")).toBeNull();
  });

  test("choosing the length that does have a summary brings it back", async () => {
    const { container } = show();
    await transcriptShown(container);
    await finishAiRun([summaryFor("detailed")]);

    fireEvent.click(await screen.findByText(say("detail.preview.summaryTab")));
    // Starts on `standard`, which has nothing.
    expect(await screen.findByText(say("detail.summary.createStandardTitle"))).toBeTruthy();

    fireEvent.click(screen.getByText(say("detail.summaryLength.detailed")));
    expect(await screen.findByText("Souhrn (detailed).")).toBeTruthy();
  });

  test("a finished run stops the screen saying it is running", async () => {
    const { container } = show();
    await transcriptShown(container);

    // The backend has to agree that it is running. Saying so is not padding:
    // once the screen believes a run is going it polls the real status every
    // second and takes its answer, so a bubble raised against a backend that
    // says otherwise is taken back down within the same tick. That loop is
    // what keeps a run and its result tied together, and it is the reason the
    // pair the plan worried about cannot drift for long.
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
    // The bubble's only wording is on the button that stops the run.
    expect(screen.getByLabelText(say("detail.progress.cancelAi"))).toBeTruthy();

    await finishAiRun([]);
    await waitFor(() =>
      expect(screen.queryByLabelText(say("detail.progress.cancelAi"))).toBeNull()
    );
  });

  test("a note begun and then abandoned leaves no draft behind", async () => {
    const { container } = show();
    await transcriptShown(container);

    fireEvent.click(notes(container).getByText(say("detail.notes.add")));

    const field = await screen.findByPlaceholderText(say("detail.notes.placeholder"));
    fireEvent.change(field, { target: { value: "rozepsaná poznámka" } });
    expect((field as HTMLTextAreaElement).value).toBe("rozepsaná poznámka");

    // Escape gives the editor up. The flag saying a note is being written and
    // the text being written are separate pieces of state, and what must not
    // happen is one going without the other: an editor closed over a draft
    // still held, or reopened with somebody's abandoned sentence in it.
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(say("detail.notes.placeholder"))).toBeNull()
    );

    fireEvent.click(notes(container).getByText(say("detail.notes.add")));
    const again = await screen.findByPlaceholderText(say("detail.notes.placeholder"));
    expect((again as HTMLTextAreaElement).value).toBe("");
  });
});
