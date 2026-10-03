# Interactive screen for the command line — design proposal

A proposal, 3 October 2026. Nothing here is built, and nothing in it changes
how the window works. Four roles drew it up together — product, visual design,
Rust architecture and a critic — and the open questions at the end are the
owner's to answer before any of it is started.

The screens themselves are drawn in
[prototypes/volocal-tui.html](prototypes/volocal-tui.html), in both terminal
themes.

## What it is for

`volocal-cli` today is for scripts: six commands, plain output, English. The
interactive screen is for a person at a terminal: the archive to browse and
search, a transcript to read, a file to transcribe while its words appear, an
export to pick — without the window, and without remembering a single flag.

It stays inside [cli-plan.md](cli-plan.md): no microphone, no playback, no
hand editing, and the window behaves exactly as before.

## How it opens

| started as | what happens |
|---|---|
| `volocal-cli` in a terminal (stdin and stdout both terminals, `TERM` not `dumb`) | the screen opens |
| `volocal-cli tui` | the screen opens; outside a terminal it says so and exits 1 |
| `volocal-cli` in a pipe, a file, CI | exactly today: help on stderr, exit 2 |
| any of the six commands | unchanged, byte for byte |

The bare command matters most on Windows: a double-click on
`volocal-cli.exe` today flashes the help and the console closes. The usage line
in `--help` changes from `<COMMAND>` to `[COMMAND]`, so `docs/cli.md` is
regenerated and gains one line under *For scripts*.

The screen adds no new script contract: exit 0 on quit, 1 when it cannot start.

## Screens

**MVP** is the first release, **Next** the one after, **Later** needs an engine
entry or the owner's word.

**Archive** (home, MVP). Folders on the left with counts; recordings newest
first, two lines each — title, length, date; then language, speakers, blocks,
or the state: transcribing here with its percent, transcribing in the window,
waiting, failed with its reason. A status filter (all / not transcribed /
failed / second language missing) and the window's four sorts. The header
carries the archive's size, `128 přepisů · 41 h 12 min zvuku`. The list
follows the archive: when the window finishes a transcription it appears
without a key press.

**Search** (MVP). The same `/` field as the archive: titles filter at once,
transcript hits appear under their recording as `12:41 …navrhuji, aby se
rozpočet…` with the word highlighted. Accent-insensitive, as the window's
search is, so `kdyz` finds `když`. Enter opens the reader at that hit.

**Reader** (MVP, read-only). Title and meta, the speakers in the window's own
colours, then the blocks with times; a speaker's name only where the speaker
changes. Moves by block (`]` `[`) and by speaker (`}` `{`), jumps to a time
(`t`, then `39:07`), searches inside (`/`, `n`, `N`, `2 z 5`). Second-language
blocks carry their language. Copying a block (Next) and the window's AI
documents as read-only tabs (Later).

