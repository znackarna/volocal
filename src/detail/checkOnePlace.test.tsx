// @vitest-environment jsdom
/**
 * Clicking a place put up for checking plays that place and stops there.
 *
 * The question being answered is *is this word right*, which the sentence
 * after it does not help with. Before 2026-09-02 the recording ran on and the
 * reader reached for pause before every next check.
 *
 * The clock is watched rather than a timer set, so these tests move the
 * player's clock rather than the wall clock — which is also what happens when
 * the reader changes the speed halfway through.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const player = {
  recordingId: "recording",
  title: "x",
  path: "x.wav",
  duration: 100,
  isPlaying: true,
  isPreparing: false,
  rate: 1,
  start: vi.fn(),
  togglePlayback: vi.fn(),
  seek: vi.fn(),
  shift: vi.fn(),
  setRate: vi.fn(),
  updateTitle: vi.fn(),
  close: vi.fn(),
  waveform: { peaks: new Float32Array(), duration: 0 },
  sourceMissing: false,
  readTime: vi.fn(() => 0),
};

vi.mock("../player", () => ({
  usePlayer: () => player,
  usePlayerTime: () => 0,
  loadWaveform: vi.fn(),
  EMPTY_WAVEFORM: { peaks: new Float32Array(), duration: 0 },
}));

import { useDetailPlayback } from "./useDetailPlayback";

function playback() {
  return renderHook(() =>
    useDetailPlayback({
      recordingId: "recording",
      path: "x.wav",
      title: "x",
      duration: 100,
      segments: [],
      seekTime: null,
      drawnBlocks: 0,
    })
  );
}

/** One frame of the watch, however jsdom schedules it. */
function aFrame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

describe("hearing one place", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    player.isPlaying = true;
    player.readTime.mockReturnValue(0);
    player.togglePlayback.mockClear();
    player.seek.mockClear();
  });

  it("stops when the clock reaches the end of it", () => {
    const { result } = playback();
    act(() => result.current.actions.playRange(10, 12));
    expect(player.seek).toHaveBeenCalledWith(10);

    player.readTime.mockReturnValue(11.4);
    aFrame();
    expect(player.togglePlayback).not.toHaveBeenCalled();

    player.readTime.mockReturnValue(12.1);
    aFrame();
    expect(player.togglePlayback).toHaveBeenCalledTimes(1);
  });

  /** The stop belongs to the stretch it was set for. Asking for another moment
   *  is the reader taking the player over, and it must not cut out under them
   *  a second later. */
  it("does not stop playback the reader has since taken over", () => {
    const { result } = playback();
    act(() => result.current.actions.playRange(10, 12));
    act(() => result.current.actions.playFrom(40));

    player.readTime.mockReturnValue(60);
    aFrame();
    aFrame();
    expect(player.togglePlayback).not.toHaveBeenCalled();
  });

  /** Pausing at the boundary would start it again. */
  it("does not toggle a player that is already stopped", () => {
    const { result } = playback();
    act(() => result.current.actions.playRange(10, 12));
    player.isPlaying = false;
    player.readTime.mockReturnValue(12.5);
    aFrame();
    expect(player.togglePlayback).not.toHaveBeenCalled();
  });
});
