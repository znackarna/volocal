import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { RecordingCalendar } from "./Library";
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

/** Which shared icon stands for which module row. */
const MODULE_ICONS = {
  model: "model",
  compute: "compute",
  speakers: "speakers",
  editor: "editor",
} as const satisfies Record<string, LineIconName>;

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

type ModuleStatus = "complete" | "missing" | "optional";
type SettingsTab =
  | "transcription"
  | "dictionary"
  | "models"
  | "performance"
  | "appearance"
  | "files"
  | "about";

/* What is on the machine and how fast it runs used to share one tab. They are
   two questions — what is installed, and what it should run on — and the tab
   had to be called `Modely a výkon` to admit it. */
const SETTINGS_TABS: SettingsTab[] = [
  "transcription",
  "models",
  "performance",
  "appearance",
  "dictionary",
  "files",
  "about",
];
const SETTINGS_TAB_KEYS: Record<SettingsTab, TranslationKey> = {
  transcription: "settings.tab.transcription",
  dictionary: "settings.tab.dictionary",
  models: "settings.tab.models",
  performance: "settings.tab.performance",
  appearance: "settings.tab.appearance",
  files: "settings.tab.files",
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

const STATUS_BADGES: Record<ModuleStatus, { labelKey: TranslationKey; className: string }> = {
  complete: { labelKey: "settings.modules.status.complete", className: "complete" },
  missing: { labelKey: "settings.modules.status.missing", className: "required" },
  optional: { labelKey: "settings.modules.status.optional", className: "quiet" },
};

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

/** One row of the module overview. */
function ModuleTile({
  icon,
  title,
  value,
  status,
}: {
  icon: LineIconName;
  title: string;
  value: string;
  status: ModuleStatus;
}) {
  const { t } = useI18n();
  const badge = STATUS_BADGES[status];
  return (
    <div className={`module-tile ${status}`}>
      <span className="choice-icon" aria-hidden>
        <LineIcon name={icon} />
      </span>
      <span className="module-description">
        <span className="module-title">{title}</span>
        <span className="module-value">{value}</span>
      </span>
      <em className={`badge ${badge.className}`}>{t(badge.labelKey)}</em>
    </div>
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
      if (typeof selected === "string") save({ ...n, [key]: selected });
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
  const hasDiarization = (check?.issues_diarization ?? []).length === 0;
  const availableEditorChoices = EDITOR_CHOICES.filter((choice) =>
    modules.some((module) => module.id === choice.component && module.complete)
  );
  const hasEditor = availableEditorChoices.length > 0;
  const missingCompute =
    !!n && n.compute !== "auto" && downloadedBackends.length > 0 && !downloadedBackends.includes(n.compute);

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
            {tab === "models" && missingRequired.length > 0 && (
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

      {/* Moduly nepatří do hlavní nabídky — stahují se jednou a pak se k nim
          člověk vrací zřídka. Tady jsou po ruce a nepřekáží. */}
      {activeTab === "models" && <section className="settings-card-modules">
        <h2>{t("settings.modules.title")}</h2>
        <p className="settings-section-description">
          {t("settings.modules.description")}
        </p>
        <div className="module-grid">
          <ModuleTile
            icon={MODULE_ICONS.model}
            title={t("settings.modules.model")}
            value={labels.model(n.model)}
            status="complete"
          />
          <ModuleTile
            icon={MODULE_ICONS.compute}
            title={t("settings.modules.compute")}
            value={check ? labels.compute(check.compute) : "—"}
            status={downloadedBackends.length > 0 ? "complete" : "missing"}
          />
          <ModuleTile
            icon={MODULE_ICONS.editor}
            title={t("settings.modules.editor")}
            value={
              n.editor_model
                ? (() => {
                    const choice = EDITOR_CHOICES.find((c) => c.model === n.editor_model);
                    return choice ? t(choice.titleKey) : n.editor_model;
                  })()
                : hasEditor
                  ? t("settings.modules.editorReady")
                  : t("settings.modules.editorMissing")
            }
            status={hasEditor ? "complete" : "optional"}
          />
          <ModuleTile
            icon={MODULE_ICONS.speakers}
            title={t("settings.modules.speakers")}
            value={
              hasDiarization
                ? n.diarization
                  ? t("settings.modules.speakersOn")
                  : t("settings.modules.speakersReady")
                : t("settings.modules.speakersMissing")
            }
            status={hasDiarization ? "complete" : "optional"}
          />
        </div>

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
        {check && <ToolDiagnostics k={check} onInfo={onInfo} onError={onError} />}
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

      {activeTab === "performance" && <section className="settings-card-performance">
        <h2>{t("settings.performance.title")}</h2>
        <p className="settings-section-description">
          {t("settings.performance.description")}
        </p>

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

        <div className="field">
          <label>
            {t("settings.performance.threads")} <em className="value">
              {n.threads === 0
                ? t("settings.performance.threadsAuto")
                : formatNumber(n.threads)}
            </em>
          </label>
          <input
            type="number"
            min={0}
            max={64}
            value={n.threads}
            onChange={(event) => save({ ...n, threads: Number(event.target.value) })}
          />
          <InfoNote>{t("settings.performance.threadsNote")}</InfoNote>
        </div>

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
      </section>}

      {activeTab === "models" && <section className="settings-card-locations">
        <h2>{t("settings.files.locations")}</h2>
        <p className="settings-section-description">
          {t(check?.portable
            ? "settings.files.locationsPortable"
            : "settings.files.locationsDescription")}
        </p>

        <div className="field">
          <label>{t("settings.files.binDirectory")}</label>
          <div className="input-row">
            <input
              value={n.bin_directory}
              onChange={(e) => setN({ ...n, bin_directory: e.target.value })}
              onBlur={() => save(n)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
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
              onChange={(e) => setN({ ...n, models_directory: e.target.value })}
              onBlur={() => save(n)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <button className="button" onClick={() => selectDirectory("models_directory")}>
              {t("settings.files.choose")}
            </button>
          </div>
        </div>

      </section>}

      {activeTab === "dictionary" && <section className="settings-card-dictionary">
        <h2>{t("settings.tab.dictionary")}</h2>
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
        <h2>{t("settings.tab.appearance")}</h2>
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

        <div className="field">
          <label>
            {t("settings.appearance.lineHeight")} <em className="value">
              {formatNumber(n.transcript_line_height, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </em>
          </label>
          <input
            type="range"
            min={1.3}
            max={2.2}
            step={0.02}
            value={n.transcript_line_height}
            onChange={(e) => save({ ...n, transcript_line_height: Number(e.target.value) })}
          />
        </div>

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
          {/* Karty místo rozbalovací nabídky: modely se od sebe liší tím,
              co dělají s časem a přesností, a to se v jednom řádku neřekne. */}
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
          <InfoNote>{t("settings.transcription.beamNote")}</InfoNote>
        </div>
      </section>}

      {/* What is in the recording, rather than what reads it (Jakub's ask):
          which language is spoken, and what counts as speech at all. The fine
          tuning follows the speech-detection switch, so it belongs in the same
          card — it is the same subject at a finer grain, and with the switch
          off it is not shown at all. */}
      {activeTab === "transcription" && <section className="settings-card-speech">
        <h2>{t("settings.speech.title")}</h2>
        <p className="settings-section-description">{t("settings.speech.description")}</p>

        <div className="field">
          <label>{t("settings.transcription.language")}</label>
          <Select
            value={n.language}
            onChange={(j) => save({ ...n, language: j })}
            items={labels.languageOptions()}
          />
          <InfoNote>{t("settings.transcription.languageNote")}</InfoNote>
        </div>

        <SettingsToggle
          title={t("settings.transcription.vad")}
          label={t("settings.transcription.vad")}
          checked={n.vad}
          onChange={(checked) => save({ ...n, vad: checked })}
          description={t("settings.transcription.vadNote")}
        />

        {n.vad && <DecodingSettings n={n} save={save} />}
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
            {n.watch_folder && (
              <button
                className="button quiet"
                onClick={() => save({ ...n, watch_folder: "", watch_folder_enabled: false })}
              >
                {t("settings.files.watchRemove")}
              </button>
            )}
          </div>
        </div>

        <SettingsToggle
          title={t("settings.files.watchToggle")}
          label={t("settings.files.watchToggle")}
          checked={n.watch_folder_enabled}
          disabled={!n.watch_folder}
          onChange={(checked) => save({ ...n, watch_folder_enabled: checked })}
          description={t("settings.files.watchToggleNote")}
        />

        {/* Only once the folder is being watched: what to do with what it
            finds is not a question until it finds anything. */}
        {n.watch_folder_enabled && (
          <SettingsToggle
            title={t("settings.files.watchAuto")}
            label={t("settings.files.watchAuto")}
            checked={n.watch_folder_auto}
            onChange={(checked) => save({ ...n, watch_folder_auto: checked })}
            description={t("settings.files.watchAutoNote")}
          />
        )}
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

        {n.diarization && (
          <div className="field">
            <label>{t("settings.speakers.count")}</label>
            <input
              type="number"
              min={0}
              max={12}
              value={n.speaker_count}
              onChange={(e) => save({ ...n, speaker_count: Number(e.target.value) })}
            />
            <InfoNote>{t("settings.speakers.countNote")}</InfoNote>
          </div>
        )}

        {n.diarization && (
          <div className="field">
            <label>{t("settings.speakers.shift")}</label>
            <Select
              value={String(n.segmentation_window_shift)}
              onChange={(v) => save({ ...n, segmentation_window_shift: Number(v) })}
              items={[
                {
                  value: "0.4",
                  label: t("settings.speakers.shiftFast"),
                  note: t("settings.speakers.shiftFastNote"),
                },
                { value: "0.2", label: t("settings.speakers.shiftBalanced") },
                {
                  value: "0.1",
                  label: t("settings.speakers.shiftDetailed"),
                  note: t("settings.speakers.shiftDetailedNote"),
                },
              ]}
            />
            <InfoNote>{t("settings.speakers.shiftNote")}</InfoNote>
          </div>
        )}

        {check && check.issues_diarization.length > 0 && n.diarization && (
          <ul className="problems">
            {check.issues_diarization.map((p, i) => (
              <li key={i}>{userMessage(p)}</li>
            ))}
          </ul>
        )}
      </section>}

      {activeTab === "appearance" && <QuickTips />}

      {activeTab === "files" && <Backups onError={onError} />}

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

      {activeTab === "about" && (
        <About
          onError={onError}
          onInfo={onInfo}
          automaticUpdates={n.update_check_automatic}
          onAutomaticUpdatesChange={(on) => save({ ...n, update_check_automatic: on })}
        />
      )}

      </div>
    </main>
  );
}

/**
 * What the application is, what it does, and what it is made of.
 *
 * Jakub asked for the three things this answers: which technologies it stands
 * on, under what licences, and what the application can actually do. Nothing
 * here is a setting — it is the one page that exists to be read.
 */
function About({
  onError,
  onInfo,
  automaticUpdates,
  onAutomaticUpdatesChange,
}: {
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  automaticUpdates: boolean;
  onAutomaticUpdatesChange: (on: boolean) => void;
}) {
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

        <UpdateCheck
          onError={onError}
          onInfo={onInfo}
          automatic={automaticUpdates}
          onAutomaticChange={onAutomaticUpdatesChange}
        />
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
 * The strip of shortcuts under the player on the transcript screen.
 *
 * It can be dismissed there, and this is where it comes back from — otherwise
 * closing it once would be final and nobody would guess where to look.
 */
function QuickTips() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(
    () => localStorage.getItem("rychle-tipy") !== "skryte"
  );

  const set = useCallback((wanted: boolean) => {
    localStorage.setItem("rychle-tipy", wanted ? "viditelne" : "skryte");
    setVisible(wanted);
  }, []);

  return (
    <section className="settings-card-quick-tips">
      <SettingsToggle
        title={t("settings.tips.title")}
        label={t("settings.tips.toggle")}
        checked={visible}
        heading
        onChange={set}
        description={t("settings.tips.description")}
      />
    </section>
  );
}

/**
 * Backups of the archive.
 *
 * The whole archive is one SQLite file. It is worth saying out loud where the
 * copies are, because the moment anyone needs them is the moment they will not
 * feel like hunting for a folder.
 */
function Backups({ onError }: { onError: (message: string) => void }) {
  const { t, formatNumber, formatDate } = useI18n();
  const { dataSize } = useFormats();
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
  const [list, setList] = useState<
    { file: string; taken_at: string; size: number }[] | null
  >(null);

  const refresh = useCallback(() => {
    api.backupStatus().then(setStatus).catch(() => setStatus(null));
    setList(null);
  }, []);

  useEffect(refresh, [refresh]);

  const backUpNow = useCallback(async () => {
    setRunning(true);
    try {
      await api.backUpNow();
      refresh();
    } catch (e) {
      onError(userMessage(e));
    } finally {
      setRunning(false);
    }
  }, [onError, refresh, userMessage]);

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

      <div className="settings-action-row spaced">
        <InfoNote compact>{t("settings.backups.note")}</InfoNote>
        <button className="button" onClick={backUpNow} disabled={running}>
          {running ? t("settings.backups.running") : t("settings.backups.action")}
        </button>
      </div>

      {/* Last band of the card, folded away. Putting a backup back is the
          rarest thing on this screen and the only one that replaces what is
          there — it belongs under everything that is not, rather than between
          the summary and the button that merely makes another copy. */}
      {(status?.count ?? 0) > 0 && (
        <SettingsDisclosure
          title={t("settings.backups.restoreTitle")}
          className="card-footer"
          onOpen={() => {
            if (list === null) api.backups().then(setList).catch(() => setList([]));
          }}
        >
          <ul className="backup-list">
            {(list ?? []).map((backup) => (
              <li key={backup.file}>
                {/* The same torn-off leaf the archive puts on a recording. A
                    backup is chosen by its day first and its hour second, and
                    the day is what the eye finds without reading. */}
                <RecordingCalendar value={backup.taken_at} />
                <span className="backup-when">
                  {formatTime(backup.taken_at)}
                </span>
                {/* dataSize speaks in megabytes; the file system speaks in
                    bytes. Passed straight through, a 1.4 MB archive announced
                    itself as 1 420 GB. */}
                <span className="backup-size">{dataSize(backup.size / (1024 * 1024))}</span>
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
          {/* Under the list, not over it. What it says is what happens *after*
              a row is chosen, and it was standing between the reader and the
              dates they came here to look at. */}
          <InfoNote>{t("settings.backups.restoreNote")}</InfoNote>
        </SettingsDisclosure>
      )}

      <ConfirmationDialog
        query={confirmation}
        onClose={() => setConfirmation(null)}
        onError={onError}
      />
    </section>
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
  const { t, formatNumber } = useI18n();

  const isCustom = (Object.keys(DEFAULT_DECODING) as Array<
    keyof typeof DEFAULT_DECODING
  >).some((k) => n[k] !== DEFAULT_DECODING[k]);

  const fields: Array<{
    key: keyof typeof DEFAULT_DECODING;
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

  return (
    <SettingsDisclosure
      title={t("settings.decoding.title")}
      badge={
        isCustom ? (
          <span className="badge quiet">{t("settings.decoding.modified")}</span>
        ) : undefined
      }
    >
          <p className="small-text">{t("settings.decoding.note")}</p>

          {fields.map((p) => (
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

          <button
            className="button"
            disabled={!isCustom}
            onClick={() => save({ ...n, ...DEFAULT_DECODING })}
          >
            {t("settings.decoding.reset")}
          </button>
    </SettingsDisclosure>
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
    ["diarization", "settings.diagnostics.diarizationProgram", k.sherpa_diarization],
    ["segmentation", "settings.diagnostics.diarizationSegmentation", k.segmentation_model],
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
