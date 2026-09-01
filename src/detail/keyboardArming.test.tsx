// @vitest-environment jsdom
/**
 * The window's keydown listener is armed once and stays armed.
 *
 * The transcript screen re-renders constantly — the clock ticks eight times a
 * second while audio plays — and its keyboard effect lists the search and the
 * step-to-the-next-uncertain-place callback among its dependencies. Twice
 * during this refactoring one of those became a new value on every render, and
 * the effect then tore the listener down and put it back on each of them:
 * first because the search returned a fresh object, then because the step
 * depended on the clock directly.
 *
 * Counting the arming is the observable half of that. The renders here are
 * driven by ordinary presses rather than by the clock, because how many times
 * the screen renders while its promises settle is not something a test can pin
 * down — so everything is flushed first and counted from there.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { conversation, installBrowserStubs, setDetail } from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { resetScreen, show, transcriptShown } from "./screen.harness";

beforeEach(() => {
  resetScreen();
  setDetail(conversation());
});
afterEach(cleanup);

describe("the transcript screen's keyboard", () => {
  test("is armed once, and renders that are not about it do not re-arm it", async () => {
    let armed = 0;
    const realAdd = window.addEventListener.bind(window) as (
      ...args: unknown[]
    ) => void;
    const spy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation(((...args: unknown[]) => {
        if (args[0] === "keydown") armed += 1;
        return realAdd(...args);
      }) as never);

    try {
      const { container } = show();
      await transcriptShown(container, "rozpočet");
      // Everything the screen fetches on arrival has settled by now.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const settled = armed;
      expect(settled).toBeGreaterThan(0);

      // Six renders from folding a sidebar section open and shut, which has
      // nothing to do with the keyboard.
      const heading = container.querySelector(".sidebar-section button") as HTMLElement;
      for (let i = 0; i < 6; i += 1) {
        await act(async () => {
          fireEvent.click(heading);
        });
      }
      expect(armed).toBe(settled);

      // And six renders from the cursor moving, which is what playback does
      // eight times a second. Dragging the slider moves it without starting
      // audio, so this is the same render with none of the machinery.
      const slider = container.querySelector("input.slider") as HTMLInputElement;
      expect(slider).toBeTruthy();
      for (let at = 5; at <= 30; at += 5) {
        await act(async () => {
          fireEvent.change(slider, { target: { value: String(at) } });
        });
      }

      expect(armed).toBe(settled);
    } finally {
      spy.mockRestore();
    }
  });
});
