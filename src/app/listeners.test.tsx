// @vitest-environment jsdom
/**
 * The shell arms its seven backend listeners once.
 *
 * A regression test. The shell re-renders often — a progress event, a notice, a
 * folder opening — and while it handed `useTranscriptionRuntime` a fresh
 * `() => void loadRecordings()` on every render, the effect that registers the
 * listeners had that arrow among its dependencies. Every render therefore
 * unsubscribed all seven and re-subscribed them asynchronously, leaving a
 * window in which a backend event had nowhere to land.
 *
 * The second test is the other half: armed once is only right if the handler
 * still reaches the current callback.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  api,
  installBrowserStubs,
  listeners,
  recording,
  resetApp,
  setRecordings,
} from "./screen.fixtures";

/** Counts every registration, which the shared double does not. */
let armed = 0;
vi.mock("@tauri-apps/api/event", async () => {
  const { listeners: registry } = await import("./screen.fixtures");
  return {
    listen: (name: string, handler: (event: { payload: unknown }) => void) => {
      armed += 1;
      registry.set(name, handler);
      return Promise.resolve(() => registry.delete(name));
    },
  };
});
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());
vi.mock("@tauri-apps/api/webview", async () => (await import("./screen.fixtures")).webviewMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.23") }));

installBrowserStubs();

import { emit, show } from "./screen.harness";

beforeEach(() => {
  resetApp();
  armed = 0;
});
afterEach(cleanup);

describe("the shell's backend listeners", () => {
  test("are armed once, and stay armed through the renders that follow", async () => {
    setRecordings([recording({ status: "transcribing" })]);
    const { container } = show();
    await waitFor(() => expect(container.textContent).toContain("Porada"));
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0));

    const afterMount = armed;
    expect(afterMount).toBeGreaterThan(0);

    // Six renders of the shell, each from a different quarter: progress
    // arriving, a live segment, a failure raising the notice bar.
    for (let percent = 10; percent <= 60; percent += 10) {
      await emit("transcription:status", {
        recording_id: "r1",
        phase: "transcription",
        percent,
        description: { code: "progress.transcribing" },
      });
    }
    await emit("transcription:error", ["r1", { code: "errors.transcriptionFailed", values: {} }]);
    await waitFor(() => expect(document.querySelector(".notice")).not.toBeNull());

    expect(armed).toBe(afterMount);
  });

  test("and still reach the callback the shell holds now", async () => {
    // Armed at mount, called much later: the handler has to be reading the
    // current `loadRecordings`, not the one that existed on the first render.
    setRecordings([recording()]);
    const { container } = show();
    await waitFor(() => expect(container.textContent).toContain("Porada"));
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0));

    setRecordings([recording({ id: "r2", title: "Rozhovor" })]);
    await emit("transcription:complete", "r1");

    await waitFor(() => expect(container.textContent).toContain("Rozhovor"));
  });
});
