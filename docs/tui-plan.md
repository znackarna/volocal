# volocal-tui — Volocal in a terminal

Built on 3 October 2026. A full-screen interface for a person at a terminal,
above all on a machine reached over SSH or a remote console: the archive to
browse and search, a transcript to read, a file to transcribe while its words
appear, an export to choose.

It is a program of its own. `volocal-cli` stays what scripts call; its output
in a terminal is laid out better, but it never takes over the screen
([cli-look-plan.md](cli-look-plan.md)). The screens are drawn in
[prototypes/volocal-tui.html](prototypes/volocal-tui.html).

`volocal-tui` runs only in a terminal. In a pipe it says so and exits 2. It
offers no microphone, no playback and no hand editing, as `volocal-cli` does
not ([cli-plan.md](cli-plan.md)).

## Screens

- **Archive.** Folders on the left with their counts, the recordings newest
  first: title, length, date, then speakers and blocks, or what is happening
  to it — transcribing here with percent and a bar, transcribing in the window
  or in the terminal, not transcribed, failed with the reason. `f` filters (all,
  not transcribed, failed, second language missing), `o` orders. The header
  carries the archive's size. When the window or `volocal-cli` writes to the
  archive, the list follows within a second.
- **Search.** One `/` field: titles filter as you type, and after a pause of
  220 ms the archive's index is searched, the hit shown under its recording in
  its sentence. Enter opens the transcript at the hit with the word found.
- **Reader.** The blocks with their times, a speaker's name where the speaker
  changes, in the window's colours. A block cursor; `m` `M` to the next
  speaker, `t` to a time (`39:07`), `/` with `n` `N` inside, `i` for the
  recording's details.
- **New transcription.** `a`, or a file dropped onto the terminal. The file
  (Tab completes the path), the language and the speakers, the model shown.
  Then the phases ticking off with their times, the mill turning, a bar, the
  position and the time left, and whisper's blocks as they come. `Esc` goes back
  to the archive and the run goes on, with the mill and the percent in the
  header. At the end: how long it took and how much faster than the recording,
  the first blocks, and — when the window's settings say to ask — the window's
  own question about a second language, `d` *Doplnit*, `x` *Nechat být*.
- **Save as.** `e`: text, Markdown, SRT, VTT, JSON and audio, several at once,
  into a folder. An existing file is never replaced without a question:
  *Uložit pod novým jménem* (`Porada (2).srt`) or *Nahradit*.
- **Status.** `s`: where the archive is and how large, ffmpeg, whisper and the
  model, what it computes on, and every missing part in the window's words.
- **Help.** `?`.

## Keys

One meaning per key on every screen; fields and dialogs have their own few.
Arrows and vim keys both work. Every key is typed without AltGr on a Czech
keyboard, and keys are matched by the character they type, so AltGr arriving
as Ctrl+Alt is still the character.

`↑↓` `jk` move, `←→` `hl` between panes, `PgUp` `PgDn`, `g` `G`, `Enter`,
`Esc`; `/` search, `a` new transcription, `e` save as, `p` the running
transcription, `s` status, `?` help, `q` back and on the archive quit.
`Ctrl+C` stops a transcription after a question — a second Ctrl+C within two
seconds stops it at once — and with nothing running quits.

## Over SSH

The terminal that draws is the one at the other end, and it says what it is in
`TERM`.

- **Colours:** the window's palette in full where `COLORTERM` says truecolor
  or Windows Terminal is local, the nearest of the 256 where `TERM` has
  `256color` (what SSH clients usually say), the sixteen of the terminal's
  theme otherwise, and none with `NO_COLOR`. `VOLOCAL_THEME=light` for a light
  terminal.
- **Characters:** braille and ✓ wherever a terminal names itself; ASCII only in
  the old Windows console, which names nothing. `VOLOCAL_ASCII=1` forces it.
- **Traffic:** the screen is drawn when something changes. It animates ten
  times a second only while a transcription runs, and then only the cells that
  change are sent.
- **A dropped connection** stops a running transcription and waits up to four
  seconds for the engine to write that down, so the recording is not left
  marked as transcribing. whisper ends with the program.

## The window

Not touched. A transcription started here holds the lock of `run_lock.rs`, so
the window leaves it alone when it starts, waits before starting its own, and
says on the card that it is running in the terminal. Before starting, this
program waits for a transcription the window is running.

## How it is built

`src-tauri/src/bin/volocal-tui/`, on ratatui 0.30 with crossterm 0.29 (MIT),
which the window and `volocal-cli` do not link.

| file | |
|---|---|
| `main.rs` | the terminal: raw mode and the alternate screen, restored on every way out; the event loop |
| `app.rs` | the screen: what is open, what may start, questions, notices, help |
| `archive.rs`, `reader.rs`, `transcribe.rs`, `export.rs`, `status.rs` | one feature each: its state, what can be done to it, how it is drawn |
| `theme.rs`, `words.rs`, `marks.rs`, `ui.rs` | colour roles and glyphs, the Czech and English words, the mark, shared drawing |
| `console.rs` | the console closing under a running transcription |

The engine's messages are read from the window's dictionaries through
`volocal-cli/common.rs`, which both programs share, with the window's rule that
a phase never moves backwards. A transcription runs `transcription::transcribe`
on a thread of its own and reports through `Report::Callback`.

**Tests:** every screen is drawn over a small archive on ratatui's test
terminal, at 100 × 30 and 80 × 24, in Czech and English, and the keys are fed in
as a person would press them: the archive and its states, a search, the
reader with a search and a jump, a running transcription and its question to
stop, the end of a run with the second-language question answered, the
dialogs, the help, a terminal too small.

## Later

A queue of several files; retrying a failed recording; batch export of marked
recordings; copying a block; the window's AI documents as read-only tabs; the
mouse. Not offered: renaming, moving, deleting.
