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
import { useDialog } from "./useDialog";
import {
  EDITOR_MODELS,
  UNOFFERED_COMPONENTS,
  type QualityChoice,
} from "./types";
import type { DownloadComponent, ToolCheck, DownloadProgress } from "./types";

interface Props {
  onComplete: () => void;
  /** The way out. On the guided run it is also what Escape and the scrim do. */
  onBack: () => void;
  /** The wizard opened by itself because transcription is impossible without it.
   *
   *  It decides the shell as well as the path: **true is a dialog over the
   *  archive, false is a screen of its own.** A first run is one question and
   *  its download, and the archive behind the dialog says *you have arrived*
   *  where a full screen said *you are blocked*; the by-hand component list is
   *  a table reached from Settings and keeps the 720 px screen it was given. */
  required: boolean;
  /** id of the module to preselect for installation */
  missingModule?: string | null;
  /** Where a failure goes when this is a screen rather than a dialog.
   *
   *  The application has one place for saying something went wrong — the bar
   *  under the header — and a listing that drew its own red panel instead was a
   *  second one. On a screen the bar is right there and is the answer.
   *
   *  **It is not the answer in the dialog**, and that is why the panel below
   *  survives for that case: the bar sits in normal flow under the header while
   *  `.dialog-overlay` is fixed at `z-index: 60`, so a message sent to it during
   *  a first run would be painted behind the scrim. An error nobody can see is
   *  worse than one in a panel. */
  onError?: (text: string) => void;
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
    /** The model, and what the reader gets — **the catalogue's own sentence**,
     *  the one the model card in Settings draws.
     *
     *  It used to be `wizard.quality.fastestSummary` and `bestSummary`, a pair
     *  of sentences this screen kept for itself. Two consequences, and both had
     *  already bitten this branch: the wizard and Settings could describe one
     *  model two ways — the defect written up on 14 August, when the by-hand
     *  listing was found still printing a claim deleted from the card two
     *  commits earlier — and the owner's own wording (`Whisper 3 Large.
     *  Kvalitnější přepis. Precizní časové značky slov.`) reached every screen
     *  except the first one anybody sees.
     *
     *  So the model's name is on the card after all. The entry that kept it off
     *  argued `Whisper large-v3-turbo` was noise on a first run, and it was
     *  right about *that* string; what ships here is the reader's form of the
     *  name in front of a sentence he wrote, which is what the brief asks the
     *  card to carry. */
    description: TranslationKey;
  }
