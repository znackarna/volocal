// @vitest-environment jsdom
/**
 * The transcript screen draws the notice bar it is given.
 *
 * Reported on 2026-09-02, twice in one evening and about opposite things:
 * first the bar appeared above this screen's own header and read as pinned to
 * the window, then — the moment it moved down here — a clip was saved and no
 * confirmation appeared at all.
 *
 * The bar is now handed down as a prop and drawn under this screen's header,
 * which is the kind of wiring that type-checks whether or not anything renders
 * it. Hence this: the screen is mounted with a notice in hand and the words
 * have to be on it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { installBrowserStubs, setDetail } from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { resetScreen, show, transcriptShown } from "./screen.harness";
import type { Notices } from "../app/useNotices";

const holding = (text: string, kind: "info" | "error"): Notices => ({
  state: { notice: { text, kind }, closing: false },
  actions: { error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
});

describe("the notice bar on the transcript screen", () => {
  beforeEach(() => {
    resetScreen();
    setDetail();
  });
  afterEach(cleanup);

  /** What a saved clip says. Nothing else on this screen reports it. */
  test("shows a confirmation it is holding", async () => {
    const { container } = show({ notices: holding("Uloženo do D:/ven/citace.srt.", "info") });
    await transcriptShown(container);
    expect(screen.getByText("Uloženo do D:/ven/citace.srt.")).toBeTruthy();
  });

  test("shows a failure the same way", async () => {
    const { container } = show({ notices: holding("Zápis selhal.", "error") });
    await transcriptShown(container);
    expect(screen.getByText("Zápis selhal.")).toBeTruthy();
    expect(container.querySelector(".notice.error")).toBeTruthy();
  });

  /** And nothing when there is nothing to say, which is nearly always. */
  test("draws nothing when it holds nothing", async () => {
    const { container } = show();
    await transcriptShown(container);
    expect(container.querySelector(".notice")).toBeNull();
  });
});
