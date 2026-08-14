import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import ConfirmationDialog from "./ConfirmationDialog";
import type { ConfirmationRequest } from "./ConfirmationDialog";
import InfoNote from "./InfoNote";
import { LineIcon, ModelMark } from "./icons";
import { useI18n, type TranslationKey } from "./i18n";
import { messageCode, useProgressMessage, useUserMessage } from "./messages";
import { useFormats } from "./formats";
import {
  EDITOR_MODELS,
  UNOFFERED_COMPONENTS,
  type QualityChoice,
} from "./types";
import type { DownloadComponent, ToolCheck, DownloadProgress } from "./types";

interface Props {
  onComplete: () => void;
  onBack: () => void;
  /** The wizard opened by itself because transcription is impossible without it */
  required: boolean;
  /** id of the module to preselect for installation */
  missingModule?: string | null;
}

type Quality = "fastest" | "best";

/** How much of each row the download listing draws. Remembered in
 *  `localStorage` under `download-view`, the way the archive remembers its own
 *  — somebody who prefers one listing gets it on every future setup, and this
 *  screen is rare enough that re-choosing every time would be the whole of the
 *  interaction. `compact` is the default and is what an unknown value means. */
type ListingView = "compact" | "full";

const LISTING_VIEW = "download-view";

function rememberedListingView(): ListingView {
  return localStorage.getItem(LISTING_VIEW) === "full" ? "full" : "compact";
}

/** The quality choice is mapped to a concrete model only here — nobody should
 *  have to know that "best" means large-v3. Nothing but identifiers and
 *  dictionary keys lives in these tables: a module constant is evaluated once,
 *  outside React, so a label stored here could never follow a language change.
 *
 *  **Two choices, and the middle one was removed rather than renamed.** The
 *  wizard used to offer `large-v3-q5_0` between these as *Vyvážený*, described
 *  as about one mistake per paragraph — a claim measured nowhere in this
 *  repository. What *is* measured is time alignment, on 13 August: the turbo
 *  model put a whole block of transcript 3.34 s from where the words are
 *  spoken, into a gap where nobody was speaking, while `large-v3` was 0.56 s
 *  out on the same audio. Nobody has ever measured the middle model on that
 *  axis or any other.
 *
 *  So it is not offered. A first run should not ask somebody to choose between
 *  three things when the difference between two of them cannot be stated. It
 *  remains installable by hand and selectable in Settings for anyone who wants
 *  it; what it stops doing is standing in a wizard wearing a number nobody
 *  took. */
const MODELS: Record<
  Quality,
  {
    component: string;
    settings: string;
    /** What is written down as the answer, for everything that follows it. */
    choice: QualityChoice;
    name: TranslationKey;
    summary: TranslationKey;
  }
> = {
  fastest: {
    component: "model-turbo",
    settings: "large-v3-turbo-q5_0",
    choice: "fast",
    name: "wizard.quality.fastestName",
    summary: "wizard.quality.fastestSummary",
  },
  best: {
    component: "model-large",
    settings: "large-v3",
    choice: "accurate",
    name: "wizard.quality.bestName",
    summary: "wizard.quality.bestSummary",
  },
};

/** Speaker recognition, downloaded without being asked about.
 *
 *  It was a step of its own — *Přepisujete i rozhovory?* — governing 28 MB out
 *  of a gigabyte. A question, a screen and a possible regret to save a
 *  fortieth of the download is a bad trade, and it is asked at the worst
 *  possible moment: before the reader has a single recording, when the honest
 *  answer is *I do not know yet*.
 *
 *  The model comes down with everything else and `diarization` stays off. The
 *  Detail screen already has *Rozpoznat mluvčí* on the recording where the
 *  question finally has an answer, and by then nothing needs downloading. */
const DIARIZATION_COMPONENTS = ["model-hlasy"];

/** The language editor's processor build, downloaded whether or not the
 *  language editor is ever used.
 *
 *  45 MB, and it is the runtime rather than a model: the two Gemma models are
 *  3350 and 6980 MB and stay on demand, asked about once with the size in the
 *  sentence. `editor-vulkan` stays on demand too — it is 150 MB and comes down
 *  with the model it runs, on a machine that can use it. The fast path can wait
 *  for the thing it makes fast; the floor cannot.
 *
 *  It is here rather than in `root` because `root` takes the `program` group,
 *  and this belongs under `Jazyková úprava` in the by-hand list where a reader
 *  looks for it. `catalog()` in `download.rs` recommends it unconditionally for
 *  the same reason, so the two paths agree. */
const EDITOR_RUNTIME_COMPONENTS = ["editor-cpu"];

/* The three named tiers of language editing stood here — `Úsporná`,
   `Doporučená`, `Nejvyšší kvalita`, each with a sentence saying what it does
   better than the one below it. The table is in `types.ts` now and carries
   identifiers only, because those sentences were not true in the way a reader
   would take them: nothing in `docs/history/` has ever compared the three
   models' output, and the entry that gave them their counted sparkles says in
   as many words that they "trade nothing; they do the same work with more of
   it". What differs is how large the file is. */

/** Rough estimate for an hour-long recording, in minutes. Measured on a Radeon
 *  RX 9070; on a CPU it is an order of magnitude different, hence two sets of
 *  numbers. Only the number lives here — the phrase around it needs the active
 *  language's plural rules and is assembled by `useFormats`.
 *
 *  Worth knowing before quoting these: *measured* is what the original comment
 *  said, and no entry in `docs/history/` ever took, checked or contradicted
 *  them. `benchmark_compute` is the app's own timer and could settle it in
 *  twenty seconds per backend. Until somebody runs it these are the oldest
 *  numbers in the interface. */
