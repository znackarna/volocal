// @vitest-environment jsdom
/**
 * The boundary's second job, added 27 August: a crash in the window reaches the
 * log file beside the archive.
 *
 * It had assembled the message, the stack and React's component stack, shown
 * them on screen, and stopped there — so a report of the window going white
 * arrived with a log that said nothing about the moment it went white. Half the
 * application is in here and none of its failures were being kept.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "./i18n";

const noteCrash = vi.fn();

vi.mock("./api", () => ({
  api: {
    noteCrash: (message: string, stack: string) => noteCrash(message, stack),
  },
}));

import ErrorBoundary from "./ErrorBoundary";

function Throws({ what }: { what: unknown }): never {
  throw what;
}

function show(what: unknown) {
  return render(
    <I18nProvider>
      <ErrorBoundary>
        <Throws what={what} />
      </ErrorBoundary>
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  noteCrash.mockResolvedValue(undefined);
  // React prints the caught error itself, and so does the boundary. Neither is
  // what is being tested and both would bury the run.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a crash in the window", () => {
  test("is sent to the log, with where it happened", () => {
    show(new Error("a wheel came off"));

    expect(noteCrash).toHaveBeenCalledTimes(1);
    const [message, stack] = noteCrash.mock.calls[0];
    expect(message).toContain("a wheel came off");
    // React's component stack is what says which screen it came from, and it
    // is the half a bare message cannot replace.
    expect(stack).toContain("Throws");
  });

  test("still shows the crash screen", () => {
    show(new Error("a wheel came off"));

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  /** A library that throws a string leaves no stack at all. The line is worth
   *  keeping anyway, so nothing here may depend on there being one. */
  test("is sent even when what was thrown carries no stack", () => {
    show("just a string");

    expect(noteCrash).toHaveBeenCalledTimes(1);
    expect(noteCrash.mock.calls[0][0]).toContain("just a string");
  });

  /** The window is already broken when this fires and the backend may be the
   *  reason it is. A boundary that throws while handling a throw takes the
   *  crash screen down with it and leaves the white window it exists to
   *  prevent. */
  test("does not take the crash screen down when the log cannot be written", () => {
    noteCrash.mockRejectedValue(new Error("no backend"));

    show(new Error("a wheel came off"));

    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
