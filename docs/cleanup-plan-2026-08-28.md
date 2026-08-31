# Tidy-up plan, 28 August 2026

Written for the next working session (Opus/Fable). Goal: clear ballast and make
the records easier to use for future development and repairs. Nothing here is a
rewrite; every item is small, checkable, and most need the owner's word before
they land on `main`.

Ground rules that override anything below: work goes to `dev` and merging to
`main` is the owner's call (`CLAUDE.md`, *Two branches, and no others*). Never
delete or rewrite an older `docs/history/` entry — correct forward. Do not
split large files wholesale; carve one boundary per visit, with tests
(`docs/reviews/2026-08-25-codex-hardening.md`, item 14). Do not add
speculative `note!` logging. Do not touch the visual system.

## A. Records

- [x] **Shorten the per-day paragraphs in `docs/history/README.md`.** Done on
  31 August, at his word and on his condition: every paragraph was first
  compared against its day file, and anything the file did not hold was carried
  into it before the cutting. 117 606 characters became 10 747 — two sentences
  and the link for each of twenty-seven days. Four passages were rescued into
  14, 21 and 26 August; four others turned out to be misattributions and were
  written nowhere, because a wrong record costs more than a lost sentence. The
  three days that had two paragraphs were merged rather than halved.
- [x] **Verify the index row counts.** Done on 31 August. Eight of twenty-seven
  days were wrong: four counts left from before the day was over, 19 and 20
  August with two rows each from two sessions that never saw one another, and
  24 August with no row at all. `scripts/docs-check.mjs` now enforces one row
  per day file, the count, no row without a file, and date order — and
  `npm run build` already runs it.

## B. Repository ballast

- [x] **`site-on-vercel`** — nothing to settle. Its commit `2d4b96c` is an
  ancestor of `main`; the branch was merged and deleted before 31 August.
- [ ] **`prepinac-v-bundlu`** — looked at on 31 August (`docs/history/2026-08-31.md`).
  It is behind `dev`, not ahead of it: both commits were redone on `dev`, the
  script is identical line for line, both history entries are in place, and the
  branch's one real difference is a bundle language switch pointing at
  `znackarna.github.io`, dead since Pages was switched off. Nothing to save.
  **Still standing only because deleting it was refused by this session's
  permissions**, not because anything in it is wanted. One command:
  `git push origin --delete prepinac-v-bundlu`. The two commits stay reachable
  as `e03acbf` and `35f5f4e` if anybody ever wants to read them.
- [x] **Dependabot PR #214** — closed on 31 August, superseded by `dev`. The
  three bumps that still apply (`checkout` 7.0.1, `setup-node` 7.0.0,
  `upload-artifact` 7.0.1) were taken onto `dev` by hand in `837cfa2`, each SHA
  resolved from the action's own tag rather than copied. The other three bump
  Pages steps that left `site.yml` on the 27th. `.github/dependabot.yml` now
  sets `target-branch: dev`, which is why they kept arriving on the wrong
  branch; `Checks` passed on `dev` with the new versions.
- [x] **`docs/site/volocal-page.html`** — it is `bundle.py`'s default output,
  never tracked, rebuilt on every hand-over. Added to `.gitignore`; the file
  stays on disk.

## C. Known latent faults — fix on touch, not on a sweep

Recorded here because the list existed only in a conversation. All three are in
`src/Detail.tsx` (3,507 lines, 53 `useState`, no test renders it whole). The
shape is always the same: two correct halves, wired apart — the same shape as
the `Výkon` flash and the folder button, both found by eye this week. Fix each
only when already in the file for another reason, and always with a render test
that fails without the fix.

- [ ] **`previewTab` vs `aiOutputs`/`summaryLength`** (~line 1928). The
  selector and the data it selects from are set independently; a tab whose
  output does not yet exist renders an empty preview. Same shape as the
  `Výkon` fault, softer landing.
- [ ] **`addingNote` + `noteDraft` + `noteDraftTime`.** `setAddingNote` is
  never called alone; the other two are. A draft and the flag saying one is
  being written can drift.
- [ ] **`aiDocument` + `aiOutputs` + `aiRunning`.** `setAiRunning` is called
  alone four times; a run and its result are not tied together.
- [ ] **One `check`, not two.** `App.tsx` and `Settings.tsx` each hold their own
  copy of the `check_tools` answer, refreshed by different triggers. This is
  the pair problem one storey up and cannot be fixed by merging two
  `useState`s. Unify only alongside other work in those files, with tests.

## D. Code hygiene, strictly on touch

- [ ] **Trim comments that retell a defect's history** when editing the file
  they sit in. The invariant stays; the narrative belongs in `docs/history/`
  (Codex item 15, and the owner's standing rule that comments state
  constraints). Do not do this as a sweep — a sweep is how load-bearing
  comments die.
- [ ] **Carve one boundary out of a large file per visit**, tests riding along
  — the way `src/detail/` gained keys, notes, documents, the context menu and
  the segment row (61 tests) without any big rewrite. Candidates are listed in
  Codex item 14. Never split just to shrink a line count.

## E. Parked until the facts change

- **Navigation blocking and microphone origin checks** (Codex 4+5): become
  real the day any foreign content renders in the window (a web preview,
  model output as markdown, any `dangerouslySetInnerHTML`). Whoever adds such
  a thing does these two first, in the same change.
- **Broader `note!` coverage**: the log is dense around startup and the
  archive, thin elsewhere — deliberately. Add lines only where a real
  investigation needed one and it was missing.
- **1.2.22**: `dev` carries one user-visible change (folders on an empty
  archive) plus crash logging. Release when the owner says; the note is one
  line about the folder.

## Verification for anything that touches code

```
npm run build
npm run test
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Every fixed fault gets a test that fails without the fix — prove it by
reverting the fix once, the way the three repairs of 25–28 August were proved.
