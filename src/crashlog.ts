/** Everything the window throws that nothing else catches.
 *
 *  `ErrorBoundary` catches a throw during render, which is the loud kind: the
 *  screen goes and the reader knows. **The quiet kind is a throw inside an
 *  event handler**, which React deliberately does not route to a boundary — it
 *  reaches `window.onerror` and, with no handler there, nowhere at all. The
 *  component goes on running, the state never advances, and a button simply
 *  does nothing.
 *
 *  The owner met exactly that on 31 August: the microphone drew its peaks, the
 *  record button did nothing at all, and reinstalling was the only way out.
 *  There was no message, no crash screen and — checked afterwards — nothing in
 *  the log, because nothing in this application was listening for it. A fault
 *  that leaves no trace can only be guessed at, and it was.
 *
 *  Rejected promises are the same shape and get the same treatment: most of
 *  this application talks to the backend, and a `void` call whose failure
 *  nobody handles is the ordinary way that happens.
 */
import { api } from "./api";

/** Assembled the way `ErrorBoundary` assembles its own, so both halves of the
 *  window read alike in one file. */
function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    const message = `${error.name}: ${error.message}`;
    const trace = error.stack ?? "";
    return {
      message,
      stack: trace.startsWith(message) ? trace.slice(message.length).trim() : trace,
    };
  }
  return { message: typeof error === "string" ? error : JSON.stringify(error), stack: "" };
}

/** Never awaited and never allowed to throw: this runs while something has
 *  already gone wrong, and a reporter that fails loudly would replace the fault
 *  with itself. */
function send(what: string, error: unknown) {
  const { message, stack } = describe(error);
  void api.noteCrash(`${what}: ${message}`, stack).catch(() => {});
}

let listening = false;

/** Called once, from `main.tsx`, before the tree is rendered.
 *
 *  Nothing is prevented and nothing is swallowed — `preventDefault` is not
 *  called on either event, so the console still shows what it always showed and
 *  `tauri dev` is unchanged. This only makes a copy on its way past. */
export function keepUncaughtErrors() {
  /* Called once from `main.tsx`, and the guard is not for that call. Vite
     re-runs a module on every hot reload, so `tauri dev` would otherwise stack
     a listener per edit and write the same fault down five times. Found by the
     test below, which registers in each case. */
  if (listening) return;
  listening = true;
  window.addEventListener("error", (event) => {
    // `event.error` is absent for a few kinds - a failed resource load, a
    // cross-origin script - where the message is all there is.
    send("uncaught", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    send("unhandled rejection", event.reason);
  });
}
