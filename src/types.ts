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
  prompt: boolean;
}

export interface Settings {
  bin_directory: string;
  models_directory: string;
  model: string;
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

/** Fonts ship with the app, so they work without an internet connection. */
export const FONTS: Record<string, { title: string; stack: string; category: "sans" | "serif" }> = {
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
    title: "Systémové (Segoe UI)",
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
  portable: boolean;
  app_directory: string;
  webview2_bundled: boolean;
  compute: string;
  available_compute_backends: string[];
  nvidia_driver: boolean;
  vulkan_driver: boolean;
  found_models: string[];
  issues: string[];
  issues_diarization: string[];
}

export interface DownloadComponent {
  id: string;
  title: string;
  description: string;
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
  message: string;
}

export interface BenchmarkResult {
  compute: string;
  seconds: number;
  realtime_factor: number;
  error: string | null;
}

export const COMPUTE_LABELS: Record<string, string> = {
  cuda: "NVIDIA (CUDA)",
  vulkan: "Grafická karta (Vulkan)",
  cpu: "Procesor",
  default: "Výchozí",
  auto: "Rozhodnout automaticky",
};

/** Human-readable model names. The technical label ("large-v3-q5_0") means
 *  nothing to anyone — it belongs in a footnote at most. */
export const MODEL_LABELS: Record<string, string> = {
  "large-v3": "Nejvyšší kvalita",
  "large-v3-q5_0": "Vyvážený",
  "large-v3-turbo-q5_0": "Rychlý",
  "large-v3-turbo": "Rychlý (plný)",
  medium: "Starší",
  "medium-q5_0": "Starší (zmenšený)",
  small: "Náhledový",
};

export const MODEL_DESCRIPTIONS: Record<string, string> = {
  "large-v3": "Nejpřesnější čeština, největší a nejpomalejší (3,1 GB)",
  "large-v3-q5_0": "Kvalita skoro jako nejvyšší, třetinová velikost (1,1 GB)",
  "large-v3-turbo-q5_0": "Několikanásobně rychlejší, drobně méně přesný (575 MB)",
  "large-v3-turbo": "Rychlý bez zmenšení (1,6 GB)",
  medium: "Znatelně víc chyb ve jménech, nedoporučuje se (1,5 GB)",
  "medium-q5_0": "Zmenšená starší generace (539 MB)",
  small: "Jen na rychlý náhled, hodně chyb (488 MB)",
};

const LANGUAGES: Record<string, string> = {
  cs: "čeština",
  sk: "slovenština",
  en: "angličtina",
  de: "němčina",
  pl: "polština",
  uk: "ukrajinština",
  ru: "ruština",
  es: "španělština",
  fr: "francouzština",
  it: "italština",
};

export function languageName(code: string): string {
  if (code === "auto") return "rozpoznaný";
  return LANGUAGES[code] ?? code;
}

/** Language choices. "auto" detects the language from the first seconds. */
export const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Rozpoznat automaticky" },
  ...Object.entries(LANGUAGES).map(([value, label]) => ({
    value,
    label: label.charAt(0).toUpperCase() + label.slice(1),
  })),
];

export function modelName(id: string): string {
  return MODEL_LABELS[id] ?? id;
}

export interface Detail {
  recording: Recording;
  segments: Segment[];
  speakers: Speaker[];
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
    | "transcription"
    | "diarization"
    | "saving"
    | "complete"
    | "error"
    | "cancelled";
  percent: number;
  description: string;
}

export interface LiveSegment {
  recording_id: string;
  start: number;
  end: number;
  text: string;
}

/// Pod touto hranici prumerne jistoty se usek v editoru podtrhne.
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
