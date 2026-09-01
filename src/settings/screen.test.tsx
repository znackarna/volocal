// @vitest-environment jsdom
/**
 * The settings screen, rendered whole.
 *
 * Written before `SettingsScreen` is split along its own tabs. 2 929 lines and
 * 22 pieces of state, and until now the only thing that rendered it was
 * `compute.test.tsx`, which drives one card.
 *
 * The tabs are the natural seam and the split will follow them, so what is
 * pinned here is what has to survive that: which tab opens, what a tab
 * remembers, that changing a setting writes the whole object rather than a
 * fragment of it, and that the dictionary — the one tab with data and CRUD of
 * its own — behaves as it does.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { api, dictionaryEntry, resetSettings, setDictionary, setSettings, settings } from "./screen.fixtures";

vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());
vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.23") }));
vi.mock("../recorder", () => ({ useRecorder: () => ({ phase: "idle" }) }));

import { say, show, tabButton } from "./screen.harness";

beforeEach(resetSettings);
afterEach(cleanup);

const selectedTab = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim();

/** Waits for the screen to have loaded the settings it was given. */
async function loaded() {
  await waitFor(() => expect(selectedTab()).toBeTruthy());
}

describe("moving between the settings tabs", () => {
  test("opens on the transcription tab when nothing says otherwise", async () => {
    show();
    await loaded();

    expect(selectedTab()).toBe(say("settings.tab.transcription"));
  });

  test("a tab pressed becomes the one shown, and is remembered", async () => {
    const { container } = show();
    await loaded();

    fireEvent.click(tabButton(container, say("settings.tab.files")));

    await waitFor(() => expect(selectedTab()).toBe(say("settings.tab.files")));
    // Remembered for the next visit, because pressing a tab is a choice.
    expect(localStorage.getItem("settings-tab")).toBe("files");
  });

  test("being sent to a tab beats the remembered one, and is not written down", async () => {
    // Arriving from a notice is not the same as going there. The prop wins,
    // and what the reader last chose for themselves is left alone.
    localStorage.setItem("settings-tab", "files");
    show({ initialTab: "updates" });
    await loaded();

    expect(selectedTab()).toBe(say("settings.tab.updates"));
    expect(localStorage.getItem("settings-tab")).toBe("files");
  });

  test("a remembered tab this build no longer has opens the first one", async () => {
    // `application` was stored on every machine that opened Settings the day
    // before it was renamed. It must not open an empty panel.
    localStorage.setItem("settings-tab", "application");
    show();
    await loaded();

    expect(selectedTab()).toBe(say("settings.tab.transcription"));
  });

  test("the arrow keys walk the strip", async () => {
    const { container } = show();
    await loaded();

    fireEvent.keyDown(tabButton(container, say("settings.tab.transcription")), {
      key: "ArrowRight",
    });
    await waitFor(() => expect(selectedTab()).toBe(say("settings.tab.interface")));

    // End goes to the last tab on the strip, whichever it is — the strip's
    // order is set in `SETTINGS_TABS` and is not the order the type declares.
    const strip = [...container.querySelectorAll('[role="tab"]')];
    const last = strip[strip.length - 1].textContent?.trim();
    fireEvent.keyDown(tabButton(container, say("settings.tab.interface")), { key: "End" });
    await waitFor(() => expect(selectedTab()).toBe(last));

    fireEvent.keyDown(strip[strip.length - 1], { key: "Home" });
    await waitFor(() => expect(selectedTab()).toBe(strip[0].textContent?.trim()));
  });
});

describe("changing a setting", () => {
  test("a switch writes the whole settings object, not the one value", async () => {
    setSettings(settings({ diarization: false } as never));
    const { container } = show();
    await loaded();

    const toggle = container.querySelector(
      ".settings-card-speakers input[type=checkbox]"
    ) as HTMLInputElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    const written = api.saveSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(written.diarization).toBe(true);
    // The rest of the object rides along. A split that saved only the changed
    // field would drop everything the other tabs hold.
    expect(written.model).toBe("large-v3");
    expect(written.quality_choice).toBe("accurate");
  });

  test("and the switch shows the new state at once", async () => {
    setSettings(settings({ diarization: false } as never));
    const { container } = show();
    await loaded();

    const toggle = container.querySelector(
      ".settings-card-speakers input[type=checkbox]"
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(true));
  });
});

describe("the dictionary", () => {
  const findField = () => screen.getAllByLabelText(say("settings.dictionary.find"));

  async function openDictionary(container: HTMLElement) {
    fireEvent.click(tabButton(container, say("settings.tab.transcription")));
    await waitFor(() => expect(screen.getByText(say("settings.dictionary.title"))).toBeTruthy());
  }

  test("an entry the recording gets wrong is listed with its repair", async () => {
    setDictionary([dictionaryEntry()]);
    const { container } = show();
    await loaded();
    await openDictionary(container);

    await waitFor(() =>
      expect(findField().some((f) => (f as HTMLInputElement).value === "volokal")).toBe(true)
    );
  });

  test("a new entry is written when both halves are filled", async () => {
    api.addDictionaryEntry.mockResolvedValue(dictionaryEntry({ id: "d2", find: "vhisper", replace: "Whisper" }));
    const { container } = show();
    await loaded();
    await openDictionary(container);

    fireEvent.click(screen.getByText(say("settings.dictionary.add")));

    const find = await screen.findByPlaceholderText(say("settings.dictionary.findPlaceholder"));
    const replace = screen.getByPlaceholderText(say("settings.dictionary.replacePlaceholder"));

    fireEvent.change(find, { target: { value: "vhisper" } });
    fireEvent.change(replace, { target: { value: "Whisper" } });
    fireEvent.blur(replace);

    await waitFor(() =>
      expect(api.addDictionaryEntry).toHaveBeenCalledWith("vhisper", "Whisper")
    );
  });

  test("half an entry is not written at all", async () => {
    // An entry with nothing to find, or nothing to put in its place, corrects
    // nothing. The empty row simply goes away again.
    const { container } = show();
    await loaded();
    await openDictionary(container);

    fireEvent.click(screen.getByText(say("settings.dictionary.add")));

    const find = await screen.findByPlaceholderText(say("settings.dictionary.findPlaceholder"));
    fireEvent.change(find, { target: { value: "vhisper" } });
    fireEvent.blur(find);

    expect(api.addDictionaryEntry).not.toHaveBeenCalled();
  });

  test("an existing entry is written back when the field is left", async () => {
    setDictionary([dictionaryEntry()]);
    const { container } = show();
    await loaded();
    await openDictionary(container);

    const field = await waitFor(() => {
      const found = findField().find((f) => (f as HTMLInputElement).value === "volokal");
      if (!found) throw new Error("the entry is not on the screen yet");
      return found as HTMLInputElement;
    });

    fireEvent.change(field, { target: { value: "volokál" } });
    expect(api.updateDictionaryEntry).not.toHaveBeenCalled();

    fireEvent.blur(field);
    await waitFor(() =>
      expect(api.updateDictionaryEntry).toHaveBeenCalledWith("d1", "volokál", "Volocal")
    );
  });
});
