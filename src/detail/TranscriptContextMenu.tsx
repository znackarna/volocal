/** The menu the right button opens over the transcript. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
/** One action in the transcript's context menu. */
export type TranscriptMenuItem = {
  label: string;
  icon: string;
  action: () => void;
  warning?: boolean;
};

/** The menu that opens where the pointer is.
 *
 *  It borrows the application's own menu surface rather than inventing a
 *  second one; only the positioning is different, because a context menu
 *  belongs to the place that was pointed at, not to a button. */
export function TranscriptContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: TranscriptMenuItem[];
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState({ left: x, top: y });

  // Measure once and keep the whole menu on screen: opened near the bottom
  // right corner it would otherwise be half outside the window.
  useLayoutEffect(() => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    setPlaced({
      left: Math.max(margin, Math.min(x, window.innerWidth - box.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - box.height - margin)),
    });
    surface.current?.querySelector("button")?.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!surface.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    // Scrolling the transcript would leave the menu pointing at nothing.
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <div
      className="kontextova-nabidka"
      style={{ left: placed.left, top: placed.top }}
      ref={surface}
    >
      <div className="nabidka-akci-seznam" role="menu">
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            className={item.warning ? "varovne" : ""}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            <svg className="nabidka-ikona" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" aria-hidden>
              <path d={item.icon} stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="nabidka-popisek">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Icons for that menu, on the same 24×24 grid as the rest of the interface. */
export const MENU_ICONS = {
  play: "M8 5.5v13l11-6.5-11-6.5Z",
  copy: "M9 8h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z M5 16V5a1 1 0 0 1 1-1h11",
  edit: "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z M13.5 6.5l4 4",
  note: "M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5Z M20 14h-5a1 1 0 0 0-1 1v5",
  // An arrow leaving a line: this block belongs up there, or down there.
  toPrevious: "M12 20V6 M6.5 11.5 12 6l5.5 5.5 M4 4h16",
  toNext: "M12 4v14 M17.5 12.5 12 18l-5.5-5.5 M4 20h16",
  // A person with a plus: somebody the machine never found.
  newVoice: "M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M3.5 20a6.5 6.5 0 0 1 11 -4.7 M17 15v6 M14 18h6",
} as const;

