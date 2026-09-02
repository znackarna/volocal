/**
 * The data and the doubles every test of the application shell needs.
 *
 * `App.tsx` is 1 960 lines and 33 pieces of state, and nothing rendered it
 * before these. It is the hardest of the three to mount, because almost
 * everything it does arrives from outside the window: seven backend event
 * streams, the drag-and-drop channel of the webview itself, and the updater.
 * All of them are handed to a test here.
 *
 * Same two-file split as the other two screens, for the same reason: a
 * `vi.mock` factory is hoisted above the imports of the file it is written in,
 * so it can reach this file — which imports nothing of the application — but
 * not `screen.harness.tsx`, which mounts `App`.
 */
import { vi } from "vitest";
import type { Folder, Recording, ToolCheck } from "../types";

/** Every backend event handler the shell registers, so a test can deliver one.
 *  This is the shell's only door for progress: `transcription:status`,
 *  `transcription:segment`, `transcription:complete`, `ai-edit:progress`,
 *  `download:progress`, `download:complete`, `transcription:error`. */
export const listeners = new Map<string, (event: { payload: unknown }) => void>();

/** The webview's own drag-and-drop channel, which is not a backend event and
 *  arrives through `getCurrentWebview().onDragDropEvent`. A dropped file is
 *  the one way into this application that starts nowhere on the screen. */
export let dropHandler: ((event: { payload: unknown }) => void) | null = null;

export function setDropHandler(handler: ((event: { payload: unknown }) => void) | null) {
  dropHandler = handler;
}

export function recording(over: Partial<Recording> = {}): Recording {
  return {
    id: "r1",
    path: "C:\\nahravky\\porada.mp3",
    title: "Porada",
    duration: 120,
    created_at: "2026-08-31T09:00:00Z",
    status: "done",
    model: "large-v3",
    language: "cs",
    language_choice: "cs",
    error: null,
    segment_count: 4,
    folder: null,
    source_url: null,
    second_language_choice: "",
  second_language_by_reader: true,
    second_language: null,
  second_language_missing: null,
    ...over,
  };
}

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
    detect_second_language: false,
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

export function settings(over: Record<string, unknown> = {}) {
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
    // Off unless a test says otherwise, so that starting a transcription is a
    // direct call. Separating speakers is the only thing that asks first.
    diarization: false,
    ...over,
  } as never;
}

/** What the shell will be given when it asks. A test sets these before
 *  mounting; `resetApp` puts them back. */
let chosenRecordings: Recording[] | null = null;
let chosenFolders: Folder[] | null = null;
let chosenSettings: unknown = null;
let chosenTools: ToolCheck | null = null;

export function setRecordings(value: Recording[]) {
  chosenRecordings = value;
}
export function setFolders(value: Folder[]) {
  chosenFolders = value;
}
export function setSettings(value: unknown) {
  chosenSettings = value;
}
export function setTools(value: ToolCheck) {
  chosenTools = value;
}

/** Whether the recording the shell opens already has a transcript. A test that
 *  wants the empty state — the one carrying `Přepsat` — says so. */
let transcribed = true;

export function setTranscribed(value: boolean) {
  transcribed = value;
}

/** The bridge to Rust, as a double. Built once and exported so a test can
 *  reach the spies the shell is calling — which is the whole question for a
 *  screen whose job is deciding what to start and when to ask first. */
export const api = {
  listRecordings: () => Promise.resolve(chosenRecordings ?? []),
  folders: () => Promise.resolve(chosenFolders ?? []),
  loadSettings: () => Promise.resolve(chosenSettings ?? settings()),
  checkTools: () => Promise.resolve(chosenTools ?? toolCheck()),
  catalog: () => Promise.resolve([]),
  scanWatchFolder: vi.fn(),
  startTranscription: vi.fn(),
  transcribeInLanguage: vi.fn(),
  diarizeSpeakers: vi.fn(),
  cancelTranscription: vi.fn(),
  addRecording: vi.fn(),
  deleteRecording: vi.fn(),
  deleteTranscription: vi.fn(),
  renameRecording: vi.fn(),
  exportAudio: vi.fn(),
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  renameFolder: vi.fn(),
  moveToFolder: vi.fn(),
  importWatchFolderFiles: vi.fn(),
  ignoreWatchFolderFiles: vi.fn(),
  cancelComponent: vi.fn(),
  // Reached through the player and the recorder, which the shell mounts.
  playbackSource: () => Promise.resolve(null),
  recordingWaveform: () => Promise.resolve(null),
  beginTake: vi.fn(),
  appendTakeChunk: vi.fn(),
  discardTake: vi.fn(),
  noteCrash: vi.fn(),
  prevent: vi.fn(),
  /* Reached by the detail screen once the shell opens one. It answers about
     the recording the archive was given, not a fixed one — otherwise opening a
     recording that has not been transcribed would still show a transcript, and
     the empty state carrying `Přepsat` would be unreachable. */
  detail: () =>
    Promise.resolve({
      recording: chosenRecordings?.[0] ?? recording(),
      segments: transcribed
        ? [
            {
              id: "s1",
              recording_id: "r1",
              order: 0,
              start: 0,
              end: 4,
              text: "Dobrý den, začneme poradu.",
              speakers: null,
              confidence: 0.9,
              edited: false,
              verified: false,
              words: null,
              original: null,
            },
          ]
        : [],
      speakers: [],
      notes: [],
    }),
  exportPreview: () => Promise.resolve(""),
  dictionary: () => Promise.resolve([]),
  aiEditStatus: () =>
    Promise.resolve({ document: null, outputs: [], custom: [], running: false, progress: null }),
  fileExists: () => Promise.resolve(true),
  /* Asked by the transcript screen the moment it opens. Nothing found is the
     ordinary answer, and it is the only one these tests want: the shell's own
     behaviour has nothing to do with what language a recording is in. */
  secondLanguage: () => Promise.resolve(null),
  setSecondLanguageChoice: vi.fn(),
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

/** Call from inside `vi.mock("@tauri-apps/api/webview", ...)`. */
export function webviewMock() {
  return {
    getCurrentWebview: () => ({
      onDragDropEvent: (handler: (event: { payload: unknown }) => void) => {
        setDropHandler(handler);
        return Promise.resolve(() => setDropHandler(null));
      },
    }),
  };
}

/** jsdom does no layout, and the shell mounts the player and the recorder. */
export function installBrowserStubs() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= function () {};
}

/** The state every test starts from. `localStorage` is cleared with the rest:
 *  the shell remembers the theme, the panel and the tab there, and one test's
 *  choice would otherwise open the next one somewhere else. */
export function resetApp() {
  listeners.clear();
  setDropHandler(null);
  chosenRecordings = null;
  chosenFolders = null;
  chosenSettings = null;
  chosenTools = null;
  transcribed = true;
  localStorage.clear();
  for (const value of Object.values(api)) {
    if (typeof value === "function" && "mockReset" in value) {
      (value as { mockReset: () => void }).mockReset();
    }
  }
  api.scanWatchFolder.mockResolvedValue([]);
}
