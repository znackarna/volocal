// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.fn<() => Promise<string[]>>();

vi.mock("../api", () => ({
  api: { transcriptionsElsewhere: () => held() },
}));

import { useCommandLineRuns } from "./useCommandLineRuns";

describe("useCommandLineRuns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    held.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays empty and reloads nothing while no command line runs", async () => {
    held.mockResolvedValue([]);
    const reload = vi.fn();
    const { result } = renderHook(() => useCommandLineRuns(reload));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.size).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when a run starts in the terminal and again when it ends", async () => {
    held.mockResolvedValue(["rec-1"]);
    const reload = vi.fn();
    const { result } = renderHook(() => useCommandLineRuns(reload));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect([...result.current]).toEqual(["rec-1"]);
    expect(reload).toHaveBeenCalledTimes(1);

    const first = result.current;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current).toBe(first);
    expect(reload).toHaveBeenCalledTimes(1);

    held.mockResolvedValue([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.size).toBe(0);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("keeps quiet when the backend cannot answer", async () => {
    held.mockRejectedValue(new Error("gone"));
    const reload = vi.fn();
    const { result } = renderHook(() => useCommandLineRuns(reload));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(result.current.size).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });
});
