# Changelog

Notable changes, in English. Commit messages up to and including 9 August 2026
are Czech, from before the project was opened up; they are left as they are.
The reasoning behind individual decisions lives in `CLAUDE.md`.

## 0.9.0 — not yet released

The first version worth handing to somebody else. Everything below works and is
in daily use by its author. Development started on 30 July 2026, so this entry
covers the whole application rather than a difference from a previous release.

### Transcription

- Local transcription with whisper.cpp in three quality tiers — Precizní
  (`large-v3`), Vyvážený (`large-v3-q5_0`), Rychlý (`large-v3-turbo-q5_0`).
- Runs on an NVIDIA card (CUDA), any card through Vulkan, or the processor.
  The choice is made from the drivers actually present, and a downloaded build
  the machine cannot run is not offered. A benchmark measures each available
  backend on a piece of the recording and selects the fastest.
- Silero VAD for speech detection, with adaptive sentence-length blocks so a
  long unpunctuated passage does not become one wall of text.
- Transcriptions run one at a time in a queue; a waiting recording says so.
- Cancelling reaches every stage, including the preparation programs.
- MP3 sources get a cached AAC proxy so that clicking a word lands where the
  word is: a long VBR MP3's Xing index put 39:07 at 39:15 in the webview.

### Speakers

- Speaker recognition without a second neural model: windows come from the
  transcript's own word timings, features are computed in-process, and CAM++
  runs through ONNX Runtime — DirectML on Windows, falling back to the
  processor. It no longer spawns `sherpa-onnx`.
- Asking how many people speak before a run, and optionally naming them, so
  they can be applied to a voice afterwards with one click.
- Naming two rows the same merges them; a block can be reassigned to a
  neighbouring voice or to a voice the machine never found.
- Short interjections that recognition cannot place are listed on their own and
  assigned in one click; a short gap between one voice is filled automatically.

### Working with a transcript

- Click a word to play from it, double-click a block to edit it.
- Places the transcript was unsure about are marked and collected in the
  sidebar; F3 walks them.
- Ctrl+F finds inside one transcript, diacritic- and case-insensitively, so
  `reknu` finds `řeknu`.
- Corrections keep their original wording, so what changed stays visible.
- Notes, pinned to a moment or loose.
- A dictionary of substitutions applied across every recording.

### Enhancing, summarising, translating

- An optional local language model (Gemma through llama.cpp) produces a
  separate untimed document — faithful or cleaned — and from it a summary in
  three lengths and a translation into nine languages. Results are cached and
  invalidated when their source changes.
- The timed transcript is never rewritten by any of it, and SRT, VTT and JSON
  never carry enhanced text.
- The enhanced document keeps the language of the recording; a chunk that comes
  back as a translation instead of an edit is rejected and retried.

### Getting audio in

- Drag and drop, a file picker, recording from a microphone, audio pulled out
  of an online video with yt-dlp, and a watched folder that offers what appears
  in it.
- A recordings folder of the application's own, with an option to copy imported
  files into it so deleting the original loses nothing.

### Library and interface

- Folders, search, date filter, sorting, and a compact list.
- Czech interface throughout, addressing the reader formally; English is
  complete and switchable. Every visible string lives in a dictionary and
  `npm run i18n:check` refuses text written inside a component.
- Light and dark themes, chosen or following the system.
- Export to TXT, Markdown, SRT, VTT and JSON, and audio to MP3, M4A or WAV.
- The archive is one SQLite file, backed up on every start, keeping the newest
  three plus the newest of each of the last seven days.

### Known limitations at 0.9.0

- Downloaded components are verified by neither checksum nor signature.
- The webview's asset scope is `**`, because a recording may sit on any drive.
- The installer is not code signed.
- The archive is not encrypted.
- Word timings are an estimate; Whisper marks segments, not words.
- Speaker recognition is reliable for an interview, not for a panel, and does
  not handle overlapping speech.
- Downloads cannot be resumed.
- There are no automated frontend tests.
