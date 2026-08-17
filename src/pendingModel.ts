/** The transcription model somebody chose, waiting for its file to arrive.
 *
 *  **Kept outside the screen that made the choice**, and that is the whole
 *  point of the module. `settings.model` names a file and `tools.rs` resolves
 *  it strictly, with no fallback — so it must not be written until the file is
 *  on the disk, and by then the wizard may be gone: `Stahovat na pozadí` closes
 *  it while the download it started keeps running in the backend.
 *
 *  Before this, the wizard wrote the setting from its own `quality` when
 *  `download:complete` arrived. Two things were wrong with that at once. It was
 *  not there to hear the event in the ordinary background case, so nothing was
 *  written at all; and when a second wizard was opened onto the running
 *  download, `quality` had gone back to the *recommended* answer rather than the
 *  chosen one, so it wrote a model that had never been fetched.
 *
 *  `localStorage`, not a React ref: the choice has to survive the screen, and
 *  surviving a restart costs nothing — the record is only ever acted on
 *  alongside a `download:complete` naming the component as landed, and a
 *  download does not survive a restart.
 */
const KEY = "pending-model";

export interface PendingModel {
  /** The catalogue component whose arrival makes the setting safe to write. */
  component: string;
  /** What `settings.model` becomes once it has landed. */
  settings: string;
}

export function rememberPendingModel(component: string, settings: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ component, settings }));
  } catch {
    /* A choice that cannot be remembered is not worth failing a download for.
       The wizard reopens as required and asks again, which is the state this
       whole record exists to make rarer rather than impossible. */
  }
}

export function pendingModel(): PendingModel | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<PendingModel>;
    // Anything else in that slot — an older shape, a hand-edited value — is
    // not a choice this build can honour, and guessing at it would write a
    // model name from nowhere into the one setting that must never be wrong.
    if (typeof value?.component !== "string" || typeof value?.settings !== "string") {
      return null;
    }
    return { component: value.component, settings: value.settings };
  } catch {
    return null;
  }
}

export function forgetPendingModel(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to undo */
  }
}
