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
import { LineIcon, ModelMark, type LineIconName } from "./icons";
import { ClipboardRefused, copyPlainText } from "./detail/clipboard";
import Select from "./Select";
import { useI18n, type AppLanguage } from "./i18n";
import { useUserMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import {
  EDITOR_MODELS,
  EDITOR_TIER,
  FONTS,
  MODEL_IDS,
  UNOFFERED_COMPONENTS,
  applyFonts,
  applyTheme,
  qualityChoice,
} from "./types";
import { useFormats } from "./formats";
import { useLabels } from "./labels";
import { SettingsToggle } from "./settings/toggle";
import { UpdateCheck } from "./settings/updates";
import type {
  ToolCheck,
  Settings,
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

/* `EDITOR_CHOICES` stood here: three cards, `Úsporná`, `Doporučená`,
   `Nejvyšší kvalita`, each with a sentence about what it does better. Two
   things were wrong with it, and both were settled on 14 August 2026.

   There is no chooser because there is one question in the whole application:
   *volba v průvodci bude jednoduchá, rychle nebo přesně; zbytek se zvolí podle
   toho, to samé jazyková úprava*. Two models rather than three, and which one
   follows the answer already given — `EDITOR_TIER` in `types.ts`. A picker on
   this screen would be a second place deciding one thing, free to disagree with
   the first, so there is none: the card names the model and asks only whether
   the reader wants the feature.

   The sentences were the other thing, and they are not coming back. There is no
   comparison of these models' output anywhere in `docs/history/` — the only
   inference ever recorded was run with the 12B model alone, because it was the
   only one installed — and the entry that gave the three cards their counted
   sparkles states outright that they "trade nothing; they do the same work with
   more of it". `Lépe opravuje zjevné chyby` and `Nejspolehlivější` were
   therefore the same kind of claim as the middle transcription model's *asi
   jedna chyba na odstavec*, deleted on 13 August for being measured nowhere.
   Nothing is claimed about what comes out. The names, which come from the
   catalogue so the by-hand list says the same words, name what a file's size
   does decide: memory and time.

   `EditorMark`, the sparkle counted out one to three, went with the cards: a
   mark that says "more of the same" is right only where there are three things
   to tell apart, and it would be a quality claim by a different means. */

/** How each language-editing model is drawn and named on its card.
 *
 *  One square at three sizes: size is the only thing known about the difference
 *  between these models, so it is the only thing the drawing says — see the
 *  comment on the three glyphs in `icons.tsx`. The middle one is here for the
 *  machines that hold it; nothing fetches it, and a model the screen names has
 *  to have a mark like its neighbours or the mark starts to look like a rank.
 *
 *  The names are one word each and are **not** the catalogue's. Under a heading
 *  reading `Jazyková úprava` the noun is supplied and `Menší` is right; in
 *  `Stahuji {name}` and in the by-hand list the name stands alone and has to
 *  say what the thing is, which is why the catalogue calls the same component
 *  `Menší model jazykové úpravy`. Two jobs, two strings. The sentence under each
 *  card is still the catalogue's, because that one reads correctly in both. */
const EDITOR_CARDS: Record<string, { icon: LineIconName; title: TranslationKey }> = {
  "editor-model-best": { icon: "sizeLarge", title: "settings.editor.modelLarge" },
  "editor-model-balanced": { icon: "sizeMedium", title: "settings.editor.modelMiddle" },
  "editor-model-light": { icon: "sizeSmall", title: "settings.editor.modelSmall" },
};

/* `COMPUTE_CHOICES` stood here — four cards, one per whisper.cpp build, and
   two of them were CUDA and Vulkan. Those are not a question anybody should be
   asked: they are two builds of the same thing for two kinds of graphics card,
   and which suits the card in this machine is a fact about its drivers.
   Choosing wrong was not merely useless, it was quiet — a stored `cuda` beside
   an AMD card ran a build that found no device and transcribed on the
   processor, while the screen went on saying `používá se` about the card.

   What is left is the question the reader can answer: the processor, the card,
   or neither — automatic, which takes the fastest build this machine can run
   and is what a fresh installation has. Three positions of one value, so a
   segmented control rather than three framed cards. */
const COMPUTE_CHOICES = [
  { value: "gpu", icon: "graphicsCard", title: "settings.compute.modeGpu",
    note: "settings.compute.modeGpuNote" },
  { value: "cpu", icon: "compute", title: "settings.compute.modeCpu",
    note: "settings.compute.modeCpuNote" },
] as const satisfies ReadonlyArray<{
  value: string;
  icon: LineIconName;
  title: TranslationKey;
  note: TranslationKey;
}>;

/** Which of them a stored value stands for, or none of them.
 *
 *  None is automatic, and automatic is the resting state: a fresh installation
 *  has it, and it is where `Automaticky` puts a machine back. It is not a third
 *  card, because it is not a third place for the work to happen — it is the
 *  absence of a decision, and the panel under the cards says what the drivers
 *  made of it.
 *
 *  Settings written before 14 August 2026 name a build — `cuda` or `vulkan` —
 *  and both are the reader having asked for the graphics card, which is what
 *  this screen now calls that. They are left in the settings record rather than
 *  rewritten on sight: `choose_compute` honours them where the machine can run
 *  them, and a screen that quietly edited a stored value while merely being
 *  looked at would be a worse habit than a two-word translation here. The first
 *  press of either card replaces them with the new vocabulary.
 *
 *  Anything else — an empty value, a name from some future build — is
 *  automatic, which is what `choose_compute` also does with it. */
function computeMode(stored: string): "auto" | "gpu" | "cpu" {
  if (stored === "cpu") return "cpu";
  return stored === "gpu" || stored === "cuda" || stored === "vulkan" ? "gpu" : "auto";
}

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
 *  where the block is drawn.
 *
 *  `compute` is not here, and now has a control again — on `Nástroje`, beside
 *  the line that says what actually ran. It stays out because `Zpět na výchozí`
 *  restores what this block shows: a badge reading `upraveno` about a control
 *  on another tab, and a button that quietly moved it, would be a reset nobody
 *  watching it could see. Automatic is one press away where the control is. */
const ADVANCED_DEFAULTS = {
  beam: 5,
  threshold_silence: 0.6,
  threshold_confidence: -1,
  entropy_threshold: 2.6,
  temperature: 0,
  temperature_increment: 0.2,
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

/* Six tabs, each one a subject somebody arrives with: what comes out of a
   recording, how the application looks, what is installed on this machine,
   where its files are kept, staying on the current version, and what the
   application is.

   There were seven, and for one day there were three — `Přepis`, `Aplikace`
   and `O aplikaci`. Jakub looked at those three and said they do not help:
   appearance is a subject of its own, `O aplikaci` is `Informace`, and updating
   is something you do rather than something you read about the application. So
   `Vzhled` and `Aktualizace` stand on their own again.

   `Nástroje` is the sixth, and it is his call too: *Modely bych dal jako
   Nástroje, zvlášt záložku*. What is installed on this machine, where it lives
   and which files were found is one subject, and it was spread across the foot
   of `Přepis` and the inside of `Pokročilé` — where a reader who wants to know
   whether anything is missing would have to open a block titled *advanced* to
   find out. It is not the old `Modely` tab coming back: that one carried four
   read-only tiles repeating values chosen elsewhere, and those stay deleted.

   The rest of what the reduction took out stays out too. `Výkon`, `Slovník` and
   `Soubory` were the shape of the code rather than subjects a reader arrives
   with, and the controls deleted with them were dead, harmful or derivable from
   another one. This is only about how the remaining ones are grouped.

   `Aplikace` is now `Složky a zálohy`. Once appearance left it, what was under
   that name was the recordings folder, the watched folder and the archive's
   copies — and none of them is what a reader would look for behind the word
   `Aplikace`. */
type SettingsTab =
  | "transcription"
  | "appearance"
  | "tools"
  | "files"
  | "updates"
  | "about";

/* Reading order, and `updates` is last on purpose. It is the rarest thing
   anybody opens Settings for — pressed a handful of times a year — and it had
   been sitting between the archive's copies and the page about the
   application, where its width of visibility did not match how often it is
   wanted. Last is where a thing goes when it must be findable and is not
   looked for. */
const SETTINGS_TABS: SettingsTab[] = [
  "transcription",
  "appearance",
  "tools",
  "files",
  "about",
  "updates",
];
/** `appearance` is named by the one card that fills its tab rather than by a
 *  key of its own: a second key holding the same word is a second thing to keep
 *  in step, and the transcription card already borrows its tab's key in the
 *  other direction. */
const SETTINGS_TAB_KEYS: Record<SettingsTab, TranslationKey> = {
  transcription: "settings.tab.transcription",
  appearance: "settings.appearance.title",
  tools: "settings.tab.tools",
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

/* `ModelMark` stood here and is in `src/icons.tsx` now, unchanged. The wizard's
   two quality cards draw the same two models this screen lists, and the same
   model must not wear one drawing on the first screen and another on the
   fifth — so the drawing lives where the shared icons live. */

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
  const { language, setLanguage, t, tDynamic, tPlural, formatNumber } = useI18n();
  const userMessage = useUserMessage();
  const [n, setN] = useState<Settings | null>(null);
  const [check, setCheck] = useState<ToolCheck | null>(null);
  const [modules, setModules] = useState<DownloadComponent[]>([]);
  const [saved, setSaved] = useState(false);
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
  const installed = (id: string) => modules.some((module) => module.id === id && module.complete);
  const megabytes = (id: string) => modules.find((module) => module.id === id)?.megabytes ?? 0;

  /* ------------------------------------------------------ language editing
     Two cards, and the runtime that runs whichever is chosen. That runtime is
     not a choice: it follows the drivers, the same way `tools.rs` looks for
     `llama-cli`, so it is folded into the size a card shows rather than being a
     row of its own. */
  const editorRuntime = check?.vulkan_driver ? "editor-vulkan" : "editor-cpu";
  /** What the wizard's one question implies. It is the default and it is badged
   *  as such — not the answer. A card pressed here is stored in `editor_model`
   *  and wins over it, exactly as the transcription model chosen a card above
   *  wins over the one the wizard downloaded. */
  const editorTier = EDITOR_TIER[qualityChoice(n)];
  /** The cards in `EDITOR_MODELS`' order, which is **largest first** — see the
   *  comment there, and do not sort them the other way because a pair listed by
   *  size looks like it wants to be. The sentence under each comes out of the
   *  catalogue, so the by-hand list uses the same words and there is one place
   *  to change them. The middle model appears only where it is already on the
   *  disk: a machine set up before 14 August 2026 may be running on it, and a
   *  card it is not drawn on could not say so. */
  const editorCards = Object.keys(EDITOR_MODELS)
    .map((id) => modules.find((module) => module.id === id))
    .filter((module): module is DownloadComponent => !!module)
    .filter((module) => module.complete || !UNOFFERED_COMPONENTS.includes(module.id))
    .map((module) => {
      const needs = [module.id, editorRuntime].filter((id) => !installed(id));
      return {
        ...module,
        needs,
        needsMb: needs.reduce((total, id) => total + megabytes(id), 0),
      };
    });
  /** Which card is chosen. One of them always is: an explicit pick if there has
   *  been one, and the tier the wizard's answer implies until then.
   *
   *  `editor_model` is empty on a machine where nobody has ever asked for a
   *  document, and that means *nothing downloaded yet* — not *the reader
   *  declined*. Nothing anywhere reads it as a refusal: `Detail.tsx` offers the
   *  download when it is empty, and `tools.rs` simply resolves no model and
   *  reports no fault. So an empty value can be drawn as the default card
   *  without claiming the reader chose it. */
  const editorChosen =
    Object.keys(EDITOR_MODELS).find((id) => EDITOR_MODELS[id] === n.editor_model) ?? editorTier;

  /** Choosing a model: fetch whatever it still needs, and record the choice.
   *
   *  The download runs in the background — `download` in `downloads.rs` returns
   *  as soon as the thread is started — so the reader stays on this screen and
   *  the application's own progress bubble reports it, with a way to stop. The
   *  setting is written straight away rather than when the file lands: it says
   *  what was asked for, `resolve_editor_model` in `tools.rs` falls back to any
   *  model that is actually there, and a listener that had to survive the
   *  reader walking to another screen would not. */
  const chooseEditor = async (id: string, needs: string[]) => {
    try {
      if (needs.length > 0) await api.download(needs);
      await save({ ...n, editor_model: EDITOR_MODELS[id] });
      setModules(await api.catalog());
    } catch (e) {
      onError(userMessage(e));
    }
  };

  /* --------------------------------------------------------- where it runs
     `check.compute` is what `choose_compute` answered, which is the folder the
     next transcription's `whisper-cli` comes out of — not what is stored. The
     two differ exactly when the stored choice cannot be honoured here, and
     saying that out loud is what this card is for. */
  const computeRunning = check?.compute ?? "";
  const onGraphicsCard = computeRunning === "cuda" || computeRunning === "vulkan";
  const hasGraphicsDriver = !!(check?.nvidia_driver || check?.vulkan_driver);
  const computeChoice = computeMode(n.compute);
  const graphicsCardBackend = check?.nvidia_driver ? "cuda" : "vulkan";
  /** Whether what was asked for is what ran. `auto` asks for nothing in
   *  particular and is always honoured; the other two are not, and that is the
   *  one state on this card worth a sentence. `vychozi` — a flat installation
   *  with one build and no subfolders — counts as the processor, which is what
   *  a build nobody chose a backend for is. */
  const computeHonoured =
    computeChoice === "auto" || (computeChoice === "gpu" ? onGraphicsCard : !onGraphicsCard);
  /** Something was picked and is not what ran. The chosen card goes red for it —
   *  the one case where the card has to contradict the choice drawn on it — and
   *  the sentence under the cards carries the reason. */
  const computeRefused = computeChoice !== "auto" && !computeHonoured;
  /** Which card is highlighted. With the switch on nothing was picked, so it is
   *  what the drivers settled on — the switch's effect made visible, which is
   *  the reason the cards stay on screen while it is on. With the switch off it
   *  is the pick, honoured or not. */
  const computeShown = computeChoice === "auto" ? (onGraphicsCard ? "gpu" : "cpu") : computeChoice;
  /** The build for the graphics card was never downloaded, with a driver that
   *  could have run it. The one reason for a card standing idle that the reader
   *  can fix from here, so wherever it is said the row carries a button. */
  const graphicsCardMissing =
    hasGraphicsDriver &&
    !onGraphicsCard &&
    !!computeRunning &&
    !(check?.available_compute_backends ?? []).includes(graphicsCardBackend);

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
            {/* The dot follows the status band, which stands on `Nástroje`
                since that is where what is installed is now read. */}
            {tab === "tools" && missingRequired.length > 0 && (
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

          The band itself is unchanged; what changed is which tab draws it. It
          stood at the foot of `Přepis`, one card away from the model chooser it
          feeds — but whether anything is missing is a fact about this machine,
          not about how a transcript is made, and it is what `Nástroje` is for.
          It is still a band and not the old tab: those four read-only tiles are
          not coming back. The button opens the by-hand component list directly
          (the wizard does that itself when it is opened neither as required nor
          for one named module). */}
      {activeTab === "tools" && <section className="settings-card-modules">
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

        {/* Which file was found where, folded at the foot of the card that says
            whether they are there at all. It was the last band of `Pokročilé`,
            where somebody whose transcription will not start had to open a
            block titled *advanced* to see what the application can see.

            The same shape as the archive card: a `spaced` action row and then
            one `card-footer` disclosure, which is the pair those two rules were
            written for — the row gives up its own divider so this is the card's
            single rule. */}
        {check && <ToolDiagnostics k={check} onInfo={onInfo} onError={onError} />}
      </section>}

      {/* Where the transcription computes — the choice, and then what actually
          ran because of it.

          The owner asked for the switch back after seeing the version without
          one: `Kde přepis běží a tam bych dal CPU a GPU možnost přepnutí. Ale
          automaticky by to vždycky volilo tu rychlejší variantu.` So there are
          three positions and not four: the processor, the card, and automatic
          — which is the resting state, what a fresh installation has, and what
          takes the fastest build this machine can run.

          CUDA versus Vulkan is not among them, and that is the point of the
          shape. Those are two builds of the same thing for two kinds of card;
          which one suits the card in this machine is read off the drivers in
          `choose_compute`, and the old four-way control is exactly how somebody
          came to have `cuda` stored beside an AMD card — the CUDA build found
          no device, whisper fell back to the processor, and the screen went on
          saying it ran on the graphics card.

          The same cards as the transcription model two tabs over, and the
          owner asked for them in those words — *dej tam stejnou kartu jako má
          výběr modelu u přepisu, ne tu trapnou záložku*. Two of them, because
          there are two places the work can happen.

          Automatic is not a third card and is not a button either — *tu volbu
          automaticky bych nedělal tlačítkem, ale toggle*, and that is the right
          shape: a button says *do this now*, a switch says *this is how it is*,
          and following the drivers is a state rather than an errand. It is on
          by default and after a reset, because that is the resting state. It
          sits **under** the two cards — *ten toggle dej pod ty karty* — where it
          reads as a qualifier on them: these two, and let the application decide
          which.

          **The cards stay visible and pickable while it is on**, showing which
          one the drivers settled on. Hiding them would make the switch's effect
          a mystery, and somebody who only wants to know where their transcript
          runs would have to flip a switch to find out. Pressing one is the most
          direct reading of what pressing one means: the switch goes off and
          that card is taken. Turning the switch off by hand keeps whatever was
          already running, so nothing jumps.

          `check.compute` is `choose_compute`'s answer and `n.compute` is what
          was asked for; where they differ, one sentence says why and, when the
          reason is a build that is not downloaded, offers it. */}
      {activeTab === "tools" && check && <section className="settings-card-compute">
        <h2>{t("settings.compute.title")}</h2>
        <p className="settings-section-description">{t("settings.compute.description")}</p>

        {/* No `používá se` on the highlighted card. A card drawn as chosen
            already says it is the one, and two marks for one fact is noise. The
            model cards on `Přepis` lost the same badge for the same reason.

            What the badge was carrying has to stay, though, and it is the
            opposite case: `choose_compute` substitutes another backend when the
            chosen one cannot be used, and this card exists because that used to
            be silent. So the card is quiet when it agrees and speaks when it
            does not — the card wears `missing`, the danger colour the module
            tiles use, and the sentence below gives the reason and the way out.
            An empty state here is correct; do not fill it.

            While the switch is on, what is highlighted is what ran rather than
            what was picked, because nothing was picked. That is also why the
            red state cannot occur there: with nobody's instruction to
            contradict, `choose_compute`'s answer is simply the answer. */}
        <div className="choices">
          {COMPUTE_CHOICES.map((choice) => {
            const shown = computeShown === choice.value;
            return (
              <button
                key={choice.value}
                className={`choice with-icon ${shown ? "chosen" : ""} ${
                  shown && computeRefused ? "missing" : ""
                }`}
                aria-pressed={shown}
                onClick={() => save({ ...n, compute: choice.value })}
              >
                <span className="choice-icon" aria-hidden>
                  <LineIcon name={choice.icon} />
                </span>
                <span className="choice-body">
                  <span className="choice-title">{t(choice.title)}</span>
                  <span className="small-text">{t(choice.note)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* The switch reads as a qualifier on what is above it — *and let the
            application decide which* — which is exactly what it does, so it
            stands under the cards rather than over them. It also settles what
            the cards do while it is on: they stay, because somebody can then
            see where their transcript runs without touching anything.

            The sentence about the application choosing lives on the control
            that does the choosing, so it is only ever on screen while it is
            true. It stood under the cards in every state before this — under a
            card somebody had deliberately picked it was simply wrong, and the
            owner struck it out.

            The plain row and not `heading` — *to automaticky nedávej jako
            nadpis ale dej to jako text před ten toggle*. `heading` renders an
            `<h2>` and makes the row a section switch, which would give this card
            a second heading below its own and claim everything under it as a new
            section. Same shape as `Přepisovat nové soubory automaticky` and
            `Kopírovat přidané soubory`: a 15/680 title with the switch opposite
            it and its sentence underneath. */}
        <SettingsToggle
          title={t("settings.compute.letItDecide")}
          label={t("settings.compute.letItDecide")}
          checked={computeChoice === "auto"}
          description={t("settings.compute.autoNote")}
          /* Off has to leave something sensible chosen, and the only sensible
             thing is what the machine is already doing. Jumping to the other
             card, or to an empty state, would make this a switch that changes
             where the work runs — and it does not; it changes who decides. */
          onChange={(automatic) =>
            save({ ...n, compute: automatic ? "auto" : onGraphicsCard ? "gpu" : "cpu" })
          }
        />

        {/* Under the switch, and only where there is something to say. A
            `Používá se — Procesor (CPU)` row stood here below a sentence about
            the application choosing, under a card already drawn as chosen:
            three statements of one fact, and the owner struck two of them out.

            Picked and running where it was asked to is therefore silent — the
            highlighted card is the whole answer, and the way back is the switch
            above rather than a button repeating it. `Vybraná varianta platí i
            tam, kde by aplikace zvolila jinak` was that button's sentence and
            went with it: a switch that is visibly off already says nobody is
            choosing over the reader. */}
        {computeRefused ? (
          /* The one case worth ink: the application is contradicting an
             instruction. `choose_compute` substitutes in silence by design,
             because a transcription must run, and this is the one place it is
             said out loud — what ran, and why the pick could not be met. A
             missing build is offered; a missing driver is not something a
             download fixes, and that sentence carries no button. */
          <div className="settings-action-row spaced">
            <InfoNote compact>
              {t(
                computeChoice === "cpu"
                  ? "settings.compute.processorRefused"
                  : hasGraphicsDriver
                    ? "settings.compute.graphicsCardRefused"
                    : "settings.compute.noGraphicsCard"
              )}
            </InfoNote>
            {(computeChoice === "cpu" || hasGraphicsDriver) && (
              <button
                className="button"
                onClick={() =>
                  onToModule(
                    computeChoice === "cpu"
                      ? COMPUTE_MODULES.cpu
                      : COMPUTE_MODULES[graphicsCardBackend]
                  )
                }
              >
                {t("common.download")}
              </button>
            )}
          </div>
        ) : computeChoice === "auto" && !hasGraphicsDriver ? (
          /* Nothing is wrong here and nothing was refused; it is a fact about
             the machine, and the only reason to say it is that the graphics
             card is one of two cards on the screen. */
          <InfoNote compact>{t("settings.compute.noGraphicsCard")}</InfoNote>
        ) : computeChoice === "auto" && graphicsCardMissing ? (
          /* A card sitting idle with nobody having picked anything means its
             build was never downloaded — which the reader can fix from here. */
          <div className="settings-action-row spaced">
            <InfoNote compact>{t("settings.compute.graphicsCardIdle")}</InfoNote>
            <button
              className="button"
              onClick={() => onToModule(COMPUTE_MODULES[graphicsCardBackend])}
            >
              {t("common.download")}
            </button>
          </div>
        ) : null}
      </section>}

      {/* Two cards, `Větší` and `Menší` in that order, one of them always
          chosen — the same shape as the transcription model at the top of this
          tab, and asked for in those words. Largest first is deliberate and is
          the model cards' own order, where `Přesný` stands above `Rychlý`: two
          columns of cards on one tab that read the same way down the screen.

          **There is no off state, and there is nothing to switch off.**
          Language editing never runs by itself: it happens when somebody asks a
          transcript for a document, and nothing is downloaded until they do. A
          switch here would turn off something that only ever happens on
          request. The question these cards answer is a different one — which
          model gets used when the reader does ask — and that is a setting.
          `Nepoužívat` stood here for one round and was removed for exactly this
          reason; do not put it back.

          The wizard asks once, `rychle` or `přesně`, and that answer chooses
          the card until somebody chooses otherwise. A card pressed here is
          stored in `editor_model` and **wins** over the tier `quality_choice`
          implies, and nothing writes over it afterwards — Settings is where a
          decision is revisited, not where the question is asked a second time.
          The inferred tier is read in one other place, the offer `Detail.tsx`
          makes when nothing has been chosen at all, and it looks at the stored
          value first for the same reason.

          Neither card claims to be better. Nothing in `docs/history/` compares
          these models' output, so they are named by the two things a file's
          size does decide — memory and time — and marked with one square drawn
          at two sizes. The words come from the catalogue, so the by-hand list
          says the same ones. */}
      {activeTab === "transcription" && <section className="settings-card-language-edit">
        <h2>{t("settings.editor.title")}</h2>
        <p className="settings-section-description">{t("settings.editor.description")}</p>

        <div className="choices">
          {editorCards.map((card) => (
            <button
              key={card.id}
              className={`choice with-icon ${card.id === editorChosen ? "chosen" : ""}`}
              aria-pressed={card.id === editorChosen}
              onClick={() => void chooseEditor(card.id, card.needs)}
            >
              <span className="choice-icon" aria-hidden>
                <LineIcon name={EDITOR_CARDS[card.id].icon} />
              </span>
              <span className="choice-body">
                <span className="choice-title">{t(EDITOR_CARDS[card.id].title)}</span>
                <span className="small-text">{tDynamic(card.description_code, "")}</span>
              </span>
              {/* One slot, two states: a size means pressing this card starts a
                  download of that many gigabytes — the model, and the runtime
                  too where that is not there yet. */}
              <span className="choice-size">
                {card.needs.length === 0
                  ? t("wizard.download.downloadedBadge")
                  : formats.dataSize(card.needsMb)}
              </span>
            </button>
          ))}
        </div>

        {/* Why nothing has happened yet, and why that is not a fault. It was a
            red `field-prompt` reading *not downloaded yet*, which is a colour
            that says something is wrong about work nobody has asked for. */}
        <InfoNote compact>{t("settings.editor.note")}</InfoNote>
      </section>}

      {/* How a transcript is made when the ordinary controls have not given a
          good enough one: the beam width, the five thresholds Whisper decides a
          segment by, and where the work runs. One disclosure, one badge saying
          whether any of it has been moved, and one way back — rather than a
          badge and a reset per group, which is how a reader ends up not knowing
          what state the machine is in.

          What is left here is decoding, and that is the whole of it. The two
          folders and `Technické podrobnosti` are on `Nástroje`, because neither
          is about how a transcript is made — they are about what is installed
          and where. `Změřit rychlost` is gone with nothing to measure for, and
          `Akcelerace zpracování` moved rather than died: it is the processor /
          graphics-card switch on `Nástroje`, beside the line saying which build
          actually ran, and it no longer asks CUDA against Vulkan.

          The block keeps its name even so. `Pokročilé` is still what it is, and
          renaming it to `Dekódování` would put a word from whisper.cpp's manual
          on a screen that does not use one anywhere else.

          `Zpět na výchozí` covers every value inside the block, which is every
          value in `ADVANCED_DEFAULTS` with nothing left over. It never covered
          the folders — a folder is a place, not a setting — and it does not
          cover `compute`, whose control is on another tab: a reset that moved
          something nobody watching it could see would be worse than no reset. */}
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

        {/* `Vlákna procesoru` stood here and is gone. Zero — the default and
            what almost every installation carried — already means
            `available_parallelism`, and every measured value above it was
            slower, because whisper.cpp is memory-bound long before it runs out
            of cores. A number that can only make things worse is not a setting.

            `Akcelerace zpracování` stood here too, four choice cards deciding
            where the work runs, and `Změřit rychlost` under them. Both are
            gone: the machine reads its own drivers, and a reader who picks a
            backend can only pick a slower one or one this computer cannot run
            — which `choose_compute` then quietly replaces, leaving the screen
            badging `používá se` on something that never ran. What ran is on
            `Nástroje` now, in a card that can also say when the graphics card
            was asked for and could not be used. */}

        <button
          className="button"
          disabled={!advancedChanged}
          onClick={() => save({ ...n, ...ADVANCED_DEFAULTS })}
        >
          {t("settings.advanced.reset")}
        </button>
        </SettingsDisclosure>
      </section>}

      {/* Where the downloaded programs and models are kept.

          Both folders are shown and neither is typed. They were free-text
          fields that saved on blur, which means one mistyped character pointed
          the application at a directory holding none of the tools it had
          downloaded — and the way back was to remember what the path had been.
          The picker cannot produce a folder that does not exist, and it is the
          only way in.

          They stood inside `Pokročilé` on `Přepis`, which is the wrong tab and
          the wrong block: a folder is not a decoding value, nobody who has
          moved one considers it advanced, and `Zpět na výchozí` two rows below
          them had to carry a note saying it does not touch them. Here they are
          a card of their own, next to the band that says what has been
          downloaded into them. */}
      {activeTab === "tools" && <section className="settings-card-locations">
        <h2>{t("settings.files.locationsTitle")}</h2>
        {/* A card's opening sentence, so it takes the card's own class rather
            than the `small-text` it wore inside the disclosure. */}
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
              they do with time and accuracy, and that does not fit on a line.

              What is listed is `check.found_models`, read off the disk, so a
              card here can always be pressed and pressing one downloads
              nothing. That is worth stating because the two cards below on
              `Jazyková úprava` behave the other way round — they are a fixed
              pair and pressing one may fetch gigabytes — and the note under
              this list says which of the two kinds this is, and where the
              others are got.

              It is also what keeps a machine set up before 14 August 2026
              working: `settings.model` may hold `large-v3-q5_0`, the middle
              model nothing offers any more, and because the list is the disk
              rather than an offer it is still shown, still named by
              `domain.model.large-v3-q5_0`, and still the chosen card. */}
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
                {/* A `používá se` badge stood here, on the card already drawn
                    as chosen. Checked rather than assumed before deleting it:
                    the list is `found_models`, so the badge appears exactly on
                    the card `n.model` names and that card is the chosen one.
                    Where the stored model is not on the disk at all no card is
                    chosen — and the badge did not render there either, so it
                    never said anything the highlight did not. */}
              </button>
            ))}
          </div>
          <InfoNote>{t("settings.transcription.modelNote")}</InfoNote>
        </div>

      </section>}

      {/* The recording's own language, on a card of its own — asked for in
          those words, and the second move for this field today.

          It was `Jazyk a detekce řeči`; the speech-detection switch went, one
          field was left, and it was folded onto the model card because a card
          holding a single dropdown looked like a card that had lost its
          purpose. It reads better standing up: what language is being spoken is
          a fact about the recording, not a property of the model, and the model
          card is a column of choice cards that the dropdown sat under as an
          afterthought.

          The heading keeps the longer name. `Jazyk` alone stood two tabs from
          `Jazyk aplikace` with nothing to tell them apart, and a heading is a
          worse place than a label to leave that ambiguity.

          `Detekce řeči` is not gone anywhere else: `whisper.rs` passes `--vad`
          unconditionally. Off is the documented cause of Whisper repeating one
          token over silence, the switch's own note said *nechte zapnuté*, and a
          switch whose only other position is a known defect is not a choice. */}
      {activeTab === "transcription" && <section className="settings-card-language">
        <h2>{t("settings.transcription.language")}</h2>

        {/* No label above the dropdown: the heading is the label, and a card
            headed `Jazyk nahrávky` over a field labelled `Jazyk nahrávky` says
            it twice. `Select` takes the name for screen readers instead, which
            is what `description` is for. */}
        <div className="field">
          <Select
            value={n.language}
            onChange={(j) => save({ ...n, language: j })}
            items={labels.languageOptions()}
            description={t("settings.transcription.language")}
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

        {/* Both rows carry a mark, and both is the point: a panel where some
            rows have one and some do not reads as an accident rather than as a
            distinction. These two are the whole panel and they are the two
            things somebody opens this page to find, so the circle is the same
            `.about-mark` the abilities list below uses — 30 px, `--accent-light`
            — rather than a size invented here.

            The other `.about-panel` on this screen, the licence list, stays
            plain: its rows are one per component and a glyph on each would be a
            column of marks saying nothing the name beside it does not. */}
        <dl className="about-panel about-panel-marked">
          <div className="about-row">
            <dt>
              <span className="about-mark"><LineIcon name="tag" size={17} /></span>
              {t("settings.about.version")}
            </dt>
            <dd>{version || "—"}</dd>
          </div>
          <div className="about-row">
            <dt>
              <span className="about-mark"><LineIcon name="author" size={17} /></span>
              {t("settings.about.author")}
            </dt>
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
