import { describe, expect, test } from "vitest";
import { byNoteOrder, noteTimeIsValid, parseNoteTime } from "./notes";
import type { RecordingNote } from "../types";

/** A sticky note carries a moment in the recording, and the moment can be
 *  typed by hand. Everything here is about that field and the order the notes
 *  come out in — both fail quietly. A time read wrongly sends playback
 *  somewhere else; an order read wrongly just looks like the notes moved. */

describe("parseNoteTime", () => {
  test("the three ways a moment is written all arrive at seconds", () => {
    expect(parseNoteTime("90")).toBe(90);
    expect(parseNoteTime("1:30")).toBe(90);
    expect(parseNoteTime("0:01:30")).toBe(90);
  });

  test("an hour is an hour, not sixty of something", () => {
    expect(parseNoteTime("2:03:04")).toBe(2 * 3600 + 3 * 60 + 4);
  });

  test("surrounding space is the writer's, not the field's", () => {
    expect(parseNoteTime("  4:20  ")).toBe(260);
  });

  test("sixty seconds is a minute and is refused as a seconds field", () => {
    // Refused rather than carried over: 1:60 almost always means 1:06
    // mistyped, and silently reading it as 2:00 hides that.
    expect(parseNoteTime("1:60")).toBeNull();
    expect(parseNoteTime("1:2:60")).toBeNull();
    expect(parseNoteTime("1:60:00")).toBeNull();
  });

  test("a bare number over sixty is seconds and stays legal", () => {
    expect(parseNoteTime("125")).toBe(125);
  });

  test("what is not a time comes back as nothing", () => {
    expect(parseNoteTime("")).toBeNull();
    expect(parseNoteTime("abc")).toBeNull();
    expect(parseNoteTime("1:2:3:4")).toBeNull();
    expect(parseNoteTime("-5")).toBeNull();
    expect(parseNoteTime("1:")).toBeNull();
    expect(parseNoteTime("1.5")).toBeNull();
  });
});

describe("noteTimeIsValid", () => {
  test("a moment past the end of the recording is not a moment in it", () => {
    expect(noteTimeIsValid("5:00", 120)).toBe(false);
    expect(noteTimeIsValid("1:00", 120)).toBe(true);
    expect(noteTimeIsValid("2:00", 120)).toBe(true);
  });

  test("with no known length nothing can be judged too late", () => {
    // A recording whose source is missing reports a duration of 0. The field
    // must not start rejecting everything the moment that happens.
    expect(noteTimeIsValid("99:00", 0)).toBe(true);
  });

  test("nonsense is invalid whatever the length", () => {
    expect(noteTimeIsValid("abc", 600)).toBe(false);
  });
});

describe("byNoteOrder", () => {
  const note = (over: Partial<RecordingNote>): RecordingNote =>
    ({ id: "x", recording_id: "r", text: "", time: null, created_at: "2026-01-01", ...over }) as
      RecordingNote;

  test("notes about the whole recording come before notes about a moment", () => {
    const whole = note({ time: null, created_at: "2026-02-02" });
    const moment = note({ time: 5, created_at: "2026-01-01" });
    expect(byNoteOrder(whole, moment)).toBeLessThan(0);
    expect(byNoteOrder(moment, whole)).toBeGreaterThan(0);
  });

  test("notes about a moment follow the recording, not the writing", () => {
    const later = note({ time: 300, created_at: "2026-01-01" });
    const earlier = note({ time: 10, created_at: "2026-12-31" });
    expect(byNoteOrder(earlier, later)).toBeLessThan(0);
  });

  test("two notes about the whole recording keep the order they were written", () => {
    const first = note({ time: null, created_at: "2026-01-01" });
    const second = note({ time: null, created_at: "2026-06-06" });
    expect(byNoteOrder(first, second)).toBeLessThan(0);
  });

  test("sorting a whole list gives the order the sidebar shows", () => {
    const notes = [
      note({ id: "b", time: 300, created_at: "2026-01-01" }),
      note({ id: "c", time: null, created_at: "2026-05-05" }),
      note({ id: "a", time: null, created_at: "2026-01-01" }),
      note({ id: "d", time: 10, created_at: "2026-01-01" }),
    ];
    expect([...notes].sort(byNoteOrder).map((n) => n.id)).toEqual(["a", "c", "d", "b"]);
  });
});
