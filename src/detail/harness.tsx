/**
 * The transcript screen, mounted for a test, and the few ways of asking it a
 * question that more than one test needs.
 *
 * Separate from `fixtures.ts` because this file imports `Detail`, and `Detail`
 * imports the modules the tests replace. A `vi.mock` factory must therefore
 * never reach for this one — it takes `fixtures.ts` instead, which imports
 * nothing of the application.
 *
 * Everything here renders the whole screen rather than a part of it. That is
 * the point: these tests are being written so that the state inside `Detail`
 * can move into hooks and components without them changing, and a test that
 * knew which component held what would have to be rewritten by the very work
 * it exists to protect.
 */
import type { ComponentProps } from "react";
import { act, render, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import Detail from "../Detail";
import { I18nProvider } from "../i18n";
import { PlayerProvider } from "../player";
import { RecorderProvider } from "../recorder";
import { enCommon } from "../locales/en/common";
import { enDetail } from "../locales/en/detail";
import type { AiOutput } from "../types";
import { RECORDING_ID, aiDocument, aiEditStatus, listeners } from "./fixtures";

/** The English wording of a key, which is what a query looks for. Czech is the
 *  source language, but the tests read in the language they are written in. */
export const say = (key: keyof typeof enDetail) => enDetail[key]!;
export const sayCommon = (key: keyof typeof enCommon) => enCommon[key]!;

type DetailProps = ComponentProps<typeof Detail>;

/** Mounts the screen. Pass only the props a test actually cares about; the
 *  rest are the quiet defaults of a finished recording opened from the
 *  archive. */
export function show(over: Partial<DetailProps> = {}) {
  return render(
    <I18nProvider>
      <PlayerProvider>
        <RecorderProvider>
          <Detail
            id={RECORDING_ID}
            seekTime={null}
            liveSegments={[]}
            onBack={vi.fn()}
            onNew={vi.fn()}
            onOpenRecorder={vi.fn()}
            onOpenRecording={vi.fn()}
            onExportAudio={vi.fn()}
            folders={[]}
            onMoveToFolder={vi.fn()}
            onCreateFolderFor={vi.fn()}
            onSettings={vi.fn()}
            onError={vi.fn()}
            onInfo={vi.fn()}
            onToModule={vi.fn()}
            onTranscribe={vi.fn().mockResolvedValue(true)}
            onDiarize={vi.fn()}
            diarizing={false}
            {...over}
          />
        </RecorderProvider>
      </PlayerProvider>
    </I18nProvider>
  );
}

/** The transcript is drawn word by word, so that the word being played can be
 *  lit on its own — which means no single element holds a whole sentence.
 *  Waiting on the rendered text of the screen is the honest way to ask whether
 *  the transcript arrived. */
export async function transcriptShown(container: HTMLElement, word = "začneme") {
  await waitFor(() => expect(container.textContent).toContain(word));
}

/** The sidebar's sections each carry an `Add`, so a query has to say which
 *  section it means. Scoped by the heading rather than by position, so
 *  reordering the sidebar does not quietly point this at the speakers. */
export function sidebarSection(container: HTMLElement, heading: string) {
  const sections = [...container.querySelectorAll("section.sidebar-section")];
  const section = sections.find((s) => s.textContent?.startsWith(heading));
  if (!section) throw new Error(`the ${heading} section is not on the screen`);
  return within(section as HTMLElement);
}

export function notes(container: HTMLElement) {
  return sidebarSection(container, say("detail.notes.heading"));
}

/** The application's own way in: the model reports it has finished, and the
 *  screen fetches the result and opens the preview over it. */
export async function finishAiRun(outputs: AiOutput[]) {
  aiEditStatus.mockResolvedValue({
    document: aiDocument(),
    outputs,
    custom: [],
    running: false,
    progress: null,
  });
  await act(async () => {
    listeners.get("ai-edit:progress")?.({
      payload: {
        recording_id: RECORDING_ID,
        phase: "complete",
        percent: 100,
        description: { code: "ai.done" },
      },
    });
  });
}

/** The state every test of this screen starts from: no run going, no handler
 *  left over from the test before. */
export function resetScreen() {
  listeners.clear();
  aiEditStatus.mockReset();
  aiEditStatus.mockResolvedValue({
    document: null,
    outputs: [],
    custom: [],
    running: false,
    progress: null,
  });
}
