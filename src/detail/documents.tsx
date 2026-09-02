/** The saved documents: which formats exist, which views the preview offers,
 *  and the two menus that write them to disk. */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./../i18n";
import type { TranslationKey } from "./../i18n";
export const EXPORT_FORMATS = ["txt", "md", "srt", "vtt", "json"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Only the key belongs here. The text is looked up inside a component, so it
 *  follows a language change instead of being frozen at module load.
 *  Kept short so the menu label fits on a single line. */
export const FORMAT_DESCRIPTIONS: Record<ExportFormat, TranslationKey> = {
  txt: "detail.format.txt",
  md: "detail.format.md",
  srt: "detail.format.srt",
  vtt: "detail.format.vtt",
  json: "detail.format.json",
};

export const SUMMARY_LENGTHS = ["short", "standard", "detailed"] as const;

export type SummaryLength = (typeof SUMMARY_LENGTHS)[number];

/** The heading is a whole sentence per length: the adjective is declined, so it
 *  must not be assembled from a fragment and a noun. */
export const SUMMARY_LENGTH_KEYS: Record<
  SummaryLength,
  { label: TranslationKey; description: TranslationKey; heading: TranslationKey }
> = {
  short: {
    label: "detail.summaryLength.short",
    description: "detail.summaryLength.shortDescription",
    heading: "detail.summary.createShortTitle",
  },
  standard: {
    label: "detail.summaryLength.standard",
    description: "detail.summaryLength.standardDescription",
    heading: "detail.summary.createStandardTitle",
  },
  detailed: {
    label: "detail.summaryLength.detailed",
    description: "detail.summaryLength.detailedDescription",
    heading: "detail.summary.createDetailedTitle",
  },
};

/** Language codes only. Their names live in the shared `domain` dictionary and
 *  are read through `useLabels`, so this screen does not keep its own copy. */
export const TRANSLATION_LANGUAGES = ["cs", "en", "de", "sk", "pl", "fr", "es", "it", "uk"] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
export type PreviewTab = "improved" | "summary" | "translation" | "custom" | "original";

/** Small outline icons shared by the document tabs and their empty states. */
export function DocumentViewIcon({ view }: { view: PreviewTab }) {
  if (view === "improved") {
    /* The only one of these drawn as a filled shape rather than a line. It says
       so itself, because the tab row can no longer tell by position: the
       improved transcript is not always the first tab there. */
    return (
      <svg viewBox="0 0 20 20" className="solid" aria-hidden>
        <path d="m10 2 1.15 4.1L15 7.3l-3.85 1.2L10 12.6 8.85 8.5 5 7.3l3.85-1.2L10 2Zm5 9 .65 2.35L18 14l-2.35.65L15 17l-.65-2.35L12 14l2.35-.65L15 11Z" />
      </svg>
    );
  }
  if (view === "summary") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden>
        <path d="M4 5h12M4 10h9M4 15h7" />
      </svg>
    );
  }
  if (view === "custom") {
    /* A line of writing with a pen over it: the instruction is the reader's
       own, and the icon says who wrote it rather than what came out. */
    return (
      <svg viewBox="0 0 20 20" aria-hidden>
        <path d="M3 5h9M3 9h5M3 13h4M16.6 8.1l1.3 1.3-5 5-1.8.5.5-1.8 5-5Z" />
      </svg>
    );
  }
  if (view === "translation") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="7" />
        <path d="M3.5 10h13M10 3c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M5 2.8h6l4 4V17H5zM11 2.8v4h4M7.5 10h5M7.5 13h5" />
    </svg>
  );
}

export function RegenerateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13.2 6.2A5.5 5.5 0 1 0 13 10.5M13.2 2.8v3.4H9.8"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
            strokeLinejoin="round" />
    </svg>
  );
}

export function DiscardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 4.5h9M6 2.5h4M5 4.5l.6 9h4.8l.6-9M7 7v4M9 7v4"
            stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"
            strokeLinejoin="round" />
    </svg>
  );
}

/** The order the sidebar shows notes in, matching what the database returns.
 *  Notes about the whole recording come first in the order they were written;
/** Compact format menu used in the document preview footer. */
/** The edges of the first ancestor that clips, or the window where none does.
 *
 *  `overflow` anything but `visible` cuts a child off at the box's edge, and
 *  an absolutely positioned menu is a child like any other. A dialog that
 *  scrolls is exactly such a box, and it is the one this menu lives in.
 */
function clippingBox(from: HTMLElement | null): { top: number; bottom: number } {
  for (let node = from?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow && overflow !== "visible") {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

export function DocumentSaveMenu({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (format: "txt" | "md") => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }

    const bounds = container.current?.getBoundingClientRect();
    if (bounds) {
      /* **Measured against whatever will actually cut the menu off**, which
         is not the window. This asked `window.innerHeight`, and inside the
         improved-transcript dialog there is plenty of window below the footer
         — so the menu opened downwards and `.dialog`, which scrolls and
         therefore clips, took the bottom half of it. The reader saw TXT and
         half of MD.

         The nearest scrolling ancestor is the box that decides. Where there is
         none, it is the window after all, which is what the fallback says. */
      const room = clippingBox(container.current);
      const roomBelow = room.bottom - bounds.bottom;
      const roomAbove = bounds.top - room.top;
      const estimatedMenuHeight = 112;
      setOpenAbove(roomBelow < estimatedMenuHeight && roomAbove > roomBelow);
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="save" ref={container}>
      <button className="button primary" onClick={toggleMenu}
              disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 2v8M4.6 6.8 8 10.2l3.4-3.4M2.5 12.5h11"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round" />
        </svg>
        {t("common.save")}
        <svg className="save-arrow" width="12" height="12" viewBox="0 0 24 24"
             fill="none" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className={`save-list document-save-menu${openAbove ? " opens-above" : ""}`}
          role="menu"
        >
          {(["txt", "md"] as const).map((format) => (
            <button key={format} role="menuitem" onClick={() => {
              setOpen(false);
              onChoose(format);
            }}>
              <span className="save-format">{format.toUpperCase()}</span>
              <span className="save-label">{t(FORMAT_DESCRIPTIONS[format])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
