import { useEffect, useRef } from "react";

/** What every modal in this application owes the keyboard: Escape closes it,
 *  Tab stays inside it, and when it goes the focus returns where it was.
 *
 *  None of that was true. Three of the seven modals handled Escape and four
 *  did not; `key === "Tab"` did not appear anywhere in `src/`, although all
 *  seven declare `aria-modal="true"` — which promises exactly the thing that
 *  was missing. Tab therefore walked off into the screen behind the dialog,
 *  where a reader using the keyboard cannot see where they are.
 *
 *  `onClose` is optional on purpose. `AddRecordingDialog` gives Escape a
 *  meaning of its own — it minimises a running take rather than throwing it
 *  away — so it takes the trap and keeps its own key.
 *
 *  `active` is for the dialogs that stay mounted and render nothing until they
 *  are asked for. Without it the effect would run once, on a mount where there
 *  is no element yet, and never again.
 */
export function useDialog<T extends HTMLElement>(onClose?: () => void, active = true) {
  const dialog = useRef<T>(null);
  // Read inside the handler rather than captured, so a caller passing a fresh
  // arrow function on every render does not rebuild the listener each time.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const element = active ? dialog.current : null;
    if (!element) return;

    // Where the focus stood before, to give it back. Not `document.activeElement`
    // read here: several dialogs place the focus with `autoFocus`, which runs
    // while the DOM is committed and therefore *before* this effect — so by now
    // the answer is already a control inside the dialog, and it is about to be
    // removed. What is wanted is the last thing focused outside one.
    const before = outside;
    // And for the dialogs that do not place it themselves, put it inside.
    if (!element.contains(document.activeElement)) stops(element)[0]?.focus();

    // On the element, not on the window: a dialog opened over another one then
    // answers its own keys and the one underneath never sees them. The focus
    // starts inside, which is what makes the events arrive here at all.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && close.current) {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const inside = stops(element);
      if (inside.length === 0) {
        // Nothing to move to. Letting Tab through would take the focus out of
        // a dialog that is still open.
        event.preventDefault();
        return;
      }
      const first = inside[0];
      const last = inside[inside.length - 1];
      const active = document.activeElement;
      // Named rather than reusing `outside`, which is the module's own state.
      const beyond = !element.contains(active);
      if (event.shiftKey && (active === first || beyond)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || beyond)) {
        event.preventDefault();
        first.focus();
      }
    };

    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      // Only when the focus has nowhere to be. Closing removes the element
      // that held it and the browser drops it on `body`; that is the case to
      // repair. A dialog that closed by opening another one has handed the
      // focus on, and taking it back would be worse than leaving it.
      const active = document.activeElement;
      if (before?.isConnected && (!active || active === document.body)) before.focus();
    };
  }, [active]);

  return dialog;
}

/** The last element focused that was not inside a dialog — where the focus
 *  goes back to when one closes. One listener for the window's lifetime: it is
 *  a single assignment per focus change, and it has to be watching before the
 *  dialog opens, which is exactly what the dialog itself cannot do. */
let outside: HTMLElement | null = null;

// Watching starts when this module is imported, not when a dialog opens. The
// click that opens the first one is the focus change that matters, and by the
// time the dialog's own effect runs it has already happened.
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && !target.closest(".prekryv-dialogu")) outside = target;
    },
    true
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** The tab stops inside a dialog, in document order.
 *
 *  Visibility is asked as `getClientRects()`, not `offsetParent`: everything
 *  here lives inside a `position: fixed` overlay, and for its children
 *  `offsetParent` is that overlay rather than null — so it would answer
 *  "visible" for a hidden control just as readily.
 */
function stops(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (candidate) => candidate.getClientRects().length > 0
  );
}
