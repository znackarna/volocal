// @vitest-environment jsdom
/**
 * The transcript screen, rendered whole.
 *
 * `Detail.tsx` is the largest screen in the application — 3 507 lines and 53
 * pieces of state — and until now nothing rendered it. Every fault of its
 * shape that has actually reached the owner was found by eye: the `Výkon` card
 * flashing a refusal, the folder button missing from an empty archive. Both
 * were two correct halves wired apart, and a test of either half alone passes.
 *
 * `docs/cleanup-plan-2026-08-28.md` point C named three places here where a
 * selector and the data it selects from are set independently. Read against
 * the screen on 31 August, all three draw correctly today — so what these
 * tests pin is the behaviour that is right, and they are the thing that will
 * notice when a later change makes one of them wrong.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { PlayerProvider } from "../player";
import { RecorderProvider } from "../recorder";
import { enDetail } from "../locales/en/detail";
import type { AiDocument, AiOutput, Detail as DetailData, Recording, Segment, ToolCheck } from "../types";

/** Event handlers the screen registers, so a test can deliver one. The
 *  application's own progress arrives this way and the screen has no other
 *  door: the preview opens on `complete` and on nothing else. */
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));

/** jsdom does no layout, so the two browser things this screen measures with
 *  are supplied as stubs. Neither is what these tests are about: the playback
 *  controls watch their own width, and the transcript scrolls to the word
 *  being played. */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;
Element.prototype.scrollIntoView ??= function () {};

const aiEditStatus = vi.fn();
vi.mock("../api", () => ({
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
  },
}));

import Detail from "../Detail";

const say = (key: keyof typeof enDetail) => enDetail[key]!;

const RECORDING_ID = "r1";

function recording(): Recording {
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
  };
}

function segment(): Segment {
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
  };
}

function detailData(): DetailData {
  return { recording: recording(), segments: [segment()], speakers: [], notes: [] };
}

/** Everything installed, so nothing on this screen is refused for a missing
 *  tool — these tests are about what the screen draws once it can draw. */
