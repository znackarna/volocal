**English** · [Čeština](README.cs.md)

# Volocal

**Turns speech into text, on your own computer.**

Drop in a recording and you get a transcript you can read, correct, search and
play back word by word. It knows who said what. It can tidy the text up,
summarise it or translate it.

Your recordings never leave the machine. There is no account, no cloud, no
upload — the models run on your own hardware, offline, after the first setup.

## Get it

**Windows 10 or 11.** [Download the installer](../../releases/latest) — it
installs for you alone and does not ask for administrator rights.

**Status: released, 1.2.9.** In daily use by its author.

One thing to expect on first run: the installer is not code signed, so Windows
shows *Windows protected your PC*. Choose **More info** → **Run anyway**. That
warning is about a missing certificate, not about anything found in the file.

Then open Volocal, press **Download and set up** in the wizard, and drag a
recording into the window. The wizard fetches what it needs — 700 MB to 1.7 GB
depending on which models you choose — and after that the internet is optional.

## What it does

- **Transcribes recordings and video** in Czech and many other languages.
- **Tells speakers apart** and splits the text between them.
- **Improves the transcript, summarises it, translates it** — with a language
  model running on your machine.
- **Flags the places it was unsure about** so you know where to look.
- **Plays back to the exact word**, and lets you pin a note to any moment.
- **Records from a microphone**, takes audio from an online service, or watches
  a folder you choose.
- **Exports** to TXT, Markdown, SRT, VTT or JSON — and the audio to MP3, M4A or
  WAV.

## Your recordings stay with you

That is the whole point of the application, so here is exactly when it touches
the internet — and it is only these three:

1. **The first run**, to fetch the transcription engine and the models you
   picked, from their authors' own release pages.
2. **When you paste a link** to an online service. Your link goes out, the audio
   comes back. Nothing else.
3. **When you ask whether there is a new version.** There is also a switch, off
   by default, that asks that one question at startup. It only ever asks —
   nothing downloads without you pressing something.

**And nothing else.** No telemetry, no crash reports, no account. Your
recordings, transcripts, notes and settings sit in a file on your disk.

About that first download: every piece is pinned to an exact version at an exact
address, and all but one are checked against a fingerprint its publisher
published. If the file does not match, it is refused. The exception is the voice
model, whose host publishes no fingerprint — that one has HTTPS and nothing
more. [SECURITY.md](SECURITY.md) spells this out.

## What it does not do well

Written down here rather than discovered later:

- **Word timings are close, not exact.** Good for clicking and following along;
  a long sentence with a pause in it can drift by about a second.
- **Two people talking at once** get merged into whoever is louder. Fixing that
  by hand is part of how it is meant to be used.
- **Interviews yes, panels not really.** Two voices are near-perfect when you
  say there are two. Five people in one room merged a pair.
- **One recording at a time.** Drop ten and all ten are accepted, but they queue
   — you can see them waiting. Running them together would only be slower.
- **A broken download starts over.** There is no resuming a three-gigabyte model
  halfway.
- **The archive is not encrypted.** It is an ordinary file with whatever
  protection your account has.

## Questions and problems

- **Something is wrong, or you have an idea:** open an issue.
- **You found a security hole:** please do not open a public issue — write to
  jsme@znackarna.cz. [SECURITY.md](SECURITY.md) says what is already known to be
  weak.

[README.cs.md](README.cs.md) is the fuller guide for people using the
application — keyboard, models, portable copies on a flash drive — and is
written in Czech, as the interface is.

---

## For developers

A Windows desktop application built on Tauri 2: a Rust core, a React interface,
a SQLite archive. Transcription is whisper.cpp; telling speakers apart is CAM++
through ONNX Runtime; the language editing is llama.cpp.

**Licence: source available, not open source.** You may read this code and build
it for yourself. Redistribution, forks and reuse elsewhere need written
permission — see [LICENSE](LICENSE), and
[src-tauri/LICENSE.txt](src-tauri/LICENSE.txt) for the program itself.

```powershell
npm install
npm run tauri dev     # first run compiles Rust: 5-15 minutes. Later runs: seconds.
npm run tauri build   # installer lands in src-tauri\target\release\bundle\nsis\
```

Before handing work over:

```powershell
npm run build     # i18n:check, then tsc --noEmit, then the Vite build
npm run test      # the interface and the transcript text
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm run i18n:check` is the unusual one. It refuses text written inside a
component, an incomplete set of plural forms, a Czech sentence that addresses
the reader informally, and a translation whose Czech source has been reworded
since. Czech is the source language of the interface.

A release is held to more: tagging runs `node scripts/i18n.mjs check --strict`,
which also refuses a translation whose Czech source has never been
fingerprinted. Then the installer is built, installed on a clean machine and
started, and it has to create its archive before the run counts as green.

Where things are installed: tools and models in `%LOCALAPPDATA%\Whisp\`, the
archive in `%APPDATA%\cz.znackarna.volocal\`. The first still says `Whisp` — a
name this had before Slobot and before Volocal — because renaming it would make
every existing installation download everything again. The second was moved when
the name changed, by a migration that carries the whole folder over on first
run.

[ARCHITECTURE.md](ARCHITECTURE.md) has the module layout and the naming rules.
[CONTRIBUTING.md](CONTRIBUTING.md) has what a pull request needs.
[docs/history/](docs/history/README.md) has why the code is the way it is, day
by day.

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
licence and FFmpeg is GPL v3. The full list is in [NOTICE](NOTICE) and in the
application under Settings → Informace.
