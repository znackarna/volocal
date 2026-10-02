# Command line — plan

Decided with the owner on 2 October 2026: **English command names, working on
the application's own archive.** Not started; each phase waits for his word.

## What it is for

Everything the archive can do without a window, from a script: transcribe a
batch, export a hundred recordings to SRT, search across all of them. A
recording made from the command line appears in the application too, because
it is the same archive.

## Commands

```
volocal transcribe <file> [--language cs] [--model fast|accurate] [--speakers N]
volocal import <url>
volocal list [--folder <name>] [--search <text>]
volocal show <id>
volocal export <id> --format txt|md|srt|vtt|json [--out <path>]
volocal export-audio <id> --format mp3|m4a|wav [--out <path>]
volocal ai <id> improve|summary|translate [--to <language>]
volocal delete <id>
volocal status
```

Not offered, because they belong to the window: recording from a microphone,
playback, and editing a transcript by hand.

## Phases

**1. Split the crate.** `src-tauri` is one binary today with no `lib.rs`. The
core becomes a library, the window one binary on top of it, the command line a
second. Nothing a user can see changes; the existing tests prove it.

**2. The commands that only read.** `list`, `show`, `export`, `export-audio`,
`status`. They call `db.rs` and `export.rs`, which have no tie to the window at
all, so this phase needs nothing else. Useful on its own.

**3. The long-running commands.** `transcribe`, `import`, `ai`. These report
progress by `app.emit(…)` — about fifteen places across the transcription,
import and language-model code. That becomes one reporting interface: the
window implements it by sending events, the command line by printing.

**4. Shipping and documentation.** The installer carries `volocal-cli.exe`.
`docs/cli.md` is generated from the program's own `--help`, and
`scripts/docs-check.mjs` refuses a command documented but not present, or
present but not documented.

## Why a second program

The application is built with `windows_subsystem = "windows"`, which gives it
no console: anything it prints from a terminal goes nowhere. A separate
`volocal-cli.exe` built as a console program prints normally and shares the
same core.

## What to watch

- **Two transcriptions at once.** The window queues its own work; the command
  line would not know about it. Two whisper processes double the memory, and a
  memory failure is exactly what a user hit on 24 September (`kód 10`, the
  accurate model on a 72-minute recording). The command line should refuse to
  start while the window is transcribing, or join the same queue.
- **The window does not see changes made beside it.** A recording added from
  the command line shows up the next time the archive is read. Not dangerous;
  worth knowing.
- **Two writers.** The archive runs in WAL with a five-second busy timeout
  (`db.rs`), so readers never block a writer and writers wait their turn. Two
  processes on one archive are safe for this.
