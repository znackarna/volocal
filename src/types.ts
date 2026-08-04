/** What Rust sends instead of a finished sentence: a stable code, the values
 *  that belong in it, and a technical text for codes the dictionary does not
 *  cover yet. `useUserMessage` in `messages.ts` turns it into words. */
export interface UserMessage {
  code: string;
  params: Record<string, string>;
  detail: string;
}

export type Status = "nova" | "prepisuje" | "hotova" | "chyba";

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
  model: string;
  /** Optional local model used to turn a transcript into a readable document. */
  editor_model: string;
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
  compute: "auto" | "cuda" | "vulkan" | "cpu" | string;
  last_machine: string;
  font_ui: string;
  font_text: string;
  /** transcript font size, px */
  transcript_font_size: number;
  /** transcript line height */
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

export function applyFonts(
  n: Pick<Settings, "font_ui" | "font_text" | "transcript_font_size" | "transcript_line_height">
) {
  const k = document.documentElement.style;
  k.setProperty("--pismo", FONTS[n.font_ui]?.stack ?? FONTS.geist.stack);
  k.setProperty("--pismo-text", FONTS[n.font_text]?.stack ?? FONTS.literata.stack);
  k.setProperty("--velikost-textu", `${n.transcript_font_size || 17.5}px`);
  k.setProperty("--radkovani", String(n.transcript_line_height || 1.72));
}

export interface ToolCheck {
  ffmpeg: string | null;
  ffprobe: string | null;
  whisper_cli: string | null;
  model_whisper: string | null;
  model_vad: string | null;
  sherpa_diarization: string | null;
  segmentation_model: string | null;
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
  found_models: string[];
  issues: UserMessage[];
  issues_diarization: UserMessage[];
  issues_editor: UserMessage[];
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
  group: "program" | "model" | "speakers" | string;
  required: boolean;
  recommended: boolean;
  complete: boolean;
}

export interface DownloadProgress {
  id: string;
  phase: "downloading" | "extracting" | "complete" | "error" | "cancelled";
  downloaded_mb: number;
  total_mb: number;
  percent: number;
  message: UserMessage | null;
}

export interface BenchmarkResult {
  compute: string;
  seconds: number;
  realtime_factor: number;
  error: UserMessage | null;
}

/** Identifiers the backend uses for compute backends. Their names live in the
 *  translation dictionary and are read through `useLabels`. */
export const COMPUTE_IDS = ["cuda", "vulkan", "cpu", "default", "auto"] as const;

/** Whisper models the interface knows how to name, in the order they are
 *  offered. Unknown identifiers still work; they show their raw name. */
export const MODEL_IDS = [
  "large-v3",
  "large-v3-q5_0",
  "large-v3-turbo-q5_0",
  "large-v3-turbo",
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
