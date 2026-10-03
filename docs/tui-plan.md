# Interactive screen for the command line — design proposal

A proposal, 3 October 2026. Nothing here is built yet. The open questions at
the end are the owner's to answer before any of it is started.

The screens are drawn in [prototypes/volocal-tui.html](prototypes/volocal-tui.html),
on dark and light terminals.

## What it is for

`volocal-cli` today is for scripts: six commands, plain output, English. The
interactive screen is for a person at a terminal: the archive to browse and
search, a transcript to read, a file to transcribe while its words appear, an
export to pick, all without remembering a single flag.

It stays inside [cli-plan.md](cli-plan.md). It offers no microphone, no
playback and no hand editing, and the window does what it did before.

## How it opens

| started as | what happens |
|---|---|
| `volocal-cli` with stdin and stdout both a terminal, `TERM` not `dumb` | the screen opens |
| `volocal-cli` in a pipe, a file, CI | as today: the help on stderr, exit 2 |
| any of the six commands | unchanged |

On Windows this matters most: a double-click on `volocal-cli.exe` today flashes
the help and the console closes.

Two things do change, so "unchanged" is about the six commands only. The usage
line in `--help` becomes `volocal-cli [COMMAND]` instead of `<COMMAND>`, and
`docs/cli.md` is regenerated with one more line under *For scripts*. With the
subcommand optional, clap no longer prints the help on its own; `main` raises
`ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand` to keep today's output
and exit code.

An explicit `volocal-cli tui` would add a seventh command to `--help`; question
1 asks whether it is wanted.

The screen adds no script contract: exit 0 on quit, 1 when it cannot start. The
six commands remain the way in for a screen reader, which cannot follow a
full-screen view.

## Screens

**MVP** is the first release, **Next** the one after, **Later** needs an engine
entry or the owner's word.

**Archive** (home, MVP). Folders on the left with counts; recordings newest
first, two lines each: title, length and date, then language, speakers and
blocks, or the state. The states are: transcribing here (with percent),
transcribing in the window (no percent, which only the window knows), not yet
transcribed, failed with its reason. A filter (all, not transcribed, failed,
second language missing) and the window's four sorts. The header carries the
archive's size, `128 nahrávek · 41 h 12 min zvuku`. When the window finishes a
transcription, the list shows it without a key press.

**Search** (MVP). One `/` field. Titles filter as you type; this is new, because
the window searches transcripts only, and titles need the same accent folding
in Rust that `transcriptText.ts` gives the window. Transcript hits come from the
archive's index, which ignores accents (`kdyz` finds `když`), and appear under
their recording with the sentence they were said in. As in the window: at least
two characters, 220 ms after the last key. The query runs on a worker
connection and is interrupted when the next key arrives. The index returns the
best 100 hits across the archive; past that the count reads `100+` rather than
pretending to be complete. Enter opens the reader at the hit.

**Reader** (MVP, read-only). Title and meta, the speakers in their colours, then
the blocks with times; a speaker's name only where the speaker changes. A block
cursor moves with `↑↓`, by speaker with `m` `M`; `t` jumps to a time (`39:07`);
`/` searches inside (`n` `N`, `2 z 5`). Second-language blocks carry their
language. Copying a block (Next); the window's AI documents as read-only tabs
(Later).