> = {
  fastest: {
    component: "model-turbo",
    settings: "large-v3-turbo-q5_0",
    choice: "fast",
    name: "wizard.quality.fastestName",
    description: "domain.modelDescription.large-v3-turbo-q5_0",
  },
  best: {
    component: "model-large",
    settings: "large-v3",
    choice: "accurate",
    name: "wizard.quality.bestName",
    description: "domain.modelDescription.large-v3",
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

/** Rough estimate for an hour-long recording, in minutes. Only the number lives
 *  here — the phrase around it needs the active language's plural rules and is
 *  assembled by `useFormats`.
 *
 *  **These four numbers have never been measured, and the screen now says so.**
 *  The original comment claimed a Radeon RX 9070 and no entry in
 *  `docs/history/` ever took, checked or contradicted them; they are the oldest
 *  figures in the interface. That was tolerable while the screen said nothing
 *  about the machine. It stopped being tolerable the moment the sentence above
 *  the cards began naming this computer's graphics card and its memory, because
 *  a page that demonstrates it has read the hardware is a page whose numbers
 *  read as having been read off it too.
 *
 *  Two ways out were available and one was taken. **Not taken: deriving them
 *  from what was detected** — memory is now known, and a formula over it would
 *  have turned four honest guesses into a fabricated model with a number for
 *  every machine and evidence for none. **Taken: saying it in the copy.**
 *  `wizard.quality.changeableNote` opens with *Časy jsou hrubý odhad, ne
 *  měření*, which is the plainest true thing available, and the reason line on
 *  the recommended card avoids a ratio for the same reason.
 *
 *  Settling them is still one command away: `benchmark_compute` is the
 *  application's own timer and could answer this in twenty seconds a backend.
 *  It cannot run *here* — it needs an installed model and a recording, and a
 *  first run has neither — so the measurement belongs on a machine that has
 *  been through this screen, not on the screen itself. */
function estimatedMinutes(quality: Quality, usesGpu: boolean): number {
  const t: Record<Quality, [number, number]> = {
    fastest: [1, 8],
    best: [4, 35],
  };
  return t[quality][usesGpu ? 0 : 1];
}

/** Which model the machine is steered towards.
 *
 *  One function, used for both the recommendation and the initial selection,
 *  because they used to be computed apart and disagreed: the state started on
 *  *Vyvážený* while the badge was `usesGpu ? "balanced" : "fastest"`, so a
 *  computer with no graphics card showed one option chosen and a different one
 *  recommended — and the backend sided with the badge.
 *
 *  **Memory is read now and is deliberately not one of the inputs.** It is on
 *  the screen because the reader recognises their own machine in it, which is
 *  what makes the rest of the sentence credible. Deciding by it would need a
 *  threshold — how much memory the larger model wants before it is a bad idea —
 *  and nothing in this repository has ever measured one. A recommendation is
 *  the one place a guess costs the reader gigabytes. */
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
   `[0,1,2,3,4]` bar that had to be kept in step with them by hand.

   The `STEPS` array went with the segmented bar and the `Krok 1 ze 3` counter
   above it. Both drew a walk over an errand that is a question and a download,
   inside a dialog that is itself the thing being counted; and the download has
   a progress bar of its own, reporting bytes rather than screens. */
const STEP_CHOICE = 0;
const STEP_DOWNLOAD = 1;
const STEP_DONE = 2;

export default function SetupWizard({
  onComplete,
  onBack,
  required,
  missingModule,
  onError,
}: Props) {
  const { t, tDynamic, tPlural } = useI18n();
  const { minutes, dataSize } = useFormats();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();

  /** Whether this is the by-hand component list rather than the guided run.
   *
   *  Nothing on screen sets it: it follows from how the wizard was opened and is
   *  never toggled. `Spravovat modely a nástroje` and `missingModule` are the
   *  two ways in, and both arrive with `required` false — so in this mode `Zpět`
   *  means the screen the reader came from.
   *
   *  **Read at the first render rather than in `load`**, which is where it used
   *  to be decided once the catalogue had arrived. It was the same answer either
   *  way, from the same two props, and being late cost something the moment the
   *  column's width came to depend on it: the screen opened at the guided run's
   *  620 px and jumped to 720 when the catalogue landed. It also opened on the
   *  wrong screen for an instant — the one question, on the way to a listing
   *  nobody had asked a question about. A layout that settles after it is drawn
   *  is a layout the reader watches move. */
  const listing = !required || !!missingModule;

  const [step, setStep] = useState(listing ? STEP_DOWNLOAD : STEP_CHOICE);
  const [items, setItems] = useState<DownloadComponent[]>([]);
  const [check, setCheck] = useState<ToolCheck | null>(null);

  /* Null until somebody presses one. The recommendation depends on drivers
     that are still being read when this screen first renders, so a state that
     started on a named choice could only ever start on the wrong one — which
     is exactly how the badge and the selection came to disagree. */
  const [chosen, setChosen] = useState<Quality | null>(null);
  /** The same answer under the name the rest of this file has always used. */
  const manual = listing;
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

  /** Escape and the focus trap, for the guided run's dialog.
   *
   *  **Escape is withheld while a download runs**, which `useDialog` supports
   *  by taking no `onClose`. The setting this wizard exists to write is written
   *  by the `download:complete` listener, and that listener lives in this
   *  component — so a key pressed at the wrong moment would unmount the one
   *  thing waiting to record which model the reader chose, leaving the bytes on
   *  the disk and the answer nowhere. `Přerušit` is the way to stop a download
   *  and it is the only button on screen while one is running.
   *
   *  In the by-hand list the ref is attached to nothing and the hook does
   *  nothing: that mode is a page, and its own dialogs bring their own trap. */
  const setupDialog = useDialog<HTMLDivElement>(running ? undefined : onBack, !listing);

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
      const size = dataSize(component.megabytes);
      /* Three sentences for three situations, and the difference is worth the
         two extra keys: deleting the model the application is set to use is not
         the same act as deleting a spare, and being told afterwards that it
         changed which model transcribes would be a surprise the dialog could
         have prevented. `replaced_by` is Rust's answer and is also the value it
         writes into the settings once the files are gone, so the sentence
         cannot promise one thing and the setting say another. */
      const next = component.replaced_by
        ? tDynamic(
            items.find((x) => x.id === component.replaced_by)?.name_code ?? "",
            component.replaced_by
          )
        : "";
      setConfirmation({
        title: t("wizard.manual.removeTitle", { name }),
        text: !component.configured
          ? t("wizard.manual.removeText", { size })
          : next
            ? t("wizard.manual.removeChosenText", { size, next })
            : t("wizard.manual.removeLastText", { size }),
        confirm: t("wizard.manual.remove"),
        destructive: true,
        action: async () => {
          await api.removeComponent(component.id);
          setItems(await api.catalog());
          // Deleting a component this visit had fetched un-records it, so
          // `dokonci` does not go on to name a model that is no longer there.
          setStartedHere((current) => {
            const remaining = new Set(current);
            remaining.delete(component.id);
            return remaining;
          });
        },
      });
    },
    [t, tDynamic, dataSize, items]
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
           screen asking a question it already has the answer to.

           `manual` is not set here any more — it is the first render's answer
           to the same two props, so the column has its width before anything
           is drawn. */
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
           about either. Opening the list instead means looking costs nothing.

           `manual` is already true here, from the first render — see the state
           above. Only the step still waits for the catalogue. */
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

  /* `machineSentence` stood here and is gone with the five strings that built
     it. It recited what was found in this computer — a graphics card, and how
     much memory — and the owner struck it out on 2026-08-16 for a reason that
     is not about tone: **from the amount of memory it does not follow where the
     transcription runs.** Two unrelated facts joined by a *takže* that carried
     no argument.

     The sentence there now is `wizard.quality.intro`, and it answers what a
     reader has before choosing rather than what the machine has: nothing leaves
     this computer, and the two cards differ in one thing only. The machine is
     still read — `usesGpu` decides the times and which card is recommended —
     it is simply no longer recited. */

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
        /* The conclusion belongs to the guided run and to nothing else. In the
           by-hand list every row starts its own download, so this event arrives
           whenever one of fifteen rows finishes — and it was taking the reader
           off the list they were reading and onto *Vše je připraveno*, a
           conclusion to a walk they were not on. `load()` above has already
           refreshed the row's own tick, which is the whole of what that mode
           has to report. */
        if (!manual) setStep(STEP_DONE);
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

  /** The failure banner, drawn by whichever shell is on screen.
   *
   *  In the dialog it stands between the sentence and the content, so it owns
   *  the 18 px below itself rather than above — a dialog's content blocks never
   *  carry a `margin-top`, and `.dialog h2 + p` has already placed the gap
   *  above it. See `.setup-dialog > .warning`. */
  /* No panel of its own any more, in either mode. The application has one
     place for saying something went wrong — the bar under the header — and the
     only reason this screen ever drew a second one was that the bar could not
     be seen over a dialog. It can now; see `.notice` in `01-base.css`. */

  /* The listing has no panel of its own, so what `setError` collected is handed
     to the bar and cleared. Rendering neither would swallow it. */
  useEffect(() => {
    if (!error) return;
    onError?.(error);
    setError(null);
  }, [error, onError]);

  /* -------------------------------------------------- the by-hand listing

     A screen of its own, at the settings column's 720 px, because that is what
     it is: a table of everything this machine can hold, reached from Settings
     or from a document asking for its model. Every decision made about it on
     14 August was about a page — the width, the row, the bin, the lock — and
     none of them is touched here.

     It draws one step and only one. It used to share the guided run's
     `step === STEP_DOWNLOAD` branch and to follow it into `STEP_DONE`, which
     is how finishing a single row's download landed the reader on *Vše je
     připraveno* — a conclusion to a walk they were not on, with the list they
     were reading gone from under them. The listener no longer moves the step
     in this mode; see the comment on it. */
  if (manual) {
    return (
      <main className="wizard wizard-listing">
        <div className="step">
          <h1>{t("wizard.manual.title")}</h1>
          <ManualSelection
            items={items}
            view={view}
            onView={setView}
            progress={progress}
            onInstall={installOne}
            onCancel={() => void api.cancelDownload()}
            onRemove={askToRemove}
          />
          <div className="step-footer">
            {/* `Zpět` is the screen this list was opened from — `Spravovat
                modely a nástroje` on `Nástroje`, or a document asking for its
                model. `Zavřít` is the other way out and does one thing more:
                `dokonci([])` turns a model fetched here into the setting that
                names it, which is what keeps the application from going on
                demanding one it does not have. */}
            <button className="button quiet" onClick={onBack}>
              {t("common.back")}
            </button>
            <button
              className="button primary"
              onClick={async () => {
                await dokonci([]);
                onComplete();
              }}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
        <ConfirmationDialog
          query={confirmation}
          onClose={() => setConfirmation(null)}
          onError={setError}
        />
      </main>
    );
  }

  /* ------------------------------------------------------ the guided run

     A dialog over the archive. *Ten průvodce vypadá děsně. Musíme ho udělat
     znova a asi by to měl být splash screen po spuštění. Nebo takový větší
     dialog.* — the dialog, of the two he offered: a splash reads as an
     advertisement and is clicked through unread, and the application drawn
     behind this one says *you have arrived* where a full screen said *you are
     blocked*.

     520 px, which `CLAUDE.md` fixes for a column of choice cards, and it is
     what the cards need rather than what was left over: stacked full width,
     each has room for a real sentence, which side by side they did not.

     No click-outside close. Every other dialog in the application dismisses on
     the scrim; this one owns a download and the setting written at the end of
     it, and a stray click beside it must not be how that ends. `Zavřít` and
     Escape are the way out — and Escape only while nothing is downloading, see
     `setupDialog`. */
  return (
    <div className="dialog-overlay">
      <div
        ref={setupDialog}
        className="dialog setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-dialog-title"
      >
        {/* --------------------------------------------- 0. the one question

            Four screens became one. Two of them asked nothing the machine did
            not already know, and the language editor's 5150 MB left the first
            run altogether. What is left is the only decision that is both
            consequential and awkward to reverse: changing the transcription
            model later means transcribing everything again.

            **The sentence under the heading no longer recites the hardware**,
            and the two-panel grid it replaced stays deleted. See the note where
            `machineSentence` used to be built. */}
        {step === STEP_CHOICE && (
          <>
            <h2 id="setup-dialog-title">{t("wizard.quality.title")}</h2>
            <p>{t("wizard.quality.intro")}</p>
    
            {/* **Two cards side by side, each standing on end.** Below one
                another two things are read; beside one another they are
                compared — and this screen is a comparison. The frame, the
                radius, the accent and the dialog's rhythm are all still the
                system's; what changes is the axis and what a card holds.

                This is the one place in the application where `.choice` is not
                the whole story, and it is deliberate rather than an oversight.
                A choice card in Settings is one row of eight; this is the only
                question the screen asks and the only one that is awkward to
                take back. `.setup-choices` says so in the stylesheet.

                The card holds three things in this order: its name with the
                badge, the catalogue's own sentence about the model — so this
                screen and Settings cannot describe one model two ways — and a
                recessed foot with the two figures the choice is made on.

                **The foot is pinned to the bottom, not trailing the text.** It
                therefore sits on the same axis in both cards however many lines
                the description takes, and that alignment is what turns two
                cards into a comparison. */}
            <div className="choices setup-choices">
              {(["best", "fastest"] as Quality[]).map((k) => {
                const p = items.find((x) => x.id === MODELS[k].component);
                const duration = minutes(estimatedMinutes(k, usesGpu));
                return (
                  <button
                    key={k}
                    className={`choice ${quality === k ? "chosen" : ""}`}
                    aria-pressed={quality === k}
                    onClick={() => setChosen(k)}
                  >
                    <span className="choice-top">
                      <span className="choice-head">
                        <span className="choice-icon" aria-hidden>
                          <ModelMark id={MODELS[k].settings} />
                        </span>
                        <span className="choice-title">
                          {t(MODELS[k].name)}
                          {/* One word, in the accent pill. It replaced three
                              lines of reasoning on 2026-08-16: the argument for
                              a sentence held, but it was the loudest thing on
                              the screen and stood on the card already chosen. */}
                          {k === recommendedQuality(usesGpu) && (
                            <em className="badge">{t("wizard.quality.recommended")}</em>
                          )}
                          {/* `.complete`, the grass variant — *you already have
                              this*. */}
                          {p?.complete && (
                            <em className="badge complete">
                              {t("wizard.download.downloadedBadge")}
                            </em>
                          )}
                        </span>
                      </span>
                      <span className="small-text">{t(MODELS[k].description)}</span>
                    </span>

                    {/* The figures, one per line with the icon that names the
                        subject: a clock for the time, a downward arrow for the
                        megabytes. Both are already in `icons.tsx`.

                        The number comes first and the words after it, and the
                        line cannot wrap. Written the other way round — *Hodinová
                        nahrávka za 4 minuty* — it filled 175 px of a 198 px
                        column, so a longer figure broke one card's foot and not
                        the other's, and the alignment the whole layout rests on
                        went with it. */}
                    <span className="choice-foot">
                      <span className="choice-stat">
                        <LineIcon name="clock" size={14} />
                        <b>{duration}</b> {t("wizard.quality.perHour")}
                      </span>
                      {/* A model already on the disk costs no download; the
                          badge above has said why the line is missing. */}
                      {!p?.complete && (
                        <span className="choice-stat">
                          <LineIcon name="download" size={14} />
                          <b>{dataSize(p?.megabytes ?? 0)}</b> {t("wizard.quality.toDownload")}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <InfoNote compact>{t("wizard.quality.changeableNote")}</InfoNote>

            <div className="dialog-footer">
              {/* A way out even on a required first run, which is what the
                  screen this replaces had in the application bar. The archive
                  behind the dialog says what is missing and offers to finish
                  for as long as transcription cannot run, so an errand nobody
                  can leave would be worse than one they can. */}
              <button className="button quiet" onClick={onBack}>
                {t("common.close")}
              </button>
              <button className="button primary" onClick={() => setStep(STEP_DOWNLOAD)}>
                {t("common.continue")}
              </button>
            </div>
          </>
        )}

        {/* -------------------------------------- 1. summary and download */}
        {step === STEP_DOWNLOAD && (
          <>
            <h2 id="setup-dialog-title">
              {t(running ? "wizard.download.runningTitle" : "wizard.download.reviewTitle")}
            </h2>
            {/* **The summing sentence is gone.** It read *Stáhne se 5 položek,
                dohromady 3,4 GB* — but the count is the list directly under it
                and the size is on the button beside it, so the dialog's one
                line was spending itself saying a third time what the screen
                already said twice.

                What stands here says what neither of them does: this happens
                once, and afterwards the application does not need the internet.
                While it runs it says the other thing nobody could tell from the
                bar — that the window does not have to be watched.

                Where there is nothing to fetch it still says so instead. */}
            <p>
              {selected.length === 0
                ? t("wizard.download.nothingNeeded")
                : t(running ? "wizard.download.runningText" : "wizard.download.reviewText")}
            </p>
    
            {running ? (
              <>
                <div className="progress-large">
                  <div className="progress-bar">
                    {/* Weighted by megabytes, not by how many items are done.
                        Counting items and downloading smallest-first is a bad
                        pair: for a default first run the four small pieces are
                        a fifth of the bytes and used to carry the bar to two
                        thirds, after which the one large model held it still
                        for the rest of the download. A bar that races and then
                        stops is worse than no bar. */}
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

                <DownloadListing ids={selected} items={items} progress={progress} view={view} />

                <div className="dialog-footer">
                  <button className="button" onClick={() => api.cancelDownload()}>
                    {t("common.stop")}
                  </button>
                </div>
              </>
            ) : (
              <>
                {selected.length > 0 && (
                  <DownloadListing ids={selected} items={items} progress={progress} view={view} />
                )}

                <div className="dialog-footer">
                  <button className="button quiet" onClick={() => setStep(STEP_CHOICE)}>
                    {t("common.back")}
                  </button>
                  {selected.length === 0 ? (
                    /* `Jdeme přepisovat` stood here — *to tlačítko je
                       zbytečné* — and it is `Zavřít` rather than deleted, which
                       was checked before touching it: removing it leaves `Zpět`
                       alone and no way to finish a guided run on a machine that
                       already has everything. Writing the settings on the way
                       out is not a second action to name: `dokonci([])` records
                       the answer to the one question, which is true whether or
                       not anything had to be fetched. */
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
          </>
        )}

        {/* ------------------------------------------------ 2. conclusion */}
        {step === STEP_DONE && (
          <>
            {failedIds.length === 0 ? (
              <>
                <h2 id="setup-dialog-title">{t("common.done")}</h2>
                <p>{t("wizard.done.introReady")}</p>
                {/* `.step-outro` centred all of this on the screen it replaced.
                    A dialog is already the middle of the window, and centred
                    prose inside one reads as a certificate. */}
                <p className="small-text">
                  {tabHint[0]}
                  {/* i18n-ignore: the key is labelled F3 on every keyboard */}
                  <strong>F3</strong>
                  {tabHint[1] ?? ""}
                </p>
                <div className="dialog-footer">
                  <button className="button primary" onClick={onComplete}>
                    {t("common.close")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="setup-dialog-title">
                  {t(canTranscribe ? "wizard.done.almostTitle" : "wizard.done.failedTitle")}
                </h2>
                <p>
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

                <div className="dialog-footer">
                  <button
                    className="button quiet"
                    onClick={() => {
                      setProgress({});
                      setStep(STEP_DOWNLOAD);
                    }}
                  >
                    {t("wizard.done.backToSelection")}
                  </button>
                  <button className={`button ${canTranscribe ? "" : "primary"}`} onClick={retry}>
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
          </>
        )}
      </div>
    </div>
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
}: {
  ids: string[];
  items: DownloadComponent[];
  progress: Record<string, DownloadProgress>;
  view: ListingView;
}) {
  const { t, tDynamic } = useI18n();
  const { dataSize } = useFormats();

  /* No `ListingSwitch` here, and it is not an oversight.
   *
   *  Choosing between a short and a long listing is a *setting*, and this is a
   *  first run: one decision has already been asked for, and a second one about
   *  how the answer is displayed competes with it. The by-hand listing in
   *  Settings keeps the control, because that is a table somebody opens again
   *  and again — this is five rows seen once.
   *
   *  The stored preference is untouched: `localStorage["download-view"]` still
   *  decides what this listing shows, so anybody who chose the long one on the
   *  listing page sees the long one here too. What went is the control, not the
   *  choice. */
  return (
    <ul className="components">
      {ids.map((id) => {
        const item = items.find((x) => x.id === id);
        const phase = progress[id]?.phase;
        const done = phase === "complete";
        const failed = phase === "error";
        const live = !!phase && !done && !failed;
        return (
          <li key={id} className="component">
            <div className="component-row">
              {/* The same mark the module listing draws, in the same three
                  states and the same two colours — a tick on grass when it is
                  here, the accent arrow when it is not, the accent ring while
                  bytes move. It was `hotovo` and `…` as words until
                  2026-08-16, and three dots are not a state.

                  A `span`, not the listing's `button`: there, pressing the mark
                  installs or cancels that one component. Here the whole run is
                  one press and the footer owns it, so a mark that looked
                  pressable would offer something it cannot do. */}
              <span
                className={`component-mark static ${
                  failed ? "get" : live ? "running" : done ? "have" : "get"
                }`}
                aria-label={t(
                  done
                    ? "wizard.download.statusDone"
                    : failed
                      ? "wizard.download.statusError"
                      : live
                        ? "wizard.download.runningTitle"
                        : "wizard.download.statusWaiting"
                )}
              >
                {live && <ProgressRing percent={progress[id]?.percent ?? 0} />}
                {/* `running` is passed as false on purpose, so the glyph stays
                    the arrow rather than becoming the square.
                    **The square means *press to stop*** — in the module listing
                    this mark is a button and that is what it does. Here it is a
                    `span`, so drawing the square offered a control that does
                    nothing: an icon promising an action it cannot perform.
                    The ring around it already says the row is working, and
                    stopping the run is the footer's button. */}
                <ComponentMarkGlyph running={false} complete={done} />
              </span>

              <span className="component-text">
                <span className="component-name">
                  {item ? tDynamic(item.name_code, item.id) : id}
                </span>
                {view === "full" && (
                  <span className="small-text">{tDynamic(item?.description_code ?? "", "")}</span>
                )}
              </span>

              {/* Once the bytes are moving, how big it was is not the question. */}
              <span className="component-size">
                {live
                  ? t("wizard.download.percent", { percent: progress[id]?.percent ?? 0 })
                  : failed
                    ? t("wizard.download.statusError")
                    : dataSize(item?.megabytes ?? 0)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
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
 *  The one state with no action is a component something is using right now.
 *  `replaceable` comes from Rust and is false there: renaming a fresh file over
 *  one whisper has open is how a model is lost mid-run. That row keeps the tick
 *  and does not react — no dead button, the same rule the lock follows.
 *
 *  **The trailing column is a bin, a lock, or a space**, in that order of
 *  preference and always 26 px wide. The lock is what an installed row wears
 *  when it may not be deleted, and its tooltip says which of the two reasons it
 *  is — *OK tak těm dej ikonu zámku a napiš do tooltipu na hover, co znamená*.
 *  A blank column said nothing at all: a bin on one row and space on the next
 *  reads as a defect rather than as a rule. A row with nothing installed keeps
 *  the space, because there the emptiness is not a puzzle.
 */
/** The two reasons a row wears a lock, and the sentence each one says.
 *
 *  Rust decides which — `remove_block` on the component — because both answers
 *  are about the disk and about what the application is doing, and neither is
 *  anything the window could work out for itself. */
const LOCK_REASON = {
  busy: "wizard.manual.lockedBusy",
  unlisted: "wizard.manual.lockedUnlisted",
} as const;

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
          >
            {running && <ProgressRing percent={progress?.percent ?? 0} />}
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
        ) : item.remove_block ? (
          /* A lock, in the bin's own place. Blank space told the reader
             nothing: a bin on one row and nothing on the next reads as a defect
             rather than as a rule. The sentence is both the tooltip and the
             accessible name — a `title` alone is read by nobody using a screen
             reader — and there are two of them, because one covering both cases
             would explain neither: busy is waited out, unrecorded is fixed by
             fetching the component again. */
          <span
            className="component-lock"
            aria-label={t(LOCK_REASON[item.remove_block])}
            title={t(LOCK_REASON[item.remove_block])}
          >
            <LineIcon name="lock" size={16} />
          </span>
        ) : (
          <span className="component-remove-space" aria-hidden />
        )}
      </div>
    </li>
  );
}

/** How far a download has got, drawn as **the mini player's ring**.
 *
 *  It was a conic gradient with a disc punched out of the middle — *ten progress
 *  ring je při stahování moc silný* — and the answer to how thin is not a number
 *  somebody picks: *stejně, jako je v mini playeru*. The application already had
 *  a ring saying how far through something is, and a second one at another
 *  weight would have been two visual languages for one idea.
 *
 *  So this is that ring, drawn the same way rather than merely to the same
 *  thickness: two SVG circles sharing a radius, the track under the accent arc,
 *  the arc shortened with `stroke-dashoffset`, and `.mini-track` /
 *  `.mini-progress` themselves reused so the weight cannot drift in one place
 *  and not the other. The geometry is the player's, moved from a 30 px box to
 *  this 26 px one: stroke 2, and a radius that leaves the same 1.5 px between
 *  the ring and the edge of the control.
 *
 *  **The track is what makes three per cent visible.** With the arc alone the
 *  first seconds of a download would read as nothing happening, which is the
 *  opposite of what the ring is for; against the track the round cap is a mark
 *  on a circle from the first tick.
 */
function ProgressRing({ percent }: { percent: number }) {
  const radius = 10.5;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, percent / 100));
  return (
    <svg className="component-ring" width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <circle className="mini-track" cx="13" cy="13" r={radius} />
      <circle
        className="mini-progress"
        cx="13"
        cy="13"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
      />
    </svg>
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
        /* Named rather than left as a bare `div`: the space between groups is
           set on `.manual-group + .manual-group`, and a selector reading
           `div + div` would have caught the view switch above the first one. */
        <div key={key} className="manual-group">
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
