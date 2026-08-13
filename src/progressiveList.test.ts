// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { FIRST_BLOCKS, useProgressiveList } from "./progressiveList";

/** Drawing a long transcript in two goes rather than one.
 *
 *  The rule worth holding is not "it is faster" — that is the reason, not the
 *  behaviour. It is that everything is drawn in the end, that nothing is drawn
 *  twice over, and that a short list never waits for a second drawing it does
 *  not need.
 */
describe("drawing a long list", () => {
  test("a list that fits is drawn whole, with no second drawing", () => {
    const { result } = renderHook(() => useProgressiveList(12));
    expect(result.current).toBe(12);
  });

  test("a long one starts at the first screenful and then arrives entire", async () => {
    const { result } = renderHook(() => useProgressiveList(359));
    expect(result.current).toBe(FIRST_BLOCKS);
    await waitFor(() => expect(result.current).toBe(359));
  });

  test("nothing is ever drawn past the end of the list", async () => {
    const { result, rerender } = renderHook(({ total }) => useProgressiveList(total), {
      initialProps: { total: 359 },
    });
    await waitFor(() => expect(result.current).toBe(359));
    // An edit that removes blocks must not leave the count above the list.
    rerender({ total: 5 });
    expect(result.current).toBe(5);
  });

  /** The list arrives empty and is filled once the archive answers, so the
   *  first render is always of nothing at all. */
  test("a list that has not arrived yet asks for nothing", () => {
    const { result } = renderHook(() => useProgressiveList(0));
    expect(result.current).toBe(0);
  });

  test("a list that grows past the first screenful catches up", async () => {
    const { result, rerender } = renderHook(({ total }) => useProgressiveList(total), {
      initialProps: { total: 0 },
    });
    expect(result.current).toBe(0);
    act(() => rerender({ total: 200 }));
    await waitFor(() => expect(result.current).toBe(200));
  });
});
