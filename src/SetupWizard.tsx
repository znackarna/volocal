import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type { DownloadComponent, ToolCheck, DownloadProgress } from "./types";

interface Props {
  onComplete: () => void;
  /** The wizard opened by itself because transcription is impossible without it */
  required: boolean;
  /** id of the module to preselect for installation */
  missingModule?: string | null;
}

type Quality = "fastest" | "balanced" | "best";

/** The quality choice is mapped to a concrete model only here — nobody should
 *  have to know that "balanced" means large-v3-q5_0. */
const MODELS: Record<Quality, { component: string; settings: string }> = {
  fastest: { component: "model-turbo", settings: "large-v3-turbo-q5_0" },
  balanced: { component: "model-large-q5", settings: "large-v3-q5_0" },
  best: { component: "model-large", settings: "large-v3" },
};

const DIARIZATION_COMPONENTS = ["sherpa", "model-segmentace", "model-hlasy"];

/** Rough estimate for an hour-long recording. Measured on a Radeon RX 9070;
 *  on a CPU it is an order of magnitude different, hence two sets of numbers. */
function estimateDuration(quality: Quality, usesGpu: boolean): string {
  const t: Record<Quality, [number, number]> = {
    fastest: [1, 8],
    balanced: [3, 25],
    best: [4, 35],
  };
  const m = t[quality][usesGpu ? 0 : 1];
  return m === 1 ? "asi minutu" : m < 5 ? `asi ${m} minuty` : `asi ${m} minut`;
}

function size(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : `${mb} MB`;
}

