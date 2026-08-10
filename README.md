**English** · [Čeština](README.cs.md)

# Slobot

Turns spoken words into text. Recordings, transcripts and language models run
on your own computer, and nothing is sent out.

A Windows desktop application: whisper.cpp for transcription, CAM++ through
ONNX Runtime for telling speakers apart, llama.cpp for enhancing the result.
Tauri 2 — Rust core, React interface, SQLite archive.

**Status: 0.9.0, pre-release.** Everything below works and is in daily use by
its author, but there is no published release yet and the installer is not code
signed. Version 1.0 is what adding recording from a microphone was meant to
mark; that has since landed, so 1.0 now waits on the hardening work in
`PLAN-ZPEVNENI-PRO-CLAUDE.md`.

**Licence: source available, not open source.** You may read this code and
build it for yourself. Redistribution, forks and reuse in other projects need
written permission. See [LICENSE](LICENSE); the program itself is covered by
[src-tauri/LICENSE.txt](src-tauri/LICENSE.txt).

---

## What it does

- **Transcribes recordings and video** in Czech and other languages.
- **Recognises speakers** and splits the text between them.
- **Enhances a transcript with a language model**, summarises it and
  translates it — all locally.
- **Marks the places the transcript was unsure about** and keeps corrections
  together.
- **Plays back to the word** and pins a note to any moment.
- **Records from a microphone**, pulls audio out of an online video, watches a
  chosen folder.
- **Exports** to TXT, Markdown, SRT, VTT or JSON, and audio to MP3, M4A or WAV.

## Where the network is used

The claim is that your recordings never leave the machine, so it is worth being
exact about when Slobot does reach the internet. Only here:

1. **First run.** The setup wizard downloads whisper.cpp, ffmpeg, speech
   detection and the models you pick — 700 MB to 1.7 GB — from their authors'
   own release pages. After that the application does not need the internet.
2. **Adding an online video.** Only if you paste a link yourself. yt-dlp fetches
   the audio; the link is the only thing that goes out.
3. **Nothing else.** No telemetry, no crash reporting, no update check, no
   account. Recordings, transcripts, settings and the dictionary stay in the
   archive on your disk.

Two things worth knowing about the first item. Downloaded components are **not
yet compared against any checksum**: the code computes one and would refuse a
mismatch, but the table of expected digests is still empty, so HTTPS and the
certificate chain remain the whole guarantee today. And six of them are whatever
their project publishes at that moment — five located by matching a pattern
against live GitHub releases, one pointing at `releases/latest`. Fixing this is
the next piece of planned work; [SECURITY.md](SECURITY.md) has the detail.

## Getting it

There is **no published release yet**. Build it from source:

```powershell
npm install
npm run tauri build
```

The installer lands in `src-tauri\target\release\bundle\nsis\`. It contains the
program alone — a few megabytes, not gigabytes — and installs for the current
user, so it does not ask for administrator rights.

Because it is not signed, Windows shows SmartScreen on first run: *Windows
protected your PC* → **More info** → **Run anyway**.

Tools and models go to `%LOCALAPPDATA%\Whisp\`, the archive to
`%APPDATA%\cz.znackarna.whisp\`. Those two paths still say `Whisp`, the
application's earlier name; renaming them would make existing archives
unreadable, so they stay until there is a migration to move them.

## Development

```powershell
npm install
npm run tauri dev
```

The first `tauri dev` compiles the Rust dependencies — 5 to 15 minutes. Later
runs take seconds.

Checks that must pass before handing work over:

```powershell
npm run build     # i18n:check, then tsc --noEmit, then the Vite build
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm run i18n:check` is the unusual one: it refuses text written inside a
component, an incomplete set of plural forms, a Czech sentence that addresses
the reader informally, and a translation whose Czech source has been reworded
since. Czech is the source language of the interface.

[ARCHITECTURE.md](ARCHITECTURE.md) has the module layout and the naming rules.
[CONTRIBUTING.md](CONTRIBUTING.md) has what a pull request needs.
[README.cs.md](README.cs.md) is fuller on using the application — keyboard,
models, portable copies, where computation runs — and is the document the
Czech-speaking users get.

## Known limitations

**Word timings are an estimate.** Whisper returns marks per segment, not per
word. Good enough for clicking and highlighting, but a long segment with a
pause in the middle can drift by a second.

**Speaker recognition does not handle overlap.** When two people talk over each
other the block goes to whoever dominates. Correcting it by hand is part of the
design, not a failure.

**Speaker recognition is reliable for an interview, not a panel.** Two voices
with the count given are near-perfect on the material it was measured against;
five people in one room produced one merged pair. Naming voices and reassigning
a block are how that is fixed.

**Transcriptions run one at a time.** Drop ten files and all ten are added, but
one transcribes while the rest queue — visibly, on their cards. Ten runs at once
would fight over a single graphics card and finish later in total.

**Downloads cannot be resumed.** If the connection drops in the middle of a
three-gigabyte model, it starts again.

**The archive is not encrypted.** It is a SQLite file on your disk with the
permissions your account gives it.

## Reporting

- **A bug or an idea:** open an issue.
- **A vulnerability:** please do **not** open a public issue. Write to
  jsme@znackarna.cz. [SECURITY.md](SECURITY.md) describes the trust boundary
  and what is already known to be weak.

## Third-party components

| | Licence |
|---|---|
| Tauri 2, React 18 | MIT / Apache 2.0 |
| SQLite | public domain |
| whisper.cpp, Whisper models, Silero VAD | MIT |
| ONNX Runtime, 3D-Speaker CAM++ | MIT / Apache 2.0 |
| llama.cpp | MIT |
| Gemma (Google) | Gemma Terms of Use |
| FFmpeg | GPL v3 |
| yt-dlp | Unlicense |
| Deno | MIT |
| Geist, Inter, Schibsted Grotesk, Literata, Source Serif 4 | SIL OFL 1.1 |

Everything except the Gemma models is open source. Gemma follows Google's own
terms and FFmpeg is GPL v3 — worth remembering when you pass a portable copy
on to somebody else. The full list is in [NOTICE](NOTICE) and in the
application under Settings → About.
