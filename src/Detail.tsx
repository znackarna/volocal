import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import { api } from "./api";
import InfoNote from "./InfoNote";
import PlaybackControls from "./PlaybackControls";
import ConfirmationDialog from "./ConfirmationDialog";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import RecordingActionsMenu from "./RecordingActionsMenu";
import NameDialog from "./NameDialog";
import Select from "./Select";
import { LineIcon, type LineIconName } from "./icons";
import mark from "./mark.svg?raw";
import {
  EMPTY_WAVEFORM,
  MiniPlayer,
  loadWaveform,
  preparePlaybackSource,
  usePlayer,
  usePlayerTime,
} from "./player";
import { MiniRecorder } from "./recorder";
import type { Waveform } from "./player";
import { useI18n } from "./i18n";
import { localMessage, useProgressMessage, useUserMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import { useLabels } from "./labels";
import { useDialog } from "./useDialog";
import { CONFIDENCE_THRESHOLD, formatTime, fileName } from "./types";
import { forgetSpeakerName, speakerNamesFor } from "./speakerNames";
import ProgressBubble from "./ProgressBubble";
import type {
  AiDocument,
  AiEditProgress,
  AiOutput,
  Speaker,
  Segment,
  DictionaryEntry,
  TranscriptionProgress,
  LiveSegment,
  RecordingNote,
  Folder,
} from "./types";

interface Props {
  id: string;
  seekTime: number | null;
  progress?: TranscriptionProgress;
  liveSegments: LiveSegment[];
  onBack: () => void;
  onNew: () => void;
  /** Opens the add dialog straight on the recorder view. */
  onOpenRecorder: () => void;
  /** Travels to another recording's detail — the mini player's click. */
  onOpenRecording: (recordingId: string) => void;
  /** Hands this recording's audio file over to a place of the user's choosing. */
  onExportAudio: () => void;
  folders: Folder[];
  onMoveToFolder: (folder: string | null) => void;
  onCreateFolderFor: () => void;
  onSettings: () => void;
  onError: (z: string) => void;
  /** A confirmation, not a fault. Shown in the calm colour. */
  onInfo: (z: string) => void;
  /** Opens module management when local language editing is not installed. */
  onToModule: (module?: string) => void;
  /** Transcription is started through the shell, which asks about speakers
   *  first when they are being separated. Detail must not call the backend
   *  directly, or that question would be skipped from this screen. */
  /** Answers whether a run actually started, so this screen only shows itself
   *  as busy when something is. A question may be asked first. */
  onTranscribe: (id: string, language?: string) => Promise<boolean>;
  /** Speaker separation also goes through the shell, which asks how many
   *  people speak before it starts. */
  onDiarize: (id: string) => void;
  /** Owned by the shell, because the run is asked for there and its first
   *  progress event arrives a moment later. */
  diarizing: boolean;
}

const EXPORT_FORMATS = ["txt", "md", "srt", "vtt", "json"] as const;

type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Only the key belongs here. The text is looked up inside a component, so it
 *  follows a language change instead of being frozen at module load.
 *  Kept short so the menu label fits on a single line. */
const FORMAT_DESCRIPTIONS: Record<ExportFormat, TranslationKey> = {
  txt: "detail.format.txt",
  md: "detail.format.md",
  srt: "detail.format.srt",
  vtt: "detail.format.vtt",
  json: "detail.format.json",
};

const SUMMARY_LENGTHS = ["short", "standard", "detailed"] as const;

type SummaryLength = (typeof SUMMARY_LENGTHS)[number];

/** The heading is a whole sentence per length: the adjective is declined, so it
 *  must not be assembled from a fragment and a noun. */
const SUMMARY_LENGTH_KEYS: Record<
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
const TRANSLATION_LANGUAGES = ["cs", "en", "de", "sk", "pl", "fr", "es", "it", "uk"] as const;

type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
type PreviewTab = "improved" | "summary" | "translation" | "original";

/** The lists in the sidebar. They are one page, not tabs, so each one opens
 *  and closes on its own and remembers that. */
const SIDEBAR_SECTIONS = ["speakers", "unassigned", "review", "edits", "notes"] as const;
type SidebarSectionName = (typeof SIDEBAR_SECTIONS)[number];
type SidebarOpenSections = Record<SidebarSectionName, boolean>;

function readOpenSections(): SidebarOpenSections {
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
function PlayMark() {
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
function SidebarEmpty({ children }: { children: ReactNode }) {
  return <p className="sidebar-empty">{children}</p>;
}

function SidebarSection({
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

function fitNoteTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "0";
  element.style.height = `${element.scrollHeight}px`;
}

/** Accepts seconds, m:ss, or h:mm:ss. */
function parseNoteTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.length > 1 && numbers[numbers.length - 1] >= 60) return null;
  if (numbers.length === 3 && numbers[1] >= 60) return null;
  if (numbers.length === 1) return numbers[0];
  if (numbers.length === 2) return numbers[0] * 60 + numbers[1];
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

function noteTimeIsValid(value: string, duration: number): boolean {
  const parsed = parseNoteTime(value);
  return parsed !== null && (duration <= 0 || parsed <= duration);
}

/** Raised when even the selection-based fallback is refused. The wording shown
 *  to the person belongs to the caller: this function lives outside a component
 *  and cannot reach the dictionary. */
class ClipboardRefused extends Error {}

/** One action in the transcript's context menu. */
type TranscriptMenuItem = {
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
function TranscriptContextMenu({
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
const MENU_ICONS = {
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

/** Clipboard API first, with a WebView-safe fallback for restricted contexts. */
async function copyPlainText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some WebView builds expose the API but deny it outside a secure origin.
    // The user initiated this action, so the selection-based fallback is safe.
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.inset = "0 auto auto -9999px";
  document.body.appendChild(field);
  field.focus();
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new ClipboardRefused("clipboard refused the copy");
}

/** Small outline icons shared by the document tabs and their empty states. */
function DocumentViewIcon({ view }: { view: PreviewTab }) {
  if (view === "improved") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden>
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

function RegenerateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13.2 6.2A5.5 5.5 0 1 0 13 10.5M13.2 2.8v3.4H9.8"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
            strokeLinejoin="round" />
    </svg>
  );
}

function DiscardIcon() {
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
 *  the ones tied to a moment follow, in the order they occur. */
function byNoteOrder(a: RecordingNote, b: RecordingNote): number {
  if ((a.time === null) !== (b.time === null)) return a.time === null ? -1 : 1;
  if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** The time control of a sticky note.
 *
 *  A note does not have to sit anywhere in the recording. When it does, the
 *  chip plays from that moment; opening the note also lets the moment be typed,
 *  which a closed note has no room for. When it does not, the only offer is to
 *  pin it where playback currently stands — that is the position the writer
 *  means nine times out of ten.
 */
function StickyTime({
  time,
  playbackTime,
  open,
  onPin,
  onUnpin,
  onSeek,
  draft,
  invalid = false,
  pinDisabled = false,
  onDraftChange,
  onDraftCommit,
}: {
  time: number | null;
  playbackTime: number;
  open: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onSeek?: () => void;
  draft?: string;
  invalid?: boolean;
  /** A note with nothing written in it has nothing to pin. */
  pinDisabled?: boolean;
  onDraftChange?: (value: string) => void;
  onDraftCommit?: (value: string) => void;
}) {
  const { t } = useI18n();

  if (time === null) {
    if (!open) return null;
    return (
      <button className="sticky-pin" onClick={onPin} disabled={pinDisabled}>
        {t("detail.notes.pinAt", { time: formatTime(playbackTime) })}
      </button>
    );
  }

  return (
    <>
      <button
        className="sticky-time"
        onClick={onSeek}
        disabled={!onSeek}
        title={t("detail.notes.seekTitle")}
        aria-label={t("detail.notes.seekTo", { time: formatTime(time) })}
      >
        <svg width="9" height="10" viewBox="0 0 10 12" aria-hidden>
          <path d="M2 1.8 8.4 6 2 10.2Z" fill="currentColor" />
        </svg>
        {open && onDraftChange ? null : formatTime(time)}
      </button>
      {open && onDraftChange && (
        <input
          className="sticky-time-input"
          value={draft ?? formatTime(time)}
          aria-label={t("detail.notes.timeLabel")}
          aria-invalid={invalid}
          title={t("detail.notes.timeHint")}
          inputMode="numeric"
          maxLength={8}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={(event) => onDraftCommit?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}
      {open && (
        <button className="sticky-quiet" onClick={onUnpin}>
          {t("detail.notes.unpin")}
        </button>
      )}
    </>
  );
}

/** One compact status surface for every long-running job on the detail screen. */
/** A single button with a format menu. */
function ExportMenu({
  disabled,
  onChoose,
  hasAiDocument,
  onChooseAi,
}: {
  disabled: boolean;
  onChoose: (format: string) => void;
  hasAiDocument: boolean;
  onChooseAi: (format: "txt" | "md") => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="ulozit" ref={container}>
      <button
        className="tlacitko"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 2v8M4.6 6.8 8 10.2l3.4-3.4M2.5 12.5h11"
                stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("detail.export.button")}
        <svg className="ulozit-sipka" width="12" height="12" viewBox="0 0 24 24"
             fill="none" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="ulozit-seznam" role="menu">
          <span className="save-menu-group">{t("detail.export.rawGroup")}</span>
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onChoose(f);
              }}
            >
              <span className="ulozit-format">{f.toUpperCase()}</span>
              <span className="ulozit-popis">{t(FORMAT_DESCRIPTIONS[f])}</span>
            </button>
          ))}
          {hasAiDocument && (
            <>
              <span className="save-menu-group">{t("detail.export.improvedGroup")}</span>
              {(["txt", "md"] as const).map((format) => (
                <button
                  key={`ai-${format}`}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onChooseAi(format);
                  }}
                >
                  <span className="ulozit-format">{format.toUpperCase()}</span>
                  <span className="ulozit-popis">{t(FORMAT_DESCRIPTIONS[format])}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact format menu used in the document preview footer. */
function DocumentSaveMenu({
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
      const roomBelow = window.innerHeight - bounds.bottom;
      const estimatedMenuHeight = 112;
      setOpenAbove(roomBelow < estimatedMenuHeight && bounds.top > roomBelow);
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
    <div className="ulozit" ref={container}>
      <button className="tlacitko hlavni" onClick={toggleMenu}
              disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 2v8M4.6 6.8 8 10.2l3.4-3.4M2.5 12.5h11"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round" />
        </svg>
        {t("common.save")}
        <svg className="ulozit-sipka" width="12" height="12" viewBox="0 0 24 24"
             fill="none" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className={`ulozit-seznam document-save-menu${openAbove ? " opens-above" : ""}`}
          role="menu"
        >
          {(["txt", "md"] as const).map((format) => (
            <button key={format} role="menuitem" onClick={() => {
              setOpen(false);
              onChoose(format);
            }}>
              <span className="ulozit-format">{format.toUpperCase()}</span>
              <span className="ulozit-popis">{t(FORMAT_DESCRIPTIONS[format])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Detail({
  id,
  seekTime,
  progress,
  liveSegments,
  onBack,
  onNew,
  onOpenRecorder,
  onOpenRecording,
  onExportAudio,
  folders,
  onMoveToFolder,
  onCreateFolderFor,
  onSettings,
  onError,
  onInfo,
  onToModule,
  onTranscribe,
  onDiarize,
  diarizing,
}: Props) {
  const { t, tPlural } = useI18n();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();
  const labels = useLabels();
  const [title, setTitle] = useState("");
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("");
  /** Which folder holds this recording, so its menu can offer to move it. */
  const [folder, setFolder] = useState<string | null>(null);
  /** Why the last transcription failed. Only set when status is "chyba". */
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [notes, setNotes] = useState<RecordingNote[]>([]);
  const [openSections, setOpenSections] = useState<SidebarOpenSections>(readOpenSections);
  const [addingNote, setAddingNote] = useState(false);
  /** Where the note being written should sit, or nowhere. */
  const [noteDraftTime, setNoteDraftTime] = useState<number | null>(null);
  /** Only one sticky is open at a time; a wall of open editors is unreadable. */
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteTimeDrafts, setNoteTimeDrafts] = useState<Record<string, string>>({});
  const [aiDocument, setAiDocument] = useState<AiDocument | null>(null);
  const [aiOutputs, setAiOutputs] = useState<AiOutput[]>([]);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiEditProgress | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiModel, setAiModel] = useState("");
  const [aiReady, setAiReady] = useState(false);
  /** Whether the speaker-separation tools are installed. Its card offers to
   *  fetch them when they are not, rather than failing on the way out. */
  const [speakersReady, setSpeakersReady] = useState(false);
  const [aiDialog, setAiDialog] = useState<"configure" | "preview" | "missing" | null>(null);
  /* Three modals, three traps. They were the four dialogs Escape did nothing
     in — closable only by clicking the overlay, which is not a thing the
     keyboard can do. One `useDialog` each, because a hook cannot live inside
     the conditional that renders them. */
  const closeAiDialog = useCallback(() => setAiDialog(null), []);
  const missingDialog = useDialog<HTMLDivElement>(closeAiDialog, aiDialog === "missing");
  const configureDialog = useDialog<HTMLDivElement>(closeAiDialog, aiDialog === "configure");
  const previewDialog = useDialog<HTMLDivElement>(closeAiDialog, aiDialog === "preview");
  const [aiMode, setAiMode] = useState<"faithful" | "clean" | "speakers">("faithful");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("improved");
  const [summaryLength, setSummaryLength] = useState<SummaryLength>("standard");
  const [translationLanguage, setTranslationLanguage] =
    useState<TranslationLanguage>("en");
  const [originalPreview, setOriginalPreview] = useState("");

  // The player is shared across the app so sound survives leaving this
  // screen. Opening another transcript does not touch it — until you press
  // play, whatever was playing keeps playing.
  const player = usePlayer();
  // Asked for separately from the player: this is the one screen that follows
  // the clock, and it is what makes the tick worth paying for here.
  const playerTime = usePlayerTime();

  /* The player pill compacts by measurement, not by a window-width guess
     (which shrank it with visible room to spare): it gives up its words the
     moment the recording's name starts losing letters, and grows back once
     the name is whole again with the pill's full width to spare. The two
     conditions cannot chase each other — expanding needs ~25 px more than
     compacting frees. */
  const headerLeftRef = useRef<HTMLDivElement | null>(null);
  const [pillsCompact, setPillsCompact] = useState(false);
  const pillsCompactRef = useRef(false);
  pillsCompactRef.current = pillsCompact;

  useEffect(() => {
    const left = headerLeftRef.current;
    if (!left) return;
    /* The full pill is 290, the compact one 83; expanding costs the
       difference, plus breathing room so the pair of rules cannot flap. */
    const EXPAND_NEED = 232;
    const measure = () => {
      const name = left.querySelector<HTMLElement>(".detail-jmeno");
      if (!name) return; // renaming — the span is an input right now
      const clipped = name.scrollWidth > name.clientWidth + 1;
      if (!pillsCompactRef.current) {
        if (clipped) setPillsCompact(true);
        return;
      }
      /* The left column stretches, so its free room is the gap between its
         last piece of content and its own right edge. */
      const children = Array.from(left.children) as HTMLElement[];
      const last = children[children.length - 1];
      if (!last) return;
      const slack =
        left.getBoundingClientRect().right - last.getBoundingClientRect().right;
      if (!clipped && slack > EXPAND_NEED) setPillsCompact(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(left);
    return () => observer.disconnect();
    /* `title` re-arms it: a rename changes the name's width without changing
       the observed column's box, so the observer alone would sleep through it. */
  }, [title]);
  const isCurrentRecording = player.recordingId === id;
  // Cursor in a transcript that does not own the audio yet.
  const [localTime, setLocalTime] = useState(0);
  const time = isCurrentRecording ? playerTime : localTime;
  const isPlaying = isCurrentRecording && player.isPlaying;
  // The duration in the database comes from ffprobe at import time and may be
  // unknown. Once audio plays, the player knows it exactly — and without it
  // the played ratio would be zero, so neither ring nor handle would render.
  const trackDuration = isCurrentRecording && player.duration > 0 ? player.duration : duration;

  // The screen loads the waveform itself rather than through the player. The
  // player only knows the one currently playing, so the waveform would appear
  // only after pressing play, leaving an empty track under the slider.
  const [waveform, setWaveform] = useState<Waveform>(EMPTY_WAVEFORM);
  useEffect(() => {
    let disposed = false;
    setWaveform(EMPTY_WAVEFORM);
    loadWaveform(id, setWaveform, () => disposed);
    return () => {
      disposed = true;
    };
  }, [id]);

  // Everything the handlers need comes from a ref, not from dependencies.
  //
  // The player context value changes on every tick of the clock. Were `seek`
  // to depend on it, that function would change several times a second — and
  // since every transcript segment receives it, none of them would pass the
  // `memo` comparison and the whole transcript would repaint over and over.
  // On an hour-long sermon that is a thousand segments and twenty thousand
  // elements per tick.
  const current = useRef({ isCurrentRecording, player, id, path, title, duration, localTime });
  current.current = { isCurrentRecording, player, id, path, title, duration, localTime };

  /**
   * Jump to a position in the recording.
   *
   * When the audio belongs to this recording it simply moves. When it does
   * not, the player takes the recording over and starts it there — clicking a
   * word is an instruction, not an accident, and waiting for the play button
   * afterwards makes no sense. The quiet variant, which only moves the cursor,
   * is used where audio should not start: dragging the slider, and arriving
   * from search.
   */
  const seek = useCallback((t: number, silently = false) => {
    const s = current.current;
    if (s.isCurrentRecording) {
      s.player.seek(t);
    } else if (!silently && s.path) {
      s.player.start(s.id, s.path, s.title, s.duration, Math.max(0, t));
    } else {
      setLocalTime(Math.max(0, t));
    }
  }, []);

  const updateCursor = useCallback((t: number) => seek(t, true), [seek]);

  /** Moves to a position and makes sure the audio is running.
   *
   *  `seek` deliberately stays quiet when the recording is already loaded,
   *  because stepping through uncertain places is reading. A note's timestamp
   *  is the opposite: it is asked for in order to hear that moment. */
  const playFrom = useCallback((t: number) => {
    const s = current.current;
    if (s.isCurrentRecording) {
      s.player.seek(t);
      if (!s.player.isPlaying) s.player.togglePlayback();
    } else if (s.path) {
      s.player.start(s.id, s.path, s.title, s.duration, Math.max(0, t));
    } else {
      setLocalTime(Math.max(0, t));
    }
  }, []);

  /** Where each speaker can be heard, longest stretch first.
   *
   *  Deciding whether a speaker is real means listening to them, and the
   *  longest continuous stretch is the clearest sample there is. Adjacent
   *  segments are joined across gaps under 0.6 s so one sentence broken into
   *  blocks does not count as several short samples.
   */
  const speakerSamples = useMemo(() => {
    const by = new Map<string, { start: number; end: number }[]>();
    for (const segment of segments) {
      if (!segment.speakers) continue;
      const list = by.get(segment.speakers) ?? [];
      const last = list[list.length - 1];
      if (last && segment.start - last.end < 0.6) last.end = segment.end;
      else list.push({ start: segment.start, end: segment.end });
      by.set(segment.speakers, list);
    }
    for (const list of by.values()) {
      list.sort((a, b) => b.end - b.start - (a.end - a.start));
    }
    return by;
  }, [segments]);

  /** Share of the spoken time, so a cluster holding two seconds is obvious. */
  const speakerShare = useMemo(() => {
    const seconds = new Map<string, number>();
    let total = 0;
    for (const segment of segments) {
      if (!segment.speakers) continue;
      const length = Math.max(0, segment.end - segment.start);
      seconds.set(segment.speakers, (seconds.get(segment.speakers) ?? 0) + length);
      total += length;
    }
    const share = new Map<string, number>();
    for (const [key, value] of seconds) share.set(key, total > 0 ? value / total : 0);
    return share;
  }, [segments]);

  /** Repeated clicks walk through that speaker's stretches, longest first. */
  const nextSample = useRef<Record<string, number>>({});
  const playSpeaker = useCallback(
    (key: string) => {
      const list = speakerSamples.get(key);
      if (!list || list.length === 0) return;
      const index = (nextSample.current[key] ?? 0) % list.length;
      nextSample.current[key] = index + 1;
      playFrom(list[index].start);
    },
    [speakerSamples, playFrom]
  );

  const togglePlayback = useCallback(() => {
    const s = current.current;
    if (s.isCurrentRecording) s.player.togglePlayback();
    else if (s.path) s.player.start(s.id, s.path, s.title, s.duration, s.localTime);
  }, []);
  const [editing, setEditing] = useState<string | null>(null);
  /* Editing in the sidebar is its own state, not `editing`. The two lists show
     the same segment, and sharing one id would open the transcript's editor at
     the same time — two textareas over one record, whichever blurred last
     winning. */
  const [editingUncertain, setEditingUncertain] = useState<string | null>(null);
  /** The strip of shortcuts under the player. Useful the first few times and
   *  then just a line of text in the way, so it can be dismissed; Settings
   *  brings it back. Kept beside the panel's own preference rather than in the
   *  database — it is a habit of this machine, not of the archive. */
  const [tipsVisible, setTipsVisible] = useState(
    () => localStorage.getItem("rychle-tipy") !== "skryte"
  );
  const hideTips = useCallback(() => {
    localStorage.setItem("rychle-tipy", "skryte");
    setTipsVisible(false);
  }, []);
  // The panel is remembered between recordings: whoever closes it wants quiet.
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem("panel") !== "zavreny"
  );
  // The source file may have been deleted after transcription — the text
  // stays in the database, but there is nothing to play.
  const [sourceMissing, setSourceMissing] = useState(false);
  const [dictionarySuggestion, setDictionarySuggestion] = useState<{ z: string; na: string } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- nacteni
  // Everything is gathered first and only then written to state.
  //
  // State used to be set piecemeal between `await`s, which on an hour-long
  // transcript meant three consecutive renders of a thousand-segment list.
  // Neither the dictionary nor the file check needs to wait for the segments;
  // both can be fetched alongside them.
  const load = useCallback(async () => {
    try {
      const d = await api.detail(id);
      // The transcription pipeline prepares the precise MP3 playback copy
      // itself. Starting the detail prewarm as well would run a second ffmpeg
      // conversion for the same source. Finished and legacy recordings still
      // use this best-effort fallback when their cache does not exist yet.
      if (d.recording.status !== "prepisuje") {
        preparePlaybackSource(id, d.recording.path);
      }
      const [dictionaryEntries, exists, aiStatus, settings, tools] = await Promise.all([
        api.dictionary(),
        api.fileExists(d.recording.path),
        api.aiEditStatus(id),
        api.loadSettings(),
        api.checkTools(),
      ]);
      setTitle(d.recording.title);
      setPath(d.recording.path);
      setDuration(d.recording.duration);
      setStatus(d.recording.status);
      setFolder(d.recording.folder);
      setError(d.recording.error ? userMessage(d.recording.error) : null);
      setLanguage(d.recording.language);
      setSegments(d.segments);
      setSpeakers(d.speakers);
      setNotes(d.notes);
      setDictionary(dictionaryEntries);
      setSourceMissing(!exists);
      setAiDocument(aiStatus.document);
      setAiOutputs(aiStatus.outputs);
      setAiRunning(aiStatus.running);
      setAiConfigured(!!settings.editor_model);
      setAiModel(tools.editor_model_id ?? settings.editor_model);
      setAiReady(!!settings.editor_model && tools.issues_editor.length === 0);
      setSpeakersReady(tools.issues_diarization.length === 0);
      if (aiStatus.running) {
        setAiProgress(aiStatus.progress ?? {
          recording_id: id,
          phase: "preparing",
          percent: 2,
          description: localMessage(t("detail.progress.preparingModel")),
        });
      }
    } catch (e) {
      onError(userMessage(e));
    }
  }, [id, onError, t, userMessage]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<AiEditProgress>("ai-edit:progress", (event) => {
      if (!active || event.payload.recording_id !== id) return;
      setAiProgress(event.payload);
      const terminal = ["complete", "error", "cancelled"].includes(event.payload.phase);
      setAiRunning(!terminal);
      if (event.payload.phase === "complete") {
        api.aiEditStatus(id).then((status) => {
          if (!active) return;
          setAiDocument(status.document);
          setAiOutputs(status.outputs);
          setAiDialog("preview");
        });
      } else if (event.payload.phase === "error") {
        onError(progressMessage(event.payload.description));
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [id, onError, progressMessage]);

  // Events can be emitted between starting the backend thread and resolving
  // the invoke call. Polling the small status object keeps the displayed phase
  // truthful even when that first event raced past the WebView listener.
  useEffect(() => {
    if (!aiRunning) return;
    let active = true;
    const refresh = async () => {
      try {
        const status = await api.aiEditStatus(id);
        if (!active) return;
        setAiRunning(status.running);
        if (status.progress) setAiProgress(status.progress);
        if (status.document) setAiDocument(status.document);
        setAiOutputs(status.outputs);
      } catch {
        /* The event listener still reports terminal errors. */
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [aiRunning, id]);

  // Reload after every terminal transcription state. Completion, cancellation,
  // and failure all change the persisted recording status behind this screen.
  useEffect(() => {
    if (["complete", "cancelled", "error"].includes(progress?.phase ?? "")) load();
  }, [progress?.phase, load]);

  // ---------------------------------------------------------------- player
  // Jump to the spot this screen was opened for, coming from search.
  //
  // Going through a ref is deliberate. The player context value changes on
  // every tick, and the seek function changes with it. Were it in the
  // dependencies, running audio would tear down and re-arm this effect
  // constantly — and the deferred jump would never get its turn.
  useEffect(() => {
    if (seekTime == null) return;
    // A short delay waits for the segments to render; without them there is
    // nowhere to scroll. Quietly: arriving from search should place the
    // cursor, not start playback.
    const t = setTimeout(() => updateCursor(seekTime), 200);
    return () => clearTimeout(t);
  }, [seekTime, updateCursor]);

  // When playback moves elsewhere, the cursor stays where it left off.
  //
  // Through a ref, and that is the whole point: the effect must not re-run
  // eight times a second, so a cleanup reading the clock directly would close
  // over whatever it said when this recording *took* the audio over — the
  // moment it started, not the moment it stopped.
  const lastPlayedTime = useRef(0);
  if (isCurrentRecording) lastPlayedTime.current = playerTime;
  useEffect(() => {
    if (!isCurrentRecording) return;
    return () => setLocalTime(lastPlayedTime.current);
  }, [isCurrentRecording]);

  // ---------------------------------------------------------------- klavesnice
  const uncertainSegments = useMemo(
    () => segments.filter((s) => (s.confidence ?? 1) < CONFIDENCE_THRESHOLD && !s.verified),
    [segments]
  );

  /* Blocks nobody could put a name to — the short interjections, "Yeah.",
     "Okay.", a third of a second each. The model is never asked about them
     because there is too little voice to describe, and the ones that sit
     between two blocks of one person are filled in on the way out of
     recognition. What is left is the genuinely ambiguous handful, and this
     list is where they stop being scattered through the transcript.

     Only when somebody has been recognised at all: before that every block is
     unassigned and a list of all of them says nothing. */
  const unassignedSegments = useMemo(
    () => (speakers.length > 0 ? segments.filter((s) => !s.speakers) : []),
    [segments, speakers]
  );

  /* What this recording was corrected on, in transcript order.
     Only segments whose original is known. A row here is `před → po`; one that
     cannot say what changed is not a correction, it is a paragraph — and a list
     where some rows are a two-word swap and others a whole block reads as
     broken rather than as varied. Segments edited before the archive had
     anywhere to keep the original are not listed, but they are not lost: the
     transcript still marks each of them with its pencil. */
  const editedSegments = useMemo(
    () => segments.filter((s) => s.edited && s.original !== null),
    [segments]
  );

  const goTo = useCallback(
    (segment: Segment) => {
      // Quietly: stepping through uncertain spots is reading, not listening.
      updateCursor(segment.start);
      document
        .getElementById(`segment-${segment.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [updateCursor]
  );

  /* An interjection is clicked in order to *hear* it — a third of a second of
     text says nothing about whose voice it is. Same reasoning as a note's time
     chip, and the opposite of `goTo`, which stays quiet because stepping
     through uncertain spots is reading. */
  const hear = useCallback(
    (segment: Segment) => {
      document
        .getElementById(`segment-${segment.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      playFrom(segment.start);
    },
    [playFrom]
  );

  const goToNextUncertain = useCallback(() => {
    if (uncertainSegments.length === 0) return;
    goTo(uncertainSegments.find((s) => s.start > time + 0.05) ?? uncertainSegments[0]);
  }, [uncertainSegments, time, goTo]);

  const goToNote = useCallback((noteTime: number) => {
    // The transcript follows to the note's place, but the position played is
    // the note's own — not the start of the segment that happens to contain it.
    const exact = segments.find((segment) => segment.start <= noteTime && noteTime < segment.end);
    const previous = [...segments].reverse().find((segment) => segment.start <= noteTime);
    const target = exact ?? previous;
    if (target) {
      document
        .getElementById(`segment-${target.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    playFrom(noteTime);
  }, [playFrom, segments]);

  /* A clamped note unrolls on hover, and CSS can only ease between two lengths
     it knows. The full height of wrapped text is not one of them, so it is
     measured here — `scrollHeight` reports the whole text even while the clamp
     is showing three lines of it — and handed to the stylesheet. The sidebar
     can be resized and a note can be rewritten, so it is measured again
     whenever either changes. */
  const notesListRef = useRef<HTMLUListElement | null>(null);
  useLayoutEffect(() => {
    const list = notesListRef.current;
    if (!list) return;
    const measure = () => {
      list.querySelectorAll<HTMLElement>(".sticky-text").forEach((text) => {
        const full = `${text.scrollHeight}px`;
        // Only on change: the observer watches the list this may resize.
        if (text.style.getPropertyValue("--sticky-full") !== full) {
          text.style.setProperty("--sticky-full", full);
        }
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [notes, openNoteId, addingNote, openSections.notes]);

  const toggleSection = useCallback((name: SidebarSectionName) => {
    setOpenSections((current) => {
      const next = { ...current, [name]: !current[name] };
      localStorage.setItem("sidebar-sections", JSON.stringify(next));
      return next;
    });
  }, []);

  const beginNote = useCallback(() => {
    // A new note starts loose. Most remarks are about the recording, not about
    // one second of it, and pinning is one click away when it is not.
    setNoteDraft("");
    setNoteDraftTime(null);
    setOpenNoteId(null);
    setAddingNote(true);
  }, []);

  /** A note about this exact moment, written from the transcript rather than
   *  from the sidebar: the note arrives pinned, and the panel opens on it. */
  const beginNoteAt = useCallback((time: number) => {
    setNoteDraft("");
    setNoteDraftTime(time);
    setOpenNoteId(null);
    setAddingNote(true);
    setOpenSections((current) => {
      const next = { ...current, notes: true };
      localStorage.setItem("sidebar-sections", JSON.stringify(next));
      return next;
    });
    setPanelOpen((open) => {
      if (!open) localStorage.setItem("panel", "otevreny");
      return true;
    });
  }, []);

  const cancelNote = useCallback(() => {
    setAddingNote(false);
    setNoteDraft("");
    setNoteDraftTime(null);
  }, []);

  const addNote = useCallback(async () => {
    const text = noteDraft.trim();
    if (!text) return;
    try {
      const note = await api.addRecordingNote(id, noteDraftTime, text);
      setNotes((current) => [...current, note].sort(byNoteOrder));
      setAddingNote(false);
      setNoteDraft("");
      setNoteDraftTime(null);
    } catch (error) {
      onError(userMessage(error));
    }
  }, [id, noteDraft, noteDraftTime, onError, userMessage]);

  /** Pins a saved note to a moment, or takes it off the timeline entirely. */
  const setNoteTime = useCallback(async (note: RecordingNote, next: number | null) => {
    const updated = { ...note, time: next };
    setNotes((current) => current
      .map((item) => item.id === note.id ? updated : item)
      .sort(byNoteOrder));
    try {
      await api.updateRecordingNote(updated.id, updated.time, updated.text, updated.done);
    } catch (error) {
      onError(userMessage(error));
      await load();
    }
  }, [load, onError, userMessage]);

  const saveNote = useCallback(async (note: RecordingNote) => {
    const text = note.text.trim();
    if (!text) {
      await load();
      return;
    }
    try {
      await api.updateRecordingNote(note.id, note.time, text, note.done);
      setNotes((current) => current.map((item) =>
        item.id === note.id ? { ...item, text } : item
      ));
    } catch (error) {
      onError(userMessage(error));
      await load();
    }
  }, [load, onError, userMessage]);


  const saveNoteTime = useCallback(async (note: RecordingNote, value: string) => {
    const parsedTime = parseNoteTime(value);
    setNoteTimeDrafts((current) => {
      const next = { ...current };
      delete next[note.id];
      return next;
    });
    if (parsedTime === null || (duration > 0 && parsedTime > duration)) return;

    const updated = { ...note, time: parsedTime };
    setNotes((current) => current
      .map((item) => item.id === note.id ? updated : item)
      .sort(byNoteOrder));
    try {
      await api.updateRecordingNote(updated.id, updated.time, updated.text, updated.done);
    } catch (error) {
      onError(userMessage(error));
      await load();
    }
  }, [duration, load, onError, userMessage]);

  const deleteNote = useCallback(async (note: RecordingNote) => {
    setNotes((current) => current.filter((item) => item.id !== note.id));
    try {
      await api.deleteRecordingNote(note.id);
    } catch (error) {
      onError(userMessage(error));
      setNotes((current) => [...current, note].sort(byNoteOrder));
    }
  }, [onError, userMessage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);
      /* A control the browser already owns: Space activates a button, a
         checkbox, a link, a summary. Taking it to start the audio instead
         means the control silently does nothing — and on the shared `Select`
         it did both at once. */
      const onAControl =
        target?.closest("button, a[href], select, summary, [role='button'], [tabindex]") != null;
      /* A dialog is the top of the stack and its keys are its own. This
         listener sits on the window and used to fire straight through one:
         with a confirmation on screen, Space played audio behind it. */
      const dialogOpen = document.querySelector(".prekryv-dialogu") != null;

      if (isTyping || dialogOpen) {
        if (e.key === "Escape" && !dialogOpen) setEditing(null);
        return;
      }

      if (e.code === "Space" && !onAControl) {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === "F3") {
        /* Not Tab. Tab belongs to the browser, and taking it disabled the
           keyboard on the whole screen — back, the title menu, both document
           actions, the sidebar and every control in it were unreachable, and
           because this listener is on the window it did the same behind open
           dialogs. F3 is the conventional "find next" and collides with
           nothing here. */
        e.preventDefault();
        goToNextUncertain();
      } else if (e.key === "Escape") {
        setEditing(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayback, goToNextUncertain]);

  const locateSourceFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: t("detail.source.fileFilter"),
          extensions: ["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "mp4", "mkv", "mov"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    try {
      await api.changeRecordingPath(id, selected);
      await load();
    } catch (e) {
      onError(userMessage(e));
    }
  }, [id, load, onError, t, userMessage]);

  const startTranscription = useCallback(async () => {
    // Only once the shell says a run began. It may open a confirmation or the
    // speaker question first, and declining either used to leave this screen
    // busy for ever: a bubble frozen at zero, no player, no actions, and a
    // cancel button the backend answers with "nothing is running".
    if (!(await onTranscribe(id))) return;
    setStatus("prepisuje");
    // Clear the previous failure, or the old message would linger under a
    // progress bar for a run that is going fine.
    setError(null);
  }, [id, onTranscribe]);

  const startTranscriptionInLanguage = useCallback(async (selectedLanguage: string) => {
    if (!(await onTranscribe(id, selectedLanguage))) return;
    setLanguage(selectedLanguage);
    setStatus("prepisuje");
    setError(null);
  }, [id, onTranscribe]);

  const saveRecordingTitle = useCallback(async (value: string) => {
    const trimmed = value.trim();
    setRenamingTitle(false);
    if (!trimmed || trimmed === title) return;
    try {
      await api.renameRecording(id, trimmed);
      setTitle(trimmed);
      player.updateTitle(id, trimmed);
    } catch (e) {
      onError(userMessage(e));
    }
  }, [id, onError, player, title, userMessage]);

  const cancelTranscription = useCallback(async () => {
    try {
      await api.cancelTranscription(id);
    } catch (error) {
      onError(userMessage(error));
    }
  }, [id, onError, userMessage]);

  const startEditing = useCallback((segment: Segment) => {
    setEditing(segment.id);
  }, []);

  /** What was pointed at, and where the menu should appear. */
  const [transcriptMenu, setTranscriptMenu] = useState<
    { x: number; y: number; segment: Segment; time: number } | null
  >(null);

  const openTranscriptMenu = useCallback((segment: Segment, event: ReactMouseEvent) => {
    event.preventDefault();
    // The word carries its own moment; the block start is the fallback for
    // the gaps between words and for transcripts with no word timings.
    const word = (event.target as HTMLElement).closest<HTMLElement>(".slovo");
    const spoken = Number(word?.dataset.time);
    setTranscriptMenu({
      x: event.clientX,
      y: event.clientY,
      segment,
      time: Number.isFinite(spoken) ? spoken : segment.start,
    });
  }, []);

  const copyFromTranscript = useCallback(async (segment: Segment) => {
    // A selection is an explicit request for exactly that text; without one
    // the block is what was pointed at.
    const selected = window.getSelection()?.toString().trim();
    try {
      await copyPlainText(selected || segment.text);
      onInfo(t("detail.menu.copied"));
    } catch {
      onError(t("detail.preview.copyFailed"));
    }
  }, [onError, onInfo, t]);

  const confirm = useCallback(async (segment: Segment) => {
    setSegments((p) =>
      p.map((x) => (x.id === segment.id ? { ...x, verified: true } : x))
    );
    try {
      await api.markVerified(segment.id, true);
    } catch (e) {
      onError(userMessage(e));
    }
  }, [onError, userMessage]);

  // ---------------------------------------------------------------- editace
  const saveText = useCallback(
    async (segment: Segment, newText: string) => {
      const trimmedText = newText.trim();
      setEditing(null);
      if (trimmedText === segment.text) return;

      try {
        await api.updateSegment(segment.id, trimmedText);
        setSegments((s) =>
          s.map((x) =>
            x.id === segment.id
              ? // `words` has to go, not just be left alone. The segment is
                // rendered from the stored word timings, not from `text` —
                // that is what makes clicking a word seek the audio. Keep
                // them and the screen goes on showing the old wording, even
                // though the new one is already saved. The backend drops them
                // for the same reason; this mirrors it so the change is
                // visible at once instead of after a reload.
                //
                // `original` mirrors the backend's COALESCE for the same
                // reason: the first rewrite records what the machine wrote,
                // later ones leave that record alone. Without it the Opravy
                // list — which only shows segments whose original is known —
                // learned about a fresh correction only after a reload.
                {
                  ...x,
                  text: trimmedText,
                  edited: true,
                  verified: true,
                  words: null,
                  original: x.original ?? x.text,
                }
              : x
          )
        );
        setAiDocument((document) => document ? { ...document, stale: true } : null);

        // Kdyz se zmenilo prave jedno slovo, nabidneme to zapamatovat.
        // Slovnik tak roste sam pouzivanim, misto aby ho nekdo musel plnit.
        const old = segment.text.split(/\s+/);
        const newWords = trimmedText.split(/\s+/);
        if (old.length === newWords.length) {
          const differences = old
            .map((w, i) => [w, newWords[i]] as const)
            .filter(([a, b]) => a !== b);
          if (differences.length === 1) {
            const [z, na] = differences[0];
            const cleanWord = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
            const zz = cleanWord(z);
            const nn = cleanWord(na);
            const alreadyExists = dictionary.some((p) => p.find.toLowerCase() === zz.toLowerCase());
            if (zz && nn && zz.toLowerCase() !== nn.toLowerCase() && !alreadyExists) {
              setDictionarySuggestion({ z: zz, na: nn });
            }
          }
        }
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [dictionary, onError, userMessage]
  );

  const confirmDictionary = useCallback(async () => {
    if (!dictionarySuggestion) return;
    const { z, na } = dictionarySuggestion;
    setDictionarySuggestion(null);
    try {
      const p = await api.addDictionaryEntry(z, na);
      setDictionary((s) => [...s, p]);
      // The dictionary used to take effect only in the next transcription.
      // The same word usually occurs several times in a recording, and fixing
      // each by hand is wasted work.
      const changesApplied = await api.applyDictionary(id);
      if (changesApplied > 0) await load();
      // Always report, even when nothing else changed. Without confirmation
      // there is no telling whether the term was saved at all.
      // Zero is not a grammatical form of the sentence below, it is a different
      // sentence, so it keeps its own key.
      onInfo(
        changesApplied === 0
          ? t("detail.dictionary.savedNoOther", { from: z, to: na })
          : tPlural("detail.dictionary.savedApplied", changesApplied, { from: z, to: na })
      );
    } catch (e) {
      onError(userMessage(e));
    }
  }, [dictionarySuggestion, id, load, onError, onInfo, t, tPlural, userMessage]);

  // ---------------------------------------------------------------- mluvci
  const speakerByKey = useMemo(() => {
    const m = new Map<string, Speaker>();
    speakers.forEach((x) => m.set(x.key, x));
    return m;
  }, [speakers]);

  // ------------------------------------------------------- oprava mluvciho
  //
  // The machine gets a block wrong now and then, and until this existed there
  // was nothing to do about it: naming can join two groups that are one person,
  // but nothing could move a single block. On a five-person recording that is
  // the difference between a transcript you fix in a minute and one you cannot
  // fix at all.

  /** The nearest block above or below that somebody else is speaking. */
  const neighbourVoice = useCallback(
    (segment: Segment, step: -1 | 1) => {
      const at = segments.findIndex((s) => s.id === segment.id);
      if (at < 0) return null;
      for (let i = at + step; i >= 0 && i < segments.length; i += step) {
        const key = segments[i].speakers;
        if (key && key !== segment.speakers) {
          return { key, name: speakerByKey.get(key)?.name ?? key };
        }
      }
      return null;
    },
    [segments, speakerByKey]
  );

  const giveToVoice = useCallback(
    async (segment: Segment, key: string) => {
      setSegments((p) =>
        p.map((x) => (x.id === segment.id ? { ...x, speakers: key } : x))
      );
      try {
        await api.setSegmentSpeaker(segment.id, key);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, userMessage]
  );

  /// A passage that belongs to somebody the machine never found. The panel has
  /// always been able to join two groups that are one person; this is the
  /// direction it was missing.
  const giveToNewVoice = useCallback(
    async (segment: Segment) => {
      try {
        const voice = await api.addSpeaker(id);
        setSpeakers((p) => [...p, voice]);
        setSegments((p) =>
          p.map((x) => (x.id === segment.id ? { ...x, speakers: voice.key } : x))
        );
        await api.setSegmentSpeaker(segment.id, voice.key);
        // Open the panel on it: the name it was given is a placeholder, and
        // renaming it is the next thing anybody will want to do.
        setOpenSections((s) => ({ ...s, speakers: true }));
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [id, onError, userMessage]
  );


  /** What is in the field. Typing is not a decision, so it goes no further
   *  than the screen. */
  const renameLocally = useCallback((key: string, name: string) => {
    setSpeakers((s) => s.map((m) => (m.key === key ? { ...m, name } : m)));
  }, []);

  /** What the name was when the field was entered, so that leaving it without
   *  changing anything writes nothing. */
  const nameAtFocus = useRef("");

  /** Saving is what leaving the field means.
   *
   *  It used to save on every keystroke: writing "Pavel" was five IPC calls,
   *  five database writes, and five times marking the improved document stale.
   *  The dictionary in Settings has always saved on blur; this now matches it.
   *  Merging by name comes after the save, so the name the merge is judged on
   *  is the one that was stored. */
  const commitName = useCallback(
    async (key: string, name: string) => {
      if (name === nameAtFocus.current) return;
      nameAtFocus.current = name;
      setAiDocument((document) => (document ? { ...document, stale: true } : null));
      try {
        await api.renameSpeaker(id, key, name);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [id, onError, userMessage]
  );

  /* The names typed before the run, still waiting for a voice. They appear
     under whichever row is being named, never under all of them at once: with
     five voices and five names that would be twenty-five buttons, and only one
     of them is ever the answer to the question in front of you. */
  const [namePool, setNamePool] = useState<string[]>(() => speakerNamesFor(id));
  const [naming, setNaming] = useState<string | null>(null);
  useEffect(() => {
    setNamePool(speakerNamesFor(id));
  }, [id]);

  const takeName = useCallback(
    async (key: string, name: string) => {
      renameLocally(key, name);
      await commitName(key, name);
      forgetSpeakerName(id, name);
      setNamePool((pool) => pool.filter((n) => n !== name));
      setNaming(null);
    },
    [commitName, id, renameLocally]
  );

  const merge = useCallback(
    async (z: string, toKey: string) => {
      try {
        await api.mergeSpeakers(id, z, toKey);
        await load();
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [id, load, onError, userMessage]
  );

  /** Two speakers given the same name are one person.
   *
   *  Merging used to be a menu of keys — `Mluvčí 3` into `Mluvčí 6` — which
   *  asks the reader to remember which number was whom. Naming is the step
   *  they were going to take anyway, so it carries the merge: type the name
   *  you already typed on another row and the two become one.
   *
   *  Runs when the field is left, never mid-typing, or `Pa` would merge into
   *  `Pavel` on the way to `Paul`.
   */
  const mergeByName = useCallback(
    (key: string, typed: string) => {
      const name = typed.trim();
      if (!name) return;
      const twin = speakers.find(
        (other) =>
          other.key !== key && other.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      if (twin) void merge(key, twin.key);
    },
    [speakers, merge]
  );

  const togglePanel = useCallback(() => {
    setPanelOpen((o) => {
      localStorage.setItem("panel", o ? "zavreny" : "otevreny");
      return !o;
    });
  }, []);

  const diarizeSpeakers = useCallback(() => onDiarize(id), [id, onDiarize]);

  // ---------------------------------------------------------------- export
  const openAiAction = useCallback(async () => {
    // A generated document remains useful even if the source transcript or
    // selected model changed later. Let the user inspect and save it first;
    // regeneration is a separate, explicit choice inside the preview.
    if (aiDocument) {
      setPreviewTab("improved");
      setAiDialog("preview");
      return;
    }
    if (!aiConfigured || !aiReady) {
      setAiDialog("missing");
      return;
    }
    setAiMode("faithful");
    setAiDialog("configure");
  }, [aiConfigured, aiReady, aiDocument]);

  const startAiEdit = useCallback(async () => {
    // Separating speakers is not a language-model pass at all; it shares this
    // dialog because from the reader's side both are "let the machine work on
    // this recording". It therefore runs its own way out of here.
    if (aiMode === "speakers") {
      setAiDialog(null);
      if (!speakersReady) {
        onToModule("sherpa");
        return;
      }
      void diarizeSpeakers();
      return;
    }
    setAiDialog(null);
    setAiRunning(true);
    setAiProgress({
      recording_id: id,
      phase: "preparing",
      percent: 2,
      description: localMessage(t("detail.progress.preparingModel")),
    });
    try {
      await api.startAiEdit(id, aiMode);
      const status = await api.aiEditStatus(id);
      setAiRunning(status.running);
      if (status.progress) setAiProgress(status.progress);
    } catch (error) {
      setAiRunning(false);
      onError(userMessage(error));
    }
  }, [aiMode, diarizeSpeakers, id, onError, onToModule, speakersReady, t, userMessage]);

  const startAiOutput = useCallback(async (
    kind: "summary" | "translation",
    variant: string
  ) => {
    if (!aiConfigured || !aiReady) {
      setAiDialog("missing");
      return;
    }
    setAiDialog(null);
    setAiRunning(true);
    setAiProgress({
      recording_id: id,
      phase: "preparing",
      percent: 2,
      description: localMessage(
        kind === "summary"
          ? t("detail.progress.preparingSummary")
          : t("detail.progress.preparingTranslation")
      ),
    });
    try {
      await api.startAiOutput(id, kind, variant);
      const status = await api.aiEditStatus(id);
      setAiRunning(status.running);
      setAiOutputs(status.outputs);
      if (status.progress) setAiProgress(status.progress);
    } catch (error) {
      setAiRunning(false);
      onError(userMessage(error));
    }
  }, [aiConfigured, aiReady, id, onError, t, userMessage]);

  const openOriginalPreview = useCallback(async () => {
    setPreviewTab("original");
    if (originalPreview) return;
    try {
      setOriginalPreview(await api.exportPreview(id, "txt"));
    } catch (error) {
      onError(userMessage(error));
    }
  }, [id, onError, originalPreview, userMessage]);

  const saveAiExport = useCallback(
    async (format: "txt" | "md") => {
      try {
        const name = await api.suggestedAiName(id, format);
        const destination = await save({ defaultPath: name });
        if (!destination) return;
        await api.saveAiDocument(id, format, destination);
        onInfo(t("detail.saved.improved", { path: destination }));
      } catch (error) {
        onError(userMessage(error));
      }
    },
    [id, onError, onInfo, t, userMessage]
  );

  const saveAiOutput = useCallback(async (
    kind: "summary" | "translation",
    variant: string,
    format: "txt" | "md"
  ) => {
    try {
      const name = await api.suggestedAiOutputName(id, kind, variant, format);
      const destination = await save({ defaultPath: name });
      if (!destination) return;
      await api.saveAiOutput(id, kind, variant, format, destination);
      // A whole sentence per kind. Czech declines the verb with the noun, so
      // there is nothing here to assemble from two halves.
      onInfo(t(
        kind === "summary" ? "detail.saved.summary" : "detail.saved.translation",
        { path: destination }
      ));
    } catch (error) {
      onError(userMessage(error));
    }
  }, [id, onError, onInfo, t, userMessage]);

  const exportRecording = useCallback(
    async (format: string) => {
      try {
        const name = await api.suggestedName(id, format);
        const destination = await save({ defaultPath: name });
        if (!destination) return;
        await api.saveExport(id, format, destination);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [id, onError, userMessage]
  );

  // ---------------------------------------------------------------- render
  /* Busy is a fact about the run, not about the click that may have started
     it. The local status covers the moment between starting and the first
     event; the phase covers a run this screen did not start — from the
     archive, from the watched folder, or after a confirmation was accepted. */
  const running =
    status === "prepisuje" ||
    (progress != null && !["complete", "cancelled", "error"].includes(progress.phase));
  // The segment that last began, rather than the one the playhead sits
  // inside. Between two sentences there is a pause that belongs to neither,
  // and demanding a strict match made the highlight blink out for it before
  // reappearing a line lower. Holding the previous line until the next one
  // starts turns that flicker into a plain step down the page.
  //
  // Binary search rather than a scan: this runs on every frame of playback,
  // and segments arrive ordered by their position in the recording.
  const active = useMemo(() => {
    let low = 0;
    let high = segments.length - 1;
    let found: Segment | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (segments[middle].start <= time) {
        found = segments[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }, [segments, time]);

  // Keep the active segment on screen, but only while audio is actually
  // playing — during reading and editing, self-scrolling gets in the way.
  //
  // And only when it is genuinely out of sight. Clicking a word in the middle
  // of the screen used to re-centre the whole transcript for no reason; now
  // the text under your hand moves only when it would otherwise disappear.
  useEffect(() => {
    if (!isPlaying || !active) return;
    const element = document.getElementById(`segment-${active.id}`);
    const list = listRef.current;
    if (!element || !list) return;

    const box = element.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    // Band near the edges where a segment counts as "on its way out".
    const margin = Math.min(120, view.height * 0.15);
    if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active?.id, isPlaying]);

  // Language names come from the shared dictionary, so a language change moves
  // them too — a module constant would keep whatever it was born with.
  const translationLanguageItems = useMemo(
    () => TRANSLATION_LANGUAGES.map((code) => ({
      value: code,
      label: labels.languageCapitalized(code),
    })),
    [labels]
  );

  const summaryOutput = aiOutputs.find(
    (output) => output.kind === "summary" && output.variant === summaryLength
  );
  const translationOutput = aiOutputs.find(
    (output) => output.kind === "translation" && output.variant === translationLanguage
  );
  const previewText = previewTab === "improved"
    ? aiDocument?.text ?? ""
    : previewTab === "original"
      ? originalPreview
      : previewTab === "summary"
        ? summaryOutput?.text ?? ""
        : translationOutput?.text ?? "";

  const copyPreviewText = async () => {
    if (!previewText.trim()) return;
    try {
      await copyPlainText(previewText);
      // One whole sentence per document, not a name glued in front of a verb:
      // the verb agrees with the noun.
      onInfo(t(
        previewTab === "improved"
          ? "detail.copied.improved"
          : previewTab === "original"
            ? "detail.copied.original"
            : previewTab === "summary"
              ? "detail.copied.summary"
              : "detail.copied.translation"
      ));
    } catch (error) {
      onError(error instanceof ClipboardRefused
        ? t("detail.preview.copyFailed")
        : userMessage(error));
    }
  };

  const savePreview = async (format: "txt" | "md") => {
    if (previewTab === "improved") {
      await saveAiExport(format);
    } else if (previewTab === "original") {
      await exportRecording(format);
    } else if (previewTab === "summary") {
      await saveAiOutput("summary", summaryLength, format);
    } else {
      await saveAiOutput("translation", translationLanguage, format);
    }
  };

  return (
    <main className="detail">
      <div className="detail-hlavicka">
        <div ref={headerLeftRef} className="detail-hlavicka-levo">
          <span className="detail-znacka header-brand-mark" aria-hidden>
            <span
              className="logotyp"
              dangerouslySetInnerHTML={{ __html: mark }}
            />
          </span>
          <button className="tlacitko tichy detail-back-button" onClick={onBack}>
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
              <path d="M6 1L1 6l5 5M1 6h12" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("common.archive")}
          </button>
          {/* The name is changed in the shared dialog, the same one that names
              a folder. The header keeps one shape whether or not a rename is
              under way. */}
          <NameDialog
            open={renamingTitle}
            title={t("dialogs.rename.title")}
            text={t("dialogs.rename.text")}
            label={t("dialogs.rename.label")}
            placeholder={t("dialogs.rename.placeholder")}
            submitLabel={t("common.save")}
            initialName={title || fileName(path)}
            onClose={() => setRenamingTitle(false)}
            onSubmit={(name) => void saveRecordingTitle(name)}
          />
          {(
            <>
              <h1 className="detail-nazev">
                <span className={`znak detail-status ${status}`} aria-hidden />
                <span className="detail-jmeno">{title || fileName(path)}</span>
              </h1>
              {!running && !diarizing && (
                <RecordingActionsMenu
                  className="detail-title-menu"
                  status={status}
                  onRename={() => setRenamingTitle(true)}
                  onExportAudio={onExportAudio}
                  folders={folders}
                  folder={folder}
                  onMoveToFolder={onMoveToFolder}
                  onCreateFolderFor={onCreateFolderFor}
                  onRetranscribe={startTranscription}
                  onDeleteTranscript={() => setConfirmation({
                    nadpis: t("detail.header.deleteTranscriptTitle"),
                    text: t("detail.header.deleteTranscriptText", { title: title || fileName(path) }),
                    confirm: t("detail.header.deleteTranscriptConfirm"),
                    nicive: true,
                    action: async () => {
                      await api.deleteTranscription(id);
                      await load();
                    },
                  })}
                  onTranscribeInLanguage={(selectedLanguage) =>
                    startTranscriptionInLanguage(selectedLanguage)
                  }
                  onRemove={() => setConfirmation({
                    nadpis: t("detail.header.removeTitle"),
                    text: t("detail.header.removeText", { title: title || fileName(path) }),
                    confirm: t("detail.header.removeConfirm"),
                    nicive: true,
                    action: async () => {
                      await api.deleteRecording(id);
                      if (player.recordingId === id) player.close();
                      onBack();
                    },
                  })}
                />
              )}
            </>
          )}
        </div>
        <div className="detail-akce">
          {/* Detail replaces the application header, so its right-edge pills
              must reappear here: the mini player whenever a different
              recording than this one is playing — the full player covers only
              the open recording — and a take minimised out of the dialog,
              which would otherwise record with no sign of it on the whole
              screen. */}
          {player.recordingId && player.recordingId !== id && (
            <MiniPlayer
              compact={pillsCompact}
              onOpen={() => {
                if (player.recordingId) onOpenRecording(player.recordingId);
              }}
            />
          )}
          <MiniRecorder onOpen={onOpenRecorder} />
          <button
            className={`tlacitko ai-edit-button ${aiDocument ? "ready" : ""}`}
            onClick={openAiAction}
            disabled={segments.length === 0 || running || aiRunning}
            title={aiDocument?.stale ? t("detail.header.staleHint") : undefined}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 1.5 9 5l3.5 1L9 7l-1 3.5L7 7 3.5 6 7 5l1-3.5ZM12.5 10l.55 1.95L15 12.5l-1.95.55L12.5 15l-.55-1.95L10 12.5l1.95-.55L12.5 10Z"
                    stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
            </svg>
            {aiDocument
              ? t("detail.header.improvedButton")
              : t("detail.header.improveButton")}
          </button>
          {/* Pět zkratek formátů vedle sebe vypadalo jako panel nástrojů
              a přebíjelo název souboru. Uložení je přitom jedna akce. */}
          <ExportMenu
            disabled={segments.length === 0}
            onChoose={exportRecording}
            hasAiDocument={!!aiDocument && !aiDocument.stale}
            onChooseAi={saveAiExport}
          />
          <button
            className="ikona-tlacitko header-icon-button"
            onClick={onNew}
            aria-label={t("detail.header.newTranscript")}
            title={t("detail.header.newTranscript")}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
              <path d="M7.5 2v11M2 7.5h11" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="ikona-tlacitko header-icon-button"
            onClick={onSettings}
            aria-label={t("common.settings")}
            title={t("common.settings")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M2 4.5h3.2M8.8 4.5H14M2 11.5h6.2M11.8 11.5H14"
                    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="7" cy="4.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="11.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {running || diarizing ? (
        <ProgressBubble
          variant="transcription"
          description={
            progress
              ? progressMessage(progress.description)
              : diarizing
                ? t("detail.progress.diarizing")
                : t("detail.progress.transcribing")
          }
          percent={progress?.percent ?? 0}
          /* Recognising speakers can be stopped too. It used to have no way
             out at all, and on a long recording it is the slowest thing this
             application does. */
          onCancel={() => void cancelTranscription()}
          cancelLabel={
            diarizing
              ? t("detail.progress.cancelDiarization")
              : t("detail.progress.cancelTranscription")
          }
        />
      ) : aiRunning ? (
        <ProgressBubble
          variant="language"
          description={
            aiProgress ? progressMessage(aiProgress.description) : t("detail.progress.editing")
          }
          percent={aiProgress?.percent ?? 0}
          onCancel={() => void api.cancelAiEdit(id)}
          cancelLabel={t("detail.progress.cancelAi")}
        />
      ) : null}

      {status === "nova" && !sourceMissing ? (
        /* The strip only states the situation. The call to action stands in
           the middle of the empty transcript area — where the text will be —
           so the fact and the button are not said twice. */
        <div className="prehravac prehravac-vyzva">
          <InfoNote compact>{t("detail.empty.notTranscribed")}</InfoNote>
        </div>
      ) : status === "chyba" && segments.length === 0 && !sourceMissing ? (
        /* A transcription that failed or was interrupted. Without a way out
           from here, the only route back would be the library. */
        <div className="prehravac prehravac-vyzva">
          <span>{error || t("detail.empty.failed")}</span>
          <button className="tlacitko hlavni" onClick={startTranscription}>
            {t("common.retry")}
          </button>
        </div>
      ) : sourceMissing ? (
        /* The transcript stays usable without audio; it just cannot be played. */
        <div className="prehravac prehravac-chybi">
          <span>{t("detail.source.missing")}</span>
          <button className="tlacitko" onClick={locateSourceFile}>
            {t("detail.source.locate")}
          </button>
        </div>
      ) : running || diarizing ? null : (
        <PlaybackControls
          isCurrentRecording={isCurrentRecording}
          waveform={waveform}
          time={time}
          duration={trackDuration}
          isPlaying={isPlaying}
          onPlayPauza={togglePlayback}
          /* Dragging the slider does not start audio, it only moves the cursor. */
          onSeek={updateCursor}
          trailingControl={(
            <button
              className="ikona-tlacitko"
              onClick={togglePanel}
              aria-pressed={panelOpen}
              aria-label={panelOpen ? t("detail.player.hidePanel") : t("detail.player.showPanel")}
              title={panelOpen ? t("detail.player.hidePanel") : t("detail.player.showPanel")}
            >
              <svg width="17" height="15" viewBox="0 0 17 15" aria-hidden>
                <rect x="0.75" y="0.75" width="15.5" height="13.5" rx="3"
                      fill="none" stroke="currentColor" strokeWidth="1.4" />
                <line x1="11" y1="0.75" x2="11" y2="14.25"
                      stroke="currentColor" strokeWidth="1.4" />
                {panelOpen && (
                  <rect x="11" y="0.75" width="5.25" height="13.5"
                        fill="currentColor" opacity="0.25" />
                )}
              </svg>
            </button>
          )}
        />
      )}

      {/* Nobody discovers the shortcuts otherwise, and Tab is the most useful
          thing this screen does. */}
      {segments.length > 0 && tipsVisible && (
        <div className="zkratky">
          <span className="zkratky-nadpis">{t("detail.tips.title")}</span>
          {/* A shortcut is a key and what it does, not a sentence: the key name
              sits in <kbd> and the action beside it. */}
          <span><kbd>{t("detail.tips.spaceKey")}</kbd> {t("detail.tips.spaceAction")}</span>
          <span><kbd>{t("detail.tips.clickKey")}</kbd> {t("detail.tips.clickAction")}</span>
          <span>
            <kbd>{t("detail.tips.doubleClickKey")}</kbd> {t("detail.tips.doubleClickAction")}
          </span>
          <span className="zkratka-duraz">
            <kbd>{t("detail.tips.tabKey")}</kbd> {t("detail.tips.tabAction")}
          </span>
          <button
            className="zkratky-skryt"
            onClick={hideTips}
            aria-label={t("detail.tips.hide")}
            title={t("detail.tips.hideHint")}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor"
                    strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <div className={`detail-telo ${panelOpen ? "" : "bez-panelu"}`}>
        <div className="prepis" ref={listRef}>

          {running && segments.length === 0 && (
            /* No placeholder while the first words are still on their way —
               the progress bubble already says what is happening, and a serif
               `Příprava…` sitting where the transcript will be read as part
               of it. The area simply stays empty until text arrives. */
            <div className="zivy-prepis">
              {liveSegments.map((s, i) => (
                <p key={i}>{s.text}</p>
              ))}
            </div>
          )}

          {segments.map((s, i) => {
            const previous = segments[i - 1];
            const newSpeakers = s.speakers !== (previous?.speakers ?? null);
            const m = s.speakers ? speakerByKey.get(s.speakers) : undefined;
            return (
              <div key={s.id}>
                {newSpeakers && m && (
                  <div className="mluvci-hlavicka" style={{ color: m.color }}>
                    {m.name}
                  </div>
                )}
                {/* The handlers must not be created here. Were they built
                    fresh for every segment on every render, the `memo`
                    comparison would never pass and a ticking clock would
                    repaint the whole transcript. Hence the segment is passed
                    as an argument instead. */}
                <SegmentRow
                  segment={s}
                  active={active?.id === s.id}
                  time={time}
                  editing={editing === s.id}
                  color={m?.color}
                  onSeek={seek}
                  onStartUpravu={startEditing}
                  onConfirm={confirm}
                  onSave={saveText}
                  onContextMenu={openTranscriptMenu}
                />
              </div>
            );
          })}

          {!running && segments.length === 0 && (
            status === "nova" && !sourceMissing ? (
              /* The empty area names what it is for and offers the one action
                 that fills it. A missing source falls through to the plain
                 line: a file that is gone cannot be transcribed. */
              <div className="prepis-prazdny">
                <span className="prepis-prazdny-znak" aria-hidden>
                  <LineIcon name="transcription" />
                </span>
                <h2>{t("detail.empty.heading")}</h2>
                <button className="tlacitko hlavni" onClick={startTranscription}>
                  {t("detail.empty.transcribe")}
                </button>
              </div>
            ) : (
              <p className="drobne">{t("detail.empty.noTranscript")}</p>
            )
          )}
        </div>

        {panelOpen && (
        <aside className="postranni" aria-label={t("detail.sidebar.label")}>
          {/* One page, three lists. Each section keeps its own open state, so
              a reader who never names speakers can fold that section away and
              still see notes and uncertain places at the same time. */}
          <SidebarSection
            icon="speakers"
            title={t("detail.speakers.heading")}
            count={speakers.length}
            open={openSections.speakers}
            onToggle={() => toggleSection("speakers")}
            action={
              <button className="sidebar-text-action" onClick={diarizeSpeakers}
                      disabled={diarizing || running || segments.length === 0}>
                <LineIcon name="speakers" size={15} />
                {diarizing
                  ? t("detail.speakers.diarizing")
                  : speakers.length > 0
                    ? t("detail.speakers.diarizeAgain")
                    : t("detail.speakers.diarize")}
              </button>
            }
          >
            {speakers.length > 0 ? (
              <>
                <ul className="mluvci-seznam">
                  {speakers.map((speaker) => (
                    <li key={speaker.key}>
                      <button
                        type="button"
                        className="mluvci-ukazka"
                        style={{ background: speaker.color }}
                        title={t("detail.speakers.playSample")}
                        aria-label={t("detail.speakers.playSample")}
                        onClick={() => playSpeaker(speaker.key)}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                          <path d="M2.5 1.5 L8.5 5 L2.5 8.5 Z" fill="currentColor" />
                        </svg>
                      </button>
                      <input
                        value={speaker.name}
                        aria-label={t("detail.speakers.nameLabel")}
                        onChange={(event) => renameLocally(speaker.key, event.target.value)}
                        onFocus={(event) => {
                          nameAtFocus.current = event.target.value;
                          setNaming(speaker.key);
                        }}
                        onBlur={async (event) => {
                          const typed = event.target.value;
                          setNaming((k) => (k === speaker.key ? null : k));
                          await commitName(speaker.key, typed);
                          mergeByName(speaker.key, typed);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        spellCheck={false}
                      />
                      <span className="mluvci-podil">
                        {Math.round((speakerShare.get(speaker.key) ?? 0) * 100)} %
                      </span>
                      {naming === speaker.key && namePool.length > 0 && (
                        <div className="mluvci-jmena">
                          {namePool.map((name) => (
                            <button
                              key={name}
                              className="hlas-volba"
                              style={{ color: speaker.color, borderColor: speaker.color }}
                              /* Keeps the field focused, so the chips are still
                                 mounted when the click lands. */
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => void takeName(speaker.key, name)}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {speakers.length > 1 && (
                  <div className="mluvci-napoveda">
                    <InfoNote>{t("detail.speakers.nameHint")}</InfoNote>
                  </div>
                )}
              </>
            ) : (
              <SidebarEmpty>{t("detail.speakers.empty")}</SidebarEmpty>
            )}
          </SidebarSection>

          {/* Only where there is something to do. An empty list of a thing the
              reader has never heard of is worse than no section at all. */}
          {unassignedSegments.length > 0 && (
            <SidebarSection
              icon="unnamed"
              title={t("detail.unassigned.heading")}
              count={unassignedSegments.length}
              open={openSections.unassigned}
              onToggle={() => toggleSection("unassigned")}
            >
              <p className="sidebar-empty">{t("detail.unassigned.hint")}</p>
              <ul className="neprirazene">
                {unassignedSegments.map((s) => {
                  /* Only the two neighbours, not every voice in the recording.
                     A gap between two blocks of one person is already filled
                     by the backend, so what is left lies between two different
                     people — and the right answer is one of those two. Listing
                     all five under all thirty rows would be 150 buttons, and
                     none of the other 148 is a plausible answer. Somebody who
                     needs a third voice has the transcript's own menu. */
                  const above = neighbourVoice(s, -1);
                  const below = neighbourVoice(s, 1);
                  const choices = below && below.key !== above?.key
                    ? [above, below]
                    : [above];
                  return (
                    <li key={s.id}>
                      <button
                        className={`vsuvka ${s.start <= time && time < s.end ? "aktivni" : ""}`}
                        onClick={() => hear(s)}
                        title={t("detail.unassigned.hearTitle")}
                      >
                        <PlayMark />
                        <span className="nejiste-cas">{formatTime(s.start)}</span>
                        <span className="nejisty-text">{s.text}</span>
                      </button>
                      <div className="neprirazene-hlasy">
                        {choices.map((voice) =>
                          voice ? (
                            <button
                              key={voice.key}
                              className="hlas-volba"
                              style={{
                                color: speakerByKey.get(voice.key)?.color,
                                borderColor: speakerByKey.get(voice.key)?.color,
                              }}
                              onClick={() => void giveToVoice(s, voice.key)}
                            >
                              {voice.name}
                            </button>
                          ) : null
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </SidebarSection>
          )}

          <SidebarSection
            icon="review"
            title={t("detail.review.heading")}
            count={uncertainSegments.length}
            open={openSections.review}
            onToggle={() => toggleSection("review")}
          >
            {uncertainSegments.length > 0 ? (
              <ul className="nejista-mista">
                {uncertainSegments.map((uncertain) => (
                  <li key={uncertain.id}>
                    {editingUncertain === uncertain.id ? (
                      <UncertainEditor
                        segment={uncertain}
                        onSave={(text) => {
                          setEditingUncertain(null);
                          void saveText(uncertain, text);
                        }}
                        onCancel={() => setEditingUncertain(null)}
                      />
                    ) : (
                      <>
                        <button onClick={() => hear(uncertain)}
                                onDoubleClick={() => setEditingUncertain(uncertain.id)}
                                title={t("detail.review.editHint")}
                                className={uncertain.start <= time && time < uncertain.end ? "aktivni" : ""}>
                          <PlayMark />
                          <span className="nejiste-cas">{formatTime(uncertain.start)}</span>
                          <span className="nejisty-text">{uncertain.text}</span>
                        </button>
                        <button className="odklepnout" title={t("detail.review.markCorrectTitle")}
                                aria-label={t("detail.review.markCorrectLabel")}
                                onClick={() => confirm(uncertain)}>
                          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                            <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor"
                                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <SidebarEmpty>{t("detail.review.empty")}</SidebarEmpty>
            )}
          </SidebarSection>

          <SidebarSection
            icon="edits"
            title={t("detail.edits.heading")}
            count={editedSegments.length}
            open={openSections.edits}
            onToggle={() => toggleSection("edits")}
          >
            {editedSegments.length > 0 ? (
              <ul className="opravy">
                {editedSegments.map((segment) => {
                  const change = describeEdit(segment.original, segment.text);
                  if (!change) return null;
                  return (
                    <li key={segment.id}>
                      <button
                        onClick={() => hear(segment)}
                        title={t("detail.edits.seekTitle")}
                        className={
                          segment.start <= time && time < segment.end ? "aktivni" : ""
                        }
                      >
                        <PlayMark />
                        <span className="oprava-cas">{formatTime(segment.start)}</span>
                        <span className="oprava-zmena">
                          <span className="oprava-pred">{change.before}</span>
                          <span className="oprava-sipka" aria-hidden>→</span>
                          <span className="oprava-po">
                            {/* One word changed: the row is already only that
                                word, so underlining it would say nothing. Both
                                versions whole: the reader would otherwise have
                                to spot the difference. */}
                            {change.narrowed ? (
                              change.after
                            ) : (
                              <MarkedWords original={change.before} text={change.after} />
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <SidebarEmpty>{t("detail.edits.empty")}</SidebarEmpty>
            )}
          </SidebarSection>

          <SidebarSection
            icon="note"
            title={t("detail.notes.heading")}
            count={notes.length}
            open={openSections.notes}
            onToggle={() => toggleSection("notes")}
            action={
              <button className="sidebar-text-action" onClick={beginNote} disabled={addingNote}>
                {/* Drawn on the icon family's own 24 grid with its 1.6 stroke,
                    not on the header button's 15 grid. A plus is a full-bleed
                    geometric shape: at the header's proportions — arms across
                    11 of 15, a stroke a tenth of the box — it outweighed the
                    speakers glyph beside it, which spends its box on detail.
                    Same grid, same stroke, same optical weight. */}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                     aria-hidden>
                  <path d="M12 6v12M6 12h12" />
                </svg>
                {t("detail.notes.add")}
              </button>
            }
          >
            {(addingNote || notes.length > 0) && (
              <ul className="stickies" ref={notesListRef}>
                {addingNote && (
                  <li
                    className="sticky open"
                    /* Leaving an empty composer closes it. Text already
                       written is never thrown away by looking elsewhere. */
                    onBlur={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget)) return;
                      if (!noteDraft.trim()) cancelNote();
                    }}
                  >
                    <div className="sticky-body">
                      <textarea
                        className="sticky-editor"
                        value={noteDraft}
                        autoFocus
                        rows={2}
                        ref={fitNoteTextarea}
                        placeholder={t("detail.notes.placeholder")}
                        onChange={(event) => {
                          setNoteDraft(event.target.value);
                          fitNoteTextarea(event.currentTarget);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") cancelNote();
                          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                            event.preventDefault();
                            void addNote();
                          }
                        }}
                      />
                      <div className="sticky-tools">
                        <StickyTime
                          time={noteDraftTime}
                          playbackTime={time}
                          open
                          pinDisabled={!noteDraft.trim()}
                          onPin={() => setNoteDraftTime(time)}
                          onUnpin={() => setNoteDraftTime(null)}
                        />
                        <button
                          className="sticky-confirm"
                          onClick={() => void addNote()}
                          disabled={!noteDraft.trim()}
                        >
                          {t("common.save")}
                        </button>
                      </div>
                    </div>
                  </li>
                )}

                {notes.map((note) => {
                  const open = openNoteId === note.id;
                  return (
                    <li
                      key={note.id}
                      className={`sticky ${open ? "open" : ""}`}
                      /* An open note closes when attention moves elsewhere.
                         Moving between its own controls is not leaving. */
                      onBlur={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget)) return;
                        if (open) setOpenNoteId(null);
                      }}
                    >
                      <div className="sticky-body">
                        {open ? (
                          <textarea
                            className="sticky-editor"
                            value={note.text}
                            autoFocus
                            rows={1}
                            ref={fitNoteTextarea}
                            onChange={(event) => {
                              setNotes((current) => current.map((item) =>
                                item.id === note.id
                                  ? { ...item, text: event.target.value }
                                  : item
                              ));
                              fitNoteTextarea(event.currentTarget);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape" ||
                                  (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                            }}
                            onBlur={() => void saveNote(note)}
                          />
                        ) : (
                          /* The whole closed note opens it, so the text is a
                             button rather than a paragraph with a handler. */
                          <button
                            className="sticky-text"
                            onClick={() => setOpenNoteId(note.id)}
                            title={t("detail.notes.openTitle")}
                          >
                            {note.text}
                          </button>
                        )}

                        {(open || note.time !== null) && (
                          <div className="sticky-tools">
                            <StickyTime
                              time={note.time}
                              playbackTime={time}
                              open={open}
                              onSeek={note.time !== null ? () => goToNote(note.time!) : undefined}
                              onPin={() => void setNoteTime(note, time)}
                              onUnpin={() => void setNoteTime(note, null)}
                              draft={noteTimeDrafts[note.id]}
                              invalid={noteTimeDrafts[note.id] !== undefined &&
                                !noteTimeIsValid(noteTimeDrafts[note.id], duration)}
                              onDraftChange={(value) => setNoteTimeDrafts((current) => ({
                                ...current, [note.id]: value,
                              }))}
                              onDraftCommit={(value) => void saveNoteTime(note, value)}
                            />
                            {open && (
                              <button
                                className="sticky-danger"
                                /* The one place in the application where text
                                   a person wrote themselves went on a single
                                   click. Deleting a folder asks and offers two
                                   answers, removing a recording asks, a re-run
                                   asks — and all three destroy something that
                                   can be produced again. A note cannot. */
                                onClick={() =>
                                  setConfirmation({
                                    nadpis: t("detail.notes.deleteTitle"),
                                    text: note.text.trim(),
                                    confirm: t("common.delete"),
                                    nicive: true,
                                    action: () => deleteNote(note),
                                  })
                                }
                              >
                                {t("common.delete")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!addingNote && notes.length === 0 && (
              <SidebarEmpty>{t("detail.notes.empty")}</SidebarEmpty>
            )}
          </SidebarSection>
        </aside>
        )}
      </div>

      {transcriptMenu && (
        <TranscriptContextMenu
          x={transcriptMenu.x}
          y={transcriptMenu.y}
          onClose={() => setTranscriptMenu(null)}
          items={[
            {
              label: t("detail.menu.play"),
              icon: MENU_ICONS.play,
              action: () => playFrom(transcriptMenu.time),
            },
            {
              label: t("detail.menu.copy"),
              icon: MENU_ICONS.copy,
              action: () => void copyFromTranscript(transcriptMenu.segment),
            },
            {
              label: t("detail.menu.edit"),
              icon: MENU_ICONS.edit,
              action: () => startEditing(transcriptMenu.segment),
            },
            {
              label: t("detail.menu.note", { time: formatTime(transcriptMenu.time) }),
              icon: MENU_ICONS.note,
              action: () => beginNoteAt(transcriptMenu.time),
            },
            // Only offered when there is somebody to give the block to. A block
            // in a transcript nobody has separated has no neighbours to speak
            // of, and the menu stays as it was.
            ...([-1, 1] as const).flatMap((step) => {
              const voice = neighbourVoice(transcriptMenu.segment, step);
              if (!voice) return [];
              return [
                {
                  label: t(
                    step === -1 ? "detail.menu.toPrevious" : "detail.menu.toNext",
                    { name: voice.name }
                  ),
                  icon: step === -1 ? MENU_ICONS.toPrevious : MENU_ICONS.toNext,
                  action: () => void giveToVoice(transcriptMenu.segment, voice.key),
                },
              ];
            }),
            // Last, because it is the rarer answer — but it is the only one
            // when the right person has no group at all.
            {
              label: t("detail.menu.toNewVoice"),
              icon: MENU_ICONS.newVoice,
              action: () => void giveToNewVoice(transcriptMenu.segment),
            },
          ]}
        />
      )}

      {aiDialog === "missing" && (
        <div className="prekryv-dialogu" role="presentation" onMouseDown={() => setAiDialog(null)}>
          <div ref={missingDialog} className="dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-missing-title"
               onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ai-missing-title">{t("detail.ai.missingTitle")}</h2>
            <p>{t("detail.ai.missingText")}</p>
            <div className="dialog-patka">
              <button className="tlacitko tichy" onClick={() => setAiDialog(null)}>
                {t("common.close")}
              </button>
              <button
                className="tlacitko hlavni"
                onClick={() => onToModule(
                  aiModel.includes("12b")
                    ? "editor-model-best"
                    : aiModel.includes("e2b")
                      ? "editor-model-light"
                      : "editor-model-balanced"
                )}
              >
                {t("detail.ai.chooseModel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiDialog === "configure" && (
        <div className="prekryv-dialogu" role="presentation" onMouseDown={() => setAiDialog(null)}>
          <div ref={configureDialog} className="dialog ai-edit-dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-configure-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="ai-configure-title">{t("detail.ai.configureTitle")}</h2>
            <p>{t("detail.ai.configureText")}</p>
            <div className="volby ai-edit-modes">
              <button className={`volba s-ikonou ${aiMode === "faithful" ? "zvolena" : ""}`}
                      onClick={() => setAiMode("faithful")}>
                <span className="volba-ikona" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                       strokeLinejoin="round">
                    <path d="M6 3.5h8l4 4V20.5H6z M14 3.5v4h4 M8.7 14l2.1 2.1 4.6-5" />
                  </svg>
                </span>
                <span className="volba-telo">
                  <span className="volba-nazev">{t("detail.ai.modeFaithful")}</span>
                  <span className="drobne">{t("detail.ai.modeFaithfulDescription")}</span>
                </span>
                <em className="odznak">{t("detail.ai.recommended")}</em>
              </button>
              <button className={`volba s-ikonou ${aiMode === "clean" ? "zvolena" : ""}`}
                      onClick={() => setAiMode("clean")}>
                <span className="volba-ikona" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                       strokeLinejoin="round">
                    <path d="M12 5.5c-1-2.4-4.7-2-4.7.8v.5A3.3 3.3 0 0 0 5.5 12c-1.4 2.2.1 5 2.6 5.1.4 2.7 3.9 2.5 3.9.1V5.5Z M12 5.5c1-2.4 4.7-2 4.7.8v.5a3.3 3.3 0 0 1 1.8 5.2c1.4 2.2-.1 5-2.6 5.1-.4 2.7-3.9 2.5-3.9.1 M8.2 9.1c1.2 0 2.1.7 2.1 1.8 M15.8 9.1c-1.2 0-2.1.7-2.1 1.8 M8.1 17.1c.1-1.5.9-2.5 2.2-2.8 M15.9 17.1c-.1-1.5-.9-2.5-2.2-2.8" />
                  </svg>
                </span>
                <span className="volba-telo">
                  <span className="volba-nazev">{t("detail.ai.modeClean")}</span>
                  <span className="drobne">{t("detail.ai.modeCleanDescription")}</span>
                </span>
              </button>
              <button className={`volba s-ikonou ${aiMode === "speakers" ? "zvolena" : ""} ${speakersReady ? "" : "chybi"}`}
                      onClick={() => setAiMode("speakers")}>
                <span className="volba-ikona" aria-hidden>
                  <LineIcon name="speakers" />
                </span>
                <span className="volba-telo">
                  <span className="volba-nazev">{t("detail.ai.modeSpeakers")}</span>
                  <span className="drobne">
                    {t(
                      !speakersReady
                        ? "detail.ai.modeSpeakersMissing"
                        : speakers.length > 0
                          ? "detail.ai.modeSpeakersDone"
                          : "detail.ai.modeSpeakersDescription"
                    )}
                  </span>
                </span>
                {!speakersReady && <em className="odznak akce">{t("common.download")}</em>}
                {speakersReady && speakers.length > 0 && (
                  <em className="odznak hotovo">{t("detail.ai.speakersDoneBadge")}</em>
                )}
              </button>
            </div>
            <p className="drobne ai-edit-note">
              <svg className="ai-edit-note-icon" width="16" height="16" viewBox="0 0 16 16"
                   fill="none" aria-hidden>
                <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.35" />
                <path d="M8 7.1v3.7M8 4.8h.01" stroke="currentColor" strokeWidth="1.55"
                      strokeLinecap="round" />
              </svg>
              <span>{t("detail.ai.configureNote")}</span>
            </p>
            <div className="dialog-patka">
              <button className="tlacitko tichy" onClick={() => setAiDialog(null)}>
                {t("common.cancel")}
              </button>
              <button className="tlacitko hlavni" onClick={startAiEdit}>
                {t(aiMode === "speakers"
                  ? !speakersReady
                    ? "common.download"
                    : speakers.length > 0
                      ? "detail.ai.startSpeakersAgain"
                      : "detail.ai.startSpeakers"
                  : "detail.ai.startEdit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiDialog === "preview" && aiDocument && (
        <div className="prekryv-dialogu" role="presentation" onMouseDown={() => setAiDialog(null)}>
          <div ref={previewDialog} className="dialog ai-preview-dialog" role="dialog" aria-modal="true"
               aria-labelledby="ai-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ai-preview-header">
              <div>
                <h2 id="ai-preview-title">{t("detail.preview.title")}</h2>
                <p>{t("detail.preview.subtitle")}</p>
              </div>
              <button className="ikona-tlacitko" onClick={() => setAiDialog(null)}
                      aria-label={t("detail.preview.closeLabel")} title={t("common.close")}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor"
                        strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {aiDocument.stale && (
              <div className="ai-preview-warning">{t("detail.preview.staleWarning")}</div>
            )}
            {/* The header's own buttons, and the playback speeds' own selected
                state: a row of pills where the chosen one is filled. A
                segmented control is right in the archive, where it switches how
                a list is drawn; hanging under a header made of pills it read as
                a borrowed part. */}
            <nav className="ai-document-tabs" role="tablist"
                 aria-label={t("detail.preview.tabsLabel")}>
              <button className={previewTab === "improved" || previewTab === "original" ? "active" : ""}
                      onClick={() => setPreviewTab("improved")} role="tab"
                      aria-selected={previewTab === "improved" || previewTab === "original"}>
                <DocumentViewIcon view="improved" />
                {t("detail.preview.transcriptTab")}
              </button>
              <button className={previewTab === "summary" ? "active" : ""}
                      onClick={() => setPreviewTab("summary")} role="tab"
                      aria-selected={previewTab === "summary"}>
                <DocumentViewIcon view="summary" />
                {t("detail.preview.summaryTab")}
              </button>
              <button className={previewTab === "translation" ? "active" : ""}
                      onClick={() => setPreviewTab("translation")} role="tab"
                      aria-selected={previewTab === "translation"}>
                <DocumentViewIcon view="translation" />
                {t("detail.preview.translationTab")}
              </button>
            </nav>

            {(previewTab === "improved" || previewTab === "original") && (
              <div className="ai-output-toolbar">
                <div className="ai-output-options" role="radiogroup"
                     aria-label={t("detail.preview.versionLabel")}>
                  <button className={previewTab === "improved" ? "active" : ""}
                          onClick={() => setPreviewTab("improved")} role="radio"
                          aria-checked={previewTab === "improved"}>
                    {t("detail.preview.versionImproved")}
                  </button>
                  <button className={previewTab === "original" ? "active" : ""}
                          onClick={openOriginalPreview} role="radio"
                          aria-checked={previewTab === "original"}>
                    {t("detail.preview.versionOriginal")}
                  </button>
                </div>
              </div>
            )}
            {previewTab === "summary" && (
              <div className="ai-output-toolbar">
                {/* The three names say what they are. The group keeps its
                    accessible label for anyone who cannot see them. */}
                <div className="ai-output-options" role="radiogroup"
                     aria-label={t("detail.preview.lengthGroupLabel")}>
                  {SUMMARY_LENGTHS.map((option) => (
                    <button key={option}
                            className={summaryLength === option ? "active" : ""}
                            onClick={() => setSummaryLength(option)}
                            title={t(SUMMARY_LENGTH_KEYS[option].description)} role="radio"
                            aria-checked={summaryLength === option}>
                      {t(SUMMARY_LENGTH_KEYS[option].label)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {previewTab === "translation" && (
              <div className="ai-output-toolbar">
                {/* No visible label: the tab above says Překlad and the value
                    in the control is a language. `Select` carries its own
                    accessible name through `description`. */}
                <Select
                  value={translationLanguage}
                  items={translationLanguageItems}
                  description={t("detail.preview.translationLanguageLabel")}
                  onChange={(value) => setTranslationLanguage(value as TranslationLanguage)}
                />
              </div>
            )}

            {previewTab === "improved" && (
              <article className="ai-preview-text">
                {aiDocument.text
                  .split(/\n{2,}/)
                  .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </article>
            )}
            {previewTab === "original" && (
              <article className="ai-preview-text">
                {(originalPreview || t("common.loading"))
                  .split(/\n{2,}/)
                  .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </article>
            )}
            {previewTab === "summary" && summaryOutput && (
              <article className="ai-preview-text">
                {summaryOutput.text
                  .split(/\n{2,}/)
                  .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </article>
            )}
            {previewTab === "translation" && translationOutput && (
              <article className="ai-preview-text">
                {translationOutput.text
                .split(/\n{2,}/)
                .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </article>
            )}
            {previewTab === "summary" && !summaryOutput && (
              <div className="ai-preview-empty">
                <span className="ai-preview-empty-icon" aria-hidden>
                  <DocumentViewIcon view="summary" />
                </span>
                {/* A whole sentence per length: the adjective is declined and
                    lower-casing a label is not a translation. */}
                <h3>{t(SUMMARY_LENGTH_KEYS[summaryLength].heading)}</h3>
                <p>{t("detail.summary.emptyText")}</p>
                <button className="tlacitko hlavni"
                        onClick={() => startAiOutput("summary", summaryLength)}>
                  {t("detail.summary.create")}
                </button>
              </div>
            )}
            {previewTab === "translation" && !translationOutput && (
              <div className="ai-preview-empty">
                <span className="ai-preview-empty-icon" aria-hidden>
                  <DocumentViewIcon view="translation" />
                </span>
                <h3>{t("detail.translation.emptyTitle")}</h3>
                <p>{t("detail.translation.emptyText")}</p>
                <button className="tlacitko hlavni"
                        onClick={() => startAiOutput("translation", translationLanguage)}>
                  {t("detail.translation.create")}
                </button>
              </div>
            )}

            {(previewTab === "improved" || previewTab === "original"
              || (previewTab === "summary" && summaryOutput)
              || (previewTab === "translation" && translationOutput)) && (
              <div className="dialog-patka ai-preview-actions">
                {previewTab === "improved" && (
                  <button className="tlacitko tichy vystraha" onClick={async () => {
                    await api.deleteAiDocument(id);
                    setAiDocument(null);
                    setAiOutputs([]);
                    setAiDialog(null);
                  }}>
                    <DiscardIcon />
                    {t("detail.preview.discard")}
                  </button>
                )}
                {previewTab === "improved" && (
                  <button className="tlacitko tichy" onClick={() => {
                    setAiMode(aiDocument.mode === "clean" ? "clean" : "faithful");
                    setAiDialog("configure");
                  }}>
                    <RegenerateIcon />
                    {t("detail.preview.regenerateImproved")}
                  </button>
                )}
                {previewTab === "summary" && summaryOutput && (
                  <button className="tlacitko tichy"
                          onClick={() => startAiOutput("summary", summaryLength)}>
                    <RegenerateIcon />
                    {t("detail.preview.regenerateSummary")}
                  </button>
                )}
                {previewTab === "translation" && translationOutput && (
                  <button className="tlacitko tichy"
                          onClick={() => startAiOutput("translation", translationLanguage)}>
                    <RegenerateIcon />
                    {t("detail.preview.regenerateTranslation")}
                  </button>
                )}
                <button className="tlacitko" onClick={copyPreviewText}
                        disabled={!previewText.trim()}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6"
                          stroke="currentColor" strokeWidth="1.35" />
                    <path d="M10.8 5.2V3.9c0-.8-.7-1.4-1.5-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.4c0 .8.6 1.5 1.4 1.5h1.3"
                          stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
                  </svg>
                  {t("common.copy")}
                </button>
                <DocumentSaveMenu disabled={!previewText.trim()} onChoose={savePreview} />
              </div>
            )}
          </div>
        </div>
      )}

      {dictionarySuggestion && (
        <div className="nabidka">
          <span>
            {t("detail.dictionary.prompt", {
              from: dictionarySuggestion.z,
              to: dictionarySuggestion.na,
            })}
          </span>
          <button className="tlacitko" onClick={confirmDictionary}>
            {t("detail.dictionary.confirm")}
          </button>
          <button className="tlacitko tichy" onClick={() => setDictionarySuggestion(null)}>
            {t("detail.dictionary.decline")}
          </button>
        </div>
      )}
      <ConfirmationDialog
        query={confirmation}
        onZavri={() => setConfirmation(null)}
        onError={onError}
      />
    </main>
  );
}

/** A segment longer than this is not diffed. The table below is quadratic, and
 *  a block this size means something other than a hand correction. */
const MAX_DIFF_WORDS = 400;

/**
 * Which words of `text` were not in `original`, by index.
 *
 * A longest-common-subsequence walk rather than a position-by-position
 * comparison: correcting one word into two, or dropping a word, shifts
 * everything after it, and a naive compare would then mark the whole rest of
 * the sentence as changed. Words are compared exactly, so a comma added is a
 * correction — because it is one.
 */
function changedWords(original: string, text: string): Set<number> {
  const changed = new Set<number>();
  const before = original.trim().split(/\s+/).filter(Boolean);
  const after = text.trim().split(/\s+/).filter(Boolean);
  if (before.length > MAX_DIFF_WORDS || after.length > MAX_DIFF_WORDS) return changed;

  const common: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0)
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i][j] =
        before[i] === after[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      i++;
      j++;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      i++; // a word that is gone leaves nothing to underline
    } else {
      changed.add(j);
      j++;
    }
  }
  while (j < after.length) changed.add(j++);
  return changed;
}

/** The words of `text`, with the ones that were not in `original` underlined. */
function MarkedWords({ original, text }: { original: string; text: string }) {
  const changed = useMemo(() => changedWords(original, text), [original, text]);
  const words = useMemo(() => text.trim().split(/(\s+)/).filter(Boolean), [text]);
  let index = -1;
  return (
    <>
      {words.map((word, i) => {
        if (/^\s+$/.test(word)) return <span key={i}>{word}</span>;
        index += 1;
        return changed.has(index) ? (
          <span key={i} className="opraveno">{word}</span>
        ) : (
          <span key={i}>{word}</span>
        );
      })}
    </>
  );
}

/**
 * The narrowest honest description of a manual correction.
 *
 * When the rewrite kept the same number of words and changed exactly one, that
 * word is the whole story and the sentence around it is noise. Anything else —
 * a word added, a clause rebuilt, punctuation moved — cannot be reduced without
 * lying about it, so both versions are shown whole and the reader decides.
 */
function describeEdit(
  original: string | null,
  text: string
): { before: string; after: string; narrowed: boolean } | null {
  if (!original) return null;
  const before = original.trim();
  const after = text.trim();
  if (!before || before === after) return null;

  const beforeWords = before.split(/\s+/);
  const afterWords = after.split(/\s+/);
  if (beforeWords.length === afterWords.length) {
    const changed = beforeWords
      .map((word, i) => [word, afterWords[i]] as const)
      .filter(([a, b]) => a !== b);
    if (changed.length === 1)
      return { before: changed[0][0], after: changed[0][1], narrowed: true };
  }
  return { before, after, narrowed: false };
}

// ------------------------------------------------- oprava nejisteho mista

/**
 * An uncertain spot, rewritten where it is listed.
 *
 * The panel exists to say which places are worth checking. Making the reader
 * travel to the transcript and back for each one turns a list of small chores
 * into a list of interruptions, so double-click opens the text here — the same
 * gesture that opens a segment in the transcript.
 *
 * It saves through the transcript's own `saveText`, not through a second path
 * to the database. That is what makes the transcript, the dictionary
 * suggestion and the "improved document is out of date" flag all react as if
 * the edit had happened down there. Saving also marks the segment checked, so
 * the row leaves the list — which is the point of a worklist.
 */
function UncertainEditor({
  segment,
  onSave,
  onCancel,
}: {
  segment: Segment;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(segment.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /* Escape blurs the field on its way out, and blur saves. Without this flag
     cancelling would write the very draft it is meant to throw away. */
  const cancelled = useRef(false);

  const grow = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    element.focus();
    // The caret at the end, not the whole text selected: the reader opened
    // this to repair a word, not to retype the sentence.
    element.setSelectionRange(element.value.length, element.value.length);
    grow(element);
  }, []);

  return (
    <div className="nejiste-upravy">
      <span className="nejiste-cas">{formatTime(segment.start)}</span>
      <textarea
        ref={areaRef}
        value={draft}
        rows={1}
        aria-label={segment.text}
        onChange={(event) => {
          setDraft(event.target.value);
          grow(event.target);
        }}
        onBlur={() => {
          if (!cancelled.current) onSave(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSave(draft);
          } else if (event.key === "Escape") {
            event.preventDefault();
            // The window handler reads Escape as "close the transcript's
            // editor". It must not also see this one.
            event.stopPropagation();
            cancelled.current = true;
            onCancel();
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- jeden usek

/**
 * One transcript segment.
 *
 * Wrapped in `memo` with a custom comparison: the clock ticks many times a
 * second and without this the whole transcript — easily a thousand segments —
 * would repaint along with it. Only the segment currently sounding cares about
 * the time; the rest ignore it.
 */
const SegmentRow = memo(function SegmentRow({
  segment,
  active,
  time,
  editing,
  color,
  onSeek,
  onStartUpravu,
  onConfirm,
  onSave,
  onContextMenu,
}: {
  segment: Segment;
  active: boolean;
  time: number;
  editing: boolean;
  color?: string;
  onSeek: (t: number) => void;
  // The segment passes itself to the handlers. That lets the parent keep them
  // stable, giving the `memo` comparison a chance to succeed at all.
  onStartUpravu: (s: Segment) => void;
  onConfirm: (s: Segment) => void;
  onSave: (s: Segment, text: string) => void;
  onContextMenu: (s: Segment, event: ReactMouseEvent) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(segment.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(segment.text);
  }, [segment.text]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editing]);

  // Word timings come straight from Whisper. Estimating from text length
  // drifted towards the end of a segment, because a segment usually runs on
  // past the final syllable.
  const words = useMemo(() => {
    if (segment.words) {
      try {
        const storedWords = JSON.parse(segment.words) as Array<{ t: number; s: string }>;
        if (storedWords.length > 0) {
          const output: Array<{ text: string; time: number; space: boolean }> = [];
          storedWords.forEach((w, i) => {
            if (i > 0) output.push({ text: " ", time: w.t, space: true });
            output.push({ text: w.s, time: w.t, space: false });
          });
          return output;
        }
      } catch {
        /* corrupt record — fall through to the estimate below */
      }
    }
    // Fallback for older transcripts and manually edited segments.
    const chunks = segment.text.split(/(\s+)/).filter((x) => x.length > 0);
    const total = chunks.reduce((a, k) => a + k.length, 0) || 1;
    let characterPosition = 0;
    return chunks.map((k) => {
      const ratio = characterPosition / total;
      characterPosition += k.length;
      return {
        text: k,
        time: segment.start + ratio * (segment.end - segment.start),
        space: /^\s+$/.test(k),
      };
    });
  }, [segment.words, segment.text, segment.start, segment.end]);

  const uncertain = (segment.confidence ?? 1) < CONFIDENCE_THRESHOLD && !segment.verified;

  /* Which words this segment was corrected on. A manual rewrite clears the
     stored word timings, so the words rendered below are always the plain
     whitespace split — the same one the diff walks, which is what lets an
     index from one address the other. */
  const corrected = useMemo(
    () => (segment.original ? changedWords(segment.original, segment.text) : null),
    [segment.original, segment.text]
  );
  /* The rendered list interleaves spaces, so its position is not the word's.
     Counting them once beats recounting inside the map for every word. */
  const wordOrdinals = useMemo(() => {
    let ordinal = -1;
    return words.map((w) => (w.space ? -1 : ++ordinal));
  }, [words]);

  if (editing) {
    return (
      <div className="segment upravuje" id={`segment-${segment.id}`}>
        <button className="cas-znacka" onClick={() => onSeek(segment.start)}>
          {formatTime(segment.start)}
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onBlur={() => onSave(segment, draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSave(segment, draft);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`segment ${active ? "aktivni" : ""} ${uncertain ? "nejisty" : ""}`}
      id={`segment-${segment.id}`}
      style={color ? { borderLeftColor: color } : undefined}
      onDoubleClick={() => onStartUpravu(segment)}
      onContextMenu={(event) => onContextMenu(segment, event)}
    >
      <button className="cas-znacka" onClick={() => onSeek(segment.start)}>
        {formatTime(segment.start)}
      </button>

      <p className="segment-text">
        {words.map((s, i) =>
          s.space ? (
            <span key={i}>{s.text}</span>
          ) : (
            <span
              key={i}
              className={`slovo ${active && time >= s.time ? "znelo" : ""} ${
                corrected?.has(wordOrdinals[i]) ? "opraveno" : ""
              }`}
              onClick={() => onSeek(s.time)}
              /* The context menu reads the moment off the word that was
                 pointed at, so it can play, note or re-transcribe from
                 exactly there rather than from the start of the block. */
              data-time={s.time}
              title={t("detail.segment.wordHint")}
            >
              {s.text}
            </span>
          )
        )}
        {/* The pencil only earns its place when nothing in the line is
            underlined — a segment edited before the archive kept originals.
            Otherwise it repeats what the marks below the words already say. */}
        {segment.edited && !corrected?.size && (
          <span className="upraveno-znak" title={t("detail.segment.editedHint")}>✎</span>
        )}
      </p>

      {uncertain && (
        <div className="segment-akce">
          <button title={t("detail.review.markCorrectTitle")}
                  aria-label={t("detail.review.markCorrectLabel")}
                  onClick={() => onConfirm(segment)}>
            <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden>
              <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button title={t("detail.review.fixText")} aria-label={t("detail.review.fixText")}
                  onClick={() => onStartUpravu(segment)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z M13.5 6.5l4 4"
                    stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
},
(a, b) =>
  a.segment === b.segment &&
  a.active === b.active &&
  a.editing === b.editing &&
  a.color === b.color &&
  a.onSeek === b.onSeek &&
  a.onStartUpravu === b.onStartUpravu &&
  a.onConfirm === b.onConfirm &&
  a.onSave === b.onSave &&
  a.onContextMenu === b.onContextMenu &&
  // Only the segment currently sounding cares about the time.
  (!b.active || a.time === b.time)
);
