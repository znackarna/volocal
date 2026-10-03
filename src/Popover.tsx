/** Menu surfaces the browser opens and closes: the `popover` attribute.
 *
 *  Five menus each wrote the same two listeners — a click outside closes, so
 *  does Escape — and each had to be put back together whenever something
 *  changed around it. The browser does both for an element with `popover`, and
 *  it does two things none of the copies did: the surface sits in the top
 *  layer, where no scrolling dialog can cut it off, and it can be anchored to
 *  the button that opened it, so CSS places it beside that button and flips it
 *  when there is no room (`position-area`, `position-try-fallbacks`).
 *
 *  Two shapes, because a menu is opened in two ways.
 */
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

type ToggleEvent = Event & { newState?: string };

/** Whether this WebView has the popover API. jsdom does not; there the button
 *  opens and closes the menu itself, and nothing closes it from outside. */
const NATIVE = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

/** A menu opened by a button.
 *
 *  The button names the menu (`popovertarget`), so the browser opens it and
 *  closes it, and knows that a click on the same button closes an open menu.
 *  That last part is why this is not simply the owner's state calling
 *  `showPopover`: the browser closes a popover on the press, before the click,
 *  and a button toggling state would then open it again — measured on
 *  2026-10-03 in a test page. The browser also gives the button Enter, Space
 *  and `aria-expanded`.
 *
 *  The surface stays in the page, hidden; its contents are rendered only while
 *  it is open, and before it shows (`beforetoggle`), so it never appears empty.
 *  `close()` is for an item that has been chosen.
 */
export function useMenu<T extends HTMLElement = HTMLButtonElement>() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<T>(null);
  const surface = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = surface.current;
    const button = trigger.current;
    if (!menu || !button) return;
    // Set here rather than in JSX: React 18's types know neither attribute.
    menu.id = id;
    menu.setAttribute("popover", "auto");
    button.setAttribute("popovertarget", id);
    const before = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") flushSync(() => setOpen(true));
    };
    const after = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") setOpen(false);
    };
    menu.addEventListener("beforetoggle", before);
    menu.addEventListener("toggle", after);
    return () => {
      menu.removeEventListener("beforetoggle", before);
      menu.removeEventListener("toggle", after);
    };
  }, [id]);

  const close = useCallback(() => {
    if (NATIVE && surface.current?.matches(":popover-open")) surface.current.hidePopover();
    setOpen(false);
  }, []);

  /** For the button's `onClick`. Does nothing where the browser opens the
   *  menu, which is everywhere but the tests. */
  const toggle = useCallback(() => {
    if (!NATIVE) setOpen((value) => !value);
  }, []);

  return { open, trigger, surface, close, toggle };
}

/** A menu opened where something was pointed at, with no button behind it —
 *  the transcript's context menu.
 *
 *  Rendered only while open: it shows itself when it mounts and tells
 *  `onDismiss` when the browser closes it, so the owner's state follows.
 */
export function PointedPopover({
  className,
  style,
  surface,
  onDismiss,
  children,
}: {
  className: string;
  style?: CSSProperties;
  surface: RefObject<HTMLDivElement>;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    node.setAttribute("popover", "auto");
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") dismiss.current();
    };
    node.addEventListener("toggle", onToggle);
    if (NATIVE) node.showPopover();
    return () => node.removeEventListener("toggle", onToggle);
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} style={style} ref={surface}>
      {children}
    </div>
  );
}

/** Whether a menu is open inside `element`. A dialog asks before it lets
 *  Escape close itself: with a menu open, Escape belongs to the menu. */
export function holdsOpenPopover(element: HTMLElement): boolean {
  if (!NATIVE) return false;
  return element.querySelector(":popover-open") !== null;
}
