# Command line — plan

Decided with the owner on 2 October 2026: **English command names, working on
the application's own archive**, and — his shape, which replaced a first plan
the same day — **the command line must not change how the window works.** Then,
later, a build with no window at all. Stage 1 is built; stage 2 waits for his
word.

## What it is for

Everything the archive can do without a window, from a script: transcribe a
batch, export a hundred recordings to SRT, search across all of them. A
recording made from the command line appears in the application too, because
it is the same archive.

## Commands

```
volocal-cli transcribe <file> [--language cs] [--speakers N]
volocal-cli list [--folder <name>] [--search <text>]
volocal-cli show <id>
volocal-cli export <id> --format txt|md|srt|vtt|json [--out <path>] [--force]
volocal-cli export-audio <id> --format mp3|m4a|wav [--out <path>] [--force]
volocal-cli status
```

All six exist since 2 October 2026. An id may be given as its first few
characters, as `git` takes a short hash. `transcribe` uses the model chosen in
the window; a `--model` switch would have to reach inside the pipeline, which
this stage leaves alone.

Later, once they can be reached without the window: `import <url>` and
`ai <id> improve|summary|translate`. Never offered, because they belong to the
window: recording from a microphone, playback, and editing by hand.

## Why it can be done without touching the window

Most of the engine never knew there was one: `db.rs`, `export.rs`, `tools.rs`
and `voiceprint.rs` import nothing from Tauri. The transcription did, and only
to tell the window how far it had got.

**One transcription for both programs** (decided with the owner on 2 October,
replacing an earlier line here about the command line writing its own driver).
The pipeline reports through `transcription::Report`: to the window as it
always did, or to a terminal. What it converts, transcribes, separates and
stores is the same code for both, so a fix in one is a fix in the other, and
nothing has to be kept in step by hand.

## Stage 1 — beside the desktop application

**The core becomes a library.** `src-tauri` is one program today with no
`lib.rs`. The engine moves under a library; the window and the command line are
two programs on top of it. Structure changes, behaviour does not, and the
existing tests have to say so.

**The transcription reports through `Report`**, not to the window directly.
The window passes itself and sees every event as before.

**A separate `volocal-cli.exe`.** The application is built with
`windows_subsystem = "windows"`, which leaves it no console — anything it printed
from a terminal would go nowhere. A console program prints normally.

**Then the commands**, reading ones first (`list`, `show`, `export`,
`export-audio`, `status`) because they need nothing else, then `transcribe`.

**Shipping and documentation.** The installer carries the second program on
its own: Tauri's bundler packs every program the package builds. It adds about
6 MB, mostly ONNX Runtime for telling speakers apart. `docs/cli.md` is generated
from the program's own `--help`, and a test fails whenever the two differ.

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
  while the archive says anything is being transcribed. The window does not
  check the other way round yet.
- **The window does not see changes made beside it** until it next reads the
  archive. Not dangerous; worth knowing.
- **Two writers are safe.** The archive runs in WAL with a five-second busy
  timeout (`db.rs`): readers never block a writer, and writers wait their turn.
