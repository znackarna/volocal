// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { SegmentRow } from "./corrections";
import type { Segment } from "../types";

afterEach(cleanup);

/** A transcript block with word timings, the way the archive stores them. */
function block(words: Array<[number, string]>): Segment {
  return {
    id: "s1",
    recording_id: "r1",
    order: 0,
    start: words[0][0],
    end: words[words.length - 1][0] + 1,
    text: words.map(([, s]) => s).join(" "),
    speakers: null,
    confidence: 1,
    edited: false,
    verified: false,
    words: JSON.stringify(words.map(([t, s]) => ({ t, s }))),
    original: null,
  };
}

function show(segment: Segment) {
  const nothing = vi.fn();
  return render(
    <I18nProvider>
      <SegmentRow
        segment={segment}
        active={false}
        time={0}
        editing={false}
        onSeek={nothing}
        onStartUpravu={nothing}
        onConfirm={nothing}
        onSave={nothing}
        onContextMenu={nothing}
      />
    </I18nProvider>
  );
}

/** How much of the window a transcript costs to draw.
 *
 *  Every word is its own element, because every word is clickable and carries
 *  its own moment. The spaces between them are not, and used to be: that
 *  doubled the element count of every transcript in the archive for nothing.
 *  A forty-five minute recording here is 6845 words.
 */
describe("what a transcript block puts in the document", () => {
  const words: Array<[number, string]> = [
    [1, "A"],
    [1.2, "to"],
    [1.5, "téma"],
    [2, "je"],
    [2.4, "věrnost"],
  ];

  test("one element per word and not one per gap between them", () => {
    const { container } = show(block(words));
    const text = container.querySelector(".segment-text")!;
    // The paragraph's element children are the words themselves, nothing else.
    expect(text.children.length).toBe(words.length);
    expect(text.querySelectorAll(".word").length).toBe(words.length);
  });

  test("and the words still read as a sentence, spaces and all", () => {
    const { container } = show(block(words));
    const text = container.querySelector(".segment-text")!;
    expect(text.textContent).toBe("A to téma je věrnost");
  });

  test("every word keeps the moment the context menu reads off it", () => {
    const { container } = show(block(words));
    const times = [...container.querySelectorAll(".word")].map((w) =>
      w.getAttribute("data-time")
    );
    expect(times).toHaveLength(words.length);
    for (const time of times) expect(time).not.toBeNull();
  });

  /** A block edited by hand has no stored timings, and the fallback splits the
   *  text itself. It goes through the same rendering, so it must not start
   *  making elements out of the gaps again. */
  test("a block with no stored timings costs the same", () => {
    const edited = { ...block(words), words: null };
    const { container } = show(edited);
    const text = container.querySelector(".segment-text")!;
    expect(text.querySelectorAll(".word").length).toBe(words.length);
    expect(text.children.length).toBe(words.length);
    expect(text.textContent).toBe("A to téma je věrnost");
  });
});
