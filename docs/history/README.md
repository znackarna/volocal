# Change log

The reasoning behind every decision in Slobot, one file per day, moved out of
`CLAUDE.md` on 2026-08-10 because that file had grown to 630 000 characters —
four times what a session can read — and was being loaded in full before every
task. Nothing was rewritten or dropped in the move.

Read a day when you need the reason behind something you are about to change.
A correcting entry never deletes the one it corrects; it is added after it, so
the later entry wins and the earlier one still explains what was believed at
the time.

| Day | Entries | |
|---|---|---|
| [2026-08-01](2026-08-01.md) | 4 | Precise seeking for long VBR MP3 recordings … |
| [2026-08-02](2026-08-02.md) | 136 | Adaptive readable transcript blocks … |
| [2026-08-03](2026-08-03.md) | 52 | Multiline sidebar notes … |
| [2026-08-04](2026-08-04.md) | 50 | Phase A of the audit: nothing may quietly destroy work … |
| [2026-08-05](2026-08-05.md) | 99 | Recording from the microphone … |
| [2026-08-06](2026-08-06.md) | 41 | The portable copy is called Slobot, and so is the package … |
| [2026-08-07](2026-08-07.md) | 40 | A recording one worker holds is not offered to another … |
| [2026-08-08](2026-08-08.md) | 10 | The unnamed interjections get a list of their own … |
| [2026-08-09](2026-08-09.md) | 4 | The audio the application makes has a folder of its own … |
| [2026-08-10](2026-08-10.md) | 23 | The change log leaves CLAUDE.md … |
| [2026-08-11](2026-08-11.md) | 8 | Volocal 1.0.0, and a signing key that is worth something |

## What each day was about

**[2026-08-01](2026-08-01.md)** — Precise seeking in long VBR MP3s, and the transcription pipeline's phases.

**[2026-08-02](2026-08-02.md)** — Readable transcript blocks, the local language model — enhancing, summarising, translating — online import, and the first pass over Settings.

**[2026-08-03](2026-08-03.md)** — Interface text moved into a dictionary and the checks that keep it there; notes; the speaker-count question; the embedding model that fixed diarization.

**[2026-08-04](2026-08-04.md)** — The audit: nothing may quietly destroy work. Cancelling, backups, the dictionary page, the transcript context menu, corrections kept beside the text.

**[2026-08-05](2026-08-05.md)** — Recording from a microphone, folders, saving audio, one rule for choosing among a row, and the About tab.

**[2026-08-06](2026-08-06.md)** — The public repository, the installer's branding and Czech, the content policy, and the first speaker measurements.

**[2026-08-07](2026-08-07.md)** — Speaker recognition moved inside the application: DirectML measured, sherpa-onnx dropped, CAM++ through ONNX Runtime.

**[2026-08-08](2026-08-08.md)** — Unnamed interjections, names offered before a run, the sidebar as cards.

**[2026-08-09](2026-08-09.md)** — A folder for recordings, search inside a transcript, WebView2's own shortcuts switched off.

**[2026-08-10](2026-08-10.md)** — The hardening plan, start to finish. The log moved here; the baseline got its Windows numbers; the security documentation was made to match the code; all 21 Clippy findings fixed and CI now refuses new ones; fifteen downloads pinned and compared against a published digest; four oversized files split by what they do; the webview's access to the disk closed to one file at a time — which corrects an entry written the same morning; the interface's first tests; Vite 5 to 8; and a release candidate that has to install and run before it counts. Then the day kept going: Slobot became Volocal, identifier and all, with a migration that carries the archive over; the header took the drawn wordmark; a nested transaction that broke deleting a folder was found and fixed; and the release path got a script, a version command and documents that no longer promise there is no update check.

**[2026-08-11](2026-08-11.md)** — Volocal 1.0.0. The updater's signing key was replaced with one that has a password, which is free before the first release and impossible after it.
