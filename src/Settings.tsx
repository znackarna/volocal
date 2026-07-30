import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import Select from "./Select";
import { COMPUTE_LABELS, FONTS, MODEL_DESCRIPTIONS, LANGUAGE_OPTIONS, modelName, applyFonts } from "./types";
import type { ToolCheck, Settings, BenchmarkResult } from "./types";

interface Props {
  onComplete: () => void;
  onError: (z: string) => void;
  /** Opens the modules screen; with an id it preselects what to add. */
  onToModule: (module?: string) => void;
}

const MODULE_ICONS = {
  model:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  compute:
    "M8 8h8v8H8z M5 10V8a3 3 0 0 1 3-3h2 M19 10V8a3 3 0 0 0-3-3h-2 M5 14v2a3 3 0 0 0 3 3h2 M19 14v2a3 3 0 0 1-3 3h-2 M12 2v3 M12 19v3 M2 12h3 M19 12h3",
  speakers:
    "M9 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M3 20v-1.2C3 16.1 5.7 14 9 14s6 2.1 6 4.8V20 M16.5 5.2a3.2 3.2 0 0 1 0 6.2 M17.5 14.3c2.1.5 3.5 2.1 3.5 4v1.7",
} as const;

/** Which downloadable module corresponds to which compute backend. */
const COMPUTE_MODULES: Record<string, string> = {
  cuda: "whisper-cuda",
  vulkan: "whisper-vulkan",
  cpu: "whisper-cpu",
};

type ModuleStatus = "complete" | "missing" | "optional";

const STATUS_BADGES: Record<ModuleStatus, { label: string; className: string }> = {
  complete: { label: "připraveno", className: "hotovo" },
  missing: { label: "chybí", className: "nutny" },
  optional: { label: "nestažené", className: "tichy" },
};

/** One row of the module overview. */
function ModuleTile({
  icon,
  title,
  value,
  status,
}: {
  icon: string;
  title: string;
  value: string;
  status: ModuleStatus;
}) {
  const badge = STATUS_BADGES[status];
  return (
    <div className={`modul-dlazdice ${status}`}>
      <span className="volba-ikona" aria-hidden>
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon.split(" M").map((segment, i) => (
            <path key={i} d={i === 0 ? segment : `M${segment}`} />
          ))}
        </svg>
      </span>
      <span className="modul-popis">
        <span className="modul-nazev">{title}</span>
        <span className="modul-hodnota">{value}</span>
      </span>
      <em className={`odznak ${badge.className}`}>{badge.label}</em>
    </div>
  );
}

/** Icon reflecting what the model is known for: speed, balance or accuracy.
 *  1.6 stroke on a 22 square, like the rest of the UI. */
