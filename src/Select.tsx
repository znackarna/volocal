import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  /** optional group heading — items sharing a group are listed together */
  group?: string;
  note?: string;
}

interface Props {
  value: string;
  items: SelectOption[];
  onChange: (value: string) => void;
  /** label for screen readers when there is no <label> above the field */
  description?: string;
  disabled?: boolean;
}

/**
 * Dropdown menu.
 *
 * On Windows the native <select> is painted by the operating system: square
 * corners, foreign colours, an arrow glued to the edge. No amount of CSS gets
 * it into the pill-shaped language used everywhere else, hence a custom one.
 */
export default function Select({ value, items, onChange, description, disabled }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const selected = useMemo(
    () => items.find((p) => p.value === value),
    [items, value]
  );

  const openMenu = useCallback(() => {
    if (disabled) return;
    setHighlightedIndex(Math.max(0, items.findIndex((p) => p.value === value)));
    setIsOpen(true);
  }, [items, value, disabled]);

  const select = useCallback(
    (i: number) => {
      const p = items[i];
      if (p) onChange(p.value);
      setIsOpen(false);
    },
    [items, onChange]
  );

  // close on a click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  // keep the highlighted item in view
  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [isOpen, highlightedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlightedIndex(items.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(highlightedIndex);
    }
  };

  let lastGroup: string | undefined;

  return (
    <div className="vyber" ref={containerRef}>
      <button
        type="button"
        className={`vyber-spoust ${isOpen ? "otevreno" : ""}`}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={description}
      >
        <span className="vyber-hodnota">{selected?.label ?? "—"}</span>
        <svg className="vyber-sipka" width="10" height="6" viewBox="0 0 10 6" aria-hidden>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div className="vyber-nabidka" role="listbox" id={id} ref={listRef} tabIndex={-1}>
          {items.map((p, i) => {
            const newGroup = p.group && p.group !== lastGroup;
            lastGroup = p.group;
            return (
              <div key={p.value}>
                {newGroup && <div className="vyber-skupina">{p.group}</div>}
                <button
                  type="button"
                  data-i={i}
                  role="option"
                  aria-selected={p.value === value}
                  className={`vyber-polozka ${i === highlightedIndex ? "zvyrazneno" : ""} ${
                    p.value === value ? "vybrano" : ""
                  }`}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  onClick={() => select(i)}
                >
                  <span className="vyber-popisek">{p.label}</span>
                  {p.note && <span className="vyber-poznamka">{p.note}</span>}
                  {p.value === value && (
                    <svg className="vyber-fajfka" width="12" height="10" viewBox="0 0 12 10" aria-hidden>
                      <path d="M1 5l3.5 3.5L11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
