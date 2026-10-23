**English** · [Čeština](README.cs.md)

# Volocal

**Turns speech into text, on your own computer.**

Drop in a recording and you get a transcript you can read, correct, search and
play back word by word. It knows who said what. It can tidy the text up,
summarise it or translate it.

Your recordings never leave your computer. There is no account, no cloud, no
upload — the models run on your own hardware, offline, after the first setup.

## Get it

**Windows 10 or 11.** [Download the installer](../../releases/latest) — it
installs for you alone and does not ask for administrator rights.

**Status: released, 1.3.1.** In daily use by its author.

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
- **Works from the command line too.** `volocal-cli` transcribes, searches and
  exports from a script or straight from any terminal, in the same archive and
  with a live view of the progress — see [docs/cli.md](docs/cli.md).

## Your recordings stay with you

That is the whole point of the application. It touches the internet three times:

1. **The first run**, to fetch the transcription engine and the models you
   picked, from their authors' own release pages.
2. **When you paste a link** to an online service. Your link goes out, the audio
   comes back. Nothing else.
3. **When you ask whether there is a new version.** There is also a switch,
   off by default, that asks at startup. Nothing downloads without you pressing
   something.

**And nothing else.** No telemetry, no crash reports, no account. Your
recordings, transcripts, notes and settings sit in a file on your disk.

About that first download: every piece is pinned to an exact version at an exact
address, and all but one are checked against a fingerprint its publisher
published. If the file does not match, it is refused. The exception is the voice
model, whose host publishes no fingerprint — that one has HTTPS and nothing
more.

## What are its limits?

- **Word timings are close, not exact.** Good for clicking and following along;
  a long sentence with a pause in it can drift by about a second.
- **Two people talking at once** get merged into whoever is louder. Fixing that
  by hand is part of how it is meant to be used.
- **Interviews yes, panels not really.** Two voices are near-perfect when you
  say there are two. Five people in one room merged a pair.
- **One recording at a time.** Drop ten and all ten are accepted, but they queue
   — you can see them waiting. Running them together would only be slower.
- **A download that is interrupted picks up where it stopped** — except for the
  voice model, whose publisher states no fingerprint, so a partial file there
  cannot be checked and is fetched again from the start.
- **The archive is not encrypted.** It is an ordinary file with whatever
  protection your account has.

## Questions and problems

- **Something is wrong, or you have an idea:** open an issue.
- **You found a security hole:** please do not open a public issue — write to
  jsme@znackarna.cz.

---

## Licence

Volocal belongs to značkárna s.r.o. You may install it and use it; its source
code is not public. The terms are in [LICENSE](LICENSE).

The components it builds on, and their licences, are listed in
[NOTICE](NOTICE) and in the application under Settings → Informace.

