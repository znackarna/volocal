# Change log

The reasoning behind every decision in Volocal, one file per day, moved out of
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
| [2026-08-11](2026-08-11.md) | 12 | Volocal 1.0.0, and a signing key that is worth something |
| [2026-08-12](2026-08-12.md) | 33 | The code speaks English, and five releases go out … |
| [2026-08-13](2026-08-13.md) | 2 | A backup taken twice in one second is one backup … |

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

**[2026-08-11](2026-08-11.md)** — Volocal 1.0.0. By the end of the night an update installed itself end to end — after a release that carried the previous version's installer, and a job object that killed the installer a moment after starting it. The updater's signing key was replaced with one that has a password, which is free before the first release and impossible after it.

**[2026-08-12](2026-08-12.md)** — Every Czech identifier, class name and comment turned English, the database schema with them and a migration that carries each archive over. Five releases: 1.0.5 refused the archive it had migrated and was replaced by 1.0.6; 1.0.8 pointed the application at a folder of browser cache and was replaced by 1.0.9 and deleted. In between: a backup can be restored from inside the application, a failed start writes a report the owner can hand over, and the status dots got their colour back after being grey since 1.0.5. The day ended with one branch instead of five, and a repository cleared of dead files — and of documents that still called the product Slobot and said it had never been released.

**[2026-08-13](2026-08-13.md)** — Pressing *Zálohovat teď* twice in the same second reported *SQL error or missing database* about an archive that was fine. And the archive card arranged the way its owner wanted it: saving a copy on a band of its own, and the note about replacing an archive written as two plain sentences rather than one that explains itself.