**New transcription** (MVP). `a` anywhere, or a file dragged onto the terminal.
A short sheet: the file, the language and the speakers (both default to the
window's choice), and the model shown but not chosen. Then the progress:

- the phases in the window's words, each ticked with how long it took;
- one bar, an estimate of the time left, and what it runs on (graphics card
  with CUDA or Vulkan, or the processor; the engine knows no more than that);
- **the words as whisper writes them**, a block at a time, newest at the
  bottom. The engine already reports each block; today's CLI throws it away;
- the mark turning into the mill while it works (see *Look*).

`Esc` leaves the screen and the transcription carries on: a small mill and the
percent stay in the header of every screen, and `p` returns to it. `Ctrl+C`
stops it after a question, and so do `q` and closing the screen while it runs.
The question says what is lost: a first transcription stopped before it saves
keeps the recording in the archive, untranscribed; the words shown so far are
not kept, because the engine writes blocks only at the end. Stopping goes
through the same cancel as the window's *Zrušit*, so the recording is not left
marked as transcribing.

When it ends, a summary replaces the progress: `38:12 záznamu přepsáno za 3:12,
12× rychleji, než nahrávka trvá`, the speakers, the languages, and the next
step on Enter.

**Second language.** Whoever chose in the window to be asked about a second
language (`detect_second_language` off) gets the window's own question at the
end: *V nahrávce zní také anglicky. Chcete doplnit přepis?* — `d` *Doplnit*,
`x` *Nechat být*. Ignoring it leaves the offer in the archive for the window.
With the setting on, the engine fills the language in by itself, as it does for
the window. The plain `transcribe` takes the offer whatever the setting says,
because nobody is there to answer.

**Busy check.** Before a file is added, the archive is checked for a
transcription in progress, as `transcribe` does today. If the window is
transcribing, the sheet offers *Spustit, až skončí* and waits, adding nothing
to the archive until it starts.

**Export** (MVP). `e` from the archive or the reader. The window's *Uložit jako*
as a dialog: text, Markdown, SRT, VTT, JSON, audio (MP3, M4A, WAV), several at
once; the folder; and an existing file is never replaced without a question:
*Nahradit*, or *Uložit jako „Porada (2).srt“*. Batch export of marked
recordings: Next.

**Status** (MVP). Where the archive is and how large, whether ffmpeg, whisper,
the model and speaker separation are found, what it computes on, the version.
Anything missing is said in the window's words with where to fix it; the screen
never downloads or sets anything up.

**Help** (MVP). `?` on any screen: this screen's keys first, then the rest.
It fits 80×24.

**Next:** a queue of several files, retrying a recording that is new or failed,
batch export, a command palette (`:`), copying a block or a path.

**Not offered:** choosing a model (the pipeline reads the window's);
re-transcribing a finished recording, which would replace corrections made in
the window; renaming, moving, deleting (question 4); downloads and settings,
which are the window's.

## Keys

One meaning per key on every screen; a text field or a dialog has its own few.
Arrows and vim keys both work. Keys do not change with the language. A footer
on every screen lists the keys that do something there, shortening as the
terminal narrows; `? Nápověda` and `q Konec` go last.

| key | |
|---|---|
| `↑↓` `jk`, `←→` `hl` | move; between panes |
| `PgUp` `PgDn`, `g` `G`, `Tab` | page; first and last; next pane |
| `Enter`, `Esc` | open or confirm; back or close |
| `q` | back; on the archive, quit (asks first while a transcription runs) |
| `/` | search: the archive in the archive, the transcript in the reader |
| `a` | new transcription |
| `e` | export |
| `p`, `s` | the running transcription; Status |
| `i` | information about the recording |
| `?` | help |
| `Ctrl+C` | stop the transcription, after a question; with nothing running, quit |

Archive: `f` filter, `o` sort. Reader: `n` `N` hits, `m` `M` speakers, `t` a
time. Dialogs: `↑↓`, `Space` to tick, `←→` to change a choice, `Tab` to
complete a path inside a path field, `Enter`, `Esc`. Summary: `d` `x`.

**The Czech keyboard.** Every key above is typed without AltGr on Czech QWERTZ:
`/` is Shift+ú, `?` Shift+comma. Number keys and `[ ] { }` are not used,
because on that layout the number row types `+ěšč` and brackets need AltGr.
Keys are matched by the character they produce. On Windows crossterm reports
AltGr as Ctrl+Alt, so a character arriving with Ctrl+Alt is taken as the
character.

The mouse works in Windows Terminal: the wheel scrolls, a click selects, a
double-click opens, and Shift+drag still selects text. In the old console
(conhost) it is off, because capturing it breaks that console's own selection.
`VOLOCAL_MOUSE=0` turns it off anywhere. (Next)

## Language

The screen follows the system language: Czech with formal address on a Czech
system, English elsewhere, `VOLOCAL_LANG=cs|en` to choose. It cannot follow the
language picked inside the window, which is kept in WebView storage. Reading
the Windows UI language needs the `Win32_Globalization` feature of the
`windows` crate, which is already a dependency.

The phases, errors and the second-language question come from the window's
dictionaries. The screen's own text goes into a new namespace,
`src/locales/cs/terminal.ts`, created with `npm run i18n:new terminal`. That
wires it into `src/locales/index.ts`, so the window's bundle carries these
strings too, unused. `i18n:check` catches informal address in it as anywhere
else. Two additions: `"terminal."` among the prefixes `scripts/i18n.mjs` treats
as used, because the check reads only TypeScript; and a Rust test that every key
the screen uses exists in both languages, with every Czech plural form.

The script surface (command names, flags, `--help`, `docs/cli.md`, `error:`
lines) stays English.

## Look

The window's look carried into a character grid rather than a new terminal
theme.

- **Colour from the window's palette.** Every role (ground, surface, text,
  muted, the petrol accent, the amber search highlight, success, warning,
  danger) is converted from `src/css/01-base.css`, light and dark. Where a
  colour is used as text, its lightness moves until it reaches 4.5:1, the rule
  behind `--accent-solid`. Speaker colours are read from each speaker in the
  archive and adjusted by the same rule, whatever hex an older archive holds.
- **The terminal's own background shows through.** Only surfaces are painted:
  header and footer bands, dialogs, the selected row, fields, keycaps, search
  hits.
- **Light or dark** is asked of the terminal (OSC 11) with a 100 ms timeout. The
  old console never answers, and then it is dark. `VOLOCAL_THEME=light|dark`
  overrides. (Next; the MVP is dark unless told.)
- **Four colour levels**: truecolor, 256 colours, 16 colours (selection becomes
  reverse video), and `NO_COLOR` (no colour; bold, underline and reverse still
  carry the meaning).
- **Airy rather than boxed.** One header band, one footer band, a single rule
  beside the folders. Only a dialog has a frame, and the screen behind it fades.
- **The window's rhythm in cells.** The 8 px gap is no blank row, 18 and 22 px
  are one; a dialog's lines start three cells inside its frame; a dialog with
  fields is 52 columns and a column of choices 64, as the window's 420 and
  520 px.
- **Type.** Bold for titles, names, keys and the active item; capitals in the
  muted colour only for column heads and section labels; italic only for
  placeholders.
- **The mark is the real one.** The `olo` face rasterised into braille from the
  geometry in `src/brandArt.ts`. It stands still at rest. When a transcription
  starts it turns on its side into the mill (two rollers and an accent sheet
  passing between them, 1100 ms a pass) and the words come out beside it. A
  four-cell mill marks a running transcription in lists and the header.
- **The publisher's mark** is drawn the same way, from `ZnackarnaMark`: two
  rows, a triangle, a circle and a square of one size, each in cells of its
  own. Never as the characters `▲●■`, whose sizes depend on the font.
- **Motion only while something works**, and never before a key works. A
  loading screen appears only if the archive takes over 300 ms to open.
  `VOLOCAL_REDUCED_MOTION=1` stops the mill and replaces the braille art with
  the word `olo`, which also keeps a screen reader from spelling out dots.
- **The old Windows console** gets an ASCII set (`>`, `+`, `x`, `|/-\`) and stays
  fully usable: its fonts have no braille and no ✓.

Later, if wanted: the face blinking and smiling as in the window, the
`volocal` → `olo` closing in the header, progress in the Windows Terminal tab,
one bell when a run ends unseen.

## Small terminals

Full function at 80×24. Under 90 columns the folders fold into a chip in the
header (`Všechny nahrávky · 128 ▾`, opened with `←`), length and date merge into
one cell, and the footer keeps four keys, `q` and `?`. Under 60×16 one line asks
for a larger window. Long transcripts lay out only what is visible.

## How it is built

**ratatui 0.30 with crossterm 0.29**, without default features. In a scratch
crate with the repository's release profile, the binary grew by about 0.3 MB and
a cold release build by about 16 s; ratatui's minimum Rust is the repository's
own, 1.88. Every new crate is MIT or MIT/Apache-2.0, and NOTICE already covers
Rust crates through `Cargo.lock`. It is a default-on cargo feature, `tui`; the
window never links it, and `--no-default-features` builds the plain CLI.

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

Each feature owns its state and hands back a named model and named actions. It
asks `app.rs` for a dialog, a notice or a transcription by name, and only
`app.rs` starts a transcription, so the busy check cannot be skipped.

**Progress needs no engine change.** The engine reports through
`Report::Callback` (`transcription/mod.rs`); the screen passes a closure that
sends each event into its own channel. A worker thread runs the transcription
with its own database connection. The screen redraws on events and ticks only
while something moves. The window's rule that a phase never moves backwards
(`useTranscriptionRuntime.ts`) is ported with its test.

**The archive is followed** through `PRAGMA data_version`, checked once a
second: it changes whenever another connection, the window's say, commits.

**Terminal hygiene.** Its own panic hook rather than `ratatui::init()`, whose
hook would tear the screen down on panics the engine already recovers from.
Only key presses are read, because Windows reports releases too. Quitting
during a transcription cancels it and waits for its end, at most about 10 s.

**Closing the console** must wait too. Today's handler cancels and returns at
once (`volocal-cli.rs`, `stop_on_ctrl_c`); Windows then ends the process before
the engine writes the status, and the recording stays marked as transcribing.
The handler has to block until the worker reports its end, or about 4 s of the
5 Windows allows. The plain `transcribe` has the same bug today, and step 0
fixes it for both. After a forced kill the mark still stays, as for any program.

**Three engine changes, none changing what the window does:**

1. `die_with_this_process` made public and called by the CLI, so whisper does
   not outlive a closed terminal. The plain `transcribe` has the same gap.
2. The window's refusal of the second language moved out of its Tauri command
   into one function both programs call. The command changes; what it does
   does not.
3. `Deserialize` on the two progress events (optional).

**Tests.** Feature models are tested without a terminal; views with ratatui's
`TestBackend` at 80×24 and 60×16, Unicode and ASCII, Czech and English, against
text snapshots kept the way `docs/cli.md` is kept (rewritten with an environment
variable, compared otherwise). Key handling is tested with the characters a
Czech keyboard sends. CI gains one step: clippy on the plain CLI without the
feature.

## Order of work

Each step goes to `dev` on its own, with its history entry and, where users see
it, one line in the release notes.

| | step | after it |
|---|---|---|
| 0 | the CLI becomes a folder; the transcribe sequence one function; whisper dies with the CLI; closing the console waits for the cancel | the same CLI, two bugs fewer; `docs/cli.md` unchanged |
| 1 | the screen's frame, theme and glyph sets, the static mark, Status | `volocal-cli` opens a status screen |
| 2 | Archive and search | the archive can be browsed and searched |
| 3 | Reader | a transcript can be read |
| 4 | Export | a transcript or its audio can be saved |
| 5 | New transcription, with live words and the mill | transcribing from the screen |
| 6 | a pass on conhost, Windows Terminal, PowerShell, VS Code, Git Bash, with a Czech keyboard; both READMEs | release |

About 3 500–4 000 lines of Rust with tests for steps 0–6. Mouse, light-theme
detection and the *Later* list under *Look* come after, priced separately.
Steps 0–2 are the smallest useful release; step 5 carries the real risk.

## What to watch

- **The window's start-up tidy-up takes the screen's run for a crashed one.**
  `recover_interrupted` turns every recording marked as transcribing and
  without blocks into a failure. Opening the window while the screen
  transcribes therefore shows the run as failed and offers *Zkusit znovu*,
  which would start a second whisper: the memory failure of 24 September. A
  screen session runs far longer than a script, so this becomes likely.
- **The busy check is a check, not a lock.** The window can start between the
  check and the start.
- **Windows terminals differ.** Only a pass on real machines confirms the glyph,
  mouse, paste and keyboard handling; CI has no terminal.

## Questions for the owner

1. Does bare `volocal-cli` open the screen in a terminal? And is an explicit
   `volocal-cli tui` wanted besides, as a seventh command in `--help`?
2. Czech on a Czech system (proposed), or English like the rest of the CLI?
3. Does the screen ask about a second language when the window's setting says
   to ask (proposed), or take it as `transcribe` does?
4. Which archive housekeeping is in: retrying a new or failed recording
   (proposed, Next); moving into a folder; renaming; deleting (proposed: no)?
5. A recording left marked as transcribing after a crash blocks every new run
   until the window starts. May the screen clear the mark when it can show
   nothing is running, or is that always the window's job?
6. The window, on starting, treats a run in the screen as crashed, and starts
   its own runs without asking the archive. Should it check the archive in both
   cases? That is a change to the window.
7. The three engine changes above: agreed?