function toolCheck(): ToolCheck {
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

function settings() {
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

function aiDocument(): AiDocument {
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
function summaryFor(variant: string): AiOutput {
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

/** The transcript is drawn word by word, so that the word being played can be
 *  lit on its own — which means no single element holds a whole sentence.
 *  Waiting on the rendered text of the screen is the honest way to ask whether
 *  the transcript arrived. */
async function transcriptShown(container: HTMLElement) {
  await waitFor(() => expect(container.textContent).toContain("začneme"));
}

/** The sidebar's sections each carry an `Add`, so a query has to say which
 *  section it means. Scoped by the heading rather than by position, so
 *  reordering the sidebar does not quietly point this at the speakers. */
function notes(container: HTMLElement) {
  const sections = [...container.querySelectorAll("section.sidebar-section")];
  const section = sections.find((s) =>
    s.textContent?.startsWith(say("detail.notes.heading"))
  );
  if (!section) throw new Error("the notes section is not on the screen");
  return within(section as HTMLElement);
}

function show() {
  return render(
    <I18nProvider>
      <PlayerProvider>
      <RecorderProvider>
      <Detail
        id={RECORDING_ID}
        seekTime={null}
        liveSegments={[]}
        onBack={vi.fn()}
        onNew={vi.fn()}
        onOpenRecorder={vi.fn()}
        onOpenRecording={vi.fn()}
        onExportAudio={vi.fn()}
        folders={[]}
        onMoveToFolder={vi.fn()}
        onCreateFolderFor={vi.fn()}
        onSettings={vi.fn()}
        onError={vi.fn()}
        onInfo={vi.fn()}
        onToModule={vi.fn()}
        onTranscribe={vi.fn().mockResolvedValue(true)}
        onDiarize={vi.fn()}
        diarizing={false}
      />
      </RecorderProvider>
      </PlayerProvider>
    </I18nProvider>
  );
}

/** The application's own way in: the model reports it has finished, and the
 *  screen fetches the result and opens the preview over it. */
async function finishAiRun(outputs: AiOutput[]) {
  aiEditStatus.mockResolvedValue({
    document: aiDocument(),
    outputs,
    custom: [],
    running: false,
    progress: null,
  });
  await act(async () => {
    listeners.get("ai-edit:progress")?.({
      payload: {
        recording_id: RECORDING_ID,
        phase: "complete",
        percent: 100,
        description: { code: "ai.done" },
      },
    });
  });
}

beforeEach(() => {
  listeners.clear();
  aiEditStatus.mockReset();
  aiEditStatus.mockResolvedValue({
    document: null,
    outputs: [],
    custom: [],
    running: false,
    progress: null,
  });
});

afterEach(cleanup);

describe("the transcript screen", () => {
  test("renders whole, with the transcript in it", async () => {
    // Nothing here asserts a layout. What is being pinned is that the largest
    // screen in the application mounts at all — 53 pieces of state, thirty-six
    // backend calls — which is the thing no test did before.
    const { container } = show();
    await transcriptShown(container);
  });

  test("a summary length with nothing behind it offers to make one, rather than showing a blank", async () => {
    const { container } = show();
    await transcriptShown(container);

    // A summary exists for `standard`, which is where the screen starts.
    await finishAiRun([summaryFor("standard")]);

    fireEvent.click(await screen.findByText(say("detail.preview.summaryTab")));
    expect(await screen.findByText("Souhrn (standard).")).toBeTruthy();

    // `Stručný` has no summary. The selector moves and the data does not
    // follow it — the exact pair the plan named. The screen must say so and
    // offer the step that comes first, not hand back an empty panel.
    fireEvent.click(screen.getByText(say("detail.summaryLength.short")));

    expect(await screen.findByText(say("detail.summary.createShortTitle"))).toBeTruthy();
    expect(screen.getByText(say("detail.summary.create"))).toBeTruthy();
    expect(screen.queryByText("Souhrn (standard).")).toBeNull();
  });

  test("choosing the length that does have a summary brings it back", async () => {
    const { container } = show();
    await transcriptShown(container);
    await finishAiRun([summaryFor("detailed")]);

    fireEvent.click(await screen.findByText(say("detail.preview.summaryTab")));
    // Starts on `standard`, which has nothing.
    expect(await screen.findByText(say("detail.summary.createStandardTitle"))).toBeTruthy();

    fireEvent.click(screen.getByText(say("detail.summaryLength.detailed")));
    expect(await screen.findByText("Souhrn (detailed).")).toBeTruthy();
  });

  test("a finished run stops the screen saying it is running", async () => {
    const { container } = show();
    await transcriptShown(container);

    // The backend has to agree that it is running. Saying so is not padding:
    // once the screen believes a run is going it polls the real status every
    // second and takes its answer, so a bubble raised against a backend that
    // says otherwise is taken back down within the same tick. That loop is
    // what keeps a run and its result tied together, and it is the reason the
    // pair the plan worried about cannot drift for long.
    aiEditStatus.mockResolvedValue({
      document: null,
      outputs: [],
      custom: [],
      running: true,
      progress: null,
    });
    await act(async () => {
      listeners.get("ai-edit:progress")?.({
        payload: {
          recording_id: RECORDING_ID,
          phase: "editing",
          percent: 40,
          description: { code: "ai.editing" },
        },
      });
    });
    // The bubble's only wording is on the button that stops the run.
    expect(screen.getByLabelText(say("detail.progress.cancelAi"))).toBeTruthy();

    await finishAiRun([]);
    await waitFor(() =>
      expect(screen.queryByLabelText(say("detail.progress.cancelAi"))).toBeNull()
    );
  });

  test("a note begun and then abandoned leaves no draft behind", async () => {
    const { container } = show();
    await transcriptShown(container);

    fireEvent.click(notes(container).getByText(say("detail.notes.add")));

    const field = await screen.findByPlaceholderText(say("detail.notes.placeholder"));
    fireEvent.change(field, { target: { value: "rozepsaná poznámka" } });
    expect((field as HTMLTextAreaElement).value).toBe("rozepsaná poznámka");

    // Escape gives the editor up. The flag saying a note is being written and
    // the text being written are separate pieces of state, and what must not
    // happen is one going without the other: an editor closed over a draft
    // still held, or reopened with somebody's abandoned sentence in it.
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(say("detail.notes.placeholder"))).toBeNull()
    );

    fireEvent.click(notes(container).getByText(say("detail.notes.add")));
    const again = await screen.findByPlaceholderText(say("detail.notes.placeholder"));
    expect((again as HTMLTextAreaElement).value).toBe("");
  });
});
