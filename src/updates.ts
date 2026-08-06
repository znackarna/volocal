import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Looking for a newer version, and installing it when asked.
 *
 * The application's promise is that nothing leaves the computer, and this is
 * the one thing it does on its own initiative — so it is deliberately small:
 * one request to a static file, at most once a day, never at start-up, and
 * silent when it fails. Somebody without a connection is not in an error
 * state.
 *
 * Nothing installs by itself. The check only makes the offer; the download and
 * the restart happen when a person presses the button, and never while the
 * application is in the middle of something.
 */

/** When the last check happened, so a restart is not a reason to ask again. */
const LAST_CHECK = "update-last-check";
const DAY = 24 * 60 * 60 * 1000;

export interface UpdateOffer {
  version: string;
  /** What the release said about itself. May be empty. */
  notes: string;
  /** The handle the download needs. Not for reading. */
  handle: Update;
}

export interface UpdateDownload {
  /** 0–100, or null while the server has not said how big it is. */
  percent: number | null;
}

/**
 * Asks whether something newer exists, at most once a day.
 *
 * `force` skips the timer, for the button in Settings — somebody who asks
 * explicitly is owed an answer now.
 *
 * Returns `null` for "nothing newer" *and* for every failure: not being able
 * to reach the internet, running from `tauri dev` where there is no bundle to
 * update, an endpoint that is not there yet. None of those is the person's
 * problem and none should produce a red notice.
 */
export async function lookForUpdate(force = false): Promise<UpdateOffer | null> {
  if (!force) {
    const last = Number(localStorage.getItem(LAST_CHECK) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < DAY) return null;
  }
  try {
    const found = await check();
    // The timestamp is written on success only. A failed check should be
    // retried on the next start rather than counting as today's look.
    localStorage.setItem(LAST_CHECK, String(Date.now()));
    if (!found) return null;
    return { version: found.version, notes: found.body ?? "", handle: found };
  } catch (error) {
    // Deliberately quiet. See the note at the top of this file.
    console.info("update check did not get through:", error);
    return null;
  }
}

/**
 * Downloads and installs, reporting how far along it is.
 *
 * On Windows the installer runs in passive mode and restarts the application
 * itself, so the `relaunch` below is the belt for the case where it does not —
 * and the reason the call is allowed to throw nothing: by then the process may
 * already be on its way out.
 */
export async function installUpdate(
  offer: UpdateOffer,
  onProgress: (state: UpdateDownload) => void
): Promise<void> {
  let total = 0;
  let received = 0;
  await offer.handle.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        received = 0;
        onProgress({ percent: total > 0 ? 0 : null });
        break;
      case "Progress":
        received += event.data.chunkLength;
        onProgress({ percent: total > 0 ? Math.min(100, (received / total) * 100) : null });
        break;
      case "Finished":
        onProgress({ percent: 100 });
        break;
    }
  });
  try {
    await relaunch();
  } catch {
    /* the installer already took the application down */
  }
}
