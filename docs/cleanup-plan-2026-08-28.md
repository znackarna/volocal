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

- [ ] **Shorten the per-day paragraphs in `docs/history/README.md`.** The
  2026-08-25 paragraph alone runs to thousands of words — it retells the day
  instead of pointing at it. The index's job is one or two sentences per day
  plus the link; the detail already lives in the day files, which must not be
  touched. Get the owner's yes before trimming: the paragraphs are old entries
  in spirit, and the no-rewrite rule is his.
- [ ] **Verify the index row counts.** Each `| N |` in the table should equal
  the number of `### ` headings in its day file; several drifted this week when
  two sessions wrote at once. A five-line script check beats doing it by eye —
  consider adding it to `scripts/docs-check.mjs` so it stays true.

## B. Repository ballast

- [ ] **Settle the two stranded branches.** `prepinac-v-bundlu` carries two
  commits not on `main` (a bundle language switch and English-page fallback);
  `site-on-vercel` carries one. Show the owner the diffs and let him say merge
  or delete — do not decide alone, and do not leave them standing again.
- [ ] **Dependabot PR #214** (six GitHub Actions bumps) is open. Review the
  pinned SHAs and hand the merge decision to the owner.
- [ ] **`docs/site/volocal-page.html`** sits untracked in the working tree,
  origin unknown to this session. Ask the owner what it is; commit it where it
  belongs or remove it. Do not silently `git add -A` it into an unrelated
  commit (that nearly happened on 28 August).

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
