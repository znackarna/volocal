import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";

import { api } from "./api";
import PlaybackControls from "./PlaybackControls";
import { EMPTY_WAVEFORM, loadWaveform, usePlayer } from "./player";
import type { Waveform } from "./player";
import { CONFIDENCE_THRESHOLD, formatTime, languageName, modelName, fileName } from "./types";
import type { Speaker, Segment, DictionaryEntry, TranscriptionProgress, LiveSegment } from "./types";

interface Props {
  id: string;
  seekTime: number | null;
  progress?: TranscriptionProgress;
  liveSegments: LiveSegment[];
  onBack: () => void;
  onError: (z: string) => void;
}

/** Kept short so the menu label fits on a single line. */
const FORMAT_DESCRIPTIONS: Record<string, string> = {
  txt: "Čistý text",
  md: "Markdown",
  srt: "Titulky",
  vtt: "Webové titulky",
  json: "Data pro aplikace",
};

const EXPORT_FORMATS = ["txt", "md", "srt", "vtt", "json"] as const;

/** A single button with a format menu. */
function ExportMenu({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (format: string) => void;
}) {
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
        Uložit přepis
        <svg className="ulozit-sipka" width="12" height="12" viewBox="0 0 24 24"
             fill="none" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="ulozit-seznam" role="menu">
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
              <span className="ulozit-popis">{FORMAT_DESCRIPTIONS[f]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Czech plural forms for the count of uncertain spots. */
function countUncertainPlaces(n: number): string {
  if (n === 1) return "1 místo";
  if (n < 5) return `${n} místa`;
  return `${n} míst`;
}

export default function Detail({ id, seekTime, progress, liveSegments, onBack, onError }: Props) {
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [language, setLanguage] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);

  // The player is shared across the app so sound survives leaving this
  // screen. Opening another transcript does not touch it — until you press
  // play, whatever was playing keeps playing.
  const player = usePlayer();
  const isCurrentRecording = player.recordingId === id;
  // Cursor in a transcript that does not own the audio yet.
  const [localTime, setLocalTime] = useState(0);
  const time = isCurrentRecording ? player.time : localTime;
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

  const togglePlayback = useCallback(() => {
    const s = current.current;
    if (s.isCurrentRecording) s.player.togglePlayback();
    else if (s.path) s.player.start(s.id, s.path, s.title, s.duration, s.localTime);
  }, []);
  const [editing, setEditing] = useState<string | null>(null);
  // The panel is remembered between recordings: whoever closes it wants quiet.
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem("panel") !== "zavreny"
  );
  const [diarizing, setDiarizing] = useState(false);
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
      const [dictionaryEntries, exists] = await Promise.all([
        api.dictionary(),
        api.fileExists(d.recording.path),
      ]);
      setTitle(d.recording.title);
      setPath(d.recording.path);
      setDuration(d.recording.duration);
      setStatus(d.recording.status);
      setModel(d.recording.model);
      setLanguage(d.recording.language);
      setSegments(d.segments);
      setSpeakers(d.speakers);
      setDictionary(dictionaryEntries);
      setSourceMissing(!exists);
    } catch (e) {
      onError(String(e));
    }
  }, [id, onError]);

  useEffect(() => {
    load();
  }, [load]);

  // po dokonceni prepisu se detail sam obnovi
  useEffect(() => {
    if (progress?.phase === "complete") load();
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
  useEffect(() => {
    if (!isCurrentRecording) return;
    return () => setLocalTime(player.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentRecording]);

  // ---------------------------------------------------------------- klavesnice
  const uncertainSegments = useMemo(
    () => segments.filter((s) => (s.confidence ?? 1) < CONFIDENCE_THRESHOLD && !s.verified),
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

  const goToNextUncertain = useCallback(() => {
    if (uncertainSegments.length === 0) return;
    goTo(uncertainSegments.find((s) => s.start > time + 0.05) ?? uncertainSegments[0]);
  }, [uncertainSegments, time, goTo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);

      if (e.code === "Space" && !isTyping) {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === "Tab" && !isTyping) {
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
          name: "Zvuk a video",
          extensions: ["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "mp4", "mkv", "mov"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    try {
      await api.changeRecordingPath(id, selected);
      await load();
    } catch (e) {
      onError(String(e));
    }
  }, [id, load, onError]);

  const startTranscription = useCallback(async () => {
    try {
      await api.startTranscription(id);
      setStatus("prepisuje");
    } catch (e) {
      onError(String(e));
    }
  }, [id, onError]);

  const startEditing = useCallback((segment: Segment) => {
    setEditing(segment.id);
  }, []);

  const confirm = useCallback(async (segment: Segment) => {
    setSegments((p) =>
      p.map((x) => (x.id === segment.id ? { ...x, verified: true } : x))
    );
    try {
      await api.markVerified(segment.id, true);
    } catch (e) {
      onError(String(e));
    }
  }, [onError]);

  // ---------------------------------------------------------------- editace
  const saveText = useCallback(
    async (segment: Segment, newText: string) => {
      const trimmedText = newText.trim();
      setEditing(null);
      if (trimmedText === segment.text) return;

      try {
        await api.updateSegment(segment.id, trimmedText);
        setSegments((s) =>
          s.map((x) => (x.id === segment.id ? { ...x, text: trimmedText, edited: true } : x))
        );

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
        onError(String(e));
      }
    },
    [dictionary, onError]
  );

  const confirmDictionary = useCallback(async () => {
    if (!dictionarySuggestion) return;
    const { z, na } = dictionarySuggestion;
    setDictionarySuggestion(null);
    try {
      const p = await api.addDictionaryEntry(z, na, true);
      setDictionary((s) => [...s, p]);
      // The dictionary used to take effect only in the next transcription.
      // The same word usually occurs several times in a recording, and fixing
      // each by hand is wasted work.
      const changesApplied = await api.applyDictionary(id);
      if (changesApplied > 0) await load();
      // Always report, even when nothing else changed. Without confirmation
      // there is no telling whether the term was saved at all.
      onError(
        changesApplied === 0
          ? `„${z}“ → „${na}“ je ve slovníku. Jinde v tomhle přepisu se nevyskytuje.`
          : changesApplied === 1
            ? `„${z}“ → „${na}“ je ve slovníku. Opraveno i na jednom dalším místě.`
            : `„${z}“ → „${na}“ je ve slovníku. Opraveno i na ${changesApplied} dalších místech.`
      );
    } catch (e) {
      onError(String(e));
    }
  }, [dictionarySuggestion, id, load, onError]);

  // ---------------------------------------------------------------- mluvci
  const speakerByKey = useMemo(() => {
    const m = new Map<string, Speaker>();
    speakers.forEach((x) => m.set(x.key, x));
    return m;
  }, [speakers]);

  const rename = useCallback(
    async (key: string, name: string) => {
      setSpeakers((s) => s.map((m) => (m.key === key ? { ...m, name } : m)));
      try {
        await api.renameSpeaker(id, key, name);
      } catch (e) {
        onError(String(e));
      }
    },
    [id, onError]
  );

  const merge = useCallback(
    async (z: string, toKey: string) => {
      try {
        await api.mergeSpeakers(id, z, toKey);
        await load();
      } catch (e) {
        onError(String(e));
      }
    },
    [id, load, onError]
  );

  const togglePanel = useCallback(() => {
    setPanelOpen((o) => {
      localStorage.setItem("panel", o ? "zavreny" : "otevreny");
      return !o;
    });
  }, []);

  const diarizeSpeakers = useCallback(async () => {
    setDiarizing(true);
    try {
      await api.diarizeSpeakers(id);
    } catch (e) {
      onError(String(e));
      setDiarizing(false);
    }
  }, [id, onError]);

  // the detail refreshes itself once diarization finishes
  useEffect(() => {
    if (progress?.phase === "complete" && diarizing) {
      setDiarizing(false);
      load();
    }
    if (progress?.phase === "error" && diarizing) setDiarizing(false);
  }, [progress?.phase, diarizing, load]);

  // ---------------------------------------------------------------- export
  const exportRecording = useCallback(
    async (format: string) => {
      try {
        const name = await api.suggestedName(id, format);
        const destination = await save({ defaultPath: name });
        if (!destination) return;
        await api.saveExport(id, format, destination);
      } catch (e) {
        onError(String(e));
      }
    },
    [id, onError]
  );

  // ---------------------------------------------------------------- render
  const running = status === "prepisuje";
  const active = useMemo(
    () => segments.find((s) => time >= s.start && time < s.end),
    [segments, time]
  );

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

  return (
    <main className="detail">
      <div className="detail-hlavicka">
        <h1 className="detail-nazev">
          <svg className="ikona-souboru" viewBox="0 0 12 15" aria-hidden>
            <path d="M1.6 1.1h5.1L10.4 4.8v9.1H1.6z" fill="none" stroke="currentColor"
                  strokeWidth="1.15" strokeLinejoin="round" />
            <path d="M6.7 1.1v3.7h3.7" fill="none" stroke="currentColor"
                  strokeWidth="1.15" strokeLinejoin="round" />
          </svg>
          <span className="detail-jmeno">{fileName(path) || title}</span>
        </h1>
        <div className="detail-akce">
          {/* Pět zkratek formátů vedle sebe vypadalo jako panel nástrojů
              a přebíjelo název souboru. Uložení je přitom jedna akce. */}
          <ExportMenu
            disabled={segments.length === 0}
            onChoose={exportRecording}
          />

          <span className="delic" aria-hidden />

          {/* Přepínač panelu je pomocná věc — ikona, ne tlačítko křičící
              stejně nahlas jako export. */}
          <button
            className="ikona-tlacitko"
            onClick={togglePanel}
            aria-pressed={panelOpen}
            aria-label={panelOpen ? "Skrýt postranní panel" : "Zobrazit postranní panel"}
            title={panelOpen ? "Skrýt postranní panel" : "Zobrazit postranní panel"}
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
        </div>
      </div>

      {status === "nova" && !sourceMissing ? (
        /* With no transcript there is nothing to control: this spot belongs
           místo výzva, kvůli které sem člověk přišel. */
        <div className="prehravac prehravac-vyzva">
          <span>Tahle nahrávka ještě není přepsaná.</span>
          <button className="tlacitko hlavni" onClick={startTranscription}>
            Přepsat
          </button>
        </div>
      ) : sourceMissing ? (
        /* The transcript stays usable without audio; it just cannot be played. */
        <div className="prehravac prehravac-chybi">
          <span>
            Zvukový file už na svém místě není. Přepis zůstává, přehrát ho
            ale nelze.
          </span>
          <button className="tlacitko" onClick={locateSourceFile}>
            Najít file
          </button>
        </div>
      ) : running ? (
        /* Until transcription ends there is nothing to play; progress replaces the controls. */
        <div className="prehravac prehravac-ceka">
          <div className="prubeh-lista">
            <div className="prubeh-vypln" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          <span className="cas">
            {progress?.description ?? "Přepisuji"} · {progress?.percent ?? 0} %
          </span>
        </div>
      ) : (
        <PlaybackControls
          isCurrentRecording={isCurrentRecording}
          waveform={waveform}
          time={time}
          duration={trackDuration}
          isPlaying={isPlaying}
          onPlayPauza={togglePlayback}
          /* Dragging the slider does not start audio, it only moves the cursor. */
          onSeek={updateCursor}
        />
      )}

      {/* Zkratky se jinak nikdo nedozví — a Tab je to nejužitečnější,
          co tahle obrazovka umí. */}
      {segments.length > 0 && (
        <div className="zkratky">
          <span><kbd>mezerník</kbd> přehrát</span>
            <span><kbd>klik na slovo</kbd> posun ve zvuku</span>
          <span><kbd>dvojklik</kbd> úprava textu</span>
          <span className="zkratka-duraz"><kbd>Tab</kbd> další nejisté místo</span>
        </div>
      )}

      <div className={`detail-telo ${panelOpen ? "" : "bez-panelu"}`}>
        <div className="prepis" ref={listRef}>
          {running && segments.length === 0 && (
            <div className="zivy-prepis">
              {liveSegments.map((s, i) => (
                <p key={i}>{s.text}</p>
              ))}
              {liveSegments.length === 0 && <p className="drobne">Příprava…</p>}
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
                {/* Obsluhy nesmí vznikat tady. Kdyby se `onOdklepni` a spol.
                    tvořily pro každý úsek při každém vykreslení, porovnání
                    v `memo` by nikdy neprošlo a tikající čas by překresloval
                    celý přepis. Proto dostávají úsek až jako argument. */}
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
                />
              </div>
            );
          })}

          {!running && segments.length === 0 && (
            <p className="drobne">Nahrávka zatím není přepsaná.</p>
          )}
        </div>

        {panelOpen && (
        <aside className="postranni">
          {/* Čím a v jakém jazyce přepis vznikl. Nastavení se dá mezitím
              změnit, takže je potřeba vidět, co platilo pro tuhle nahrávku. */}
          {segments.length > 0 && (
            <section>
              <h2>Přepis</h2>
              <dl className="udaje">
                <div>
                  <dt>Model</dt>
                  <dd>{model ? modelName(model) : "—"}</dd>
                </div>
                <div>
                  <dt>Jazyk</dt>
                  <dd>{language ? languageName(language) : "—"}</dd>
                </div>
              </dl>
            </section>
          )}

          <section>
            <h2>Mluvčí</h2>
            {speakers.length === 0 ? (
              <>
                <p className="drobne">
                  Přepis není rozdělen podle mluvčích. U nahrávek s více
                  mluvčími lze rozdělení doplnit.
                </p>
                <button
                  className="tlacitko"
                  onClick={diarizeSpeakers}
                  disabled={diarizing || running || segments.length === 0}
                >
                  {diarizing ? "Rozlišuji…" : "Rozlišit mluvčí"}
                </button>
                <p className="drobne">
                  Přepis se neprovádí znovu. U hodinového záznamu trvá
                  rozlišení několik minut.
                </p>
              </>
            ) : (
              <ul className="mluvci-seznam">
                {speakers.map((m) => (
                  <li key={m.key}>
                    <span className="tecka" style={{ background: m.color }} />
                    <input
                      value={m.name}
                      onChange={(e) => rename(m.key, e.target.value)}
                      spellCheck={false}
                    />
                    {speakers.length > 1 && (
                      <select
                        value=""
                        onChange={(e) => e.target.value && merge(m.key, e.target.value)}
                        title="Sloučit s jiným mluvčím"
                      >
                        <option value="">sloučit s…</option>
                        {speakers
                          .filter((x) => x.key !== m.key)
                          .map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {speakers.length > 0 && (
              <button
                className="tlacitko tichy"
                onClick={diarizeSpeakers}
                disabled={diarizing || running}
                style={{ marginTop: 8 }}
              >
                {diarizing ? "Rozlišuji…" : "Rozlišit znovu"}
              </button>
            )}
          </section>

          <section>
            <h2>Nejistá místa</h2>
            {uncertainSegments.length === 0 ? (
              <p className="drobne">Žádná. Model si byl jistý v celém přepisu.</p>
            ) : (
              <>
                <p className="drobne">
                  {countUncertainPlaces(uncertainSegments.length)} k ověření. Klávesa Tab
                  mezi nimi přeskakuje.
                </p>
                <ul className="nejista-mista">
                  {uncertainSegments.map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => goTo(u)}
                        className={u.start <= time && time < u.end ? "aktivni" : ""}
                      >
                        <span className="nejiste-cas">{formatTime(u.start)}</span>
                        <span className="nejisty-text">{u.text}</span>
                      </button>
                      <button
                        className="odklepnout"
                        title="Je to správně"
                        aria-label="Označit jako správné"
                        onClick={() => confirm(u)}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                          <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor"
                                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section>
            <h2>Slovník</h2>
            <p className="drobne">
              Výrazy, které model chybně přepisuje. Předávají se mu předem
              a zároveň se opravují ve výsledném textu.
            </p>
            <ul className="slovnik-seznam">
              {dictionary.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.find} → <strong>{p.replace}</strong>
                  </span>
                  <button
                    className="odebrat-vyraz"
                    title="Odebrat ze slovníku"
                    aria-label={`Odebrat ${p.find} ze slovníku`}
                    onClick={async () => {
                      await api.deleteDictionaryEntry(p.id);
                      setDictionary((s) => s.filter((x) => x.id !== p.id));
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                      <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor"
                            strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
              {dictionary.length === 0 && <li className="drobne">Zatím prázdný.</li>}
            </ul>
          </section>
        </aside>
        )}
      </div>

      {dictionarySuggestion && (
        <div className="nabidka">
          <span>
            Opravovat „{dictionarySuggestion.z}" na „{dictionarySuggestion.na}" i příště?
          </span>
          <button className="tlacitko" onClick={confirmDictionary}>
            Přidat to slovníku
          </button>
          <button className="tlacitko tichy" onClick={() => setDictionarySuggestion(null)}>
            Ne
          </button>
        </div>
      )}
    </main>
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
}) {
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
              className={`slovo ${active && time >= s.time ? "znelo" : ""}`}
              onClick={() => onSeek(s.time)}
              title="Kliknutí přesune přehrávání, dvojklik otevře úpravu textu"
            >
              {s.text}
            </span>
          )
        )}
        {segment.edited && <span className="upraveno-znak" title="Ručně upraveno">✎</span>}
      </p>

      {uncertain && (
        <div className="segment-akce">
          <button title="Je to správně" aria-label="Označit jako správné"
                  onClick={() => onConfirm(segment)}>
            <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden>
              <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button title="Opravit text" aria-label="Opravit text"
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
  // Only the segment currently sounding cares about the time.
  (!b.active || a.time === b.time)
);
