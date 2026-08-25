**English** · [Čeština](SECURITY.cs.md)

# Security

### Where to report a flaw

**jsme@znackarna.cz**

Tell us what you found, how to repeat it, and what it lets someone do. Please
let us know before you publish — we will answer. značkárna s.r.o. is a small
company with no night shift, so a reply can take days.

We have no public PGP key. If you need an encrypted channel, write first
without the details and we will arrange one.

### Which versions

Fixes ship in a new version only. Older ones are not patched.

### What Volocal does to your computer

It is an ordinary Windows program. It runs under your account and can do
exactly what you can.

* **The interface is not a web page.** It is part of the program, so there is no
  way in for adverts or tracking.
* **Recordings and transcripts never leave your computer.** No telemetry, no
  crash reports, no account.
* **It checks for updates only when you ask it to**, with a button in Settings.
* **It runs programs written by other people** — FFmpeg, whisper.cpp,
  llama.cpp, yt-dlp, Deno — and fetches them itself. This is where Volocal is
  most exposed.

### Where the weak spots are

Three, and we know about them.

**1. The program downloads other programs and then runs them.**

FFmpeg prepares the audio, whisper writes the transcript. Volocal does not carry
them inside itself — it fetches them the first time you run it, and if somebody
substituted a different file on the way, that is what would run.

Two things prevent it. Every address points at one particular release rather
than at "the newest", so it cannot change by itself. And every address comes
with a **digest**, the checksum of one single file: Volocal computes it from the
bytes as they arrive, before anything is unpacked, and throws the download away
if it does not match.

The digest has to be copied from the publisher. Computed from the downloaded
file, it would only prove the file matches itself.

**One item has no digest: the speaker-recognition model.** Its release is from
before GitHub published digests, and there is no newer one. It installs with a
note saying its origin was never verified, and HTTPS is all that protects it. An
automatic test keeps it the only one: **fifteen of the sixteen** components
carry a digest.

HTTPS is a decent safeguard, not a complete one. The connection is encrypted and
you can tell who you are talking to, so we trust whoever runs `github.com`,
`objects.githubusercontent.com` and `huggingface.co` — and every certificate
authority your Windows trusts.

Whatever the digests say, this also holds. An archive whose contents would land
outside the folder meant for them is refused whole. A download is written to a
temporary file and renamed only at the end, so an interrupted one does not look
finished. And the program never installs a newer version by itself: a robot
looks once a week, copies the digest from the publisher, and prepares a change
for someone to approve.

**2. The window is guarded against outside content. File access goes around
that guard.**

The window Volocal runs in carries a rule about where content may be loaded
from:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: asset: http://asset.localhost;
media-src 'self' blob: data: asset: http://asset.localhost;
connect-src 'self' ipc: http://ipc.localhost asset: http://asset.localhost;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

No script, style, font or image loads from anywhere but the program itself, the
window cannot be embedded in someone else's page, and the usual routes for data
to leave are closed.

What it does not stop: the rule governs **where** content may come from, not
what an already-running program may do. And it says nothing about navigating the
window elsewhere, so data hidden in a web address could in principle still
leave.

So the first defence is not that rule but the way the screens are assembled: as
text, never as page code. Whatever a transcript, a speaker's name or a file name
happens to contain, it cannot start behaving like an instruction.

The window may not open files by itself — the program's settings carry
`"assetProtocol": { "scope": [] }`, an empty list of permitted paths. A
recording can be anywhere on the disk, so listing paths in advance is
impossible; instead exactly one file is opened each time, the one about to play.

**3. The installer is not signed.** Windows therefore warns that it does not
recognise the program. This is a decision rather than an omission: a certificate
that actually removes the warning cannot be bought by one person. But an
unsigned installer is indistinguishable from a tampered one except by where you
got it — take it only from the releases page on GitHub.

### What you can do about it

* Install only from the official release, nowhere else.
* Let the first run, when the components are downloaded, happen on a network you
  trust.
* If your archive holds sensitive recordings, turn on disk encryption. Volocal
  does not encrypt the archive itself.
* Before passing a portable copy on, read `src-tauri/LICENSE.txt` and `NOTICE` —
  FFmpeg is under the GPL v3 licence and the Gemma models under Google's terms.

### What we do not treat as a flaw

* That the program reads a file you pointed it at.
* That a transcript contains mistakes, or that a language model invents
  something nobody said. A transcript is material to check, not a legal record.
* That the program can be bypassed by someone who already has your account.
  Whoever controls the account controls everything running under it.
