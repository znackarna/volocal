// @vitest-environment jsdom
/**
 * The line that says a language is missing from this transcript.
 *
 * Written against the whole screen rather than against the hook, like every
 * other test of this screen: what is pinned is what a reader sees and presses,
 * not which file holds the state.
 *
 * The case worth naming first is the quiet one. On an ordinary recording the
 * sweep finds nothing and this must draw nothing at all — a feature that costs
 * its reader no attention on the ninety-nine recordings it does not apply to.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import {
  RECORDING_ID,
  fillSecondLanguage,
  installBrowserStubs,
  refuseSecondLanguage,
  secondLanguage,
  segment,
  setDetail,
  detailData,
} from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { resetScreen, say, show, transcriptShown } from "./screen.harness";

/** What the sweep found, as the backend hands it over. */
const offered = (language = "en") => ({
  recording_id: RECORDING_ID,
  language,
  share: 0.2,
  state: "offered" as const,
  filled_at: null,
});

beforeEach(resetScreen);
afterEach(cleanup);

describe("a language the transcript is missing", () => {
  test("says nothing at all about a recording spoken in one language", async () => {
    const { container } = show();
    await transcriptShown(container);
    expect(container.textContent).not.toContain(say("detail.secondLanguage.fill"));
  });

  test("offers to fill in the language it found, and names it", async () => {
    secondLanguage.mockResolvedValue(offered());
    const { container } = show();
    await waitFor(() =>
      expect(container.textContent).toContain(say("detail.secondLanguage.fill"))
    );
    // Named rather than shown as a code: the reader is told what they will get.
    expect(container.textContent).toContain(say("detail.language.en"));
  });

  test("says nothing once the reader has already answered", async () => {
    secondLanguage.mockResolvedValue({ ...offered(), state: "refused" as const });
    const { container } = show();
    await transcriptShown(container);
    expect(container.textContent).not.toContain(say("detail.secondLanguage.fill"));
  });

  test("takes the offer away when the reader declines, and writes that down", async () => {
    secondLanguage.mockResolvedValue(offered());
    const { container } = show();
    await waitFor(() =>
      expect(container.textContent).toContain(say("detail.secondLanguage.no"))
    );

    await act(async () => {
      screen.getByText(say("detail.secondLanguage.no")).click();
    });

    expect(refuseSecondLanguage).toHaveBeenCalledWith(RECORDING_ID);
    expect(container.textContent).not.toContain(say("detail.secondLanguage.fill"));
  });

  /** Filling rewrites every block, including the ones whose text did not
   *  change, because their order did. A screen still drawing the transcript it
   *  had before would be showing the old one. */
  test("fetches the transcript again after filling", async () => {
    secondLanguage.mockResolvedValue(offered());
    fillSecondLanguage.mockResolvedValue(3);
    const { container } = show();
    await waitFor(() =>
      expect(container.textContent).toContain(say("detail.secondLanguage.fill"))
    );

    setDetail(
      detailData({
        segments: [
          segment(),
          segment({ id: "s2", start: 5, end: 7, text: "One rod, one hook." }),
        ],
      })
    );
    await act(async () => {
      screen.getByText(say("detail.secondLanguage.fill")).click();
    });

    expect(fillSecondLanguage).toHaveBeenCalledWith(RECORDING_ID);
    await waitFor(() => expect(container.textContent).toContain("One rod"));
  });
});
