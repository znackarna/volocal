/**
 * The data and the doubles every test of the transcript screen needs.
 *
 * Not a test file, and deliberately not one: `vi.mock` factories are hoisted
 * above the imports of the file they are written in, so anything a factory
 * reaches for has to live somewhere it can be pulled in on its own. This is
 * that somewhere. It knows nothing about React and never imports `Detail` —
 * see `harness.tsx`, which does, and which a factory must therefore not touch.
 *
 * Written while splitting `Detail.tsx` apart, so that a test pinning today's
 * behaviour can be written once and keep passing while the state underneath it
 * moves into hooks of its own.
 */
import { vi } from "vitest";
import type { AiDocument, AiOutput, Detail as DetailData, Recording, Segment, ToolCheck } from "../types";

export const RECORDING_ID = "r1";

/** Event handlers the screen registers, so a test can deliver one. The
 *  application's own progress arrives this way and the screen has no other
 *  door: the preview opens on `complete` and on nothing else. */
export const listeners = new Map<string, (event: { payload: unknown }) => void>();

/** Polled every second while the screen believes a run is going, so a test
 *  that raises a run has to answer it. Held here rather than inside the API
 *  double because tests reach for it directly. */
export const aiEditStatus = vi.fn();

export function recording(over: Partial<Recording> = {}): Recording {
  return {
    id: RECORDING_ID,
    path: "C:\\nahravky\\porada.mp3",
    title: "Porada",
    duration: 120,
    created_at: "2026-08-31T09:00:00Z",
    status: "done",
    model: "large-v3",
    language: "cs",
    language_choice: "cs",
    error: null,
    segment_count: 1,
    folder: null,
    source_url: null,
    ...over,
  };
}

export function segment(over: Partial<Segment> = {}): Segment {
  return {
    id: "s1",
    recording_id: RECORDING_ID,
    order: 0,
    start: 0,
    end: 4,
    text: "Dobrý den, začneme.",
    speakers: null,
    confidence: 0.9,
    edited: false,
    verified: false,
    words: null,
    original: null,
    ...over,
  };
}

export function detailData(over: Partial<DetailData> = {}): DetailData {
  return { recording: recording(), segments: [segment()], speakers: [], notes: [], ...over };
}

/** Everything installed, so nothing on this screen is refused for a missing
 *  tool — these tests are about what the screen draws once it can draw. */
export function toolCheck(): ToolCheck {
  return {
    ffmpeg: "ffmpeg.exe",
    ffprobe: "ffprobe.exe",
    whisper_cli: "whisper.exe",
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
    // Empty on all three: nothing this screen offers is refused for a missing
    // tool, which is the state these tests need to reach the documents at all.
    issues: [],
    issues_diarization: [],
    issues_editor: [],
    needed: [],
  } as ToolCheck;
}

export function settings() {
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
    // Language editing is configured, or the documents this screen is being
    // asked about would never be offered.
    editor_model: "editor",
  } as never;
}

export function aiDocument(): AiDocument {
  return {
    recording_id: RECORDING_ID,
    source_hash: "h1",
    model: "editor",
    mode: "faithful",
    text: "Upravený přepis.",
    updated_at: "2026-08-31T09:05:00Z",
    stale: false,
  };
}

/** A summary that exists for exactly one length. The other two are the case
 *  the plan was worried about: a selector pointing at data that is not there. */
export function summaryFor(variant: string): AiOutput {
  return {
    recording_id: RECORDING_ID,
    kind: "summary",
    variant,
    source_hash: "h1",
    model: "editor",
    text: `Souhrn (${variant}).`,
    updated_at: "2026-08-31T09:06:00Z",
  };
}

/** The event module, as a double that keeps every handler the screen registers
 *  in `listeners`. Call from inside `vi.mock("@tauri-apps/api/event", ...)`. */
export function eventMock() {
  return {
    listen: (name: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(name, handler);
      return Promise.resolve(() => listeners.delete(name));
    },
  };
}

/** The bridge to Rust, as a double. Every call the screen can make is here:
 *  the reads answer with the fixtures above, and everything that writes is a
 *  spy, so a test can ask what the screen asked the backend to do.
 *
 *  `detail` is a function so that a test can hand in a different recording —
 *  a transcript still running, a source file that has moved — without a second
 *  copy of the whole double. */
export function apiMock(over: Record<string, unknown> = {}) {
  return {
    api: {
      detail: () => Promise.resolve(detailData()),
      checkTools: () => Promise.resolve(toolCheck()),
      loadSettings: () => Promise.resolve(settings()),
      saveSettings: vi.fn(),
      dictionary: () => Promise.resolve([]),
      catalog: () => Promise.resolve([]),
      aiEditStatus: (id: string) => aiEditStatus(id),
      fileExists: () => Promise.resolve(true),
      exportPreview: () => Promise.resolve(""),
      startAiEdit: vi.fn(),
      startAiOutput: vi.fn(),
      cancelAiEdit: vi.fn(),
      deleteAiDocument: vi.fn(),
      saveAiDocument: vi.fn(),
      saveAiOutput: vi.fn(),
      suggestedName: vi.fn(),
      suggestedAiName: vi.fn(),
      suggestedAiOutputName: vi.fn(),
      saveExport: vi.fn(),
      addRecordingNote: vi.fn(),
      updateRecordingNote: vi.fn(),
      deleteRecordingNote: vi.fn(),
      addDictionaryEntry: vi.fn(),
      applyDictionary: vi.fn(),
      addSpeaker: vi.fn(),
      deleteSpeaker: vi.fn(),
      renameSpeaker: vi.fn(),
      mergeSpeakers: vi.fn(),
      setSegmentSpeaker: vi.fn(),
      updateSegment: vi.fn(),
      markVerified: vi.fn(),
      renameRecording: vi.fn(),
      deleteRecording: vi.fn(),
      deleteTranscription: vi.fn(),
      cancelTranscription: vi.fn(),
      changeRecordingPath: vi.fn(),
      download: vi.fn(),
      // Reached through the player and the recorder rather than by this screen,
      // but the screen mounts both.
      playbackSource: () => Promise.resolve(null),
      recordingWaveform: () => Promise.resolve(null),
      beginTake: vi.fn(),
      appendTakeChunk: vi.fn(),
      discardTake: vi.fn(),
      noteCrash: vi.fn(),
      prevent: vi.fn(),
      ...over,
    },
  };
}

/** jsdom does no layout, so the two browser things this screen measures with
 *  are supplied as stubs. Neither is what these tests are about: the playback
 *  controls watch their own width, and the transcript scrolls to the word
 *  being played. */
export function installBrowserStubs() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= function () {};
}
