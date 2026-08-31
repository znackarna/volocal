// @vitest-environment jsdom
/**
 * The quiet half of a broken window, over the report of 31 August: the
 * microphone drew its peaks, the record button did nothing, and there was no
 * message, no crash screen and nothing in the log.
 *
 * React routes a throw during render to `ErrorBoundary` and a throw inside an
 * event handler to `window.onerror` — where this application had no listener,
 * so it went nowhere. What is pinned here is that it no longer does.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const noteCrash = vi.fn();

vi.mock("./api", () => ({
  api: { noteCrash: (message: string, stack: string) => noteCrash(message, stack) },
}));

import { keepUncaughtErrors } from "./crashlog";

beforeEach(() => {
  vi.clearAllMocks();
  noteCrash.mockResolvedValue(undefined);
  keepUncaughtErrors();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** jsdom dispatches these as ordinary events, which is what the browser does
 *  too — the listener is the whole mechanism being tested. */
function raise(error: unknown) {
  const event = new Event("error") as ErrorEvent & { error?: unknown };
  event.error = error;
  window.dispatchEvent(event);
}

function reject(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason?: unknown };
  (event as { reason?: unknown }).reason = reason;
  window.dispatchEvent(event);
}

describe("what nothing else catches", () => {
  test("an uncaught error reaches the log, with its stack", () => {
    raise(new Error("a wheel came off"));

    expect(noteCrash).toHaveBeenCalledTimes(1);
    const [message, stack] = noteCrash.mock.calls[0];
    expect(message).toContain("uncaught");
    expect(message).toContain("a wheel came off");
    expect(stack).toContain("crashlog.test");
  });

  test("a rejected promise nobody handled reaches it too", () => {
    reject(new Error("the backend said no"));

    expect(noteCrash).toHaveBeenCalledTimes(1);
    expect(noteCrash.mock.calls[0][0]).toContain("unhandled rejection");
    expect(noteCrash.mock.calls[0][0]).toContain("the backend said no");
  });

  /** A failed resource load and a cross-origin script arrive with no `error`
   *  at all. The line is worth keeping anyway. */
  test("something thrown that is not an Error is still written down", () => {
    raise("just a string");

    expect(noteCrash).toHaveBeenCalledTimes(1);
    expect(noteCrash.mock.calls[0][0]).toContain("just a string");
  });

  /** This runs while something has already gone wrong. A reporter that threw
   *  would replace the fault with itself. */
  test("a log that cannot be written does not throw in turn", () => {
    noteCrash.mockRejectedValue(new Error("no backend"));

    expect(() => raise(new Error("a wheel came off"))).not.toThrow();
  });
});
