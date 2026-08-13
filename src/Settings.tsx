import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { RecordingCalendar, RecordingMetadataItem } from "./Library";
import ConfirmationDialog from "./ConfirmationDialog";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import CountdownRing from "./CountdownRing";
import InfoNote from "./InfoNote";
import { LineIcon, type LineIconName } from "./icons";
import { ClipboardRefused, copyPlainText } from "./detail/clipboard";
import Select from "./Select";
import { useI18n, type AppLanguage } from "./i18n";
import { useUserMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import { FONTS, MODEL_IDS, applyFonts, applyTheme } from "./types";
import { useFormats } from "./formats";
import { useLabels } from "./labels";
import { SettingsToggle } from "./settings/toggle";
import { UpdateCheck } from "./settings/updates";
import type {
  ToolCheck,
  Settings,
  BenchmarkResult,
  DownloadComponent,
  DictionaryEntry,
} from "./types";

/** The three palettes, in the order light grows in them: the system's own
 *  decision first, then the two that override it. */
const THEMES = [
  { value: "system", label: "settings.appearance.themeSystem" },
  { value: "light", label: "settings.appearance.themeLight" },
  { value: "dark", label: "settings.appearance.themeDark" },
] as const satisfies ReadonlyArray<{ value: string; label: TranslationKey }>;

/** Settings written by an older version have no theme at all, and a stored
 *  value we do not know is not a palette we can draw. Both are the system. */
function themeChoice(stored: string): string {
  return stored === "light" || stored === "dark" ? stored : "system";
}

interface Props {
  onComplete: () => void;
  onError: (z: string) => void;
  /** A passing remark for the notice bar: nothing went wrong, nothing to do. */
  onInfo: (z: string) => void;
  /** Opens the modules screen; with an id it preselects what to add. */
  onToModule: (module?: string) => void;
}

/** Only identifiers here: the names and descriptions are looked up inside the
 *  components, so they follow a language change instead of freezing at import. */
const EDITOR_CHOICES: ReadonlyArray<{
  component: string;
  model: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}> = [
  {
    component: "editor-model-light",
    model: "gemma-4-e2b-q4",
    titleKey: "settings.editor.light.title",
    descriptionKey: "settings.editor.light.description",
  },
  {
    component: "editor-model-balanced",
    model: "gemma-4-e4b-q4",
    titleKey: "settings.editor.balanced.title",
    descriptionKey: "settings.editor.balanced.description",
  },
  {
    component: "editor-model-best",
    model: "gemma-4-12b-q4",
    titleKey: "settings.editor.best.title",
    descriptionKey: "settings.editor.best.description",
  },
];

/** Where transcription can run, in the order it is offered. `vychozi` is a
 *  build with no acceleration chosen; it only appears when one is installed. */
const COMPUTE_CHOICES: ReadonlyArray<{ value: string; descriptionKey: TranslationKey }> = [
  { value: "auto", descriptionKey: "settings.performance.autoDescription" },
  { value: "cpu", descriptionKey: "settings.performance.cpuDescription" },
  { value: "vulkan", descriptionKey: "settings.performance.vulkanDescription" },
  { value: "cuda", descriptionKey: "settings.performance.cudaDescription" },
];

/** Which downloadable module corresponds to which compute backend. */
const COMPUTE_MODULES: Record<string, string> = {
  cuda: "whisper-cuda",
  vulkan: "whisper-vulkan",
  cpu: "whisper-cpu",
};

/** What `Pokročilé` puts back, and what tells it whether anything has moved.
 *
 *  Every one of these is a value with a right answer that somebody may have a
 *  reason to disagree with: the beam width, the five thresholds Whisper decides
 *  a segment by, and where the work runs. The numbers are whisper.cpp's own,
 *  from `examples/cli/cli.cpp`, except the entropy threshold — 2.6 rather than
 *  2.4, because on Czech the model looped more often than whisper's own
 *  threshold was willing to catch. They match `Settings::default` in `db.rs`,
 *  which is what a fresh installation gets; the two lists have to agree, or a
 *  new installation would open badged as modified.
 *
 *  The two folders in that block are deliberately not here — see the comment
 *  where the block is drawn. */
const ADVANCED_DEFAULTS = {
  beam: 5,
  threshold_silence: 0.6,
  threshold_confidence: -1,
  entropy_threshold: 2.6,
  temperature: 0,
  temperature_increment: 0.2,
  compute: "auto",
} as const satisfies Partial<Settings>;

/** The five thresholds, as sliders. `whisper.rs` sends `--no-speech-thold`,
 *  `--logprob-thold`, `--entropy-thold`, `--temperature` and
 *  `--temperature-inc` whenever they differ from whisper's defaults, and asks
 *  nothing else first — which is why they are shown unconditionally. They used
 *  to appear only while speech detection was on, so a value that was being
 *  passed to the transcription could be invisible on this screen. */
const DECODING_FIELDS: ReadonlyArray<{
  key: "threshold_silence" | "threshold_confidence" | "entropy_threshold"
    | "temperature" | "temperature_increment";
  labelKey: TranslationKey;
  min: number;
  max: number;
  step: number;
  descriptionKey: TranslationKey;
}> = [
  {
    key: "threshold_silence",
    labelKey: "settings.decoding.silence",
    min: 0,
    max: 1,
    step: 0.05,
    descriptionKey: "settings.decoding.silenceNote",
  },
  {
    key: "threshold_confidence",
    labelKey: "settings.decoding.confidence",
    min: -3,
    max: 0,
    step: 0.1,
    descriptionKey: "settings.decoding.confidenceNote",
  },
  {
    key: "entropy_threshold",
    labelKey: "settings.decoding.entropy",
    min: 1,
    max: 5,
    step: 0.1,
    descriptionKey: "settings.decoding.entropyNote",
  },
  {
    key: "temperature",
    labelKey: "settings.decoding.temperature",
    min: 0,
    max: 1,
    step: 0.1,
    descriptionKey: "settings.decoding.temperatureNote",
  },
  {
    key: "temperature_increment",
    labelKey: "settings.decoding.temperatureStep",
    min: 0,
    max: 0.5,
    step: 0.05,
    descriptionKey: "settings.decoding.temperatureStepNote",
  },
];

/* Five tabs, each one a subject somebody arrives with: what comes out of a
   recording, how the application looks, where its files are kept, staying on
   the current version, and what the application is.

   There were seven, and for one day there were three — `Přepis`, `Aplikace`
   and `O aplikaci`. Jakub looked at those three and said they do not help:
   appearance is a subject of its own, `O aplikaci` is `Informace`, and updating
   is something you do rather than something you read about the application. So
   `Vzhled` and `Aktualizace` stand on their own again.

   What the reduction took out stays out. `Modely`, `Výkon`, `Slovník` and
   `Soubory` were the shape of the code rather than subjects a reader arrives
   with, and the controls deleted with them were dead, harmful or derivable from
   another one. This is only about how the remaining ones are grouped.

   `Aplikace` is now `Složky a zálohy`. Once appearance left it, what was under
   that name was the recordings folder, the watched folder and the archive's
   copies — and none of them is what a reader would look for behind the word
   `Aplikace`. */
type SettingsTab = "transcription" | "appearance" | "files" | "updates" | "about";

const SETTINGS_TABS: SettingsTab[] = [
  "transcription",
  "appearance",
  "files",
  "updates",
  "about",
];
/** `appearance` is named by the one card that fills its tab rather than by a
 *  key of its own: a second key holding the same word is a second thing to keep
 *  in step, and the transcription card already borrows its tab's key in the
 *  other direction. */
const SETTINGS_TAB_KEYS: Record<SettingsTab, TranslationKey> = {
  transcription: "settings.tab.transcription",
  appearance: "settings.appearance.title",
  files: "settings.tab.files",
  updates: "settings.tab.updates",
  about: "settings.tab.about",
};

/** The models on disk arrive sorted by file name, which is not an order
 *  anybody reads. They are shown in the order the interface offers them —
 *  best first — and anything it does not know by name comes last. */
function byModelOrder(a: string, b: string): number {
  const rank = (id: string) => {
    const index = (MODEL_IDS as readonly string[]).indexOf(id);
    return index < 0 ? MODEL_IDS.length : index;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Renders a translated sentence whose `{name}` placeholder carries markup.
 *  The sentence stays whole in the dictionary; only its rendering is split, so
 *  a translator can move the value anywhere inside the sentence. */
function Filled({
  message,
  name,
  children,
}: {
  message: string;
  name: string;
  children: ReactNode;
}) {
  const marker = `{${name}}`;
  const at = message.indexOf(marker);
  if (at < 0) return <>{message}</>;
  return (
    <>
      {message.slice(0, at)}
      {children}
      {message.slice(at + marker.length)}
    </>
  );
}

/** The three language-editing models differ only in how much of the same work
 *  they do, so their marks are the same sparkle counted out: one, two, three.
 *  A picture per tier — a bolt, scales, a target, as the transcription models
 *  have — would promise three different kinds of work, and there is only one.
 *  Sizes and positions are the `editor` icon's own, so the largest of the
 *  three is exactly the icon used everywhere else for this feature. */
function EditorMark({ model }: { model: string }) {
  const big = "M12 3l1.1 3.9L17 8l-3.9 1.1L12 13l-1.1-3.9L7 8l3.9-1.1L12 3Z";
  const right = "M18.5 13l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z";
  const left = "M6 14l.9 3.1L10 18l-3.1.9L6 22l-.9-3.1L2 18l3.1-.9L6 14Z";
  const paths = model.includes("12b")
    ? [big, right, left]
    : model.includes("e4b")
      ? [big, right]
      : [big];

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Icon reflecting what the model is known for: speed, balance or accuracy.
 *  1.6 stroke on a 22 square, like the rest of the UI. */
function ModelMark({ id }: { id: string }) {
  const drawing = id.includes("turbo")
    ? // lightning — speed
      "M13 3L5.5 13.2h5L10 21l7.5-10.2h-5L13 3Z"
    : id.includes("q5") || id.includes("q4")
      ? // scales — a balance struck
        "M12 4v16 M7 20h10 M4 8h16 M4 8l-2.5 6h5L4 8 M20 8l-2.5 6h5L20 8"
      : id.includes("medium") || id.includes("small")
        ? // a smaller circle — a smaller model
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
      {drawing.split(" M").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}

/** One toggle pattern for section switches, field switches and card footers. */
/** Native disclosure shared by advanced transcription and module diagnostics. */
function SettingsDisclosure({
  title,
  badge,
  children,
  /** Called the first time it is opened, for content worth fetching only then. */
  onOpen,
  /** `card-footer` when it is the last band of a card and wants its own rule. */
  className = "",
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <details
      className={`settings-disclosure ${className}`.trim()}
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) onOpen?.();
      }}
    >
      <summary>
        <svg className="settings-disclosure-chevron" width="10" height="10"
             viewBox="0 0 10 10" aria-hidden>
          <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{title}</span>
        {badge}
      </summary>
      <div className="settings-disclosure-content">{children}</div>
    </details>
  );
}

export default function SettingsScreen({ onComplete, onError, onInfo, onToModule }: Props) {
  const labels = useLabels();
  const formats = useFormats();
  const { language, setLanguage, t, tPlural, formatNumber } = useI18n();
  const userMessage = useUserMessage();
  const [n, setN] = useState<Settings | null>(null);
  const [check, setCheck] = useState<ToolCheck | null>(null);
  const [modules, setModules] = useState<DownloadComponent[]>([]);
  const [saved, setSaved] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkResult[] | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [machine, setMachine] = useState("");
  const [copying, setCopying] = useState(false);
  const [copiedFile, setCopiedFile] = useState("");
  const [copyComplete, setCopyComplete] = useState<number | null>(null);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  /** What the archive holds, as opposed to what is in the fields. A row is
   *  edited in place, so `dictionary` follows every keystroke; this follows
   *  only what was saved, and is what a row with an emptied side goes back to. */
  const dictionaryRef = useRef<DictionaryEntry[]>([]);
  const [entryFind, setEntryFind] = useState("");
  const [entryReplace, setEntryReplace] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const remembered = localStorage.getItem("settings-tab");
    /* A remembered name this build does not have opens the first tab rather
       than an empty panel, which is what makes renaming one safe: `application`
       was stored on every machine that opened Settings yesterday and is not a
       tab any more. */
    return SETTINGS_TABS.some((tab) => tab === remembered)
      ? remembered as SettingsTab
      : "transcription";
  });

  /* The dictionary is a list of corrections Whisper gets wrong the same way
     every time — a name, a place, a term from the field. `find` is what comes
     out of the recording, `replace` is what it should say. `prompt` also hands
     the term to Whisper before it starts, which often prevents the mistake
     instead of repairing it, but a long list of hints dilutes them, so it is
     a choice rather than the rule.

     A new entry hints. That is the useful default, and the row's own switch is
     visible the moment the entry appears, so turning it off is one click in
     the place you are already looking. There used to be a second switch above
     the list carrying the same name; it only chose this default, was stored
     nowhere, and read as a master switch over the column beneath it. */
  const addEntry = useCallback(async () => {
    const find = entryFind.trim();
    const replace = entryReplace.trim();
    if (!find || !replace) return;
    try {
      const entry = await api.addDictionaryEntry(find, replace);
      dictionaryRef.current = [...dictionaryRef.current, entry];
      setDictionary((current) => [...current, entry]);
      setEntryFind("");
      setEntryReplace("");
    } catch (e) {
      onError(userMessage(e));
    }
  }, [entryFind, entryReplace, onError, userMessage]);

  const editEntry = useCallback((id: string, change: Partial<DictionaryEntry>) => {
    setDictionary((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry))
    );
  }, []);

  /** Leaving a row saves it. An entry with an empty side is not an entry —
   *  it would replace everything, or replace it with nothing — so instead of
   *  saving it the field goes back to what is stored. Doing nothing at all was
   *  worse than either: the screen showed one thing, the archive held another,
   *  and nobody was told. Deleting an entry has its own control. */
  const saveEntry = useCallback(async (entry: DictionaryEntry) => {
    const find = entry.find.trim();
    const replace = entry.replace.trim();
    if (!find || !replace) {
      const stored = dictionaryRef.current.find((saved) => saved.id === entry.id);
      if (stored) editEntry(entry.id, { find: stored.find, replace: stored.replace });
      return;
    }
    try {
      await api.updateDictionaryEntry(entry.id, find, replace);
      dictionaryRef.current = dictionaryRef.current.map((saved) =>
        saved.id === entry.id ? { ...saved, find, replace } : saved
      );
      editEntry(entry.id, { find, replace });
    } catch (e) {
      onError(userMessage(e));
    }
  }, [editEntry, onError, userMessage]);

  const removeEntry = useCallback(async (id: string) => {
    try {
      await api.deleteDictionaryEntry(id);
      dictionaryRef.current = dictionaryRef.current.filter((entry) => entry.id !== id);
      setDictionary((current) => current.filter((entry) => entry.id !== id));
    } catch (e) {
      onError(userMessage(e));
    }
  }, [onError, userMessage]);

  const selectTab = useCallback((tab: SettingsTab) => {
    localStorage.setItem("settings-tab", tab);
    setActiveTab(tab);
  }, []);

  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const current = SETTINGS_TABS.findIndex((tab) => tab === activeTab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % SETTINGS_TABS.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SETTINGS_TABS.length - 1;
    else return;

    event.preventDefault();
    const tab = SETTINGS_TABS[next];
    selectTab(tab);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${tab}`)?.focus());
  }, [activeTab, selectTab]);

  const load = useCallback(async () => {
    try {
      setN(await api.loadSettings());
      setCheck(await api.checkTools());
      setModules(await api.catalog());
      setMachine(await api.machineName());
      const saved = await api.dictionary();
      dictionaryRef.current = saved;
      setDictionary(saved);
    } catch (e) {
      onError(userMessage(e));
    }
  }, [onError, userMessage]);

  const benchmarkVykon = useCallback(async () => {
    setBenchmarking(true);
    setBenchmark(null);
    try {
      setBenchmark(await api.benchmarkCompute());
      setN(await api.loadSettings());
      setCheck(await api.checkTools());
    } catch (e) {
      onError(userMessage(e));
    } finally {
      setBenchmarking(false);
    }
  }, [onError, userMessage]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (nove: Settings) => {
      setN(nove);
      // appearance applies immediately, before it is even saved
      applyFonts(nove);
      applyTheme(nove.theme);
      try {
        await api.saveSettings(nove);
        setCheck(await api.checkTools());
        setSaved(true);
        setTimeout(() => setSaved(false), 1400);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, userMessage]
  );

  const udelejKopii = useCallback(async () => {
    const destination = await open({
      directory: true,
      title: t("settings.portable.copyDestination"),
    });
    if (typeof destination !== "string") return;

    setCopying(true);
    setCopyComplete(null);
    const unlisten = await listen<string>("copy:file", (u) =>
      setCopiedFile(u.payload)
    );
    try {
      setCopyComplete(await api.createPortableCopy(destination));
    } catch (e) {
      onError(userMessage(e));
    } finally {
      unlisten();
      setCopying(false);
      setCopiedFile("");
    }
  }, [onError, t, userMessage]);

  const selectDirectory = useCallback(
    async (
      key: "bin_directory" | "models_directory" | "watch_folder" | "recording_folder"
    ) => {
      if (!n) return;
      const selected = await open({ directory: true });
      if (typeof selected !== "string") return;
      /* Choosing a folder to watch is what switching watching on used to mean.
         There was a `Sledovat složku` switch beside this button, and it could
         only ever be in one of two states: off with a folder chosen, which is
         a setting that does nothing and says nothing about why, or on, which
         is what picking a folder already said. The stored flag stays, because
         it is what the backend reads; this is the only thing that sets it. */
      save(
        key === "watch_folder"
          ? { ...n, watch_folder: selected, watch_folder_enabled: true }
          : { ...n, [key]: selected }
      );
    },
    [n, save]
  );

  if (!n) return <main className="settings"><p>{t("common.loading")}</p></main>;

  const missingRequired = check?.issues ?? [];
  const downloadedBackends = check?.available_compute_backends ?? [];
  // The plain build appears only where it exists, so nobody is offered a
  // choice their installation cannot make.
  const computeChoices = downloadedBackends.includes("vychozi")
    ? [...COMPUTE_CHOICES, { value: "vychozi", descriptionKey: "settings.performance.defaultDescription" as TranslationKey }]
    : COMPUTE_CHOICES;
  const availableEditorChoices = EDITOR_CHOICES.filter((choice) =>
    modules.some((module) => module.id === choice.component && module.complete)
  );
  const hasEditor = availableEditorChoices.length > 0;
  const missingCompute =
    !!n && n.compute !== "auto" && downloadedBackends.length > 0 && !downloadedBackends.includes(n.compute);
  /* Whether anything folded away has been moved off its default. The badge and
     the reset button are one question asked twice, so they are one expression:
     a block that says `upraveno` and a button that refuses to do anything
     would be worse than neither. */
  const advancedChanged = (
    Object.keys(ADVANCED_DEFAULTS) as Array<keyof typeof ADVANCED_DEFAULTS>
  ).some((key) => n[key] !== ADVANCED_DEFAULTS[key]);

  return (
    <main className="settings">
      <div className="settings-head">
        <h1>{t("settings.title")}</h1>
        {/* A pill with a ring that empties as the pill's own time runs out.
            The message and its lifetime are then the same object, so nothing
            vanishes without having shown that it was about to. */}
        <span className={`saved ${saved ? "visible" : ""}`} aria-live="polite">
          <CountdownRing />
          {t("common.saved")}
        </span>
      </div>

      <nav className="settings-tabs" role="tablist" aria-label={t("settings.groups")}>
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`settings-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls="settings-panel"
            className={activeTab === tab ? "active" : ""}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => selectTab(tab)}
            onKeyDown={handleTabKeyDown}
          >
            <span>{t(SETTINGS_TAB_KEYS[tab])}</span>
            {/* The dot follows the status band, which now stands at the foot of
                the transcription tab rather than on a tab of its own. */}
            {tab === "transcription" && missingRequired.length > 0 && (
              <span className="settings-tab-alert" aria-label={t("settings.missingRequired")} />
            )}
          </button>
        ))}
      </nav>

      <div
        className="settings-panels"
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={`settings-tab-${activeTab}`}
      >

      {activeTab === "files" && check?.portable && (
        <section className="portable-info settings-card-portable">
          <h2>{t("settings.portable.title")}</h2>
          <p>
            <Filled message={t("settings.portable.description")} name="directory">
              <code>{check.app_directory}</code>
            </Filled>
          </p>
          <p className="small-text">
            <Filled
              message={t(
                check.webview2_bundled
                  ? "settings.portable.machineBundled"
                  : "settings.portable.machineSeparate"
              )}
              name="machine"
            >
              <strong>{machine}</strong>
            </Filled>
          </p>
        </section>
      )}

      {/* One line about everything that has to be on the disk, and one button
          to the list that puts it there.

          It used to be a tab of its own carrying four read-only tiles — the
          model, the acceleration, the editor and the speakers — each repeating
          a value chosen three cards higher up on this same screen. None of them
          could be pressed. What a reader needs from this subject is whether
          anything is missing, and the way to fix it if it is; that is a band,
          not a tab. The button opens the by-hand component list directly (the
          wizard does that itself when it is opened neither as required nor for
          one named module). */}
      {activeTab === "transcription" && <section className="settings-card-modules">
        <h2>{t("settings.modules.title")}</h2>
        <p className="settings-section-description">
          {t("settings.modules.description")}
        </p>

        <div className="settings-action-row spaced">
          {missingRequired.length > 0 ? (
            <span className="warning-row">
              {tPlural("settings.modules.missingRequired", missingRequired.length)}
            </span>
          ) : (
            <InfoNote compact>{t("settings.modules.complete")}</InfoNote>
          )}
          <button
            className={`button ${missingRequired.length > 0 ? "primary" : ""}`}
            onClick={() => onToModule()}
          >
            {missingRequired.length > 0
              ? t("settings.modules.add")
              : t("settings.modules.manage")}
          </button>
        </div>
      </section>}

      {activeTab === "transcription" && <section className="settings-card-language-edit">
        {/* The switch governs everything below it, so it belongs beside the
            heading — the same section pattern as Mluvčí and Rychlé tipy. When
            the feature is off the card collapses to that one row instead of
            offering model cards that cannot take effect. */}
        {hasEditor ? (
          <SettingsToggle
            title={t("settings.editor.title")}
            label={t("settings.editor.title")}
            checked={!!n.editor_model}
            heading
            description={t("settings.editor.description")}
            onChange={(checked) => {
              if (!checked) {
                if (n.editor_model) {
                  localStorage.setItem("last-editor-model", n.editor_model);
                }
                save({ ...n, editor_model: "" });
                return;
              }

              const remembered = localStorage.getItem("last-editor-model");
              const selected =
                availableEditorChoices.find((choice) => choice.model === remembered) ??
                availableEditorChoices.find((choice) => choice.model === "gemma-4-e4b-q4") ??
                availableEditorChoices[0];
              if (selected) {
                localStorage.setItem("last-editor-model", selected.model);
                save({ ...n, editor_model: selected.model });
              }
            }}
          />
        ) : (
          <>
            <h2>{t("settings.editor.title")}</h2>
            <p className="settings-section-description">{t("settings.editor.description")}</p>
          </>
        )}

        {hasEditor && !!n.editor_model && (
          <>
            <div className="choices model-choices">
              {availableEditorChoices.map((choice) => (
                <button
                  key={choice.model}
                  className={`choice with-icon ${n.editor_model === choice.model ? "chosen" : ""}`}
                  onClick={() => {
                    localStorage.setItem("last-editor-model", choice.model);
                    save({ ...n, editor_model: choice.model });
                  }}
                  aria-pressed={n.editor_model === choice.model}
                >
                  <span className="choice-icon" aria-hidden>
                    <EditorMark model={choice.model} />
                  </span>
                  <span className="choice-body">
                    <span className="choice-title">{t(choice.titleKey)}</span>
                    <span className="small-text">{t(choice.descriptionKey)}</span>
                  </span>
                  {n.editor_model === choice.model && (
                    <em className="badge">{t("settings.badge.inUse")}</em>
                  )}
                </button>
              ))}
            </div>
            <InfoNote compact>{t("settings.editor.enabledNote")}</InfoNote>
          </>
        )}

        {!hasEditor && (
          <div className="field-prompt">
            <span>{t("settings.editor.missing")}</span>
            <button className="button" onClick={() => onToModule("editor-model-balanced")}>
              {t("common.download")}
            </button>
          </div>
        )}
      </section>}

      {/* Everything that used to be two tabs, folded into one block at the foot
          of the one tab it belongs to.

          `Výkon` and the two folders from `Modely` were never subjects anybody
          arrives with: a reader who opens Settings wants a better transcript,
          and these are the levers for when the ordinary ones have not given it.
          One disclosure, one badge saying whether any of it has been moved, and
          one way back — rather than a badge and a reset per group, which is how
          a reader ends up not knowing what state the machine is in.

          `Zpět na výchozí` covers the values, not the two folders. A folder is
          a place, not a setting: resetting it would point the application at a
          directory where nothing has been downloaded, which is not a default
          anybody wanted. For the same reason a moved folder does not raise the
          badge — on an ordinary installation neither path is the built-in
          relative one, so it would say `upraveno` for everybody. */}
      {activeTab === "transcription" && <section className="settings-card-advanced">
        <SettingsDisclosure
          title={t("settings.advanced.title")}
          badge={
            advancedChanged ? (
              <span className="badge quiet">{t("settings.advanced.modified")}</span>
            ) : undefined
          }
        >
        <p className="small-text">{t("settings.advanced.note")}</p>

        <div className="field">
          <label>
            {t("settings.transcription.beam")} <em className="value">
              {formatNumber(n.beam)}
            </em>
          </label>
          <input
            type="range"
            min={1}
            max={8}
            value={n.beam}
            onChange={(e) => save({ ...n, beam: Number(e.target.value) })}
          />
          <p className="small-text">{t("settings.transcription.beamNote")}</p>
        </div>

        {/* The five thresholds Whisper decides by. They are here whatever else
            is set, which they were not: they used to be revealed by the speech
            detection switch, and `whisper.rs` writes `--temperature`,
            `--logprob-thold`, `--entropy-thold`, `--temperature-inc` and
            `--no-speech-thold` without ever consulting it. A value that is
            being sent must be visible. */}
        {DECODING_FIELDS.map((p) => (
          <div className="field" key={p.key}>
            <label>
              {t(p.labelKey)} <em className="value">{formatNumber(n[p.key])}</em>
            </label>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={n[p.key]}
              onChange={(e) => save({ ...n, [p.key]: Number(e.target.value) })}
            />
            <p className="small-text">{t(p.descriptionKey)}</p>
          </div>
        ))}

        <div className="field">
          <label>{t("settings.performance.compute")}</label>
          {/* The same choice cards as the models above. A backend is a thing
              you pick once and want to see the consequence of, which a
              collapsed dropdown cannot show — least of all which of them are
              even on this machine. */}
          <div className="choices model-choices">
            {computeChoices.map((choice) => {
              const missing =
                choice.value !== "auto" && !downloadedBackends.includes(choice.value);
              const chosen = n.compute === choice.value;
              // A card that is not installed does not offer to be chosen — it
              // offers to be installed. Choosing it would badge it as in use
              // while the transcription quietly ran somewhere else.
              return (
                <button
                  key={choice.value}
                  className={`choice with-icon ${chosen ? "chosen" : ""} ${missing ? "missing" : ""}`}
                  onClick={() =>
                    missing
                      ? onToModule(COMPUTE_MODULES[choice.value])
                      : save({ ...n, compute: choice.value })
                  }
                  aria-pressed={missing ? undefined : chosen}
                >
                  {/* One mark for all four: the icon is the category's badge,
                      not what tells them apart — that is the name and the
                      sentence under it (Jakub's call after seeing four sets
                      side by side). */}
                  <span className="choice-icon" aria-hidden>
                    <LineIcon name="compute" />
                  </span>
                  <span className="choice-body">
                    <span className="choice-title">{labels.compute(choice.value)}</span>
                    <span className="small-text">
                      {t(missing ? "settings.performance.notDownloaded" : choice.descriptionKey)}
                    </span>
                  </span>
                  {missing ? (
                    <em className="badge actions">{t("common.download")}</em>
                  ) : chosen ? (
                    <em className="badge">{t("settings.badge.inUse")}</em>
                  ) : null}
                </button>
              );
            })}
          </div>
          {missingCompute && (
            <InfoNote compact>{t("settings.performance.selectedMissing")}</InfoNote>
          )}
        </div>

        {/* `Vlákna procesoru` stood here and is gone. Zero — the default and
            what almost every installation carried — already means
            `available_parallelism`, and every measured value above it was
            slower, because whisper.cpp is memory-bound long before it runs out
            of cores. A number that can only make things worse is not a setting. */}

        <div className="settings-action-row separated">
          <InfoNote compact>{t("settings.performance.benchmarkNote")}</InfoNote>
          <button className="button" onClick={benchmarkVykon} disabled={benchmarking}>
            {benchmarking
              ? t("settings.performance.benchmarking")
              : t("settings.performance.benchmark")}
          </button>
        </div>

        {benchmark && (
          <ul className="benchmark">
            {benchmark.map((v, index) => (
              <li key={v.compute} className={v.error ? "no" : "yes"}>
                <span>
                  {labels.compute(v.compute)}
                  {index === 0 && !v.error && (
                    <span className="fastest">
                      {" — "}
                      {t("settings.performance.fastest")}
                    </span>
                  )}
                </span>
                <span>
                  {v.error
                    ? t("settings.performance.benchmarkFailed", {
                        error: userMessage(v.error),
                      })
                    : t("settings.performance.benchmarkResult", {
                        factor: formatNumber(v.realtime_factor, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        }),
                        seconds: formatNumber(v.seconds, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        }),
                      })}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Both folders are shown and neither is typed.

            They were free-text fields that saved on blur, which means one
            mistyped character pointed the application at a directory holding
            none of the tools it had downloaded — and the way back was to
            remember what the path had been. The picker cannot produce a folder
            that does not exist, and it is the only way in now. */}
        <p className="small-text">
          {t(check?.portable
            ? "settings.files.locationsPortable"
            : "settings.files.locationsDescription")}
        </p>

        <div className="field">
          <label>{t("settings.files.binDirectory")}</label>
          <div className="input-row">
            <input
              value={n.bin_directory}
              readOnly
              aria-label={t("settings.files.binDirectory")}
            />
            <button className="button" onClick={() => selectDirectory("bin_directory")}>
              {t("settings.files.choose")}
            </button>
          </div>
        </div>

        <div className="field">
          <label>{t("settings.files.modelsDirectory")}</label>
          <div className="input-row">
            <input
              value={n.models_directory}
              readOnly
              aria-label={t("settings.files.modelsDirectory")}
            />
            <button className="button" onClick={() => selectDirectory("models_directory")}>
              {t("settings.files.choose")}
            </button>
          </div>
        </div>

        <button
          className="button"
          disabled={!advancedChanged}
          onClick={() => save({ ...n, ...ADVANCED_DEFAULTS })}
        >
          {t("settings.advanced.reset")}
        </button>

        {check && <ToolDiagnostics k={check} onInfo={onInfo} onError={onError} />}
        </SettingsDisclosure>
      </section>}

      {/* The dictionary is not a subject of its own: it is a list of the
          mistakes this transcript makes, and it belongs beside the model that
          makes them. It was a tab because it is long, which is a reason to put
          it last on a tab, not to give it one. */}
      {activeTab === "transcription" && <section className="settings-card-dictionary">
        <h2>{t("settings.dictionary.title")}</h2>
        <p className="settings-section-description">{t("settings.dictionary.description")}</p>

        <div className="field">
          <label htmlFor="dictionary-find">{t("settings.dictionary.newEntry")}</label>
          {/* One row, like every other field in Settings that ends in an
              action. The two halves say what they are through their
              placeholders; a second visible label above one of two boxes on
              the same line reads as two separate fields. */}
          <div className="input-row dictionary-row">
            <input
              id="dictionary-find"
              value={entryFind}
              onChange={(event) => setEntryFind(event.target.value)}
              placeholder={t("settings.dictionary.findPlaceholder")}
              aria-label={t("settings.dictionary.find")}
              spellCheck={false}
            />
            <span className="dictionary-arrow" aria-hidden>→</span>
            <input
              value={entryReplace}
              onChange={(event) => setEntryReplace(event.target.value)}
              placeholder={t("settings.dictionary.replacePlaceholder")}
              aria-label={t("settings.dictionary.replace")}
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addEntry();
              }}
            />
            <button
              className="button primary"
              onClick={() => void addEntry()}
              disabled={!entryFind.trim() || !entryReplace.trim()}
            >
              {t("settings.dictionary.add")}
            </button>
          </div>
        </div>

        <div className="dictionary-saved">
          {dictionary.length > 0 ? (
            <>
              {/* A saved row is two bare words and a switch; without a
                  heading the reader has to work out which half is the error
                  and which is the fix. The header sits on the same grid as
                  the rows, so each label stands over its own column. */}
              <div className="dictionary-head" aria-hidden>
                <span>{t("settings.dictionary.find")}</span>
                <span />
                <span>{t("settings.dictionary.replace")}</span>
                <span />
              </div>
              <ul className="dictionary-list">
              {dictionary.map((entry) => (
                <li key={entry.id}>
                  <input
                    value={entry.find}
                    onChange={(event) => editEntry(entry.id, { find: event.target.value })}
                    onBlur={() => void saveEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    aria-label={t("settings.dictionary.find")}
                    spellCheck={false}
                  />
                  <span className="dictionary-arrow" aria-hidden>→</span>
                  <input
                    value={entry.replace}
                    onChange={(event) => editEntry(entry.id, { replace: event.target.value })}
                    onBlur={() => void saveEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    aria-label={t("settings.dictionary.replace")}
                    spellCheck={false}
                  />
                  <span className="dictionary-row-actions">
                  <button
                    type="button"
                    className="dictionary-remove"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                    onClick={() => void removeEntry(entry.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                      <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor"
                            strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </button>
                  </span>
                </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="small-text">{t("settings.dictionary.empty")}</p>
          )}
        </div>
      </section>}

      {activeTab === "appearance" && <section className="settings-card-appearance">
        <h2>{t("settings.appearance.title")}</h2>
        <p className="settings-section-description">
          {t("settings.appearance.description")}
        </p>

        <div className="field">
          <label>{t("settings.language.title")}</label>
          <Select
            value={language}
            description={t("settings.language.label")}
            onChange={(value) => setLanguage(value as AppLanguage)}
            items={[
              { value: "cs", label: t("domain.appLanguage.cs") },
              { value: "en", label: t("domain.appLanguage.en") },
            ]}
          />
          <InfoNote>{t("settings.language.description")}</InfoNote>
        </div>

        <div className="field">
          <label>{t("settings.appearance.theme")}</label>
          <Select
            value={themeChoice(n.theme)}
            onChange={(value) => save({ ...n, theme: value })}
            items={THEMES.map((choice) => ({
              value: choice.value,
              label: t(choice.label),
            }))}
          />
        </div>

        {/* Both fonts, and the reasoning that removed this one was wrong.

            It was taken out as a vanity choice over the chrome — the argument
            being that what somebody wants to read comfortably is the
            transcript, which the field below covers. The owner asked for it
            back the moment he saw the screen without it, and he is right: the
            application's own type is not decoration to the person who looks at
            it all day, and *derivable* was never the same as *unwanted*. Only
            sans faces are offered, because a serif menu is a different claim
            from a serif transcript. */}
        <div className="field">
          <label>{t("settings.appearance.fontUi")}</label>
          <Select
            value={n.font_ui}
            onChange={(v) => save({ ...n, font_ui: v })}
            items={Object.entries(FONTS)
              .filter(([, p]) => p.category === "sans")
              .map(([id]) => ({ value: id, label: labels.fontTitle(id) }))}
          />
        </div>

        <div className="field">
          <label>{t("settings.appearance.fontText")}</label>
          <Select
            value={n.font_text}
            onChange={(v) => save({ ...n, font_text: v })}
            items={[
              ...Object.entries(FONTS)
                .filter(([, p]) => p.category === "serif")
                .map(([id]) => ({
                  value: id,
                  label: labels.fontTitle(id),
                  group: t("settings.appearance.fontGroupSerif"),
                })),
              ...Object.entries(FONTS)
                .filter(([, p]) => p.category === "sans")
                .map(([id]) => ({
                  value: id,
                  label: labels.fontTitle(id),
                  group: t("settings.appearance.fontGroupSans"),
                })),
            ]}
          />
        </div>

        <div className="field">
          <label>
            {t("settings.appearance.fontSize")} <em className="value">
              {t("settings.appearance.fontSizeValue", {
                value: formatNumber(n.transcript_font_size, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })}
            </em>
          </label>
          <input
            type="range"
            min={14}
            max={26}
            step={0.5}
            value={n.transcript_font_size}
            onChange={(e) => save({ ...n, transcript_font_size: Number(e.target.value) })}
          />
        </div>

        {/* `Řádkování` was a second slider, and it is a consequence of the
            first: large type needs proportionally less leading than small type
            to read as the same block. `transcriptLineHeight` derives it, and
            the line it draws passes exactly through the pair that shipped —
            17.5 px at 1.72 — so nothing moves for anyone who never touched it. */}

        <div className="preview-font">
          <div className="preview-speakers">{t("settings.appearance.previewSpeaker")}</div>
          <p>{t("settings.appearance.previewText")}</p>
          <p className="preview-label">{t("settings.appearance.previewDiacritics")}</p>
        </div>
      </section>}

      {activeTab === "transcription" && <section className="settings-card-transcription">
        <h2>{t("settings.tab.transcription")}</h2>
        <p className="settings-section-description">
          {t("settings.transcription.description")}
        </p>

        <div className="field">
          <label>{t("settings.transcription.model")}</label>
          {/* Cards rather than a dropdown: what separates these models is what
              they do with time and accuracy, and that does not fit on a line. */}
          <div className="choices model-choices">
            {(check?.found_models.length
              ? [...check.found_models].sort(byModelOrder)
              : [n.model]
            ).map((m) => (
              <button
                key={m}
                className={`choice with-icon ${n.model === m ? "chosen" : ""}`}
                onClick={() => save({ ...n, model: m })}
                aria-pressed={n.model === m}
              >
                <span className="choice-icon" aria-hidden>
                  <ModelMark id={m} />
                </span>
                <span className="choice-body">
                  <span className="choice-title">{labels.model(m)}</span>
                  <span className="small-text">
                    {labels.modelDescription(m, t("settings.transcription.modelDescription"))}
                  </span>
                </span>
                {/* Outside the text block, so it lands on the right edge like
                    the status pill on a module tile rather than drifting with
                    the length of the model's name. */}
                {n.model === m && <em className="badge">{t("settings.badge.inUse")}</em>}
              </button>
            ))}
          </div>
          <InfoNote>{t("settings.transcription.modelNote")}</InfoNote>
        </div>

        {/* The recording's own language, on the card with the model that reads
            it. It had a card of its own, `Jazyk a detekce řeči`, and once the
            speech-detection switch went there was one field left on it — and a
            field called `Jazyk` two tabs from a field called `Jazyk aplikace`,
            with nothing to say which was which. It says so itself now.

            `Detekce řeči` is not gone anywhere else: `whisper.rs` passes
            `--vad` unconditionally. Off is the documented cause of Whisper
            repeating one token over silence, the switch's own note said *nechte
            zapnuté*, and a switch whose only other position is a known defect
            is not a choice. */}
        <div className="field">
          <label>{t("settings.transcription.language")}</label>
          <Select
            value={n.language}
            onChange={(j) => save({ ...n, language: j })}
            items={labels.languageOptions()}
          />
          <InfoNote>{t("settings.transcription.languageNote")}</InfoNote>
        </div>
      </section>}

      {activeTab === "files" && <section className="settings-card-watch-folder">
        <h2>{t("settings.files.watchTitle")}</h2>
        <p className="settings-section-description">
          {t("settings.files.watchDescription")}
        </p>

        <div className="field">
          <label>{t("settings.files.watchDirectory")}</label>
          <div className="input-row">
            <input
              value={n.watch_folder}
              readOnly
              placeholder={t("settings.files.watchPlaceholder")}
              aria-label={t("settings.files.watchTitle")}
            />
            <button className="button" onClick={() => selectDirectory("watch_folder")}>
              {t("settings.files.choose")}
            </button>
            {/* Kept, though the plan for this screen struck it out along with
                the switch above. With both gone, choosing a folder once would
                be permanent — there would be no way left to stop watching,
                which is the same one-way door the recordings folder's
                `Výchozí` exists to avoid. It appears only when there is
                something to remove. */}
            {n.watch_folder && (
              <button
                className="button quiet"
                onClick={() =>
                  save({
                    ...n,
                    watch_folder: "",
                    watch_folder_enabled: false,
                    watch_folder_auto: false,
                  })
                }
              >
                {t("settings.files.watchRemove")}
              </button>
            )}
          </div>
        </div>

        {/* One switch where there were two. `Sledovat složku` sat above this
            one and could only ever repeat what the row above it already said: a
            folder is chosen, or it is not. The one question left is what to do
            with what turns up in it — offer it in the Archive, or start.

            Shown whether or not a folder is chosen, rather than appearing with
            one. A switch that materialises after an unrelated press is a switch
            nobody knows exists; disabled, it is visible and says what it will
            be for. */}
        <SettingsToggle
          title={t("settings.files.watchAuto")}
          label={t("settings.files.watchAuto")}
          checked={n.watch_folder_auto}
          disabled={!n.watch_folder}
          onChange={(checked) => save({ ...n, watch_folder_auto: checked })}
          description={t("settings.files.watchAutoNote")}
        />
      </section>}

      {/* A take from the microphone exists nowhere else, and until now it lived
          in %APPDATA% where nobody looks. The point of this card is that the
          audio the application makes for itself is somewhere its owner can
          find — which is also what lets a factory reset leave it alone. */}
      {activeTab === "files" && <section className="settings-card-recordings">
        <h2>{t("settings.recordings.title")}</h2>
        <p className="settings-section-description">
          {t("settings.recordings.description")}
        </p>

        <div className="field">
          <label>{t("settings.recordings.directory")}</label>
          <div className="input-row">
            <input
              value={n.recording_folder}
              readOnly
              placeholder={t("settings.recordings.defaultPlace")}
              aria-label={t("settings.recordings.directory")}
            />
            <button className="button" onClick={() => selectDirectory("recording_folder")}>
              {t("settings.files.choose")}
            </button>
            {n.recording_folder && (
              <button
                className="button quiet"
                onClick={() => save({ ...n, recording_folder: "" })}
              >
                {t("settings.recordings.reset")}
              </button>
            )}
          </div>
          {/* Inside the field it belongs to, which is what gives it the
              system's 8 px — and puts the toggle back next to the `.field`, so
              it gets its own 24 px and the divider. Between them it was an
              orphan with no spacing rule at all. */}
          <InfoNote>{t("settings.recordings.movedNote")}</InfoNote>
        </div>

        <SettingsToggle
          title={t("settings.recordings.copyImports")}
          label={t("settings.recordings.copyImports")}
          checked={n.copy_imports}
          onChange={(checked) => save({ ...n, copy_imports: checked })}
          description={t("settings.recordings.copyImportsNote")}
        />
      </section>}

      {activeTab === "transcription" && <section className="settings-card-speakers">
        <SettingsToggle
          title={t("settings.speakers.title")}
          label={t("settings.speakers.toggle")}
          checked={n.diarization}
          heading
          onChange={(checked) => save({ ...n, diarization: checked })}
          description={t("settings.speakers.description")}
        />

        {/* Two controls stood here and both are gone.

            `Počet mluvčích` was overridden every time it could have mattered:
            with recognition on, the dialog asks before every run and its answer
            replaces the stored number. The one case where the stored value did
            apply was the reader pressing `Nevím` — so the answer meaning
            *estimate it* silently applied whatever number was left in Settings,
            and a count at or above the number of voice windows collapses the
            whole recording into a single speaker. Removing it is what makes
            `Nevím` mean what it says.

            `Hledání změn mluvčího` promised a measurable trade — `Podrobně`
            carried the note *až dvakrát déle* — and delivered neither half:
            `segmentation_window_shift` is written here and read by no Rust
            code, because the sherpa segmentation binary it configured was
            removed. The field stays in the settings record so an archive
            written by an older build still loads; nothing sets it. */}

        {check && check.issues_diarization.length > 0 && n.diarization && (
          <ul className="problems">
            {check.issues_diarization.map((p, i) => (
              <li key={i}>{userMessage(p)}</li>
            ))}
          </ul>
        )}
      </section>}

      {/* `Zobrazovat tipy nad přepisem` stood here. The strip it governs is
          dismissed by its own × on the transcript screen, which is where
          anybody who wants it gone is looking; a switch on another screen to
          undo a press made two screens away is a setting for a decision nobody
          revisits. Dismissing it is final on this machine now, which is the
          trade: one fewer control against one fewer way back. */}

      {activeTab === "files" && <Backups onError={onError} onInfo={onInfo} />}

      {activeTab === "files" && !check?.portable && (
        <section className="settings-card-portable-copy">
          <h2>{t("settings.portable.copyTitle")}</h2>
          <p className="settings-section-description">
            <Filled message={t("settings.portable.copyDescription")} name="file">
              {/* i18n-ignore: the name of the file on disk */}
              <code>Volocal.exe</code>
            </Filled>
          </p>

          <div className="settings-action-row separated">
            <InfoNote compact>
              {copying
                ? t("settings.portable.copyingFile", { file: copiedFile })
                : t("settings.portable.copyHint")}
            </InfoNote>
            <button className="button" onClick={udelejKopii} disabled={copying}>
              {copying
                ? t("settings.portable.copying")
                : t("settings.portable.copyAction")}
            </button>
          </div>

          {copyComplete !== null && (
            <p className="small-text settings-success" role="status">
              {t("settings.portable.copied", {
                size: formats.dataSize(copyComplete * 1024),
              })}
            </p>
          )}

        </section>
      )}

      {/* Updating is the one thing on this screen that is neither a setting nor
          a fact about the application: it is an errand, with a button that goes
          out to a server and a second one that closes the application and
          starts an installer. It stood at the foot of the About page, under the
          licences, which is where a reader looking for a new version would look
          last. */}
      {activeTab === "updates" && (
        <section className="settings-card-updates">
          <h2>{t("settings.tab.updates")}</h2>
          <UpdateCheck
            onError={onError}
            onInfo={onInfo}
            automatic={n.update_check_automatic}
            onAutomaticChange={(on) => save({ ...n, update_check_automatic: on })}
          />
        </section>
      )}

      {activeTab === "about" && <About />}

      </div>
    </main>
  );
}

/**
 * What the application is, what it does, and what it is made of.
 *
 * Jakub asked for the three things this answers: which technologies it stands
 * on, under what licences, and what the application can actually do. Nothing
 * here is a setting or an action — it is the one page that exists to be read,
 * which is why the update check moved off it and onto a tab of its own.
 */
function About() {
  const { t } = useI18n();
  const [version, setVersion] = useState("");

  // From the bundle rather than typed here: `tauri.conf.json` already carries
  // the number, and a second copy is the one that would be wrong on release
  // day. `core:default` grants `core:app:allow-version`, so no capability
  // changed for this.
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  /* Project and licence names are proper nouns — the same string in every
     language — so they stand here rather than in the dictionary, where a
     translator would be invited to change them. Only the group headings and
     the one licence that is a Czech phrase come from keys.
     i18n-ignore: names of projects and of licences */
  const credits: ReadonlyArray<{ label: TranslationKey; items: [string, string][] }> = [
    {
      label: "settings.about.groupApp",
      items: [
        ["Tauri 2", "MIT / Apache 2.0"],
        ["React 18", "MIT"],
        ["SQLite", t("settings.about.publicDomain")],
      ],
    },
    {
      label: "settings.about.groupTranscription",
      items: [
        ["whisper.cpp (ggml)", "MIT"],
        ["Whisper (OpenAI)", "MIT"],
        ["Silero VAD", "MIT"],
      ],
    },
    {
      label: "settings.about.groupSpeakers",
      items: [
        ["ONNX Runtime", "MIT"],
        ["3D-Speaker CAM++", "Apache 2.0"],
      ],
    },
    {
      label: "settings.about.groupEditor",
      items: [
        ["llama.cpp", "MIT"],
        ["Gemma (Google)", "Gemma Terms of Use"],
      ],
    },
    {
      label: "settings.about.groupMedia",
      items: [
        ["FFmpeg", "GPL v3"],
        ["yt-dlp", "Unlicense"],
        ["Deno", "MIT"],
      ],
    },
    {
      label: "settings.about.groupFonts",
      items: [
        ["Geist, Inter, Schibsted Grotesk", "SIL OFL 1.1"],
        ["Literata, Source Serif 4", "SIL OFL 1.1"],
      ],
    },
  ];

  /** One line each, with the mark of the part of the application it belongs
   *  to — the same drawings those screens carry. */
  const abilities: ReadonlyArray<{ icon: LineIconName; text: TranslationKey }> = [
    { icon: "transcription", text: "settings.about.abilityTranscribe" },
    { icon: "speakers", text: "settings.about.abilitySpeakers" },
    { icon: "editor", text: "settings.about.abilityEditor" },
    { icon: "review", text: "settings.about.abilityReview" },
    { icon: "note", text: "settings.about.abilityNotes" },
    { icon: "video", text: "settings.about.abilitySources" },
    { icon: "folder", text: "settings.about.abilityExport" },
  ];

  return (
    <>
      <section className="settings-card-about">
        {/* i18n-ignore: the name of the product, the same word in every language */}
        <h2>Volocal</h2>
        <p className="settings-section-description">{t("settings.about.description")}</p>

        <dl className="about-panel">
          <div className="about-row">
            <dt>{t("settings.about.version")}</dt>
            <dd>{version || "—"}</dd>
          </div>
          <div className="about-row">
            <dt>{t("settings.about.author")}</dt>
            {/* i18n-ignore: a company name, and it mirrors src-tauri/Cargo.toml */}
            <dd>značkárna s.r.o.</dd>
          </div>
        </dl>
      </section>

      <section className="settings-card-abilities">
        <h2>{t("settings.about.abilities")}</h2>
        <ul className="about-abilities">
          {abilities.map((ability) => (
            <li key={ability.icon}>
              <span className="about-mark">
                <LineIcon name={ability.icon} size={17} />
              </span>
              {t(ability.text)}
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-card-credits">
        <h2>{t("settings.about.credits")}</h2>
        <p className="settings-section-description">
          {t("settings.about.creditsDescription")}
        </p>

        {credits.map((group) => (
          <div className="about-group" key={group.label}>
            <p className="about-group-label">{t(group.label)}</p>
            <dl className="about-panel">
              {group.items.map(([name, licence]) => (
                <div className="about-row" key={name}>
                  <dt>{name}</dt>
                  <dd>{licence}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        <InfoNote>{t("settings.about.licenceNote")}</InfoNote>
      </section>
    </>
  );
}

/**
 * Backups of the archive.
 *
 * The whole archive is one SQLite file. It is worth saying out loud where the
 * copies are, because the moment anyone needs them is the moment they will not
 * feel like hunting for a folder.
 *
 * The card carries two more things than its title suggests, and they are here
 * rather than on a card of their own because they are the same file. Saving a
 * copy is what the automatic backups are not: those live beside the archive, on
 * this disk, in this profile, and a dead disk takes the lot. Loading one belongs
 * beside restoring, because it is the same act — an archive arrives in place of
 * the one that is open.
 */
function Backups({
  onError,
  onInfo,
}: {
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const { dataSize, transcriptCount, archiveDuration } = useFormats();
  /** The hour on its own for the row, and the whole moment for the question
   *  that names it — the row already has the day beside it, the dialog does not. */
  const formatTime = (moment: string) =>
    formatDate(new Date(moment), { hour: "2-digit", minute: "2-digit" });
  const formatMoment = (moment: string) =>
    formatDate(new Date(moment), {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const userMessage = useUserMessage();
  /* Its own, rather than a prop threaded down from the application: this is the
     only question this screen asks, and it asks it about its own card. */
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [status, setStatus] = useState<{
    latest: string;
    count: number;
    directory: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  /** Separate from `running`: saving a copy changes nothing, so it must not
   *  disable the buttons that do. */
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<
    {
      file: string;
      taken_at: string;
      size: number;
      recordings: number | null;
      seconds: number | null;
    }[] | null
  >(null);

  const refresh = useCallback(() => {
    api.backupStatus().then(setStatus).catch(() => setStatus(null));
    setList(null);
  }, []);

  useEffect(refresh, [refresh]);

  /* `Zálohovat teď` stood here and is gone with its handler. A copy is taken at
     every start — which is what the card's own description says — so the button
     made a second copy of an archive that had not changed since the first one,
     and the only thing it could do that the automatic copy cannot is make three
     of them in a row. Restoring, exporting and importing are the acts that
     needed a button. */

  /* A name with the day in it, because the folder these land in is the one
     somebody keeps several in. */
  const exportArchive = useCallback(async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      const destination = await save({
        defaultPath: `volocal-${stamp}.db`,
        filters: [{ name: t("settings.archive.fileFilter"), extensions: ["db"] }],
      });
      if (!destination) return;
      setSaving(true);
      await api.exportArchive(destination);
      onInfo(t("settings.archive.exported", { path: destination }));
    } catch (e) {
      onError(userMessage(e));
    } finally {
      setSaving(false);
    }
  }, [onError, onInfo, t, userMessage]);

  /* The question is asked after the file is chosen rather than before, so that
     it can name it. "Replace the archive?" with nothing named is a question
     nobody can answer. */
  const importArchive = useCallback(async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: t("settings.archive.fileFilter"), extensions: ["db"] }],
    });
    if (typeof chosen !== "string") return;
    setConfirmation({
      title: t("settings.archive.importConfirmTitle"),
      text: t("settings.archive.importConfirmText", {
        name: chosen.split(/[\\/]/).pop() ?? chosen,
      }),
      confirm: t("settings.archive.importAction"),
      destructive: true,
      action: async () => {
        setRunning(true);
        try {
          await api.importArchive(chosen);
          // Same reason as restoring: every screen is holding data from the
          // archive that has just been replaced.
          window.location.reload();
        } catch (e) {
          onError(userMessage(e));
          setRunning(false);
        }
      },
    });
  }, [onError, t, userMessage]);

  return (
    <section className="settings-card-backups">
      <h2>{t("settings.backups.title")}</h2>
      <p className="settings-section-description">{t("settings.backups.description")}</p>

      {/* Three facts about one thing, so they are one panel with one rule
          between each: when, how many, where. The folder used to hang under
          the pair as a loose monospace line with nothing naming it — it is a
          row like the others now, and clicking it opens the folder, which is
          the only reason anyone reads a path at all. */}
      <dl className="backup-summary">
        <div className="backup-row">
          <dt>{t("settings.backups.latest")}</dt>
          <dd>{status?.latest || t("settings.backups.none")}</dd>
        </div>
        <div className="backup-row">
          <dt>{t("settings.backups.count")}</dt>
          <dd>{formatNumber(status?.count ?? 0)}</dd>
        </div>
        {status?.directory && (
          <div className="backup-row">
            <dt>{t("settings.backups.directory")}</dt>
            <dd>
              <button
                type="button"
                className="backup-path"
                title={t("settings.backups.reveal")}
                onClick={() => {
                  void revealItemInDir(status.directory).catch((e) => onError(userMessage(e)));
                }}
              >
                <bdi>{status.directory}</bdi>
              </button>
            </dd>
          </div>
        )}
      </dl>

      {/* The archive leaving and arriving, on the face of the card.

          Both were folded away with the list of backups, under a heading that
          had to name two subjects at once — and they are not the same subject.
          Going back to a Tuesday is a list to read; sending the archive to
          another disk is one press. The press is up here; the reading is folded
          under it. One note for the two of them, because they are one archive
          going in either direction. */}
      <div className="settings-action-row spaced">
        <InfoNote compact>{t("settings.archive.note")}</InfoNote>
        <div className="settings-action-row-buttons">
          <button className="button" onClick={exportArchive} disabled={saving || running}>
            {saving ? t("settings.archive.exportSaving") : t("settings.archive.export")}
          </button>
          <button className="button" onClick={importArchive} disabled={running}>
            {t("settings.archive.import")}
          </button>
        </div>
      </div>

      {/* Last band of the card, folded away. Putting a backup back is the
          rarest thing on this screen and the only one that replaces what is
          there — it belongs under everything that is not. */}
      {/* Always here, unlike the list inside it. A machine that has just been
          set up has no backups and is exactly the machine somebody wants to
          load an archive into. */}
      <SettingsDisclosure
        title={t("settings.backups.restoreTitle")}
        className="card-footer"
        onOpen={() => {
          if (list === null) api.backups().then(setList).catch(() => setList([]));
        }}
      >
        {(status?.count ?? 0) > 0 ? (
          <ul className="backup-list">
            {(list ?? []).map((backup) => (
              <li key={backup.file}>
                {/* The same torn-off leaf the archive puts on a recording. A
                    backup is chosen by its day first and its hour second, and
                    the day is what the eye finds without reading. */}
                <RecordingCalendar value={backup.taken_at} />
                {/* No mark on the hour. The leaf beside it already says which
                    day, and with marks on both facts at the right a third one
                    made the row busier than it is informative. */}
                <span className="backup-when">{formatTime(backup.taken_at)}</span>
                {/* dataSize speaks in megabytes; the file system speaks in
                    bytes. Passed straight through, a 1.4 MB archive announced
                    itself as 1 420 GB. */}
                {/* The archive's own pair, with the archive's own marks: how
                    many transcripts and how much audio. Nobody picks a backup
                    by megabytes — those stay in the tooltip, where a file's
                    weight belongs. */}
                {backup.recordings !== null && (
                  <span className="recording-metadata backup-holds"
                        title={dataSize(backup.size / (1024 * 1024))}>
                    <RecordingMetadataItem
                      kind="segments"
                      label={t("library.folders.count")}
                      value={transcriptCount(backup.recordings)}
                    />
                    <RecordingMetadataItem
                      kind="duration"
                      label={t("library.card.duration")}
                      value={archiveDuration(backup.seconds ?? 0)}
                    />
                  </span>
                )}
                <button
                  className="button"
                  disabled={running}
                  onClick={() =>
                    setConfirmation({
                      title: t("settings.backups.restoreConfirmTitle"),
                      text: t("settings.backups.restoreConfirmText", {
                        when: formatMoment(backup.taken_at),
                      }),
                      confirm: t("settings.backups.restoreAction"),
                      destructive: true,
                      action: async () => {
                        setRunning(true);
                        try {
                          await api.restoreBackup(backup.file);
                          // Everything on every screen came from the archive
                          // that was just replaced. Reloading is the honest way
                          // to be sure nothing on screen is from the old one.
                          window.location.reload();
                        } catch (e) {
                          onError(userMessage(e));
                          setRunning(false);
                        }
                      },
                    })
                  }
                >
                  {t("settings.backups.restoreAction")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-section-description">{t("settings.backups.emptyList")}</p>
        )}
        {/* Under the list, not over it. What it says is what happens *after*
            a row is chosen, and it was standing between the reader and the
            dates they came here to look at. */}
        {(status?.count ?? 0) > 0 && <InfoNote>{t("settings.backups.restoreNote")}</InfoNote>}

      </SettingsDisclosure>

      <ConfirmationDialog
        query={confirmation}
        onClose={() => setConfirmation(null)}
        onError={onError}
      />
    </section>
  );
}


function ToolDiagnostics({
  k,
  onInfo,
  onError,
}: {
  k: ToolCheck;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const userMessage = useUserMessage();
  /** Executable names are technical identifiers and stay as they are; the rest
   *  names what the file is for and is looked up. */
  const rows: Array<[string, TranslationKey | null, string | null]> = [
    ["ffmpeg", null, k.ffmpeg],
    ["ffprobe", null, k.ffprobe],
    ["whisper-cli", null, k.whisper_cli],
    ["model_whisper", "settings.diagnostics.modelWhisper", k.model_whisper],
    ["model_vad", "settings.diagnostics.modelVad", k.model_vad],
    ["embedding", "settings.diagnostics.diarizationEmbedding", k.embedding_model],
  ];
  return (
    <SettingsDisclosure title={t("settings.diagnostics.title")} className="card-footer">
      <ul className="check">
        {rows.map(([id, titleKey, path]) => (
          <li key={id} className={path ? "yes" : "no"}>
            {/* The same circular mark the manual download list uses for a
                component that is already on the machine. */}
            <span className="check-mark" aria-hidden>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                {path ? (
                  <path d="M3 7.2 5.7 10 11 4.5" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" />
                )}
              </svg>
            </span>
            <span className="check-name">{titleKey ? t(titleKey) : id}</span>
            {/* The whole path is in the tooltip: the line shows its end, which
                is the part that says which file this actually is. */}
            <span className="check-path" title={path ?? undefined}>
              {path ?? t("settings.diagnostics.notFound")}
            </span>
          </li>
        ))}
      </ul>
      {/* What this list shows plus everything around it — the settings as they
          are stored, the compute that was chosen, the end of the log. The list
          above answers "is it there"; a problem usually needs "and what was it
          doing", which no screenshot of this panel can say. */}
      <div className="diagnostics-actions">
      <button
        className="button"
        onClick={async () => {
          try {
            await copyPlainText(await api.diagnosticReport());
            onInfo(t("settings.diagnostics.copied"));
          } catch (error) {
            onError(
              error instanceof ClipboardRefused
                ? t("settings.diagnostics.copyRefused")
                : t("settings.diagnostics.copyFailed")
            );
          }
        }}
      >
        {t("settings.diagnostics.copy")}
      </button>
        {/* The report holds the last sixty lines. A transcription that ran for
            an hour leaves more than that, and somebody may simply want to read
            it themselves. */}
        <button
          className="button"
          onClick={async () => {
            const file = await api.logFile().catch(() => null);
            if (!file) return onError(t("settings.diagnostics.noLog"));
            void revealItemInDir(file).catch((e) => onError(userMessage(e)));
          }}
        >
          {t("settings.diagnostics.showLog")}
        </button>
      </div>
      <InfoNote>{t("settings.diagnostics.copyNote")}</InfoNote>
    </SettingsDisclosure>
  );
}
