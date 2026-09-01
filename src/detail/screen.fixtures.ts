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
import type {
  AiCustomDocument,
  AiDocument,
  AiOutput,
  Detail as DetailData,
  Recording,
  RecordingNote,
  Segment,
  Speaker,
  ToolCheck,
} from "../types";

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
    language: null,
    ...over,
  };
}

export function detailData(over: Partial<DetailData> = {}): DetailData {
  return { recording: recording(), segments: [segment()], speakers: [], notes: [], ...over };
}

/** What the screen will be given when it asks for the recording. A test that
 *  needs more than one segment — anything about searching, moving between
 *  hits, or the speakers of a conversation — sets it before mounting, and
 *  `resetScreen` puts it back. */
let chosen: DetailData | null = null;

export function setDetail(data: DetailData) {
  chosen = data;
}

export function currentDetail(): DetailData {
  return chosen ?? detailData();
}

export function forgetDetail() {
  chosen = null;
}

/** A short conversation, one sentence per segment, with `porada` in the first
 *  and the last. Enough for a search to have somewhere to move between. */
export function conversation(): DetailData {
  const lines = [
    "Dobrý den, začneme poradu.",
    "Dnes máme tři body.",
    "První je rozpočet.",
    "Tím poradu končíme.",
  ];
  return detailData({
    recording: recording({ duration: 60, segment_count: lines.length }),
    segments: lines.map((text, i) =>
      segment({ id: `s${i + 1}`, order: i, start: i * 10, end: i * 10 + 8, text })
    ),
  });
}

export function speaker(over: Partial<Speaker> = {}): Speaker {
  return {
    key: "SPEAKER_00",
    recording_id: RECORDING_ID,
    name: "Mluvčí 1",
    color: "#7aa2f7",
    ...over,
  };
}

/** The same four sentences, split between two voices: three to the first and
 *  one to the second, so the shares are 75 and 25 and a test can tell which
 *  number belongs to whom. */
export function conversationWithSpeakers(): DetailData {
  const base = conversation();
  return detailData({
    ...base,
    speakers: [
      speaker({ key: "SPEAKER_00", name: "Jana" }),
      speaker({ key: "SPEAKER_01", name: "Petr", color: "#9ece6a" }),
    ],
    segments: base.segments.map((s, i) => ({
      ...s,
      speakers: i === 2 ? "SPEAKER_01" : "SPEAKER_00",
    })),
  });
}

export function note(over: Partial<RecordingNote> = {}): RecordingNote {
  return {
    id: "n1",
    recording_id: RECORDING_ID,
    time: null,
    text: "Ověřit rozpočet.",
    done: false,
    created_at: "2026-08-31T09:10:00Z",
    ...over,
  };
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

/** Something made from the reader's own instruction, with no enhanced
 *  transcript beside it. That pair is the one the reading window's empty state
 *  is reached by: the window opens because this exists, and its first three
 *  tabs have nothing behind them. */
export function customDocument(prompt = "Vypiš úkoly."): AiCustomDocument {
  return {
    recording_id: RECORDING_ID,
    prompt,
    source_hash: "h1",
    model: "editor",
    text: "Úkol jedna.",
    updated_at: "2026-08-31T09:07:00Z",
    stale: false,
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
 *  Built once and exported, rather than made fresh inside `apiMock`, because a
 *  test has to be able to reach the very spies the screen is calling — to say
 *  what a write answers with, and to read back what it was given.
 *
 *  The reads are functions rather than fixed values so that a test can choose
 *  the recording through `setDetail` without a second copy of the whole thing. */
export const api = {
  detail: () => Promise.resolve(currentDetail()),
  checkTools: () => Promise.resolve(toolCheck()),
  loadSettings: () => Promise.resolve(settings()),
  saveSettings: vi.fn(),
  dictionary: () => Promise.resolve([]),
  catalog: () => Promise.resolve([]),
  aiEditStatus: (id: string) => aiEditStatus(id),
  fileExists: () => Promise.resolve(true),
  /* The plain-text export, which is what the reading window shows under
     `Původní`. It answers with the transcript it was given, so a test can tell
     the machine's own words apart from what the model made of them. */
  exportPreview: () =>
    Promise.resolve(currentDetail().segments.map((s) => s.text).join("\n\n")),
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
};

/** Call from inside `vi.mock("../api", ...)`. */
export function apiMock() {
  return { api };
}

/** Forgets what the last test asked the backend to do, and what the spies were
 *  told to answer. The reads are plain functions and are left alone. */
export function resetApi() {
  for (const value of Object.values(api)) {
    if (typeof value === "function" && "mockReset" in value) {
      (value as { mockReset: () => void }).mockReset();
    }
  }
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
