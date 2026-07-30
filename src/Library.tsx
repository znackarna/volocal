import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import mark from "./mark.svg?raw";
import { LANGUAGE_OPTIONS, formatTime, languageName, modelName, fileName } from "./types";
import type { Recording, TranscriptionProgress, SearchResult, LiveSegment } from "./types";

interface Props {
  recordings: Recording[];
  progress: Record<string, TranscriptionProgress>;
  liveSegments: Record<string, LiveSegment[]>;
  issues: string[];
  onOpen: (id: string, time?: number) => void;
  onDelete: (id: string) => void;
  onTranscription: (id: string) => void;
  onCancel: (id: string) => void;
  onDeleteTranscription: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onAdd: () => void;
  onToSettings: () => void;
  automatic: boolean;
  onAutomatic: (enabled: boolean) => void;
  onTranscriptionLanguage: (id: string, language: string) => void;
}

const PHASE_LABELS: Record<string, string> = {
  preparation: "Připravuji zvuk",
  transcription: "Přepisuji",
  diarization: "Rozlišuji mluvčí",
  saving: "Ukládám",
  complete: "Hotovo",
  error: "Chyba",
  cancelled: "Přerušeno",
};

export default function Library({
  recordings,
  progress,
  liveSegments,
  issues,
  onOpen,
  onDelete,
  onTranscription,
  onCancel,
  onDeleteTranscription,
  onRename,
  onAdd,
  onToSettings,
  automatic,
  onAutomatic,
  onTranscriptionLanguage,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);

  // Hledani se spousti samo, ale az kdyz uzivatel na chvili prestane psat.
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

  const running = useMemo(
    () => recordings.filter((n) => n.status === "prepisuje"),
    [recordings]
  );

  return (
    <main className="knihovna">
      {issues.length > 0 && (
        <div className="upozorneni">
          <div>
            <strong>Chybí položky nutné pro přepis</strong>
            <ul>
              {issues.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          <button className="tlacitko" onClick={onToSettings}>
            Nastavení
          </button>
        </div>
      )}

      <div className="knihovna-lista">
        <div className="hledani">
          <input
            type="search"
            placeholder="Hledat v přepisech…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>

        <label className="vypinac" title="Spustit přepis hned po přidání nahrávky">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(e) => onAutomatic(e.target.checked)}
          />
          <span className="vypinac-drazka" aria-hidden />
          <span className="vypinac-popis">Automatický přepis</span>
        </label>
      </div>

      {results !== null ? (
        <SearchResults results={results} onOpen={onOpen} />
      ) : recordings.length === 0 ? (
        <EmptyLibrary onAdd={onAdd} automatic={automatic} />
      ) : (
        <ul className="seznam">
          {recordings.map((n) => (
            <Row
              key={n.id}
              recording={n}
              progress={progress[n.id]}
              liveSegments={liveSegments[n.id] ?? []}
              onOpen={() => onOpen(n.id)}
              onDelete={() => onDelete(n.id)}
              onTranscription={() => onTranscription(n.id)}
              onCancel={() => onCancel(n.id)}
              onDeleteTranscription={() => onDeleteTranscription(n.id)}
              onTranscriptionLanguage={(j) => onTranscriptionLanguage(n.id, j)}
              onRename={(title) => onRename(n.id, title)}
            />
          ))}
          {/* Plocha na puštění souboru nesmí zmizet jen proto, že v archivu
              už něco je — jinak není kam mířit. */}
          <li>
            <button className="pridat-pruh" onClick={onAdd}>
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
                <path d="M7.5 2v11M2 7.5h11" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Přetáhni sem další nahrávku nebo select file
            </button>
          </li>
        </ul>
      )}

      {running.length > 1 && (
        <p className="poznamka">
          Souběžně probíhá {running.length} přepisů. Sdílejí jednu grafickou
          kartu, postupné zpracování by bylo rychlejší.
        </p>
      )}
    </main>
  );
}

