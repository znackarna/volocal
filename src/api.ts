import { invoke } from "@tauri-apps/api/core";
import type {
  AiDocument,
  AiEditProgress,
  AiOutput,
  BenchmarkResult,
  Detail,
  DictionaryEntry,
  DownloadComponent,
  Recording,
  RecordingNote,
  SearchResult,
  Settings,
  Speaker,
  ToolCheck,
  WatchFolderCandidate,
  Folder,
} from "./types";

export const api = {
  loadSettings: () => invoke<Settings>("load_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  checkTools: () => invoke<ToolCheck>("check_tools"),
  /** Plain text for a person to paste into a message when something is wrong. */
  diagnosticReport: () => invoke<string>("diagnostic_report"),

  listRecordings: () => invoke<Recording[]>("list_recordings"),
  addRecording: (path: string) => invoke<Recording>("add_recording", { path }),
  scanWatchFolder: () => invoke<WatchFolderCandidate[]>("scan_watch_folder"),
  importWatchFolderFiles: (files: WatchFolderCandidate[]) =>
    invoke<Recording[]>("import_watch_folder_files", { files }),
  ignoreWatchFolderFiles: (files: WatchFolderCandidate[]) =>
    invoke<void>("ignore_watch_folder_files", { files }),
  saveMicrophoneRecording: (audio: Uint8Array) =>
    invoke<Recording>("save_microphone_recording", audio),
  importOnlineRecording: (url: string) =>
    invoke<Recording>("import_online_recording", { url }),
  cancelOnlineImport: () => invoke<void>("cancel_online_import"),
  folders: () => invoke<Folder[]>("folders"),
  createFolder: (name: string) => invoke<Folder>("create_folder", { name }),
  renameFolder: (id: string, name: string) =>
    invoke<void>("rename_folder", { id, name }),
  /** `folder` of null takes the recordings back to the archive's root. */
  moveToFolder: (ids: string[], folder: string | null) =>
    invoke<void>("move_to_folder", { ids, folder }),
  deleteFolder: (id: string, contents: boolean) =>
    invoke<void>("delete_folder", { id, contents }),
  exportAudio: (id: string, destination: string) =>
    invoke<void>("export_audio", { id, destination }),
  deleteRecording: (id: string) => invoke<void>("delete_recording", { id }),
  startTranscription: (id: string, speakerCount?: number | null) =>
    invoke<void>("start_transcription", { id, speakerCount: speakerCount ?? null }),
  transcribeInLanguage: (id: string, language: string, speakerCount?: number | null) =>
    invoke<void>("transcribe_in_language", { id, language, speakerCount: speakerCount ?? null }),
  cancelTranscription: (id: string) => invoke<void>("cancel_transcription", { id }),
  deleteTranscription: (id: string) => invoke<void>("delete_transcription", { id }),
  renameRecording: (id: string, title: string) =>
    invoke<void>("rename_recording", { id, title }),
  diarizeSpeakers: (id: string, speakerCount?: number | null) =>
    invoke<void>("diarize_speakers", { id, speakerCount: speakerCount ?? null }),

  detail: (id: string) => invoke<Detail>("detail", { id }),
  addRecordingNote: (recordingId: string, time: number | null, text: string) =>
    invoke<RecordingNote>("add_recording_note", { recordingId, time, text }),
  updateRecordingNote: (id: string, time: number | null, text: string, done: boolean) =>
    invoke<void>("update_recording_note", { id, time, text, done }),
  deleteRecordingNote: (id: string) => invoke<void>("delete_recording_note", { id }),
  fileExists: (path: string) => invoke<boolean>("file_exists", { path }),
  /** Lets the updater's installer survive this process exiting. */
  letTheInstallerOut: () => invoke<void>("let_the_installer_out"),
  playbackSource: (id: string) => invoke<string>("playback_source", { id }),
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
  addSpeaker: (recordingId: string) =>
    invoke<Speaker>("add_speaker", { recordingId }),
  deleteSpeaker: (recordingId: string, key: string) =>
    invoke<void>("delete_speaker", { recordingId, key }),
  mergeSpeakers: (recordingId: string, fromKey: string, toKey: string) =>
    invoke<void>("merge_speakers", { recordingId, fromKey, toKey }),

  dictionary: () => invoke<DictionaryEntry[]>("dictionary"),
  addDictionaryEntry: (find: string, replace: string) =>
    invoke<DictionaryEntry>("add_dictionary_entry", { find, replace }),
  updateDictionaryEntry: (id: string, find: string, replace: string) =>
    invoke<DictionaryEntry>("update_dictionary_entry", { id, find, replace }),
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

  aiEditStatus: (id: string) =>
    invoke<{
      document: AiDocument | null;
      outputs: AiOutput[];
      running: boolean;
      progress: AiEditProgress | null;
    }>(
      "ai_edit_status",
      { id }
    ),
  startAiEdit: (id: string, mode: "faithful" | "clean") =>
    invoke<void>("start_ai_edit", { id, mode }),
  startAiOutput: (id: string, kind: "summary" | "translation", variant: string) =>
    invoke<void>("start_ai_output", { id, kind, variant }),
  cancelAiEdit: (id: string) => invoke<void>("cancel_ai_edit", { id }),
  deleteAiDocument: (id: string) => invoke<void>("delete_ai_document", { id }),
  saveAiDocument: (id: string, format: "txt" | "md", path: string) =>
    invoke<string>("save_ai_document", { id, format, path }),
  suggestedAiName: (id: string, format: "txt" | "md") =>
    invoke<string>("suggested_ai_name", { id, format }),
  saveAiOutput: (
    id: string,
    kind: "summary" | "translation",
    variant: string,
    format: "txt" | "md",
    path: string
  ) => invoke<string>("save_ai_output", { id, kind, variant, format, path }),
  suggestedAiOutputName: (
    id: string,
    kind: "summary" | "translation",
    variant: string,
    format: "txt" | "md"
  ) => invoke<string>("suggested_ai_output_name", { id, kind, variant, format }),

  backupStatus: () =>
    invoke<{ latest: string; count: number; directory: string }>("backup_status"),
  backUpNow: () => invoke<string>("back_up_now"),
};

export type { Speaker };
