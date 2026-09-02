// @vitest-environment jsdom
/**
 * The recording menu shared by the archive and the transcript header: which
 * items a recording gets depends on where it stands.
 *
 * One rule pinned here because it is the one that was wrong: naming a second
 * language is a standing instruction about the recording, so it is offered
 * before there is a transcript — where re-transcribing and transcribing in
 * another language have nothing to act on yet.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RecordingActionsMenu from "./RecordingActionsMenu";
import { I18nProvider } from "./i18n";
import { enDialogs } from "./locales/en/dialogs";

const say = (key: keyof typeof enDialogs) => enDialogs[key]!;

function menu(status: string) {
  return render(
    <I18nProvider>
      <RecordingActionsMenu
        status={status}
        onRename={vi.fn()}
        onExportAudio={vi.fn()}
        folders={[]}
        folder={null}
        language="cs"
        onMoveToFolder={vi.fn()}
        onCreateFolderFor={vi.fn()}
        onRetranscribe={vi.fn()}
        onDeleteTranscript={vi.fn()}
        onTranscribeInLanguage={vi.fn()}
        onSecondLanguage={vi.fn()}
        onRemove={vi.fn()}
      />
    </I18nProvider>
  );
}

afterEach(cleanup);

describe("the recording menu", () => {
  test("before a transcript, Languages holds only the second language", () => {
    menu("new");
    fireEvent.click(screen.getByLabelText(say("dialogs.recordingMenu.more")));
    expect(screen.queryByText(say("dialogs.recordingMenu.deleteTranscript"))).toBeNull();
    fireEvent.click(screen.getByText(say("dialogs.recordingMenu.languages")));
    expect(screen.queryByText(say("dialogs.recordingMenu.secondLanguage"))).not.toBeNull();
    expect(screen.queryByText(say("dialogs.recordingMenu.mainLanguage"))).toBeNull();
  });

  /** Two levels deep, and Back is one step. It used to jump to the top, which
   *  is what a single `submenu` slot could do; the trail is what lets a reader
   *  who opened the second language's list return to the two halves. */
  test("after a transcript both halves are there, and Back climbs one level", () => {
    menu("done");
    fireEvent.click(screen.getByLabelText(say("dialogs.recordingMenu.more")));
    fireEvent.click(screen.getByText(say("dialogs.recordingMenu.languages")));
    expect(screen.queryByText(say("dialogs.recordingMenu.mainLanguage"))).not.toBeNull();
    fireEvent.click(screen.getByText(say("dialogs.recordingMenu.secondLanguage")));
    expect(screen.queryByText(say("dialogs.recordingMenu.noSecondLanguage"))).not.toBeNull();
    // The back button carries the name of where it leads.
    fireEvent.click(screen.getByText(say("dialogs.recordingMenu.secondLanguage")));
    expect(screen.queryByText(say("dialogs.recordingMenu.mainLanguage"))).not.toBeNull();
  });

  test("offers nothing about languages while the recording is mid-run", () => {
    menu("transcribing");
    fireEvent.click(screen.getByLabelText(say("dialogs.recordingMenu.more")));
    expect(screen.queryByText(say("dialogs.recordingMenu.languages"))).toBeNull();
  });
});
