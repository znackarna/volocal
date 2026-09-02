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
  recording,
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
import { enDomain } from "../locales/en/domain";

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
    /* Named rather than shown as a code: the reader is told what they will
       get. From `domain.language`, which names all ninety-nine whisper can
       hear — the bar kept a list of seven and shouted "CY" for the rest. */
    expect(container.textContent).toContain(enDomain["domain.language.en"]);
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

  /** **The defect this was written for.** The sweep is the last thing a run
   *  does, so its answer lands after the screen has already asked once and been
   *  told nothing. A reader who sits and watches a transcription finish would
   *  otherwise have to leave the transcript and come back to be told that half
   *  of it is missing. */
  test("comes up when a run finishes under the open screen", async () => {
    const { container, handItAgain } = show({
      progress: {
        recording_id: RECORDING_ID,
        phase: "transcription",
        percent: 40,
        description: { code: "transcription.running", params: {}, detail: "" },
      },
    });
    await transcriptShown(container);
    expect(container.textContent).not.toContain(say("detail.secondLanguage.fill"));

    // The run ends, and only now does the backend have an answer.
    secondLanguage.mockResolvedValue(offered());
    await act(async () => {
      handItAgain({
        progress: {
          recording_id: RECORDING_ID,
          phase: "complete",
          percent: 100,
          description: { code: "transcription.complete", params: {}, detail: "" },
        },
      });
    });

    await waitFor(() =>
      expect(container.textContent).toContain(say("detail.secondLanguage.fill"))
    );
  });

  /** An offer is about a transcript. Over a recording that has none — never
   *  transcribed, or its transcript discarded — there is nothing to fill, and
   *  the button would only fail. */
  test("says nothing over a recording with no transcript", async () => {
    secondLanguage.mockResolvedValue(offered());
    setDetail(detailData({ recording: recording({ status: "new", segment_count: 0 }), segments: [] }));
    const { container } = show();
    await waitFor(() => expect(secondLanguage).toHaveBeenCalled());
    expect(container.textContent).not.toContain(say("detail.secondLanguage.fill"));
  });

  /** Two doors to one room. A fill started from the menu is a run, and the
   *  bar must not go on offering to start it while the bubble shows it going. */
  test("steps aside while a run is going on this recording", async () => {
    secondLanguage.mockResolvedValue(offered());
    const { container } = show({
      progress: {
        recording_id: RECORDING_ID,
        phase: "second_language",
        percent: 30,
        description: { code: "second_language.transcribing", params: {}, detail: "" },
      },
    });
    await transcriptShown(container);
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

  /** **Stopping it is not a failure.** The bubble's Zrušit reaches a fill like
   *  any run, and the call that started it then comes back refused with
   *  `transcription.cancelled`. Every other cancelled run in the application is
   *  silent; this one put a red notice over the header. The offer stays,
   *  because the question was not answered. */
  test("a cancelled fill raises no error and keeps the offer", async () => {
    secondLanguage.mockResolvedValue(offered());
    fillSecondLanguage.mockRejectedValue({ code: "transcription.cancelled", params: {} });
    const onError = vi.fn();
    const { container } = show({ onError });
    await waitFor(() =>
      expect(container.textContent).toContain(say("detail.secondLanguage.fill"))
    );

    await act(async () => {
      screen.getByText(say("detail.secondLanguage.fill")).click();
    });

    expect(fillSecondLanguage).toHaveBeenCalledWith(RECORDING_ID);
    expect(onError).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(container.textContent).toContain(say("detail.secondLanguage.fill"))
    );
  });
});
