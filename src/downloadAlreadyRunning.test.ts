import { describe, expect, test } from "vitest";
import { alreadyRunning } from "./SetupWizard";
import { messageCode } from "./messages";

/** The refusal that is not a failure.
 *
 *  One download runs at a time and the backend says so by refusing the second
 *  call. On the setup screen that refusal was being drawn as a red *Stahování
 *  selhalo* over a download that was running perfectly well — and it took the
 *  progress view down with it, so the answer to "is anything happening?" was a
 *  screen saying no while the answer was yes.
 *
 *  What these pin is the code, because the code is the only stable half. The
 *  sentence is translated and the detail is technical; rename
 *  `download.already_running` in `downloads.rs` without renaming it here and
 *  the fright comes back with nothing failing anywhere.
 */
describe("a second download while one is running", () => {
  test("is recognised as the refusal it is", () => {
    expect(alreadyRunning({ code: "download.already_running", params: {}, detail: "" })).toBe(true);
  });

  test("is recognised without the parts a refusal does not carry", () => {
    // Rust sends params and detail, but nothing here reads them, and a message
    // that arrived without them is still the same answer.
    expect(alreadyRunning({ code: "download.already_running" })).toBe(true);
  });

  test("a real failure is still a real failure", () => {
    // The one this incident started with: gyan.dev had deleted the archive the
    // catalogue pinned, and that must go on being shown.
    expect(alreadyRunning({ code: "download.rejected", detail: "404" })).toBe(false);
    expect(alreadyRunning({ code: "download.connection_failed" })).toBe(false);
  });

  test("and neither is anything that is not a message at all", () => {
    for (const notAMessage of [null, undefined, "download.already_running", 7, {}, []]) {
      expect(alreadyRunning(notAMessage), String(notAMessage)).toBe(false);
    }
  });

  test("the code is read off the shape Rust sends and nothing else", () => {
    expect(messageCode({ code: "a.b", params: {}, detail: "" })).toBe("a.b");
    expect(messageCode({ message: "a.b" })).toBeNull();
    expect(messageCode("a.b")).toBeNull();
    expect(messageCode(null)).toBeNull();
  });
});
