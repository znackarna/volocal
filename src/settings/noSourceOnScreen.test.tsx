// @vitest-environment jsdom
/**
 * No tab shows its own source code.
 *
 * A guard against one specific way of getting this wrong, and it got in twice.
 * Splitting the screen into panels was done by moving blocks of markup, and a
 * block guarded twice —

 *     {activeTab === "files" && check?.portable && ( … )}
 *
 * — loses only its outer guard when the tab test is stripped, which leaves
 * `check?.portable && (` standing in the markup as *text*. React renders it.
 * TypeScript is happy: text is a perfectly good child.
 *
 * The reader saw `check?.portable && (` on the `Soubory` tab. This walks every
 * tab and refuses anything that reads like code.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { resetSettings, setTools, toolCheck } from "./screen.fixtures";

vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());
vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.23") }));
vi.mock("../recorder", () => ({ useRecorder: () => ({ phase: "idle" }) }));

import { say, show, tabButton } from "./screen.harness";

/** Shapes that belong in a source file and never in a sentence. */
const CODE = [
  "&&",
  "?.",
  "=>",
  "activeTab",
  "className",
  "undefined",
  "[object Object]",
];

const TABS = [
  "settings.tab.transcription",
  "settings.tab.interface",
  "settings.tab.performance",
  "settings.tab.tools",
  "settings.tab.files",
  "settings.tab.updates",
  "settings.tab.about",
] as const;

beforeEach(resetSettings);
afterEach(cleanup);

describe("every settings tab", () => {
  test.each(TABS)("shows no source code on %s", async (key) => {
    const { container } = show();
    await waitFor(() =>
      expect(document.querySelector('[role="tab"][aria-selected="true"]')).not.toBeNull()
    );

    fireEvent.click(tabButton(container, say(key)));
    await waitFor(() =>
      expect(
        document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()
      ).toBe(say(key))
    );

    const shown = container.querySelector(".settings-panels")?.textContent ?? "";
    for (const shape of CODE) expect(shown).not.toContain(shape);
  });

  test("including the portable machine, which draws two cards of its own", async () => {
    // The two blocks that lost their braces were both guarded on this.
    setTools(toolCheck({ portable: true }));
    const { container } = show();
    await waitFor(() =>
      expect(document.querySelector('[role="tab"][aria-selected="true"]')).not.toBeNull()
    );

    fireEvent.click(tabButton(container, say("settings.tab.files")));
    await waitFor(() =>
      expect(container.textContent).toContain(say("settings.portable.title"))
    );

    const shown = container.querySelector(".settings-panels")?.textContent ?? "";
    for (const shape of CODE) expect(shown).not.toContain(shape);
  });
});
