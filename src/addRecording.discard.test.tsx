// @vitest-environment jsdom
/**
 * Throwing a take away, over the owner's report of 31 August: he stopped a take
 * from the minimised pill, the dialog came back with the finished take in it,
 * and getting out again took `Zahodit`, `Zrušit`, `Zrušit`.
 *
 * The first of those is a decision — *I do not want this recording* — and the
 * screen answered it by re-arming the microphone and offering to make another,
 * with the way out two presses further on because `Zrušit` steps back to the
 * source cards rather than closing.
 *
 * What is pinned here is that discarding now ends the errand, and that it still
 * throws the take away rather than merely hiding it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import { enDialogs } from "./locales/en/dialogs";

/* jsdom has no layout, and the waveform under the take watches its own width.
   The same stub `src/detail/screen.test.tsx` uses. */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const discardTake = vi.fn();
const releaseMicrophone = vi.fn();
const recorderStop = vi.fn();

let phase = "preview";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("./api", () => ({
  api: { noteCrash: vi.fn(), discardTake: () => discardTake() },
}));

vi.mock("./recorder", async (importOriginal) => {
  const real = await importOriginal<typeof import("./recorder")>();
  return {
    ...real,
    useSpectrum: () => new Array<number>(30).fill(0),
    useRecorder: () => ({
      phase,
      suspended: false,
      seconds: 4,
      devices: [],
      deviceId: "",
      chooseDevice: vi.fn(),
      analyserNode: () => null,
      takeWaveform: () => ({
        points: [],
        pointsPerSecond: 0,
        equalizer: [],
        equalizerPointsPerSecond: 0,
        equalizerBandCount: 0,
      }),
      openMicrophone: vi.fn(),
      releaseMicrophone,
      start: vi.fn(),
      stop: recorderStop,
      discard: vi.fn(),
      take: () => new Blob([new Uint8Array([1, 2, 3])]),
      setSaving: vi.fn(),
      reset: releaseMicrophone,
    }),
  };
});

import AddRecordingDialog from "./AddRecordingDialog";

const say = (key: keyof typeof enDialogs) => enDialogs[key]!;

const onClose = vi.fn();

function show() {
  return render(
    <I18nProvider>
      <AddRecordingDialog
        initialView="microphone"
        onClose={onClose}
        onLocalFile={() => {}}
        onRecorded={() => {}}
        onImported={() => {}}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  phase = "preview";
});

afterEach(cleanup);

describe("throwing a finished take away", () => {
  /** The reported friction. One press, and the errand is over. */
  test("closes the dialog instead of re-arming the microphone", () => {
    show();

    fireEvent.click(screen.getByText(say("dialogs.addRecording.micDiscard")));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** And it is a discard, not a dismissal: the take must not survive to be
   *  handed back by the rescue at the next start. */
  test("lets the take and the microphone go", () => {
    show();

    fireEvent.click(screen.getByText(say("dialogs.addRecording.micDiscard")));

    expect(releaseMicrophone).toHaveBeenCalledTimes(1);
  });

  /** The guard that stays: a take nobody has decided about cannot be clicked
   *  away by accident. Only the buttons end it. */
  test("a stray click outside still cannot lose an undecided take", () => {
    const { container } = show();

    fireEvent.mouseDown(container.firstChild as Element);

    expect(onClose).not.toHaveBeenCalled();
  });
});
