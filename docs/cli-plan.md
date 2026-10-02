# Command line — plan

Decided with the owner on 2 October 2026: **English command names, working on
the application's own archive**, and — his shape, which replaced a first plan
the same day — **the command line must not change how the window works.** Then,
later, a build with no window at all. Not started; each stage waits for his
word.

## What it is for

Everything the archive can do without a window, from a script: transcribe a
batch, export a hundred recordings to SRT, search across all of them. A
recording made from the command line appears in the application too, because
it is the same archive.

## Commands

```
volocal-cli transcribe <file> [--language cs] [--model fast|accurate] [--speakers N]
volocal-cli list [--folder <name>] [--search <text>]
volocal-cli show <id>
volocal-cli export <id> --format txt|md|srt|vtt|json [--out <path>] [--force]
volocal-cli export-audio <id> --format mp3|m4a|wav [--out <path>] [--force]
volocal-cli status
```

`status`, `list`, `show`, `export` and `export-audio` exist since 2 October
2026. An id may be given as its first few characters, as `git` takes a short
hash.

Later, once they can be reached without the window: `import <url>` and
`ai <id> improve|summary|translate`. Never offered, because they belong to the
window: recording from a microphone, playback, and editing by hand.

## Why it can be done without touching the window

Most of the engine never knew there was one. Measured by import, not assumed:
`db.rs`, `export.rs`, `tools.rs`, `transcription/speakers.rs`,
`transcription/languages.rs` and `voiceprint.rs` have no tie to Tauri at all.
What is tied to the window is the layer that drives a transcription and reports
its progress (`transcription/mod.rs`), and the import, language-model and
download code.

So the command line uses the engine and **writes its own small driver** rather
than borrowing the window's. That repeats a little orchestration — convert,
transcribe, separate speakers, store — on purpose: the window's driver stays
exactly as it is, and nothing in it can break because of the command line.

## Stage 1 — beside the desktop application

**The core becomes a library.** `src-tauri` is one program today with no
`lib.rs`. The engine moves under a library; the window and the command line are
two programs on top of it. Structure changes, behaviour does not, and the
existing tests have to say so.

**One struct stops requiring the window.** `Run` in `whisper.rs` carries an
`AppHandle`, though `run_over_files` reports progress through its own callback
and never uses it. The window keeps passing it; the command line passes none.

**A separate `volocal-cli.exe`.** The application is built with
`windows_subsystem = "windows"`, which leaves it no console — anything it printed
from a terminal would go nowhere. A console program prints normally.

**Then the commands**, reading ones first (`list`, `show`, `export`,
`export-audio`, `status`) because they need nothing else, then `transcribe`.

**Shipping and documentation.** The installer carries the second program.
`docs/cli.md` is generated from its own `--help`, and `scripts/docs-check.mjs`
refuses a command documented but not present, or present but not documented.

## Stage 2 — no window at all

A build of the same command line that does not link Tauri or WebView2, for a
machine with no desktop. Stage 1 already makes it possible, because the engine
the command line uses has no tie to the window; what stage 2 adds is the build
and its own installer or archive.

## What to watch

- **Two transcriptions at once.** The window queues its own work and the
  command line would not know about it. Two whisper processes double the
  memory, and a memory failure is what a user hit on 24 September (`kód 10`,
  the accurate model on 72 minutes). The command line refuses to transcribe
  while the window is.
- **The window does not see changes made beside it** until it next reads the
  archive. Not dangerous; worth knowing.
- **Two writers are safe.** The archive runs in WAL with a five-second busy
  timeout (`db.rs`): readers never block a writer, and writers wait their turn.
