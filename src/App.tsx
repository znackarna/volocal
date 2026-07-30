import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";

import { api } from "./api";
import { equalizerAtTime, Waveform, usePlayer } from "./player";
import Library from "./Library";
import Detail from "./Detail";
import SettingsScreen from "./Settings";
import SetupWizard from "./SetupWizard";
import ConfirmationDialog from "./ConfirmationDialog";
// inlined into the page rather than via <img>, for sharpness and colours
import mark from "./mark.svg?raw";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import { formatTime, applyFonts } from "./types";
import type { ToolCheck, Recording, TranscriptionProgress, LiveSegment } from "./types";

const SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mkv", "mov", "webm"];

export default function App() {
  const [screen, setScreen] = useState<
    "library" | "detail" | "settings" | "wizard"
  >("library");
  const [wizardRequired, setWizardRequired] = useState(false);
  // When settings sends the user to the modules for one specific thing, the
  // wizard preselects it instead of walking through every step.
  const [missingModule, setMissingModule] = useState<string | null>(null);
  // Transcribe on add, or wait for the word. The choice survives restarts.
  const [automatic, setAutomatic] = useState(
    () => localStorage.getItem("prepisovat-rovnou") !== "ne"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seekTime, setSeekTime] = useState<number | null>(null);

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [progress, setProgress] = useState<Record<string, TranscriptionProgress>>({});
  const [liveSegments, setLiveSegments] = useState<Record<string, LiveSegment[]>>({});
  const [check, setCheck] = useState<ToolCheck | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState<ConfirmationRequest | null>(null);

  // Fonts and text size live in the settings, not in CSS, so each person can
  // fit them to their eyes rather than the other way round.
  const automaticRef = useRef(automatic);
  automaticRef.current = automatic;

  const loadAppearance = useCallback(async () => {
    try {
      applyFonts(await api.loadSettings());
    } catch {
      /* on a first run there may be nothing to load yet */
    }
  }, []);

  const loadRecordings = useCallback(async () => {
    try {
      setRecordings(await api.listRecordings());
    } catch (e) {
      setNotice(String(e));
    }
  }, []);

  const loadToolCheck = useCallback(async () => {
    try {
      const k = await api.checkTools();
      setCheck(k);
      return k;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    loadAppearance();
    loadRecordings();
    // With tools missing, showing an empty archive and waiting for the user
    // to find Settings makes no sense. Open the wizard straight away.
    loadToolCheck().then((k) => {
      if (k && k.issues.length > 0) {
        setWizardRequired(true);
        setScreen("wizard");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRecordings, loadToolCheck]);

  // ---------------------------------------------------- udalosti z prepisu
  useEffect(() => {
    // `listen` returns a promise. If the component unmounts before it
    // resolves, a naive cleanup unsubscribes nothing and the listener is left
    // hanging — events would then be handled twice. Hence the alive guard.
    let liveSegments = true;
    const unlisten: Array<() => void> = [];
    const add = (p: Promise<() => void>) =>
      p.then((f) => (liveSegments ? unlisten.push(f) : f()));

    add(
      listen<TranscriptionProgress>("transcription:status", (u) => {
        setProgress((p) => ({ ...p, [u.payload.recording_id]: u.payload }));
      })
    );

    add(
      listen<LiveSegment>("transcription:segment", (u) => {
        const s = u.payload;
        setLiveSegments((z) => {
          const existing = z[s.recording_id] ?? [];
          // Guard against the same event arriving twice. Identical text at
          // the same time is a duplicate, not something said twice.
          const last = existing[existing.length - 1];
          if (last && last.text === s.text && last.start === s.start) {
            return z;
          }
          // keep only the tail: a few lines are all the library can show
          return { ...z, [s.recording_id]: [...existing, s].slice(-40) };
        });
      })
    );

    add(listen<string>("transcription:complete", () => loadRecordings()));

    add(
      listen<[string, string]>("transcription:error", (u) => {
        setNotice(u.payload[1]);
        loadRecordings();
      })
    );

    return () => {
      liveSegments = false;
      unlisten.forEach((f) => f());
    };
  }, [loadRecordings]);

  // ---------------------------------------------------- pretahovani souboru
  const acceptFiles = useCallback(
    async (paths: string[]) => {
      const audio = paths.filter((c) => SUPPORTED_EXTENSIONS.includes(c.split(".").pop()?.toLowerCase() ?? ""));
      if (audio.length === 0) {
        setNotice("Nepodporovaný formát souboru. Použijte mp3, wav, m4a nebo běžné video.");
        return;
      }
      for (const c of audio) {
        try {
          const n = await api.addRecording(c);
          if (automaticRef.current) await api.startTranscription(n.id);
          // The status changes on the backend side, so the list has to be
          // reloaded. Without it the row keeps looking untranscribed even
          // while a transcription is running.
          await loadRecordings();
        } catch (e) {
          setNotice(String(e));
        }
      }
    },
    [loadRecordings]
  );

  useEffect(() => {
    // The same guard as above, and it matters more here: two stray listeners
    // would mean every dropped file gets added and transcribed twice.
    let liveSegments = true;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((u) => {
        if (u.payload.type === "over") setDragging(true);
        else if (u.payload.type === "drop") {
          setDragging(false);
          acceptFiles(u.payload.paths);
        } else setDragging(false);
      })
      .then((f) => {
        if (liveSegments) unlisten = f;
        else f();
      });
    return () => {
      liveSegments = false;
      unlisten?.();
    };
  }, [acceptFiles]);

  const selectFile = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Zvuk a video", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (!selected) return;
    await acceptFiles(Array.isArray(selected) ? selected : [selected]);
  }, [acceptFiles]);

  // ---------------------------------------------------- navigace
  const openRecording = useCallback((id: string, time?: number) => {
    setSelectedId(id);
    setSeekTime(time ?? null);
    setScreen("detail");
  }, []);

  const blockingIssues = useMemo(() => check?.issues ?? [], [check]);
  const player = usePlayer();

  return (
    <div className={`aplikace ${dragging ? "pretahuje" : ""}`}>
      <header className="lista">
        <div className="lista-levo">
        <button
          className="znacka"
          onClick={() => {
            setScreen("library");
            loadRecordings();
          }}
        >
          <span
            className="logotyp"
            aria-label="Převod řeči na text"
            dangerouslySetInnerHTML={{ __html: mark }}
          />
        </button>

        {/* Mizí jen tam, kde by byl zbytečný — na detailu právě hrané
            nahrávky, kde je plný přehrávač. Jinde zůstává. */}
        {player.recordingId &&
          !(screen === "detail" && selectedId === player.recordingId) && (
          <MiniPlayer
            onOpen={() => {
              if (player.recordingId) openRecording(player.recordingId);
            }}
          />
        )}

        {/* Návrat patří do hlavičky okna, a to na všech obrazovkách stejně.
            Průvodce ho nemá, dokud chybí něco, bez čeho přepis nepoběží. */}
        {screen !== "library" && !(screen === "wizard" && wizardRequired) && (
          <button
            className="tlacitko tichy"
            onClick={() => {
              loadToolCheck();
              loadAppearance();
              loadRecordings();
              setScreen("library");
            }}
          >
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
              <path d="M6 1L1 6l5 5M1 6h12" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Archiv
          </button>
        )}
        </div>

        <div className="lista-pravo">
          {screen !== "settings" && screen !== "wizard" && (
            <button className="tlacitko tichy" onClick={selectFile}>
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
                <path d="M7.5 2v11M2 7.5h11" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Přidat nahrávku
            </button>
          )}
          <button
            className={`tlacitko tichy ${blockingIssues.length ? "vystraha" : ""}`}
            onClick={() => {
              setScreen("settings");
              loadToolCheck();
            }}
          >
            {/* Táhla, ne ozubené kolo — to je při 16 px nečitelná drobnokresba. */}
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M2 4.5h3.2M8.8 4.5H14M2 11.5h6.2M11.8 11.5H14"
                    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="7" cy="4.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="11.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Nastavení{blockingIssues.length > 0 ? " •" : ""}
          </button>
        </div>
      </header>

      {notice && (
        <div className="hlaska" role="alert">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>Zavřít</button>
        </div>
      )}

      {screen === "library" && (
        <Library
          recordings={recordings}
          progress={progress}
          liveSegments={liveSegments}
          issues={blockingIssues}
          onOpen={openRecording}
          onDelete={(id) => {
            const n = recordings.find((x) => x.id === id);
            setQuery({
              nadpis: "Odebrat z archivu?",
              text: `Přepis nahrávky ${n?.title ?? ""} bude smazán. Zvukový soubor na disku zůstane nedotčený.`,
              confirm: "Odebrat",
              nicive: true,
              action: async () => {
                await api.deleteRecording(id);
                // A deleted recording has no business still playing.
                if (player.recordingId === id) player.close();
                loadRecordings();
              },
            });
          }}
          onTranscription={async (id) => {
            await api.startTranscription(id);
            loadRecordings();
          }}
          onCancel={async (id) => {
            await api.cancelTranscription(id);
            loadRecordings();
          }}
          onDeleteTranscription={(id) => {
            const n = recordings.find((x) => x.id === id);
            setQuery({
              nadpis: "Smazat přepis?",
              text: `Text i ruční úpravy u nahrávky ${n?.title ?? ""} budou ztraceny. Nahrávka zůstane v archivu a lze ji přepsat znovu.`,
              confirm: "Smazat přepis",
              nicive: true,
              action: async () => {
                await api.deleteTranscription(id);
                loadRecordings();
              },
            });
          }}
          onRename={async (id, title) => {
            await api.renameRecording(id, title);
            loadRecordings();
          }}
          onTranscriptionLanguage={async (id, j) => {
            await api.transcribeInLanguage(id, j);
            loadRecordings();
          }}
          automatic={automatic}
          onAutomatic={(z) => {
            setAutomatic(z);
            localStorage.setItem("prepisovat-rovnou", z ? "ano" : "ne");
          }}
          onAdd={selectFile}
          onToSettings={() => {
            setWizardRequired(true);
            setScreen("wizard");
          }}
        />
      )}

      {screen === "detail" && selectedId && (
        <Detail
          /* A new recording means a new screen. Without a key React would
             jen přepoužil a než dorazí data, svítil by na ní text, stav
             a křivka té předchozí. */
          key={selectedId}
          id={selectedId}
          seekTime={seekTime}
          progress={progress[selectedId]}
          liveSegments={liveSegments[selectedId] ?? []}
          onBack={() => {
            setScreen("library");
            loadRecordings();
          }}
          onError={setNotice}
        />
      )}

      {screen === "wizard" && (
        <SetupWizard
          required={wizardRequired}
          missingModule={missingModule}
          onComplete={() => {
            setWizardRequired(false);
            setMissingModule(null);
            loadToolCheck();
            setScreen("library");
          }}
        />
      )}

      {screen === "settings" && (
        <SettingsScreen
          onComplete={() => {
            loadToolCheck();
            loadAppearance();
            setScreen("library");
          }}
          onError={setNotice}
          onToModule={(module) => {
            setWizardRequired(false);
            setMissingModule(module ?? null);
            setScreen("wizard");
          }}
        />
      )}

      <ConfirmationDialog query={query} onZavri={() => setQuery(null)} />

      {dragging && (
        <div className="prekryv-pretazeni">
          <div className="prekryv-obsah">
            <div className="prekryv-ikona">↓</div>
            <p>Pusť file a přepis začne sám</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Miniature player in the header bar. Progress is a ring around the button:
 *  a separate strip under the title pushed the text upward and there was no
 *  room for it in a thirty-pixel bar. */
function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { title, time, duration, isPlaying, sourceMissing, togglePlayback, close } = usePlayer();

  const R = 12.5;
  const circumference = 2 * Math.PI * R;
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div className="mini-prehravac">
      <AudioBars />
      <button
        className="mini-prehrat"
        onClick={togglePlayback}
        aria-label={isPlaying ? "Pauza" : "Přehrát"}
      >
        <svg className="mini-prstenec" width="30" height="30" viewBox="0 0 30 30" aria-hidden>
          <circle className="mini-drazka" cx="15" cy="15" r={R} />
          <circle
            className="mini-postup"
            cx="15"
            cy="15"
            r={R}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        </svg>
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="2.5" y="2" width="2.8" height="8" rx="0.9" fill="currentColor" />
            <rect x="6.7" y="2" width="2.8" height="8" rx="0.9" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3.2 2v8l6.6-4z" fill="currentColor" />
          </svg>
        )}
      </button>

      <button className="mini-popis" onClick={onOpen} title="Zpět k přepisu">
        {title}
      </button>

      <span className={`mini-cas ${sourceMissing ? "varovne" : ""}`}>
        {sourceMissing ? "soubor chybí" : formatTime(time)}
      </span>

      <button className="mini-zavrit" onClick={close} aria-label="Zastavit přehrávání">
        {/* Stejná kresebná velikost jako u přehrát — menší glyf by
            opticky odskočil od okraje, i když má stejnou plochu. */}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function AudioBars() {
  const { waveform, time, isPlaying, sourceMissing } = usePlayer();

  const values = useMemo(
    () => equalizerAtTime(waveform, time),
    [waveform, time]
  );

  if (values.length === 0 || sourceMissing) return null;

  // Real frequency bands stay in place and only change height.
  return (
    <Waveform
      values={values}
      className={`mini-vlny ${isPlaying ? "hraje" : ""}`}
      waveformStyle="bars"
      anchoring="bottom"
      ceiling={0.7}
    />
  );
}
