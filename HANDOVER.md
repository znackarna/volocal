# Handover — where the hardening work stands

Written 10 August 2026, at the point the work moved from Cowork (a sandbox with
no Rust toolchain and no credentials) to Claude Code on the owner's Windows
machine. The assignment is `PLAN-ZPEVNENI-PRO-CLAUDE.md` and it takes precedence
over this file; this only says how far it got and what is still undecided.

## Read first

1. `PLAN-ZPEVNENI-PRO-CLAUDE.md` — the assignment. Its guardrails hold: one
   commit one problem, a refactor changes neither looks nor behaviour, and
   nothing is called done without the command that proves it.
2. `BASELINE-0.9.0.md` — the package 0 protocol, including what it is still
   missing.
3. `CLAUDE.md` — the working rules, short enough to read whole. The reasoning
   behind past decisions moved to `docs/history/`, one file per day; read a day
   only when you need the reason behind something you are about to change.

## Do not touch

The working tree carries the owner's own uncommitted work:

```
src/locales/cs/settings.ts
src/locales/en/settings.ts
src/locales/sources.json
```

Do not commit, stage or revert them. They are not part of this plan.

## Done

**Package 0** — baseline recorded in `BASELINE-0.9.0.md`. Incomplete: it has no
`npm run build`, `cargo fmt`, `cargo test` or `cargo clippy` from Windows, and
no reference screenshots. **Fill those in first** — later packages have nothing
to measure against without them, and package 6 in particular cannot show it
changed no pixel.

**Package 1** — public repository. English `README.md`, Czech moved to
`README.cs.md`, root `LICENSE` (source available, per the owner's decision —
still wants a legal read before release), `CONTRIBUTING.md`, pull request and
issue templates, English `CHANGELOG.md`. GitHub description and 12 topics are
set. CI workflow and job names are now English: `TypeScript and dictionaries`
and `Rust on Windows` — those are the strings a required status check must
name.

**Package 2, partly** — see below.

## Package 2: where it stopped

Done, in `src-tauri/src/download.rs`:

- every download is hashed with SHA-256 as its bytes are written, and checked
  before anything is unpacked or moved (`place_verified`);
- a mismatch throws the download away and leaves the previous working
  installation untouched;
- extraction refuses an archive entry that would land outside the destination;
- a successful install writes a record (id, URL, digest, whether anything was
  expected) to `installed.json` through a temporary name;
- `origin_verified()` — a file being present no longer claims it was checked;
- nine tests, all offline.

**Not done: `EXPECTED_HASHES` is empty**, so nothing is actually compared yet.

### The owner's two decisions, already taken

1. **Migration:** existing installations keep working and report *origin
   unverified*; nobody is made to re-download gigabytes. A `Download again and
   verify` action beside that state is wanted but not built. New installations
   verify.
2. **Where the hashes come from:** computed from the files already on the
   owner's disk.

### What decision 2 actually allows, and what it does not

It only works for components downloaded as a single file
(`Destination::AsFile`), because for the others the downloaded artefact is an
archive that is deleted after extraction. That is:

| id | file under the models/tools root |
|---|---|
| `yt-dlp` | `bin/yt-dlp.exe` |
| `vad` | `models/ggml-silero-v6.2.0.bin` |
| `model-turbo` | `models/ggml-large-v3-turbo-q5_0.bin` |
| `model-large-q5` | `models/ggml-large-v3-q5_0.bin` |
| `model-large` | `models/ggml-large-v3.bin` |
| `editor-model-light` | `models/editor/gemma-4-e2b-q4.gguf` |
| `editor-model-balanced` | `models/editor/gemma-4-e4b-q4.gguf` |
| `editor-model-best` | `models/editor/gemma-4-12b-q4.gguf` |
| `model-hlasy` | `models/3dspeaker_..._common_advanced.onnx` |

The root is `%LOCALAPPDATA%\Whisp` unless the settings say otherwise; portable
copies keep `bin\` and `models\` beside the executable.

Only hash a file the machine actually has. Do not invent an entry for a model
that was never downloaded.

**Say what the number is worth, in the catalogue, next to it.** A hash computed
here attests that the next download matches this one — not that this one was
genuine. The comment above `EXPECTED_HASHES` already says so; keep it true.

The remaining components (`whisper-*`, `ffmpeg`, `deno`, `editor-*`) are still
fetched by matching a pattern against live GitHub releases, so every machine may
receive a different build and a single hash cannot fit. The plan wants that
pattern replaced by pinned versions. That is the rest of package 2 and it needs
the owner to accept which upstream version gets pinned.

## Package 3 is ready to start and is small

`SECURITY.md` still says `"csp": null`. It is not — `src-tauri/tauri.conf.json`
has carried a Content Security Policy since 7 August. The Czech and English
halves must be corrected together, and the admitted limits stay: the archive is
not encrypted, the asset protocol scope is `**` until package 8, the installer
is unsigned, and the application uses the network for downloads and online
imports.

## Loose ends worth knowing

- **`main` is not protected.** A direct push from a machine with credentials
  succeeded on 10 August. Secret scanning, push protection and Dependabot are
  also unconfirmed; private vulnerability reporting is on (the *Report a
  vulnerability* button renders). If protection is ever applied, its required
  checks must name the two English job names above.
- **`src/locales/sources.json` needs two things** once the owner's own work in
  it is finished: the fingerprints of `catalog.sherpa.*` and
  `catalog.model-segmentace.*` are orphaned (those keys are gone), and
  `errors.download.hash_mismatch` and `errors.download.unsafe_archive_path` need
  `npm run i18n:approve en`. Both are warnings, not errors.
- **`NOTICE` lists ONNX Runtime among downloaded components.** It is linked
  into `slobot.exe` now, so its MIT notice travels with the binary. Worth a line
  in package 3.
- **`.github/dependabot.yml` does not exist**, so no version-update pull
  requests are raised regardless of the alert setting.
- **The installer contains `Slobot.exe` alone.** `DirectML.dll` is copied next
  to the exe by the build but is not in the NSIS package; ONNX Runtime is linked
  statically. Speaker recognition working from an installed copy therefore means
  either Windows' own `DirectML.dll` from System32, or a silent fallback to the
  processor, which is logged in `slobot-log.txt`. Unresolved, and it belongs to
  the release rather than to any package here.

## Before every commit

```powershell
npm run build
cargo fmt --all --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Clippy has roughly twenty findings from before this work; the plan puts fixing
them in package 7, not in whatever commit happens to notice them.
