import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import InfoNote from "./InfoNote";
import { LineIcon } from "./icons";
import { useI18n, type TranslationKey } from "./i18n";
import { useProgressMessage, useUserMessage } from "./messages";
import { useFormats } from "./formats";
import type { DownloadComponent, ToolCheck, DownloadProgress } from "./types";

interface Props {
  onComplete: () => void;
  onBack: () => void;
  /** The wizard opened by itself because transcription is impossible without it */
  required: boolean;
  /** id of the module to preselect for installation */
  missingModule?: string | null;
}

type Quality = "fastest" | "balanced" | "best";
type EditingQuality = "off" | "light" | "balanced" | "best";

/** The quality choice is mapped to a concrete model only here — nobody should
 *  have to know that "balanced" means large-v3-q5_0. Nothing but identifiers and
 *  dictionary keys lives in these tables: a module constant is evaluated once,
 *  outside React, so a label stored here could never follow a language change. */
const MODELS: Record<
  Quality,
  { component: string; settings: string; name: TranslationKey; summary: TranslationKey }
> = {
  fastest: {
    component: "model-turbo",
    settings: "large-v3-turbo-q5_0",
    name: "wizard.quality.fastestName",
    summary: "wizard.quality.fastestSummary",
  },
  balanced: {
    component: "model-large-q5",
    settings: "large-v3-q5_0",
    name: "wizard.quality.balancedName",
    summary: "wizard.quality.balancedSummary",
  },
  best: {
    component: "model-large",
    settings: "large-v3",
    name: "wizard.quality.bestName",
    summary: "wizard.quality.bestSummary",
  },
};

const DIARIZATION_COMPONENTS = ["model-hlasy"];

const EDITOR_MODELS: Record<
  Exclude<EditingQuality, "off">,
  { component: string; settings: string; name: TranslationKey; description: TranslationKey }
> = {
  light: {
    component: "editor-model-light",
    settings: "gemma-4-e2b-q4",
    name: "wizard.editor.lightName",
    description: "wizard.editor.lightDescription",
  },
  balanced: {
    component: "editor-model-balanced",
    settings: "gemma-4-e4b-q4",
    name: "wizard.editor.balancedName",
    description: "wizard.editor.balancedDescription",
  },
  best: {
    component: "editor-model-best",
    settings: "gemma-4-12b-q4",
    name: "wizard.editor.bestName",
    description: "wizard.editor.bestDescription",
  },
};

/** Rough estimate for an hour-long recording, in minutes. Measured on a Radeon
 *  RX 9070; on a CPU it is an order of magnitude different, hence two sets of
 *  numbers. Only the number lives here — the phrase around it needs the active
 *  language's plural rules and is assembled by `useFormats`. */
function estimatedMinutes(quality: Quality, usesGpu: boolean): number {
  const t: Record<Quality, [number, number]> = {
    fastest: [1, 8],
    balanced: [3, 25],
    best: [4, 35],
  };
  return t[quality][usesGpu ? 0 : 1];
}

function DownloadedMark() {
  const { t } = useI18n();
  const label = t("wizard.download.downloadedLabel");
  return (
    <span className="downloaded-mark" aria-label={label} title={label}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M3 7.2 5.7 10 11 4.5" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Switching to the by-hand component list.
 *
 *  It used to sit only in the last step's footer, which meant walking through
 *  four questions before reaching it — the wrong order for someone who came
 *  here to add one known module. It is now in every footer up to that point,
 *  drawn identically, so it reads as the same action wherever it appears.
 */
function ManualSelectionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="tlacitko tichy" onClick={onClick}>
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M2 4.5h3.2M8.8 4.5H14M2 11.5h6.2M11.8 11.5H14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="7" cy="4.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="11.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {label}
    </button>
  );
}

