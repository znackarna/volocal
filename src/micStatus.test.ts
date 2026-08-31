// @vitest-environment jsdom
/**
 * The one line under the microphone mark, over two reports of 31 August.
 *
 * It said `Mikrofon je připravený` — which repeats what the strip beside it
 * already shows — and it said `Zkontrolujte oprávnění v nastavení systému` for
 * every way of failing. Since `allow_microphone` answers WebView2's permission
 * before anybody is asked, nothing that fails is a person having refused, so
 * that advice was wrong for a machine with no microphone and for one whose
 * microphone another application was holding.
 */
import { describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("./api", () => ({ api: { noteCrash: vi.fn() } }));

import { micFailed, micStatus } from "./AddRecordingDialog";
import type { RecorderPhase } from "./recorder";

/** The key itself, so a reworded sentence cannot break this. */
const key = (k: string) => k;

describe("the line under the microphone", () => {
  test("carries the device name once one is open", () => {
    expect(micStatus("ready", false, "Sluchátka Jabra Evolve", key)).toBe(
      "Sluchátka Jabra Evolve"
    );
  });

  /** Some drivers give no label. An empty line would be worse than the old
   *  sentence, so the old sentence stays. */
  test("keeps the old sentence for a device with no label", () => {
    expect(micStatus("ready", false, "", key)).toBe("dialogs.addRecording.micReady");
  });

  /** The name answers *which*; a running take answers *what is happening*, and
   *  that is the more useful of the two right then. */
  test("gives way to the state once a take is running", () => {
    expect(micStatus("recording", false, "Sluchátka Jabra Evolve", key)).toBe(
      "dialogs.addRecording.micRecording"
    );
    expect(micStatus("recording", true, "Sluchátka Jabra Evolve", key)).toBe(
      "dialogs.addRecording.micSuspended"
    );
  });
});

describe("the three ways it can fail", () => {
  /** The reported case: a computer with no microphone was told to go and check
   *  a permission that was in perfect order. */
  test("no device says so, rather than blaming a permission", () => {
    expect(micStatus("no-device", false, "", key)).toBe("dialogs.addRecording.micNoDevice");
  });

  test("a device another application holds says that instead", () => {
    expect(micStatus("device-busy", false, "", key)).toBe("dialogs.addRecording.micBusy");
  });

  /** The one case where the old sentence was right all along: Windows refusing
   *  in its Privacy settings. */
  test("a refusal by the system keeps the sentence about permissions", () => {
    expect(micStatus("denied", false, "", key)).toBe("dialogs.addRecording.micDenied");
  });

  test("all three are drawn as failures, and nothing else is", () => {
    const failing: RecorderPhase[] = ["denied", "no-device", "device-busy"];
    const working: RecorderPhase[] = [
      "idle",
      "preparing",
      "ready",
      "recording",
      "preview",
      "saving",
    ];
    expect(failing.every((p) => micFailed(p))).toBe(true);
    expect(working.some((p) => micFailed(p))).toBe(false);
  });
});