export default function SetupWizard({ onComplete, required, missingModule }: Props) {
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<DownloadComponent[]>([]);
  const [check, setCheck] = useState<ToolCheck | null>(null);

  const [quality, setQuality] = useState<Quality>("balanced");
  const [wantsSpeakers, setWantsSpeakers] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualSelect, setManualSelect] = useState<Set<string>>(new Set());

  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [k, kn] = await Promise.all([api.catalog(), api.checkTools()]);
      setItems(k);
      setCheck(kn);
      if (missingModule) {
        // We came from settings for one specific thing. There is no point
        // walking someone through four steps unrelated to it.
        setManual(true);
        setManualSelect(new Set([missingModule]));
        setStep(3);
      } else {
        setManualSelect(new Set(k.filter((x) => x.recommended && !x.complete).map((x) => x.id)));
      }
    } catch (e) {
      setError(String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const usesGpu = !!(check?.nvidia_driver || check?.vulkan_driver);

  // The user does not pick the programs; the machine picks them from its drivers.
  const root = useMemo(
    () =>
      items
        .filter((p) => (p.required || (p.group === "program" && p.recommended)) && !p.complete)
        .map((p) => p.id),
    [items]
  );

  const selected = useMemo(() => {
    if (manual) return [...manualSelect];
    const s = new Set(root);
    const m = MODELS[quality].component;
    if (!items.find((p) => p.id === m)?.complete) s.add(m);
    if (wantsSpeakers) {
      DIARIZATION_COMPONENTS.filter((id) => !items.find((p) => p.id === id)?.complete).forEach((id) => s.add(id));
    }
    return [...s];
  }, [manual, manualSelect, root, quality, wantsSpeakers, items]);

  const totalMb = useMemo(
    () => selected.reduce((a, id) => a + (items.find((p) => p.id === id)?.megabytes ?? 0), 0),
    [selected, items]
  );

  // ---------------------------------------------------------------- downloads
  useEffect(() => {
    // Without the alive guard, a quick re-render would leave the old listener
    // hanging and progress reports would arrive twice.
    let liveSegments = true;
    const unlisten: Array<() => void> = [];
    const add = (p: Promise<() => void>) =>
      p.then((f) => (liveSegments ? unlisten.push(f) : f()));

    add(
      listen<DownloadProgress>("download:progress", (u) => {
        setProgress((p) => ({ ...p, [u.payload.id]: u.payload }));
        if (u.payload.phase === "error") setError(u.payload.message);
      })
    );

    add(
      listen("download:complete", async () => {
        setRunning(false);
        await dokonci();
        load();
        setStep(4);
      })
    );

    return () => {
      liveSegments = false;
      unlisten.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, wantsSpeakers, manual]);

  /** Without this the app would look for a model the user never chose. */
  const dokonci = useCallback(async () => {
    try {
      const n = await api.loadSettings();
      const changesApplied = { ...n };
      if (!manual) {
        changesApplied.model = MODELS[quality].settings;
        changesApplied.diarization = wantsSpeakers;
      }
      await api.saveSettings(changesApplied);
    } catch {
      /* settings can still be adjusted by hand */
    }
  }, [quality, wantsSpeakers, manual]);

  const start = useCallback(async () => {
    setError(null);
    setProgress({});
    setRunning(true);
    setStep(3);
    try {
      // smallest first: the app becomes usable sooner and any failure shows
      // up before half an hour of model downloading
      const sortedIds = [...selected].sort(
        (a, b) =>
          (items.find((p) => p.id === a)?.megabytes ?? 0) -
          (items.find((p) => p.id === b)?.megabytes ?? 0)
      );
      await api.download(sortedIds);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  }, [selected, items]);

  const failedIds = useMemo(
    () => selected.filter((id) => progress[id]?.phase === "error"),
    [selected, progress]
  );

  /** Transcription needs ffmpeg, VAD, the program and a model. Diarization is
   *  a bonus — if only that fails, claiming nothing worked would be wrong. */
  const canTranscribe = useMemo(
    () => !!check && check.issues.length === 0,
    [check]
  );

  const retry = useCallback(async () => {
    setError(null);
    setRunning(true);
    setStep(3);
    const retryIds = [...failedIds];
    setProgress((p) => {
      const n = { ...p };
      retryIds.forEach((id) => delete n[id]);
      return n;
    });
    try {
      await api.download(retryIds);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  }, [failedIds]);

  const complete = selected.filter((id) => progress[id]?.phase === "complete").length;
  const current = selected.find(
    (id) =>
      progress[id]?.phase === "downloading" ||
      progress[id]?.phase === "extracting",
  );
  const currentItem = items.find((p) => p.id === current);
  const currentProgress = current ? progress[current] : undefined;

  return (
    <main className="pruvodce">
      {step < 4 && (
        <div className="kroky" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i <= step ? "hotovy" : ""} />
          ))}
        </div>
      )}

      {error && step !== 4 && (
        <div className="upozorneni">
          <div>
            <strong>Stahování selhalo</strong>
            <p className="drobne">{error}</p>
          </div>
          <button className="tlacitko" onClick={() => setError(null)}>
            Rozumím
          </button>
        </div>
      )}

      {/* ------------------------------------------------ 0. uvítání */}
      {step === 0 && (
        <div className="krok">
          <p className="krok-cislo">Krok 1 ze 4</p>
          <h1>{required ? "První spuštění" : "Doplnit moduly"}</h1>
          <p className="krok-uvod">
            Před prvním přepisem je potřeba stáhnout nástroje a jazykový
            model. Stahování trvá několik minut, poté aplikace pracuje
            bez připojení k internetu.
          </p>

          <div className="zjisteno">
            <div>
              <span className="zjisteno-popis">Zjištěná konfigurace</span>
              <span className="zjisteno-hodnota">
                {check?.nvidia_driver
                  ? "Grafická karta NVIDIA"
                  : check?.vulkan_driver
                  ? "Grafická karta (Vulkan)"
                  : "Bez podporované grafické karty"}
              </span>
            </div>
            <div>
              <span className="zjisteno-popis">Přepis proběhne</span>
              <span className="zjisteno-hodnota">
                {usesGpu ? "na grafické kartě" : "na procesoru, tedy pomaleji"}
              </span>
            </div>
          </div>

          <p className="drobne">
            Podle konfigurace je předvybrána vhodná sada. Změnit ji lze i později.
          </p>

          <div className="krok-patka">
            {!required && (
              <button className="tlacitko tichy" onClick={onComplete}>
                Zavřít
              </button>
            )}
            <button className="tlacitko hlavni" onClick={() => setStep(1)}>
              Pokračovat
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ 1. kvalita */}
      {step === 1 && (
        <div className="krok">
          <p className="krok-cislo">Krok 2 ze 4</p>
          <h1>Jak přesný přepis chceš?</h1>
          <p className="krok-uvod">
            {usesGpu
              ? "Odhady časů platí pro grafickou kartu v tomhle počítači."
              : "Poběží to na procesoru, takže odhady jsou vyšší, než bys čekal."}
          </p>

          <div className="volby">
            {(["fastest", "balanced", "best"] as Quality[]).map((k) => {
              const p = items.find((x) => x.id === MODELS[k].component);
              const descriptions: Record<Quality, string> = {
                fastest: "Méně spolehlivý u vlastních jmen a odborných výrazů.",
                balanced: "Přibližně jedna chyba na odstavec. Vhodné pro většinu nahrávek.",
                best: "Nejvyšší dosažitelná přesnost českého přepisu.",
              };
              const names: Record<Quality, string> = {
                fastest: "Nejrychlejší",
                balanced: "Vyvážené",
                best: "Nejlepší kvalita",
              };
              const recommended = usesGpu ? "balanced" : "fastest";
              return (
                <button
                  key={k}
                  className={`volba ${quality === k ? "zvolena" : ""}`}
                  onClick={() => setQuality(k)}
                >
                  <span className="volba-hlava">
                    <span className="volba-nazev">
                      {names[k]}
                      {k === recommended && <em className="odznak">doporučeno</em>}
                      {p?.complete && <em className="odznak">už máš</em>}
                    </span>
                    <span className="volba-velikost">
                      {p?.complete ? "0 MB" : size(p?.megabytes ?? 0)}
                    </span>
                  </span>
                  <span className="drobne">
                    Hodinová nahrávka {estimateDuration(k, usesGpu)}. {descriptions[k]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="krok-patka">
            <button className="tlacitko tichy" onClick={() => setStep(0)}>
              Zpět
            </button>
            <button className="tlacitko hlavni" onClick={() => setStep(2)}>
              Pokračovat
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ 2. mluvčí */}
      {step === 2 && (
        <div className="krok">
          <p className="krok-cislo">Krok 3 ze 4</p>
          <h1>Přepisuješ i rozhovory?</h1>
          <p className="krok-uvod">
            Když v nahrávce mluví víc lidí, aplikace je umí rozlišit a text
            rozdělit mezi ně.
          </p>

          <div className="volby">
            <button
              className={`volba ${!wantsSpeakers ? "zvolena" : ""}`}
              onClick={() => setWantsSpeakers(false)}
            >
              <span className="volba-hlava">
                <span className="volba-nazev">Většinou mluví jeden člověk</span>
                <span className="volba-velikost">0 MB</span>
              </span>
              <span className="drobne">Přednášky, diktování, poznámky. Nevyžaduje žádné doplňky.</span>
            </button>

            <button
              className={`volba ${wantsSpeakers ? "zvolena" : ""}`}
              onClick={() => setWantsSpeakers(true)}
            >
              <span className="volba-hlava">
                <span className="volba-nazev">Nahrávám i rozhovory</span>
                <span className="volba-velikost">
                  {size(
                    DIARIZATION_COMPONENTS.reduce((a, id) => {
                      const p = items.find((x) => x.id === id);
                      return a + (p && !p.complete ? p.megabytes : 0);
                    }, 0)
                  )}
                </span>
              </span>
              <span className="drobne">
                Text se rozdělí mezi jednotlivé mluvčí, které lze name.
              </span>
            </button>
          </div>

          <div className="krok-patka">
            <button className="tlacitko tichy" onClick={() => setStep(1)}>
              Zpět
            </button>
            <button className="tlacitko hlavni" onClick={() => setStep(3)}>
              Pokračovat
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ 3. souhrn a stahování */}
      {step === 3 && (
        <div className="krok">
          <p className="krok-cislo">Krok 4 ze 4</p>
          <h1>{running ? "Probíhá stahování" : "Kontrola výběru"}</h1>

          {!running && (
            <p className="krok-uvod">
              Stáhne se {selected.length} položek, dohromady {size(totalMb)}.
            </p>
          )}

          {running ? (
            <>
              <div className="prubeh-velky">
                <div className="prubeh-lista">
                  <div
                    className="prubeh-vypln"
                    style={{
                      width: `${
                        ((complete + (currentProgress ? currentProgress.percent / 100 : 0)) /
                          Math.max(selected.length, 1)) *
                        100
                      }%`,
                    }}
                  />
                </div>
                <div className="prubeh-popis">
                  <span>
                    {currentItem?.title ?? "Připravuji"}
                    {currentProgress?.phase === "extracting" && " — rozbaluji"}
                  </span>
                  <span>
                    {complete} z {selected.length}
                  </span>
                </div>
                {currentProgress && currentProgress.total_mb > 0 && (
                  <p className="drobne">
                    {currentProgress.downloaded_mb.toFixed(0)} z{" "}
                    {currentProgress.total_mb.toFixed(0)} MB
                  </p>
                )}
              </div>

              <ul className="souhrn">
                {selected.map((id) => {
                  const p = items.find((x) => x.id === id);
                  const s = progress[id]?.phase;
                  return (
                    <li key={id} className={s === "complete" ? "hotova" : ""}>
                      <span>{p?.title ?? id}</span>
                      <span className="drobne">
                        {s === "complete"
                          ? "hotovo"
                          : s === "error"
                          ? "chyba"
                          : s
                          ? "…"
                          : "čeká"}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="krok-patka">
                <button className="tlacitko" onClick={() => api.cancelDownload()}>
                  Přerušit
                </button>
              </div>
            </>
          ) : (
            <>
              {manual ? (
                <ManualSelection
                  items={items}
                  selected={manualSelect}
                  onToggle={(id) =>
                    setManualSelect((s) => {
                      const n = new Set(s);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    })
                  }
                />
              ) : (
                <ul className="souhrn">
                  {selected.map((id) => {
                    const p = items.find((x) => x.id === id);
                    return (
                      <li key={id}>
                        <span>{p?.title ?? id}</span>
                        <span className="drobne">{size(p?.megabytes ?? 0)}</span>
                      </li>
                    );
                  })}
                  {selected.length === 0 && (
                    <li>
                      <span className="drobne">Všechno potřebné už máš.</span>
                    </li>
                  )}
                </ul>
              )}

              <div className="krok-patka">
                <button className="tlacitko tichy" onClick={() => setStep(2)}>
                  Zpět
                </button>
                {/* Přepnutí do ručního výběru je akce jako každá jiná,
                    patří do patičky mezi ostatní tlačítka. */}
                <button className="tlacitko tichy" onClick={() => setManual((r) => !r)}>
                  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                    <path d="M2 4.5h3.2M8.8 4.5H14M2 11.5h6.2M11.8 11.5H14"
                          fill="none" stroke="currentColor" strokeWidth="1.5"
                          strokeLinecap="round" />
                    <circle cx="7" cy="4.5" r="1.8" fill="none"
                            stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="10" cy="11.5" r="1.8" fill="none"
                            stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  {manual ? "Jednoduchý výběr" : "Vybrat ručně"}
                </button>
                {selected.length === 0 ? (
                  <button
                    className="tlacitko hlavni"
                    onClick={async () => {
                      await dokonci();
                      onComplete();
                    }}
                  >
                    Jdeme přepisovat
                  </button>
                ) : (
                  <button className="tlacitko hlavni" onClick={start}>
                    Stáhnout ({size(totalMb)})
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------ 4. závěr */}
      {step === 4 && (
        <div className={`krok ${failedIds.length === 0 ? "krok-zaver" : ""}`}>
          {failedIds.length === 0 ? (
            <>
              <h1>Hotovo</h1>
              <p className="krok-uvod">
                Vše je připraveno. Přetažením nahrávky do okna začne přepis.
              </p>
              <p className="drobne">
                Klávesa <strong>Tab</strong> přeskakuje na místa s nízkou
                jistotou přepisu. Kontrola textu tak zabere jen několik minut.
              </p>
              <div className="krok-patka">
                <button className="tlacitko hlavni" onClick={onComplete}>
                  Zavřít
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>{canTranscribe ? "Téměř hotovo" : "Instalace se nezdařila"}</h1>
              <p className="krok-uvod">
                {canTranscribe
                  ? "Přepis je funkční. Nepodařilo se stáhnout pouze tyto položky:"
                  : "Chybí položky nutné pro přepis:"}
              </p>

              <ul className="souhrn">
                {failedIds.map((id) => (
                  <li key={id} className="selhala">
                    <span>{items.find((p) => p.id === id)?.title ?? id}</span>
                    <span className="drobne">{progress[id]?.message}</span>
                  </li>
                ))}
              </ul>

              {canTranscribe && (
                <p className="drobne">
                  Doplnit je lze kdykoliv v sekci Moduly.
                </p>
              )}

              <div className="krok-patka">
                <button
                  className="tlacitko tichy"
                  onClick={() => {
                    setProgress({});
                    setStep(3);
                  }}
                >
                  Zpět na výběr
                </button>
                <button
                  className={`tlacitko ${canTranscribe ? "" : "hlavni"}`}
                  onClick={retry}
                >
                  Zkusit znovu
                </button>
                {canTranscribe && (
                  <button className="tlacitko hlavni" onClick={onComplete}>
                    Pokračovat bez toho
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}

function ManualSelection({
  items,
  selected,
  onToggle,
}: {
  items: DownloadComponent[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const groups: Array<[string, string]> = [
    ["program", "Programy"],
    ["model", "Jazykové modely"],
    ["speakers", "Rozlišení mluvčích"],
  ];
  return (
    <div className="rucni">
      {groups.map(([key, title]) => (
        <div key={key}>
          <h2>{title}</h2>
          <ul className="soucasti">
            {items
              .filter((p) => p.group === key)
              .map((p) => (
                <li key={p.id} className={`soucast ${p.complete ? "hotova" : ""}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={p.complete || selected.has(p.id)}
                      disabled={p.complete}
                      onChange={() => onToggle(p.id)}
                    />
                    <span className="soucast-text">
                      <span className="soucast-nazev">{p.title}</span>
                      <span className="drobne">{p.description}</span>
                    </span>
                    <span className="soucast-velikost">
                      {p.complete ? "máš" : size(p.megabytes)}
                    </span>
                  </label>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