function estimatedMinutes(quality: Quality, usesGpu: boolean): number {
  const t: Record<Quality, [number, number]> = {
    fastest: [1, 8],
    best: [4, 35],
  };
  return t[quality][usesGpu ? 0 : 1];
}

/** Which model the machine is steered towards.
 *
 *  One function, used for both the badge and the initial selection, because
 *  they used to be computed apart and disagreed: the state started on
 *  *Vyvážený* while the badge was `usesGpu ? "balanced" : "fastest"`, so a
 *  computer with no graphics card showed one option chosen and a different one
 *  recommended — and the backend sided with the badge. */
function recommendedQuality(usesGpu: boolean): Quality {
  return usesGpu ? "best" : "fastest";
}

/* `DownloadedMark` stood here — the green tick as a component of its own,
   drawn in the size column of the by-hand list. The row's mark is a control
   now and draws the tick, the download arrow and the stop square itself,
   choosing between them by state, so a component that could only ever draw one
   of the three had nothing left to do. `.downloaded-mark` went with it. */

/* `ManualSelectionButton` stood here — two sliders, the word `Vybrat ručně`,
   and a footer slot on both steps of the guided run.
   *To vybrat ručně už ve wizardu nedává smysl.*

   It contradicted the screen it stood on. This wizard asks one question and
   everything follows from it; a button beside that question offering to pick
   twelve components by hand reads as *unless you would rather answer twelve
   questions instead of one*, which is the arrangement the whole redesign
   removed. And the list it opened is not lost — it is on `Nástroje`, behind
   `Spravovat modely`, which is where somebody who wants it goes.

   **The mode it switched into is still here and is still reached twice.**
   `Spravovat modely` and `missingModule` both open straight onto the list; see
   `load`. What went is the button, the concept in the guided path, and
   `chooseByHand` with `manualFrom`, which existed only to remember which
   question the button had been pressed on. */

/** Was the answer "one is already running" rather than a failure?
 *
 *  The backend allows one download at a time, and says so by refusing the
 *  second call. That refusal is not a failure and must not be dressed as one:
 *  it was arriving on this screen as a red **Stahování selhalo** over a
 *  download that was running perfectly well, and — worse than the fright — it
 *  took `running` down with it and hid the progress the reader was asking
 *  about.
 *
 *  So the screen stays where it is. The download that is already going emits
 *  the same events to the same listener, so watching is the whole of the right
 *  behaviour; there is nothing to say and nothing to start.
 */
export function alreadyRunning(error: unknown): boolean {
  return messageCode(error) === "download.already_running";
}

/* Three screens where there were six, and they are numbered rather than
   counted at each use: the old code carried `setStep(4)` in five places and a
   `[0,1,2,3,4]` bar that had to be kept in step with them by hand. */
const STEP_CHOICE = 0;
const STEP_DOWNLOAD = 1;
const STEP_DONE = 2;
const STEPS = [STEP_CHOICE, STEP_DOWNLOAD, STEP_DONE];

