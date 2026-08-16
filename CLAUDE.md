# Volocal: working rules

Read `ARCHITECTURE.md` before changing cross-layer behavior. New internal
identifiers and comments use standard English; visible UI copy remains Czech
and addresses the reader formally (vykání) — `npm run i18n:check` enforces it.

## Mandatory change record

Every code, behavior, data, copy, or UI change is written down before the work
counts as finished. Each entry states what changed, why, the important files,
and how it was verified. This is what keeps hand-offs between Claude, Codex and
the owner from losing the reasoning behind the current implementation.

Entries live in `docs/history/`, one file per day: append to today's file, or
create `docs/history/YYYY-MM-DD.md` if this is the day's first entry, and add
its row to [docs/history/README.md](docs/history/README.md).

Never delete or quietly rewrite an older entry. When a decision is superseded,
add a correcting entry after it — the later one wins, and the earlier one still
explains what was believed at the time. Several of them are the most useful
things in that folder.

Until 2026-08-10 the log lived in this file. It reached 630 000 characters,
four times what a session can read, and was being loaded in full before every
task. The move changed no word of it.

## Release notes are benefits, never a change list

**Every release text says what the reader gains, and stops.** That is all three
of them — the Czech dialog an installed copy shows, the English GitHub page, and
`CHANGELOG.md`. None of them explains mechanism, names a file, or recounts what
was done.

One line per change. A release is a handful of lines, not a page. If a bullet
needs a paragraph under it to make sense, the bullet is wrong — rewrite it as
the gain, and let the paragraph live in `docs/history/`, which exists precisely
so that a release note does not have to carry the reasoning.

| not this | this |
|---|---|
| Nabídka nad přepisem nabízí jména mluvčích místo „výše/níže". | Zpřehlednění nabídky mluvčích |
| The scale that lets the mark turn inside its own frame ran past the room available by 0.022 of a unit, so the outline took a flat bite out of the curve. | The mark no longer clips while a transcript runs. |

The reader of a release note is deciding whether to restart their work for this.
What they want is what improves, in the time it takes to read four words. Three
audiences, three levels of detail, and only the last one is long: the dialog and
the GitHub page say the gain, `docs/history/` says everything.

Asked for on 2026-08-16, after several releases went out reading as a list of
things that had been ticked off.

## Visual system

These are the values a new screen inherits rather than re-invents. An exception
needs a one-line comment naming the reason and the amount; without one, the next
tidy-up will unify it away.

- **Dialog rhythm.** Heading 19 px, 4 px to its sentence, 18 px from there to
  the content — and the dialog owns that third gap (`.dialog h2 + p`), so no
  content block inside a dialog carries a `margin-top` of its own. The footer
  owns 22 px above itself. Descendant selector, not child: one dialog nests its
  heading in a `<form>`.
- **Dialog width.** 420 px for a question with fields, 520 px for a column of
  choice cards, 840 px only for the reading window. Everything inside a dialog
  starts on the same 26 px left edge.
- **Fields.** One rule at `.field input…` — 38 px, `--ground`, pill radius. A new
  input type is added to that selector, never restyled separately. Label 13.5/650
  with 8 px under it; an explanation belonging to the field above has 8 px, one
  belonging to a whole group has 14 px.
- **Buttons.** Pill 34 px; circular icon button 32 px (34 px in the detail
  header, 26 px in `.segment-actions` — both documented). Segmented control: 30 px
  button in a 36 px track (the archive toolbar's 40 px is its neighbour's
  geometry, and says so in a comment).
- **Type scale.** Screen 28/700, card and dialog heading 19/700, wizard group
  label 17/700, field label 13.5/650, body 14, helper 13–13.5, micro-label
  11/700/0.09em. Weights are 500 / 600 / 680 / 700 — not 550, 650, 720, 750.
- **Colour comes from a token in `:root`.** An undefined `var()` does not fail
  loudly, it silently drops the declaration.
- **Two rules that differ only in file order must say so in a comment**, or the
  next move of a block changes the look with no value changed.

## Critical invariant

Do not globally stretch, scale, or offset stored word timestamps to fix MP3
playback drift. The transcript timestamps were measured against decoded audio
and are correct. Playback, not Whisper/VAD, caused the reproducible large seek
error described below.

## Reproduction and diagnosis (Janka 30112025.mp3)

The user clicked the word `když` in the segment displayed at 39:07 and playback
started at `zavané, čemu čelíme`.

- Stored time of `když`: 2347.340 s (39:07.340).
- A fresh local large-v3 + DTW transcription of the original audio, without
  VAD, independently placed `když` at 2347.340 s.
- `zavané` is at approximately 2355.100 s.
- The source is a 45:04 VBR MP3 with a Xing TOC containing 100 seek entries.
- The Xing entries around the request map to packets at 2333.688 s and
  2355.456 s. WebView landed on the upper entry, exactly where the user heard
  `zavané` (about 8.1 seconds late).

Additional control transcriptions matched 881 words in five windows between
5 and 42 minutes. Median stored-vs-fresh offsets ranged from -0.08 to +0.03 s
and did not grow with recording length. That disproves cumulative VAD silence
compression as the cause of this reproduction.

Whisper does sometimes assign one timestamp to several adjacent words (11% of
Janka's words were in such groups; the largest measured group covered 3.12 s).
That is a separate, smaller token-alignment limitation. It does not explain
the exact 39:07 -> 39:15 jump and must not be mixed with the MP3 seek fix.

## Implemented decision

`src-tauri/src/tools.rs` creates a private AAC/M4A playback proxy for MP3
sources. MP4's sample table gives WebView an accurate seek timeline. The
original user file remains untouched and is still the source for transcription
and export.

- Cache directory: `playback-cache` beside `whisp.db`.
- Cache key fingerprints recording id, source path, size, and modification
  time, preventing stale reuse after source replacement.
- Generation is one-time, atomic, and happens off the Tauri IPC/UI thread.
- `src/Detail.tsx` prewarms the proxy when a transcript opens.
- `src/player.tsx` joins duplicate preparation requests and remembers the most
  recent requested seek while conversion is running.
- If conversion fails, playback falls back to the original source rather than
  becoming unavailable.
- Deleting a recording or changing its source path removes its old proxies.

Non-MP3 inputs continue to play directly. If another container later proves
imprecise in WebView, extend the backend format decision using a measured
reproduction; do not apply speculative timestamp corrections.

## Regression checks

For the Janka reproduction, clicking `když` must audibly begin at `když`, not
at `zavané`. Also verify:

1. first MP3 playback may show `připravuji…`, then starts at the requested word;
2. later seeks reuse the cached M4A immediately;
3. WAV/video playback still uses the original file;
4. changing a recording path cannot reuse the previous proxy;
5. deleting a recording removes its playback cache;
6. transcript timestamps and database segment data remain unchanged.

## Where the rest is

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | module layout, naming, the translation boundary |
| [docs/history/](docs/history/README.md) | why the current implementation is the way it is, by day |
| [CONTRIBUTING.md](CONTRIBUTING.md) | what a pull request needs |
| [README.md](README.md) | what Volocal is, and building it |

Before handing work over:

```powershell
npm run build
cargo fmt --all --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```
