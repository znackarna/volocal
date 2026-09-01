// @vitest-environment jsdom
/**
 * A document made by the language model goes old when the transcript under it
 * changes.
 *
 * The names and the words are *in* that document, so a correction or a renamed
 * speaker makes it a statement about a transcript that no longer exists. The
 * window says so, and the header's export menu stops offering it as the
 * finished thing.
 *
 * These are regression tests. Splitting the screen apart left the three
 * controllers that change the transcript holding `() => ai.actions.markStale`,
 * which returns the function instead of calling it — so nothing was ever
 * marked old, and none of the 256 tests written to protect the split noticed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { conversationWithSpeakers, installBrowserStubs, setDetail } from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { finishAiRun, resetScreen, say, show, transcriptShown } from "./screen.harness";

beforeEach(() => {
  resetScreen();
  setDetail(conversationWithSpeakers());
});
afterEach(cleanup);

const stale = () => document.querySelector(".ai-preview-warning");
const aiButton = (container: HTMLElement) =>
  container.querySelector(".ai-edit-button") as HTMLButtonElement;

/** Makes a document, then puts the window away so the transcript can be
 *  reached. It opens by itself when a run finishes. */
async function withDocument(container: HTMLElement) {
  await finishAiRun([]);
  expect(await screen.findByText("Upravený přepis.")).toBeTruthy();
  // Nothing has happened to the transcript yet, so nothing is old.
  expect(stale()).toBeNull();
  fireEvent.click(screen.getByLabelText(say("detail.preview.closeLabel")));
  await waitFor(() => expect(document.querySelector(".ai-document-tabs")).toBeNull());
}

/** Opens it again to read the warning. */
async function reopen(container: HTMLElement) {
  fireEvent.click(aiButton(container));
  await screen.findByText("Upravený přepis.");
}

describe("a document made from the transcript", () => {
  test("goes old when a block is rewritten", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await withDocument(container);

    const block = container.querySelector("#segment-s3") as HTMLElement;
    fireEvent.doubleClick(block);
    const editor = await waitFor(() => {
      const found = block.querySelector("textarea");
      if (!found) throw new Error("the block is not open yet");
      return found;
    });
    fireEvent.change(editor, { target: { value: "První je rozvaha." } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await reopen(container);
    await waitFor(() => expect(stale()).not.toBeNull());
  });

  test("goes old when a speaker is renamed", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await withDocument(container);

    const field = await waitFor(() => {
      const found = [...container.querySelectorAll(".speaker-list li input")].find(
        (f) => (f as HTMLInputElement).value === "Jana"
      );
      if (!found) throw new Error("the speakers are not drawn yet");
      return found as HTMLInputElement;
    });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Jana Nová" } });
    fireEvent.blur(field, { target: { value: "Jana Nová" } });

    await reopen(container);
    await waitFor(() => expect(stale()).not.toBeNull());
  });

  test("goes old when a speaker is removed", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await withDocument(container);

    // `Petr` owns a block, so the removal asks first.
    const row = [...container.querySelectorAll(".speaker-list li")].find(
      (li) => (li.querySelector("input") as HTMLInputElement | null)?.value === "Petr"
    ) as HTMLElement;
    fireEvent.click(row.querySelector(".speaker-remove") as HTMLElement);

    const dialog = (await screen.findByText(say("detail.speakers.removeTitle")))
      .closest(".dialog") as HTMLElement;
    fireEvent.click(
      [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent === say("detail.speakers.removeConfirm")
      )!
    );

    await reopen(container);
    await waitFor(() => expect(stale()).not.toBeNull());
  });
});
