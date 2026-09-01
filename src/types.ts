/** What Rust sends instead of a finished sentence: a stable code, the values
 *  that belong in it, and a technical text for codes the dictionary does not
 *  cover yet. `useUserMessage` in `messages.ts` turns it into words. */
export interface UserMessage {
  code: string;
  params: Record<string, string>;
  detail: string;
}

export type Status = "new" | "transcribing" | "done" | "error";

/** The class that paints a recording's status dot.
 *
 *  The stored value and the class name are separate things that happen to look
 *  alike since schema 3, when the four statuses stopped being Czech. Keeping the
 *  map is not ceremony: before it existed the markup handed the stored value
 *  straight to `className`, so renaming `.hotova` to `.done` in the stylesheet
 *  turned every dot grey, in every row of the archive, and nothing failed. The
 *  stylesheet is free to call a class what it likes — `error` is painted by
 *  `.failed` — and `Record<Status, string>` is the guard: a new status without
 *  a class will not compile.
 */
export const STATUS_CLASS: Record<Status, string> = {
  new: "new",
  transcribing: "transcribing",
  done: "done",
  error: "failed",
};

export function statusClass(status: string): string {
  return STATUS_CLASS[status as Status] ?? "";
}

export interface Recording {
  id: string;
  path: string;
  title: string;
  duration: number;
  created_at: string;
  status: Status;
  model: string;
  /** Language code the transcript ran in */
  language: string;
  language_choice: string;
  /** Why the last attempt failed. A stored `UserMessage` in archives written
   *  by this version, a finished Czech sentence in older ones. */
  error: string | null;
  segment_count: number;
  /** The folder holding the recording; null is the archive's root. */
  folder: string | null;
  /** Where an online import fetched the audio from. Null when the origin is not
   *  known — a file opened from the disk never had one, and an online import
   *  made before the archive stored it no longer has one. */
  source_url: string | null;
}

/** A folder in the archive, with what it holds. */
export interface Folder {
  id: string;
  name: string;
  created_at: string;
  recording_count: number;
  duration: number;
}

export interface Segment {
  id: string;
  recording_id: string;
  order: number;
  start: number;
  end: number;
  text: string;
  speakers: string | null;
  confidence: number | null;
  edited: boolean;
  /** a low-confidence segment you have signed off as correct */
  verified: boolean;
  /** JSON with word timings: [{"t":1.23,"s":"word"}] */
  words: string | null;
  /** What the machine wrote here, kept from the first manual rewrite.
   *  Null for a segment nobody has touched — and for one edited before the
   *  archive had somewhere to keep it. */
  original: string | null;
  /** Which language this block was transcribed in, when it is not the
   *  recording's own. Null is every block of every transcript written before
   *  the second-language pass existed, and every block that pass did not
   *  write. */
  language: string | null;
}

export interface Speaker {
  key: string;
  recording_id: string;
  name: string;
  color: string;
}

export interface DictionaryEntry {
  id: string;
  find: string;
  replace: string;
}