export default function SetupWizard({ onComplete, onBack, required, missingModule }: Props) {
  const { t, tDynamic, tPlural } = useI18n();
  const { approximateMinutes, dataSize } = useFormats();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();

  const [step, setStep] = useState(0);
  const [items, setItems] = useState<DownloadComponent[]>([]);
  const [check, setCheck] = useState<ToolCheck | null>(null);

  const [quality, setQuality] = useState<Quality>("balanced");
  const [wantsSpeakers, setWantsSpeakers] = useState(false);
  const [editingQuality, setEditingQuality] = useState<EditingQuality>("balanced");
  const [manual, setManual] = useState(false);
  const [manualFrom, setManualFrom] = useState<number | null>(null);
  const [manualSelect, setManualSelect] = useState<Set<string>>(new Set());

  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Skip the remaining questions and go straight to the component list.
   *  Remembers where it was pressed, so `Zpět` from the list returns to the
   *  question that was being answered rather than to a step nobody walked. */
  const chooseByHand = useCallback(() => {
    setManualFrom(step);
    setManual(true);
    setStep(4);
  }, [step]);

  const load = useCallback(async () => {
    try {
      const [k, kn] = await Promise.all([api.catalog(), api.checkTools()]);
      setItems(k);
      setCheck(kn);
      if (missingModule) {
        // We came from settings for one specific thing. There is no point
        // walking someone through four steps unrelated to it.
        setManual(true);
        const requested = new Set([missingModule]);
        if (missingModule.startsWith("editor-model-")) {
          requested.add(kn.vulkan_driver ? "editor-vulkan" : "editor-cpu");
        }
        setManualSelect(requested);
        setStep(4);
      } else {
        setManualSelect(new Set(k.filter((x) => x.recommended && !x.complete).map((x) => x.id)));
      }
    } catch (e) {
      setError(userMessage(e));
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
    if (editingQuality !== "off") {
      const runtime = check?.vulkan_driver ? "editor-vulkan" : "editor-cpu";
      const model = EDITOR_MODELS[editingQuality].component;
      if (!items.find((p) => p.id === runtime)?.complete) s.add(runtime);
      if (!items.find((p) => p.id === model)?.complete) s.add(model);
    }
    return [...s];
  }, [manual, manualSelect, root, quality, wantsSpeakers, editingQuality, items, check?.vulkan_driver]);

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
        if (u.payload.phase === "error" && u.payload.message) {
          setError(progressMessage(u.payload.message));
        }
      })
    );

    add(
      listen<string[]>("download:complete", async (u) => {
        setRunning(false);
        await dokonci(u.payload ?? []);
        load();
        setStep(5);
      })
    );

    return () => {
      liveSegments = false;
      unlisten.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingQuality, manual, manualSelect, quality, wantsSpeakers]);

  /** Without this the app would look for a model the user never chose.
   *
   *  `unfinished` is what the batch did not install — cancelled, failed, or
   *  never reached. A choice whose component is in it must not be written:
   *  the setting would name a model that is not on the disk, which is how
   *  pressing Stop during the first download left the application configured
   *  for something it had never downloaded. Every choice is judged on its own
   *  component, so a failed language model does not throw away a transcription
   *  model that landed. */
  const dokonci = useCallback(
    async (unfinished: string[]) => {
      const landed = (component: string) => !unfinished.includes(component);
      try {
        const n = await api.loadSettings();
        const changesApplied = { ...n };
        if (!manual) {
          if (landed(MODELS[quality].component)) {
            changesApplied.model = MODELS[quality].settings;
          }
          changesApplied.diarization =
            wantsSpeakers && DIARIZATION_COMPONENTS.every(landed);
          if (editingQuality === "off") changesApplied.editor_model = "";
          else if (landed(EDITOR_MODELS[editingQuality].component)) {
            changesApplied.editor_model = EDITOR_MODELS[editingQuality].settings;
          }
        } else {
          const selectedEditor = Object.values(EDITOR_MODELS).find(
            (choice) => manualSelect.has(choice.component) && landed(choice.component)
          );
          if (selectedEditor) changesApplied.editor_model = selectedEditor.settings;
        }
        await api.saveSettings(changesApplied);
      } catch {
        /* settings can still be adjusted by hand */
      }
    },
    [quality, wantsSpeakers, editingQuality, manual, manualSelect]
  );

  const start = useCallback(async () => {
    setError(null);
    setProgress({});
    setRunning(true);
    setStep(4);
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
      setError(userMessage(e));
      setRunning(false);
    }
  }, [items, selected, userMessage]);

  /* `cancelled` counts as unfinished, not as done. The backend emits it for
     the component that was interrupted and for every one after it, and then
     emits `download:complete` regardless — so counting only `error` made the
     wizard congratulate a user who pressed Stop during the first model on a
     fresh installation: "Everything is ready", with nothing installed.

     This is the screen's own reading, from the phases it saw. `dokonci` uses
     the list the backend sends with `download:complete` instead: what a
     setting is written from must not depend on whether an event arrived. */
  const failedIds = useMemo(
    () =>
      selected.filter((id) => {
        const phase = progress[id]?.phase;
        return phase === "error" || phase === "cancelled";
      }),
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
    setStep(4);
    const retryIds = [...failedIds];
    setProgress((p) => {
      const n = { ...p };
      retryIds.forEach((id) => delete n[id]);
      return n;
    });
    try {
      await api.download(retryIds);
    } catch (e) {
      setError(userMessage(e));
      setRunning(false);
    }
  }, [failedIds, userMessage]);

  const complete = selected.filter((id) => progress[id]?.phase === "complete").length;
  const current = selected.find(
    (id) =>
      progress[id]?.phase === "downloading" ||
      progress[id]?.phase === "extracting",
  );
  const currentItem = items.find((p) => p.id === current);
  const currentProgress = current ? progress[current] : undefined;
  const currentName = currentItem
    ? tDynamic(currentItem.name_code, currentItem.id)
    : t("wizard.download.preparing");

  // The keyboard key is set in bold inside the sentence, so the sentence is
  // split around its placeholder instead of being assembled from fragments.
  const tabHint = t("wizard.done.tabHint").split("{key}");

  /** Name of a catalogue item; the identifier stands in until it is loaded. */
  const itemName = (id: string) => {
    const item = items.find((p) => p.id === id);
    return item ? tDynamic(item.name_code, item.id) : id;
  };

  return (
    <main className="pruvodce">
      {step < 5 && (
        <div className="kroky" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i <= step ? "hotovy" : ""} />
          ))}
        </div>
      )}

      {error && step !== 5 && (
        <div className="upozorneni">
          <div>
            <strong>{t("wizard.download.failedTitle")}</strong>
            <p className="drobne">{error}</p>
          </div>
          <button className="tlacitko" onClick={() => setError(null)}>
            {t("wizard.download.dismissError")}
          </button>
        </div>
      )}

      {/* ------------------------------------------------ 0. uvítání */}
      {step === 0 && (
        <div className="krok">
          <p className="krok-cislo">{t("wizard.nav.stepCounter", { step: 1, total: 5 })}</p>
          <h1>{t(required ? "wizard.welcome.titleFirstRun" : "wizard.welcome.titleAddModels")}</h1>
          <p className="krok-uvod">{t("wizard.welcome.intro")}</p>

          <div className="zjisteno">
            <div>
              <span className="volba-ikona" aria-hidden>
                <LineIcon name="compute" />
              </span>
              <div className="zjisteno-telo">
                <span className="zjisteno-popis">{t("wizard.welcome.configurationLabel")}</span>
                <span className="zjisteno-hodnota">
                  {check?.nvidia_driver
                    ? t("wizard.welcome.gpuNvidia")
                    : check?.vulkan_driver
                    ? t("wizard.welcome.gpuVulkan")
                    : t("wizard.welcome.gpuNone")}
                </span>
              </div>
            </div>
            <div>
              <span className="volba-ikona" aria-hidden>
                <LineIcon name="transcription" />
              </span>
              <div className="zjisteno-telo">
                <span className="zjisteno-popis">{t("wizard.welcome.transcriptionLabel")}</span>
                <span className="zjisteno-hodnota">
                  {usesGpu ? t("wizard.welcome.onGpu") : t("wizard.welcome.onCpu")}
                </span>
              </div>
            </div>
          </div>

          <InfoNote>{t("wizard.welcome.note")}</InfoNote>

          <div className="krok-patka">
            {!required && (
              <button className="tlacitko tichy" onClick={onBack}>
                {t("common.back")}
              </button>
            )}
            <ManualSelectionButton
              label={t("wizard.manual.switchToManual")}
              onClick={chooseByHand}
            />
            <button className="tlacitko hlavni" onClick={() => setStep(1)}>
              {t("common.continue")}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ 1. kvalita */}
      {step === 1 && (
        <div className="krok">
          <p className="krok-cislo">{t("wizard.nav.stepCounter", { step: 2, total: 5 })}</p>
          <h1>{t("wizard.quality.title")}</h1>
          <p className="krok-uvod">
            {usesGpu ? t("wizard.quality.introGpu") : t("wizard.quality.introCpu")}
          </p>

          <div className="volby">
            {(["fastest", "balanced", "best"] as Quality[]).map((k) => {
              const p = items.find((x) => x.id === MODELS[k].component);
              const recommended = usesGpu ? "balanced" : "fastest";
              return (
                <button
                  key={k}
                  className={`volba ${quality === k ? "zvolena" : ""}`}
                  onClick={() => setQuality(k)}
                >
                  <span className="volba-hlava">
                    <span className="volba-nazev">
                      {t(MODELS[k].name)}
                      {k === recommended && (
                        <em className="odznak">{t("wizard.download.recommendedBadge")}</em>
                      )}
                      {p?.complete && (
                        <em className="odznak">{t("wizard.download.downloadedBadge")}</em>
                      )}
                    </span>
                    <span className="volba-velikost">
                      {dataSize(p?.complete ? 0 : p?.megabytes ?? 0)}
                    </span>
                  </span>
                  <span className="drobne">
                    {t(MODELS[k].summary, {
                      duration: approximateMinutes(estimatedMinutes(k, usesGpu)),
                    })}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="krok-patka">
            <button className="tlacitko tichy" onClick={() => setStep(0)}>
              {t("common.back")}
            </button>
            <ManualSelectionButton
              label={t("wizard.manual.switchToManual")}
              onClick={chooseByHand}
            />
            <button className="tlacitko hlavni" onClick={() => setStep(2)}>
              {t("common.continue")}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ 2. mluvčí */}
      {step === 2 && (
        <div className="krok">
          <p className="krok-cislo">{t("wizard.nav.stepCounter", { step: 3, total: 5 })}</p>
          <h1>{t("wizard.speakers.title")}</h1>
          <p className="krok-uvod">{t("wizard.speakers.intro")}</p>

          <div className="volby">
            <button
              className={`volba ${!wantsSpeakers ? "zvolena" : ""}`}
              onClick={() => setWantsSpeakers(false)}
            >
              <span className="volba-hlava">
                <span className="volba-nazev">{t("wizard.speakers.singleName")}</span>
                <span className="volba-velikost">{dataSize(0)}</span>
              </span>
              <span className="drobne">{t("wizard.speakers.singleDescription")}</span>
            </button>

            <button
              className={`volba ${wantsSpeakers ? "zvolena" : ""}`}
              onClick={() => setWantsSpeakers(true)}
            >
              <span className="volba-hlava">
                <span className="volba-nazev">{t("wizard.speakers.multipleName")}</span>
                <span className="volba-velikost">
                  {dataSize(
                    DIARIZATION_COMPONENTS.reduce((a, id) => {
                      const p = items.find((x) => x.id === id);
                      return a + (p && !p.complete ? p.megabytes : 0);
                    }, 0)
                  )}
                </span>
              </span>
              <span className="drobne">{t("wizard.speakers.multipleDescription")}</span>
            </button>
          </div>

          <div className="krok-patka">
            <button className="tlacitko tichy" onClick={() => setStep(1)}>
              {t("common.back")}
            </button>
            <ManualSelectionButton
              label={t("wizard.manual.switchToManual")}
              onClick={chooseByHand}
            />
            <button className="tlacitko hlavni" onClick={() => setStep(3)}>
              {t("common.continue")}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------ 3. optional language editing */}
      {step === 3 && (
        <div className="krok">
          <p className="krok-cislo">{t("wizard.nav.stepCounter", { step: 4, total: 5 })}</p>
          <h1>{t("wizard.editor.title")}</h1>
          <p className="krok-uvod">{t("wizard.editor.intro")}</p>

          <div className="volby">
            {(["light", "balanced", "best"] as const).map((editorQuality) => {
              const choice = EDITOR_MODELS[editorQuality];
              const component = items.find((item) => item.id === choice.component);
              return (
                <button
                  key={editorQuality}
                  className={`volba ${editingQuality === editorQuality ? "zvolena" : ""}`}
                  onClick={() => setEditingQuality(editorQuality)}
                  aria-pressed={editingQuality === editorQuality}
                >
                  <span className="volba-hlava">
                    <span className="volba-nazev">
                      {t(choice.name)}
                      {editorQuality === "balanced" && (
                        <em className="odznak">{t("wizard.download.recommendedBadge")}</em>
                      )}
                      {component?.complete && (
                        <em className="odznak">{t("wizard.download.downloadedBadge")}</em>
                      )}
                    </span>
                    <span className="volba-velikost">
                      {dataSize(component?.complete ? 0 : component?.megabytes ?? 0)}
                    </span>
                  </span>
                  <span className="drobne">{t(choice.description)}</span>
                </button>
              );
            })}
          </div>

          <div className="krok-patka">
            <button className="tlacitko tichy" onClick={() => setStep(2)}>
              {t("common.back")}
            </button>
            <ManualSelectionButton
              label={t("wizard.manual.switchToManual")}
              onClick={chooseByHand}
            />
            <button
              className="tlacitko tichy"
              onClick={() => {
                setEditingQuality("off");
                setStep(4);
              }}
            >
              {t("wizard.editor.skip")}
            </button>
            <button className="tlacitko hlavni" onClick={() => setStep(4)}>
              {t("common.continue")}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ 4. summary and download */}
      {step === 4 && (
        <div className="krok">
          <p className="krok-cislo">{t("wizard.nav.stepCounter", { step: 5, total: 5 })}</p>
          <h1>{t(running ? "wizard.download.runningTitle" : "wizard.download.reviewTitle")}</h1>

          {!running && (
            <p className="krok-uvod">
              {tPlural("wizard.download.summary", selected.length, {
                size: dataSize(totalMb),
              })}
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
                    {currentProgress?.phase === "extracting"
                      ? t("wizard.download.extracting", { name: currentName })
                      : currentName}
                  </span>
                  <span>
                    {t("wizard.download.itemProgress", {
                      done: complete,
                      total: selected.length,
                    })}
                  </span>
                </div>
                {currentProgress && currentProgress.total_mb > 0 && (
                  <p className="drobne">
                    {t("wizard.download.megabytesProgress", {
                      downloaded: currentProgress.downloaded_mb.toFixed(0),
                      total: currentProgress.total_mb.toFixed(0),
                    })}
                  </p>
                )}
              </div>

              <ul className="souhrn">
                {selected.map((id) => {
                  const p = items.find((x) => x.id === id);
                  const s = progress[id]?.phase;
                  return (
                    <li key={id} className={s === "complete" ? "hotova" : ""}>
                      <span>{p ? tDynamic(p.name_code, p.id) : id}</span>
                      <span className="drobne">
                        {s === "complete"
                          ? t("wizard.download.statusDone")
                          : s === "error"
                          ? t("wizard.download.statusError")
                          : s
                          ? "…"
                          : t("wizard.download.statusWaiting")}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="krok-patka">
                <button className="tlacitko" onClick={() => api.cancelDownload()}>
                  {t("common.stop")}
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
                        <span>{p ? tDynamic(p.name_code, p.id) : id}</span>
                        <span className="drobne">{dataSize(p?.megabytes ?? 0)}</span>
                      </li>
                    );
                  })}
                  {selected.length === 0 && (
                    <li>
                      <span className="drobne">{t("wizard.download.nothingNeeded")}</span>
                    </li>
                  )}
                </ul>
              )}

              <div className="krok-patka">
                <button
                  className="tlacitko tichy"
                  onClick={() => missingModule ? onBack() : setStep(manualFrom ?? 3)}
                >
                  {t("common.back")}
                </button>
                <ManualSelectionButton
                  label={t(manual ? "wizard.manual.switchToSimple" : "wizard.manual.switchToManual")}
                  onClick={() => {
                    setManual((r) => !r);
                    setManualFrom(null);
                  }}
                />
                {selected.length === 0 ? (
                  <button
                    className="tlacitko hlavni"
                    onClick={async () => {
                      // Nothing was selected because everything is already on
                      // the disk, so nothing is unfinished.
                      await dokonci([]);
                      onComplete();
                    }}
                  >
                    {t("wizard.download.startTranscribing")}
                  </button>
                ) : (
                  <button className="tlacitko hlavni" onClick={start}>
                    {t("wizard.download.downloadWithSize", { size: dataSize(totalMb) })}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------ 5. conclusion */}
      {step === 5 && (
        <div className={`krok ${failedIds.length === 0 ? "krok-zaver" : ""}`}>
          {failedIds.length === 0 ? (
            <>
              <h1>{t("common.done")}</h1>
              <p className="krok-uvod">{t("wizard.done.introReady")}</p>
              <p className="drobne">
                {tabHint[0]}
                {/* i18n-ignore: the key is labelled F3 on every keyboard */}
                <strong>F3</strong>
                {tabHint[1] ?? ""}
              </p>
              <div className="krok-patka">
                <button className="tlacitko hlavni" onClick={onComplete}>
                  {t("common.close")}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>{t(canTranscribe ? "wizard.done.almostTitle" : "wizard.done.failedTitle")}</h1>
              <p className="krok-uvod">
                {canTranscribe ? t("wizard.done.partialIntro") : t("wizard.done.missingIntro")}
              </p>

              <ul className="souhrn">
                {failedIds.map((id) => (
                  <li key={id} className="selhala">
                    <span>{itemName(id)}</span>
                    <span className="drobne">
                      {progress[id]?.message ? progressMessage(progress[id].message!) : ""}
                    </span>
                  </li>
                ))}
              </ul>

              {canTranscribe && <p className="drobne">{t("wizard.done.addLater")}</p>}

              <div className="krok-patka">
                <button
                  className="tlacitko tichy"
                  onClick={() => {
                    setProgress({});
                    setStep(4);
                  }}
                >
                  {t("wizard.done.backToSelection")}
                </button>
                <button
                  className={`tlacitko ${canTranscribe ? "" : "hlavni"}`}
                  onClick={retry}
                >
                  {t("common.retry")}
                </button>
                {canTranscribe && (
                  <button className="tlacitko hlavni" onClick={onComplete}>
                    {t("wizard.done.continueAnyway")}
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
  const { t, tDynamic } = useI18n();
  const { dataSize } = useFormats();

  const groups: Array<[string, TranslationKey]> = [
    ["program", "wizard.manual.groupPrograms"],
    ["model", "wizard.manual.groupModels"],
    ["speakers", "wizard.manual.groupSpeakers"],
    ["editor", "wizard.manual.groupEditor"],
  ];
  return (
    <div className="rucni">
      {groups.map(([key, titleKey]) => (
        <div key={key}>
          <h2>{t(titleKey)}</h2>
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
                      <span className="soucast-nazev">{tDynamic(p.name_code, p.id)}</span>
                      <span className="drobne">{tDynamic(p.description_code, "")}</span>
                    </span>
                    <span className="soucast-velikost">
                      {p.complete ? <DownloadedMark /> : dataSize(p.megabytes)}
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
