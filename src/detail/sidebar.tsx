/** The transcript sidebar's own furniture: which sections there are, whether
 *  each is open, and the heading that opens it. */
import type { ReactNode } from "react";
import { LineIcon, type LineIconName } from "./../icons";
/** The lists in the sidebar. They are one page, not tabs, so each one opens
 *  and closes on its own and remembers that. */
export const SIDEBAR_SECTIONS = ["speakers", "unassigned", "review", "edits", "notes"] as const;
export type SidebarSectionName = (typeof SIDEBAR_SECTIONS)[number];
export type SidebarOpenSections = Record<SidebarSectionName, boolean>;

export function readOpenSections(): SidebarOpenSections {
  let parsed: unknown = null;
  try {
    // This is a useState initialiser, so anything thrown here takes the whole
    // window down to white. A remembered panel state is never worth that: a
    // corrupt record — or a storage a browser refuses to read — falls back to
    // every section open, which is what a fresh installation shows anyway.
    const stored = localStorage.getItem("sidebar-sections");
    if (stored) parsed = JSON.parse(stored);
  } catch {
    parsed = null;
  }
  const saved = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return SIDEBAR_SECTIONS.reduce((all, name) => {
    // Unknown or missing means open: a panel that hides its content by
    // default would look empty on a fresh installation.
    all[name] = saved[name] !== false;
    return all;
  }, {} as SidebarOpenSections);
}

/** One section of the sidebar: an icon in a circle, a heading, an optional
 *  count, and a chevron. The whole row opens and closes the section; the
 *  section's own action sits outside that button, because a button cannot
 *  contain another one. */
/** Before the time on a row that plays from it.
 *
 *  The same triangle the speaker's sample button draws, so the one gesture that
 *  starts audio looks the same wherever it is offered. It is not a button: the
 *  whole row is, and a target inside a target would only be two ways to do one
 *  thing.
 */
export function PlayMark() {
  return (
    <span className="radek-prehrat" aria-hidden>
      <svg width="9" height="9" viewBox="0 0 10 10">
        <path d="M2.5 1.5 L8.5 5 L2.5 8.5 Z" fill="currentColor" />
      </svg>
    </span>
  );
}

/** A section with nothing in it yet.
 *
 *  No icon, and that is a decision rather than an omission. The only mark that
 *  would belong here is the section's own — and it is already two rows above,
 *  in the heading, and often a third time in the action below. One drawing
 *  three times in a 300 px card is not structure, it is noise. The heading
 *  keeps the mark; this keeps the sentence.
 */
export function SidebarEmpty({ children }: { children: ReactNode }) {
  return <p className="sidebar-empty">{children}</p>;
}

export function SidebarSection({
  icon,
  title,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  icon: LineIconName;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`sidebar-section ${open ? "open" : ""}`}>
      {/* One control, the whole width of the card. The section's own action
          lives inside the body rather than beside the heading, which is what
          makes that possible — a button cannot contain another one, and every
          previous arrangement here was a way around that. */}
      <h2>
        <button
          type="button"
          className="sidebar-section-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="sidebar-section-icon" aria-hidden>
            <LineIcon name={icon} size={17} />
          </span>
          <span className="sidebar-section-title">{title}</span>
          {/* The count is what a closed section still says about itself.
              Open, the list below is the answer, so the badge goes. */}
          {!open && count !== undefined && count > 0 && (
            <span className="sidebar-count">{count}</span>
          )}
          <svg className="sidebar-section-chevron" width="14" height="14"
               viewBox="0 0 14 14" aria-hidden>
            <path d="M4 5.5 7 8.5 10 5.5" fill="none" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {open && (
        <div className="sidebar-section-body">
          {children}
          {/* After the list, bottom right: the action follows from what is
              above it — add another note, look for the speakers again — and
              reading comes before acting. */}
          {action && <div className="sidebar-section-action">{action}</div>}
        </div>
      )}
    </section>
  );
}
