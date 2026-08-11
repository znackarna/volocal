import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The application's own tooltip, in place of the operating system's.
 *
 * A native `title` bubble is drawn by Windows: square corners, its own white
 * border, its own font. Nothing about it can be reached from CSS, so the only
 * way to make it belong to this interface is to draw it here.
 *
 * It reads the `title` attributes that are already on the markup rather than
 * asking every call site to use something new. On hover the attribute is lifted
 * off the element — otherwise Windows would draw its bubble underneath ours —
 * and put straight back when the pointer leaves. Between those two moments the
 * element still has an accessible name from its own `aria-label` or its text,
 * so nothing is left nameless; anything that had only `title` gets it back
 * before focus can move on.
 */

/** About as long as Windows waits. Long enough that sweeping the pointer
 *  across a toolbar does not set off a row of bubbles. */
const SHOW_DELAY = 420;
/** Keyboard focus is deliberate, so it does not wait. */
const FOCUS_DELAY = 60;
const EDGE = 8;
const GAP = 8;

/** Where the attribute is parked while the bubble is up. */
const HELD = "data-tooltip-held";

type Tip = { text: string; rect: DOMRect };

export default function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLDivElement | null>(null);
  const source = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const restore = () => {
      const element = source.current;
      source.current = null;
      if (!element) return;
      const held = element.getAttribute(HELD);
      if (held !== null) {
        element.removeAttribute(HELD);
        // Only if nothing has since given it one of its own: React may have
        // re-rendered the element while the bubble was up.
        if (!element.hasAttribute("title")) element.setAttribute("title", held);
      }
    };

    const hide = () => {
      window.clearTimeout(timer.current);
      restore();
      setTip(null);
    };

    const show = (element: HTMLElement, delay: number) => {
      if (element === source.current) return;
      hide();
      const text = (element.getAttribute("title") ?? "").trim();
      if (!text) return;
      source.current = element;
      element.setAttribute(HELD, text);
      element.removeAttribute("title");
      timer.current = window.setTimeout(() => {
        setTip({ text, rect: element.getBoundingClientRect() });
      }, delay);
    };

    /* `[${HELD}]` is in the selector because the element loses its `title` the
       moment it is picked up. Without it, moving the pointer between two
       children of the same button would read as leaving it. */
    const find = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>(`[title], [${HELD}]`)
        : null;

    const onPointerOver = (event: PointerEvent) => {
      const element = find(event.target);
      if (!element) {
        if (source.current) hide();
        return;
      }
      show(element, SHOW_DELAY);
    };

    const onFocusIn = (event: FocusEvent) => {
      const element = find(event.target);
      if (element) show(element, FOCUS_DELAY);
      else if (source.current) hide();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKeyDown);
    // Capture: the bubble is anchored to a place on screen, and any scroll
    // anywhere moves that place out from under it.
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);

    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
      hide();
    };
  }, []);

  /* Placed after measuring, because centring and flipping both need the
     bubble's own size. It is rendered hidden for that one frame rather than
     positioned twice. */
  useLayoutEffect(() => {
    const node = bubble.current;
    if (!node || !tip) return;
    const box = node.getBoundingClientRect();
    const left = Math.max(
      EDGE,
      Math.min(
        tip.rect.left + tip.rect.width / 2 - box.width / 2,
        window.innerWidth - box.width - EDGE
      )
    );
    let top = tip.rect.bottom + GAP;
    // Below by default; above when there is no room, which is what the footer
    // and the bottom row of a dialog need.
    if (top + box.height > window.innerHeight - EDGE) {
      top = tip.rect.top - box.height - GAP;
    }
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(Math.max(EDGE, top))}px`;
    node.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;

  return (
    /* `aria-hidden`, deliberately: every element this can appear over already
       carries its own accessible name, and announcing the same words a second
       time would be noise rather than help. */
    <div ref={bubble} className="bubble" role="presentation" aria-hidden>
      {tip.text}
    </div>
  );
}
