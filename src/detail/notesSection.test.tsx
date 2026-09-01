// @vitest-environment jsdom
/**
 * Notes on a recording, from the sidebar.
 *
 * Written before the notes move out of `Detail.tsx` into a controller of their
 * own. They are the first whole feature to be lifted, and they are a good
 * first one precisely because they have every part: their own data, a draft
 * that is not data yet, four ways to change a saved note, and a rule about
 * destroying one.
 *
 * `notes.test.ts` beside this file tests the sorting and the time parsing on
 * their own. Nothing here repeats that. These are about the screen: what a
 * person clicks, and what the backend is asked to do about it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { RECORDING_ID, api, conversation, detailData, installBrowserStubs, note, recording, setDetail } from "./fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./fixtures")).apiMock());

installBrowserStubs();

import { notes, resetScreen, say, show, transcriptShown } from "./harness";

beforeEach(resetScreen);
afterEach(cleanup);

const composer = () => screen.getByPlaceholderText(say("detail.notes.placeholder"));

/** The composer's own save. `Uložit` is written on more than one button on
 *  this screen, so the query says which one it means. */
const saveNote = (container: HTMLElement) =>
  container.querySelector(".sticky-confirm") as HTMLButtonElement;

/** Opens the composer and writes in it, which is the only way a note is ever
 *  begun. */
async function writeNote(container: HTMLElement, text: string) {
  fireEvent.click(notes(container).getByText(say("detail.notes.add")));
  const field = await screen.findByPlaceholderText(say("detail.notes.placeholder"));
  fireEvent.change(field, { target: { value: text } });
  return field;
}

/** A recording that already carries one note, so the tests about changing and
 *  removing one have something to change. */
function withOneNote(over = {}) {
  setDetail(
    detailData({
      ...conversation(),
      recording: recording({ duration: 60, segment_count: 4 }),
      notes: [note(over)],
    })
  );
}

describe("notes on a recording", () => {
  test("an empty section says so", async () => {
    const { container } = show();
    await transcriptShown(container);

    expect(notes(container).getByText(say("detail.notes.empty"))).toBeTruthy();
  });

  test("a note is written, saved, and shown", async () => {
    const { container } = show();
    await transcriptShown(container);

    api.addRecordingNote.mockResolvedValue(note({ text: "Ozvat se Janě." }));
    await writeNote(container, "Ozvat se Janě.");

    fireEvent.click(saveNote(container));

    // The recording it belongs to, the moment it is pinned to — none, because
    // nothing pinned it — and the text, trimmed.
    await waitFor(() =>
      expect(api.addRecordingNote).toHaveBeenCalledWith(RECORDING_ID, null, "Ozvat se Janě.")
    );
    expect(await screen.findByText("Ozvat se Janě.")).toBeTruthy();

    // The composer is put away once the note is real.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(say("detail.notes.placeholder"))).toBeNull()
    );
  });

  test("an empty note cannot be saved", async () => {
    const { container } = show();
    await transcriptShown(container);

    fireEvent.click(notes(container).getByText(say("detail.notes.add")));
    await screen.findByPlaceholderText(say("detail.notes.placeholder"));

    expect(saveNote(container).disabled).toBe(true);

    // Spaces are not a note either.
    fireEvent.change(composer(), { target: { value: "   " } });
    expect(saveNote(container).disabled).toBe(true);

    fireEvent.change(composer(), { target: { value: "a" } });
    expect(saveNote(container).disabled).toBe(false);
  });

  test("Ctrl+Enter saves without reaching for the button", async () => {
    const { container } = show();
    await transcriptShown(container);

    api.addRecordingNote.mockResolvedValue(note({ text: "Krátká poznámka." }));
    const field = await writeNote(container, "Krátká poznámka.");

    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(api.addRecordingNote).toHaveBeenCalledWith(RECORDING_ID, null, "Krátká poznámka.")
    );
  });

  test("a saved note opens for editing and saves on leaving it", async () => {
    withOneNote();
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    // Closed, the whole note is the button that opens it.
    const opener = await notes(container).findByText("Ověřit rozpočet.");
    fireEvent.click(opener);

    const editor = notes(container).getByRole("textbox") as HTMLTextAreaElement;
    expect(editor.value).toBe("Ověřit rozpočet.");

    fireEvent.change(editor, { target: { value: "Ověřit rozpočet do pátku." } });
    // Attention moving away is what commits it; there is no save button on an
    // open note.
    fireEvent.blur(editor);

    await waitFor(() =>
      expect(api.updateRecordingNote).toHaveBeenCalledWith("n1", null, "Ověřit rozpočet do pátku.", false)
    );
  });

  test("deleting asks first", async () => {
    // The one place in the application where text a person wrote themselves
    // used to go on a single click. The question is the product decision, and
    // it is the part a move of this state could quietly drop.
    withOneNote();
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    fireEvent.click(await notes(container).findByText("Ověřit rozpočet."));
    fireEvent.click(notes(container).getByText("Delete"));

    // Nothing has happened to the note yet.
    expect(api.deleteRecordingNote).not.toHaveBeenCalled();
    expect(await screen.findByText(say("detail.notes.deleteTitle"))).toBeTruthy();
  });

  test("and deletes once the question is answered", async () => {
    withOneNote();
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    fireEvent.click(await notes(container).findByText("Ověřit rozpočet."));
    fireEvent.click(notes(container).getByText("Delete"));

    const dialog = (await screen.findByText(say("detail.notes.deleteTitle")))
      .closest(".dialog") as HTMLElement;
    fireEvent.click(
      [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Delete")!
    );

    await waitFor(() => expect(api.deleteRecordingNote).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(notes(container).queryByText("Ověřit rozpočet.")).toBeNull());
  });

  test("a note pinned to a moment can be sent back to it", async () => {
    withOneNote({ time: 20 });
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    // A pinned note offers the way back without being opened first.
    expect(await notes(container).findByTitle(say("detail.notes.seekTitle"))).toBeTruthy();
  });

  test("an unpinned note offers the moment being played", async () => {
    withOneNote();
    const { container } = show();
    await transcriptShown(container, "rozpočet");

    fireEvent.click(await notes(container).findByText("Ověřit rozpočet."));

    // Playback has not moved, so the offer is the beginning.
    const pin = notes(container).getByText(say("detail.notes.pinAt").replace("{time}", "0:00"));
    fireEvent.click(pin);

    await waitFor(() =>
      expect(api.updateRecordingNote).toHaveBeenCalledWith("n1", 0, "Ověřit rozpočet.", false)
    );
  });
});
