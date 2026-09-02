import { invoke } from "@tauri-apps/api/core";
import type {
  AiCustomDocument,
  AiDocument,
  AiEditProgress,
  AiOutput,
  Detail,
  DictionaryEntry,
  DownloadComponent,
  Recording,
  RecordingNote,
  SearchResult,
  SecondLanguage,
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
  /** The log file itself, for the times the report is not enough. */
  logFile: () => invoke<string | null>("log_directory"),
  /** A crash in the window, into the same log as everything else. The one
   *  call in here nobody may await for a result: the window is already broken
   *  when it fires. */
  noteCrash: (message: string, stack: string) =>
    invoke<void>("note_crash", { message, stack }),

  listRecordings: () => invoke<Recording[]>("list_recordings"),
  addRecording: (path: string) => invoke<Recording>("add_recording", { path }),
  scanWatchFolder: () => invoke<WatchFolderCandidate[]>("scan_watch_folder"),
  importWatchFolderFiles: (files: WatchFolderCandidate[]) =>
    invoke<Recording[]>("import_watch_folder_files", { files }),
  ignoreWatchFolderFiles: (files: WatchFolderCandidate[]) =>
    invoke<void>("ignore_watch_folder_files", { files }),
  saveMicrophoneRecording: (audio: Uint8Array) =>
    invoke<Recording>("save_microphone_recording", audio),
  /** Opens the shadow file a take is streamed into while it records. */
  beginTake: () => invoke<void>("begin_take"),
  /** One slice of a take, on its way to disk behind the recording. */
  appendTakeChunk: (audio: Uint8Array) => invoke<void>("append_take_chunk", audio),
  /** The take is saved, or thrown away on purpose. Either way the shadow goes. */
  discardTake: () => invoke<void>("discard_take"),
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
  /** A second language in this recording, when a sweep found one. Null is the
   *  ordinary answer and the screen shows nothing for it. */
  secondLanguage: (id: string) =>
    invoke<SecondLanguage | null>("second_language", { id }),
  /** The reader said no. Remembered, so the offer does not come back — and a
   *  fresh transcription writes a fresh offer over it. */
  refuseSecondLanguage: (id: string) =>
    invoke<void>("refuse_second_language", { id }),
  /** Writes the second language into a transcript that is already stored.
   *  Answers with how many blocks it added. Progress arrives on
   *  `transcription:status` under the `second_language` phase. */
  fillSecondLanguage: (id: string) =>
    invoke<number>("fill_second_language", { id }),
  /** The reader names a second language the recording holds — or, with an
   *  empty string, says it holds none. Written on the recording, so every later
   *  transcription fills it in without asking; on a finished transcript the fill
   *  starts at once and reports like a run. */
  setSecondLanguageChoice: (id: string, language: string) =>
    invoke<void>("set_second_language_choice", { id, language }),
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
  /** Megabytes the tools and models folders take, measured on the disk rather
   *  than added up from the catalogue's hand-written sizes — see
   *  `installed_megabytes` in `download.rs`. How many components are installed
   *  is counted from `catalog()`, which the screen already has. */
  installedMegabytes: () => invoke<number>("installed_megabytes"),
  download: (ids: string[]) => invoke<void>("download", { ids }),
  /** Stops everything, the queue included. The guided first run's `Přerušit`,
   *  where the whole download is the errand being abandoned. */
  cancelDownload: () => invoke<void>("cancel_download"),
  /** Stops one component and leaves the rest of the queue running. What a stop
   *  control drawn on a row means. */
  cancelComponent: (id: string) => invoke<void>("cancel_component", { id }),
  /** Deletes one installed component. Refuses on the Rust side while something
   *  is using it and where no file list was ever recorded — the screen draws a
   *  lock on those rows, and the command does not rely on it having done so. */
  removeComponent: (id: string) => invoke<void>("remove_component", { id }),
  createPortableCopy: (path: string) => invoke<number>("create_portable_copy", { path }),

  /* `benchmarkCompute` stood here. Nothing in the window chooses a compute
     backend any more, so nothing measures one either; `benchmark_compute` is
     still registered in `main.rs` and is the only instrument this application
     has for timing a backend, which is why it was kept rather than deleted. */
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
      custom: AiCustomDocument[];
      running: boolean;
      progress: AiEditProgress | null;
    }>(
      "ai_edit_status",
      { id }
    ),
  startAiEdit: (id: string, mode: "faithful" | "clean") =>
    invoke<void>("start_ai_edit", { id, mode }),
  /** For `custom`, `variant` is the instruction itself rather than the name of
   *  a prepared choice — see `start_ai_output` in `commands/ai.rs`. */
  startAiOutput: (id: string, kind: "summary" | "translation" | "custom", variant: string) =>
    invoke<void>("start_ai_output", { id, kind, variant }),
  cancelAiEdit: (id: string) => invoke<void>("cancel_ai_edit", { id }),
  deleteAiDocument: (id: string) => invoke<void>("delete_ai_document", { id }),
  saveAiDocument: (id: string, format: "txt" | "md", path: string) =>
    invoke<string>("save_ai_document", { id, format, path }),
  suggestedAiName: (id: string, format: "txt" | "md") =>
    invoke<string>("suggested_ai_name", { id, format }),
  saveAiOutput: (
    id: string,
    kind: "summary" | "translation" | "custom",
    variant: string,
    format: "txt" | "md",
    path: string
  ) => invoke<string>("save_ai_output", { id, kind, variant, format, path }),
  suggestedAiOutputName: (
    id: string,
    kind: "summary" | "translation" | "custom",
    variant: string,
    format: "txt" | "md"
  ) => invoke<string>("suggested_ai_output_name", { id, kind, variant, format }),

  backupStatus: () =>
    invoke<{ latest: string; count: number; directory: string }>("backup_status"),
  backUpNow: () => invoke<string>("back_up_now"),
  backups: () =>
    invoke<
      {
        file: string;
        taken_at: string;
        size: number;
        recordings: number | null;
        seconds: number | null;
      }[]
    >("backups"),
  /** Replaces the open archive with a backup, and reopens it. */
  restoreBackup: (file: string) => invoke<void>("restore_backup", { file }),

  /** Writes a copy of the archive to a path the reader chose. */
  exportArchive: (path: string) => invoke<void>("export_archive", { path }),

  /** Puts an archive from a chosen file in place of the open one. Replaces; it
   *  does not merge. */
  importArchive: (path: string) => invoke<void>("import_archive", { path }),
};

export type { Speaker };
