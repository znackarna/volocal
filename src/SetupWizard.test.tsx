// @vitest-environment jsdom
/**
 * The by-hand listing, over the report of 20 August: delete the transcription
 * model and the card says one item is missing, while the list it sends the
 * reader to marks nothing at all.
 *
 * Rendered rather than reasoned about, because what broke was the wiring
 * between two correct halves — `tools::check` knew, and the row drew a flag
 * that could not carry the answer. A test of either half alone passes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import { enCatalog } from "./locales/en/catalog";
import type { DownloadComponent, ToolCheck } from "./types";

/** A row is found by the name the dictionary gives it, read from the
 *  dictionary rather than typed out here: this test is about which row wears
 *  the badge, and it must not fail the day somebody rewords a catalogue entry. */
const named = (id: string) => enCatalog[`catalog.${id}.name` as keyof typeof enCatalog]!;

const catalog = vi.fn();
const checkTools = vi.fn();
const download = vi.fn();
const loadSettings = vi.fn();
const saveSettings = vi.fn();

vi.mock("./api", () => ({
  api: {
    catalog: () => catalog(),
    checkTools: () => checkTools(),
    download: (ids: string[]) => download(ids),
    loadSettings: () => loadSettings(),
    saveSettings: (s: unknown) => saveSettings(s),
    cancelComponent: vi.fn(),
    removeComponent: vi.fn(),
  },
}));

// The wizard subscribes to download progress. Nothing here emits any, and the
// unsubscribe it returns has to be a function or React tears down badly.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

import SetupWizard from "./SetupWizard";

function component(id: string, over: Partial<DownloadComponent> = {}): DownloadComponent {
  return {
    id,
    name_code: `catalog.${id}.name`,
    description_code: `catalog.${id}.description`,
    megabytes: 100,
    group: id.startsWith("model-") ? "model" : "program",
    required: false,
    recommended: false,
    complete: false,
    removable: false,
    remove_block: null,
    replaceable: false,
    configured: false,
    replaced_by: null,
    origin_verified: false,
    ...over,
  } as DownloadComponent;
}

function machine(over: Partial<ToolCheck> = {}): ToolCheck {
  return {
    ffmpeg: "ffmpeg.exe",
    ffprobe: "ffprobe.exe",
    whisper_cli: "whisper-cli.exe",
    model_whisper: null,
    model_vad: "vad.bin",
    embedding_model: null,
    editor_cli: null,
    editor_server: null,
    editor_model: null,
    editor_model_id: null,
    portable: false,
    app_directory: "C:\\app",
    webview2_bundled: false,
    compute: "cpu",
    available_compute_backends: ["cpu"],
    nvidia_driver: false,
    vulkan_driver: false,
    memory_gb: 16,
    found_models: [],
    issues: [],
    issues_diarization: [],
    issues_editor: [],
    needed: [],
    ...over,
  } as ToolCheck;
}

function show(required = false) {
  return render(
    <I18nProvider>
      <SetupWizard
        required={required}
        onBack={() => {}}
        onComplete={() => {}}
        onError={() => {}}
        alreadyFetching={false}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  download.mockResolvedValue(undefined);
  loadSettings.mockResolvedValue({ model: "large-v3", quality_choice: "accurate" });
  saveSettings.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("the row that says what to fetch", () => {
  /** The reported fault. `model-large` is not `required` in the catalogue — no
   *  single model is — so before `needed` this list marked nothing while the
   *  card behind it warned that something was missing. */
  test("a model the check asks for is marked, though the catalogue calls it optional", async () => {
    catalog.mockResolvedValue([
      component("model-turbo", { complete: true }),
      component("model-large"),
    ]);
    checkTools.mockResolvedValue(
      machine({ needed: ["model-large"], issues: [{ code: "tools.whisper_model_missing", params: {}, detail: "" }] })
    );

    show();

    await waitFor(() => expect(screen.getByText(named("model-large"))).toBeTruthy());
    const marked = document.querySelectorAll("li.component .badge.required");
    expect(marked.length).toBe(1);
    expect(marked[0].closest("li")?.textContent).toContain(named("model-large"));
  });

  /** And it is an answer to a warning, not a list of everything on offer:
   *  nothing missing, nothing marked. */
  test("a complete installation marks nothing", async () => {
    catalog.mockResolvedValue([
      component("model-turbo", { complete: true }),
      component("model-large"),
    ]);
    checkTools.mockResolvedValue(machine({ model_whisper: "turbo.bin" }));

    show();

    await waitFor(() => expect(screen.getByText(named("model-large"))).toBeTruthy());
    expect(document.querySelectorAll("li.component .badge.required").length).toBe(0);
  });
});

describe("the model already on the disk", () => {
  /** A machine with a graphics card and only the fast model on it. Preselection
   *  used to read the drivers alone, so this opened on *Accurate — 3.0 GB to
   *  download*, with *Fast* beside it marked as already downloaded. */
  test("is the one the cards open on, whatever the drivers would recommend", async () => {
    catalog.mockResolvedValue([
      component("model-turbo", { complete: true }),
      component("model-large", { recommended: true }),
      component("model-hlasy", { complete: true }),
      component("editor-cpu", { complete: true }),
    ]);
    checkTools.mockResolvedValue(
      machine({ nvidia_driver: true, model_whisper: null, needed: ["model-large"] })
    );

    show(true);

    await waitFor(() => expect(screen.getByText("Fast")).toBeTruthy());
    const chosen = document.querySelector('button.choice[aria-pressed="true"]');
    expect(chosen?.textContent).toContain("Fast");
    // And the recommendation is still drawn where it belongs, on the other card.
    expect(chosen?.textContent).not.toContain("Recommended");
  });

  /** And finishing on it writes it down. Nothing is fetched, so no
   *  `download:complete` arrives, so the record `App.tsx` honours is never
   *  read — which is why the setting has to be written here or nowhere. */
  test("is written to the settings even though nothing was downloaded", async () => {
    catalog.mockResolvedValue([
      component("model-turbo", { complete: true }),
      component("model-large", { recommended: true }),
      component("model-hlasy", { complete: true }),
      component("editor-cpu", { complete: true }),
    ]);
    checkTools.mockResolvedValue(machine({ nvidia_driver: true }));

    show(true);

    await waitFor(() => expect(screen.getByText("Fast")).toBeTruthy());
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(screen.getByText("Close")).toBeTruthy());
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(saveSettings.mock.calls[0][0]).toMatchObject({
      model: "large-v3-turbo-q5_0",
      quality_choice: "fast",
    });
    expect(download).not.toHaveBeenCalled();
  });
});
