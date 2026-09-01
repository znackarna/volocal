// @vitest-environment jsdom
/**
 * Finding a word in the transcript.
 *
 * Written before `finding`, `findQuery` and `findAt` move out of `Detail.tsx`
 * into a hook of their own. Nothing here names a hook or a component: every
 * test opens the whole screen and asks it what a reader would ask it, so the
 * move that follows can be judged by whether these still pass.
 *
 * The pair worth watching is `finding` and `findQuery`. They are two pieces of
 * state today and the bar closing resets both — a reader who closes the bar
 * and opens it again gets an empty field, not their last search. Split them
 * between two owners and that stops being true without anything failing to
 * compile.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { conversation, installBrowserStubs, setDetail } from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { resetScreen, say, sayCommon, show, transcriptShown } from "./screen.harness";

beforeEach(() => {
  resetScreen();
  // Four sentences, two of which say `porada` in some case of the word.
  setDetail(conversation());
});
afterEach(cleanup);

/** The toolbar button that raises the bar, which is also the button that puts
 *  it away again. */
const findButton = () => screen.getByLabelText(say("detail.find.open"));
const field = () => screen.getByPlaceholderText(say("detail.find.placeholder"));
const count = () => document.querySelector(".search-count")?.textContent ?? "";

/** Opens the bar and types, which is the only way the screen is ever asked to
 *  search. `porada` is declined in the transcript, so the search is for the
 *  stem both sentences share. */
async function searchFor(text: string) {
  fireEvent.click(findButton());
  const input = await screen.findByPlaceholderText(say("detail.find.placeholder"));
  fireEvent.change(input, { target: { value: text } });
  return input;
}

describe("finding a word in the transcript", () => {
  test("the toolbar button opens the bar and closes it again", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    expect(screen.queryByPlaceholderText(say("detail.find.placeholder"))).toBeNull();
    expect(findButton().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(findButton());
    expect(await screen.findByPlaceholderText(say("detail.find.placeholder"))).toBeTruthy();
    expect(findButton().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(findButton());
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(say("detail.find.placeholder"))).toBeNull()
    );
  });

  test("the bar's own close button puts it away", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    fireEvent.click(findButton());
    const bar = (await screen.findByPlaceholderText(say("detail.find.placeholder")))
      .closest(".search-transcript") as HTMLElement;

    fireEvent.click(
      [...bar.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === sayCommon("common.close")
      )!
    );
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(say("detail.find.placeholder"))).toBeNull()
    );
  });

  test("closing forgets the search, so the bar opens empty", async () => {
    // The invariant the split has to keep. Whether the bar is up and what is
    // written in it are separate state, and closing resets both together.
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    await searchFor("porad");
    expect((field() as HTMLInputElement).value).toBe("porad");

    fireEvent.click(findButton());
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(say("detail.find.placeholder"))).toBeNull()
    );

    fireEvent.click(findButton());
    const again = await screen.findByPlaceholderText(say("detail.find.placeholder"));
    expect((again as HTMLInputElement).value).toBe("");
  });

  test("the count says which hit of how many, and starts on the first", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    await searchFor("porad");
    await waitFor(() => expect(count()).toBe("1 of 2"));
  });

  test("one letter is not a search", async () => {
    // Two characters is the floor. Below it the screen has no hits, shows no
    // count, and both arrows are dead — a state easy to lose by moving the
    // needle and the hits into different owners.
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    await searchFor("p");
    expect(count()).toBe("");
    expect((screen.getByLabelText(say("detail.find.next")) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText(say("detail.find.previous")) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test("a search with nothing behind it says nought of nought", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    await searchFor("vodopád");
    await waitFor(() => expect(count()).toBe("0 of 0"));
    expect((screen.getByLabelText(say("detail.find.next")) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the arrows move between hits and come round again", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    await searchFor("porad");
    await waitFor(() => expect(count()).toBe("1 of 2"));

    fireEvent.click(screen.getByLabelText(say("detail.find.next")));
    expect(count()).toBe("2 of 2");

    // Past the last one is the first one, not a stop.
    fireEvent.click(screen.getByLabelText(say("detail.find.next")));
    expect(count()).toBe("1 of 2");

    // And backwards from the first is the last.
    fireEvent.click(screen.getByLabelText(say("detail.find.previous")));
    expect(count()).toBe("2 of 2");
  });

  test("Enter moves forward and Shift+Enter back", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const input = await searchFor("porad");
    await waitFor(() => expect(count()).toBe("1 of 2"));

    fireEvent.keyDown(input, { key: "Enter" });
    expect(count()).toBe("2 of 2");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(count()).toBe("1 of 2");
  });

  test("a new query goes back to the first hit", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    const input = await searchFor("porad");
    await waitFor(() => expect(count()).toBe("1 of 2"));
    fireEvent.click(screen.getByLabelText(say("detail.find.next")));
    expect(count()).toBe("2 of 2");

    // Typing again must not leave the cursor on the second hit of a search
    // that no longer has one.
    fireEvent.change(input, { target: { value: "body" } });
    await waitFor(() => expect(count()).toBe("1 of 1"));
  });

  test("the hit is marked in the transcript, and only one of them", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    await searchFor("porad");
    await waitFor(() => expect(count()).toBe("1 of 2"));

    // Two sentences match, but only the one being read carries `found`, and
    // it is the first of them. The cursor and the hits are separate state and
    // this is where they have to agree.
    await waitFor(() => expect(container.querySelectorAll(".segment.found").length).toBe(1));
    expect(container.querySelector(".segment.found")?.id).toBe("segment-s1");

    fireEvent.click(screen.getByLabelText(say("detail.find.next")));
    expect(container.querySelectorAll(".segment.found").length).toBe(1);
    expect(container.querySelector(".segment.found")?.id).toBe("segment-s4");
  });

  test("Ctrl+F opens the bar and Escape closes it", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    // On the body, because that is where a press with nothing focused lands.
    // `window` is not an element and the screen asks its target what it sits
    // inside of.
    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
    const input = await screen.findByPlaceholderText(say("detail.find.placeholder"));

    fireEvent.change(input, { target: { value: "porad" } });
    await waitFor(() => expect(count()).toBe("1 of 2"));

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(say("detail.find.placeholder"))).toBeNull()
    );
  });
});
