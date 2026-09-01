/**
 * The data and the doubles every test of the settings screen needs.
 *
 * The same shape as `detail/screen.fixtures.ts`, and separate from
 * `screen.harness.tsx` for the same reason: a `vi.mock` factory is hoisted
 * above the imports of the file it is written in, so it can reach this file,
 * which imports nothing of the application, but not the one that mounts the
 * screen.
 *
 * `compute.test.tsx` beside this predates it and drives `check_tools` through
 * a promise it settles by hand. That is a different question — a stale answer
 * to a fresh question — and it keeps its own setup.
 */
import { vi } from "vitest";
import type { DictionaryEntry, Settings, ToolCheck } from "../types";

/** Event handlers the screen registers, so a test can deliver one. */
export const listeners = new Map<string, (event: { payload: unknown }) => void>();

/** A machine with everything installed and nothing to complain about. A test
 *  that is about something missing says which. */
export function toolCheck(over: Partial<ToolCheck> = {}): ToolCheck {
  return {
    ffmpeg: "ffmpeg.exe",
    ffprobe: "ffprobe.exe",
    whisper_cli: "whisper-cli.exe",
    model_whisper: "large-v3.bin",
    model_whisper_id: "large-v3",
    model_vad: "vad.bin",
    embedding_model: "cam.onnx",
    editor_cli: "llama.exe",
    editor_server: "llama-server.exe",
    editor_model: "model.gguf",
    editor_model_id: "editor",
    portable: false,
    app_directory: "C:\\volocal",
    webview2_bundled: false,
    compute: "cpu",
    available_compute_backends: ["cpu"],
    nvidia_driver: false,
    vulkan_driver: false,
    memory_gb: 16,
    found_models: ["large-v3"],
    issues: [],
    issues_diarization: [],
    issues_editor: [],
    needed: [],
    ...over,
  } as ToolCheck;
}

export function settings(over: Partial<Settings> = {}): Settings {
  return {
    bin_directory: "",
    models_directory: "",
    watch_folder: "",
    watch_folder_enabled: false,
    watch_folder_auto: false,
    recording_folder: "",
    copy_imports: false,
    update_check_automatic: false,
    model: "large-v3",
    quality_choice: "accurate",
    compute: "cpu",
    editor_model: "editor",
    ...over,
  } as Settings;
}

export function dictionaryEntry(over: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return {
    id: "d1",
    find: "volokal",
    replace: "Volocal",
    ...over,
  } as DictionaryEntry;
}

/** What the screen will be given when it asks. A test sets these before
 *  mounting; `resetSettings` puts them back. */
let chosenSettings: Settings | null = null;
let chosenTools: ToolCheck | null = null;
let chosenDictionary: DictionaryEntry[] | null = null;

export function setSettings(value: Settings) {
  chosenSettings = value;
}
export function setTools(value: ToolCheck) {
  chosenTools = value;
}
export function setDictionary(value: DictionaryEntry[]) {
  chosenDictionary = value;
}

/** The bridge to Rust, as a double. Built once and exported so a test can
 *  reach the spies the screen is calling. */
export const api = {
  loadSettings: () => Promise.resolve(chosenSettings ?? settings()),
  checkTools: () => Promise.resolve(chosenTools ?? toolCheck()),
  dictionary: () => Promise.resolve(chosenDictionary ?? []),
  catalog: () => Promise.resolve([]),
  installedMegabytes: () => Promise.resolve(0),
  machineName: () => Promise.resolve("stroj"),
  backupStatus: () => Promise.resolve(null),
  backups: () => Promise.resolve([]),
  saveSettings: vi.fn(),
  addDictionaryEntry: vi.fn(),
  updateDictionaryEntry: vi.fn(),
  deleteDictionaryEntry: vi.fn(),
  createPortableCopy: vi.fn(),
  exportArchive: vi.fn(),
  importArchive: vi.fn(),
  restoreBackup: vi.fn(),
  download: vi.fn(),
  letTheInstallerOut: vi.fn(),
};

/** Call from inside `vi.mock("../api", ...)`. */
export function apiMock() {
  return { api };
}

/** Call from inside `vi.mock("@tauri-apps/api/event", ...)`. */
export function eventMock() {
  return {
    listen: (name: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(name, handler);
      return Promise.resolve(() => listeners.delete(name));
    },
  };
}

/** The state every test starts from: the plain machine, no dictionary, and no
 *  memory of what the last test asked the backend to do. The remembered tab
 *  goes too — it lives in `localStorage` and would otherwise leak from one
 *  test into the next. */
export function resetSettings() {
  listeners.clear();
  chosenSettings = null;
  chosenTools = null;
  chosenDictionary = null;
  localStorage.clear();
  for (const value of Object.values(api)) {
    if (typeof value === "function" && "mockReset" in value) {
      (value as { mockReset: () => void }).mockReset();
    }
  }
  api.saveSettings.mockResolvedValue(undefined);
}
