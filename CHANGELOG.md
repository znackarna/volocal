# Changelog

Notable changes, in English. Commit messages up to and including 9 August 2026
are Czech, from before the project was opened up; they are left as they are.
The reasoning behind individual decisions lives in `docs/history/`, day by day,
and every published version also has its notes on the
[releases page](../../releases).

## 1.1.0 — 13 August 2026

A minor version rather than a patch, for two reasons: speaker recognition was
never using the graphics card it asked for, and the archive moves to schema 3.

- **Speaker recognition runs on the graphics card, and until now it never had.**
  DirectML registered, wrote a line in the log saying so, and then refused every
  batch it was given with `E_INVALIDARG` at `cam_layer/AveragePool` — so every
  recording's speakers were found on the processor while the log said otherwise.
  The cause was one frame: the model will not run that pooling layer under 199
  frames, and a two-second window at 16 kHz is exactly 198. The window now takes
  the larger of two seconds and what the model accepts, which is eighty samples
  more — five milliseconds. Measured over 256 windows: 97.5 ms on the card
  against 1333.8 ms on the processor, **13.7×**. The check that answers *is this
  machine using DirectML?* now puts a batch through the model as well as opening
  it, because opening it was the half that already worked.
- **Clicking a word starts at that word.** Whisper aligns tokens rather than
  words, so a run of short tokens can share one timestamp — 9.7 % of the words
  in a typical archive, in groups of two to six. Every word in such a group
  seeked to the first of them, lit up at the same moment, and offered the same
  position to the context menu. They are now spread across the gap to the next
  measured timestamp, weighted by length, with the measured word never moved.
  Validated against 6905 words that do have their own timestamps: mean error
  falls from 0.340 s to 0.101 s, closer in 92.2 % of cases.
- **A transcript opens without waiting for the end of itself.** Every word is a
  clickable element; the spaces between them were elements too, which doubled
  the count for nothing. And the window drew all of a forty-five minute
  transcript — 359 blocks, 6845 words — before showing any of it. It now draws
  the first screenful and the rest on the next frame.
- **The window opens sooner.** The transcript, the settings and the wizard are
  no longer read before the first paint: 457 kB rather than 583 kB. They are
  fetched a moment later, so the first press of a recording does not pay for it.
- **Speaker names typed before a run are offered after it.** They were written
  down and never read again: the transcript reads the list when the recording
  changes, and starting recognition from the transcript already on screen never
  changes it. A name cleared from a voice also returns to the list rather than
  having to be typed a second time.
- **The progress bar for speaker recognition reports the part that takes the
  time.** It stood at 10 % for the whole of the longest stage and then jumped to
  34. The features are 89 % of that stage — measured, 760 ms against 94 ms — and
  had been given 30 % of the bar and no report at all while they ran.
- **Coming back to a transcript that is still playing lands on the block being
  read** as soon as it is drawn, rather than at the next block boundary.
- The four values of `recordings.status` are English in the archive, which is
  the last Czech to leave the stored data. **This raises the schema to 3, and a
  build older than this one will refuse the archive by name** rather than open
  it and find every recording in a status it does not know. The migration is one
  statement and runs on first open; there is no way back to 1.0.10 afterwards.

## 1.0.10 — 13 August 2026

- The archive can be exported to a file and imported from one. Export uses
  `VACUUM INTO`, so the copy is consistent even though the archive runs in WAL
  mode — a file copied in a file manager can be missing everything written since
  the last checkpoint. Import replaces the current archive rather than merging
  with it, and refuses a file holding no archive tables or one written by a newer
  Volocal, checked before anything is replaced rather than after. The transcripts
  travel; the audio does not, because the archive stores paths to files that live
  outside it.
- Pressing *Zálohovat teď* twice inside one second reported *output file already
  exists: Error code 1: SQL error or missing database* about an archive that was
  perfectly fine. A backup's name is only accurate to the second, so the second
  click aimed at a name already taken. A file for this second is now taken to be
  the copy that call would have made.
- Speaker recognition records which processor it opened on. ONNX Runtime treats a
  provider it cannot register as a shrug and falls through to the processor
  silently, so a machine running this twelve times faster and one that is not
  looked identical from outside. DirectML is now asked for with
  `error_on_failure`, and the fall back is written to the log that the diagnostic
  report already carries.
- Measured, and recorded because it was assumed otherwise: an installed copy has
  no `DirectML.dll` beside it and gets the graphics card anyway, from the copy
  Windows ships in `System32` — here newer than the one `ort` downloads.

## 1.0.9 — 12 August 2026

- Fixes 1.0.8, which reported every model and program as missing. WebView2 keeps
  its profile in a folder named after the application's identifier, so the folder
  the tools migration was moving into already existed on every machine: the
  migration refused to run and the lookup answered with that folder — browser
  cache, and none of the tools. A folder is now recognised by holding `bin` or
  `models` rather than by existing, and the migration moves those two folders
  rather than the one around them.
- Nobody who installed 1.0.8 lost anything; the models never moved.

## 1.0.8 — withdrawn

Published and taken down the same day. See 1.0.9.

## 1.0.7 — 12 August 2026

- A backup can be put back from inside the application, listed by day with what
  it holds and how much audio. The current archive is copied aside before
  anything is replaced.
- An archive written by a newer Volocal is refused rather than guessed at, with
  a dialog that says to update the application and touch nothing.
- A start that fails writes `volocal-problem.txt` beside the log and the dialog
  says where it is — Settings, which holds the button that copies the technical
  details, cannot be reached when the application will not open.
- Settings can copy those details and open the log.
- Every status dot in the archive has its colour back. All four had been grey
  since 1.0.5: the class was built from the stored Czech status while the
  stylesheet had been translated to English, so none of them matched a rule.

## 1.0.6 — 11 August 2026

- Fixes 1.0.5 refusing to open an archive it had itself migrated, with *there is
  already another table or index with this name: recordings*. Nothing was lost
  in an archive that hit this — it was unopenable, not damaged — and 1.0.6
  repairs it on open.

## 1.0.5 — withdrawn

Published and taken down. See 1.0.6.

## 1.0.4 — 11 August 2026

- Speakers can be removed from the transcript panel; the passages keep their
  words and lose only the name.
- A speaker can be added by hand, the only way in for a recording that was never
  diarized.
- The transcript's context menu lists speakers by name instead of pointing at
  the block above and the block below.
- Updates carry release notes: the text is shown in a dialog before the download
  is agreed to.

## 1.0.3 — 11 August 2026

- The first update that installed itself end to end: an installed 1.0.1 found
  it, downloaded it, handed it to the installer and came back running.

## 1.0.2 — 11 August 2026

- The publishing pass refuses an installer whose filename does not carry the
  version being released, after 1.0.1 went out holding the 1.0.0 installer and
  updated itself to itself.
- The build calls Tauri directly rather than through npm, which was claiming
  `--config` for itself even after `--` and failing the build silently enough to
  leave the previous installer in the folder.

## 1.0.1 — 11 August 2026

- Same application as 1.0.0, published to find out whether updating works. Its
  assets were wrong; see 1.0.2.

## 1.0.0 — 11 August 2026

The first published release. The application below had been in daily use by its
author since 30 July; what 1.0.0 added was the release itself — a signing key
for the update feed, an installer, and an update path.

The installer is not code signed, and Windows warns the first time it is run.

## 0.9.0 — never published

The state the application was in when it was opened up, kept here because the
entries above are differences from it rather than a description of the whole
thing.

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