export default function SetupWizard({ onComplete, onBack, required, missingModule }: Props) {
  const { t, tDynamic, tPlural } = useI18n();
  const { approximateMinutes, dataSize } = useFormats();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();

  const [step, setStep] = useState(STEP_CHOICE);
  const [items, setItems] = useState<DownloadComponent[]>([]);
  const [check, setCheck] = useState<ToolCheck | null>(null);

  /* Null until somebody presses one. The recommendation depends on drivers
     that are still being read when this screen first renders, so a state that
     started on a named choice could only ever start on the wrong one — which
     is exactly how the badge and the selection came to disagree. */
  const [chosen, setChosen] = useState<Quality | null>(null);
  /** Whether this is the by-hand component list rather than the guided run.
   *
   *  Nothing on screen sets it any more: it is decided once in `load`, by how
   *  the wizard was opened, and never toggled. `Spravovat modely` and
   *  `missingModule` are the two ways in, and both arrive with `required`
   *  false — so in this mode `Zpět` means the screen the reader came from. */
  const [manual, setManual] = useState(false);
  /** What this visit to the by-hand list actually fetched.
   *
   *  It was `manualSelect`, the set of ticked rows, and it fed three things:
   *  the download, the total, and `dokonci`, which turns a downloaded model
   *  into the setting that names it. The first two are gone with the ticking.
   *  The third is not — a transcription model fetched here must still become
   *  `settings.model`, or the application goes on demanding one it does not
   *  have — so the same question is asked of a different source: **what did you
   *  fetch**, rather than what did you tick. */
  const [startedHere, setStartedHere] = useState<Set<string>>(new Set());

  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);

  /** Asks before deleting, and names the space it frees.
   *
   *  `destructive`, because several gigabytes come back over somebody's
   *  connection at whatever speed that is — this is the one action in the
   *  application whose undo is a download. `ConfirmationDialog` starts its focus
   *  on Cancel for exactly this shape, so a blind Enter deletes nothing.
   *
   *  The list is reloaded from `catalog()` afterwards rather than edited in
   *  place: the row's `removable`, its `complete` and the tick all come from
   *  Rust reading the disk, and guessing any of them here is how a screen comes
   *  to disagree with the thing it is describing. */
  const askToRemove = useCallback(
    (component: DownloadComponent) => {
      const name = tDynamic(component.name_code, component.id);
      setConfirmation({
        title: t("wizard.manual.removeTitle", { name }),
        text: t("wizard.manual.removeText", { size: dataSize(component.megabytes) }),
        confirm: t("wizard.manual.remove"),
        destructive: true,
        action: async () => {
          await api.removeComponent(component.id);
          setItems(await api.catalog());
          // Deleting a component this visit had fetched un-records it, so
          // `dokonci` does not go on to name a model that is no longer there.
          setStartedHere((current) => {
            const next = new Set(current);
            next.delete(component.id);
            return next;
          });
        },
      });
    },
    [t, tDynamic, dataSize]
  );

  /** Fetch one component, on its own.
   *
   *  The list has no batch to add to any more, so this is `api.download` with
   *  a single id — the same call the guided run makes with a set. A refusal
   *  because something else is already downloading is reported rather than
   *  swallowed: on this screen the reader pressed a specific row and silence
   *  would read as the press having missed. */
  const installOne = useCallback(
    async (component: DownloadComponent) => {
      try {
        await api.download([component.id]);
        setStartedHere((current) => new Set(current).add(component.id));
      } catch (error) {
        setError(userMessage(error));
      }
    },
    [userMessage]
  );

  const [view, setView] = useState<ListingView>(rememberedListingView);
  useEffect(() => {
    localStorage.setItem(LISTING_VIEW, view);
  }, [view]);

  const load = useCallback(async () => {
    try {
      const [k, kn] = await Promise.all([api.catalog(), api.checkTools()]);
      setItems(k);
      setCheck(kn);
      if (missingModule) {
        // We came from settings for one specific thing. There is no point
        // walking someone through a question unrelated to it.
        /* Straight to the list, and it starts the download rather than
           ticking a box and waiting to be told to. A screen opened *for* one
           component that then asks the reader to confirm the component is a
           screen asking a question it already has the answer to. */
        setManual(true);
        const requested = [missingModule];
        if (missingModule.startsWith("editor-model-")) {
          requested.push(kn.vulkan_driver ? "editor-vulkan" : "editor-cpu");
        }
        const wanted = requested.filter((id) => !k.find((x) => x.id === id)?.complete);
        if (wanted.length > 0) {
          try {
            await api.download(wanted);
            setStartedHere(new Set(wanted));
          } catch (error) {
            setError(userMessage(error));
          }
        }
        setStep(STEP_DOWNLOAD);
      } else if (!required) {
        /* `Spravovat modely` in Settings arrives here, and it used to arrive at
           the question. Finishing the wizard writes `model`, `diarization` and
           `editor_model`, so somebody who opened it to see what was installed
           and pressed through could return with speaker recognition switched
           off and a different transcription model, having answered nothing
           about either. Opening the list instead means looking costs nothing. */
        setManual(true);
        setStep(STEP_DOWNLOAD);
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
  /* What is chosen, or what would be if nobody chose. One expression, so the
     card drawn as selected and the model actually downloaded cannot differ. */
  const quality = chosen ?? recommendedQuality(usesGpu);

  // The user does not pick the programs; the machine picks them from its drivers.
  const root = useMemo(
    () =>
      items
        .filter((p) => (p.required || (p.group === "program" && p.recommended)) && !p.complete)
        .map((p) => p.id),
    [items]
  );

  const selected = useMemo(() => {
    // The by-hand list gathers nothing: each row starts its own download and
    // reports its own progress, so there is no pending set to total up.
    if (manual) return [];
    const s = new Set(root);
    const m = MODELS[quality].component;
    if (!items.find((p) => p.id === m)?.complete) s.add(m);
    [...DIARIZATION_COMPONENTS, ...EDITOR_RUNTIME_COMPONENTS]
      .filter((id) => !items.find((p) => p.id === id)?.complete)
      .forEach((id) => s.add(id));
    /* The language editor's *models* are not here, and that is the largest
       single change to this screen. They were in the default selection at
       5150 MB against 1206 for everything else — 81 % of a first run, for a
       feature its own screen calls `Volitelný`. They are offered where they are
       wanted instead: the first time somebody opens a finished transcript,
       through the `missingModule` path that already exists and already comes
       straight back here. What does come down is the 45 MB runtime above, so
       that a model arriving later has something to run in. */
    return [...s];
  }, [manual, root, quality, items]);

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
        setStep(STEP_DONE);
      })
    );

    return () => {
      liveSegments = false;
      unlisten.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, quality]);

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
          /* Written whether or not the model landed, and that is the
             difference between the two: `model` names a file and must not name
             one that is missing, while this is the answer to a question the
             reader has just answered. Everything that follows from it — how
             large a language-editing model is fetched the first time a
             document is wanted — follows from the answer, not from the
             download. */
          changesApplied.quality_choice = MODELS[quality].choice;
        } else {
          /* The by-hand path used to write `editor_model` and nothing else, and
             that was a way to break a working installation with a download that
             succeeded. `settings.model` defaults to `large-v3`, and `tools.rs`
             resolves it strictly as `ggml-{model}.bin` with no fallback — so
             ticking `Rychlý model`, downloading its 575 MB perfectly, and
             finishing left the app reporting a missing `ggml-large-v3.bin` and
             reopening this wizard as required. The editor model has such a
             fallback; the transcription model does not, so it is written here.

             Written only if it landed, and only if it is not already the
             setting, so opening the list to add something unrelated cannot
             change which model transcribes. */
          const pickedModel = Object.values(MODELS).find(
            (choice) => startedHere.has(choice.component) && landed(choice.component)
          );
          if (pickedModel) {
            changesApplied.model = pickedModel.settings;
            // Ticking a model by hand answers the same question the cards ask.
            changesApplied.quality_choice = pickedModel.choice;
          }
          /* Ticking two editor models at once takes the larger, because
             `EDITOR_MODELS` is ordered largest first — the same order the cards
             on `Jazyková úprava` are drawn in and the same one
             `resolve_editor_model` in `tools.rs` falls back through. Whichever
             it picks, both files are on the disk and the other stays usable. */
          const selectedEditor = Object.keys(EDITOR_MODELS).find(
            (component) => startedHere.has(component) && landed(component)
          );
          if (selectedEditor) changesApplied.editor_model = EDITOR_MODELS[selectedEditor];
        }
        await api.saveSettings(changesApplied);
      } catch {
        /* settings can still be adjusted by hand */
      }
    },
    [quality, manual, startedHere]
  );

  const start = useCallback(async () => {
    setError(null);
    setProgress({});
    setRunning(true);
    setStep(STEP_DOWNLOAD);
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
      if (alreadyRunning(e)) return;
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
    setStep(STEP_DOWNLOAD);
    const retryIds = [...failedIds];
    setProgress((p) => {
      const n = { ...p };
      retryIds.forEach((id) => delete n[id]);
      return n;
    });
    try {
      await api.download(retryIds);
    } catch (e) {
      if (alreadyRunning(e)) return;
      setError(userMessage(e));
      setRunning(false);
    }
  }, [failedIds, userMessage]);

  const complete = selected.filter((id) => progress[id]?.phase === "complete").length;

  /** How much of the download is done, by size rather than by item count.
   *
   *  `complete / selected.length` is what the bar used to show, and with the
   *  batch ordered smallest-first it was wrong in the one direction that
   *  matters: it ran to the far end quickly and then appeared to stop. This
   *  weights each item by the megabytes the catalogue claims for it — the same
   *  number the reader agreed to on the line above — and gives the item in
   *  flight its own share of that.
   */
  const downloadedFraction = useMemo(() => {
    const sizeOf = (id: string) => items.find((p) => p.id === id)?.megabytes ?? 0;
    const total = selected.reduce((a, id) => a + sizeOf(id), 0);
    if (total <= 0) return 0;
    const done = selected.reduce((a, id) => {
      const phase = progress[id]?.phase;
      if (phase === "complete") return a + sizeOf(id);
      if (phase === "downloading" || phase === "extracting") {
        return a + (sizeOf(id) * (progress[id]?.percent ?? 0)) / 100;
      }
      return a;
    }, 0);
    return Math.min(done / total, 1);
  }, [selected, items, progress]);
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
    <main className="wizard">
      {/* The progress bar of steps, and not in the by-hand list either, for the
          reason the step counter is not: that mode is one screen reached from
          elsewhere, so three segments with the first already filled would draw
          a walk nobody took. */}
      {step < STEP_DONE && !manual && (
        <div className="steps" aria-hidden>
          {STEPS.map((i) => (
            <span key={i} className={i <= step ? "finished" : ""} />
          ))}
        </div>
      )}

      {error && step !== STEP_DONE && (
        <div className="warning">
          <div>
            <strong>{t("wizard.download.failedTitle")}</strong>
            <p className="small-text">{error}</p>
          </div>
          <button className="button" onClick={() => setError(null)}>
            {t("wizard.download.dismissError")}
          </button>
        </div>
      )}

      {/* --------------------------------------------- 0. the one question

          Four screens became one. Two of them asked nothing the machine did not
          already know — the welcome recited detected drivers, and the speaker
          step governed 28 MB — and the language editor's 5150 MB left the first
          run altogether. What is left is the only decision that is both
          consequential and awkward to reverse: changing the transcription model
          later means transcribing everything again.

          The detected configuration is not on it at all any more. It was a
          two-panel grid under the question — `KONFIGURACE / Grafická karta
          (Vulkan)` beside `PŘEPIS / na grafické kartě` — and the sentence
          directly above it already said *odhady časů platí pro grafickou kartu
          v tomto počítači*. Two panels restating the line above them, on the
          screen with the fewest words in the application. The sentence stays
          because it explains why the estimates say what they say; the panels
          went because they explained nothing.

          `usesGpu` is still read — it picks the recommended card and the two
          time estimates. What was removed is the announcement, not the
          detection. Do not put a status panel back here. */}
      {step === STEP_CHOICE && (
        <div className="step">
          <p className="step-number">
            {t("wizard.nav.stepCounter", { step: 1, total: STEPS.length })}
          </p>
          <h1>{t("wizard.quality.title")}</h1>
          <p className="step-intro">
            {usesGpu ? t("wizard.quality.introGpu") : t("wizard.quality.introCpu")}
          </p>

          {/* The two cards carry the marks their models carry in Settings —
              `ModelMark` keyed on the model identifier, so the lightning that
              means `large-v3-turbo` on the model list means it here too. The
              pair is honest as a pair: speed against precision is the trade
              these two make, and it is the one thing about them that has been
              measured (13 August, time alignment). */}
          <div className="choices wizard-quality-choices">
            {(["best", "fastest"] as Quality[]).map((k) => {
              const p = items.find((x) => x.id === MODELS[k].component);
              return (
                <button
                  key={k}
                  className={`choice with-icon ${quality === k ? "chosen" : ""}`}
                  aria-pressed={quality === k}
                  onClick={() => setChosen(k)}
                >
                  <span className="choice-icon" aria-hidden>
                    <ModelMark id={MODELS[k].settings} />
                  </span>
                  <span className="choice-body">
                    <span className="choice-title">
                      {t(MODELS[k].name)}
                      {k === recommendedQuality(usesGpu) && (
                        <em className="badge">{t("wizard.download.recommendedBadge")}</em>
                      )}
                      {/* `.complete`, the grass variant — the badge that means
                          *you already have this*. It was the plain accent one
                          beside `doporučeno`, so the two read as the same kind
                          of statement when one is a recommendation and the
                          other a fact about the disk. */}
                      {p?.complete && (
                        <em className="badge complete">
                          {t("wizard.download.downloadedBadge")}
                        </em>
                      )}
                    </span>
                    <span className="small-text">
                      {t(MODELS[k].summary, {
                        duration: approximateMinutes(estimatedMinutes(k, usesGpu)),
                      })}
                    </span>
                  </span>
                  {/* Outside the text block so it lands on the right edge, the
                      same place the badge takes on a module tile, rather than
                      drifting with the length of the model's name.

                      Nothing at all when the model is already there. It used to
                      render `dataSize(0)` — a card wearing a `staženo` badge and
                      `0 MB` beside it, saying the same thing twice and the
                      second time as a number that reads like a cost. A size on
                      this card means *this is what pressing it will fetch*, and
                      for a model on the disk there is no such number. */}
                  {!p?.complete && (
                    <span className="choice-size">{dataSize(p?.megabytes ?? 0)}</span>
                  )}
                </button>
              );
            })}
          </div>

          <InfoNote>{t("wizard.quality.changeableNote")}</InfoNote>

          <div className="step-footer">
            {!required && (
              <button className="button quiet" onClick={onBack}>
                {t("common.back")}
              </button>
            )}
            <button className="button primary" onClick={() => setStep(STEP_DOWNLOAD)}>
              {t("common.continue")}
            </button>
          </div>
        </div>
      )}
      {/* -------------------------------------- 1. summary and download */}
      {step === STEP_DOWNLOAD && (
        <div className="step">
          {/* No step counter in the by-hand list. It counts the guided run, and
              that mode is now only ever entered from outside the wizard —
              `Spravovat modely`, or a document asking for its model — so
              `Krok 2 ze 3` would number a walk the reader never took. While
              `Vybrat ručně` existed they could arrive here from step 1 and the
              number meant something; it stopped meaning anything with the
              button. */}
          {!manual && (
            <p className="step-number">
              {t("wizard.nav.stepCounter", { step: 2, total: STEPS.length })}
            </p>
          )}
          {/* `Co se stáhne` over the by-hand list was a mismatch worth naming
              rather than tolerating: that list is mostly things already on the
              disk, and the heading claimed everything under it was about to
              download. The **heading** is what changes, not the summary line
              below it — `Stáhne se 0 položek, dohromady 0 MB` is exactly true
              there and is the running total of what ticking has added up to,
              which is the one number that list has to keep showing. So the two
              modes say different things, decided by the same `manual` flag that
              already hides the step counter and the bar. */}
          <h1>
            {t(
              running
                ? "wizard.download.runningTitle"
                : manual
                  ? "wizard.manual.title"
                  : "wizard.download.reviewTitle"
            )}
          </h1>

          {/* The total belongs to the guided run, which fetches a set it
              chose. The by-hand list has no set: each row acts for itself, so a
              count of what is about to happen would be a count of nothing. */}
          {!running && !manual && (
            <p className="step-intro">
              {tPlural("wizard.download.summary", selected.length, {
                size: dataSize(totalMb),
              })}
            </p>
          )}

          {running ? (
            <>
              <div className="progress-large">
                <div className="progress-bar">
                  {/* Weighted by megabytes, not by how many items are done.
                      Counting items and downloading smallest-first is a bad
                      pair: for a default first run the four small pieces are a
                      fifth of the bytes and used to carry the bar to two
                      thirds, after which the one large model held it still for
                      the rest of the download. A bar that races and then stops
                      is worse than no bar. */}
                  <div
                    className="progress-fill"
                    style={{ width: `${downloadedFraction * 100}%` }}
                  />
                </div>
                <div className="progress-label">
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
                  <p className="small-text">
                    {t("wizard.download.megabytesProgress", {
                      downloaded: currentProgress.downloaded_mb.toFixed(0),
                      total: currentProgress.total_mb.toFixed(0),
                    })}
                  </p>
                )}
              </div>

              <DownloadListing
                ids={selected}
                items={items}
                progress={progress}
                view={view}
                onView={setView}
              />

              <div className="step-footer">
                <button className="button" onClick={() => api.cancelDownload()}>
                  {t("common.stop")}
                </button>
              </div>
            </>
          ) : (
            <>
              {manual ? (
                <ManualSelection
                  items={items}
                  view={view}
                  onView={setView}
                  progress={progress}
                  onInstall={installOne}
                  onCancel={() => void api.cancelDownload()}
                  onRemove={askToRemove}
                />
              ) : selected.length === 0 ? (
                <ul className="summary">
                  <li>
                    <span className="small-text">{t("wizard.download.nothingNeeded")}</span>
                  </li>
                </ul>
              ) : (
                <DownloadListing
                  ids={selected}
                  items={items}
                  progress={progress}
                  view={view}
                  onView={setView}
                />
              )}

              <div className="step-footer">
                {/* `Zpět` out of the by-hand list is the screen it was opened
                    from, not the question. Both ways into that mode come from
                    somewhere — `Spravovat modely` on `Nástroje`, or a document
                    asking for its model — and dropping the reader at *Rychle,
                    nebo přesně?* would put them on the one screen the mode
                    exists to avoid: finishing there writes `model`,
                    `diarization` and `editor_model` for somebody who opened a
                    list to look at it.

                    It used to read `manualFrom ?? STEP_CHOICE`, and the guided
                    run was the only caller that ever set `manualFrom`. With
                    that gone the fallback was all that was left, and the
                    fallback was the wrong answer. */}
                <button
                  className="button quiet"
                  onClick={() => (manual ? onBack() : setStep(STEP_CHOICE))}
                >
                  {t("common.back")}
                </button>
                {selected.length === 0 ? (
                  /* `Jdeme přepisovat` stood here — *to tlačítko je zbytečné* —
                     and it is `Zavřít` rather than deleted, which was checked
                     before touching it: this is the only other button on the
                     screen, so removing it leaves `Zpět` alone and no way to
                     finish a guided run on a machine that already has
                     everything. What it does is close the wizard, and closing
                     is what the finished screen's own button says two steps
                     further on. Writing the settings on the way out is not a
                     second action to name: `dokonci([])` records the answer to
                     the one question, which is true whether or not anything had
                     to be fetched. */
                  <button
                    className="button primary"
                    onClick={async () => {
                      await dokonci([]);
                      onComplete();
                    }}
                  >
                    {t("common.close")}
                  </button>
                ) : (
                  <button className="button primary" onClick={start}>
                    {t("wizard.download.downloadWithSize", { size: dataSize(totalMb) })}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------ 5. conclusion */}
      {step === STEP_DONE && (
        <div className={`step ${failedIds.length === 0 ? "step-outro" : ""}`}>
          {failedIds.length === 0 ? (
            <>
              <h1>{t("common.done")}</h1>
              <p className="step-intro">{t("wizard.done.introReady")}</p>
              <p className="small-text">
                {tabHint[0]}
                {/* i18n-ignore: the key is labelled F3 on every keyboard */}
                <strong>F3</strong>
                {tabHint[1] ?? ""}
              </p>
              <div className="step-footer">
                <button className="button primary" onClick={onComplete}>
                  {t("common.close")}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>{t(canTranscribe ? "wizard.done.almostTitle" : "wizard.done.failedTitle")}</h1>
              <p className="step-intro">
                {canTranscribe ? t("wizard.done.partialIntro") : t("wizard.done.missingIntro")}
              </p>

              <ul className="summary">
                {failedIds.map((id) => (
                  <li key={id} className="selhala">
                    <span>{itemName(id)}</span>
                    <span className="small-text">
                      {progress[id]?.message ? progressMessage(progress[id].message!) : ""}
                    </span>
                  </li>
                ))}
              </ul>

              {canTranscribe && <p className="small-text">{t("wizard.done.addLater")}</p>}

              <div className="step-footer">
                <button
                  className="button quiet"
                  onClick={() => {
                    setProgress({});
                    setStep(STEP_DOWNLOAD);
                  }}
                >
                  {t("wizard.done.backToSelection")}
                </button>
                <button
                  className={`button ${canTranscribe ? "" : "primary"}`}
                  onClick={retry}
                >
                  {t("common.retry")}
                </button>
                {canTranscribe && (
                  <button className="button primary" onClick={onComplete}>
                    {t("wizard.done.continueAnyway")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <ConfirmationDialog
        query={confirmation}
        onClose={() => setConfirmation(null)}
        onError={setError}
      />
    </main>
  );
}

/** Compact or full, over either listing — *identicky jako na archivu, teď jen
 *  ikony*.
 *
 *  The archive's own control, not an approximation of it: the same two glyphs
 *  drawn at the same 16 px on the same 1.3 stroke, the same roomy-then-dense
 *  order, `aria-pressed` on each button and an `aria-label` and `title` on it
 *  because an icon-only control that a screen reader announces as "button" is
 *  not the same control. Two rounded bars mean the roomy row, three lines the
 *  dense one, exactly as they do over the recordings.
 *
 *  **The one thing deliberately not carried over is the 40 px.** That height is
 *  documented in `.archive-view-toggle` as 32 px buttons matched to the filter
 *  select beside them in that toolbar. Neither listing has that neighbour, so
 *  both take the plain segmented control — 30 px button in a 36 px track, the
 *  default in `CLAUDE.md`. Carry the shape, not the measurement; this note is
 *  here because the next person will compare the two and wonder.
 *
 *  One component and one stored value for both lists, which is the point: they
 *  look alike and must not drift. What the two views mean is identical on both
 *  screens — full adds the catalogue's sentence under the name, compact does
 *  not, and nothing else about a row changes with it. */
function ListingSwitch({
  view,
  onView,
}: {
  view: ListingView;
  onView: (view: ListingView) => void;
}) {
  const { t } = useI18n();
  const label = (option: ListingView) =>
    t(option === "full" ? "wizard.download.viewFull" : "wizard.download.viewCompact");
  return (
    <div className="download-view">
      <div
        className="segmented-control listing-view-toggle"
        role="group"
        aria-label={t("wizard.download.viewLabel")}
      >
        {(["full", "compact"] as ListingView[]).map((option) => (
          <button
            key={option}
            type="button"
            className={view === option ? "active" : ""}
            aria-pressed={view === option}
            aria-label={label(option)}
            title={label(option)}
            onClick={() => onView(option)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              {option === "full" ? (
                <>
                  <rect x="2" y="2.5" width="12" height="4" rx="1.5"
                        stroke="currentColor" strokeWidth="1.3" />
                  <rect x="2" y="9.5" width="12" height="4" rx="1.5"
                        stroke="currentColor" strokeWidth="1.3" />
                </>
              ) : (
                <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11"
                      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              )}
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

/** What is about to be downloaded, read only.
 *
 *  Three of the owner's sentences landed on this list in a row and the shape is
 *  the resolution of all three rather than a compromise between them:
 *  *ten výpis je zbytečně velký*, then *ty popisky chybí, ten dvouřádkový výpis
 *  dával smysl*, then *dej tam přepínač na kompaktní a full výpis*.
 *
 *  So the row is one line or two, and the reader says which. Compact is the
 *  name and the size; full adds the catalogue's own sentence, which is the thing
 *  that says why 2 MB of `Detekce řeči` is on the list at all. Compact is the
 *  default because the objection to the height came first.
 *
 *  **Read-only, and built to look it.** The row it replaces was a control — a
 *  checkbox, a 22 px status circle, a hit area — from when ticking was this
 *  screen's main path. Nothing here can be ticked: the guided run downloads what
 *  the one question implies, and the list is there to be read before agreeing.
 *  No checkbox, no hover, no pointer.
 *
 *  The size is on every row in both views. The total above answers *how much*,
 *  and only the rows answer *which of these is the big one* — which is the
 *  question somebody actually has when a listing says 1,2 GB. Nothing complete
 *  ever reaches this list, so no row can say `0 MB`: `selected` is built from
 *  `!complete` throughout, and the total is a reduce over the same array, so the
 *  number agreed to and the number downloaded are one expression apart.
 *
 *  While the download runs the size gives way to the status. That keeps compact
 *  at one line rather than growing a second during the download, and it is the
 *  honest trade: once the bytes are moving, how big each item was is no longer
 *  the question and how far it has got is. */
function DownloadListing({
  ids,
  items,
  progress,
  view,
  onView,
}: {
  ids: string[];
  items: DownloadComponent[];
  progress: Record<string, DownloadProgress>;
  view: ListingView;
  onView: (view: ListingView) => void;
}) {
  const { t, tDynamic } = useI18n();
  const { dataSize } = useFormats();
  const running = ids.some((id) => progress[id]);

  return (
    <>
      <ListingSwitch view={view} onView={onView} />

      <ul className="download-list">
        {ids.map((id) => {
          const item = items.find((x) => x.id === id);
          const phase = progress[id]?.phase;
          return (
            <li key={id} className={phase === "complete" ? "done" : phase === "error" ? "failed" : ""}>
              <span className="download-row-text">
                <span className="download-row-name">
                  {item ? tDynamic(item.name_code, item.id) : id}
                </span>
                {view === "full" && (
                  <span className="small-text">{tDynamic(item?.description_code ?? "", "")}</span>
                )}
              </span>
              <span className="download-row-side">
                {running
                  ? phase === "complete"
                    ? t("wizard.download.statusDone")
                    : phase === "error"
                      ? t("wizard.download.statusError")
                      : phase
                        ? "…"
                        : t("wizard.download.statusWaiting")
                  : dataSize(item?.megabytes ?? 0)}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** One row of the by-hand list: what it is, how big, and the one thing you can
 *  do about it.
 *
 *  **The mark is the action.** A checkbox and a `Stáhnout` button at the foot
 *  gathered ticks and started them together, which is a batch flow — and a
 *  batch is only worth its ceremony when the items belong together. These do
 *  not: somebody opens this list to add one thing. Pressing the circle fetches
 *  that component and nothing else, which is what the model cards on `Přepis`
 *  already do and what makes the whole application one idea.
 *
 *  Three states in one 26 px column, so nothing shifts as a row changes:
 *
 *  - **not installed** — the accent circle with a downward arrow. Pressing it
 *    starts that download;
 *  - **installed** — the green tick. Under the pointer it becomes the arrow
 *    with a turn in it and offers to fetch the component again, which is the
 *    only repair this screen has for a file that arrived broken. Its
 *    `aria-label` changes with it, because a control whose meaning changes on
 *    hover and whose name does not is a control a screen reader lies about;
 *  - **running** — a ring that fills, and pressing it stops the download.
 *    `cancel_download` is the same flag the wizard's own Stop uses.
 *
 *  The one state with no action is an installed component the application is
 *  transcribing or editing with. `replaceable` comes from Rust and is false
 *  there: renaming a fresh file over one whisper has open is how a model is
 *  lost mid-run. That row keeps the tick and does not react — no dead button,
 *  the same rule the bin follows.
 */
function ComponentRow({
  item,
  view,
  progress,
  onInstall,
  onCancel,
  onRemove,
}: {
  item: DownloadComponent;
  view: ListingView;
  progress?: DownloadProgress;
  onInstall: (component: DownloadComponent) => void;
  onCancel: () => void;
  onRemove: (component: DownloadComponent) => void;
}) {
  const { t, tDynamic } = useI18n();
  const { dataSize } = useFormats();
  const running = !!progress && progress.phase !== "complete" && progress.phase !== "error";
  const acts = running || !item.complete || item.replaceable;

  const label = running
    ? t("common.stop")
    : item.complete
      ? t("wizard.manual.reinstall")
      : t("wizard.manual.install");

  return (
    <li className={`component ${item.complete ? "done" : ""}`}>
      <div className="component-row">
        {acts ? (
          <button
            type="button"
            className={`component-mark ${running ? "running" : item.complete ? "have" : "get"}`}
            aria-label={label}
            title={label}
            onClick={() => (running ? onCancel() : onInstall(item))}
            style={running ? { "--done": `${progress?.percent ?? 0}%` } as CSSProperties : undefined}
          >
            <ComponentMarkGlyph running={running} complete={item.complete} />
          </button>
        ) : (
          <span className="component-mark have static" aria-label={t("wizard.download.downloadedBadge")}>
            <ComponentMarkGlyph running={false} complete />
          </span>
        )}

        <span className="component-text">
          <span className="component-name">{tDynamic(item.name_code, item.id)}</span>
          {view === "full" && (
            <span className="small-text">{tDynamic(item.description_code, "")}</span>
          )}
        </span>

        {/* While it runs the size gives way to how far it has got: once the
            bytes are moving, how big it was is not the question. */}
        <span className="component-size">
          {running
            ? t("wizard.download.percent", { percent: progress?.percent ?? 0 })
            : dataSize(item.megabytes)}
        </span>

        {item.removable ? (
          <button
            type="button"
            className="component-remove"
            aria-label={t("wizard.manual.remove")}
            title={t("wizard.manual.remove")}
            onClick={() => onRemove(item)}
          >
            <LineIcon name="remove" size={16} />
          </button>
        ) : (
          <span className="component-remove-space" aria-hidden />
        )}
      </div>
    </li>
  );
}

/** The tick, the arrow, or the arrow with a turn — decided by state, drawn on
 *  one 14×14 grid so the three sit at the same optical weight in the circle. */
function ComponentMarkGlyph({ running, complete }: { running: boolean; complete: boolean }) {
  if (running) {
    return (
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" fill="currentColor" />
      </svg>
    );
  }
  if (complete) {
    return (
      <>
        <svg className="mark-rest" width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 7.2 5.7 10 11 4.5" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* The redownload, shown in place of the tick under the pointer: the
            same arrow as the install glyph with a turn added, so the two read
            as the same action rather than two ideas. */}
        <svg className="mark-hover" width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M11.5 6a4.6 4.6 0 1 0-.6 3.4" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" />
          <path d="M11.6 2.4v3.4H8.2" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 2.2v7.2M4 6.6 7 9.6l3-3M3 11.8h8" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The by-hand list: everything the catalogue holds, grouped, with one action
 *  on each row.
 *
 *  It used to carry a selection — a checkbox per row, a running total, and a
 *  `Stáhnout` at the foot that started what had been ticked. All three are
 *  gone with the ticking. Nothing gathers a batch any more, so a total of what
 *  has been gathered describes a thing that does not happen, and two ways to
 *  start one download is worse than either.
 */
function ManualSelection({
  items,
  view,
  onView,
  progress,
  onInstall,
  onCancel,
  onRemove,
}: {
  items: DownloadComponent[];
  view: ListingView;
  onView: (view: ListingView) => void;
  progress: Record<string, DownloadProgress>;
  onInstall: (component: DownloadComponent) => void;
  onCancel: () => void;
  onRemove: (component: DownloadComponent) => void;
}) {
  const { t } = useI18n();

  /* Four headings, and the third holds two rows that used to be a heading
     each: finding where somebody is speaking, and telling whose voice it is.
     Both decide something about the sound rather than about the words, and
     `Detekce řeči` had a heading of its own over one 2 MB line. The grouping
     is the catalogue's — `download.rs` gives both components the group
     `speech` — so this list and anything else that reads a group agree. */
  const groups: Array<[string, TranslationKey]> = [
    ["program", "wizard.manual.groupPrograms"],
    ["model", "wizard.manual.groupModels"],
    ["speech", "wizard.manual.groupSpeech"],
    ["editor", "wizard.manual.groupEditor"],
  ];
  return (
    <div className="manual">
      {/* The same control and the same stored preference as the wizard's own
          listing — `ListingSwitch`, `localStorage["download-view"]`. */}
      <ListingSwitch view={view} onView={onView} />
      {groups.map(([key, titleKey]) => (
        <div key={key}>
          <h2>{t(titleKey)}</h2>
          <ul className="components">
            {items
              .filter((p) => p.group === key)
              /* The two middle models are not offered here either — that is
                 the owner's call and it makes the rule the same everywhere.
                 One that is already on the disk stays visible: this list is
                 also how somebody reads what this machine holds, and hiding a
                 gigabyte that is there would make it lie in the other
                 direction. */
              .filter((p) => p.complete || !UNOFFERED_COMPONENTS.includes(p.id))
              .map((p) => (
                <ComponentRow
                  key={p.id}
                  item={p}
                  view={view}
                  progress={progress[p.id]}
                  onInstall={onInstall}
                  onCancel={onCancel}
                  onRemove={onRemove}
                />
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