export interface Settings {
  bin_directory: string;
  models_directory: string;
  /** Optional directory that is checked for newly added media files. */
  watch_folder: string;
  watch_folder_enabled: boolean;
  watch_folder_auto: boolean;
  /** Where the app keeps audio it owns. Empty means the default place. */
  recording_folder: string;
  copy_imports: boolean;
  /** Ask about a newer Volocal on start, not only when the button is pressed. */
  update_check_automatic: boolean;
  model: string;
  /** `fast` | `accurate` | `""` — the answer to the wizard's one question.
   *  Empty means nobody was ever asked; read it through `qualityChoice`. */
  quality_choice: string;
  /** Optional local model used to turn a transcript into a readable document. */
  editor_model: string;
  /** **Nothing reads or writes this any more.** It held the instruction last
   *  written for a custom-prompt document, one per installation — until an
   *  instruction written for one interview turned up standing over another,
   *  where it can be run by accident and answered against a recording it was
   *  never about. The draft now lives on the transcript screen, so it survives
   *  the window being closed and not the recording being left.
   *
   *  The column stays until a migration goes past it, and this field stays with
   *  it so nothing lies about the shape of that row — an archive from before
   *  this change still carries whatever was written into it last. */
  custom_prompt: string;
  language: string;
  vad: boolean;
  vad_threshold: number;
  diarization: boolean;
  speaker_count: number;
  cluster_threshold: number;
  /** Segmentation window shift as a fraction of its length. Smaller = more
   *  precise and slower. */
  segmentation_window_shift: number;
  beam: number;
  threads: number;
  /** Above this threshold a window is declared silent. */
  threshold_silence: number;
  /** Below this confidence, decoding is retried at a higher temperature. */
  threshold_confidence: number;
  /** How monotonous the output may be before the segment is retried. */
  entropy_threshold: number;
  /** Initial sampling temperature. */
  temperature: number;
  /** How much the temperature rises with each further attempt. */
  temperature_increment: number;
  /** Where the transcription computes: `auto`, `gpu` or `cpu`. Settings
   *  written before 14 August 2026 may instead name a build, `cuda` or
   *  `vulkan`; `computeMode` in `Settings.tsx` reads both. */
  compute: "auto" | "gpu" | "cpu" | "cuda" | "vulkan" | string;
  last_machine: string;
  /** system | light | dark */
  theme: string;
  font_ui: string;
  font_text: string;
  /** transcript font size, px */
  transcript_font_size: number;
  /** Stored and no longer read: the leading is derived from the size by
   *  `transcriptLineHeight`. The field stays so that settings written by an
   *  older build still load and so that nothing has to migrate. */
  transcript_line_height: number;
}

export interface WatchFolderCandidate {
  path: string;
  name: string;
  fingerprint: string;
}

/** Fonts ship with the app, so they work without an internet connection. */
export interface FontChoice {
  /** Brand names are not translated. */
  title: string;
  /** Set when the name describes the font instead of naming it. */
  titleKey?: string;
  stack: string;
  category: "sans" | "serif";
}

export const FONTS: Record<string, FontChoice> = {
  geist: {
    title: "Geist",
    stack: '"Geist Variable", system-ui, sans-serif',
    category: "sans",
  },
  schibsted: {
    title: "Schibsted Grotesk",
    stack: '"Schibsted Grotesk Variable", system-ui, sans-serif',
    category: "sans",
  },
  inter: {
    title: "Inter",
    stack: '"Inter Variable", system-ui, sans-serif',
    category: "sans",
  },
  system: {
    // i18n-ignore: fallback only; the shown name is domain.font.system
    title: "Systémové (Segoe UI)",
    titleKey: "domain.font.system",
    stack: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    category: "sans",
  },
  literata: {
    title: "Literata",
    stack: '"Literata Variable", Georgia, serif',
    category: "serif",
  },
  "source-serif": {
    title: "Source Serif 4",
    stack: '"Source Serif 4 Variable", Georgia, serif',
    category: "serif",
  },
  georgia: {
    title: "Georgia",
    stack: 'Georgia, "Times New Roman", serif',
    category: "serif",
  },
};

/** Which palette is in force.
 *
 *  The dark palette hangs off `data-theme` on the root element rather than
 *  living in a `prefers-color-scheme` media query, because a media query
 *  cannot be overridden by a person's decision — and following the system is
 *  only one of the three choices. This function is the only thing that writes
 *  that attribute.
 *
 *  The choice is mirrored into local storage so `main.tsx` can apply it before
 *  React mounts. Without that the window would open in the light palette and
 *  turn dark a frame later, once the settings arrive from the backend.
 */
export const THEME_KEY = "theme";

export type ThemeChoice = "system" | "light" | "dark";

/** When a server was last asked whether there is a newer Volocal, RFC 3339.
 *
 *  Here rather than in the settings record, and the reason is worth keeping.
 *  Writing it as a setting made pressing `Zkontrolovat aktualizace` answer
 *  `Uloženo` — *nic se přece neukládá* — because the confirmation belongs to
 *  the settings record being written and the reader had asked a different
 *  question. The fix is not a flag on that write but a rule about what the
 *  record is: **it holds what the reader decided.** A moment the application
 *  notes down for itself is not a decision, so it is not in there, and the next
 *  such value cannot trip the confirmation either without somebody deliberately
 *  putting it back among the settings.
 *
 *  It is also the more honest home. A settings record travels — into a portable
 *  copy, into a backup and back out of one — and a restored archive claiming a
 *  check that never happened on the machine reading it would be a lie the
 *  reader cannot see. This is a fact about one installation.
 *
 *  Both ways of asking write it: the button on `Aktualizace` and the automatic
 *  check on start. Which one looked is not a distinction the row's reader has.
 */
