# How the command line looks in a terminal

Built on 3 October 2026. It replaces a proposal for a full-screen interface,
which the owner turned down the same day: the command line deserves a better
picture of its progress, not a program of its own inside the terminal.

The output is drawn in [prototypes/volocal-cli-look.html](prototypes/volocal-cli-look.html).

## What changes

The six commands print better **when their stream is a terminal**: aligned
columns, a state mark on each recording, the search hit highlighted, speakers
in their colours, and for `transcribe` a live block that shows where the work
is. What a person reads is in the system's language when that is Czech, and
English otherwise; `VOLOCAL_LANG=cs|en` chooses.

**Nothing else changes.** No new command, no new flag, the same `--help`, the
same exit codes. In a pipe, a file, with `NO_COLOR` or `TERM=dumb`, every byte
is what it was, in English, and it comes from the same code as before: each
command asks first whether its stream is a terminal, and only then hands its
data to the new code. Stdout keeps carrying only data (the id from
`transcribe`, the path from `export`) whenever a script reads it.

**The window is untouched.** Everything new is inside the command line's own
program. The engine gained one word: `die_with_this_process` became `pub`, so
the command line can make the same call the window makes. `Cargo.toml`, the
dictionaries and the window's code are as they were.

## `transcribe`

- **A header line**: the title, the length, the model and what it runs on.
- **The words as whisper writes them**, a block at a time with its start time,
  printed as ordinary lines, so they stay in the terminal's scrollback.
- **A live block at the bottom**, redrawn in place: each finished phase ticked
  with how long it took, the running one with the mill from the mark, the
  position (`15:17 z 38:12`), a bar, the percent and an estimate of the time
  left, then how to stop.
- **A summary** in place of the block when the run ends: the time it took and
  how much faster than the recording, the blocks, speakers, languages and
  model, the phases on one line. The id follows on stdout.

**Ctrl+C** stops the run, and the last line says what is left: a first
transcription stopped before it saves stays in the archive without a
transcript, because the engine writes blocks only at the end.

**Closing the console** during a run now waits for the stop to be written down,
up to four of the five seconds Windows allows. Before, the process ended first
and the recording stayed marked as transcribing, which blocked every later run.
And whisper ends with the command line instead of outliving a closed terminal.

## The other commands

- **`list`** — short id, date, length, a mark for the state, the title, then the
  speakers and language, or the state in words; the count and total length at
  the foot. With `--search`, the hits under their recording.
- **`show`** — the same fields as before, labels in a muted column, each
  speaker's name in their colour.
- **`status`** — a checklist of what transcription needs, then whether it is
  ready, and each missing part in the window's sentence.
- **`export`, `export-audio`** — `✓ Uloženo` with the path; audio export shows
  the mill while ffmpeg converts.
- **Errors** — a sentence with `✕` instead of the `error:` line.

## Look

- **The terminal's own sixteen colours.** The theme of the terminal decides what
  green or bright blue look like, so the marks read on a dark background and a
  light one alike. A fixed palette from the window, tuned for one background,
  would not. Colour is used only where it says something: the running thing,
  done, missing, failed, the hit, the speakers. Backgrounds are never painted,
  except behind a search hit.
- **Speakers** keep their place in the window's eight colours: the stored colour
  is matched to the nearest of `db::COLORS`, and each of those has its own of
  the sixteen.
- **The old Windows console** gets ASCII marks (`+`, `x`, `|/-\`, `=>-`), since
  its fonts have no braille and no ✓. Windows Terminal and VS Code say who
  they are, and get the full set.

## How it is built

`src-tauri/src/bin/volocal-cli/`:

| file | |
|---|---|
| `main.rs` | the commands as they were, each asking first whether its stream is a terminal; the errors as `Problem`, whose English is the old text word for word |
| `look.rs` | whether a stream is a person's terminal, the language, the width; colours, marks, counts in Czech and English, and the words the command line says itself |
| `styled.rs` | `list`, `show`, `status`, the saved line and the summary, for a terminal |
| `live.rs` | the live block under a transcription, and the turning mill for audio export |

The console is asked directly, through the `windows` crate's console calls the
command line already used: to switch on escape sequences in the old console,
and for its width. The display language comes from `GetUserDefaultUILanguage`,
declared in the program rather than enabled as a new feature of the `windows`
crate, so the window's build is unchanged.

The window's rule that a phase never moves backwards is ported with its cases,
so the block does not flicker between phases.

## Verified

- Every plain output, compared byte for byte between the program before and
  after on the same archive: `list`, `list --folder`, `list --search`, `show`,
  `status`, `export` and its refusals, `transcribe` refusals, an unknown
  command. Identical, exit codes included.
- 25 tests of the command line, among them the old English of every error,
  the Czech dictionary read without its translator notes, the phase order,
  and the block's lines never wider than the console.
- `cargo clippy --all-targets -D warnings` and `cargo test` for the Windows
  target; the engine's 315 passing tests are the same before and after.

What has not been seen yet is the live block on a real Windows console during a
real transcription; the checks above ran under Wine, without whisper.

## The window and a run in the command line

The owner's answer to the one open question, the same day: the window checks.
`transcribe` holds `running\<id>.lock` beside the archive while it works,
opened so nobody else can open it and deleted by Windows when the process
ends, however it ends (`src-tauri/src/run_lock.rs`). The window asks for the
held ones and then:

- **on starting**, leaves those recordings to the command line instead of
  marking them as failed;
- **before its own transcription**, waits while one is held, showing *Čeká, až
  skončí přepis v příkazové řádce*, so there is never a second whisper beside
  the first;
- **on the card**, says *Přepisuje se v příkazové řádce* and offers no
  *Zrušit*, and reads the archive again when such a run starts or ends.

With no command line running, nothing is held and the window does what it did
before.
