// @vitest-environment jsdom
/**
 * Who said which part, from the sidebar and from the block itself.
 *
 * Written before speaker management moves out of `Detail.tsx`. This is the
 * second whole feature the split lifts and the harder one: the voices, the
 * blocks they own, the shortlist of names waiting to be used, and the merge
 * that happens when two voices are given the same name are all one another's
 * state.
 *
 * Two rules here were paid for and are easy to lose in a move.
 *
 * A name is saved when the field is left, not while it is being typed. Writing
 * `Pavel` used to be five calls to the backend, five database writes, and five
 * times marking the improved document stale.
 *
 * Removing a voice asks only when there is something to lose. A voice added by
 * a slip of the hand owns no blocks and carries a placeholder name, and a
 * dialog about that is in the way.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  RECORDING_ID,
  api,
  conversationWithSpeakers,
  installBrowserStubs,
  setDetail,
  speaker,
} from "./screen.fixtures";

vi.mock("@tauri-apps/api/event", async () => (await import("./screen.fixtures")).eventMock());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("../api", async () => (await import("./screen.fixtures")).apiMock());

installBrowserStubs();

import { resetScreen, say, show, transcriptShown } from "./screen.harness";

beforeEach(() => {
  resetScreen();
  setDetail(conversationWithSpeakers());
});
afterEach(cleanup);

/** The row of the voice carrying this name, which is where every control for
 *  that voice lives. */
function voiceRow(container: HTMLElement, name: string) {
  const rows = [...container.querySelectorAll(".speaker-list li")];
  const row = rows.find(
    (li) => (li.querySelector("input") as HTMLInputElement | null)?.value === name
  );
  if (!row) throw new Error(`no voice named ${name} is on the screen`);
  return row as HTMLElement;
}

const nameField = (container: HTMLElement, name: string) =>
  voiceRow(container, name).querySelector("input") as HTMLInputElement;

/** Waits for the sidebar to have drawn the voices at all. */
async function speakersShown(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll(".speaker-list li").length).toBe(2));
}

describe("the speakers of a recording", () => {
  test("each voice is listed with its share of the transcript", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await speakersShown(container);

    // Three blocks of four to the first voice, one to the second.
    expect(voiceRow(container, "Jana").querySelector(".speaker-share")?.textContent).toBe("75 %");
    expect(voiceRow(container, "Petr").querySelector(".speaker-share")?.textContent).toBe("25 %");
  });

  test("a name is written back when the field is left, not while it is typed", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await speakersShown(container);

    const field = nameField(container, "Jana");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "J" } });
    fireEvent.change(field, { target: { value: "Ja" } });
    fireEvent.change(field, { target: { value: "Jana Nová" } });

    // Three keystrokes, no writes.
    expect(api.renameSpeaker).not.toHaveBeenCalled();

    fireEvent.blur(field, { target: { value: "Jana Nová" } });
    await waitFor(() =>
      expect(api.renameSpeaker).toHaveBeenCalledWith(RECORDING_ID, "SPEAKER_00", "Jana Nová")
    );
    expect(api.renameSpeaker).toHaveBeenCalledTimes(1);
  });

  test("leaving a name untouched writes nothing", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await speakersShown(container);

    const field = nameField(container, "Jana");
    fireEvent.focus(field);
    fireEvent.blur(field, { target: { value: "Jana" } });

    expect(api.renameSpeaker).not.toHaveBeenCalled();
  });

  test("Enter leaves the field, which is what saves", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await speakersShown(container);

    const field = nameField(container, "Petr");
    // Really focused, not a synthetic focus event: Enter asks the field to
    // blur itself, and an element that never held focus does not blur.
    field.focus();
    fireEvent.change(field, { target: { value: "Petr Malý" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(api.renameSpeaker).toHaveBeenCalledWith(RECORDING_ID, "SPEAKER_01", "Petr Malý")
    );
  });

  test("removing a voice that owns nothing does not ask", async () => {
    // The slip of the hand: a voice added and immediately taken back. It holds
    // a placeholder name and no blocks, and a dialog about that is in the way.
    setDetail({
      ...conversationWithSpeakers(),
      speakers: [
        speaker({ key: "SPEAKER_00", name: "Jana" }),
        speaker({ key: "SPEAKER_01", name: "Petr", color: "#9ece6a" }),
        speaker({ key: "SPEAKER_02", name: "Mluvčí 3", color: "#e0af68" }),
      ],
    });
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await waitFor(() => expect(container.querySelectorAll(".speaker-list li").length).toBe(3));

    fireEvent.click(
      within(voiceRow(container, "Mluvčí 3")).getByLabelText(say("detail.speakers.remove"))
    );

    await waitFor(() =>
      expect(api.deleteSpeaker).toHaveBeenCalledWith(RECORDING_ID, "SPEAKER_02")
    );
    expect(screen.queryByText(say("detail.speakers.removeTitle"))).toBeNull();
  });

  test("removing a voice that owns blocks asks first", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await speakersShown(container);

    fireEvent.click(
      within(voiceRow(container, "Petr")).getByLabelText(say("detail.speakers.remove"))
    );

    expect(api.deleteSpeaker).not.toHaveBeenCalled();
    expect(await screen.findByText(say("detail.speakers.removeTitle"))).toBeTruthy();
  });

  test("a block is given to another voice from its own menu", async () => {
    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await speakersShown(container);

    // The third block belongs to Petr, so the menu offers Jana and somebody
    // new — never the voice that already has it.
    fireEvent.contextMenu(container.querySelector("#segment-s3") as HTMLElement);
    fireEvent.click(await screen.findByText(say("detail.menu.toSpeaker")));

    // The name of the voice that already has this block is not among the
    // answers. Asked of the menu, because `Petr` also labels the block itself.
    const menu = document.querySelector(".context-menu") as HTMLElement;
    expect(within(menu).queryByText("Petr")).toBeNull();
    fireEvent.click(within(menu).getByText("Jana"));

    await waitFor(() => expect(api.setSegmentSpeaker).toHaveBeenCalledWith("s3", "SPEAKER_00"));
  });

  test("a block can go to somebody the machine never found", async () => {
    api.addSpeaker.mockResolvedValue(speaker({ key: "SPEAKER_09", name: "Mluvčí 3" }));

    const { container } = show();
    await transcriptShown(container, "rozpočet");
    await speakersShown(container);

    fireEvent.contextMenu(container.querySelector("#segment-s3") as HTMLElement);
    fireEvent.click(await screen.findByText(say("detail.menu.toSpeaker")));
    fireEvent.click(await screen.findByText(say("detail.menu.newSpeaker")));

    await waitFor(() => expect(api.addSpeaker).toHaveBeenCalledWith(RECORDING_ID));
    await waitFor(() => expect(api.setSegmentSpeaker).toHaveBeenCalledWith("s3", "SPEAKER_09"));
  });
});
