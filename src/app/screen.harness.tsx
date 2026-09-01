/**
 * The application shell, mounted for a test.
 *
 * Wrapped in the three providers `main.tsx` wraps it in, and in no others: the
 * shell reads the player and the recorder, and the dictionary has to be
 * outside both.
 *
 * Imports `App`, so a `vi.mock` factory must never reach for this file. It
 * takes `screen.fixtures.ts` instead.
 */
import { act, render } from "@testing-library/react";
import App from "../App";
import { I18nProvider } from "../i18n";
import { PlayerProvider } from "../player";
import { RecorderProvider } from "../recorder";
import { enApp } from "../locales/en/app";
import { enCommon } from "../locales/en/common";
import { enLibrary } from "../locales/en/library";
import { listeners } from "./screen.fixtures";

export const say = (key: keyof typeof enApp) => enApp[key]!;
export const sayCommon = (key: keyof typeof enCommon) => enCommon[key]!;
export const sayLibrary = (key: keyof typeof enLibrary) => enLibrary[key]!;

/** The shell takes no props. Everything it knows it asks the backend for or is
 *  told by an event. */
export function show() {
  return render(
    <I18nProvider>
      <PlayerProvider>
        <RecorderProvider>
          <App />
        </RecorderProvider>
      </PlayerProvider>
    </I18nProvider>
  );
}

/** Delivers a backend event the way the backend does. Named for the stream
 *  rather than the state it changes, because that is the shell's own door and
 *  the split must not add a second one. */
export async function emit(event: string, payload: unknown) {
  await act(async () => {
    listeners.get(event)?.({ payload });
  });
}