function EmptyLibrary({ onAdd, automatic }: { onAdd: () => void; automatic: boolean }) {
  return (
    <div className="prazdno">
      {/* Ohraničená plocha dává kompozici kotvu a zároveň říká,
          kam se dá pustit soubor. Bez ní text jen plave uprostřed. */}
      <div className="prazdno-plocha">
        <span
          className="prazdno-znak"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: mark }}
        />
        <h1>Sem přetáhni nahrávku</h1>
        <p>
          {automatic
            ? "Přepis začne automaticky. Žádná data neopustí tento počítač."
            : "Přepis spustíte tlačítkem u nahrávky. Žádná data neopustí tento počítač."}
        </p>
        <button className="tlacitko hlavni" onClick={onAdd}>
          Vybrat file
        </button>
      </div>
    </div>
  );
}

function Row({
  recording,
  progress,
  liveSegments,
  onOpen,
  onDelete,
  onTranscription,
  onCancel,
  onDeleteTranscription,
  onTranscriptionLanguage,
  onRename,
}: {
  recording: Recording;
  progress?: TranscriptionProgress;
  liveSegments: LiveSegment[];
  onOpen: () => void;
  onDelete: () => void;
  onTranscription: () => void;
  onCancel: () => void;
  onDeleteTranscription: () => void;
  onTranscriptionLanguage: (language: string) => void;
  onRename: (title: string) => void;
}) {
  const running = recording.status === "prepisuje";
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(recording.title);
  const last = liveSegments.slice(-3);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [liveSegments.length]);

  return (
    <li className={`radek ${running ? "bezi" : ""}`}>
      <button
        className="radek-hlavni"
        onClick={onOpen}
        disabled={renaming || (running && !liveSegments.length)}
      >
        <span className={`znak ${recording.status}`} aria-hidden />
        <span className="radek-text">
          {renaming ? (
            <input
              className="radek-prejmenovani"
              value={newTitle}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={() => {
                onRename(newTitle);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setNewTitle(recording.title);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <span className="radek-nazev">
              {/* Výška ikony = výška verzálky písma, ne celého řádku.
                  Jinak přeroste text a řádek se opticky rozpadne. */}
              <svg className="ikona-souboru" viewBox="0 0 12 15" aria-hidden>
                <path d="M1.6 1.1h5.1L10.4 4.8v9.1H1.6z" fill="none" stroke="currentColor"
                      strokeWidth="1.15" strokeLinejoin="round" />
                <path d="M6.7 1.1v3.7h3.7" fill="none" stroke="currentColor"
                      strokeWidth="1.15" strokeLinejoin="round" />
              </svg>
              <span className="radek-jmeno">{fileName(recording.path) || recording.title}</span>
            </span>
          )}
          <span className="radek-meta">
            {formatTime(recording.duration)}
            {recording.language && ` · ${languageName(recording.language)}`}
            {recording.model && ` · ${modelName(recording.model)}`}
            {recording.status === "hotova" && ` · ${recording.segment_count} úseků`}
            {recording.status === "chyba" && ` · ${recording.error ?? "chyba"}`}
          </span>
        </span>
      </button>

      <div className="radek-akce">
        {running ? (
          <button className="tlacitko" onClick={onCancel}>
            Zrušit
          </button>
        ) : (
          <>
            {recording.status === "nova" && (
              <button className="tlacitko" onClick={onTranscription}>
                Přepsat
              </button>
            )}
            {recording.status === "chyba" && (
              <button className="tlacitko" onClick={onTranscription}>
                Zkusit znovu
              </button>
            )}
            {recording.status === "hotova" && (
              <button className="tlacitko" onClick={onOpen}>
                Otevřít
              </button>
            )}
            <Menu
              items={[
                {
                  label: "Přejmenovat",
                  icon: Icons.rename,
                  action: () => setRenaming(true),
                },
                ...(recording.status === "hotova"
                  ? [
                      { label: "Přepsat znovu", icon: Icons.retranscribe, action: onTranscription },
                      { label: "Smazat přepis", icon: Icons.deleteTranscript, action: onDeleteTranscription },
                    ]
                  : []),
                {
                  label: "Přepsat v jazyce",
                  icon: Icons.language,
                  children: LANGUAGE_OPTIONS.map((v) => ({
                    label: v.label,
                    action: () => onTranscriptionLanguage(v.value),
                  })),
                },
                {
                  label: "Odebrat z archivu",
                  icon: Icons.remove,
                  action: onDelete,
                  warning: true,
                },
              ]}
            />
          </>
        )}
      </div>

      {running && (
        <div className="prubeh">
          <div className="prubeh-lista">
            <div className="prubeh-vypln" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          <div className="prubeh-popis">
            <span>{PHASE_LABELS[progress?.phase ?? "preparation"] ?? "Pracuji"}</span>
            <span>{progress?.percent ?? 0} %</span>
          </div>

          {last.length > 0 && (
            <div className="zivy-text">
              {last.map((s, i) => (
                <p key={`${s.start}-${i}`}>{s.text}</p>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Menu icons. Uniform 1.7 stroke on a 20 square, like the rest of the UI. */
const Icons = {
  rename: "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z M13.5 6.5l4 4",
  retranscribe: "M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6",
  deleteTranscript: "M6 4h8l4 4v12H6z M14 4v4h4 M9.5 12.5l5 5 M14.5 12.5l-5 5",
  language: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3.6 9h16.8 M3.6 15h16.8 M12 3c2.3 2.4 3.5 5.6 3.5 9S14.3 18.6 12 21c-2.3-2.4-3.5-5.6-3.5-9S9.7 5.4 12 3Z",
  remove: "M4 7h16 M10 4h4 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
} as const;

function FileMark({ path }: { path: string }) {
  return (
    <svg
      className="nabidka-ikona"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {path.split(" M").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}

interface ActionItem {
  label: string;
  action?: () => void;
  warning?: boolean;
  /** Path from the icon set. Second-level items do not have one. */
  icon?: string;
  /** Opens the second level instead of performing an action. */
  children?: ActionItem[];
}

/** Overflow menu with secondary actions. The primary action stays beside it
 *  as a button; only rarely used things belong in the menu. */
function Menu({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  // Second menu level. Ten languages in one flat list would be unbearable.
  const [submenu, setSubmenu] = useState<ActionItem | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setSubmenu(null);
  }, [open]);

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
    <div className="nabidka-akci" ref={container}>
      <button
        className="ikona-tlacitko"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Další akce"
      >
        <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden>
          <circle cx="2" cy="2" r="1.7" fill="currentColor" />
          <circle cx="8" cy="2" r="1.7" fill="currentColor" />
          <circle cx="14" cy="2" r="1.7" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="nabidka-akci-seznam" role="menu">
          {submenu && (
            <button className="nabidka-zpet" onClick={() => setSubmenu(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M15 5l-7 7 7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {submenu.label}
            </button>
          )}
          {(submenu?.children ?? items).map((p) => (
            <button
              key={p.label}
              role="menuitem"
              className={p.warning ? "varovne" : ""}
              onClick={() => {
                if (p.children) {
                  setSubmenu(p);
                  return;
                }
                setOpen(false);
                p.action?.();
              }}
            >
              {p.icon && <FileMark path={p.icon} />}
              <span className="nabidka-popisek">{p.label}</span>
              {p.children && (
                <svg
                  className="nabidka-sipka"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M9 5l7 7-7 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({
  results,
  onOpen,
}: {
  results: SearchResult[];
  onOpen: (id: string, time?: number) => void;
}) {
  if (results.length === 0) {
    return <p className="prazdny-vysledek">Žádné výsledky.</p>;
  }
  return (
    <ul className="vysledky">
      {results.map((v) => (
        <li key={v.segment_id}>
          <button onClick={() => onOpen(v.recording_id, v.start)}>
            <span className="vysledek-kde">
              {v.title} · {formatTime(v.start)}
            </span>
            <span className="vysledek-text">{highlight(v.text)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** SQLite vraci nalezena slova obalena v << >> - prevedeme je na zvyrazneni. */
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