export const UPDATE_CHECKED_AT = "update-checked-at";

/** Empty where nothing has ever asked, which is what a fresh installation is
 *  and what the row says in words rather than with a dash. */
export function lastUpdateCheck(): string {
  return localStorage.getItem(UPDATE_CHECKED_AT) ?? "";
}

/** After an answer came back, and never after a failure: a server that could
 *  not be reached told this computer nothing, and a moment stamped on that
 *  would read as *asked, and all is well*. */
export function noteUpdateCheck() {
  localStorage.setItem(UPDATE_CHECKED_AT, new Date().toISOString());
}

/** One `MediaQueryList`, kept.
 *
 *  `matchMedia` returns a *new* object on every call, and `removeEventListener`
 *  on a fresh object does not remove a listener attached to an older one — so
 *  asking again each time would leave every listener ever attached in place,
 *  and a person who had chosen a palette would still have the system flip it. */
let query: MediaQueryList | null | undefined;

function darkQuery(): MediaQueryList | null {
  if (query === undefined) {
    query = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  }
  return query;
}

/** Attached only while the choice is `system`; removed when it is not, so a
 *  person who has decided cannot have the system decide over them. */
let followingSystem: (() => void) | null = null;

export function applyTheme(choice: string) {
  const theme: ThemeChoice = choice === "light" || choice === "dark" ? choice : "system";
  localStorage.setItem(THEME_KEY, theme);

  const media = darkQuery();
  if (followingSystem) {
    media?.removeEventListener("change", followingSystem);
    followingSystem = null;
  }

  const write = (dark: boolean) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };

  if (theme !== "system") {
    write(theme === "dark");
    return;
  }
  write(media?.matches ?? false);
  // Following the system means following it, not reading it once at startup.
  followingSystem = (() => write(darkQuery()?.matches ?? false)) as () => void;
  media?.addEventListener("change", followingSystem);
}

