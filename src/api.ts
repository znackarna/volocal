import { invoke } from "@tauri-apps/api/core";
import type {
  BenchmarkResult,
  Detail,
  DictionaryEntry,
  DownloadComponent,
  Recording,
  SearchResult,
  Settings,
  Speaker,
  ToolCheck,
} from "./types";

export const api = {
  loadSettings: () => invoke<Settings>("load_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  checkTools: () => invoke<ToolCheck>("check_tools"),

  listRecordings: () => invoke<Recording[]>("list_recordings"),
  addRecording: (path: string) => invoke<Recording>("add_recording", { path }),
  deleteRecording: (id: string) => invoke<void>("delete_recording", { id }),
  startTranscription: (id: string) => invoke<void>("start_transcription", { id }),
  transcribeInLanguage: (id: string, language: string) =>
    invoke<void>("transcribe_in_language", { id, language }),
  cancelTranscription: (id: string) => invoke<void>("cancel_transcription", { id }),
  deleteTranscription: (id: string) => invoke<void>("delete_transcription", { id }),
  renameRecording: (id: string, title: string) =>
    invoke<void>("rename_recording", { id, title }),
  diarizeSpeakers: (id: string) => invoke<void>("diarize_speakers", { id }),

  detail: (id: string) => invoke<Detail>("detail", { id }),
  fileExists: (path: string) => invoke<boolean>("file_exists", { path }),
  changeRecordingPath: (id: string, path: string) =>
    invoke<void>("change_recording_path", { id, path }),
  recordingWaveform: (id: string) =>
    invoke<{
      points: number[];
      points_per_second: number;
      equalizer: number[];
      equalizer_points_per_second: number;
      equalizer_band_count: number;
      is_calculating: boolean;
    }>(
      "recording_waveform",
      { id }
    ),
  applyDictionary: (id: string) => invoke<number>("apply_dictionary", { id }),
  markVerified: (id: string, verified: boolean) =>
    invoke<void>("mark_verified", { id, verified }),
  updateSegment: (id: string, text: string) => invoke<void>("update_segment", { id, text }),
  setSegmentSpeaker: (id: string, speakers: string | null) =>
    invoke<void>("set_segment_speaker", { id, speakers }),
  renameSpeaker: (recordingId: string, key: string, name: string) =>
    invoke<void>("rename_speaker", { recordingId, key, name }),
  mergeSpeakers: (recordingId: string, fromKey: string, toKey: string) =>
    invoke<void>("merge_speakers", { recordingId, fromKey, toKey }),

  dictionary: () => invoke<DictionaryEntry[]>("dictionary"),
  addDictionaryEntry: (find: string, replace: string, prompt: boolean) =>
    invoke<DictionaryEntry>("add_dictionary_entry", { find, replace, prompt }),
  deleteDictionaryEntry: (id: string) => invoke<void>("delete_dictionary_entry", { id }),
  search: (query: string) => invoke<SearchResult[]>("search", { query }),

  catalog: () => invoke<DownloadComponent[]>("catalog"),
  download: (ids: string[]) => invoke<void>("download", { ids }),
  cancelDownload: () => invoke<void>("cancel_download"),
  createPortableCopy: (path: string) => invoke<number>("create_portable_copy", { path }),

  benchmarkCompute: (recordingId?: string) =>
    invoke<BenchmarkResult[]>("benchmark_compute", { recordingId: recordingId ?? null }),
  machineName: () => invoke<string>("name_machine"),

  exportPreview: (id: string, format: string) =>
    invoke<string>("export_preview", { id, format }),
  saveExport: (id: string, format: string, path: string) =>
    invoke<string>("save_export", { id, format, path }),
  suggestedName: (id: string, format: string) =>
    invoke<string>("suggested_name", { id, format }),
};

export type { Speaker };
