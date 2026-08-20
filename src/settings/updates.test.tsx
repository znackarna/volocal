// @vitest-environment jsdom
/**
 * The update panel, over the loss path Fable found on 20 August: installing an
 * update ends in `process::exit(0)`, which raises no `tauri://close-requested`,
 * so the recorder's close guard never hears it. The gesture made safe on
 * 17 August was the window's close button; this is the same loss through a
 * different door.
 *
 * Rendered rather than reasoned about, because what is being pinned is that
 * one button asks another part of the application a question before it acts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { enSettings } from "../locales/en/settings";

const downloadAndInstall = vi.fn();
const check = vi.fn();
let phase = "idle";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => check(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.2.18"),
}));

vi.mock("../api", () => ({
  api: {
    letTheInstallerOut: vi.fn(() => Promise.resolve()),
  },
}));

// The panel asks the recorder whether a take is live. Only the phase matters
// here; the real provider needs a microphone.
vi.mock("../recorder", () => ({
  useRecorder: () => ({ phase }),
}));

import { UpdateCheck } from "./updates";

const say = (key: keyof typeof enSettings) => enSettings[key]!;

function show() {
  return render(
    <I18nProvider>
      <UpdateCheck
        onError={onError}
        onInfo={() => {}}
        automatic={false}
        onAutomaticChange={() => {}}
        found={{ version: "1.2.19", notes: "- something" }}
      />
    </I18nProvider>
  );
}

const onError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  phase = "idle";
  check.mockResolvedValue({ version: "1.2.19", downloadAndInstall });
  downloadAndInstall.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("installing an update", () => {
  test.each(["recording", "preview"])(
    "is refused while a take is %s, and fetches nothing",
    async (live) => {
      phase = live;
      show();

      fireEvent.click(screen.getByText(say("settings.about.updateInstall")));

      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(onError.mock.calls[0][0]).toBe(say("settings.about.updateBlockedByTake"));
      expect(check).not.toHaveBeenCalled();
      expect(downloadAndInstall).not.toHaveBeenCalled();
    }
  );

  /** An open microphone with nothing recorded is not a take, and neither is a
   *  take already on its way to disk — the same two exceptions the close guard
   *  makes, for the same reason. */
  test.each(["idle", "ready", "saving"])("goes ahead when the phase is %s", async (quiet) => {
    phase = quiet;
    show();

    fireEvent.click(screen.getByText(say("settings.about.updateInstall")));

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });
});