/** The last applied choice, for the pre-mount application in `main.tsx`. */
export function rememberedTheme(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** The leading that goes with a size, rather than a second thing to decide.
 *
 *  Settings had two sliders and one of them is a consequence of the other:
 *  large type needs proportionally less leading than small type to read as the
 *  same block, which is why every type scale that ships with one ships with the
 *  other. The line is drawn through the pair the application shipped with —
 *  17.5 px at 1.72 — so a transcript nobody ever adjusted does not move; across
 *  the slider's whole 14–26 px it runs from 1.75 down to 1.65.
 *
 *  Kept deliberately gentle. This is one number chosen once, not a curve worth
 *  fitting: what it has to avoid is a 26 px transcript at a 14 px transcript's
 *  leading, and it does. */
export function transcriptLineHeight(size: number): number {
  return 1.86 - 0.008 * (size || 17.5);
}

export function applyFonts(n: Pick<Settings, "font_ui" | "font_text" | "transcript_font_size">) {
  const k = document.documentElement.style;
  k.setProperty("--font", FONTS[n.font_ui]?.stack ?? FONTS.geist.stack);
  k.setProperty("--font-body", FONTS[n.font_text]?.stack ?? FONTS.literata.stack);
  k.setProperty("--text-size", `${n.transcript_font_size || 17.5}px`);
  k.setProperty("--line-height", String(transcriptLineHeight(n.transcript_font_size)));
}

export interface ToolCheck {
  ffmpeg: string | null;
  ffprobe: string | null;
  whisper_cli: string | null;
  model_whisper: string | null;
  /** Which model that turned out to be — see `ToolCheck::model_whisper_id`.
   *  Differs from `settings.model` exactly when the setting cannot be honoured. */
  model_whisper_id: string | null;
  model_vad: string | null;
  embedding_model: string | null;
  editor_cli: string | null;
  editor_server: string | null;
  editor_model: string | null;
  editor_model_id: string | null;
  portable: boolean;
  app_directory: string;
  webview2_bundled: boolean;
  compute: string;
  available_compute_backends: string[];
  nvidia_driver: boolean;
  vulkan_driver: boolean;
  /** Whole gigabytes of memory, or `null` where the machine would not say.
   *  Null is drawn as a shorter sentence, never as a guess. */
  memory_gb: number | null;
  found_models: string[];
  issues: UserMessage[];
  issues_diarization: UserMessage[];
  issues_editor: UserMessage[];
  /** Component ids that would answer `issues` — what to press, where `issues`
   *  says only what is wrong. See `ToolCheck::needed` in `tools.rs`. */
  needed: string[];
}

export interface AiDocument {
  recording_id: string;
  source_hash: string;
  model: string;
  mode: "faithful" | "clean" | string;
  text: string;
  updated_at: string;
  stale: boolean;
}

export interface AiOutput {
  recording_id: string;
  kind: "summary" | "translation" | string;
  variant: string;
  source_hash: string;
  model: string;
  text: string;
  updated_at: string;
}

/** One answer to one instruction somebody wrote, for one recording.
 *
 *  Its own shape rather than an `AiOutput` with a `kind`: it is made from the
 *  timed transcript instead of the improved document, it is keyed by the
 *  instruction that made it, and it outlives that document being regenerated
 *  or discarded. */
export interface AiCustomDocument {
  recording_id: string;
  /** The instruction, which is also this document's key. */
  prompt: string;
  source_hash: string;
  model: string;
  text: string;
  updated_at: string;
  /** The transcript has been rewritten since this was made. */
  stale: boolean;
}

export interface AiEditProgress {
  recording_id: string;
  phase: "preparing" | "processing" | "complete" | "error" | "cancelled";
  percent: number;
  description: UserMessage;
}

export interface DownloadComponent {
  id: string;
  /** Dictionary key for the name, `catalog.<id>.name`. */
  name_code: string;
  /** Dictionary key for the sentence under it, `catalog.<id>.description`. */
  description_code: string;
  megabytes: number;
  group: "program" | "model" | "speech" | "editor" | string;
  required: boolean;
  recommended: boolean;
  complete: boolean;
  /** Whether the bin may be drawn on this row. Answered in Rust by `catalog()`:
   *  false while nothing is installed, false while something is using the
   *  component, and false where the installation recorded no list of its own
   *  files. The row draws a lock rather than a bin that refuses. */
  removable: boolean;
  /** Why not, when something *is* installed and the bin is still not drawn.
   *  `busy` is waited out; `unlisted` is fixed by fetching the component again,
   *  which writes the file list this machine never had. The lock's tooltip says
   *  which — an absent control explains nothing, and the two have different
   *  answers. `null` on a row with a bin and on a row with nothing to delete. */
  remove_block: "busy" | "unlisted" | null;
  /** Whether it may be fetched again over itself. False while the component is
   *  working — renaming a fresh file over one whisper has open is how a model
   *  is lost mid-run. **Not the same question as `removable`**: a component
   *  whose files were never recorded cannot be deleted but replaces perfectly
   *  well, so it is replaceable and not removable. */
  replaceable: boolean;
  /** This is the model `settings.model` or `editor_model` names right now. Not
   *  a lock — deleting it while nothing runs is allowed — but the confirmation
   *  reads differently for it, because removing the one that works is a
   *  different act from removing a spare. */
  configured: boolean;
  /** Which component id the setting would name instead. `null` means nothing
   *  installed can take over and the setting would be cleared. */
  replaced_by: string | null;
}

export interface DownloadProgress {
  id: string;
  /** `waiting` is in line behind something else and has no bytes yet. It exists
   *  because the alternative was silence: pressing a second row used to be
   *  refused outright, and once it became a queue instead, a row that reported
   *  nothing after being pressed would have read as a press that missed. */
  phase: "waiting" | "downloading" | "extracting" | "complete" | "error" | "cancelled";
  downloaded_mb: number;
  total_mb: number;
  percent: number;
  message: UserMessage | null;
}

/** Is this component part of the run — waiting, fetching or unpacking?
 *
 *  **Asked as a list of what it is, never as a list of what it is not.** Three
 *  places wrote the negation — *not complete and not error* — and every one of
 *  them counted `cancelled` as still going: pressing Stop left the row with a
 *  stop square on it and `0 %` beside it, for good. Adding `waiting` to the
 *  phases would have broken the same three a second time. */
export function downloadIsLive(phase: DownloadProgress["phase"] | undefined): boolean {
  return phase === "waiting" || phase === "downloading" || phase === "extracting";
}

/** Narrower: the bytes are moving for this one *now*. What a percentage, a
 *  progress bar and the bubble's name may be drawn from — a queued component
 *  has none of those and would report a truthful, meaningless nought. */
export function downloadIsMoving(phase: DownloadProgress["phase"] | undefined): boolean {
  return phase === "downloading" || phase === "extracting";
}

/* `BenchmarkResult` stood here and is gone with `Změřit rychlost`. The button
   set `compute`, and there is no `compute` to set: the machine picks the
   backend from its drivers. The Rust command it called is still registered and
   is now the application's only instrument for timing a backend — see the
   change record for 14 August 2026. */

/** The one question the first run asks, and everything that follows from it.
 *
 *  Two ends of one choice, and the reader answers it once. It decides which
 *  transcription model the wizard downloads and, later and separately, how
 *  large a language-editing model is fetched when a document is first wanted.
 *  Nothing asks a second time.
 */
export type QualityChoice = "fast" | "accurate";

/** What the stored answer means, including on a machine that was never asked.
 *
 *  Empty is every installation set up before 14 August 2026. Rather than
 *  inventing an answer for them, it is read off the model they transcribe
 *  with — which is what the same question produced when they were set up. The
 *  turbo model is the fast side of that question; anything else is the other.
 */
export function qualityChoice(settings: Pick<Settings, "quality_choice" | "model">): QualityChoice {
  if (settings.quality_choice === "fast" || settings.quality_choice === "accurate") {
    return settings.quality_choice;
  }
  return settings.model.includes("turbo") ? "fast" : "accurate";
}

/** Every language-editing model, by the catalogue component that installs it.
 *
 *  **Largest first**, and that is the order `Jazyková úprava` draws its cards
 *  in — *dej větší model jako první volbu*. It matches the quality cards, where
 *  `Přesný` is drawn before `Rychlý`, so the two columns of cards on `Přepis`
 *  read the same way down the screen. The instinct when listing a pair by size
 *  is to go small to large; that instinct is what this comment exists to stop.
 *
 *  Three are in the catalogue and two are offered. The middle one keeps its
 *  place in the middle — the column is one monotonic run of sizes, not two
 *  offers with a leftover after them — so that a machine which already holds it
 *  keeps working and keeps being named: nothing fetches it, but where it is on
 *  the disk it is shown, in the by-hand list and as a third card.
 *
 *  The order is read as a preference in exactly one place: ticking more than
 *  one editor model by hand in the wizard's component list takes the first of
 *  them, so the larger now wins where the smaller used to. That agrees with
 *  `resolve_editor_model` in `tools.rs`, whose own fallback list has always run
 *  12B, E4B, E2B.
 */
export const EDITOR_MODELS: Record<string, string> = {
  "editor-model-best": "gemma-4-12b-q4",
  "editor-model-balanced": "gemma-4-e4b-q4",
  "editor-model-light": "gemma-4-e2b-q4",
};

/** The two transcription models offered, by the catalogue component that
 *  installs each — accurate first, which is `MODEL_IDS`' own order and the
 *  order the wizard's two cards are drawn in.
 *
 *  The same shape and the same rule as `EDITOR_MODELS`: `Model` on `Přepis`
 *  draws these two whether or not they are on the disk, and picking one that is
 *  not fetches it. Anything else already installed — `large-v3-q5_0` on a
 *  machine set up before 13 August 2026, or an older generation — is drawn
 *  beside them off `check.found_models`, because a list that is partly an offer
 *  and partly the disk must not hide what the disk holds.
 *
 *  `SetupWizard.tsx` keeps its own table with the same two components in it.
 *  That one also carries the answer each writes to `quality_choice` and the
 *  estimate shown beside it, neither of which belongs here; what must not drift
 *  is the pairing of component to model file, and both sides name the same two
 *  strings. */
export const TRANSCRIPTION_MODELS: Record<string, string> = {
  "model-large": "large-v3",
  "model-turbo": "large-v3-turbo-q5_0",
};

/** Which of them the one question implies — the default, not the answer.
 *
 *  The wizard asks one thing, `rychle` or `přesně`, and this is that answer
 *  applied to the language editor: it decides which model is badged
 *  `doporučeno` on `Jazyková úprava` and which one the offer in `Detail.tsx`
 *  fetches for somebody who has never chosen. **A model chosen in Settings is
 *  stored in `editor_model` and wins over it**, exactly as the transcription
 *  model chosen there wins over the one the wizard downloaded — Settings is
 *  where a decision is revisited, not where it is asked a second time. Nothing
 *  writes `editor_model` back from `quality_choice` afterwards; both readers of
 *  this table look at the stored value first.
 *
 *  Sizes are not written here: the catalogue carries them, and a second copy is
 *  the one that goes stale. */
export const EDITOR_TIER: Record<QualityChoice, string> = {
  fast: "editor-model-light",
  accurate: "editor-model-best",
};

/** Components nothing offers any more, though the catalogue still installs and
 *  verifies them. They are drawn in the by-hand list only when they are already
 *  on the disk, where a tick is a fact about this machine rather than an offer:
 *  hiding a model somebody has downloaded would make the list say the disk is
 *  emptier than it is. */
export const UNOFFERED_COMPONENTS = ["model-large-q5", "editor-model-balanced"];

/* `COMPUTE_IDS` stood here, with `labels.compute` beside it in `labels.ts` and
   the five `domain.compute.*` names in the dictionary — `Grafická karta
   (Vulkan)`, `Procesor (CPU)` and the rest. Nothing names a build to the reader
   any more: `Výkon` asks for the card or the processor, and which build suits
   the card is `choose_compute`'s business. The names went with the last thing
   that printed one. */

/** Whisper models the interface knows how to name, in the order they are
 *  offered: best first, then the older generation, also best first. Within a
 *  family the full model outranks its quantized copy. Unknown identifiers
 *  still work; they show their raw name and come last.
 *
 *  Not a plain reverse of the old fastest-first list: that would have put
 *  `small` at the top. The older generation stays below the three tiers
 *  whatever the direction. */
export const MODEL_IDS = [
  "large-v3",
  "large-v3-q5_0",
  "large-v3-turbo",
  "large-v3-turbo-q5_0",
  "medium",
  "medium-q5_0",
  "small",
] as const;

/** Spoken languages offered for transcription, in display order. */
export const LANGUAGE_CODES = [
  "cs",
  "sk",
  "en",
  "de",
  "pl",
  "uk",
  "ru",
  "es",
  "fr",
  "it",
] as const;

export interface Detail {
  recording: Recording;
  segments: Segment[];
  speakers: Speaker[];
  notes: RecordingNote[];
}

export interface RecordingNote {
  id: string;
  recording_id: string;
  /** Where in the recording the note belongs, or null for a note about the
   *  whole recording. Zero is a real position, so it cannot stand for "none". */
  time: number | null;
  text: string;
  done: boolean;
  created_at: string;
}

/** A second language found in one recording, and where the reader stands on it.
 *
 *  Null everywhere it was never found — which is every recording spoken in one
 *  language, and every transcript written before the sweep existed. */
export interface SecondLanguage {
  recording_id: string;
  /** The other language, as a code: `en`, `de`. */
  language: string;
  /** What fraction of the sampled windows came back that language. Kept so a
   *  later change to the rule can be judged against archives already swept. */
  share: number;
  state: "offered" | "filled" | "refused";
  filled_at: string | null;
}

export interface SearchResult {
  recording_id: string;
  title: string;
  segment_id: string;
  start: number;
  text: string;
}

export interface TranscriptionProgress {
  recording_id: string;
  phase:
    // Sent when a run finds another one ahead of it: the heavy programs take
    // the whole graphics card, so they go one at a time.
    | "queued"
    | "preparation"
    | "playback"
    | "transcription"
    | "diarization"
    | "saving"
    | "complete"
    | "error"
    | "cancelled";
  percent: number;
  description: UserMessage;
}

export interface LiveSegment {
  recording_id: string;
  start: number;
  end: number;
  text: string;
}

/** Below this average confidence a segment is underlined in the editor. */
export const CONFIDENCE_THRESHOLD = 0.72;

/** Picks just the file name, extension included, out of a full path. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}

export function formatTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const secondsPart = total % 60;
  const padTwo = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${padTwo(m)}:${padTwo(secondsPart)}` : `${m}:${padTwo(secondsPart)}`;
}
