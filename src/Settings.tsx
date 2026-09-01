import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { RecordingCalendar, RecordingMetadataItem } from "./Library";
import ConfirmationDialog from "./ConfirmationDialog";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import CountdownRing from "./CountdownRing";
import { computeMode, computeRefused as computeWasRefused } from "./compute";
import type { LineIconName } from "./icons";
import Select from "./Select";
import { useI18n, type AppLanguage } from "./i18n";
import { useUserMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import {
  EDITOR_MODELS,
  EDITOR_TIER,
  MODEL_IDS,
  TRANSCRIPTION_MODELS,
  UNOFFERED_COMPONENTS,
  applyFonts,
  applyTheme,
  qualityChoice,
} from "./types";
import { useFormats } from "./formats";
import { useLabels } from "./labels";
import { AboutSettings } from "./settings/AboutSettings";
import { InterfaceSettings } from "./settings/InterfaceSettings";
import { PerformanceSettings } from "./settings/PerformanceSettings";
import { UpdatesSettings } from "./settings/UpdatesSettings";
import { ToolsSettings } from "./settings/ToolsSettings";
import { FilesSettings } from "./settings/FilesSettings";
import { TranscriptionSettings } from "./settings/TranscriptionSettings";
import { Backups } from "./settings/Backups";
import { useDictionary } from "./settings/useDictionary";
import { SettingsNavigation } from "./settings/SettingsNavigation";
import { UpdateCheck } from "./settings/updates";
import type {
  ToolCheck,
  Settings,
  DownloadComponent,
  DownloadProgress,
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
  /** Which tab this visit opens on, when the reader was sent here rather than
   *  arriving. It beats the remembered tab and is deliberately not written to
   *  `settings-tab`: that key means *where the human last was*, and being
   *  carried somewhere is not the same as going there. Click a tab while here
   *  and the remembering resumes, because that is a choice. */
  initialTab?: SettingsTab;
  /** What the check at start-up found, passed through to the updates panel so
   *  that arriving from the notice shows the version rather than an empty
   *  panel. Carried rather than looked up: the archive is what runs that check
   *  and this screen has no other way to know its answer. */
  foundUpdate?: { version: string; notes: string } | null;
  /** Something is being fetched right now.
   *
   *  Without it the modules card says a component is missing and offers
   *  *Doplnit* while that very component is coming down, with the bar in the
   *  corner counting it at the same moment. The count is not wrong; the offer
   *  is, because the errand it proposes is already under way. */
  fetching: boolean;
  /** The component actually coming down right now, or "". **A card says
   *  *stahuje se…* about a live download and about nothing else.** It used to
   *  say it about `MODEL_WANTED`, which is an intent - and an intent outlives
   *  the download it was made for, so a stopped download left that word on the
   *  card for ever, across restarts, with nothing behind it. */
  fetchingComponent?: string;
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

/* `computeMode` stood here, with the note about settings written before
   14 August naming a build. Both live in `compute.ts` now, beside the reading
   of when the graphics card has been left out of a run — the archive's notice
   bar asks that second question, this card asks both, and two screens deciding
   the same thing separately is how they come to disagree about one machine. */

/** Which downloadable module corresponds to which compute backend. */
const COMPUTE_MODULES: Record<string, string> = {
  cuda: "whisper-cuda",
  vulkan: "whisper-vulkan",
  cpu: "whisper-cpu",
};



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
/** Exported because the screen can now be opened *on* a tab by whoever is
 *  sending the reader here — see `initialTab`. */
export type SettingsTab =
  | "transcription"
  | "interface"
  | "performance"
  | "tools"
  | "files"
  | "updates"
  | "about";

/* Reading order. `performance` sits before `tools` because where the
   transcription runs belongs nearer the transcript than the inventory of what
   is installed does — one is about the work, the other about the disk.

   And `updates` is last on purpose. It is the rarest thing anybody opens
   Settings for — pressed a handful of times a year — and it had been sitting
   between the archive's copies and the page about the application, where its
   width of visibility did not match how often it is wanted. Last is where a
   thing goes when it must be findable and is not looked for. */
const SETTINGS_TABS: SettingsTab[] = [
  "transcription",
  "interface",
  "performance",
  "tools",
  "files",
  "about",
  "updates",
];
/** Every tab has a key of its own, and every id says what its tab says.
 *
 *  Two borrowings were tried and both failed the same way. `appearance` took
 *  `settings.appearance.title` from the card that fills it, on the reasoning
 *  that a second key holding the same word is a second thing to keep in step —
 *  right up to the moment the tab and the card stopped saying the same word.
 *  `transcription` borrowed in the other direction, the card taking the tab's
 *  key, and that one has gone too: the card is `Model` now, because a card
 *  headed with its own tab's name is a heading that has not been chosen.
 *
 *  So: no tab name is a card name and no card name is a tab name, and neither
 *  side reads the other's key. `settings.tab.performance` and
 *  `settings.compute.title` are the price paid twice over — both say `Výkon`,
 *  one for a tab and one for the single card on it — and paying it is still
 *  cheaper than the thing that broke twice in one day. */
const SETTINGS_TAB_KEYS: Record<SettingsTab, TranslationKey> = {
  transcription: "settings.tab.transcription",
  interface: "settings.tab.interface",
  performance: "settings.tab.performance",
  tools: "settings.tab.tools",
  files: "settings.tab.files",
  updates: "settings.tab.updates",
  about: "settings.tab.about",
};

/** Where a transcription model picked before it was downloaded is remembered.
 *
 *  Not in the settings record, which is the whole point: `settings.model` names
 *  a file that must exist. Not in React state either, because the reader is
 *  free to leave while several gigabytes come down and the promise has to
 *  survive that. */
const MODEL_WANTED = "model-wanted";


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

/* `ModelMark` stood here and is in `src/icons.tsx` now, unchanged. The wizard's
   two quality cards draw the same two models this screen lists, and the same
   model must not wear one drawing on the first screen and another on the
   fifth — so the drawing lives where the shared icons live. */


export default function SettingsScreen({
  onComplete,
  onError,
  onInfo,
  onToModule,
  initialTab,
  foundUpdate,
  fetching,
  fetchingComponent = "",
}: Props) {
  const labels = useLabels();
  const formats = useFormats();
  const { language, setLanguage, t, tDynamic, tPlural, formatNumber } = useI18n();
  const userMessage = useUserMessage();
  const [n, setN] = useState<Settings | null>(null);
  const [check, setCheck] = useState<ToolCheck | null>(null);
  /** Which `compute` setting the check above is an answer to. A pick is stored
   *  the instant it is pressed and `check_tools` answers a round trip later, so
   *  in between the card was holding a new question beside an old answer — and
   *  read the difference as a refusal. Pressing `Procesor` on a machine running
   *  on the graphics card flashed `sestavení pro něj zatím není stažené` in red
   *  and took it back a fraction of a second later. Keeping the question beside
   *  its answer lets the refusal wait for one that belongs to it. */
  const [checkedCompute, setCheckedCompute] = useState<string | null>(null);
  const [modules, setModules] = useState<DownloadComponent[]>([]);
  /** Megabytes the tools and models folders take, measured in Rust. Null until
   *  it has been read — the panel is simply not drawn until then, because a `0`
   *  that turns into `4,3 GB` is a worse first impression than a row arriving a
   *  moment late. */
  const [diskUsed, setDiskUsed] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [machine, setMachine] = useState("");
  /** Read through a ref rather than a dependency: `load` is what the mount
   *  effect runs, and rebuilding it every time a download starts or stops
   *  would reload this whole screen on each of them. */
  const fetchingNow = useRef(fetching);
  fetchingNow.current = fetching;
  /** Whether this is the first read since the screen opened. A stale intent is
   *  only recognisable there — later reads happen *during* a download. */
  const firstLook = useRef(true);
  const [modelWanted, setModelWanted] = useState(() => localStorage.getItem(MODEL_WANTED) ?? "");
  const dictionary = useDictionary({ onError });

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    /* Whoever sent the reader here said where to put them, and that beats the
       last visit. The screen unmounts on the way out and this initialiser runs
       again on the way back in, so a prop is enough — there is nothing to
       synchronise afterwards. */
    if (initialTab) return initialTab;
    const remembered = localStorage.getItem("settings-tab");
    /* A remembered name this build does not have opens the first tab rather
       than an empty panel, which is what makes renaming one safe: `application`
       was stored on every machine that opened Settings yesterday and is not a
       tab any more. */
    return SETTINGS_TABS.some((tab) => tab === remembered)
      ? remembered as SettingsTab
      : "transcription";
  });

  const selectTab = useCallback((tab: SettingsTab) => {
    localStorage.setItem("settings-tab", tab);
    setActiveTab(tab);
  }, []);


  /** Every check is stored together with the settings it answered for. There is
   *  no path that sets one without the other, which is what keeps the two from
   *  drifting apart again. */
  const recordCheck = useCallback((tools: ToolCheck, settings: Settings) => {
    setCheck(tools);
    setCheckedCompute(settings.compute);
  }, []);

  const load = useCallback(async () => {
    try {
      const settings = await api.loadSettings();
      const tools = await api.checkTools();
      /* A model picked while it was still downloading becomes the model in
         force here, and only here — the moment the file is on the disk and not
         a moment before.

         `settings.model` names a file and `tools.rs` resolves it strictly as
         `ggml-{model}.bin` with no fallback, so writing it at the press would
         leave the application demanding a model it had not fetched. That is not
         hypothetical: the wizard's by-hand path did exactly that and reopened
         itself as required, which is written up in `SetupWizard.tsx`.

         The intent lives in `localStorage` rather than in the settings record
         precisely because the settings record is the thing that must not be
         touched yet, and because it has to survive the reader walking away —
         out of Settings, out of the application. Whatever they do while the
         gigabytes come down, the model changes when the file lands and the old
         one goes on working until it does. A download that fails or is
         cancelled never reaches this branch, and `Rychlý`/`Přesný` clears the
         intent when a different card is pressed. */
      const wanted = localStorage.getItem(MODEL_WANTED) ?? "";
      /* **An intent that outlived its download is dropped on the way in.**
         It is cleared where the file appears and where the download visibly
         ends, but neither of those happens if the application was closed in
         between - so one made months ago sat in `localStorage` waiting to
         overwrite a choice made since. On the first read of this screen it is
         either wanted-and-arrived (below), or coming down now, or nothing. */
      if (
        firstLook.current &&
        wanted &&
        !tools.found_models.includes(wanted) &&
        !fetchingNow.current
      ) {
        localStorage.removeItem(MODEL_WANTED);
        setModelWanted("");
      }
      firstLook.current = false;
      if (wanted && tools.found_models.includes(wanted)) {
        localStorage.removeItem(MODEL_WANTED);
        setModelWanted("");
        if (settings.model !== wanted) {
          const withModel = { ...settings, model: wanted };
          await api.saveSettings(withModel);
          setN(withModel);
          recordCheck(await api.checkTools(), withModel);
        } else {
          setN(settings);
          recordCheck(tools, settings);
        }
      } else {
        setN(settings);
        recordCheck(tools, settings);
      }
      setModules(await api.catalog());
      setDiskUsed(await api.installedMegabytes());
      setMachine(await api.machineName());
      dictionary.actions.receive(await api.dictionary());
    } catch (e) {
      onError(userMessage(e));
    }
  }, [onError, recordCheck, userMessage]);

  useEffect(() => {
    load();
  }, [load]);

  /* A download finishing while this screen is open. Every completion reloads,
     which is cheap and covers the two things that change: a model becoming
     available, and the band that says whether anything is still missing.
     Nothing depends on this listener being alive — `load` does the same work
     when Settings is next opened — so leaving the screen mid-download loses
     nothing but the immediacy. */
  /** Which component the standing intent is waiting for, so its own failure
   *  can be told from anybody else's. */
  const wantedComponent = useMemo(
    () =>
      Object.entries(TRANSCRIPTION_MODELS).find(([, model]) => model === modelWanted)?.[0] ?? "",
    [modelWanted]
  );

  useEffect(() => {
    if (!modelWanted) return;
    const unlisten = listen<DownloadProgress>("download:progress", (event) => {
      if (event.payload.phase === "complete") {
        void load();
        return;
      }
      /* **An intent that cannot come true is dropped.** It used to be cleared
         only where the file appeared, so stopping the download left the card
         saying *stahuje se…* for ever - in `localStorage`, so across restarts -
         and left an intent that would fire whenever that model turned up for
         any other reason, months later, over a choice made since.
         Only this component's own end counts: another row failing says nothing
         about this one. */
      if (
        event.payload.id === wantedComponent &&
        (event.payload.phase === "error" || event.payload.phase === "cancelled")
      ) {
        localStorage.removeItem(MODEL_WANTED);
        setModelWanted("");
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [modelWanted, wantedComponent, load]);

  const save = useCallback(
    async (nove: Settings) => {
      setN(nove);
      // appearance applies immediately, before it is even saved
      applyFonts(nove);
      applyTheme(nove.theme);
      try {
        await api.saveSettings(nove);
        recordCheck(await api.checkTools(), nove);
        setSaved(true);
        setTimeout(() => setSaved(false), 1400);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, recordCheck, userMessage]
  );

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

  /* **Above the early return below, and that is the whole of why it is here.**
     It was declared beside `chooseEditor`, which is a hundred lines past
     `if (!n) return` — so on the render before the settings arrive React counted
     one hook fewer than on the render after, and the screen stopped opening at
     all. TypeScript cannot see it; the rule is that every hook runs on every
     render, without exception. */
  const [downloadConfirm, setDownloadConfirm] = useState<ConfirmationRequest | null>(null);

  if (!n) return <main className="settings"><p>{t("common.loading")}</p></main>;

  const missingRequired = check?.issues ?? [];
  const installed = (id: string) => modules.some((module) => module.id === id && module.complete);
  const megabytes = (id: string) => modules.find((module) => module.id === id)?.megabytes ?? 0;
  /** What this application offers, which is exactly what the by-hand listing
   *  draws: the catalogue less the two middle models nothing offers — and those
   *  two do appear once they are on the disk, because a machine set up before
   *  14 August 2026 may be running on one. It is the denominator of the card's
   *  fraction, so the number can be checked by counting rows on that screen
   *  rather than being taken on trust. */
  const offeredModules = modules.filter(
    (module) => module.complete || !UNOFFERED_COMPONENTS.includes(module.id)
  );

  /* ---------------------------------------------------- transcription model
     The two that are offered, plus whatever else is on the disk, in one list
     sorted best first. A model file appearing twice is impossible: the offered
     pair is keyed by file name and `found_models` is deduplicated against it.

     The size comes from the catalogue and only from there. It used to be
     written into each `domain.modelDescription.*` sentence by hand, where it
     had already drifted — `large-v3` said 3,1 GB against the catalogue's
     3095 MB, which rounds to 3,0. */
  /** Which card is drawn as chosen: the model that will actually transcribe.
   *
   *  `n.model` is what is on record, and the two part company exactly when the
   *  setting cannot be honoured — a file deleted by hand, a choice made before
   *  its download finished. `resolve_transcription_model` in `tools.rs` decides
   *  what runs; drawing the record instead would put the highlight on a model
   *  that is not the one working, which is the same paradox in a different
   *  place. `n.model` is the fallback only for the instant before the first
   *  check comes back. */
  const modelInForce = check?.model_whisper_id ?? n.model;

  const offeredModels = Object.entries(TRANSCRIPTION_MODELS);
  const modelCards = [
    ...new Set([...Object.values(TRANSCRIPTION_MODELS), ...(check?.found_models ?? [])]),
  ]
    .sort(byModelOrder)
    .map((id) => {
      const component = offeredModels.find(([, model]) => model === id)?.[0];
      return {
        id,
        component,
        installed: (check?.found_models ?? []).includes(id),
        megabytes: component ? megabytes(component) : 0,
      };
    });

  /** Picking a model. On the disk it takes effect at once; missing, it starts
   *  the download and takes effect when the file lands — see `load`, which is
   *  the only place `settings.model` is written from an intent.
   *
   *  The download runs behind this screen, as every download in this
   *  application does: `download` in `downloads.rs` starts a thread and
   *  returns, the progress bubble reports it, and it can be stopped from
   *  there. Pressing a card cannot be undone by pressing another — the bytes
   *  are already coming — but the *choice* can, which is what clearing the
   *  intent does: whatever lands, the model in force is the last one pressed
   *  that is actually there. */
  const chooseModel = async (card: { id: string; component?: string; installed: boolean }) => {
    if (card.installed) {
      localStorage.removeItem(MODEL_WANTED);
      setModelWanted("");
      await save({ ...n, model: card.id });
      return;
    }
    if (!card.component || card.id === modelWanted) return;
    const component = card.component;
    const apply = async () => {
      try {
        await api.download([component]);
        localStorage.setItem(MODEL_WANTED, card.id);
        setModelWanted(card.id);
        setModules(await api.catalog());
      } catch (e) {
        onError(userMessage(e));
      }
    };
    /* **Asked first, the same as the language-editing card one section down.**
       Both are a single click that starts gigabytes, and until 20 August only
       one of them asked — the smaller one. `settings.transcription.modelNote`
       had been carrying the difference in words for as long as it existed,
       which is a warning standing in for a control: *Výběr nestaženého modelu
       zahájí stahování* is a true sentence and not a way back.

       Nothing is destroyed, so the confirming button is the plain one and
       carries the size, which is the fact the answer turns on. */
    const size = formats.dataSize(megabytes(component));
    setDownloadConfirm({
      title: t("settings.transcription.downloadTitle"),
      text: t("settings.transcription.downloadText", { size }),
      confirm: t("settings.transcription.downloadConfirm", { size }),
      action: apply,
    });
  };

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
    const apply = async () => {
      try {
        if (needs.length > 0) await api.download(needs);
        await save({ ...n, editor_model: EDITOR_MODELS[id] });
        setModules(await api.catalog());
      } catch (e) {
        onError(userMessage(e));
      }
    };
    /* **Asked first when it costs gigabytes.** Pressing a card that is already
       on the disk only changes a setting and needs no ceremony; pressing one
       that is not started seven gigabytes on a single click, with no way back
       except finding the running download and stopping it.
       Not destructive: nothing is lost, so the confirming button is the plain
       one and carries the size, which is the fact the answer turns on. */
    if (needs.length === 0) {
      await apply();
      return;
    }
    const size = formats.dataSize(needs.reduce((total, need) => total + megabytes(need), 0));
    setDownloadConfirm({
      title: t("settings.editor.downloadTitle"),
      text: t("settings.editor.downloadText", { size }),
      confirm: t("settings.editor.downloadConfirm", { size }),
      action: apply,
    });
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
  /** Something was picked and is not what ran. The chosen card goes red for it —
   *  the one case where the card has to contradict the choice drawn on it — and
   *  the sentence under the cards carries the reason. The rule and the reason
   *  it needs `checkedCompute` are in `compute.ts`. */
  const computeRefused = computeWasRefused(n.compute, checkedCompute, check);
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

  return (
    <>
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

      <SettingsNavigation
        tabs={SETTINGS_TABS}
        labels={SETTINGS_TAB_KEYS}
        active={activeTab}
        onSelect={selectTab}
        alertOn={missingRequired.length > 0 ? "tools" : null}
        alertLabel={t("settings.missingRequired")}
      />

      <div
        className="settings-panels"
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={`settings-tab-${activeTab}`}
      >



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
          reason is a build that is not downloaded, offers it.

          It has a tab to itself now — *dejme výkon zvlášť* — which leaves it the
          only card on it, and so with a heading repeating the tab directly
          above. That is the `Aktualizace` shape and it takes the `Aktualizace`
          answer: an exact match misleads when a card claims the tab's name while
          siblings sit under it, and there are none here. Dropping the heading
          would make this the only card in Settings without one that is not a
          disclosure, and would leave the two single-card tabs behaving
          differently from each other, which is worse than saying one word
          twice. */}


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
      {activeTab === "transcription" && (
        <TranscriptionSettings
          n={n}
          check={check}
          save={save}
          dictionary={dictionary}
          models={{
            transcription: modelCards,
            inForce: modelInForce,
            chooseTranscription: (card) => void chooseModel(card),
            editors: editorCards,
            editorChosen,
            chooseEditor: (id, needs) => void chooseEditor(id, needs),
            fetchingComponent,
          }}
        />
      )}

      {activeTab === "files" && (
        <FilesSettings
          n={n}
          check={check}
          machine={machine}
          save={save}
          onError={onError}
          onInfo={onInfo}
          onSelectDirectory={selectDirectory}
        />
      )}

      {activeTab === "tools" && (
        <ToolsSettings
          n={n}
          check={check}
          modules={modules}
          diskUsed={diskUsed}
          fetching={fetching}
          onToModule={onToModule}
          onSelectDirectory={selectDirectory}
        />
      )}

      {activeTab === "performance" && check && (
        <PerformanceSettings
          n={n}
          check={check}
          checkedCompute={checkedCompute}
          save={save}
          onToModule={onToModule}
        />
      )}



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


      {/* `Technické podrobnosti` stood here — *dle mého nemají smysl* — a folded
          card at the foot of this tab holding three things that were never one
          thing, and the record for 14 August 2026 separates them.

          The found paths went because they are diagnostic output on a settings
          screen: which `ffmpeg` and which model file the application resolved,
          read by almost nobody and by nobody who could act on it. `Otevřít log`
          went with them.

          **`Zkopírovat údaje` went too, and it was the different one.** It is
          not something a reader consults, it is what they are asked to send when
          something has gone wrong, and losing it turns *can you send me what your
          machine says?* into *find this file yourself*. It is named in the record
          with its command and its keys so it can come back in one commit, and it
          is not quietly relocated here: a button surviving alone on some other
          card is a decision the owner has not made. */}

      {/* The dictionary is not a subject of its own: it is a list of the
          mistakes this transcript makes, and it belongs beside the model that
          makes them. It was a tab because it is long, which is a reason to put
          it last on a tab, not to give it one. */}


      {/* The application's own language, on a card of its own — the same move
          `Jazyk nahrávky` made on `Přepis`, built the same way so the two
          screens read alike. It stood as the first field of the appearance
          card, which was fair while the tab was called `Vzhled` and had to
          hold it somewhere; the tab is `Jazyk a vzhled` now and names the two
          halves it actually has.

          **This is the one control on this screen that is not in the settings
          record.** It lives in `localStorage["app-language"]` and is written by
          `setLanguage` from `i18n.tsx`, not by `save(n)` — which is why the
          card looks like every other card here and works unlike every other
          one. It does not travel in an exported archive, and it does not come
          back with an imported one; a machine restored from a backup keeps the
          language it was already showing. Nothing about this card should be
          wired into the settings write path to make it look tidier.

          No label above the dropdown: the heading is the label, and `Select`
          takes the name for screen readers through `description`, exactly as
          `Jazyk nahrávky` does. */}




      {/* Headed `Model přepisu` — `Přepis` first, then `Model`, then this.

          The first rename stopped the card wearing its tab's name. The second
          is the same fix taken one step further, and it is the language editor
          that made it necessary: once that card also became a choice between
          models, `Model` alone named two cards on one screen and told them
          apart nowhere. The qualifier is the distinction, not decoration.

          It took its tab's key, which was defensible while the card was most of
          the tab. It is not: the tab holds six cards, this one holds a list of
          models, and a card headed with the word above it in the tab strip is a
          heading nobody chose. With the tabs now one word each, an exact match
          between a tab and a card reads as an accident.

          `settings.transcription.model` was the label over the list inside it,
          so the heading is the label — the same move `Jazyk nahrávky` and
          `Jazyk aplikace` made today, and there is no `<label>` under it for
          the same reason. The list is buttons rather than a form control, so
          nothing needed a name handed to it separately.

          The opening sentence went with the old heading. It read *Model,
          kterým se nahrávky přepisují*, which under a heading reading `Model`
          is the heading again with a relative clause; the tab it sits on says
          `Přepis`, so the clause was carrying nothing either. */}
      {activeTab === "interface" && <InterfaceSettings n={n} save={save} />}



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




      {/* A take from the microphone exists nowhere else, and until now it lived
          in %APPDATA% where nobody looks. The point of this card is that the
          audio the application makes for itself is somewhere its owner can
          find — which is also what lets a factory reset leave it alone. */}




      {/* `Zobrazovat tipy nad přepisem` stood here. The strip it governs is
          dismissed by its own × on the transcript screen, which is where
          anybody who wants it gone is looking; a switch on another screen to
          undo a press made two screens away is a setting for a decision nobody
          revisits. Dismissing it is final on this machine now, which is the
          trade: one fewer control against one fewer way back. */}





      {/* Updating is the one thing on this screen that is neither a setting nor
          a fact about the application: it is an errand, with a button that goes
          out to a server and a second one that closes the application and
          starts an installer. It stood at the foot of the About page, under the
          licences, which is where a reader looking for a new version would look
          last. */}


      {activeTab === "updates" && (
        <UpdatesSettings
          n={n}
          save={save}
          found={foundUpdate ?? null}
          onError={onError}
          onInfo={onInfo}
        />
      )}

      {activeTab === "about" && <AboutSettings onError={onError} />}

      </div>

      </main>

      {/* **Outside `<main>`, and that is the whole point.**
          `.settings.settings > *` clamps every direct child to the 720 px
          column, and a `.dialog-overlay` is `position: fixed; inset: 0` — put
          inside, its veil shrinks to the column and leaves the rest of the
          window undimmed. The stylesheet carries a warning about exactly this
          beside that rule, naming it as the defect the wizard once shipped;
          this is the same mistake made again a screen later.

          A fragment costs nothing and leaves the shared selector alone. The
          alternative — excluding overlays from it — raises its specificity and
          turns the two overrides underneath into a question of file order. */}
      <ConfirmationDialog
        query={downloadConfirm}
        onClose={() => setDownloadConfirm(null)}
        onError={onError}
      />
    </>
  );
}
