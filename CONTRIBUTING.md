# Contributing to Volocal

Thank you for looking. Before you spend time on a change, two things are worth
knowing up front.

**This is not an open-source project.** The source is public so that anyone can
verify what the program does with their recordings. You may read it and build it
for yourself; redistribution and reuse need written permission. See
[LICENSE](LICENSE). By opening a pull request you grant značkárna s.r.o. the
right to use your contribution as part of Volocal (LICENSE, section 5).

**Product direction and design belong to the owner.** Volocal has a single
maintainer who decides what it does and how it looks. A technically excellent
pull request that changes visible behaviour without prior agreement will be
asked to go back to a discussion first — not because it is bad, but because that
decision is not the reviewer's to make on the spot.

## Language

- Commit messages, pull request titles, issues and developer documentation are
  **English**.
- The **interface is Czech**, and Czech is its source language. Every visible
  string starts in `src/locales/cs/`.
- Identifiers, comments, command and event names, log output and prompts for
  the language model stay English — see [ARCHITECTURE.md](ARCHITECTURE.md).

## Before you open a pull request

Windows is the supported development platform. Everything below is expected to
pass on Windows, because that is what Volocal ships on and it is the only place
the `#[cfg(windows)]` code is compiled at all.

```powershell
npm install
npm run tauri dev            # first run compiles Rust: 5 to 15 minutes
```

```powershell
npm run build                # i18n:check, security:check, tsc --noEmit, Vite build
npm run test                 # the interface and the transcript text
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

A pull request that does not say which of these were run, and with what result,
is not ready. "Should be fine" is not a result.

CI runs these same commands — the list is not a separate ritual. A tag runs two
more, and only a tag: `node scripts/i18n.mjs check --strict`, which refuses a
translation whose Czech source has never been fingerprinted, and a smoke test
that installs the built package on a clean machine and waits for it to create
its archive. Both are in `.github/workflows/check.yml`, with the reasoning.

## Rules that get pull requests rejected

**One pull request, one problem.** A refactor must not also change behaviour,
text or looks. A security fix must not also tidy CSS. If two things are worth
doing, they are worth two pull requests.

**No new visual family or design token without prior agreement.** A new kind of
button, card, field, panel or dialog — and any new colour, shadow, radius,
type level or icon — needs the owner's yes before the CSS is written. The
existing system is documented at the top of `CLAUDE.md` under *Visual system*.
Ask first; you will usually be pointed at the component that already solves it.

**Interface text starts in Czech.** Add or change the key in
`src/locales/cs/`, then the other languages. `npm run i18n:check` refuses text
written inside a component, an incomplete set of plural forms, a Czech sentence
that addresses the reader informally (the interface uses *vykání*), and a
translation whose Czech source has been reworded since it was written. A literal
that deliberately stays untranslated needs an `i18n-ignore: reason` comment.

**A test must describe behaviour, not confirm the implementation.** A test that
would still pass with the defect restored is not a test. Where it is practical,
say in the pull request that you watched the new test fail before it passed.

**Do not change the application identifier, the historical `Whisp` paths or
stored database values.** `%LOCALAPPDATA%\Whisp\`, the file name `whisp.db` and
the Czech column names in SQLite look like leftovers and are load-bearing:
changing one without a migration makes existing archives unreadable. If a
change needs one of them, that migration is its own piece of work.

The identifier was changed once, on 2026-08-10, when Slobot became Volocal —
`cz.znackarna.whisp` to `cz.znackarna.volocal`. It cost a migration that moves
the whole profile folder on first run (`profile_folder` in `main.rs`, with its
tests), and that is what one of these costs. `whisp.db` inside it was left
alone on purpose: renaming the file as well would have bought nothing and put
the backups and the WAL in the way.

## Changes that touch the interface

Attach before-and-after screenshots at the same window size, in both colour
themes, at **1000 × 660** (the window minimum) and at a comfortable size such as
1360 × 900. Cover the states you touched: hover, focus, disabled, running,
error. A screenshot must not contain a real recording, name or path.

If a change is visual at all, say in the pull request which existing component
or rule already solves the problem and why it could not be used unchanged.

## Reporting a vulnerability

Do not open a public issue. Write to jsme@znackarna.cz. See
[SECURITY.md](SECURITY.md), which also lists what is already known to be weak —
if you found one of those, it is useful to know how bad it is in practice, but
it is not news.
