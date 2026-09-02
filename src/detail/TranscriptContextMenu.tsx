/** The menu the right button opens over the transcript. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
/** One action in the transcript's context menu.
 *
 *  An item with `children` opens them in place of the menu rather than acting,
 *  with a way back — the same drill-down the recording's own menu uses, and the
 *  same classes, because two menus a few pixels apart should not behave
 *  differently. A flyout would have to decide which side to open on in a window
 *  this narrow, and the transcript menu already opens wherever it was pointed. */
export type TranscriptMenuItem = {
  label: string;
  icon: string;
  action?: () => void;
  children?: TranscriptMenuItem[];
  warning?: boolean;
  /** Paints the item's mark, so a speaker is recognisable by colour here as
   *  well as in the panel. */
  color?: string;
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
  const [submenu, setSubmenu] = useState<TranscriptMenuItem | null>(null);

  // Measured whenever what is in the menu changes, not only when it opens: a
  // recording with six speakers makes the list of names taller than the menu it
  // replaced, and a menu opened low would then hang off the bottom.
  useLayoutEffect(() => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    setPlaced({
      left: Math.max(margin, Math.min(x, window.innerWidth - box.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - box.height - margin)),
    });
    surface.current?.querySelector("button")?.focus();
  }, [x, y, submenu]);

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
      className="context-menu"
      style={{ left: placed.left, top: placed.top }}
      ref={surface}
    >
      <div className="action-menu-list" role="menu">
        {submenu && (
          <button className="menu-back" onClick={() => setSubmenu(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {submenu.label}
          </button>
        )}
        {(submenu?.children ?? items).map((item) => (
          <button
            key={item.label}
            role="menuitem"
            className={item.warning ? "destructive-item" : ""}
            onClick={() => {
              if (item.children) {
                setSubmenu(item);
                return;
              }
              onClose();
              item.action?.();
            }}
          >
            <svg className="menu-icon" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" aria-hidden style={item.color ? { color: item.color } : undefined}>
              <path d={item.icon} stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="menu-label">{item.label}</span>
            {item.children && (
              <svg className="menu-arrow" width="14" height="14" viewBox="0 0 24 24"
                   fill="none" aria-hidden>
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
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
  // A person: the block belongs to somebody, and the list says who.
  speaker: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 20a8 8 0 0 1 16 0",
  // A person with a plus: somebody the machine never found.
  newVoice: "M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M3.5 20a6.5 6.5 0 0 1 11 -4.7 M17 15v6 M14 18h6",
  // A bracket around a stretch: this block, and everything to the mark.
  clip: "M8 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3 M16 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3 M9 12h6",
} as const;

