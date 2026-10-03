# How the command line looks in a terminal — proposal

A proposal, 3 October 2026, not started. It replaces an earlier one for a
full-screen interface, which the owner turned down the same day: the command
line deserves a better picture of its progress, not a program of its own
inside the terminal.

The output is drawn in [prototypes/volocal-cli-look.html](prototypes/volocal-cli-look.html).

## What changes

The six commands print better **when their stream is a terminal**: aligned
columns, a state mark on each recording, the search hit in the window's amber,
speakers in their colours, and for `transcribe` a live block that shows where
the work is.

**Nothing else changes.** No new command, no new flag, the same `--help`, the
same `docs/cli.md`, the same exit codes. In a pipe, a file, with `NO_COLOR` or
`TERM=dumb`, every byte is what it is today, and a test holds it there. Stdout
keeps carrying only data (the id from `transcribe`, the path from `export`);
everything drawn for a person goes to stderr, as progress does now.

The language stays English, as the command line is today (question 1).

## `transcribe`

Today it rewrites one line with a percent. In a terminal it becomes:

- **a header line**: the title, the length, the language, the model and what it
  runs on (`CUDA`, `Vulkan` or the processor, which is all the engine knows);
- **the words as whisper writes them**, a block at a time with its start time,
  printed as ordinary lines. They stay in the terminal's scrollback after the
  run, which a full-screen view could not offer. The engine already reports
  each block (`transcription:segment`); today's CLI throws it away;
- **a live block at the bottom**, redrawn in place: each finished phase ticked
  with how long it took, and the running one with a four-cell mill taken from
  the mark, the position (`15:17 / 38:12`), a bar in the accent colour, the
  percent and an estimate of the time left. Phases appear when they start;
- **a summary** that replaces the live block when the run ends: `✓ Transcribed
  in 3:12, 12× faster than the recording`, then the blocks, speakers, languages
  and model, then the phases folded into one muted line. The id follows on
  stdout, alone on its line, as today.

**Ctrl+C** stops the run, as it does today, and the last line says what is
left: a first transcription stopped before it saves stays in the archive,
untranscribed, and the words shown so far are not kept, because the engine
writes blocks only at the end.

The second language is taken as today: heard, it is written in, and the summary
says so.

## The other commands

- **`list`** — aligned columns: short id, date, length, a mark for the state
  (`✓` done, the mill for transcribing, `✕` failed, `·` not transcribed), the
  title, and the speakers and language in the muted colour. With `--search`,
  hits are grouped under their recording, the match in amber rather than bold.
- **`show`** — the same fields as now, labels in a muted column, each speaker's
  name in its colour.
- **`status`** — a checklist: `✓` for what is found, `!` for what is missing
  with the window's sentence on where to get it, then whether it is ready.
- **`export`, `export-audio`** — `✓ Saved` with the path; audio export, which
  runs ffmpeg, shows the live block while it converts. A refusal (`already
  exists; add --force`) is marked `✕` in the danger colour.

## Look

From the earlier proposal, what fits on a line:

- **Colours from the window's palette** (`src/css/01-base.css`), brought to
  4.5:1 as text; speaker colours read from each speaker in the archive and
  adjusted the same way. Used only where they carry meaning: the accent for the
  running thing, success, warning, danger, the amber hit, speakers. Everything
  else is the terminal's own text colour or muted.
- **Truecolor, 256 colours or 16**, whichever the terminal offers; `NO_COLOR`
  gives the plain output.
- **The terminal's background is never painted.**
- **The old Windows console** gets ASCII (`+`, `x`, `|/-\`, `[====>---]`): its
  fonts have no braille and no ✓.

## How it is built

**No new crate.** `clap` already brings `anstyle`, `anstream` and
`anstyle-query` into `Cargo.lock`; listing `anstyle-query` among the
dependencies lets the CLI ask whether a stream wants colour and switch on VT
sequences in the Windows console (`enable_ansi_colors`). The console's width
comes from `GetConsoleScreenBufferInfo`, whose feature (`Win32_System_Console`)
the `windows` dependency already has.

**One small module beside the commands**, `src/bin/volocal-cli/look.rs` once
the file becomes a folder: the palette roles and glyph sets, the styled
writers, and the live block. The commands keep their content and their order;
they hand it to the module instead of to `println!`.

**The live block** is a few lines on stderr, moved over with
`ESC[nA` and cleared with `ESC[J`. Each line is cut to the width so the count
of rows stays true; a block of words is wrapped by the module before it is
printed above. whisper reports its percent from a second thread, so the block
sits behind a mutex, as the one line does today. It redraws at most ten times a
second. The window's rule that a phase never moves backwards
(`useTranscriptionRuntime.ts`) is ported with its test, so the block does not
flicker between phases.

**Two fixes** that belong to `transcribe` whatever it looks like:

1. Closing the console during a run leaves the recording marked as
   transcribing. `stop_on_ctrl_c` cancels and returns at once, and Windows ends
   the process before the engine writes the status. The handler waits for the
   run to end, up to about 4 s of the 5 Windows allows.
2. whisper can outlive a closed terminal: the job object that ends child
   processes with their parent is private to the window. `die_with_this_process`
   becomes public and the CLI calls it first. The window's call is unchanged.

**Tests.** The plain output of every command is pinned by tests that run it
against a temporary archive, written before any styling is added, so the
promise above is checked rather than asserted. The styled output is compared
with text snapshots, kept the way `docs/cli.md` is kept: rewritten with an
environment variable, compared otherwise.

## Order of work

Each step goes to `dev` on its own, with its history entry.

| | step | after it |
|---|---|---|
| 0 | tests pinning today's output of all six commands; the two fixes | the same CLI, two bugs fewer |
| 1 | `look.rs`: palette, glyphs, colour and width detection | nothing visible yet |
| 2 | `list`, `show`, `status`, `export` styled | the reading commands look better |
| 3 | `transcribe`: live words, live block, summary | progress worth watching |
| 4 | a pass on conhost, Windows Terminal, PowerShell 5 and 7, VS Code | release |

About 600–900 lines of Rust with tests.

## What to watch

- **A terminal narrowed during a run** wraps the live block's old lines, and
  the next redraw miscounts them; one frame is left behind in the scrollback.
  The usual cost of the technique; `cargo` lives with it.
- **The window's start-up tidy-up takes a running CLI transcription for a crashed
  one** (`recover_interrupted`): opening the window during a long `transcribe`
  shows it as failed and offers *Zkusit znovu*. This is true today and the look
  does not change it (question 3).

## Questions for the owner

1. English, as the command line is today, or the system's language (Czech with
   formal address on a Czech system)?
2. Live words shown by default in a terminal, as proposed, or only when asked
   for? Asking would mean a flag, and so a change to `--help`.
3. The window, on starting, treats a running CLI transcription as crashed.
   Should it look at the archive first? That is a change to the window.
4. The two fixes above: agreed?