function ModelMark({ id }: { id: string }) {
  const kresba = id.includes("turbo")
    ? // blesk — rychlost
      "M13 3L5.5 13.2h5L10 21l7.5-10.2h-5L13 3Z"
    : id.includes("q5") || id.includes("q4")
      ? // váhy — vyváženost
        "M12 4v16 M7 20h10 M4 8h16 M4 8l-2.5 6h5L4 8 M20 8l-2.5 6h5L20 8"
      : id.includes("medium") || id.includes("small")
        ? // menší kruh — omezenější model
          "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"
        : // target — highest accuracy
          "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 11.4a0.6 0.6 0 1 0 0 1.2 0.6 0.6 0 0 0 0-1.2Z";

  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {kresba.split(" M").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}

export default function SettingsScreen({ onComplete, onError, onToModule }: Props) {
  const [n, setN] = useState<Settings | null>(null);
  const [check, setCheck] = useState<ToolCheck | null>(null);
  const [saved, setSaved] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkResult[] | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [machine, setMachine] = useState("");
  const [copying, setCopying] = useState(false);
  const [copiedFile, setCopiedFile] = useState("");
  const [copyComplete, setCopyComplete] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setN(await api.loadSettings());
      setCheck(await api.checkTools());
      setMachine(await api.machineName());
    } catch (e) {
      onError(String(e));
    }
  }, [onError]);

  const benchmarkVykon = useCallback(async () => {
    setBenchmarking(true);
    setBenchmark(null);
    try {
      setBenchmark(await api.benchmarkCompute());
      setN(await api.loadSettings());
      setCheck(await api.checkTools());
    } catch (e) {
      onError(String(e));
    } finally {
      setBenchmarking(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (nove: Settings) => {
      setN(nove);
      // appearance applies immediately, before it is even saved
      applyFonts(nove);
      try {
        await api.saveSettings(nove);
        setCheck(await api.checkTools());
        setSaved(true);
        setTimeout(() => setSaved(false), 1400);
      } catch (e) {
        onError(String(e));
      }
    },
    [onError]
  );

  const udelejKopii = useCallback(async () => {
    const destination = await open({ directory: true, title: "Kam vytvořit přenosnou kopii" });
    if (typeof destination !== "string") return;

    setCopying(true);
    setCopyComplete(null);
    const unlisten = await listen<string>("copy:file", (u) =>
      setCopiedFile(u.payload)
    );
    try {
      setCopyComplete(await api.createPortableCopy(destination));
    } catch (e) {
      onError(String(e));
    } finally {
      unlisten();
      setCopying(false);
      setCopiedFile("");
    }
  }, [onError]);

  const selectDirectory = useCallback(
    async (key: "bin_directory" | "models_directory") => {
      if (!n) return;
      const selected = await open({ directory: true });
      if (typeof selected === "string") save({ ...n, [key]: selected });
    },
    [n, save]
  );

  if (!n) return <main className="nastaveni"><p>Načítám…</p></main>;

  const missingRequired = check?.issues ?? [];
  const downloadedBackends = check?.available_compute_backends ?? [];
  const hasDiarization = (check?.issues_diarization ?? []).length === 0;
  const missingCompute =
    !!n && n.compute !== "auto" && downloadedBackends.length > 0 && !downloadedBackends.includes(n.compute);

  return (
    <main className="nastaveni">
      <div className="nastaveni-hlava">
        <h1>Nastavení</h1>
        <span className={`ulozeno ${saved ? "vidno" : ""}`} aria-live="polite">
          Uloženo
        </span>
      </div>

      {check?.portable && (
        <section className="prenosna-info">
          <h2>Přenosný režim</h2>
          <p>
            Aplikace běží ze složky <code>{check.app_directory}</code>.
            Přepisy, programy i modely jsou uložené tamtéž. Do systému se
            nezapisuje nic.
          </p>
          <p className="drobne">
            Počítač: <strong>{machine}</strong>
            {check.webview2_bundled
              ? " · zobrazovací jádro je přiložené"
              : " · zobrazovací jádro není přiložené; na počítači bez WebView2 se okno neotevře"}
          </p>
        </section>
      )}

      {/* Moduly nepatří do hlavní nabídky — stahují se jednou a pak se k nim
          člověk vrací zřídka. Tady jsou po ruce a nepřekáží. */}
      <section>
        <h2>Moduly</h2>
        <p className="drobne">
          Programy a modely, ze kterých se přepis skládá. Stahují se jednou
          a zůstávají v počítači.
        </p>
        <div className="moduly-mrizka">
          <ModuleTile
            icon={MODULE_ICONS.model}
            title="Model přepisu"
            value={modelName(n.model)}
            status="complete"
          />
          <ModuleTile
            icon={MODULE_ICONS.compute}
            title="Výpočet"
            value={check ? COMPUTE_LABELS[check.compute] ?? check.compute : "—"}
            status={downloadedBackends.length > 0 ? "complete" : "missing"}
          />
          <ModuleTile
            icon={MODULE_ICONS.speakers}
            title="Rozlišení mluvčích"
            value={
              hasDiarization ? (n.diarization ? "Zapnuté" : "Připravené, vypnuté") : "Nestažené"
            }
            status={hasDiarization ? "complete" : "optional"}
          />
        </div>

        <div className="moduly-akce">
          <span className={missingRequired.length > 0 ? "varovne-radek" : "drobne"}>
            {missingRequired.length > 0
              ? `Chybí ${missingRequired.length} ${missingRequired.length === 1 ? "položka" : "položky"} nutné pro přepis.`
              : "Vše potřebné je stažené."}
          </span>
          <button
            className={`tlacitko ${missingRequired.length > 0 ? "hlavni" : ""}`}
            onClick={() => onToModule()}
          >
            {missingRequired.length > 0 ? "Doplnit" : "Spravovat moduly"}
          </button>
        </div>
      </section>

      <section>
        <h2>Výpočet</h2>
        <p className="drobne">
          Přepis probíhá na grafické kartě, případně na procesoru. Rate
          se mezi počítači liší i několikanásobně.
        </p>

        <div className="pole">
          <label>Position počítat</label>
          {/* Nabídka ukazuje i to, co zatím není stažené. Dřív se chybějící
              varianty prostě neobjevily a vypadalo to jako chyba. */}
          <Select
            value={n.compute}
            onChange={(v) => save({ ...n, compute: v })}
            items={[
              { value: "auto", label: "Rozhodnout automaticky" },
              ...["cuda", "vulkan", "cpu"].map((v) => ({
                value: v,
                label: COMPUTE_LABELS[v] ?? v,
                note: downloadedBackends.includes(v) ? undefined : "není stažené",
              })),
              ...(downloadedBackends.includes("vychozi")
                ? [{ value: "vychozi", label: COMPUTE_LABELS.default }]
                : []),
            ]}
          />
          {missingCompute && (
            <div className="pole-vyzva">
              <span>
                {COMPUTE_LABELS[n.compute] ?? n.compute} zatím není stažené.
                Než se addí, poběží přepis v jiném režimu.
              </span>
              <button
                className="tlacitko"
                onClick={() => onToModule(COMPUTE_MODULES[n.compute])}
              >
                Stáhnout
              </button>
            </div>
          )}
          {check && (
            <p className="drobne">
              Aktivní režim: <strong>{COMPUTE_LABELS[check.compute] ?? check.compute}</strong>.
              Ovladač NVIDIA {check.nvidia_driver ? "nalezen" : "nenalezen"},
              Vulkan {check.vulkan_driver ? "nalezen" : "nenalezen"}.
            </p>
          )}
        </div>

        <button className="tlacitko" onClick={benchmarkVykon} disabled={benchmarking}>
          {benchmarking ? "Probíhá měření…" : "Změřit rychlost"}
        </button>
        <p className="drobne">
          Test přepíše dvacetivteřinový úsek první nahrávky každým dostupným
          režimem a nejrychlejší z nich setí.
        </p>

        {benchmark && (
          <ul className="zkouska">
            {benchmark.map((v) => (
              <li key={v.compute} className={v.error ? "ne" : "ano"}>
                <span>{COMPUTE_LABELS[v.compute] ?? v.compute}</span>
                <span>
                  {v.error
                    ? `nelze použít — ${v.error}`
                    : `${v.realtime_factor.toFixed(1)}× realtime (${v.seconds.toFixed(1)} s)`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Umístění fileů</h2>
        <p className="drobne">
          {check?.portable
            ? "Relativní cesty se vztahují ke složce s programem, takže nezáleží na písmenu disku."
            : "Programy i modely se stahují automaticky. Cestu měňte jen v případě, že je potřebujete mít jinde."}
        </p>

        <div className="pole">
          <label>Složka s programy</label>
          <div className="radka">
            <input
              value={n.bin_directory}
              onChange={(e) => setN({ ...n, bin_directory: e.target.value })}
              onBlur={() => save(n)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <button className="tlacitko" onClick={() => selectDirectory("bin_directory")}>
              Vybrat…
            </button>
          </div>
        </div>

        <div className="pole">
          <label>Složka s modely</label>
          <div className="radka">
            <input
              value={n.models_directory}
              onChange={(e) => setN({ ...n, models_directory: e.target.value })}
              onBlur={() => save(n)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <button className="tlacitko" onClick={() => selectDirectory("models_directory")}>
              Vybrat…
            </button>
          </div>
        </div>

      </section>

      {check && <ToolDiagnostics k={check} />}

      <section>
        <h2>Vzhled</h2>
        <p className="drobne">
          Písma jsou součástí aplikace, vzhled je proto na všech počítačích shodný.
        </p>

        <div className="pole">
          <label>Písmo rozhraní</label>
          <Select
            value={n.font_ui}
            onChange={(v) => save({ ...n, font_ui: v })}
            items={Object.entries(FONTS)
              .filter(([, p]) => p.category === "sans")
              .map(([id, p]) => ({ value: id, label: p.title }))}
          />
        </div>

        <div className="pole">
          <label>Písmo přepisu</label>
          <Select
            value={n.font_text}
            onChange={(v) => save({ ...n, font_text: v })}
            items={[
              ...Object.entries(FONTS)
                .filter(([, p]) => p.category === "serif")
                .map(([id, p]) => ({
                  value: id,
                  label: p.title,
                  group: "Patkové (na čtení)",
                })),
              ...Object.entries(FONTS)
                .filter(([, p]) => p.category === "sans")
                .map(([id, p]) => ({
                  value: id,
                  label: p.title,
                  group: "Bezpatkové",
                })),
            ]}
          />
          <p className="drobne">
            Souvislý text se patkovým písmem čte snadněji.
          </p>
        </div>

        <div className="pole">
          <label>Velikost textu v přepisu <em className="hodnota">{n.transcript_font_size.toFixed(1)} px</em></label>
          <input
            type="range"
            min={14}
            max={26}
            step={0.5}
            value={n.transcript_font_size}
            onChange={(e) => save({ ...n, transcript_font_size: Number(e.target.value) })}
          />
        </div>

        <div className="pole">
          <label>Řádkování <em className="hodnota">{n.transcript_line_height.toFixed(2)}</em></label>
          <input
            type="range"
            min={1.3}
            max={2.2}
            step={0.02}
            value={n.transcript_line_height}
            onChange={(e) => save({ ...n, transcript_line_height: Number(e.target.value) })}
          />
        </div>

        <div className="nahled-pisma">
          <div className="nahled-mluvci">Radomil</div>
          <p>
            A tak se ten syn vrátil domů, k otci, kterého předtím opustil. Je
            psáno v listu Efezským, v páté kapitole: „Muži, milujte své ženy.“
            Otec ho uviděl už zdálky — 1 234 kroků daleko — a běžel mu naproti.
          </p>
          <p className="nahled-popisek">
            Háčky a čárky: ě š č ř ž ý á í é ú ů ň ť ď
          </p>
        </div>
      </section>

      <section>
        <h2>Přepis</h2>

        <div className="pole">
          <label>Model</label>
          {/* Karty místo rozbalovací nabídky: modely se od sebe liší tím,
              co dělají s časem a přesností, a to se v jednom řádku neřekne. */}
          <div className="volby volby-modelu">
            {(check?.found_models.length
              ? check.found_models
              : [n.model]
            ).map((m) => (
              <button
                key={m}
                className={`volba s-ikonou ${n.model === m ? "zvolena" : ""}`}
                onClick={() => save({ ...n, model: m })}
                aria-pressed={n.model === m}
              >
                <span className="volba-ikona" aria-hidden>
                  <ModelMark id={m} />
                </span>
                <span className="volba-telo">
                  <span className="volba-hlava">
                    <span className="volba-nazev">{modelName(m)}</span>
                    {n.model === m && <em className="odznak">používá se</em>}
                  </span>
                  <span className="drobne">{MODEL_DESCRIPTIONS[m] ?? "Stažený model."}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="drobne">
            Nabídka obsahuje pouze stažené modely. Další lze doplnit v Modulech.
          </p>
        </div>

        <div className="pole">
          <label>Jazyk</label>
          <Select
            value={n.language}
            onChange={(j) => save({ ...n, language: j })}
            items={LANGUAGE_OPTIONS}
          />
          <p className="drobne">
            Určuje, jak se má nahrávka číst. Zvolíte-li konkrétní jazyk a
            nahrávka je v jiném, Whisper text přeloží místo přepsání.
            U smíšeného materiálu ponechte rozpoznávání.
          </p>
        </div>

        <div className="pole">
          <label className="vypinac">
            <input
              type="checkbox"
              checked={n.vad}
              onChange={(e) => save({ ...n, vad: e.target.checked })}
            />
            <span className="vypinac-drazka" aria-hidden />
            <span className="vypinac-popis">Detekce řeči</span>
          </label>
          <p className="drobne">
            Vynechává ticho a šum před vstupem do modelu. Bez ní se přepis
            na začátku nahrávky často zacyklí a vynechá první věty.{" "}
            <strong>Doporučeno ponechat zapnuté.</strong>
          </p>
        </div>

        <div className="pole">
          <label>Důkladnost hledání <em className="hodnota">{n.beam}</em></label>
          <input
            type="range"
            min={1}
            max={8}
            value={n.beam}
            onChange={(e) => save({ ...n, beam: Number(e.target.value) })}
          />
          <p className="drobne">
            Vyšší hodnota zvyšuje přesnost a prodlužuje dobu přepisu.
          </p>
        </div>

        <DecodingSettings n={n} save={save} />
      </section>

      <section>
        <h2>Mluvčí</h2>

        <div className="pole">
          <label className="vypinac">
            <input
              type="checkbox"
              checked={n.diarization}
              onChange={(e) => save({ ...n, diarization: e.target.checked })}
            />
            <span className="vypinac-drazka" aria-hidden />
            <span className="vypinac-popis">Rozlišovat mluvčí</span>
          </label>
          <p className="drobne">
            Rozdělí text mezi jednotlivé mluvčí. U nahrávek s jedním
            mluvčím nemá využití.
          </p>
        </div>

        {n.diarization && (
          <div className="pole">
            <label>Počet mluvčích</label>
            <input
              type="number"
              min={0}
              max={12}
              value={n.speaker_count}
              onChange={(e) => save({ ...n, speaker_count: Number(e.target.value) })}
            />
            <p className="drobne">
              Nula znamená automatický estimate. Zadání skutečného počtu
              výsledek výrazně zpřesňuje.
            </p>
          </div>
        )}

        {n.diarization && (
          <div className="pole">
            <label>Jak podrobně hledat střídání</label>
            <Select
              value={String(n.segmentation_window_shift)}
              onChange={(v) => save({ ...n, segmentation_window_shift: Number(v) })}
              items={[
                { value: "0.4", label: "Rychle", note: "hrubší hranice" },
                { value: "0.2", label: "Vyvážené" },
                { value: "0.1", label: "Podrobně", note: "až dvakrát déle" },
              ]}
            />
            <p className="drobne">
              Kolik se toho o nahrávce spočítá. Podrobnější hledání posadí
              hranice mezi mluvčími přesněji, ale úměrně tomu trvá déle.
            </p>
          </div>
        )}

        {check && check.issues_diarization.length > 0 && n.diarization && (
          <ul className="problemy">
            {check.issues_diarization.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      {!check?.portable && (
        <section>
          <h2>Copy na přenosný disk</h2>
          <p className="drobne">
            Zkopíruje aplikaci včetně modelů na zvolený disk. Na jiném
            počítači pak stačí spustit <code>Whisp.exe</code>; nic se
            neinstaluje a v systému nezůstanou žádné stopy.
          </p>

          {copying ? (
            <p className="drobne">Kopírování: {copiedFile}</p>
          ) : (
            <button className="tlacitko" onClick={udelejKopii}>
              Vybrat disk a zkopírovat
            </button>
          )}

          {copyComplete !== null && (
            <p className="drobne" style={{ color: "var(--uspech)" }}>
              Zkopírováno {copyComplete.toFixed(1)} GB.
            </p>
          )}

          <p className="drobne">
            Čtení z flash disku je pomalé. Model se načítá před každým
            přepisem, což přidá přibližně minutu.
          </p>
        </section>
      )}

      <section>
        <h2>Výkon</h2>
        <div className="pole">
          <label>Počet jader procesoru <em className="hodnota">{n.threads === 0 ? "podle systému" : n.threads}</em></label>
          <input
            type="number"
            min={0}
            max={64}
            value={n.threads}
            onChange={(e) => save({ ...n, threads: Number(e.target.value) })}
          />
        </div>
      </section>

    </main>
  );
}

/**
 * Thresholds Whisper uses to decide whether it transcribed a segment properly.
 *
 * Tucked behind a disclosure on purpose. Ninety per cent of people never need
 * to touch these, and a badly set temperature can degrade a transcript more
 * than it ever rescues. Whoever does get here is usually chasing a specific
 * problem — a looping sentence or a swallowed quiet voice — and needs to know
 * which lever to pull.
 */
const DEFAULT_DECODING = {
  threshold_silence: 0.6,
  threshold_confidence: -1,
  entropy_threshold: 2.6,
  temperature: 0,
  temperature_increment: 0.2,
} as const;

function DecodingSettings({
  n,
  save,
}: {
  n: Settings;
  save: (n: Settings) => void;
}) {
  const [open, setOpen] = useState(false);
  const isCustom = (Object.keys(DEFAULT_DECODING) as Array<
    keyof typeof DEFAULT_DECODING
  >).some((k) => n[k] !== DEFAULT_DECODING[k]);

  const fields: Array<{
    key: keyof typeof DEFAULT_DECODING;
    label: string;
    min: number;
    max: number;
    step: number;
    description: string;
  }> = [
    {
      key: "threshold_silence",
      label: "Práh ticha",
      min: 0,
      max: 1,
      step: 0.05,
      description:
        "Nad touhle mírou jistoty Whisper prohlásí úsek za ticho a nic z něj nenapíše. Zvyš, když si vymýšlí text tam, kde nikdo nemluví. Sniž, když mizí tiše pronesené věty.",
    },
    {
      key: "threshold_confidence",
      label: "Práh jistoty",
      min: -3,
      max: 0,
      step: 0.1,
      description:
        "Když si Whisper úsekem není jistý ani takhle, zahodí ho a zkusí to znovu jinak. Blíž k nule = přísnější a pomalejší.",
    },
    {
      key: "entropy_threshold",
      label: "Práh jednotvárnosti",
      min: 1,
      max: 5,
      step: 0.1,
      description:
        "Nejúčinnější páčka proti zacyklení, kdy se jedna věta opakuje dokola. Nižší číslo = dřív pozná, že se model zasekl.",
    },
    {
      key: "temperature",
      label: "Teplota",
      min: 0,
      max: 1,
      step: 0.1,
      description:
        "Nula znamená vždy nejpravděpodobnější slovo. Vyšší hodnota vnáší náhodu — na přepis se nehodí, měň jen když všechno ostatní selhalo.",
    },
    {
      key: "temperature_increment",
      label: "Krok teploty",
      min: 0,
      max: 0.5,
      step: 0.05,
      description:
        "O kolik se teplota zvedne při každém dalším pokusu o tentýž úsek. Nula opakování vypne — zacyklení pak nemá co přerušit.",
    },
  ];

  return (
    <div className="pokrocile">
      <button
        className="pokrocile-prepinac"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`pokrocile-sipka ${open ? "dolu" : ""}`} aria-hidden>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M3 1.5L6.5 5L3 8.5" fill="none" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        Jemné ladění přepisu
        {isCustom && <span className="odznak tichy">upraveno</span>}
      </button>

      {open && (
        <div className="pokrocile-obsah">
          <p className="drobne">
            Meze, podle kterých Whisper pozná, že se mu úsek nepovedl, a zkusí
            ho znovu. Bez potíží, kterou chceš vyřešit, sem nesahej —
            výchozí hodnoty jsou ty, se kterými počítá sám Whisper.
          </p>

          {fields.map((p) => (
            <div className="pole" key={p.key}>
              <label>
                {p.label} <em className="hodnota">{n[p.key]}</em>
              </label>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={n[p.key]}
                onChange={(e) => save({ ...n, [p.key]: Number(e.target.value) })}
              />
              <p className="drobne">{p.description}</p>
            </div>
          ))}

          <button
            className="tlacitko"
            disabled={!isCustom}
            onClick={() => save({ ...n, ...DEFAULT_DECODING })}
          >
            Zpět na výchozí
          </button>
        </div>
      )}
    </div>
  );
}

function ToolDiagnostics({ k }: { k: ToolCheck }) {
  const rows: Array<[string, string | null]> = [
    ["ffmpeg", k.ffmpeg],
    ["ffprobe", k.ffprobe],
    ["whisper-cli", k.whisper_cli],
    ["model Whisperu", k.model_whisper],
    ["model VAD", k.model_vad],
    ["diarizace (program)", k.sherpa_diarization],
    ["diarizace (segmentace)", k.segmentation_model],
    ["diarizace (hlasové otisky)", k.embedding_model],
  ];
  return (
    <section>
      <h2>Stav modulů</h2>
      <ul className="kontrola">
        {rows.map(([title, path]) => (
          <li key={title} className={path ? "ano" : "ne"}>
            <span className="kontrola-nazev">{title}</span>
            <span className="kontrola-cesta">{path ?? "nenalezeno"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
