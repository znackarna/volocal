import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { STATUS_CLASS, statusClass } from "./types";

/** The dot beside a recording, and the one bug it has already had.
 *
 *  The class used to be the stored status handed straight to `className`. When
 *  the stylesheet was translated — `.hotova` became `.done` — every dot in the
 *  archive went grey and nothing failed: no build error, no test, no warning.
 *  It shipped in 1.0.5 and was found by somebody looking at the screen.
 *
 *  So the test that matters is not that the map has four entries. It is that
 *  every class the map names is a class the stylesheet actually paints.
 */
describe("the status dot", () => {
  test("the stored values are what the map is keyed on", () => {
    // These four strings are what Rust writes into `recordings.status`. If one
    // is renamed here without the migration in `db.rs`, the dot silently stops
    // matching that recording. They were Czech until schema 3.
    expect(Object.keys(STATUS_CLASS).sort()).toEqual([
      "done",
      "error",
      "new",
      "transcribing",
    ]);
  });

  test("a Czech status is unknown now, and asks for no class rather than a wrong one", () => {
    // An archive still saying `hotova` has not been through `open()`, which no
    // recording reaching this screen can avoid. If one ever did, a dot with the
    // default look is the honest answer.
    expect(statusClass("hotova")).toBe("");
  });

  test("a finished transcript is green, which is the one that went grey", () => {
    expect(statusClass("done")).toBe("done");
  });

  test("something the archive has never written asks for no class at all", () => {
    // Better a dot with the default look than a class name invented from data.
    expect(statusClass("something-else")).toBe("");
  });

  test("every class the map names is painted by the stylesheet", () => {
    // Read from disk rather than imported: vitest hands back an empty string
    // for a stylesheet, `?raw` included, because the test environment does not
    // run the CSS pipeline. Tried, and it made the check pass on nothing.
    const css = readFileSync("src/css/02-library.css", "utf8");
    for (const [status, className] of Object.entries(STATUS_CLASS)) {
      expect(
        css.includes(`.status-mark.${className}`),
        `${status} maps to .${className}, which no rule paints`
      ).toBe(true);
    }
  });
});
