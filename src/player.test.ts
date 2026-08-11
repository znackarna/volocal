import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/** The player had none of these, and the hardest defect in this project lived
 *  here: clicking a word at 39:07 in an MP3 started playback eight seconds late.
 *  The fix — a converted proxy, one conversion per recording however many times
 *  it is asked for, and a waveform that keeps being asked for while ffmpeg is
 *  still working — was protected by nothing but somebody remembering it.
 *
 *  What is tested here is the part that can be: the joining, the polling and the
 *  arithmetic. Drawing needs a canvas and playback needs an audio device. */

const playbackSource = vi.fn();
const recordingWaveform = vi.fn();

vi.mock("./api", () => ({
  api: {
    playbackSource: (id: string) => playbackSource(id),
    recordingWaveform: (id: string) => recordingWaveform(id),
  },
}));

// Imported after the mock, and freshly each time: the join table is module
// state, and a test that inherited it from the one before would pass for the
// wrong reason.
let player: typeof import("./player");

beforeEach(async () => {
  vi.resetModules();
  playbackSource.mockReset();
  recordingWaveform.mockReset();
  player = await import("./player");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("preparing the playback source", () => {
  test("asking twice starts one conversion", async () => {
    // The detail screen prewarms on open; pressing a word a moment later must
    // join that promise rather than start a second ffmpeg over the same file.
    playbackSource.mockResolvedValue("C:/cache/janka.m4a");

    player.preparePlaybackSource("r1", "C:/janka.mp3");
    player.preparePlaybackSource("r1", "C:/janka.mp3");
    await Promise.resolve();

    expect(playbackSource).toHaveBeenCalledTimes(1);
  });

  test("a different source for the same recording is a different conversion", async () => {
    // Changing a recording's path invalidates the proxy. The key carries both,
    // so the answer for the old file is not handed out for the new one.
    playbackSource.mockResolvedValue("C:/cache/x.m4a");

    player.preparePlaybackSource("r1", "C:/janka.mp3");
    player.preparePlaybackSource("r1", "C:/janka-moved.mp3");
    await Promise.resolve();

    expect(playbackSource).toHaveBeenCalledTimes(2);
  });

  test("a failure is not remembered, so the next press tries again", async () => {
    // Without clearing the entry, one failed conversion would leave that
    // recording unplayable until the application was restarted.
    playbackSource.mockRejectedValueOnce(new Error("ffmpeg missing"));
    player.preparePlaybackSource("r1", "C:/janka.mp3");
    await Promise.resolve();
    await Promise.resolve();

    playbackSource.mockResolvedValue("C:/cache/janka.m4a");
    player.preparePlaybackSource("r1", "C:/janka.mp3");
    await Promise.resolve();

    expect(playbackSource).toHaveBeenCalledTimes(2);
  });
});

describe("loading the waveform", () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    points: [1, 2, 3],
    points_per_second: 12,
    equalizer: [4, 5],
    equalizer_points_per_second: 10,
    equalizer_band_count: 24,
    is_calculating: false,
    ...over,
  });

  test("a waveform that is ready is handed over and nothing is polled", async () => {
    recordingWaveform.mockResolvedValue(answer());
    const complete = vi.fn();

    await player.loadWaveform("r1", complete);

    expect(recordingWaveform).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({
      points: [1, 2, 3],
      pointsPerSecond: 12,
      equalizer: [4, 5],
      equalizerPointsPerSecond: 10,
      equalizerBandCount: 24,
    });
  });

  test("while ffmpeg is still working it asks again", async () => {
    vi.useFakeTimers();
    recordingWaveform
      .mockResolvedValueOnce(answer({ points: [], equalizer: [], is_calculating: true }))
      .mockResolvedValueOnce(answer());
    const complete = vi.fn();

    const loading = player.loadWaveform("r1", complete);
    await vi.advanceTimersByTimeAsync(1600);
    await loading;

    expect(recordingWaveform).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test("navigating away stops it between attempts", async () => {
    vi.useFakeTimers();
    recordingWaveform.mockResolvedValue(
      answer({ points: [], equalizer: [], is_calculating: true })
    );
    let gone = false;

    const loading = player.loadWaveform("r1", vi.fn(), () => gone);
    await vi.advanceTimersByTimeAsync(1600);
    gone = true;
    await vi.advanceTimersByTimeAsync(5000);
    await loading;

    // Two: the one before it was left and the one already in flight. What
    // matters is that it stopped rather than running for three minutes.
    expect(recordingWaveform.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test("a backend error ends it rather than retrying for three minutes", async () => {
    recordingWaveform.mockRejectedValue(new Error("no such recording"));
    const complete = vi.fn();

    await player.loadWaveform("r1", complete);

    expect(recordingWaveform).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("reading the equalizer at a moment", () => {
  /** Two frames, three bands: the first silent, the second at full. */
  const waveform = {
    points: [],
    pointsPerSecond: 12,
    equalizer: [0, 0, 0, 255, 255, 255],
    equalizerPointsPerSecond: 10,
    equalizerBandCount: 3,
  };

  test("a moment between two frames is read from both", () => {
    // 0.05 s at ten frames a second is halfway into the first frame.
    expect(player.equalizerAtTime(waveform, 0.05)).toEqual([0.5, 0.5, 0.5]);
  });

  test("before the beginning and past the end it stays inside the data", () => {
    expect(player.equalizerAtTime(waveform, -10)).toEqual([0, 0, 0]);
    expect(player.equalizerAtTime(waveform, 9999)).toEqual([1, 1, 1]);
  });

  test("a recording with no equalizer gives nothing rather than throwing", () => {
    expect(player.equalizerAtTime({ ...waveform, equalizer: [] }, 1)).toEqual([]);
    expect(player.equalizerAtTime({ ...waveform, equalizerBandCount: 0 }, 1)).toEqual([]);
  });

  test("it can be resampled for a wider or narrower player", () => {
    expect(player.equalizerAtTime(waveform, 0, 6)).toHaveLength(6);
    expect(player.equalizerAtTime(waveform, 0, 2)).toHaveLength(2);
  });
});