**New transcription** (MVP). `n` anywhere, or a file dragged onto the terminal.
A short sheet: the file, the language and the speakers (both default to the
window's choice), and the model shown but not chosen. Then the progress:

- the phases in the window's words, each ticked with how long it took;
- one bar, the time left, and what it runs on (`NVIDIA GeForce RTX 4070`);
- **the words as whisper writes them**, newest at the bottom. The engine already
  reports each block as it is made; today's CLI throws it away;
- the mark turns into the mill while it works (see *Look*).

`Esc` leaves the screen and the transcription carries on: a small mill and the
percent stay in the header of every screen, and in the Windows Terminal tab.
`Ctrl+C` stops it, after one question. Stopping goes through the same cancel
as the window's *Zrušit*, so the recording keeps what was done and is not left
marked as transcribing.

When it ends, a summary replaces the progress: `38:12 řeči přepsáno za 3:12 ·
12× rychleji než v reálném čase`, the speakers, the languages, and the next
step on Enter. One terminal bell if it finished while the terminal was in the
background.

**Second language.** `transcribe` takes the offer itself because nobody is there
to answer. Here somebody is, so the screen asks, as the window does: *Zazněla i
angličtina. Doplnit ji do přepisu?* — `d` fills it in, `x` declines, and
ignoring it leaves the offer in the archive for the window.

**Busy guard.** Before a file is added, the archive is checked for a
transcription in progress, as `transcribe` does today. If the window is
transcribing, the sheet offers *Spustit, až skončí* and waits, adding nothing to
the archive until it starts.

**Export** (MVP). `e` from the archive or the reader. The window's *Uložit jako*
as a dialog: text, Markdown, SRT, VTT, JSON, audio (MP3, M4A, WAV), several at
once; the folder; and an existing file is never overwritten without a question —
*Přepsat*, or *Uložit jako „Porada (2).srt"*. Batch export of marked recordings:
Next.

**Status** (MVP). Where the archive is and how large, whether ffmpeg, whisper,
the model and speaker separation are in place, what it computes on, the
version. Anything missing is said in the window's words with where to fix it —
the screen never downloads or sets anything up.

**Help** (MVP). `?` on any screen: this screen's keys first, then the global
ones.

**Next:** a queue of several files, transcribing a recording that is new or
failed, batch export, a command palette (`:` or `Ctrl+P`), copying a block.

**Not offered:** microphone, playback, hand editing and choosing a model
(cli-plan.md); re-transcribing a finished recording, which would replace
corrections made in the window; renaming, moving, deleting (open question 4);
downloads and settings, which are the window's.

## Keys

Arrows and vim keys both work everywhere. Every action has one key, and keys
do not change with the language. A footer on every screen lists the keys that
do something here, shortening as the terminal narrows; `? Nápověda` is the
last to go.

| key | |
|---|---|
| `↑↓` `jk`, `←→` `hl` | move; between panes |
| `PgUp` `PgDn`, `g` `G`, `Tab` | page; first and last; next pane |
| `Enter` | open, confirm |
| `Esc` / `q` | back; `q` on the archive quits |
| `/` | search — archive-wide in the archive, in the transcript in the reader |
| `n` | new transcription (in the reader after a search: next hit) |
| `e` | export |
| `1` `2` `3` `4` | archive, reader, transcription, status |
| `?` | help |
| `Ctrl+C` | stop the transcription (after a question); with nothing running, quit |

Reader: `]` `[` block, `}` `{` speaker, `t` go to a time, `n` `N` hits, `i`
info. Archive: `f` filter, `o` sort, `i` preview.

The mouse works in Windows Terminal: the wheel scrolls, a click selects, a
double-click opens, and Shift+drag still selects text. In the old console
(conhost) it is off, because capturing it breaks that console's own selection.
`VOLOCAL_MOUSE=0` turns it off anywhere.

## Language

The screen speaks the window's language: Czech with formal address on a Czech
system, English elsewhere, `VOLOCAL_LANG=cs|en` to choose. The phases, errors
and the second-language question come from the window's own dictionaries, so
they read exactly as there. The script surface — command names, flags,
`--help`, `docs/cli.md`, `error:` lines — stays English.

The screen's own text goes into a new namespace, `src/locales/cs/terminal.ts`,
created with `npm run i18n:new terminal`, so `i18n:check` holds it to vykání
like everything else.

## Look

The window's look carried into a character grid, not a new terminal theme.

- **Colour from the window's tokens.** Every role — ground, surface, text,
  muted, the petrol accent, the amber search highlight, success, warning,
  danger — is converted from `src/css/01-base.css`, light and dark. Where a
  colour is used as text, its lightness moves until it reaches 4.5:1, the rule
  the window uses for `--accent-solid`. The eight speaker colours are
  `db::COLORS`, adjusted the same way at runtime, so a speaker recoloured in the
  window keeps that colour here.
- **The terminal's own background shows through.** Only surfaces are painted:
  the header and footer bands, dialogs, the selected row, fields, keycaps,
  search hits. Light or dark is read from the terminal itself.
- **Four levels**: truecolor, 256 colours, 16 colours (selection becomes reverse
  video), and `NO_COLOR` (no colour at all; bold, underline and reverse still
  carry the meaning).
- **Airy, not boxed.** One header band, one footer band, a single rule beside
  the folders. Only a dialog has a frame, and the screen behind it fades.
- **The window's rhythm in cells.** The 8 px gap is no blank row, 18 and 22 px
  are one; every line of a dialog starts three cells inside its frame; dialogs
  are 52 or 64 columns, as the window's are 420 and 520 px.
- **Type.** Bold for titles, names, keys and the active item; small capitals in
  the muted colour only for column heads and section labels; italic only for
  placeholders and the words still being written.
- **The mark is the real one.** The `olo` face, rasterised into braille from the
  geometry in `src/brandArt.ts`. It blinks every six seconds and smiles every
  fourteen, as in the window. When a transcription starts it turns on its side
  into the mill — two rollers and an accent sheet passing between them, 1100 ms
  a pass — and the live words come out beside it. A one-line, four-cell mill
  marks a running transcription in lists and the header. The header shows
  `volocal` closing to `olo` once at start, without holding a key back.
- **The publisher's mark** is drawn the same way, from the geometry in
  `ZnackarnaMark`: two rows, a triangle, a circle and a square of one size, each
  in cells of its own. Never as the characters `▲●■`, whose sizes depend on the
  font, so the three never match.
- **Motion only while something works**, never before a key works. A loading
  screen appears only if the archive takes over 300 ms to open.
  `VOLOCAL_REDUCED_MOTION=1` keeps the face a face.
- **The old Windows console** gets an ASCII set (`>`, `+`, `x`, `|/-\`) and
  stays fully usable: its fonts have no braille and no ✓.

## Small terminals

Full function at 80×24: under 90 columns the folders fold into a chip in the
header (`Všechny přepisy · 128 ▾`, opened with `←`), length and date merge
into one cell, and the footer keeps four keys and `?`. Under 60×16 one line
asks for a larger window. Long transcripts lay out only what is visible.

## How it is built

**ratatui 0.30 with crossterm 0.29**, without default features. Measured in a
scratch crate with the repository's release profile: the binary grows by about
0.3 MB, a cold release build by about 16 s, and ratatui's minimum Rust is the
repository's own, 1.88. It is a default-on cargo feature, `tui`; the window
never links it, and `--no-default-features` builds the plain CLI.

**It lives in the CLI binary, not in the engine.** `volocal-cli.rs` becomes a
folder, `src/bin/volocal-cli/`:

```
main.rs        clap; no command in a terminal → tui::run, otherwise the commands
commands.rs    the six commands, moved unchanged
archive.rs     find_recording, destination, the busy check
messages.rs    the dictionaries (cs and en) and plural rules
engine.rs      the transcribe sequence, shared by `transcribe` and the screen
tui/
  app.rs       the screen: what is open, what may start, dialogs, notices
  terminal.rs  raw mode and alternate screen, restored on every exit; colour and glyph detection
  theme.rs     the colour roles and the glyph sets
  report.rs    engine events into the screen's channel
  archive/  reader/  transcribe/  export/  status/   one feature each: model and actions, view
```

Each feature owns its state and hands back a named model and named actions; it
asks `app.rs` for a dialog, a notice or a transcription by name. The screen
starts the work, which is where the busy check runs — the CLAUDE.md rule that a
feature does not reach for the shell.

**Progress needs no engine change.** The engine reports through
`Report::Callback` (`transcription/mod.rs`); the screen passes a closure that
sends each event into its own channel. A worker thread runs the
transcription with its own database connection; the screen redraws on events,
and ticks only while something moves. The window's rule that a phase never
moves backwards (`useTranscriptionRuntime.ts`) is ported with its test.

**The archive is followed** through `PRAGMA data_version`, checked once a
second: it changes whenever another connection — the window, say — commits.

**Terminal hygiene.** Its own panic hook rather than `ratatui::init()`, whose
hook would tear the screen down on panics the engine already recovers from.
Only key presses are read, because Windows reports releases too. Quitting
during a transcription cancels it and waits for it (at most about 10 s), so the
recording is never left marked as transcribing; closing the console window goes
through the same cancel.

**Three engine changes, all additive, none touching the window:**

1. `die_with_this_process` made public and called by the CLI, so whisper does
   not outlive a closed terminal. The plain `transcribe` has the same gap today.
2. The window's refusal of the second language moved out of its Tauri command
   into one function both programs call — only if the screen asks the question.
3. `Deserialize` on the two progress events — optional.

**Tests.** Feature models are tested without a terminal; views with ratatui's
`TestBackend` at 80×24 and 40×12, Unicode and ASCII, Czech and English, against
text snapshots kept the way `docs/cli.md` is kept (rewritten with an
environment variable, compared otherwise). CI gains one step: clippy on the
plain CLI without the feature.

## Order of work

Each step can go to `dev` on its own.

| | step | after it |
|---|---|---|
| 0 | the CLI becomes a folder; the transcribe sequence one function; whisper dies with the CLI | the same CLI; `docs/cli.md` unchanged |
| 1 | the screen's frame and Status | `volocal-cli` opens a status screen |
| 2 | Archive and search | the archive can be browsed and searched |
| 3 | Reader | a transcript can be read |
| 4 | Export | a transcript or its audio can be saved |
| 5 | New transcription | transcribing from the screen, with live words |
| 6 | a pass on conhost, Windows Terminal, PowerShell, VS Code, Git Bash; both READMEs | release |

About 3 500–4 000 lines of Rust with tests. Steps 0–2 are the smallest useful
release; step 5 carries the real risk.

## What to watch

- **Quitting under a running transcription** leaves the recording marked as
  transcribing, which blocks every later run in both programs until the window
  next starts. Hence cancel-and-wait on every way out.
- **The busy check is a check, not a lock.** The window can start between the
  check and the start; checking at the moment of starting narrows it. The real
  fix is the window checking too (open question 6).
- **Windows terminals differ.** Only a manual pass on real machines confirms the
  glyph, mouse and paste fallbacks; CI has no terminal.
- **`i18n:check` does not read Rust.** The screen's keys need a Rust test that
  each one exists in both dictionaries.

## Questions for the owner

1. Does bare `volocal-cli` open the screen in a terminal, or only
   `volocal-cli tui`?
2. Czech on a Czech system (proposed), or English like the rest of the CLI?
3. Does the screen ask about a second language (proposed), or take it as
   `transcribe` does?
4. Which archive housekeeping is in: transcribing a new or failed recording
   (proposed, Next); moving into a folder; renaming; deleting (proposed: no)?
5. A recording left marked as transcribing after a crash blocks every new run
   until the window starts. May the screen clear the mark when it can show
   nothing is running, or is that always the window's job?
6. Should the window check the archive before it starts transcribing? That is a
   change to the window, and cli-plan.md already names the gap.
7. The three engine changes above — agreed?
