import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { OloFace } from "./Brand";
import InfoNote from "./InfoNote";
import RecordingMetadataIcon from "./RecordingMetadataIcon";
import type { RecordingMetadataKind } from "./RecordingMetadataIcon";
import RecordingActionsMenu, { ActionMenu, MENU_ICONS } from "./RecordingActionsMenu";
import NameDialog from "./NameDialog";
import { LineIcon } from "./icons";
import Select from "./Select";
import { formatTime, fileName, statusClass } from "./types";
import { useLabels } from "./labels";
import { useFormats } from "./formats";
import { useI18n } from "./i18n";
import { useProgressMessage, useUserMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import type {
  AiEditProgress,
  Recording,
  TranscriptionProgress,
  SearchResult,
  LiveSegment,
  UserMessage,
  WatchFolderCandidate,
  Folder,
} from "./types";

interface Props {
  recordings: Recording[];
  progress: Record<string, TranscriptionProgress>;
  aiProgress: Record<string, AiEditProgress>;
  liveSegments: Record<string, LiveSegment[]>;
  issues: UserMessage[];
  watchCandidates: WatchFolderCandidate[];
  watchDecisionRunning: boolean;
  onTranscribeWatchCandidates: (files: WatchFolderCandidate[]) => void;
  onIgnoreWatchCandidates: (files: WatchFolderCandidate[]) => void;
  onAddWatchCandidates: (files: WatchFolderCandidate[]) => void;
  onOpen: (id: string, time?: number) => void;
  onExportAudio: (id: string) => void;
  folders: Folder[];
  /** Which folder is open; null is the archive's root. */
  openFolder: string | null;
  onOpenFolder: (folder: string | null) => void;
  onCreateFolder: () => void;
  onRenameFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onMoveToFolder: (id: string, folder: string | null) => void;
  onCreateFolderFor: (id: string) => void;
  onDelete: (id: string) => void;
  onTranscription: (id: string) => void;
  onCancel: (id: string) => void;
  onDeleteTranscription: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onAdd: () => void;
  /** Opens the setup wizard, which is what finishes an unfinished install.
   *  Not Settings: getting there is the detour that loses people. */
  onFinishSetup: () => void;
  automatic: boolean;
  onAutomatic: (enabled: boolean) => void;
  onTranscriptionLanguage: (id: string, language: string) => void;
}

/** Fallback captions for the moment before the first report arrives.
 *
 * Normally the caption is whatever the backend sent with the report — it is
 * the only side that knows what it is actually doing. This table used to be
 * consulted first, so the library and the detail screen could disagree about
 * the same run. */
const PHASE_KEYS: Record<string, TranslationKey> = {
  preparation: "library.card.phase.preparation",
  playback: "library.card.phase.playback",
  transcription: "library.card.phase.transcription",
  diarization: "library.card.phase.diarization",
  saving: "library.card.phase.saving",
  complete: "common.done",
  error: "library.card.phase.error",
  cancelled: "library.card.phase.cancelled",
};

const CALENDAR_MONTH_KEYS: readonly TranslationKey[] = [
  "library.card.month.jan", "library.card.month.feb", "library.card.month.mar",
  "library.card.month.apr", "library.card.month.may", "library.card.month.jun",
  "library.card.month.jul", "library.card.month.aug", "library.card.month.sep",
  "library.card.month.oct", "library.card.month.nov", "library.card.month.dec",
];

/** Monday first. The order is fixed rather than derived from the locale;
 *  a locale-aware first day would need `Intl.Locale.prototype.getWeekInfo`. */
const CALENDAR_WEEKDAY_KEYS: readonly TranslationKey[] = [
  "library.calendar.weekday.mon",
  "library.calendar.weekday.tue",
  "library.calendar.weekday.wed",
  "library.calendar.weekday.thu",
  "library.calendar.weekday.fri",
  "library.calendar.weekday.sat",
  "library.calendar.weekday.sun",
];

type ArchivePeriod = "all" | "today" | "week" | "month";
type ArchiveDateFilterValue = ArchivePeriod | `date:${string}`;
type ArchiveOrder = "newest" | "oldest" | "title-asc" | "title-desc";
type ArchiveView = "classic" | "compact";

const ARCHIVE_PERIODS: ReadonlyArray<{ value: ArchivePeriod; labelKey: TranslationKey }> = [
  { value: "all", labelKey: "library.filter.anytime" },
  { value: "today", labelKey: "library.filter.today" },
  { value: "week", labelKey: "library.filter.week" },
  { value: "month", labelKey: "library.filter.month" },
];

const ARCHIVE_ORDERS: ReadonlyArray<{ value: ArchiveOrder; labelKey: TranslationKey }> = [
  { value: "newest", labelKey: "library.sort.newest" },
  { value: "oldest", labelKey: "library.sort.oldest" },
  { value: "title-asc", labelKey: "library.sort.titleAsc" },
  { value: "title-desc", labelKey: "library.sort.titleDesc" },
];

function recordingTimestamp(recording: Recording): number {
  const timestamp = Date.parse(recording.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function recordingDateKey(recording: Recording): string {
  const storedDate = recording.created_at.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (storedDate) return storedDate;

  const timestamp = recordingTimestamp(recording);
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The date is written the way the active language writes dates, so the
 *  formatter comes from the i18n context rather than from a fixed locale. */
function formatArchiveDate(
  value: string,
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string,
  fallback: string
): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return fallback;
  return formatDate(new Date(year, month - 1, day), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3.5" width="12" height="10.5" rx="2"
            stroke="currentColor" strokeWidth="1.35" />
      <path d="M2 6.5h12M5 2v3M11 2v3" stroke="currentColor"
            strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function ArchiveDateFilter({
  value,
  onChange,
}: {
  value: ArchiveDateFilterValue;
  onChange: (value: ArchiveDateFilterValue) => void;
}) {
  const { t, capitalize, formatDate } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const selectedDate = value.startsWith("date:") ? value.slice(5) : "";
  const items = [
    ...ARCHIVE_PERIODS.map((period) => ({
      value: period.value as string,
      label: t(period.labelKey),
    })),
    ...(selectedDate
      ? [{
          value: value as string,
          label: formatArchiveDate(selectedDate, formatDate, t("library.filter.anytime")),
        }]
      : []),
    {
      value: "pick",
      label: selectedDate ? t("library.filter.pickAnotherDay") : t("library.filter.pickDay"),
    },
  ];

  const openCalendar = () => {
    const anchor = dateFromKey(selectedDate) ?? new Date();
    setVisibleMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    setCalendarOpen(true);
  };

  const handleChange = (nextValue: string) => {
    if (nextValue === "pick") {
      openCalendar();
      return;
    }
    setCalendarOpen(false);
    onChange(nextValue as ArchiveDateFilterValue);
  };

  useEffect(() => {
    if (!calendarOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendarOpen]);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const calendarCellCount = Math.ceil((firstWeekday + dayCount) / 7) * 7;
  const todayKey = localDateKey(new Date());
  const monthLabel = formatDate(visibleMonth, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="archive-filter-select calendar" ref={containerRef}>
      <span className="archive-filter-icon"><CalendarIcon /></span>
      <Select
        value={value}
        items={items}
        onChange={handleChange}
        description={t("library.filter.description")}
      />
      {calendarOpen && (
        <div className="archive-calendar-popover" role="dialog" aria-label={t("library.calendar.title")}>
          <div className="archive-calendar-header">
            <button
              type="button"
              className="archive-calendar-nav"
              onClick={() => setVisibleMonth(new Date(year, month - 1, 1))}
              aria-label={t("library.calendar.previousMonth")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="m8.5 3-4 4 4 4" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <strong>{capitalize(monthLabel)}</strong>
            <button
              type="button"
              className="archive-calendar-nav"
              onClick={() => setVisibleMonth(new Date(year, month + 1, 1))}
              aria-label={t("library.calendar.nextMonth")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="m5.5 3 4 4-4 4" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="archive-calendar-weekdays" aria-hidden>
            {CALENDAR_WEEKDAY_KEYS.map((weekdayKey) => (
              <span key={weekdayKey}>{t(weekdayKey)}</span>
            ))}
          </div>
          <div className="archive-calendar-days" role="grid">
            {Array.from({ length: calendarCellCount }, (_, index) => {
              const day = index - firstWeekday + 1;
              if (day < 1 || day > dayCount) {
                return <span className="archive-calendar-empty" key={`empty-${index}`} />;
              }
              const date = new Date(year, month, day);
              const dateKey = localDateKey(date);
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === todayKey;
              const fullLabel = formatDate(date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              });
              return (
                <button
                  key={dateKey}
                  type="button"
                  role="gridcell"
                  className={`archive-calendar-day${isSelected ? " selected" : ""}${isToday ? " today" : ""}`}
                  aria-label={fullLabel}
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(`date:${dateKey}`);
                    setCalendarOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ArchiveOrderSelect({
  value,
  items,
  onChange,
  description,
}: {
  value: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  description: string;
}) {
  return (
    <div className="archive-filter-select order">
      <span className="archive-filter-icon" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 4h7M3 8h5M3 12h3M12 3v10M10 11l2 2 2-2"
                stroke="currentColor" strokeWidth="1.35"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <Select
        value={value}
        items={[...items]}
        onChange={onChange}
        description={description}
      />
    </div>
  );
}

function ArchiveViewToggle({
  value,
  onChange,
}: {
  value: ArchiveView;
  onChange: (value: ArchiveView) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="segmented-control archive-view-toggle"
      role="group"
      aria-label={t("library.view.description")}
    >
      <button
        type="button"
        className={value === "classic" ? "active" : ""}
        onClick={() => onChange("classic")}
        aria-pressed={value === "classic"}
        aria-label={t("library.view.classic")}
        title={t("library.view.classic")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="2.5" width="12" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="2" y="9.5" width="12" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      <button
        type="button"
        className={value === "compact" ? "active" : ""}
        onClick={() => onChange("compact")}
        aria-pressed={value === "compact"}
        aria-label={t("library.view.compact")}
        title={t("library.view.compact")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** One fact about a recording, with the mark that says which fact it is.
 *  Exported for the backups list, which shows the same pair — how many
 *  transcripts and how much audio — and should show it the same way. */
export function RecordingMetadataItem({
  kind,
  label,
  value,
}: {
  kind: RecordingMetadataKind;
  label: string;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={`recording-metadata-item ${kind === "error" ? "error" : ""}`}
      aria-label={t("library.card.metadata", { label, value })}
      /* The value belongs in the tooltip too: in the compact list it is cut to
         one line, and the label alone would then be the only place to look and
         the one place with nothing to say. */
      title={`${label}: ${value}`}
    >
      <RecordingMetadataIcon kind={kind} />
      <span>{value}</span>
    </span>
  );
}



/** What the card shows. A recording keeps its file name until somebody
 *  renames it, so this is the name on screen and therefore the name to
 *  sort by. */
function shownName(recording: Recording): string {
  return recording.title || fileName(recording.path);
}

export default function Library({
  recordings,
  progress,
  aiProgress,
  liveSegments,
  issues,
  watchCandidates,
  watchDecisionRunning,
  onTranscribeWatchCandidates,
  onIgnoreWatchCandidates,
  onAddWatchCandidates,
  onOpen,
  onExportAudio,
  folders,
  openFolder,
  onOpenFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onCreateFolderFor,
  onDelete,
  onTranscription,
  onCancel,
  onDeleteTranscription,
  onRename,
  onAdd,
  onFinishSetup,
  automatic,
  onAutomatic,
  onTranscriptionLanguage,
}: Props) {
  const { t, compare } = useI18n();
  const formats = useFormats();
  const userMessage = useUserMessage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [dateFilter, setDateFilter] = useState<ArchiveDateFilterValue>("all");
  const [order, setOrder] = useState<ArchiveOrder>("newest");
  const [view, setView] = useState<ArchiveView>(() =>
    localStorage.getItem("archive-view") === "compact" ? "compact" : "classic"
  );
  /* A search in progress flattens the archive: folders step aside and every
     recording is a candidate. `results` only arrives after a debounce, so the
     typed query is what decides, not the answer. */
  const searching = query.trim().length >= 2;
  const foldersVisible = !searching && dateFilter === "all";
  const open = folders.find((folder) => folder.id === openFolder) ?? null;

  const [dropZoneCompact, setDropZoneCompact] = useState(false);
  const dropZoneCompactRef = useRef(false);
  /* Whether anything is actually passing under the pinned block. The glass
     below its edge is drawn only then: at the top of the list there is
     nothing to dissolve, and a permanent blurred strip would sit over the
     first row for ever — which is what it did. */
  const [listScrolled, setListScrolled] = useState(false);
  const listScrolledRef = useRef(false);
  /* The position the previous scroll event reported, which is what tells a
     genuine return to the top from a layout that merely settled at zero. */
  const lastPositionRef = useRef(0);
  /* Resizing the header moves the scroll position by itself, and that movement
     must not be read as an instruction.
     Collapsing takes about 267 px out of the page. In a low window with a
     short list the content then fits, the browser has to clamp `scrollTop`
     down to zero — and zero after a positive position is exactly how a genuine
     return to the top looks. So the header collapsed, reopened itself, became
     tall enough to scroll again, and flickered. For a moment after our own
     change, scroll events only record where they are. */
  const settleUntilRef = useRef(0);
  const holdStateWhileSettling = () => {
    settleUntilRef.current = performance.now() + 250;
  };
  const scrollContentRef = useRef<HTMLDivElement>(null);

  // The search runs on its own, but not until the typing pauses.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setResults(await api.search(query));
      } catch {
        setResults([]);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    localStorage.setItem("archive-view", view);
  }, [view]);

  const running = useMemo(
    () => recordings.filter((n) => n.status === "transcribing"),
    [recordings]
  );

  const visibleRecordings = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const threshold = dateFilter === "today"
      ? today
      : dateFilter === "week"
        ? now.getTime() - 7 * 24 * 60 * 60 * 1000
        : dateFilter === "month"
          ? now.getTime() - 30 * 24 * 60 * 60 * 1000
          : 0;
    const selectedDate = dateFilter.startsWith("date:") ? dateFilter.slice(5) : "";
    /* A recording lives in exactly one place, so the list shows one level:
       the open folder, or the root.
       Searching and the date filter follow the level rather than override it
       (Jakub's rule). In the root they reach across every folder, because
       there the question is about the whole archive and the person is not
       standing anywhere in particular; the folder cards step aside meanwhile
       (see `foldersVisible`). Inside a folder they stay inside it — someone
       who opened a drawer and typed into the search box is looking in that
       drawer, and a result from elsewhere would take them out of it. */
    const level = openFolder === null && (searching || dateFilter !== "all")
      ? recordings
      : recordings.filter((recording) => (recording.folder ?? null) === openFolder);
    const filtered = selectedDate
      ? level.filter((recording) => recordingDateKey(recording) === selectedDate)
      : dateFilter === "all"
        ? [...level]
        : level.filter((recording) => recordingTimestamp(recording) >= threshold);

    return filtered.sort((a, b) => {
      if (order === "oldest") return recordingTimestamp(a) - recordingTimestamp(b);
      // The same expression the card renders. Sorting the raw title while
      // showing `title || fileName(path)` gathered every unnamed recording at
      // one end, under a name that is not on screen anywhere.
      if (order === "title-asc") {
        return compare(shownName(a), shownName(b));
      }
      if (order === "title-desc") {
        return compare(shownName(b), shownName(a));
      }
      return recordingTimestamp(b) - recordingTimestamp(a);
    });
  }, [dateFilter, order, recordings, compare, openFolder, searching]);

  const visibleResults = useMemo(() => {
    if (results === null) return null;
    /* Ordered by where the recording stands in the visible list. In the root
       that list is every recording, so a full-text search finds what sits in
       folders too; inside a folder it is that folder's contents, which is what
       limits the search to it. */
    const positions = new Map(visibleRecordings.map((recording, index) => [recording.id, index]));
    return results
      .filter((result) => positions.has(result.recording_id))
      .sort((a, b) =>
        (positions.get(a.recording_id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(b.recording_id) ?? Number.MAX_SAFE_INTEGER)
      );
  }, [results, visibleRecordings]);

  return (
    <main
      ref={scrollContentRef}
      className="library"
      onScroll={(event) => {
        const position = event.currentTarget.scrollTop;
        const scrolled = position > 2;
        if (scrolled !== listScrolledRef.current) {
          listScrolledRef.current = scrolled;
          setListScrolled(scrolled);
        }
        const previous = lastPositionRef.current;
        lastPositionRef.current = position;
        // Our own resize is still settling: note the position, decide nothing.
        if (performance.now() < settleUntilRef.current) return;
        if (!dropZoneCompactRef.current && position > 64) {
          holdStateWhileSettling();
          dropZoneCompactRef.current = true;
          setDropZoneCompact(true);
        } else if (dropZoneCompactRef.current && position === 0 && previous > 0) {
          // A real return to the beginning, whichever way it was made — the
          // wheel, the scrollbar, Home.
          holdStateWhileSettling();
          dropZoneCompactRef.current = false;
          setDropZoneCompact(false);
        }
      }}
      onWheel={(event) => {
        const scroller = event.currentTarget;
        const unit = event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? scroller.clientHeight
            : 1;
        const scrollDelta = event.deltaY * unit;
        const projectedPosition = Math.max(0, scroller.scrollTop + scrollDelta);

        // A short archive may have no scroll range at all. The wheel gesture
        // still expresses the same intent: reveal more of the list. Collapse
        // on that intent instead of waiting for a scrollTop that cannot move.
        // Consume this first gesture: resizing the sticky header and scrolling
        // the list in the same frame would leave the first card half-covered.
        if (event.deltaY > 4 && !dropZoneCompactRef.current) {
          event.preventDefault();
          scroller.scrollTop = 0;
          lastPositionRef.current = 0;
          holdStateWhileSettling();
          dropZoneCompactRef.current = true;
          setDropZoneCompact(true);
        } else if (
          event.deltaY < -4 &&
          dropZoneCompactRef.current &&
          projectedPosition <= 4
        ) {
          event.preventDefault();
          scroller.scrollTop = 0;
          lastPositionRef.current = 0;
          holdStateWhileSettling();
          dropZoneCompactRef.current = false;
          setDropZoneCompact(false);
        }
      }}
    >
      {/* The hero and the filter row are one pinned block, so the toolbar's
          offset is never a number somebody has to keep in step with the
          hero's height. What passes underneath dissolves into it through the
          blur below its edge rather than being cut in half. */}
      {/* Above the hero, not under it. This says the application cannot do its
          job; a 388 px hero standing in front of it is how somebody leaves the
          setup and never finds the way back. It is also the way back. */}
      {/* Not `.warning`, and that is the point. Red says *you broke something*
          about a state where nothing is broken: the application has not
          finished downloading what it needs, which is what the first five
          minutes look like for everybody.

          **The list of what is missing is gone.** It was `issues` rendered as
          it arrives from `tools.rs` — diagnostics, written for whoever is
          debugging a machine, and it put `ggml-large-v3.bin` in front of a
          reader who has not yet transcribed anything. What is missing, what it
          weighs and where it comes from is on the other side of this button,
          told properly. A banner that both diagnoses and offers the cure needs
          only offer the cure. */}
      {issues.length > 0 && (
        <div className="setup-notice">
          <div>
            <strong>{t("library.issues.title")}</strong>
            <p>{t("library.issues.text")}</p>
          </div>
          <button className="button primary" onClick={onFinishSetup}>
            {t("library.issues.finish")}
          </button>
        </div>
      )}

      <div className={`archive-sticky ${listScrolled ? "collapsed" : ""}`.trim()}>
        <LibraryDropZone
          onAdd={onAdd}
          automatic={automatic}
          onAutomatic={onAutomatic}
          compact={dropZoneCompact}
          blocked={issues.length > 0}
          working={running.length > 0}
        />
        <div className="library-bar">
          <div className="search">
            <input
              type="search"
              placeholder={t("library.search.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
          </div>

          <ArchiveDateFilter
            value={dateFilter}
            onChange={setDateFilter}
          />

          <ArchiveOrderSelect
            value={order}
            items={ARCHIVE_ORDERS.map((archiveOrder) => ({
              value: archiveOrder.value as string,
              label: t(archiveOrder.labelKey),
            }))}
            onChange={(value) => setOrder(value as ArchiveOrder)}
            description={t("library.sort.description")}
          />

          <ArchiveViewToggle value={view} onChange={setView} />
        </div>
      </div>

      <div className="archive-scroll-content">
      {watchCandidates.length > 0 && (
        <WatchFolderNotice
          files={watchCandidates}
          running={watchDecisionRunning}
          transcriptionDisabled={issues.length > 0}
          onTranscribe={onTranscribeWatchCandidates}
          onIgnore={onIgnoreWatchCandidates}
          onAdd={onAddWatchCandidates}
        />
      )}


      {open && (
        <div className="folder-crumb">
          {/* The same icon-in-a-circle the `Složky` heading carries on the
              root, so an open folder and the list it came from are marked the
              same way — and under the pointer it becomes the arrow out of the
              folder. A mark that is already sitting where the way back
              belongs may as well be it; the header keeps its own button for
              anyone who never hovers. */}
          <button
            className="folder-crumb-back"
            onClick={() => onOpenFolder(null)}
            title={t("common.archive")}
            aria-label={t("common.archive")}
          >
            <span className="folder-crumb-back-folder" aria-hidden>
              <LineIcon name="folder" size={17} />
            </span>
            {/* A wrapper, like the drawer above it — never the drawing itself.
                Both layers are stretched to fill the button, and an svg given
                100% of a 30 px circle draws itself 30 px wide. The arrow is
                the header's own back arrow at its own size. */}
            <span className="folder-crumb-back-arrow" aria-hidden>
              <svg width="14" height="12" viewBox="0 0 14 12">
                <path d="M6 1L1 6l5 5M1 6h12" fill="none" stroke="currentColor"
                      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          <span className="folder-crumb-name">{open.name}</span>
          {/* The folder's own actions travel with its name: inside the folder
              its card is not on screen, so this is the only place to rename or
              delete it. Same menu, same two items as the card. */}
          <ActionMenu
            className="folder-crumb-menu"
            items={[
              { label: t("common.rename"), icon: MENU_ICONS.rename, action: () => onRenameFolder(open) },
              {
                label: t("library.folders.delete"),
                icon: MENU_ICONS.remove,
                action: () => onDeleteFolder(open),
                warning: true,
              },
            ]}
          />
          {/* The same two facts the folder's own card shows, with the same
              icons — the breadcrumb is where that card went. */}
          <span className="recording-metadata folder-crumb-count">
            <RecordingMetadataItem
              kind="segments"
              label={t("library.folders.count")}
              value={formats.transcriptCount(open.recording_count)}
            />
            {open.duration > 0 && (
              <RecordingMetadataItem
                kind="duration"
                label={t("library.card.duration")}
                value={formats.archiveDuration(open.duration)}
              />
            )}
          </span>
        </div>
      )}

      {visibleResults !== null ? (
        <SearchResults results={visibleResults} onOpen={onOpen} />
      ) : visibleRecordings.length > 0 ? (
        <ul className={`list ${view === "compact" ? "compact" : ""}`}>
          {visibleRecordings.map((n) => (
            <Row
              key={n.id}
              recording={n}
              progress={progress[n.id]}
              aiProgress={aiProgress[n.id]}
              liveSegments={liveSegments[n.id] ?? []}
              onOpen={() => onOpen(n.id)}
              onExportAudio={() => onExportAudio(n.id)}
              folders={folders}
              onMoveToFolder={(folder) => onMoveToFolder(n.id, folder)}
              onCreateFolderFor={() => onCreateFolderFor(n.id)}
              onDelete={() => onDelete(n.id)}
              onTranscription={() => onTranscription(n.id)}
              onCancel={() => onCancel(n.id)}
              onDeleteTranscription={() => onDeleteTranscription(n.id)}
              onTranscriptionLanguage={(j) => onTranscriptionLanguage(n.id, j)}
              onRename={(title) => onRename(n.id, title)}
            />
          ))}
        </ul>
      ) : recordings.length > 0 ? (
        <p className="archive-filter-empty">
          {/* Inside a folder the filter now narrows that folder, so an empty
              result there is about the filter, not about the folder being
              empty. Only a folder with nothing in it and nothing filtering
              gets the sentence about moving a transcript into it. */}
          {t(open && !searching && dateFilter === "all"
            ? "library.empty.folder"
            : "library.empty.filter")}
        </p>
      ) : null}

      {/* Folders sit under the transcripts, at Jakub's ask: what was worked on
          recently keeps the top of the list, and the drawers are below it.
          They step aside entirely while searching or filtering by date, where
          the question is about recordings and not about where they are kept. */}
      {foldersVisible && !open && (folders.length > 0 || recordings.length > 0) && (
        <div className="folder-block">
          <div className="folder-block-head">
            {/* The same icon-in-a-circle the sidebar's section headings use,
                so a heading over a list looks the same wherever it stands. */}
            <span className="folder-block-title">
              <span className="sidebar-section-icon" aria-hidden>
                <LineIcon name="folder" size={17} />
              </span>
              {t("library.folders.heading")}
            </span>
            <button className="sidebar-text-action" onClick={onCreateFolder}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.6"
                      strokeLinecap="round" />
              </svg>
              {t("library.folders.create")}
            </button>
          </div>
          {folders.length > 0 ? (
            <ul className={`list folder-list ${view === "compact" ? "compact" : ""}`}>
              {folders.map((folder) => (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  onOpen={() => onOpenFolder(folder.id)}
                  onRename={() => onRenameFolder(folder)}
                  onDelete={() => onDeleteFolder(folder)}
                />
              ))}
            </ul>
          ) : (
            <p className="archive-filter-empty">{t("library.folders.empty")}</p>
          )}
        </div>
      )}

      {running.length > 1 && (
        <p className="note">
          {t("library.notice.concurrent", { count: running.length })}
        </p>
      )}
      </div>
    </main>
  );
}

function WatchFolderNotice({
  files,
  running,
  transcriptionDisabled,
  onTranscribe,
  onIgnore,
  onAdd,
}: {
  files: WatchFolderCandidate[];
  running: boolean;
  transcriptionDisabled: boolean;
  onTranscribe: (files: WatchFolderCandidate[]) => void;
  onIgnore: (files: WatchFolderCandidate[]) => void;
  onAdd: (files: WatchFolderCandidate[]) => void;
}) {
  const { t, tPlural } = useI18n();
  const fileKey = (file: WatchFolderCandidate) => `${file.path}:${file.fingerprint}`;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(files.map(fileKey))
  );
  const knownKeysRef = useRef(new Set(files.map(fileKey)));

  useEffect(() => {
    const nextKnownKeys = new Set(files.map(fileKey));
    setSelectedKeys((current) => {
      const next = new Set<string>();
      for (const file of files) {
        const key = fileKey(file);
        if (current.has(key) || !knownKeysRef.current.has(key)) next.add(key);
      }
      return next;
    });
    knownKeysRef.current = nextKnownKeys;
  }, [files]);

  const selectedFiles = files.filter((file) => selectedKeys.has(fileKey(file)));
  const allSelected = selectedFiles.length === files.length;
  const toggleFile = (file: WatchFolderCandidate) => {
    const key = fileKey(file);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="watch-folder-notice" aria-labelledby="watch-folder-title">
      <header className="watch-folder-header">
        <span className="watch-folder-icon" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M2.5 5.5h5l1.6 1.8h8.4v7.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M10 9.5v4M8 11.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <div className="watch-folder-copy">
          <strong id="watch-folder-title">
            {tPlural("library.watchFolder.title", files.length)}
          </strong>
          <p>{tPlural("library.watchFolder.question", files.length)}</p>
        </div>
      </header>

      <div className="watch-folder-file-panel">
        <div className="watch-folder-file-header">
          <strong>{t("library.watchFolder.files")}</strong>
          <button
            type="button"
            className="watch-folder-select-all"
            onClick={() => setSelectedKeys(allSelected ? new Set() : new Set(files.map(fileKey)))}
            disabled={running}
          >
            {allSelected ? t("library.watchFolder.clearSelection") : t("common.selectAll")}
          </button>
        </div>
        <ul className="watch-folder-files">
          {files.map((file) => (
            <li key={fileKey(file)}>
              {/* The label covers the checkbox and the name only. A `label`
                  forwards every click inside it to its control, so a dismiss
                  button placed within one would tick the box instead. */}
              <label className="watch-folder-file" title={file.path}>
                <input
                  type="checkbox"
                  checked={selectedKeys.has(fileKey(file))}
                  onChange={() => toggleFile(file)}
                  disabled={running}
                />
                <span className="watch-folder-checkbox" aria-hidden>
                  <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                    <path d="m1.5 5 3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="watch-folder-file-name">{file.name}</span>
              </label>
              <button
                type="button"
                className="watch-folder-dismiss"
                onClick={() => onIgnore([file])}
                disabled={running}
                title={t("library.watchFolder.ignoreOne", { name: file.name })}
                aria-label={t("library.watchFolder.ignoreOne", { name: file.name })}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor"
                        strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <InfoNote compact>
        <span className="watch-folder-hint">{t("library.watchFolder.hint")}</span>
      </InfoNote>

      <footer className="watch-folder-footer">
        <span className="watch-folder-selection">
          {t("library.watchFolder.selection", {
            selected: selectedFiles.length,
            total: files.length,
          })}
        </span>
        <div className="watch-folder-actions">
          <button
            className="button"
            onClick={() => onAdd(selectedFiles)}
            disabled={running || selectedFiles.length === 0}
          >
            {t("common.add")}
          </button>
          <button
            className="button primary"
            onClick={() => onTranscribe(selectedFiles)}
            disabled={running || selectedFiles.length === 0 || transcriptionDisabled}
            title={
              transcriptionDisabled ? t("library.watchFolder.transcribeBlocked") : undefined
            }
          >
            {running
              ? t("library.watchFolder.processing")
              : t("library.watchFolder.transcribe")}
          </button>
        </div>
      </footer>
    </section>
  );
}

function LibraryDropZone({
  onAdd,
  automatic,
  onAutomatic,
  compact,
  blocked,
  working,
}: {
  onAdd: () => void;
  automatic: boolean;
  onAutomatic: (enabled: boolean) => void;
  compact: boolean;
  /** Anything at all is being transcribed. */
  working: boolean;
  /** Nothing can be transcribed yet. The hero must not say otherwise —
   *  `Přepis se spustí automaticky` over a missing whisper is a promise the
   *  application cannot keep, and it is the sentence a first-run reader sees. */
  blocked: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`archive-drop-zone ${compact ? "compact" : ""}`}>
      <div className="archive-drop-zone-surface">
        {/* The mark answers for the machine while anything is being
            transcribed. The drop zone stands at the top of the archive whether
            or not the list below it is empty, so it is the one place the mark
            is on screen for the whole of a run. */}
        <span className="archive-drop-zone-mark">
          <OloFace working={working} />
        </span>
        <div className="archive-drop-zone-copy">
          <h1>{t("library.dropZone.title")}</h1>
          <p>
            {blocked
              ? t("library.dropZone.blocked")
              : automatic
                ? t("library.dropZone.automatic")
                : t("library.dropZone.manual")}
          </p>
        </div>
        <div className="archive-drop-zone-actions">
          <button className="button primary" onClick={onAdd}>
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
              <path d="M7.5 2v11M2 7.5h11" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t("library.dropZone.add")}
          </button>
          <label
            className="switch archive-automatic-toggle"
            title={t("library.dropZone.automatic.hint")}
          >
            <input
              type="checkbox"
              checked={automatic}
              onChange={(event) => onAutomatic(event.target.checked)}
            />
            <span className="switch-track" aria-hidden />
            <span className="switch-label">{t("library.dropZone.automatic.label")}</span>
          </label>
        </div>
      </div>
    </div>
  );
}

/** A folder as a card the size of a transcript's, in paper yellow — the one
 *  colour in this interface that is not chrome. Notes use it too, in the
 *  transcript's sidebar, and the two never share a screen. */
function FolderRow({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: Folder;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const formats = useFormats();
  return (
    <li className="row folder-row">
      <button className="row-main" onClick={onOpen}>
        <span className="folder-mark" aria-hidden>
          <LineIcon name="folder" size={26} />
        </span>
        <span className="row-text">
          <span className="row-title">
            <span className="row-name">{folder.name}</span>
          </span>
          <span className="recording-metadata">
            <RecordingMetadataItem
              kind="segments"
              label={t("library.folders.count")}
              value={formats.transcriptCount(folder.recording_count)}
            />
            {folder.duration > 0 && (
              <RecordingMetadataItem
                kind="duration"
                label={t("library.card.duration")}
                value={formats.archiveDuration(folder.duration)}
              />
            )}
          </span>
        </span>
      </button>
      {/* The same pair a transcript card ends in: the plain action, then the
          three dots. A folder will collect more actions over time and they
          belong in that menu rather than as more buttons on the row. */}
      <div className="row-actions">
        <button className="button" onClick={onOpen}>
          {t("common.open")}
        </button>
        <ActionMenu
          items={[
            { label: t("common.rename"), icon: MENU_ICONS.rename, action: onRename },
            {
              label: t("library.folders.delete"),
              icon: MENU_ICONS.remove,
              action: onDelete,
              warning: true,
            },
          ]}
        />
      </div>
    </li>
  );
}

function Row({
  recording,
  progress,
  aiProgress,
  liveSegments,
  onOpen,
  onExportAudio,
  folders,
  onMoveToFolder,
  onCreateFolderFor,
  onDelete,
  onTranscription,
  onCancel,
  onDeleteTranscription,
  onTranscriptionLanguage,
  onRename,
}: {
  recording: Recording;
  progress?: TranscriptionProgress;
  aiProgress?: AiEditProgress;
  liveSegments: LiveSegment[];
  onOpen: () => void;
  onExportAudio: () => void;
  folders: Folder[];
  onMoveToFolder: (folder: string | null) => void;
  onCreateFolderFor: () => void;
  onDelete: () => void;
  onTranscription: () => void;
  onCancel: () => void;
  onDeleteTranscription: () => void;
  onTranscriptionLanguage: (language: string) => void;
  onRename: (title: string) => void;
}) {
  const { t } = useI18n();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();
  const labels = useLabels();
  const formats = useFormats();
  const running = recording.status === "transcribing";
  const aiRunning = !!aiProgress && !["complete", "error", "cancelled"].includes(aiProgress.phase);
  const [renaming, setRenaming] = useState(false);
  const last = liveSegments.slice(-3);
  const phaseKey: TranslationKey | undefined = PHASE_KEYS[progress?.phase ?? ""];
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [liveSegments.length]);

  return (
    <li className={`row ${running || aiRunning ? "running" : ""}`}>
      {/* Renaming happens in the shared dialog, the same one a folder is
          named in. The field used to sit in the row itself, which meant a
          card in two shapes and a name that could be lost to a stray click. */}
      <NameDialog
        open={renaming}
        title={t("dialogs.rename.title")}
        text={t("dialogs.rename.text")}
        label={t("dialogs.rename.label")}
        placeholder={t("dialogs.rename.placeholder")}
        submitLabel={t("common.save")}
        initialName={shownName(recording)}
        onClose={() => setRenaming(false)}
        onSubmit={(name) => {
          setRenaming(false);
          if (name !== recording.title) onRename(name);
        }}
      />
      <button
        className="row-main"
        onClick={onOpen}
        disabled={running && !liveSegments.length}
      >
        <RecordingCalendar value={recording.created_at} />
        <span className="row-text">
          <span className="row-title">
            <span className="row-status-icon" aria-hidden>
              <span className={`status-mark ${statusClass(recording.status)}`} />
            </span>
            <span className="row-name">{shownName(recording)}</span>
          </span>
          <span className="recording-metadata">
            <RecordingMetadataItem
              kind="duration"
              label={t("library.card.duration")}
              value={formatTime(recording.duration)}
            />
            {recording.language && (
              <RecordingMetadataItem
                kind="language"
                label={t("library.card.language")}
                value={labels.languageCapitalized(recording.language)}
              />
            )}
            {recording.model && (
              <RecordingMetadataItem
                kind="model"
                label={t("library.card.model")}
                value={labels.model(recording.model)}
              />
            )}
            {recording.status === "done" && (
              <RecordingMetadataItem
                kind="segments"
                label={t("library.card.segments")}
                value={formats.segmentCount(recording.segment_count)}
              />
            )}
            {recording.status === "error" && (
              <RecordingMetadataItem
                kind="error"
                label={t("library.card.error")}
                value={
                  recording.error
                    ? userMessage(recording.error)
                    : t("library.card.unknownError")
                }
              />
            )}
          </span>
        </span>
      </button>

      <div className="row-actions">
        {running ? (
          <button className="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        ) : (
          <>
            {recording.status === "new" && (
              <button className="button" onClick={onTranscription}>
                {t("library.card.transcribe")}
              </button>
            )}
            {recording.status === "error" && (
              <button className="button" onClick={onTranscription}>
                {t("common.retry")}
              </button>
            )}
            {recording.status === "done" && (
              <button className="button" onClick={onOpen}>
                {t("common.open")}
              </button>
            )}
            <RecordingActionsMenu
              status={recording.status}
              onRename={() => setRenaming(true)}
              onExportAudio={onExportAudio}
              folders={folders}
              folder={recording.folder}
              onMoveToFolder={onMoveToFolder}
              onCreateFolderFor={onCreateFolderFor}
              onRetranscribe={onTranscription}
              onDeleteTranscript={onDeleteTranscription}
              onTranscribeInLanguage={onTranscriptionLanguage}
              onRemove={onDelete}
            />
          </>
        )}
      </div>

      {running && (
        <div className="progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          <div className="progress-label">
            <span>
              {(progress && progressMessage(progress.description)) ||
                (phaseKey && t(phaseKey)) ||
                t("library.card.phase.working")}
            </span>
            <span>{t("library.card.percent", { value: progress?.percent ?? 0 })}</span>
          </div>

          {last.length > 0 && (
            <div className="live-text">
              {last.map((s, i) => (
                <p key={`${s.start}-${i}`}>{s.text}</p>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}

      {aiRunning && (
        <div className="progress progress-ai" aria-live="polite">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${aiProgress.percent}%` }} />
          </div>
          <div className="progress-label">
            <span>
              {progressMessage(aiProgress.description) || t("library.card.aiEditing")}
            </span>
            <span>{t("library.card.percent", { value: Math.round(aiProgress.percent) })}</span>
          </div>
        </div>
      )}
    </li>
  );
}

/** The date as a torn-off calendar leaf. Exported because the backups list
 *  shows dates in the same shape, and two drawings of one idea drift apart. */
export function RecordingCalendar({ value }: { value: string }) {
  const { t, formatDate } = useI18n();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const year = match?.[1] ?? "----";
  const monthIndex = Math.max(0, Math.min(11, Number(match?.[2] ?? 1) - 1));
  const day = match ? String(Number(match[3])) : "–";
  const month = match ? t(CALENDAR_MONTH_KEYS[monthIndex]) : t("library.card.monthUnknown");
  const label = match
    ? t("library.card.addedOn", {
        date: formatDate(
          new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
          { day: "numeric", month: "numeric", year: "numeric" }
        ),
      })
    : t("library.card.addedOnUnknown");

  return (
    <span className="recording-calendar" aria-label={label} title={label}>
      <span className="recording-calendar-month">{month}</span>
      <span className="recording-calendar-day">{day}</span>
      <span className="recording-calendar-year">{year}</span>
    </span>
  );
}

function SearchResults({
  results,
  onOpen,
}: {
  results: SearchResult[];
  onOpen: (id: string, time?: number) => void;
}) {
  const { t } = useI18n();
  if (results.length === 0) {
    return <p className="empty-result">{t("library.empty.results")}</p>;
  }
  return (
    <ul className="results">
      {results.map((v) => (
        <li key={v.segment_id}>
          <button onClick={() => onOpen(v.recording_id, v.start)}>
            <span className="result-where">
              {t("library.search.location", { title: v.title, time: formatTime(v.start) })}
            </span>
            <span className="result-text">{highlight(v.text)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** SQLite returns the matched words wrapped in << >>; this turns them into the
 *  highlight. */
function highlight(text: string) {
  const parts = text.split(/(<<|>>)/);
  const out: JSX.Element[] = [];
  let uvnitr = false;
  parts.forEach((c, i) => {
    if (c === "<<") uvnitr = true;
    else if (c === ">>") uvnitr = false;
    else if (c)
      out.push(
        uvnitr ? (
          <mark key={i}>{c}</mark>
        ) : (
          <span key={i}>{c}</span>
        )
      );
  });
  return out;
}
