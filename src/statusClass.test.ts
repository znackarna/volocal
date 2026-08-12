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
  test("the stored Czech values are what the map is keyed on", () => {
    // These four strings are in every archive on disk. If one is renamed here
    // without a migration, the dot silently stops matching that recording.
    expect(Object.keys(STATUS_CLASS).sort()).toEqual([
      "chyba",
      "hotova",
      "nova",
      "prepisuje",
    ]);
  });

  test("a finished transcript is green, which is the one that went grey", () => {
    expect(statusClass("hotova")).toBe("done");
  });

  test("something the archive has never written asks for no class at all", () => {
    // Better a dot with the default look than a class name invented from data.
    expect(statusClass("something-else")).toBe("");
  });

  test("every class the map names is painted by the stylesheet", () => {
    const css = readFileSync("src/css/02-knihovna.css", "utf8");
    for (const [status, className] of Object.entries(STATUS_CLASS)) {
      expect(
        css.includes(`.status-mark.${className}`),
        `${status} maps to .${className}, which no rule paints`
      ).toBe(true);
    }
  });
});
