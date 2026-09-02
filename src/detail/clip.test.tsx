// @vitest-environment jsdom
/**
 * Exporting the passage the reader marked.
 *
 * Two things are worth holding. That a passage dragged upwards comes out the
 * right way round — the browser hands its two ends in the order they were
 * touched, not in the order they are spoken. And that ticking several shapes
 * writes several files under one question about where to put them, because
 * the audio, the subtitles and the text usually come out of the same passage
 * at the same moment.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveClip, useClipSelection } from "./useClipSelection";
import type { Segment } from "../types";

const saveClipAudio = vi.fn(async (_id: string, _from: number, _to: number, path: string) => path);
const saveClipText = vi.fn(
  async (_id: string, _from: number, _to: number, _format: string, path: string) => path
);
const suggestedClipName = vi.fn(
  async (_id: string, _from: number, _to: number, format: string) =>
    `Porada 0-04 - 0-20.${format === "audio" ? "mp3" : format}`
);

vi.mock("../api", () => ({
  api: {
    saveClipAudio: (...a: Parameters<typeof saveClipAudio>) => saveClipAudio(...a),
    saveClipText: (...a: Parameters<typeof saveClipText>) => saveClipText(...a),
    suggestedClipName: (...a: Parameters<typeof suggestedClipName>) => suggestedClipName(...a),
  },
}));

function block(id: string, start: number, end: number): Segment {
  return {
    id,
    recording_id: "r",
    order: 0,
    start,
    end,
    text: id,
    speakers: null,
    confidence: null,
    edited: false,
    verified: false,
    words: null,
    original: null,
    language: null,
  } as unknown as Segment;
}

const TRANSCRIPT = [
  block("a", 0, 4),
  block("b", 4, 9),
  block("c", 9, 14),
  block("d", 14, 20),
];

describe("marking a passage", () => {
  it("takes it whole and goes straight to saving", () => {
    const { result } = renderHook(() => useClipSelection());
    act(() => result.current.actions.markAndSave(TRANSCRIPT[1], TRANSCRIPT[3]));
    expect(result.current.state.start).toBe(4);
    expect(result.current.state.end).toBe(20);
    expect(result.current.state.seconds).toBe(16);
    expect(result.current.state.saving).toBe(true);
  });

  /** A passage dragged from the bottom up hands its ends in that order. */
  it("takes one marked backwards the right way round", () => {
    const { result } = renderHook(() => useClipSelection());
    act(() => result.current.actions.markAndSave(TRANSCRIPT[3], TRANSCRIPT[1]));
    expect(result.current.state.start).toBe(4);
    expect(result.current.state.end).toBe(20);
  });

  it("forgets the passage when the dialog is closed", () => {
    const { result } = renderHook(() => useClipSelection());
    act(() => result.current.actions.markAndSave(TRANSCRIPT[1], TRANSCRIPT[3]));
    act(() => result.current.actions.close());
    expect(result.current.state.saving).toBe(false);
    expect(result.current.state.from).toBe(null);
  });
});

describe("saving it", () => {
  beforeEach(() => {
    saveClipAudio.mockClear();
    saveClipText.mockClear();
  });

  const common = {
    recordingId: "r",
    start: 4,
    end: 20,
    onError: vi.fn(),
  };

  /** One shape is one file, and the reader names it — what anybody exporting
   *  a single thing expects. */
  it("asks for a file name when one shape is ticked", async () => {
    const chooseFile = vi.fn(async () => "D:/ven/citace.srt");
    const chooseFolder = vi.fn(async () => null);
    const onSaved = vi.fn();

    await saveClip({ ...common, shapes: ["srt"], chooseFile, chooseFolder, onSaved });

    expect(chooseFolder).not.toHaveBeenCalled();
    expect(saveClipText).toHaveBeenCalledWith("r", 4, 20, "srt", "D:/ven/citace.srt");
    expect(onSaved).toHaveBeenCalledWith(["D:/ven/citace.srt"]);
  });

  /** Several shapes are one question — which folder — rather than one dialog
   *  per file. */
  it("asks for a folder once when several are ticked", async () => {
    const chooseFile = vi.fn(async () => null);
    const chooseFolder = vi.fn(async () => "D:/ven");
    const onSaved = vi.fn();

    await saveClip({
      ...common,
      shapes: ["audio", "srt"],
      chooseFile,
      chooseFolder,
      onSaved,
    });

    expect(chooseFile).not.toHaveBeenCalled();
    expect(chooseFolder).toHaveBeenCalledTimes(1);
    expect(saveClipAudio).toHaveBeenCalledWith("r", 4, 20, "D:/ven\\Porada 0-04 - 0-20.mp3");
    expect(saveClipText).toHaveBeenCalledWith(
      "r",
      4,
      20,
      "srt",
      "D:/ven\\Porada 0-04 - 0-20.srt"
    );
    expect(onSaved).toHaveBeenCalledWith([
      "D:/ven\\Porada 0-04 - 0-20.mp3",
      "D:/ven\\Porada 0-04 - 0-20.srt",
    ]);
  });

  it("writes nothing when the reader closes the file dialog", async () => {
    const onSaved = vi.fn();
    await saveClip({
      ...common,
      shapes: ["txt"],
      chooseFile: async () => null,
      chooseFolder: async () => null,
      onSaved,
    });
    expect(saveClipText).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  /** A failure halfway through still says which files arrived: the reader has
   *  them on disk and needs to know. */
  it("reports the files that were written before a failure", async () => {
    saveClipText.mockRejectedValueOnce({ code: "clip.audio_failed" } as never);
    const onError = vi.fn();
    const onSaved = vi.fn();

    await saveClip({
      ...common,
      shapes: ["audio", "srt"],
      chooseFile: async () => null,
      chooseFolder: async () => "D:/ven",
      onError,
      onSaved,
    });

    expect(onSaved).toHaveBeenCalledWith(["D:/ven\\Porada 0-04 - 0-20.mp3"]);
    expect(onError).toHaveBeenCalled();
  });
});
