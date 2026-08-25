// @vitest-environment jsdom
/**
 * The `Výkon` card as it is actually driven, over the report of 25 August:
 * pressing either card flashed a red refusal that took itself back a fraction
 * of a second later.
 *
 * `compute.test.ts` pins the rule. This pins the wiring, which is where the
 * fault was: the rule was never wrong about the values it was given, it was
 * given a fresh question and a stale answer. So `check_tools` is held open here
 * and the card is read while it is still in flight — the exact moment nobody
 * can catch by hand.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { enSettings } from "../locales/en/settings";
import type { Settings, ToolCheck } from "../types";

const checkTools = vi.fn();
const loadSettings = vi.fn();
const saveSettings = vi.fn();

vi.mock("../api", () => ({
  api: {
    checkTools: () => checkTools(),
    loadSettings: () => loadSettings(),
    saveSettings: (s: unknown) => saveSettings(s),
    catalog: () => Promise.resolve([]),
    installedMegabytes: () => Promise.resolve(0),
    machineName: () => Promise.resolve("stroj"),
    dictionary: () => Promise.resolve([]),
    backupStatus: () => Promise.resolve(null),
    backups: () => Promise.resolve([]),
    letTheInstallerOut: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.2.20") }));
vi.mock("../recorder", () => ({ useRecorder: () => ({ phase: "idle" }) }));

import SettingsScreen from "../Settings";

const say = (key: keyof typeof enSettings) => enSettings[key]!;

/** A machine with an NVIDIA card, running whatever it is told to run. */
function machine(compute: string): ToolCheck {
  return {
    ffmpeg: "ffmpeg.exe",
    ffprobe: "ffprobe.exe",
    whisper_cli: "whisper-cli.exe",
    model_whisper: "large.bin",
    model_whisper_id: "large-v3",
    model_vad: "vad.bin",
    embedding_model: null,
    editor_cli: null,
    editor_server: null,
    editor_model: null,
    editor_model_id: null,
    portable: false,
    app_directory: "C:\\app",
    webview2_bundled: false,
    compute,
    available_compute_backends: ["cpu", "cuda"],
    nvidia_driver: true,
    vulkan_driver: false,
    memory_gb: 16,
    found_models: ["large-v3"],
    issues: [],
    issues_diarization: [],
    issues_editor: [],
    needed: [],
  } as ToolCheck;
}

function settings(compute: string): Settings {
  return { model: "large-v3", quality_choice: "accurate", compute } as Settings;
}

/** A promise this test decides when to settle, standing in for the round trip
 *  `check_tools` takes. The window it holds open is the whole bug. */
function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function show() {
  return render(
    <I18nProvider>
      <SettingsScreen
        onComplete={() => {}}
        onError={() => {}}
        onInfo={() => {}}
        onToModule={() => {}}
        initialTab="performance"
        foundUpdate={null}
        fetching={false}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSettings.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("switching where the transcript computes", () => {
  /** The reported fault. Running on the graphics card, nothing picked; press
   *  `Procesor` and read the card before `check_tools` has answered for it.
   *  Before the pairing, the refusal was on screen for this whole window. */
  test("says nothing while the check still answers the previous pick", async () => {
    loadSettings.mockResolvedValue(settings("auto"));
    checkTools.mockResolvedValueOnce(machine("cuda"));

    show();
    const processor = await screen.findByText(say("settings.compute.modeCpu"));

    // The answer to the new question is held; only the old one is on hand.
    const answer = held<ToolCheck>();
    checkTools.mockReturnValueOnce(answer.promise);
    fireEvent.click(processor);

    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(screen.queryByText(say("settings.compute.processorRefused"))).toBeNull();
    expect(document.querySelector(".choice.missing")).toBeNull();

    // And it stays silent once the answer arrives and agrees.
    answer.release(machine("cpu"));
    await waitFor(() =>
      expect(document.querySelector('button.choice[aria-pressed="true"]')?.textContent).toContain(
        say("settings.compute.modeCpu")
      )
    );
    expect(screen.queryByText(say("settings.compute.processorRefused"))).toBeNull();
  });

  /** The other direction, which flashed the other sentence. */
  test("says nothing the other way round either", async () => {
    loadSettings.mockResolvedValue(settings("cpu"));
    checkTools.mockResolvedValueOnce(machine("cpu"));

    show();
    const card = await screen.findByText(say("settings.compute.modeGpu"));

    const answer = held<ToolCheck>();
    checkTools.mockReturnValueOnce(answer.promise);
    fireEvent.click(card);

    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(screen.queryByText(say("settings.compute.graphicsCardRefused"))).toBeNull();
    expect(document.querySelector(".choice.missing")).toBeNull();

    answer.release(machine("cuda"));
    await waitFor(() =>
      expect(document.querySelector('button.choice[aria-pressed="true"]')?.textContent).toContain(
        say("settings.compute.modeGpu")
      )
    );
    expect(screen.queryByText(say("settings.compute.graphicsCardRefused"))).toBeNull();
  });

  /** And the card has not been silenced, only made to wait: a pick the machine
   *  really cannot honour is still said out loud, once the answer belongs to
   *  the question. */
  test("speaks when the answer to this pick contradicts it", async () => {
    loadSettings.mockResolvedValue(settings("auto"));
    checkTools.mockResolvedValueOnce(machine("cuda"));

    show();
    const processor = await screen.findByText(say("settings.compute.modeCpu"));

    // The machine goes on running on the graphics card whatever it is told.
    checkTools.mockResolvedValueOnce(machine("cuda"));
    fireEvent.click(processor);

    await screen.findByText(say("settings.compute.processorRefused"));
    expect(document.querySelector(".choice.missing")).not.toBeNull();
  });
});
