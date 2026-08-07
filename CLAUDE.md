# Claude project report: precise transcript seeking

Read `ARCHITECTURE.md` before changing cross-layer behavior. New internal
identifiers and comments use standard English; visible UI copy remains Czech
and addresses the reader formally (vykání) — `npm run i18n:check` enforces it.

## Mandatory change record

Every code, behavior, data, copy, or UI change must be appended to the
`Change log` in this file before the work is considered finished. Each entry
must state what changed, why, the important files, and how it was verified.
Do not delete or silently rewrite older entries; add a correcting entry if an
earlier decision is superseded. This keeps hand-offs between Claude, Codex,
and the user from losing the reasoning behind the current implementation.

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
- **Fields.** One rule at `.pole input…` — 38 px, `--pozadi`, pill radius. A new
  input type is added to that selector, never restyled separately. Label 13.5/650
  with 8 px under it; an explanation belonging to the field above has 8 px, one
  belonging to a whole group has 14 px.
- **Buttons.** Pill 34 px; circular icon button 32 px (34 px in the detail
  header, 26 px in `.segment-akce` — both documented). Segmented control: 30 px
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

## Change log

### 2026-08-01 — Precise seeking for long VBR MP3 recordings

- Changed: MP3 playback now uses a cached AAC/M4A proxy with an accurate MP4
  sample table; the original remains the transcription/export source.
- Why: WebView's Xing seek landed `39:07.340` at `39:15.456` in Janka.
- Files: `src-tauri/src/tools.rs`, `src-tauri/src/main.rs`, `src/api.ts`,
  `src/player.tsx`, `src/Detail.tsx`.
- Verified: Rust tests/build, TypeScript/Vite build, Tauri debug build, and a
  fresh transcription after proxy seek beginning with `když máme tu`.

### 2026-08-01 — Sidebar toggle moved to the detail header

- Changed: the sidebar toggle is now an icon button at the far right of the
  detail header, separated from Export; the transport-bar `trailing` slot was
  removed.
- Why: showing or hiding the sidebar changes the whole screen layout and is not
  a playback action. Beside speed buttons it looked like another transport
  control and consumed timeline width.
- Files: `src/Detail.tsx`, `src/PlaybackControls.tsx`, `src/styles.css`.
- Verified: TypeScript/Vite production build and clean diff check. Rebuilding
  the Tauri debug executable was deferred because that executable was running
  and Windows held an exclusive lock on it.

### 2026-08-01 — Precise playback is prepared during transcription

- Changed: MP3 transcription now has a visible `playback` phase that creates
  the cached M4A before Whisper starts. Opening the detail of a running
  transcription no longer starts a duplicate conversion. Finished legacy
  recordings still prepare a missing cache on demand.
- Why: creating the full M4A only after the first Play or word click made a
  finished long recording appear unresponsive. Moving that work into the
  existing preparation pipeline makes playback ready by the time the
  transcript is finished, while the explicit status explains the extra work.
- Files: `src-tauri/src/transcription.rs`, `src/App.tsx`, `src/Library.tsx`,
  `src/types.ts`, `src/Detail.tsx`.
- Verified: `cargo fmt --all`, all 7 Rust tests, TypeScript type checking,
  Vite production build, and `git diff --check` passed.

### 2026-08-01 — End-to-end transcription progress no longer resets

- Changed: whisper-cli's phase-local 0–100 percent is mapped into 10–90
  percent of the full pipeline. Playback preparation remains at 5 percent,
  diarization begins at 90 percent, saving at 95 percent, and completion at
  100 percent.
- Why: after M4A preparation reached 5 percent, entering transcription emitted
  a new phase-local zero and made the visible progress bar jump backwards.
- Files: `src-tauri/src/transcription.rs`.
- Verified: `cargo fmt --all`, all 7 Rust tests, TypeScript type checking,
  Vite production build, and `git diff --check` passed.

### 2026-08-02 — Adaptive readable transcript blocks

- Changed: sentence punctuation still defines normal transcript blocks, but an
  unfinished spoken paragraph now starts looking for a comma, clause mark, or
  unusually wide word gap after 18 seconds and has a hard 28-second limit.
  Both sides of a soft split must retain useful duration. Text and word
  timestamps are not changed, and edited segments remain barriers.
- Why: when Whisper punctuated long speech using only commas, the previous
  45-second emergency limit produced visually overwhelming transcript blocks.
- Files: `src-tauri/src/transcription.rs`.
- Verified: `cargo fmt --all`, all 12 Rust tests (including five new sentence
  block regressions), TypeScript type checking, Vite production build, and
  `git diff --check` passed. A read-only replay over the reported 121-word
  Janka block split its original 45.22 seconds into 19.55 and 25.67 seconds at
  the clause before `ale to si ti lidé mezi sebou říkali`, without losing a
  word.

### 2026-08-02 — Human-readable TXT and Markdown paragraphs

- Changed: TXT and Markdown now share a deterministic prose paragraph builder.
  Speaker changes and pauses of at least 2.5 seconds are hard boundaries;
  useful-length paragraphs may end at a 1.5-second pause, near 520 characters,
  or after six editor blocks, with a 900-character hard ceiling. Short trailing
  orphans are joined back when that does not cross a speaker or strong pause.
  TXT uses plain speaker labels and Markdown uses bold turn labels.
- Why: TXT previously split only on speaker changes or 1.5-second pauses, and
  Markdown almost only on speakers, so continuous monologues exported as one
  machine-like wall of text.
- Files: `src-tauri/src/export.rs`.
- Verified: `cargo fmt --all`, all 17 Rust tests (including five new prose
  export regressions), TypeScript type checking, Vite production build, and
  `git diff --check` passed. Tests cover grouping short blocks, bounding a
  continuous monologue without losing text, strong pauses, speaker changes,
  and avoiding repeated labels within one speaker turn.

### 2026-08-02 — Export paragraphs wait for sentence endings

- Changed: length, block-count, and pause-based TXT/Markdown paragraph breaks
  now apply only when the accumulated text ends in `.`, `!`, `?`, or `…`.
  The builder also considers the projected length before appending the next
  editor block, so it can use an earlier full stop instead of overshooting and
  later breaking at a comma. Speaker changes remain unconditional boundaries.
- Why: editor blocks intentionally may end at a comma, but using those visual
  boundaries for prose split compound sentences such as `dva dny předtím,` /
  `než Jarda odešel,` across separate exported paragraphs. The supplied Janka
  TXT showed the same defect in multiple places.
- Files: `src-tauri/src/export.rs`.
- Verified: `cargo fmt --all`, all 18 Rust tests, TypeScript type checking,
  Vite production build, and `git diff --check` passed. The added regression
  reproduces `dva dny předtím,` followed by `než Jarda odešel,` and asserts
  that neither TXT nor the shared paragraph list inserts a boundary there.

### 2026-08-02 — Optional local AI document editing

- Changed: first-run setup now has a fifth choice step for an optional local
  language-editing model in three qualities: Gemma 4 E2B Q4 (light), E4B Q4
  (recommended), and 12B Q4 (best). The installer also selects the current
  llama.cpp Windows Vulkan build where available and the CPU build otherwise.
  Existing installations can add or switch the feature under Settings and
  Modules; skipping it leaves transcription unchanged.
- Changed: a new `Vylepšit text` action beside Export creates a separate
  untimed document in faithful or cleaner mode. Work runs in bounded chunks on
  a background thread, reports persistent progress, can be cancelled, and does
  not block playback or transcript reading. A wide preview compares the edited
  document with the original and saves TXT or Markdown. The regular export
  remains the exact transcript; SRT, VTT, and JSON never use AI-edited text.
- Changed: generated documents are stored separately in `ai_documents` with a
  deterministic source hash, selected model, mode, and timestamp. Segment or
  speaker edits and model changes make the cached result stale; stale AI output
  cannot be exported. Timed segments, word timestamps, and the original audio
  are never rewritten by language editing.
- Why: deterministic paragraph layout can make a transcript readable but
  cannot safely repair missing punctuation or obvious ASR substitutions. The
  optional local pass provides that document workflow while preserving the
  transcript as the auditable, seekable source of truth and supporting CPU-only
  computers.
- Files: `src-tauri/src/ai_edit.rs`, `src-tauri/src/db.rs`,
  `src-tauri/src/download.rs`, `src-tauri/src/main.rs`,
  `src-tauri/src/tools.rs`, `src/App.tsx`, `src/Detail.tsx`,
  `src/Settings.tsx`, `src/SetupWizard.tsx`, `src/api.ts`, `src/styles.css`,
  `src/types.ts`.
- Verified: official Google GGUF filenames and official llama.cpp Windows CPU
  and Vulkan release asset names were checked before wiring the catalog;
  `cargo fmt --all`, all 20 Rust tests (including new chunk-boundary and source
  hash tests), TypeScript type checking, Vite production build, and
  `git diff --check` passed. Full inference was not run during development
  because none of the new 3.35–6.98 GB models was already installed locally.

### 2026-08-02 — Installed AI quality no longer loops back to download

- Changed: editor-model resolution now first checks the configured quality and
  then falls back to any already installed known quality, preferring Best,
  Balanced, then Light. `load_settings` persists that repaired selection, tool
  status exposes the model id actually found on disk, inference records that
  actual id, and cache staleness compares against the resolved model rather
  than an obsolete setting.
- Changed: the detail's missing-module action now requests the quality that was
  actually detected instead of always requesting Balanced. Module management
  can therefore add a missing runtime without changing or re-downloading an
  already installed Best or Light model.
- Why: the reported machine had the complete 6.98 GB
  `gemma-4-12b-q4.gguf` and Vulkan `llama-cli.exe`, while persisted settings
  still named the absent `gemma-4-e4b-q4`. The readiness check correctly found
  that configured file missing, but the dialog then hard-coded Balanced and
  kept the user in the same installation loop.
- Files: `src-tauri/src/tools.rs`, `src-tauri/src/main.rs`,
  `src-tauri/src/ai_edit.rs`, `src/Detail.tsx`, `src/types.ts`.
- Verified: all 21 Rust tests pass, including a regression that creates an
  installed Best model beside a stale Balanced setting and asserts that Best
  is resolved; TypeScript type checking, Vite production build, and
  `git diff --check` passed.

### 2026-08-02 — Language-editing mode cards use semantic icons

- Changed: the `Věrná úprava` choice now uses the same circular icon treatment
  as model cards, with a checked document to communicate correction without
  rewriting. `Čistší text` uses a brain to signal the additional editorial
  judgment involved in removing repetitions and filler. The recommendation
  badge sits at the shared right edge instead of inside the title.
- Why: the two text-only cards looked unfinished beside the established module
  and model-card language, and their different levels of intervention were
  slower to distinguish at a glance.
- Files: `src/Detail.tsx`.
- Verified: TypeScript type checking, Vite production build, and
  `git diff --check` passed.

### 2026-08-02 — Language model no longer stalls at two percent

- Changed: language editing now starts one local `llama-server` process for
  the whole document and sends every chunk to its OpenAI-compatible local
  endpoint. The 7 GB model is therefore loaded into memory only once instead
  of once per chunk. Cancellation terminates that server process.
- Changed: the current language-editing progress is stored in backend task
  state and returned by `ai_edit_status`. The detail view polls this status
  while work is active, so the UI recovers even when it missed the first Tauri
  progress event. Model loading is shown explicitly before chunk processing.
- Why: `llama-cli` automatically enabled conversation mode for Gemma's chat
  template. After loading the Best model and handling the first prompt, it
  waited for another interactive turn instead of exiting. On the reported run
  it had allocated about 7.37 GB of GPU memory but showed no CPU or GPU work
  after several minutes, leaving the interface at `Připravuji jazykový model`
  and 2%. Spawning that CLI again for later chunks would also have repeatedly
  paid the full model-loading cost.
- Files: `src-tauri/src/ai_edit.rs`, `src-tauri/src/tools.rs`,
  `src-tauri/src/main.rs`, `src/Detail.tsx`, `src/api.ts`, `src/types.ts`.
- Verified: `cargo fmt --all`, all 21 Rust tests, TypeScript type checking,
  Vite production build, and `git diff --check` passed. The already-running
  stalled process belongs to the old implementation; restart the Tauri dev
  app before validating the new server-backed flow with the installed 12B
  model.

### 2026-08-02 — Language-editing progress moves within each chunk

- Changed: chat completions now use the server's SSE streaming response.
  Generated deltas are accumulated into the final document and also drive a
  fractional progress value within the current chunk. Progress state is
  throttled to four updates per second, while the displayed percentage stays
  rounded and the bar retains the more precise width.
- Changed: the active language-editing bar has a subtle moving highlight, so
  prompt evaluation before the first output token is visibly active without
  inventing elapsed percentage. Reduced-motion preferences disable it.
- Changed: while waiting for streamed output, the backend checks the child
  process every 120 ms. If `llama-server` exits during inference, the task now
  reports that exit instead of waiting on the HTTP timeout with a frozen bar.
- Why: progress previously advanced only when one complete chunk returned.
  With seven roughly 6,000-character chunks, `Upravuji část 1 z 7` could stay
  at 5–6% for the entire first generation and looked frozen even when the
  model was producing text. In the reported session no server process remained
  by the time it was inspected, making explicit child-exit detection equally
  important.
- Files: `src-tauri/src/ai_edit.rs`, `src/Detail.tsx`, `src/styles.css`.
- Verified: all 21 Rust tests, TypeScript type checking, Vite production build,
  and `git diff --check` passed.

### 2026-08-02 — Gemma correction disables hidden reasoning

- Changed: the editor `llama-server` is started with `--reasoning off`.
- Why: Gemma's bundled chat template automatically enabled reasoning. The
  server streamed those tokens as `delta.reasoning_content`, while the actual
  edited document belongs in `delta.content`. A request could exhaust its
  entire output budget thinking and finish with no content, which surfaced as
  `model vrátil prázdný text`.
- Evidence: a direct request against the installed Best model and llama.cpp
  b10223 reproduced 64 tokens entirely in `reasoning_content` and ended with
  `finish_reason: length`; generation ran at about 1.2 tokens/s. The same
  request against the same loaded model with reasoning disabled returned
  `Tohle je věta bez interpunkce.` in `content`, stopped normally, and generated
  at about 75 tokens/s. Hidden reasoning is neither useful nor safe to treat as
  the corrected transcript, so the parser deliberately continues to accept
  only `content`.
- Files: `src-tauri/src/ai_edit.rs`.
- Verified: a real local Vulkan inference using the installed 6.98 GB
  `gemma-4-12b-q4.gguf`, followed by Rust tests, TypeScript type checking, Vite
  production build, and `git diff --check`.

### 2026-08-02 — Faithful editing fixes contextual ASR near-misses

- Changed: the editor prompt now explicitly corrects phonetically close words,
  endings, and incorrect word joining/splitting when the source is nonsensical
  in its immediate context and the intended Czech form is unambiguous. It uses
  `součas DNA` → `součást DNA` as a concrete ASR example.
- Changed: the same instruction explicitly preserves verb person, number,
  tense, and mood whenever the original form is possible. This keeps faithful
  editing from turning valid but less usual speech into the model's preferred
  sentence.
- Why: the Best model initially left `součas DNA svého života` untouched even
  though `součást DNA` is an obvious phonetic recognition error. A first,
  broader prompt corrected that word but also changed `když se setkáte` to
  `když se setkám`, which altered the speaker's wording and meaning.
- Files: `src-tauri/src/ai_edit.rs`.
- Verified: two direct local inferences with the installed 12B model. The final
  prompt returned exactly `Mně se hrozně líbí, když se setkáte s lidmi, kteří
  mají službu Pánu Bohu jako součást DNA svého života.`; Rust tests, TypeScript
  type checking, Vite production build, and `git diff --check` also passed.

### 2026-08-02 — Generated text remains available for later saving

- Changed: once an AI document exists, the detail action reads `Uložit
  vylepšený text` and always opens its preview with TXT and Markdown save
  actions. It does this even if the language model runtime is currently absent
  or the result is marked stale; already generated text does not require a
  model to inspect or save.
- Changed: stale documents show a clear warning in the preview and offer
  `Vylepšit znovu` as a separate choice. Saving the older generated result is
  allowed, while regeneration remains explicit. The top-level button no longer
  replaces access to the existing document with regeneration.
- Why: AI output is persisted inside Whisp immediately after generation, not
  only when exported to a file. The database contained a 37,740-character
  generated document for Janka, but the stale-state UI exposed only
  `Vylepšit znovu`, making that stored work appear lost and preventing a user
  who had closed the preview from exporting it later.
- Files: `src/Detail.tsx`, `src/styles.css`, `src-tauri/src/main.rs`.
- Verified: all 21 Rust tests, TypeScript type checking, Vite production build,
  and `git diff --check` passed.

### 2026-08-02 — Saved summaries and translations in the improved-text preview

- Changed: the improved-document preview now has four tabs: `Vylepšený text`,
  `Shrnutí`, `Překlad`, and `Původní přepis`. Summary offers Short, Standard,
  and Detailed variants. Translation offers Czech, English, German, Slovak,
  Polish, French, Spanish, Italian, and Ukrainian. Tabs and controls remain usable on
  narrow windows through horizontal overflow.
- Changed: summaries and translations are generated only on demand from the
  improved document, never directly from the raw timed transcript. Translation
  processes bounded chunks and preserves paragraph/speaker structure. Summary
  uses a map/reduce flow: each chunk first becomes factual notes, then one final
  pass produces a coherent whole-document summary in the requested length.
  Both reuse one reasoning-disabled `llama-server` process and report streamed
  progress through the existing language-task bar.
- Changed: generated variants are persisted in a new normalized `ai_outputs`
  table keyed by recording, kind, and variant. Switching summary length or
  target language therefore reveals an already generated result without
  rerunning the model. Replacing the improved source document invalidates and
  deletes its derived outputs. Deleting the document cascades to them.
- Changed: every active result can be saved as TXT or Markdown from its tab.
  Suggested filenames and Markdown headings use readable Czech output names
  such as `podrobné shrnutí` and `anglický překlad`; the original-transcript tab
  continues to use the deterministic regular export.
- Files: `src-tauri/src/ai_edit.rs`, `src-tauri/src/db.rs`,
  `src-tauri/src/main.rs`, `src/Detail.tsx`, `src/api.ts`, `src/types.ts`,
  `src/styles.css`.
- Verified: all 22 Rust tests pass, including a new persistence/invalidation
  regression; TypeScript type checking, Vite production build, and
  `git diff --check` pass. Direct local inference with the installed 12B Vulkan
  model produced a clean five-point Czech summary retaining every supplied
  fact and a clean English translation retaining Ostrava, 120 families, the
  September plan, and all funding details. The diagnostic server and logs were
  removed afterward.

### 2026-08-02 — Czech translation gets a dedicated anti-calque review

- Changed: Czech is now an explicit translation target. Its first-pass prompt
  requires native Czech word order, concrete active verbs, natural bindings,
  and preservation of meaning and tone while rejecting common translated
  skeletons such as `adresovat problém`, `v rámci`, `je to o tom`, passive
  nominal fog, `create impact for stakeholders`, and `offers the possibility`.
- Changed: Czech alone receives a second streamed editorial pass over every
  translated chunk. It checks grammar, cases, verb bindings, word order, and
  remaining calques while being forbidden to add, omit, summarize, reorder, or
  embellish information. Progress distinguishes `Překládám…` from
  `Kontroluji češtinu…`. Other target languages remain one-pass and keep their
  previous speed.
- Why: direct inference proved that a general `write natural Czech` instruction
  was insufficient for the local 12B model. It first produced `skutečný dopad
  pro zainteresované strany` and `umožňuje účasti`; a stronger one-pass prompt
  removed those but still produced the wrong case in `lidem, které se věc
  týká`. The separate Czech review corrected it to `lidem, kterých se to týká`
  without changing any facts.
- Files: `src-tauri/src/ai_edit.rs`, `src-tauri/src/main.rs`, `src/Detail.tsx`.
- Verified: three direct local inference rounds against deliberately calqued
  English input, followed by all 23 Rust tests (including a Czech anti-calque
  prompt regression), TypeScript type checking, Vite production build, and
  `git diff --check`. The Czech editorial rules were based on the project's
  natural-Czech guideline: preserve the author's meaning, prefer direct Czech
  verbs, remove translated sentence skeletons, and read every sentence aloud.

### 2026-08-02 — AI result terminology is consistently “Vylepšený text”

- Changed: all user-facing names for the AI-corrected result now use
  `Vylepšený text`: the preview heading, save-menu group, TXT/Markdown
  descriptions, completion message, save confirmation, validation errors, and
  suggested filename. The exact timed source remains `Hrubý přepis` or
  `Původní přepis` depending on context.
- Why: the save menu said `Upravený dokument`, the tab said `Vylepšený text`,
  and the main action said `Uložit vylepšený text`. Those labels described the
  same stored object as three different things. `Vylepšený text` is concrete
  and keeps the AI derivative distinct from the auditable timed transcript.
- Files: `src/Detail.tsx`, `src-tauri/src/main.rs`,
  `src-tauri/src/ai_edit.rs`.
- Verified: all 23 Rust tests, TypeScript type checking, Vite production build,
  and `git diff --check` passed.

### 2026-08-02 — TXT export is labeled “Textový soubor”

- Changed: the TXT description in the `Uložit přepis` menu now reads
  `Textový soubor` instead of `Čistý text`.
- Why: `Čistý text` sounded like another content-cleaning mode beside the AI
  workflow, while `Textový soubor` names the exported file format directly.
- Files: `src/Detail.tsx`.
- Verified: TypeScript type checking, Vite production build, and
  `git diff --check` passed.

### 2026-08-02 — Document tabs use a fresh, explicit navigation element

- Changed: the `Vylepšený text` preview now renders its four document views in
  a dedicated `nav` element with the new `ai-document-tabs` class. Each tab
  also exposes `aria-selected`, and the tab strip is a non-shrinking row above
  the document body.
- Why: the running WebView showed the current dialog title but omitted the
  previously named `ai-preview-tabs` strip even after a full application
  restart. A fresh selector avoids a stale cached style targeting the old
  class, while explicit flex sizing prevents the navigation from collapsing.
- Preserve: keep `Vylepšený text`, `Shrnutí`, `Překlad`, and `Původní přepis`
  visible whenever an improved document exists. Do not hide these tabs based
  on whether a summary or translation has already been generated; those are
  created on demand from their empty tab states.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Add recording supports online video links

- Changed: `Přidat nahrávku` now opens a source dialog with two consistent
  choice cards: `Místní soubor` and `Online video`. The library add strip uses
  the same dialog instead of bypassing it.
- Online flow: the second card opens a URL field. A valid HTTP(S) link is
  downloaded as audio-only M4A, stored under the app data directory, inserted
  as a normal recording, and automatically transcribed when the existing
  `Přepisovat rovnou` setting is enabled.
- Progress: the dialog reports downloader preparation, media download with a
  real percentage/speed/ETA where available, audio conversion, and completion.
  It cannot be dismissed while the external process is running because this
  first implementation does not expose cancellation.
- Dependency: official `yt-dlp.exe` is an optional 18 MB program component.
  It is downloaded lazily on first online import, remains available in the
  Modules screen, and is included in portable copies through the existing
  `bin` directory copy.
- Safety: only `http://` and `https://` URLs without embedded credentials are
  accepted; playlists are disabled to prevent one pasted link from importing
  an unbounded collection.
- Preserve: after import, playback and transcription use the ordinary local
  recording pipeline. Do not add separate streaming playback or remote-media
  branches to those systems.
- Files: `src/AddRecordingDialog.tsx`, `src/App.tsx`, `src/api.ts`,
  `src/styles.css`, `src-tauri/src/online_import.rs`,
  `src-tauri/src/download.rs`, `src-tauri/src/main.rs`.

### 2026-08-02 — AI document controls follow the application design system

- Changed: the four document tabs are now a pill-shaped segmented control,
  using the same radii, muted surface, active panel, shadow, typography, and
  transitions as the application's other controls. Each view has a compact
  outline icon from the same visual family as the header and settings icons.
- Changed: summary length reuses that segmented-control primitive instead of
  maintaining a nearly identical private style. Translation language now uses
  the shared `Select` component rather than a native Windows select.
- Changed: summary and translation empty states use matching SVG icons instead
  of the typographic placeholders `≡` and `文`. Their circular accent surface
  remains the same as other selected/AI states.
- Preserve: these are presentation changes only. On-demand generation, cached
  outputs, selected variants, export actions, and the four always-visible tabs
  must keep their current behaviour.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Improved and original text share one tab

- Supersedes: the earlier instruction to keep four top-level tabs visible.
  Keep all four views available, but expose the two text versions through the
  nested switch described here.
- Changed: the top-level document navigation now has three tasks: `Text`,
  `Shrnutí`, and `Překlad`. The former `Vylepšený text` and `Původní přepis`
  tabs are two versions of the same content, so they now live under `Text` in
  a `Vylepšený` / `Původní` segmented switch labeled `Verze`.
- Why: source versus improved is a comparison inside the text view, while
  summary and translation are separate outputs. Showing all four as peers
  made the hierarchy look flatter and busier than it is.
- Preserve: opening the dialog still starts on `Vylepšený`; choosing `Původní`
  lazily loads the original export; each version retains its own save actions,
  and summary/translation generation and caching are unchanged.
- Files: `src/Detail.tsx`.

### 2026-08-02 — The user-facing feature is “Vylepšený přepis”

- Supersedes: earlier terminology notes that prescribed `Vylepšený text` and
  `Vylepšit text` in the UI.
- Changed: the stored AI result is labeled `Vylepšený přepis`, and the action
  that creates it is `Vylepšit přepis`. The same noun is used in the preview
  heading, main action, save-menu group, export descriptions, completion toast,
  summary/translation empty states, and backend errors visible to the user.
- Why: the feature starts from and remains recognizably tied to a transcript;
  `text` was too generic beside the original transcript, summary, and
  translation views.
- Preserve: internal TypeScript and Rust identifiers remain English
  (`aiDocument`, `startAiEdit`, and related API/storage names). The compact
  version switch inside the `Text` tab remains `Vylepšený` / `Původní`, where
  the shared noun is already supplied by the surrounding context.
- Files: `src/Detail.tsx`, `src-tauri/src/main.rs`, `src-tauri/src/ai_edit.rs`.

### 2026-08-02 — Every document view can be copied to the clipboard

- Changed: the preview footer now includes an outlined `Kopírovat do schránky`
  action with the application's standard line icon. It copies whichever result
  is currently visible: improved transcript, original transcript, the selected
  summary length, or the selected translation language.
- Changed: a successful copy uses the existing informational toast and names
  the copied view. Clipboard failure uses the existing error toast. The button
  remains disabled while the original transcript is still loading.
- Implementation: use the browser Clipboard API first and fall back to a
  temporary selected textarea for WebView environments that expose but deny
  `navigator.clipboard`. No new Tauri plugin or permission is required.
- Preserve: copy plain text exactly as stored/rendered, including paragraph
  breaks. Do not regenerate AI output and do not copy placeholder text.
- Files: `src/Detail.tsx`.

### 2026-08-02 — Summaries are source-language-first, then translated

- Changed: summary notes and the final summary are now written in the original
  transcript language. For a non-Czech or unknown source, only the completed
  summary is then translated into Czech and passed through the existing Czech
  review step. A Czech source skips translation entirely.
- Why: asking a small local model to understand, compress, and translate in one
  pass loses nuance and encourages Czech calques. Separating content selection
  from translation keeps the summary faithful before Czech wording is applied.
- Changed: progress now distinguishes `Sestavuji shrnutí v původním jazyce`,
  `Překládám hotové shrnutí do češtiny`, and `Kontroluji češtinu ve shrnutí`.
  The empty summary state explains the same sequence to the user.
- Cache: summary output hashes include the source-first pipeline version and
  the detected/requested source language. Status filtering hides summaries
  created by the former direct-to-Czech prompts, so each old length is offered
  for regeneration. Existing full-transcript translations remain valid.
- Preserve: summary lengths, final Czech output, storage key (`summary` plus
  length), export, copy, cancellation, and the no-translation path for Czech
  recordings remain unchanged.
- Files: `src-tauri/src/ai_edit.rs`, `src-tauri/src/main.rs`, `src/Detail.tsx`.

### 2026-08-02 — Generated outputs can be regenerated from their preview

- Changed: every generated AI view now exposes its regeneration action in the
  preview footer. The improved transcript always shows `Vylepšit znovu`, a
  generated summary shows `Vytvořit znovu`, and a generated translation shows
  `Přeložit znovu`.
- Why: regeneration belongs next to copy and export, where the user is already
  judging the result. Previously the improved transcript offered it only when
  stale, while completed summaries and translations had no route at all.
- Preserve: improved-transcript regeneration returns to the Faithful/Clean
  choice. Summary and translation regeneration rerun the currently selected
  length or language. The saved result is overwritten only after generation
  succeeds, so cancellation or failure leaves the previous output available.
- Files: `src/Detail.tsx`.

### 2026-08-02 — Preview labels and actions are compact and consistent

- Changed: the top document tab is `Přepis` instead of `Text`; its nested
  version switch reads `Vylepšená verze` / `Původní verze`.
- Changed: the separate `Uložit TXT` and `Uložit Markdown` buttons in every
  preview view are replaced by one primary `Uložit` button. Its upward-opening
  menu offers `TXT — Textový soubor` and `MD — Markdown`, then calls the same
  view-specific export paths as before.
- Changed: `Kopírovat do schránky` is shortened to `Kopírovat`. Regeneration
  actions use a shared refresh icon. `Zahodit` uses a trash icon and the
  design-system warning colour because it removes the generated transcript.
- Preserve: the main detail-page `Uložit přepis` menu remains unchanged and
  still contains all original transcript formats. The compact menu described
  here applies only to the AI preview footer.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Final copy for the AI improvement choices

- Changed: the `AI vylepšení` dialog uses the user-approved copy:
  - intro: `Vytvoří nový dokument. Původní přepis zůstane beze změny.`
  - `Věrná úprava`: `Opraví interpunkci, odstavce a jednoznačné chyby.`
  - `Vylepšená úprava`: `Odstraní zjevná opakování, přeřeknutí a slovní vatu.`
  - note: `Během úpravy můžeš dál číst nebo přehrávat nahrávku.`
- Supersedes: the second card's former user-facing name `Čistší text` and the
  longer explanatory copy in this dialog. Internal mode value `clean`, prompt
  behaviour, recommended badge, icons, and processing remain unchanged.
- Files: `src/Detail.tsx`.

### 2026-08-02 — Faithful-edit description is shorter

- Changed: `Opraví interpunkci, odstavce a jednoznačné chyby.` is now
  `Opraví interpunkci, odstavce a chyby.`
- Supersedes: the faithful-edit sentence recorded immediately above. Do not
  restore `jednoznačné` in this card copy.
- Files: `src/Detail.tsx`.

### 2026-08-02 — The background-work note has an info icon

- Changed: `Během úpravy můžeš dál číst nebo přehrávat nahrávku.` now starts
  with the design system's small blue outline info-circle and aligns the icon
  with the first line of copy.
- Why: this is useful information about background processing, not a warning
  or an optional recommendation, so an info symbol is clearer than a lightbulb
  or alert treatment.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — The preview Save menu opens downward

- Changed: the `Uložit` button in the AI document preview keeps its chevron
  pointing down and opens the TXT/Markdown menu below the button, matching the
  application's ordinary dropdown behaviour.
- Supersedes: the former preview-specific upward chevron rotation and
  `ulozit-seznam-nahoru` positioning. Do not restore them merely because the
  control sits in a dialog footer.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — The transcript version switch uses a comparison icon

- Changed: the redundant visible label `Verze` before the
  `Vylepšená verze` / `Původní verze` segmented control is replaced by a
  small muted before-to-after icon: two document panels connected by an arrow.
- Accessibility: the icon is decorative. The control keeps its explicit
  `aria-label="Verze přepisu"`, so removing the visible noun does not remove
  the semantic label for assistive technology.
- Preserve: labels such as `Délka` and the translation-language label remain
  textual because they communicate choices that are not repeated as clearly
  by their controls.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — The create action is named New transcript

- Changed: the visible action and source-dialog title `Přidat nahrávku` are
  now `Nový přepis`.
- Why: the user's goal is the resulting transcript, while the recording is
  only its source. Keep internal component and function identifiers in English.
- Files: `src/App.tsx`, `src/AddRecordingDialog.tsx`.

### 2026-08-02 — Modules description names local transcription directly

- Changed: the Settings module description is now
  `Nástroje a jazykové modely pro lokální přepis. Po stažení zůstávají v počítači.`
- Supersedes: `Programy a modely, ze kterých se přepis skládá. Stahují se jednou a zůstávají v počítači.`
- Files: `src/Settings.tsx`.

### 2026-08-02 — Language editing uses an on/off toggle

- Changed: the `Nepoužívat` button in Settings is replaced by the shared
  `Jazyková úprava` toggle. Turning it off clears the active model; turning it
  on restores the last selected downloaded model. If that model is no longer
  available, the downloaded recommended model is preferred, then the first
  available model.
- Changed: selecting a model card also remembers it for the next toggle-on.
- Copy: the section description is now
  `Vytvoří nový samostatný dokument. Původní přepis ani časové značky nepřepisuje.`
- Preserve: model cards still select and enable a specific quality directly.
  The toggle is shown only when at least one language model is downloaded.
- Files: `src/Settings.tsx`.

### 2026-08-02 — Missing CPU models message uses natural Czech

- Changed: the missing-compute notice now reads
  `Modely pro CPU zatím nejsou stažené. Přepis zatím běží v jiném režimu.`
- Supersedes: the dynamically prefixed, grammatically broken wording ending in
  `Než se addí, poběží přepis v jiném režimu.`
- Files: `src/Settings.tsx`.

### 2026-08-02 — Compute settings are presented as Performance

- Changed: the visible `Výpočet` labels in the Settings module overview and
  section heading are now `Výkon`.
- Copy: the section introduction is
  `Rychlost se liší několikanásobně podle způsobu zpracování.`
- Changed: the benchmark explanation now starts with the same small blue
  outline info-circle used for other informational notes and reads
  `Test přepíše kousek nahrávky každým dostupným režimem a nejrychlejší rovnou nastaví.`
- Preserve: benchmark behaviour and compute-mode selection are unchanged.
- Files: `src/Settings.tsx`, `src/styles.css`.

### 2026-08-02 — YouTube import bundles its required JavaScript runtime

- Fixed: current `yt-dlp` YouTube extraction requires an external JavaScript
  runtime. Online import now lazily downloads the official x64 Windows Deno
  archive, installs `deno.exe` beside `yt-dlp.exe`, and passes its exact path
  through `--js-runtimes deno:PATH`.
- Fixed: `yt-dlp` is forced to UTF-8 through both `--encoding utf-8` and the
  embedded Python encoding environment. Video title and final path are no
  longer printed through the Windows stdout code page; the importer finds the
  sole media file in its UUID-scoped output directory and derives the title
  from that UTF-8-capable filesystem path. This prevents the observed
  `TextIOWrapper encoding='cp1250' / Errno 22` failure.
- Changed: first-use preparation progress now covers both `yt-dlp` and Deno
  without moving backwards. The UI note says approximately 60 MB instead of
  18 MB. Both tools remain optional Module entries and portable copies include
  them through the existing `bin` directory.
- Preserve: the official `yt-dlp.exe` already bundles matching EJS scripts, so
  do not enable remote EJS component downloads unless that distribution model
  changes. Playlists remain disabled.
- Files: `src-tauri/src/download.rs`, `src-tauri/src/online_import.rs`,
  `src/AddRecordingDialog.tsx`.

### 2026-08-02 — Online import Back and Cancel really cancel

- Fixed: `Zpět` and `Zrušit` are no longer disabled while an online import is
  running. `Zpět` cancels the active tool/download process and returns to the
  source cards; `Zrušit` cancels it and closes the dialog. Escape behaves like
  Back while the online view is active.
- Backend: online import owns a scoped cancellation token, prevents concurrent
  runs, passes the token into lazy component downloads, and polls `yt-dlp`
  output through a channel so it can kill the child process within roughly
  100 ms. A cancelled UUID output directory is removed before returning.
- Race safety: cancellation belongs to one active run and is cleared only by
  that run, so a later import cannot accidentally revive or clear an older
  process. The frontend ignores the expected rejected promise after a user
  cancellation.
- Files: `src/AddRecordingDialog.tsx`, `src/api.ts`,
  `src-tauri/src/online_import.rs`, `src-tauri/src/main.rs`.

### 2026-08-02 — The transcript version switch is text-only

- Changed: the before-to-after icon preceding the transcript version control
  is removed. The segmented control now stands on its own, matching the other
  nearby controls that do not have a leading icon.
- Copy: `Vylepšená verze` is shortened to `Vylepšený`; `Původní verze` is
  shortened to `Původní`.
- Supersedes: the earlier instruction to use an icon instead of the redundant
  `Verze` label. Keep neither the icon nor that label unless explicitly asked.
- Accessibility: the radiogroup retains `aria-label="Verze přepisu"`.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Archive cards show language-work progress

- Changed: the root `App` now listens to `ai-edit:progress` globally and keeps
  active progress by recording id. The archive passes the matching item into
  each recording card.
- UI: while transcript improvement, summary generation, or translation is
  running, its card shows a progress bar with the backend's current Czech
  description and rounded percentage. It disappears on complete, error, or
  cancellation. AI and transcription progress render independently if both
  ever overlap.
- Backend: starting document or derived-output generation now emits the
  initial 2% preparation state immediately, rather than only storing it for
  status polling. This prevents a fast navigation back to the archive from
  leaving the card blank until the next chunk report.
- Errors: the global listener also surfaces a language-task failure in the
  application's standard error notice when Detail is no longer mounted.
- Files: `src/App.tsx`, `src/Library.tsx`, `src/styles.css`,
  `src-tauri/src/ai_edit.rs`.
### 2026-08-02 — Disabled buttons keep readable colours on hover

- Fixed: disabled buttons no longer apply hover backgrounds or brightness.
  In particular, the disabled `Stáhnout a přidat` primary action keeps its
  original foreground/background contrast when the online-video URL is empty.
- Design-system rule: hover styling on `.tlacitko` variants must be guarded by
  `:not(:disabled)` so disabled controls remain visually stable and readable.
- File: `src/styles.css`.

### 2026-08-02 — Archive elevation moves from calendar to card

- Changed: at rest, only the small calendar keeps its subtle shadow. Hovering
  or focusing a recording card removes that calendar shadow and applies the
  shared low-elevation `--stin` token beneath the complete card instead.
- Motion: both shadows transition over 120 ms, together with the existing
  border and calendar-header colour response, so the elevation reads as moving
  to the selected surface rather than two shadows stacking.
- Preserve: never show the calendar and card shadows simultaneously.
- File: `src/styles.css`.

### 2026-08-02 — Archive calendar accent appears on card interaction

- Changed: the calendar month header is muted by default, using the neutral
  surface and secondary text colour. It changes to the petrol accent with white
  text only when the complete recording card is hovered or contains keyboard
  focus.
- Why: a permanent accent header repeated on every archive row was too loud;
  the colour now works as card-level interaction feedback.
- Preserve: the transition responds to the whole card, not only to hovering
  the small calendar itself.
- File: `src/styles.css`.

### 2026-08-02 — Archive calendar shadow is subtle

- Changed: replaced the calendar's `drop-shadow(0 2px 2px / 16%)` with a much
  quieter `box-shadow(0 1px 2px / 8%)`. With the torn clipping removed, a
  regular box shadow follows the clean rounded card more naturally.
- Preserve: the calendar must retain only slight separation from the recording
  card; do not restore the stronger floating-paper shadow.
- File: `src/styles.css`.
### 2026-08-02 — Improved transcript description names the language model

- Copy: the improved-transcript dialog description now reads `Verze bez
  časových značek zpracovaná pomocí jazykového modelu.` instead of the less
  informative `Samostatná verze bez časových značek.`
- File: `src/Detail.tsx`.

### 2026-08-02 — Sentence blocks preserve grammatical phrases

- Fixed: adaptive transcript segmentation now evaluates the complete buffered
  sentence/run instead of greedily emitting a weak pause boundary after every
  Whisper source window. Source-window capitalization is not treated as a hard
  sentence boundary because Whisper can capitalize a window that starts in the
  middle of a sentence.
- Boundary priority: clause punctuation outranks commas, commas outrank audible
  pauses, and a comma or pause before a dependent opener/preposition is
  demoted. Soft splitting uses written clause boundaries; pause-only cuts are
  reserved for the hard-length fallback.
- Janka regression: the stored word timings now produce boundaries after
  `prostého důvodu,` and `že to nejde hned,`. They no longer split
  `prostého | důvodu`, `o boji, | o čase`, or `soustředíme | na ty malé`.
- Existing data: completed recordings are upgraded once from their stored word
  timestamps on application startup. This does not run Whisper or alter word
  times. The archive is backed up first, the replacement is atomic, and
  manually edited or explicitly verified segments remain unchanged barriers.
  The migration is versioned through the `sentence-layout-version` metadata
  key and is idempotent.
- Files: `src-tauri/src/transcription.rs`, `src-tauri/src/db.rs`,
  `src-tauri/src/main.rs`.
- Verified: 31 Rust tests pass, including regressions for delayed comma
  lookahead, prepositional/list continuity, source-window capitalization, and
  the one-time database upgrade. A read-only replay over the actual saved
  Janka word timings produced coherent 6.43–28.31, 28.31–49.04, and
  49.04–65.93 blocks without losing or retiming words.

### 2026-08-02 — Detail language progress is a floating bubble

- Changed only on transcript Detail: language-model improvement, summary, and
  translation progress no longer occupies a full-width strip between the
  header and playback controls. It is a compact 340 px floating card anchored
  22 px from the bottom-right viewport edge.
- UI: the bubble keeps the existing accent tint, live backend description,
  percentage, animated progress bar, and cancellation. The former text button
  `Zrušit` is a compact circular close control with an accessible Czech label
  and tooltip. Long phase descriptions ellipsize instead of widening the card.
- Layering: the opaque tinted panel and high shadow keep transcript text from
  showing through; modal overlays remain above it. Reduced-motion preferences
  disable both the entrance and progress animations.
- Preserve: archive/home recording cards continue to render their own inline
  language-work progress bars. This change must not move or restyle them.
- Files: `src/Detail.tsx`, `src/styles.css`.
- Verified: TypeScript checking, Vite production build, and `git diff --check`
  passed.

### 2026-08-02 — Archive calendar is visually quieter

- Changed: removed the jagged tear-off lower edge and the two white binding
  holes from archive recording calendars. The card now has one continuous
  rounded outline and a plain accent month header.
- Preserve: calendar size, date hierarchy, subtle depth, status-dot placement,
  and archive card layout remain unchanged.
- Supersedes: the decorative torn edge and binding-hole details described in
  the calendar entry. Do not restore them unless explicitly asked.
- File: `src/styles.css`.

### 2026-08-02 — Summary translation copy states the operation order

- Preserve: the summary empty state reads `Model nejprve shrne přepis v
  původním jazyce. Hotové shrnutí pak přeloží do češtiny.` Keep `nejprve` in
  this sentence; it makes the source-language-first workflow explicit.
- The component already contains this exact wording in `src/Detail.tsx`; this
  entry records the confirmed copy so it is not shortened back to `Model shrne
  přepis…` in a later change.

### 2026-08-02 — Primary-button hover keeps its contrast

- Fixed: enabled primary buttons now explicitly retain their primary
  background, border, and foreground colours on hover before applying the
  brightness effect. In the light theme, `Vylepšit přepis` in the language-edit
  dialog no longer becomes white text on a white/muted surface.
- Why: guarding the generic hover with `:not(:disabled)` increased its CSS
  specificity above the base `.tlacitko.hlavni` colours. The primary hover
  therefore needs to restate its colour pair at its still-higher specificity.
- Design-system scope: this applies to every enabled `.tlacitko.hlavni`; the
  disabled hover behaviour remains visually stable and unchanged.
- File: `src/styles.css`.

### 2026-08-02 — Recording titles use status dots and archive calendars

- Detail: removed the outlined file/document glyph before the recording name
  and replaced it with the existing status dot. It uses the loaded recording
  status, including green complete, pulsing accent transcription, outlined new,
  and destructive error states.
- Archive: removed the duplicate file glyph from card titles. The status dot
  now sits directly beside the title, while the former far-left status position
  is occupied by a compact tear-off calendar built in HTML/CSS.
- Calendar: displays the persisted recording `created_at` day, Czech abbreviated
  month, and year. Its paper surface has an accent header, two binding holes,
  subtle depth, and a clipped torn lower edge. The full numeric date is exposed
  through a Czech accessible label and tooltip. Invalid legacy dates fall back
  to a neutral placeholder.
- Rename mode keeps the same calendar and status hierarchy, so entering rename
  does not make the card jump back to the old layout.
- Naming: new component and CSS identifiers use standard English as required by
  `ARCHITECTURE.md`; stable legacy status classes remain unchanged.
- Files: `src/Library.tsx`, `src/Detail.tsx`, `src/styles.css`.
- Verified: TypeScript checking, Vite production build, and `git diff --check`
  passed.

### 2026-08-02 — Optional watched folder imports finished recordings

- Added: Settings now contains `Sledovaná složka`. The user chooses one
  directory and explicitly enables its toggle; upgrades keep the feature empty
  and disabled, so no folder is scanned without consent.
- Scope: while the app is running, only supported audio/video files directly
  inside that directory are checked. Nested directories are deliberately not
  crawled. The polling interval is five seconds and requires no installed
  Windows service, which keeps portable copies self-contained.
- File safety: a new or changed file must keep the same size, modification
  time, and creation time across two scans before it is added. Preserve this
  two-scan observation step — it prevents importing a recording while another
  program is still copying or writing it.
- Duplicate safety: imported `(path, fingerprint)` pairs are stored separately
  from archive recordings. Removing a recording card therefore does not cause
  the unchanged source file to reappear. Replacing a file at the same path with
  changed contents creates a new fingerprint and may be imported again.
- Existing archive: a watched file whose exact path is already present is
  marked as handled instead of being added twice.
- Workflow: newly detected recordings appear in the Archive. If its existing
  `Automatický přepis` toggle is enabled, transcription starts immediately;
  otherwise the recording remains ready for a manual start. A standard app
  notice confirms the import, and repeated folder-access errors are deduplicated.
- Naming: all new source identifiers, settings fields, commands, and SQLite
  tables use standard English. Visible UI copy remains natural Czech.
- Files: `src/App.tsx`, `src/Settings.tsx`, `src/api.ts`, `src/types.ts`,
  `src-tauri/src/main.rs`, `src-tauri/src/db.rs`.
- Verified: TypeScript checking and Vite production build passed; all 33 Rust
  tests passed, including new regressions for two-scan stability and persistent
  imported fingerprints; `git diff --check` passed.

### 2026-08-02 — Settings explanatory notes share one info treatment

- UI rule: short explanatory notes that clarify an option use the shared
  `InfoNote` component: a 16 px accent information icon, secondary text, an
  8 px gap, and consistent top alignment. Compact notes inside action rows
  remove the normal top margin but keep the same icon and typography.
- Applied to: `Vše potřebné je stažené.`, the deferred language-model loading
  note, transcription search thoroughness, speaker separation, and the Quick
  Tips strip description. The existing compute benchmark explanation now uses
  the same component instead of duplicating its SVG.
- Conditional states stay semantic: missing modules retain their warning
  treatment, and `Jazyková úprava je vypnutá.` remains a plain status rather
  than receiving an information icon.
- Backups: the archive description now says that the archive is one file, a
  copy is made whenever the application starts, and the newest three are kept.
  Backend behaviour was changed to match: the former one-hour throttle is
  removed, while backup creation remains on its own thread so startup does not
  wait for a large archive copy.
- Files: `src/Settings.tsx`, `src/styles.css`, `src-tauri/src/main.rs`,
  `src-tauri/src/db.rs`.
- Verified: TypeScript checking, Vite production build, all 33 Rust tests, and
  `git diff --check` passed.

### 2026-08-02 — Watched files require a decision in the Archive

- Supersedes: watched-folder detection must no longer add recordings or start
  transcription silently. This replaces the automatic-import workflow in the
  earlier watched-folder entry, including its dependency on the Archive's
  `Automatický přepis` toggle.
- Archive UI: once new files remain unchanged across two scans, a tinted panel
  appears above the archive toolbar. It lists the exact filenames and asks
  whether to add them to the Archive and transcribe them. Singular and plural
  Czech copy are handled separately.
- Actions: `Přepsat` imports the complete displayed batch and explicitly starts
  transcription, regardless of the automatic-add preference used for manual
  file selection. `Ignorovat` records the current file fingerprints without
  creating archive recordings. An ignored file is offered again only after its
  fingerprint changes.
- Safety: discovery now returns serializable candidates rather than database
  recordings. Import and ignore are separate backend commands. Both revalidate
  that each candidate still exists, has the same fingerprint, uses a supported
  extension, and is a direct child of the currently enabled watched directory;
  frontend paths are never trusted by themselves.
- Existing safeguards remain: files must be stable across two scans, nested
  folders are not crawled, existing archive paths are marked as handled, and
  repeated `(path, fingerprint)` pairs do not return.
- Settings copy now says that the folder is monitored and new files are
  offered in the Archive; transcription begins only after confirmation.
- Files: `src/App.tsx`, `src/Library.tsx`, `src/Settings.tsx`, `src/styles.css`,
  `src/api.ts`, `src/types.ts`, `src-tauri/src/main.rs`.
- Verified: TypeScript checking, Vite production build, all 33 Rust tests, and
  `git diff --check` passed.

### 2026-08-02 — The Archive always begins with an adaptive drop zone

- Layout: `Sem přetáhni nahrávku` is no longer an empty-archive state. It is a
  permanent first section above search, the automatic-transcription toggle,
  search results, and recording cards. Existing recordings therefore never
  remove the main entry point for adding another one.
- Scroll behaviour: the drop zone is sticky inside the Archive's own scroll
  container. It starts as the full centred hero. After 80 px of scrolling it
  becomes a compact horizontal bar with the smaller mark, title, and
  `Nový přepis` action; the explanatory sentence collapses. It expands again
  below 18 px, providing hysteresis so the layout does not flicker around one
  threshold.
- Cleanup: the old dashed add strip after the final recording card is removed;
  keeping both entry points would be redundant.
- Motion: size, padding, copy, and surface changes use short 180 ms transitions.
  All transitions are disabled under `prefers-reduced-motion: reduce`.
- Preserve: the full drop zone still explains whether automatic transcription
  is enabled and that data stays on the computer. Clicking its button continues
  to open the existing local/online add flow, while window drag-and-drop remains
  unchanged.
- Naming: the new component and CSS identifiers use standard English as
  required by `ARCHITECTURE.md`.
- Files: `src/Library.tsx`, `src/styles.css`.
- Verified: TypeScript checking, Vite production build, all 33 Rust tests, and
  `git diff --check` passed.

### 2026-08-02 — Performance-test explanation is shorter

- Copy: the information note under `Změřit rychlost` now reads `Test přepíše
  kousek nahrávky každým dostupným režimem a nejrychlejší rovnou nastaví.`
- Preserve: keep `každým dostupným režimem` in the instrumental and retain the
  conjunction before `nejrychlejší`; the shortened sentence must still be
  grammatical Czech.
- File: `src/Settings.tsx`.

### 2026-08-02 — Settings picker actions match field height

- Fixed: buttons placed directly beside an input in a Settings `.radka` now
  use the same 38 px height as that input. `Vybrat…` no longer sits four pixels
  shorter than the directory field.
- Scope: the override applies only to `.pole .radka > .tlacitko`; the shared
  34 px button height remains unchanged everywhere else in the application.
- File: `src/styles.css`.

### 2026-08-02 — Archive recording metadata uses labelled icons

- Changed: the former dot-separated metadata sentence beneath each archive
  recording title is split into individual inline items. Duration uses a clock,
  language a globe, model a target, and segment count stacked layers. Error
  text uses a warning triangle and the destructive colour.
- Hierarchy: all metadata values now share the same 12.5 px size, 500 weight,
  secondary colour, spacing, and line height. No value should appear to be a
  heading merely because of its name or position.
- Copy: language names are capitalized for display (`Angličtina`) so their
  casing matches model labels such as `Nejvyšší kvalita`. Segment counts use
  `1 úsek`, `2–4 úseky`, and `5+ úseků`.
- Accessibility: each item has a descriptive Czech `aria-label` and tooltip;
  the decorative line icon itself stays hidden from assistive technology.
- Responsive behaviour: metadata remains one flex row when space permits and
  wraps by complete icon/value pairs on narrower cards.
- Files: `src/Library.tsx`, `src/styles.css`.
- Verified: TypeScript checking, Vite production build, and `git diff --check`
  passed.

### 2026-08-02 — Info notes following a CTA have more breathing room

- Fixed: when a Settings information note immediately follows a `.tlacitko`,
  its top margin increases from the normal 12 px to 18 px. The explanation
  under `Změřit rychlost` no longer touches the button optically.
- Scope: notes under sliders, toggles, and other fields keep their existing
  spacing; compact information notes inside action rows remain marginless.
- File: `src/styles.css`.

### 2026-08-02 — Simple Settings sections use right-aligned toggles

- Changed: the `Mluvčí` and `Rychlé tipy` cards now share a
  `SettingsToggleHeader`. The left column contains the section title and its
  information-icon tagline; the toggle sits alone at the card's upper right.
- Removed visually: the redundant inline labels `Rozlišovat mluvčí` and
  `Zobrazovat tipy nad přepisem`. The section heading already names the option,
  so a second visible title weakened the hierarchy.
- Accessibility: each checkbox retains the removed wording as its Czech
  `aria-label` and the toggle label's tooltip. The normal keyboard focus ring
  on the track is preserved, and padding around the label gives the compact
  control a larger click target.
- Expansion: when speaker separation is enabled, its detailed fields begin
  20 px below the shared header. Cards without additional fields remain
  compact.
- Files: `src/Settings.tsx`, `src/styles.css`.
- Verified: TypeScript checking, Vite production build, and `git diff --check`
  passed.

### 2026-08-02 — Detail transcription progress uses the floating job bubble

- Changed: transcription and speaker-separation progress no longer replace the
  detail player's full width with a thin status bar. They appear in the same
  compact bottom-right floating surface as language editing.
- Shared component: `DetailProgressBubble` owns the common geometry, progress
  animation, percentage treatment, accessibility live region, and optional
  cancel action. Transcription uses a waveform icon; language work keeps the
  sparkle icon. Do not reintroduce separate progress layouts for detail jobs.
- Behaviour: the player stays hidden while transcription or diarization is in
  progress, as before. The wide placeholder was removed rather than leaving an
  empty control strip. A transcription can be cancelled from the bubble;
  diarization has no cancellation backend, so its bubble intentionally has no
  close action.
- State repair: the detail now reloads persisted recording state after
  `complete`, `cancelled`, and `error`, not only after successful completion.
  This makes the bubble disappear and restores the correct retry/player state
  after cancellation or failure.
- Scope: archive-card progress remains unchanged. This rule applies to the
  recording detail only.
- Files: `src/Detail.tsx`, `src/styles.css`.
- Verified: TypeScript checking, Vite production build, and `git diff --check`
  passed.

### 2026-08-02 — Preview save menu avoids the window edge

- Fixed: the `Uložit` format menu in the improved-transcript preview no longer
  opens past the bottom of the app window and gets clipped.
- Behaviour: it opens downward by default. Immediately before opening, it
  measures the available viewport space; when there is not enough room below
  and more room above, only this preview menu flips above its button.
- Kept: the button chevron continues to point downward as the conventional
  disclosure indicator. The main detail-header export menu is unchanged.
- Files: `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Archive drop zone reliably collapses on scroll

- Fixed: the permanent `Sem přetáhni nahrávku` surface now reliably enters its
  compact state when the Archive is scrolled. The Archive flex child has
  `min-height: 0`, so it is always the actual scroll container, and scroll
  anchoring is disabled there so shrinking the sticky header cannot move the
  scroll position back toward zero and immediately undo the state.
- Thresholds: collapse begins after 64 px; expansion happens only within 4 px
  of the top. Keep this hysteresis because the drop zone changes its own layout
  and must not flicker around one shared threshold.
- Sizing: the compact surface has an 85 px minimum height, matching the normal
  base height of a recording card. Its expanded 320 px minimum and compact
  height, padding, mark, title, and explanatory copy use the existing short
  transition.
- Spacing: the compact sticky wrapper keeps 16 px below its surface, giving the
  search/toggle row a small visual separation before it scrolls underneath.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Archive header and recording list use separate layout layers

- Fixed: search, notices, and recording cards no longer scroll underneath the
  compact `Sem přetáhni nahrávku` surface. The drop zone is now a normal flex
  header outside `archive-scroll-content`; only the content below it scrolls.
- Stability: compact-state thresholds read the nested content's `scrollTop`.
  Because resizing the drop-zone header changes the scroll viewport rather
  than the size of content above its scroll position, resizing the app window
  no longer makes the full and compact states jump back and forth.
- Input: mouse-wheel movement over the non-scrolling drop-zone header is
  forwarded to `archive-scroll-content`; a large expanded header must not make
  the Archive feel unscrollable until the pointer reaches the list itself.
- Layout: the nested scroll layer expands through the Archive's side padding
  so its scrollbar remains at the window edge, while each notice, toolbar,
  result, and recording list retains the shared 900 px content width.
- Supersedes: do not restore `position: sticky` on `.archive-drop-zone`; the
  separate flex header is what prevents archive content from being obscured.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Language-editing toggle status uses the shared info pattern

- Consistency: both states in the `Jazyková úprava` footer now use the shared
  compact `InfoNote` component. The enabled explanation already had the blue
  information icon; the disabled text now has the same icon, alignment,
  spacing, typography, and semantics instead of being an unadorned span.
- Copy is unchanged: `Jazyková úprava je vypnutá.` and `Model se načte až při
  spuštění úpravy.` remain the two state-specific explanations.
- File: `src/Settings.tsx`.

### 2026-08-02 — Settings UI/UX system audit

- Scope: reviewed every Settings section as one interface. Preserve these
  shared patterns instead of adding local layouts for the next option.
- Toggles: all boolean settings now render through `SettingsToggle`. Section
  switches (`Mluvčí`, `Rychlé tipy`) use a heading; field switches (`Detekce
  řeči`, `Sledovat složku`) use a compact title; the language-model footer has
  no redundant title. In every case the explanation is on the left with the
  same blue info icon and the switch is alone on the right.
- Actions: section-level actions use `settings-action-row`: short context on
  the left, one predictable button on the right, and a divider when the row is
  a card footer. This now covers modules, speed measurement, backups, and the
  portable copy. Directory selection and missing-component downloads remain
  inline because they act on the field immediately beside them.
- Disclosures: `SettingsDisclosure` and native `<details>` replace the custom
  advanced-settings expander. Both `Jemné ladění přepisu` and `Technické
  podrobnosti` share the same chevron, typography, focus state, divider, and
  indented content. Module diagnostics moved inside the Modules card instead
  of occupying a separate top-level card.
- Structure: the duplicate final `Výkon` card was removed. Processor threads
  now live in the main `Výkon` card beside compute mode and speed testing.
- Copy: preserved previously approved sentences. Other help text was shortened
  in the user's direct Czech voice, especially language selection, VAD, watch
  folders, speaker boundaries, portable copies, and advanced decoding. Labels
  state the object; explanations state only the consequence or decision.
- Status semantics: a downloaded but disabled language editor now reads
  `Připravená, vypnutá` with a prepared badge. It no longer contradicts itself
  by pairing `Vypnutá` with `nestažené`. Missing-item Czech plural forms were
  corrected for counts above four.
- Responsive behaviour: toggle copy may shrink while the switch stays fixed;
  action buttons stay fixed on the right; directory rows wrap below 560 px so
  their input and buttons do not collide.
- Cleanup: removed the old `SettingsToggleHeader`, `pokrocile*`,
  `moduly-akce`, button-followed-by-note spacing, and the one-off inline success
  colour. Future changes should extend the shared settings patterns.
- Files: `src/Settings.tsx`, `src/styles.css`.
- Verified: TypeScript checking, Vite production build, and `git diff --check`
  passed.

### 2026-08-02 — Archive list shares the centred content column

- Fixed: after the Archive header and list became separate layout layers,
  recording cards were left-aligned against the window while the drop zone and
  search stayed centred. The later `.seznam { margin: 0 }` rule had the same
  specificity and overrode the generic centring rule.
- Rule: every direct child of `archive-scroll-content` now has an explicit
  100% width, 900 px maximum, and auto inline margins under a more specific
  Archive selector. Search, notices, results, recording cards, and the footer
  note therefore share both edges with the drop zone.
- File: `src/styles.css`.

### 2026-08-02 — Scroll intent collapses the Archive header even for short lists

- Fixed: the adaptive drop zone no longer depends solely on the nested list's
  `scrollTop`. When all recording cards fit in the remaining viewport, that
  scroller has no range and its position cannot move, but a downward wheel or
  touchpad gesture must still collapse the large header.
- Behaviour: scrolling down anywhere in the Archive collapses the drop zone;
  scrolling up while the list is at its beginning expands it. Long lists also
  retain position-based collapse after 64 px and expand when they genuinely
  return from a positive scroll position to the top.
- Stability: the previous scroll position distinguishes a real return to the
  top from a resize event at scrollTop zero. Do not simplify this back to
  `compact = scrollTop > threshold`, which reintroduces both the short-list bug
  and resize flicker.
- File: `src/Library.tsx`.

### 2026-08-02 — Compact Archive search, date filter, and sorting

- Layout: the formerly dominant search field now shares one toolbar row with
  two compact controls and the automatic-transcription toggle. At the 900 px
  content width, search receives the flexible half while date and order use
  predictable fixed widths. Below 760 px, search occupies its own first row
  and the three controls wrap beneath it.
- Date filter: the calendar control offers `Kdykoli`, `Dnes`, `7 dní`, and
  `30 dní`. It compares local-day boundaries for today and rolling timestamps
  for the other periods.
- Sorting: the order control offers `Nejnovější`, `Nejstarší`, `A–Z`, and
  `Z–A`. Title sorting uses Czech locale rules, ignores case, and treats
  embedded numbers naturally.
- Shared UI: both controls reuse the application's `Select`; their calendar
  and ordering icons are only a compact prefix around that design-system
  component, not new dropdown implementations. Screen-reader labels name each
  control's purpose.
- Search interaction: active date and order choices also apply to full-text
  search results by mapping them back to their recording metadata. Filters
  therefore never appear active while silently being ignored.
- Empty state: an existing Archive with no item in the selected period shows
  `Tomuto filtru neodpovídá žádná nahrávka.` instead of an unexplained blank.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Compact drop zone preserves its surface treatment

- Changed: collapsing `Sem přetáhni nahrávku` now changes only size and content
  layout. It keeps the expanded state's subtle background, dashed border,
  22 px radius, and lack of shadow.
- Removed from the compact override: solid border, panel background, smaller
  radius, and card shadow. Do not use colour or border changes to communicate
  this state; the horizontal layout and reduced height are sufficient.
- File: `src/styles.css`.

### 2026-08-02 — Compact drop zone keeps its explanatory sentence

- Changed: collapsing the Archive drop zone no longer hides the sentence below
  `Sem přetáhni nahrávku`. With automatic transcription enabled it remains
  `Přepis začne automaticky. Žádná data neopustí počítač.`; the corresponding
  manual-start sentence remains visible when automatic mode is off.
- Layout: compact mode reduces the paragraph's top margin to 2 px but retains
  normal opacity and room for wrapping. The title and consequence therefore
  stay together in both sizes.
- File: `src/styles.css`.

### 2026-08-02 — Form fields use one blue active state

- Changed: focused text fields, number fields, URL fields, speaker-name inputs,
  archive search, recording rename, and open custom Select triggers now share
  an accent-blue 1 px border with one soft 3 px blue halo.
- Reason: the previous combination used a near-black inner border and a second
  dark focus ring, which read as two jagged outlines rather than one active
  state. `--prstenec-pole` is separate from the keyboard focus ring used by
  buttons and other controls.
- Rename cleanup: removed the one-off focus animation that faded its halo away;
  an active rename field now keeps the same stable field focus as every other
  input.
- Rule: future editable fields and Select-like controls should use
  `border-color: var(--akcent)` with `box-shadow: var(--prstenec-pole)`.
- File: `src/styles.css`.

### 2026-08-02 — Compact Archive header has more room below the app bar

- Changed: the compact drop-zone wrapper uses 20 px above its surface instead
  of 8 px. It no longer appears pressed against the main application header.
- Kept: the lower gap to the search/filter toolbar remains 16 px. The unequal
  20/16 rhythm deliberately gives the app-bar boundary slightly more air
  without making the compact header unnecessarily tall.
- File: `src/styles.css`.

### 2026-08-02 — Archive calendar supports periods and one exact day

- Kept: the quick choices `Kdykoli`, `Dnes`, `7 dní`, and `30 dní` remain in
  the Archive date menu. They are useful shortcuts and must not be replaced by
  an exact-date-only control.
- Added: `Vybrat den…` opens the platform date picker and filters recordings
  to the exact selected creation date. After selection, the date appears in
  Czech numeric format in the trigger and `Vybrat jiný den…` remains available.
- Reset: choosing `Kdykoli` returns to all dates.
- Date handling: stored `YYYY-MM-DD` is compared directly so a recording does
  not move to an adjacent day because of UTC conversion. A local-time fallback
  covers older or malformed timestamp formats.
- Search interaction: the exact-day filter continues to constrain full-text
  search results as well as the ordinary recording list.
- UI rule: periods and exact dates share the existing design-system `Select`.
  The exact date is chosen through the application's custom calendar; do not
  create a second neighbouring date control.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Archive toolbar focus rings are not clipped

- Cause: the scrollable Archive layer began at zero inner top padding. The
  search and filter controls could therefore touch its clipping boundary, so
  the top of the blue focus halo looked cut off below the fixed drop zone.
- Fix: the scrolling layer reserves 4 px above its first child, and the sticky
  toolbar owns another 8 px of opaque top padding. The controls therefore sit
  safely inside the clipping boundary even after the toolbar becomes sticky.
- Layering rule: keep the fixed drop zone outside and above the scrolling
  content. Do not solve this by raising the toolbar z-index, because list
  content would then become visible over the drop zone while scrolling.
- File: `src/styles.css`.

### 2026-08-02 — Archive search and filters stay intact while scrolling

- Problem: after the drop zone collapsed, the search/filter toolbar continued
  scrolling beneath it. The scrollport clipped the toolbar halfway through its
  controls, leaving visible fragments of pill borders below the drop zone.
- Fix: the complete search/filter row is sticky at the top of the Archive
  scroll layer. Recordings scroll beneath it, while search, date, sorting, and
  automatic transcription remain available as one intact row.
- Surface: the toolbar uses the Archive background and owns its former 18 px
  lower gap as padding. That opaque padding prevents recording cards from
  showing through between the toolbar and the list.
- Kept: 8 px of toolbar top padding preserves complete rounded borders and
  enough room for blue field focus halos. The sticky surface itself sits at
  top zero; only its opaque background touches the clipping boundary.
- File: `src/styles.css`.

### 2026-08-02 — Sticky Archive toolbar protects its top border

- Problem: scrollport padding alone did not protect the controls once the
  toolbar entered its sticky state. Their pill borders could still land on the
  clipping boundary and lose the top curve.
- Fix: the sticky toolbar now starts at top zero but contains 8 px of its own
  opaque top padding. Search and both filters always render below that safe
  area; only background may touch the edge.
- File: `src/styles.css`.

### 2026-08-02 — Settings uses a deliberate three-level hierarchy

- Section level: Settings cards now use 19 px headings, 14 px introductory
  copy, 26/28 px inner padding, and 18 px between cards. Introductory copy has
  the dedicated `settings-section-description` class and a 62-character line
  limit; do not style it as generic `drobne` helper text.
- Control level: field labels are darker and slightly larger (13.5 px), while
  named toggle rows use 15 px titles. They identify the control and therefore
  must be easier to scan than the explanation below them.
- Helper level: helper and info text remains muted at 13–13.5 px with a clear
  line height and a 62-character line limit. Blue info icons remain on the
  sentences the product explicitly marked as explanatory notes.
- Grouping: independent controls inside one card use 22 px spacing and a quiet
  divider. This applies between a field and a toggle, after a section toggle
  when its detailed fields appear, and before separated action/toggle footers.
- Page rhythm: the Settings column is 720 px wide, cards use more breathing
  room, and the page has a stronger 28 px title. Mobile reduces card and page
  padding without changing the hierarchy.
- Copy pass: short helper text now uses direct Czech (`Nula znamená automatickou
  volbu.`), the language warning is shorter, and speech detection is one clear
  sentence. Previously approved product sentences remain unchanged.
- Files: `src/Settings.tsx`, `src/styles.css`.

### 2026-08-02 — Archive collapse has no layout feedback loop

- Cause: the scroll handler both collapsed and expanded the drop zone. When a
  collapse changed the available scrollport height, the browser could settle
  `scrollTop` back at zero; the handler interpreted that layout consequence as
  a request to expand and the header bounced between states.
- State rule: scrolling or wheeling down may collapse the drop zone. Expansion
  happens only after an explicit upward wheel/touchpad gesture is projected to
  reach the beginning of the list. A resize or header-height transition may
  change `scrollTop`, but it can no longer reverse the state.
- Short lists: a downward gesture still collapses even without scroll range.
  An upward gesture at the beginning still expands it.
- Toolbar width: the order column is now 160 px instead of 132 px, so
  `Nejnovější` fits beside its icon and chevron without ellipsis. Search gives
  up the small amount of space; the toolbar still switches to its responsive
  two-row layout below 760 px.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Export format labels do not repeat the section name

- Changed: the `Vylepšený přepis` group now labels TXT as `Textový soubor`
  and MD as `Markdown`, exactly like the `Hrubý přepis` group.
- Copy rule: the group heading identifies which document is being saved; each
  row identifies only its format. Do not repeat `vylepšený přepis` in every
  row or mix constructions such as `Přepis po…` and `…v Markdownu`.
- Implementation: both groups read their row labels from the shared
  `FORMAT_DESCRIPTIONS` map, preventing the wording from drifting again.
- File: `src/Detail.tsx`.

### 2026-08-02 — Exact-date picker belongs to the app design system

- Replaced: `Vybrat den…` no longer opens the operating system date input.
  Windows rendered that picker as a cramped square surface with unrelated
  buttons, spacing, and no application shadow, and native picker internals
  cannot be restyled reliably.
- New surface: the Archive owns a 292 px calendar popover with the shared
  panel colour, 16 px radius, high shadow, quiet weekday labels, circular
  month navigation, and circular date targets. Today has a subtle accent
  outline; the selected date uses the solid blue accent.
- Interaction: selecting a day applies it immediately and closes the calendar.
  There is deliberately no redundant confirmation CTA. Escape and clicking
  outside close without changing the filter.
- Kept: `Kdykoli`, `Dnes`, `7 dní`, and `30 dní` remain in the compact date
  menu. `Vybrat den…` opens this custom calendar; it is not a second toolbar
  control.
- Accessibility: month navigation and every day have Czech labels, days use a
  grid role, and the selected state is exposed through `aria-selected`.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Settings helper copy stays short

- Changed the `Rychlé tipy` description to `Pruh nápovědy s klávesovými
  zkratkami pod přehrávačem.`
- Copy rule: Settings descriptions should identify the feature and where it
  appears in the shortest meaningful sentence. Do not explain obvious UI
  mechanics such as closing a visible strip with its own close button.
- File: `src/Settings.tsx`.

### 2026-08-02 — Sidebar toggle ends the playback strip

- Moved: the sidebar icon no longer sits in the detail header beside document
  actions. It is the final control in the playback strip, after playback
  speeds.
- Grouping: a quiet vertical divider separates the screen-layout action from
  playback-rate buttons. The icon, tooltip, `aria-pressed` state, and stored
  open/closed preference are unchanged.
- Component API: `PlaybackControls` accepts an optional `trailingControl` so
  the detail screen owns the sidebar behaviour while the player owns its
  physical position. Do not duplicate sidebar state inside the player.
- Files: `src/Detail.tsx`, `src/PlaybackControls.tsx`, `src/styles.css`.

### 2026-08-02 — Top notices enter and leave gently

- Behaviour: blue confirmations and red errors expand from the top over 320 ms
  with only a 2 px vertical settle. Closing and automatic dismissal collapse
  their height over 280 ms, so the screen below moves continuously without a
  sharp jump or conspicuous slide.
- Lifecycle: App keeps a notice mounted during its short closing state. A new
  message cancels that state before replacing the text, preventing an older
  removal timer from clearing the new message.
- Timing kept: confirmations remain for 5 seconds and errors for 9 seconds
  before their exit animation begins. The close button starts the same exit.
- Accessibility: reduced-motion mode skips both animations and hides the
  closing notice immediately.
- Files: `src/App.tsx`, `src/styles.css`.

### 2026-08-02 — Archive returns to one full-height scroll surface

- Supersedes: the earlier `Archive header and recording list use separate
  layout layers` rule is obsolete. Do not restore a nested scrollbar inside
  `archive-scroll-content`.
- Scroll ownership: `.knihovna` is now the only Archive scroll container. Its
  scrollbar spans the complete area below the application header, including
  the drop zone, toolbar, notices, and recording list. `scrollbar-gutter:
  stable` prevents the content column from shifting when the bar appears.
- Sticky order: the drop zone is sticky at top zero and collapses to a known
  121 px outer height. The search/filter toolbar is sticky at 121 px, directly
  below the compact drop zone. Both remain in the same scroll context.
- Collapse stability: wheel projection and the 64 px scroll threshold now read
  `.knihovna.scrollTop`. Expansion still requires an explicit upward gesture
  reaching the beginning, so a layout transition cannot reopen the header.
- Artifact cleanup: cards now pass under one continuous pair of sticky
  surfaces instead of crossing the boundary between two scrollports.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Header resizing and list scrolling use separate gestures

- Cause: the first downward wheel event both collapsed the drop zone and
  scrolled the newly resized page. The toolbar became sticky in that same
  frame, leaving the first recording card half-covered beneath it.
- Fix: the gesture that collapses the header is consumed and leaves the full
  Archive scroller at zero. The next gesture starts moving the recording list.
  At the top, the gesture that expands the header is consumed in the same way.
- Removed: the short gradient below the sticky toolbar. It did not fix the
  timing problem and could itself paint a detached white strip over the first
  card.
- Files: `src/Library.tsx`, `src/styles.css`.

### 2026-08-02 — Archive filters no longer cover the first card

- Cause: the search/filter toolbar remained a second sticky layer below the
  compact drop zone. While scrolling, its opaque background could cover the
  top edge of the first recording card and look like a detached white
  gradient.
- Fix: only the drop zone remains sticky. The search/filter toolbar stays in
  normal document flow, directly before the recording list, so a card can
  never begin underneath that toolbar.
- Keep: the toolbar retains a local stacking context for its calendar and
  select popovers. Do not restore `position: sticky` on `.knihovna-lista`.
- File: `src/styles.css`.

### 2026-08-02 — Language setting uses shorter guidance

- Changed the language helper to `Předem vybraný jazyk urychlí přepis. U více
  jazyků nech automatiku.`
- Removed the longer warning about Whisper translating a recording after an
  incorrect selection. Keep this helper short and focused on the choice the
  user needs to make.
- File: `src/Settings.tsx`.

### 2026-08-02 — Wizard recommendation note uses the shared info icon

- Added the same blue information icon used by explanatory notes in Settings
  before `Podle konfigurace je předvybrána vhodná sada…` in the setup wizard.
- Extracted `InfoNote` into a shared component instead of duplicating its SVG
  and spacing. Use this component for short explanatory notes across Settings
  and settings-style wizard screens.
- Files: `src/InfoNote.tsx`, `src/Settings.tsx`, `src/SetupWizard.tsx`.

### 2026-08-02 — Transcript detail header has two levels

- Structure: Detail no longer renders below the generic application header.
  Its contextual header replaces that bar, leaving only two permanent levels:
  document actions and playback controls.
- Left side: the cube is the non-interactive brand mark. A separate back-arrow
  button follows it, then the recording status dot and ellipsized file name.
- Right side: `Vylepšit přepis` / `Vylepšený přepis` and `Uložit přepis` stay
  as named document actions. A divider separates them from small circular
  icon buttons for `Nový přepis` and `Nastavení`.
- Copy: an existing AI result is labelled `Vylepšený přepis`, not `Uložit
  vylepšený přepis`; opening the document is not itself a save operation.
- Sizing: the contextual header keeps the global bar's fixed 57 px height so
  navigating between Archive and Detail does not move the window layout.
- Files: `src/App.tsx`, `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Detail utility icons stay visually quiet

- `Nový přepis` and `Nastavení` remain 34 px circular icon targets without a
  permanent border. Their muted colour and circular hover surface distinguish
  them as utility actions.
- Named document actions (`Vylepšit přepis` and `Uložit přepis`) keep their
  borders and therefore remain visually primary. Do not add a resting border
  to the two utility icons.
- File: `src/styles.css`.

### 2026-08-02 — Detail controls do not use vertical dividers

- Removed the divider before the `Nový přepis` and `Nastavení` utility icons
  in the document header and the divider before the sidebar toggle in playback
  controls.
- Spacing, control shape, and colour already communicate the grouping. Do not
  reintroduce vertical rules in either location.
- Files: `src/Detail.tsx`, `src/PlaybackControls.tsx`, `src/styles.css`.

### 2026-08-02 — Detail reuses the standard Archive back button

- Detail now uses the same quiet `← Archiv` text button as Settings instead of
  a standalone circular arrow.
- The shared left-side order on inner screens is cube, `← Archiv`, then the
  current context (recording name or mini player).
- The name remains ellipsized and may shrink before the back button or document
  actions do. Do not introduce a detail-only back-button treatment.
- Files: `src/App.tsx`, `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Hover feedback uses one calm timing

- Added shared `--hover-duration: 0.22s` and `--hover-ease: ease` tokens for
  ordinary hover colour, border, background, and shadow changes.
- Applied them to primary and icon buttons, Archive rows, both calendar
  surfaces, transcript words, selects, choice cards, and segmented controls.
  In particular, the recording calendar month now eases into and out of blue
  instead of switching abruptly.
- Kept functional motion independent: progress widths, playback rings,
  waveform colour, header resizing, and status pulses retain their existing
  timings. Do not slow feedback that communicates ongoing work.
- File: `src/styles.css`.

### 2026-08-02 — Active playback speed keeps its contrast on hover

- Added an explicit hover state for `.tlacitko.aktivni`. The active speed pill
  keeps its dark background and light text under the pointer instead of
  inheriting the generic grey button hover.
- Cause: the generic selector includes `:not()` and `:hover`, giving it higher
  specificity than the static `.tlacitko.aktivni` rule. Keep the explicit
  active-hover selector when changing shared button states.
- File: `src/styles.css`.

### 2026-08-02 — Raw export is labelled Hrubý přepis

- Renamed the original timed transcription group in the save menu from
  `Přesný přepis` to `Hrubý přepis`.
- Meaning: this is Whisper's source transcription with timestamps, before the
  language model produces `Vylepšený přepis`. Do not use `Přesný přepis` as
  the document label; it promises a level of correctness the raw output may
  not have.
- Kept: the setup question `Jak přesný přepis chceš?` describes the selected
  recognition quality and is not the name of a document, so it remains.
- Files: `src/Detail.tsx`, `CLAUDE.md`.

### 2026-08-02 — Brand cube keeps one position between screens

- Archive/global and Detail headers now apply the shared `.header-brand-mark`
  box to the cube: flex centring with 4 px vertical and 2 px horizontal
  padding inside the common 18 px header inset.
- Cause: Archive previously positioned the SVG through `.znacka` padding while
  Detail rendered a bare span, shifting the cube horizontally by 2 px during
  navigation. Keep brand geometry in the shared class.
- Files: `src/App.tsx`, `src/Detail.tsx`, `src/styles.css`.

### 2026-08-02 — Archive and Detail share a minimal status footer

- Added a fixed 30 px footer below the main content on Archive and Detail only.
  It is a status strip, not a navigation or marketing footer: no buttons,
  version, copyright, links, or duplicated progress.
- Archive shows the count and combined duration of completed transcripts, for
  example `4 přepisy · 2 h 08 min`. Czech count forms and rounded minute totals
  are generated from recording data.
- Detail shows `Uloženo` on the left. The right side shows concise recording
  context, for example `45:04 · Čeština · 386 úseků`.
- Styling stays quiet: 30 px height, 11.5 px muted text, panel background, and
  one top border.
- Files: `src/App.tsx`, `src/styles.css`.

### 2026-08-02 — Footer does not repeat local processing

- Removed the permanent `Lokálně` label. Local processing is an invariant of
  this application, not a changing status, so repeating it on every screen
  spends attention without helping a decision.
- Keep privacy guidance at decision points such as adding a recording and in
  Settings, not in the persistent status footer.
- Files: `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Bottom bubbles sit above the status footer

- Introduced the shared `--app-footer-height: 30px` token and use it for the
  footer height and bottom offsets.
- The Detail progress bubble keeps its 22 px breathing room above the footer.
  The centred dictionary suggestion bubble keeps 24 px. Neither fixed surface
  may cover the persistent footer.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Detail footer adds recording context

- Kept `Uloženo` as the left-side document state. The right side now shows
  duration, detected transcription language, and Czech-pluralized segment
  count from the selected recording.
- Values are omitted when they are not available; segment count appears only
  for a completed transcript. Do not add model name, quality, file path, or
  other sidebar-level metadata to this compact footer.
- Files: `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Manual downloads use a green completion mark

- In the wizard's manual component selection, replaced the right-side text
  `máš` with a green check in a 22 px soft circle. Its tooltip and accessible
  label are `Staženo`.
- Completed rows keep their disabled checked checkbox but no longer fade the
  entire row to 55% opacity. They use a subtle background and muted copy, so
  the green availability state remains legible.
- Scope: this rule applies to the manual download list. Text badges such as
  `doporučeno` still communicate recommendations and remain unchanged.
- Files: `src/SetupWizard.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Watch-folder files can enter Archive without transcription

- Added a third decision to the watch-folder notice: `Přidat`. It imports all
  listed candidates into Archive with their initial status but does not start
  transcription. `Přepsat` still imports and starts each recording;
  `Ignorovat` records the fingerprints without importing.
- Action order is `Ignorovat`, `Přidat`, `Přepsat`: quiet dismissal, neutral
  reversible import, then the primary processing action. Missing transcription
  tools disable only `Přepsat`; adding to Archive remains available.
- Replaced the binary prompt with `Co s ním?` / `Co s nimi?`. Successful import
  shows a confirmation and clears the candidate notice.
- Files: `src/App.tsx`, `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Watch-folder notice uses a selectable file list

- Rebuilt the watch-folder notice as one neutral design-system card with a
  clear header, an inset file list, an informational note, and a separated
  action footer. The whole surface is no longer blue-tinted.
- Each candidate is a full-width row with a square checkbox and is selected by
  default. `Vybrat vše` / `Zrušit výběr` controls the whole list. `Ignorovat`,
  `Přidat`, and `Přepsat` affect only selected files; successfully handled
  candidates disappear while unselected candidates stay in the notice.
- The decision copy is now `Chcete je přidat do archivu, nebo rovnou přepsat?`
  (with a singular variant). The rule about ignored files uses the shared blue
  info icon rather than looking like ordinary body copy.
- Files: `src/App.tsx`, `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Footer reuses Archive metadata icons

- Extracted the Archive metadata SVGs into `RecordingMetadataIcon` so cards and
  the status footer use exactly the same icon shapes rather than visual copies.
- The Archive footer now pairs the layers icon with the transcript count and
  the clock with total duration. The Detail footer uses a floppy-disk icon for
  `Uloženo`, followed on the right by the shared clock, globe, and layers icons
  for duration, language, and segment count.
- Files: `src/RecordingMetadataIcon.tsx`, `src/Library.tsx`, `src/App.tsx`,
  `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Archive source CTA

- Renamed the main Archive drop-zone action from `Vybrat soubor` to
  `Vybrat zdroj`. The broader label matches the flow, which can continue with
  a local file or another recording source.
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Automatic transcription reassurance

- Changed the Archive drop-zone subtitle to
  `Přepis začne automaticky. Žádná data neopustí počítač.` when automatic
  transcription is enabled.
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Archive CTA names the outcome

- Renamed the main Archive drop-zone action from `Vybrat zdroj` to
  `Nový přepis`. The label now names the user's goal and matches the action in
  the application header.
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Settings grouped into four consistent tabs

- Replaced the single long Settings stream with four remembered categories:
  `Přepis`, `Výkon a modely`, `Vzhled`, and `Soubory`. The tabs sit in the
  normal page flow, support arrow/Home/End keyboard navigation, and expose
  proper tab semantics to assistive technology.
- `Přepis` contains the transcription model and language, speech detection,
  advanced decoding, speakers, and language editing. `Výkon a modely` contains
  module status, compute selection and benchmark, and storage locations.
  `Vzhled` contains typography and quick tips. `Soubory` contains the watched
  folder, archive backups, portable-mode context, and portable copies.
- The module tab gets a small red status dot only when a required component is
  missing. The last open tab is remembered locally.
- Switching categories does not move the Settings scroll container on its own.
- Cleaned the visual hierarchy: one quiet tab row without a divider,
  consistent 16 px spacing between cards, aligned card geometry, and a
  right-aligned autosave status.
  Shortened `Kde jsou programy a modely` to `Umístění` inside its now explicit
  parent category.
- Files: `src/Settings.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Settings tabs stay in the normal page flow

- Removed the sticky behaviour and bottom divider from the Settings tab row.
  The tabs now sit quietly between the page title and cards without creating a
  second fixed header while the user scrolls.
- Switching categories no longer forces the Settings scroll container back to
  the top, avoiding a visible jump caused by the interface itself.
- Files: `src/Settings.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Settings toggles are vertically centred

- Every Settings toggle is vertically centred against its complete copy block
  (title plus description). Removed the previous negative top offset that made
  controls align with only the first text line and vary between card types.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Module wizard returns to its origin

- Added an explicit `Zpět` action to the first optional module-wizard step.
  It is distinct from completing or cancelling setup and returns to the screen
  that opened module management.
- App now remembers whether the optional wizard came from Settings, Detail, or
  Archive. The header back action and successful completion use that same
  destination; a wizard opened from Settings therefore returns to Settings
  instead of unexpectedly landing in Archive.
- A wizard opened directly for one missing module also uses `Zpět` to return to
  its origin instead of entering the unrelated language-editing onboarding
  step.
- Files: `src/App.tsx`, `src/SetupWizard.tsx`, `CLAUDE.md`.

### 2026-08-02 — Downloaded module badge copy

- Replaced `už máš` with `staženo` on completed transcription-model and
  language-editing choices in the module wizard. The badge now names the state
  directly and matches the existing downloaded checkmark terminology.
- Files: `src/SetupWizard.tsx`, `CLAUDE.md`.

### 2026-08-02 — User-facing Modules terminology is Models

- Renamed the user-facing `Moduly` label to `Modely` in Settings and the
  download wizard. Related actions and references now read `Spravovat modely`,
  `Doplnit modely`, and `v sekci Modely`.
- Technical component/module identifiers, CSS class names, and code comments
  remain unchanged because they describe implementation rather than UI copy.
- Files: `src/Settings.tsx`, `src/SetupWizard.tsx`, `CLAUDE.md`.

### 2026-08-02 — Archive New Transcript CTA includes the shared plus shape

- Added the same 15 px, round-capped plus used by the top-bar `Nový přepis`
  action to the Archive drop-zone CTA. Both entry points now communicate the
  same action with matching icon geometry.
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Natural Czech model accuracy copy

- Replaced `drobně méně přesný` with the natural Czech phrase
  `občas méně přesný` in the turbo transcription-model description.
- Files: `src/types.ts`, `CLAUDE.md`.

### 2026-08-02 — Automatic transcription belongs to adding a recording

- Moved the `Automatický přepis` toggle from the Archive filter toolbar into
  the recording drop zone. It now sits below `Nový přepis` in the full hero
  and beside that action after the hero collapses.
- The filter toolbar now contains only controls that affect the existing
  Archive list: search, date, and ordering.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Automatic transcription toggle placement

- Anchored `Automatický přepis` to the lower-right corner of the expanded
  recording drop zone, separate from the centred primary action.
- In the compact drop zone it remains inline with the action so the controls
  cannot overlap and the collapsed block keeps its card-height footprint.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Archive density control

- Shortened the Archive search field and added a two-icon view switch after
  the date and order filters. Its accessible names are `Klasický výpis` and
  `Kompaktní výpis`, and the selected mode is remembered locally.
- Compact mode reduces card padding and spacing, uses a smaller calendar, and
  keeps title and metadata on one line where space permits. It falls back to
  the stacked layout on narrow windows and keeps progress content intact.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Manual transcription hint

- Shortened the disabled-automatic-transcription hint to
  `Přepis spustíš tlačítkem přepsat. Žádná data neopustí počítač.`
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Archive view switch alignment

- Aligned the classic/compact view switch to the right edge of the Archive
  toolbar. Search, date, and ordering remain grouped on the left, with the
  final grid column absorbing the available space.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Stronger filename hierarchy in classic view

- Increased the recording filename to 16 px in the classic Archive view.
  Compact view keeps the smaller type so its denser layout remains useful.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Compact card calendar spacing

- Matched the compact card's left padding before the calendar to its 8 px top
  and bottom padding. The action side keeps 12 px so controls retain breathing
  room.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Shorter local-data assurance

- Shortened the privacy reassurance in both automatic and manual drop-zone
  hints from `Žádná data neopustí počítač.` to `Data neopustí počítač.`
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Automatic transcription sentence

- Changed the active hint from `Přepis začne automaticky.` to the more
  explicit `Přepis se spustí automaticky.`
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Automatic transcription switch order

- Reversed only the drop-zone automatic-transcription control so its label
  comes first and the switch sits on the right: `Automatický přepis [switch]`.
  Other application switches keep their existing order.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Compute setting label

- Renamed the Settings field label `Kde počítat` to
  `Akcelerace zpracování`.
- Files: `src/Settings.tsx`, `CLAUDE.md`.

### 2026-08-02 — Classic card content alignment

- Vertically centred the filename and metadata block against the calendar in
  classic Archive cards. Compact cards keep their existing dense alignment.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Classic card title spacing

- Increased the gap between the filename and metadata in classic Archive
  cards by 2 px. Compact cards retain their tighter spacing.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Archive status and duration icon alignment

- Wrapped the filename status dot in a 14 px alignment box matching the
  metadata icons. The dot and duration clock now share the same optical centre
  while the visible dot keeps its original 9 px size.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Classic card title optical adjustment

- Shifted only the filename row 1 px upward in classic Archive cards for
  optical balance. Calendar, metadata, and compact cards remain unchanged.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Renamed recordings display their saved title

- Fixed Archive cards showing the original filename after a successful rename.
  The backend already saved `recording.title`, but the row preferred a filename
  derived from `recording.path`, which can never change when only the Archive
  title is edited.
- Cards now render the saved title first and use the path filename only as a
  fallback when the stored title is empty. The media file itself is not renamed.
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Rename field width

- Capped the Archive rename field at 420 px instead of stretching it across
  the whole card. It remains flexible and can shrink on narrow windows.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Rename mode hides status dot

- Removed the recording status dot while an Archive card is being renamed.
  The field itself is the active focus and the duplicate status marker added
  noise. The dot remains visible in the normal card state.
- Files: `src/Library.tsx`, `CLAUDE.md`.

### 2026-08-02 — Renaming updates the mini player

- Added a player-context `updateTitle` operation that changes only the display
  title when its recording id matches the currently loaded recording. It does
  not reload audio, seek, pause, or otherwise disturb playback.
- After a successful Archive rename, App updates the mini player immediately
  before refreshing the recording list.
- Files: `src/player.tsx`, `src/App.tsx`, `CLAUDE.md`.

### 2026-08-02 — Renamed title on transcript detail

- Transcript Detail now displays the saved recording title first and uses the
  filename derived from its path only as a fallback. A title changed in the
  Archive therefore remains visible after opening the transcript.
- Files: `src/Detail.tsx`, `CLAUDE.md`.

### 2026-08-02 — Shared recording menu on transcript Detail

- Moved the Archive recording overflow menu into the shared
  `RecordingActionsMenu` component and placed the same three-dot menu directly
  after the title on transcript Detail.
- Both surfaces now share labels, icons, the language submenu, and status-based
  availability for rename, retranscription, transcript deletion, language
  choice, and removal from Archive.
- Detail supports inline title editing and updates the active player title.
  Destructive actions use the application's confirmation dialog; removing the
  active recording also closes its player. The menu is hidden during active
  transcription or diarization, matching Archive behaviour.
- Files: `src/RecordingActionsMenu.tsx`, `src/Library.tsx`, `src/Detail.tsx`,
  `src/styles.css`, `CLAUDE.md`.

### 2026-08-02 — Detail sidebar tabs, notes, and tasks

- Replaced the verbose transcript sidebar with two equal tabs: `Kontrola` and
  `Poznámky`. The selected tab is remembered locally.
- `Kontrola` now contains only uncertain transcript places and speaker tools.
  Recording metadata and explanatory copy were removed from the sidebar.
- Added timestamped notes stored in the application database. A note can be
  added at the current playback position, edited inline, opened at its audio
  time, marked complete as a task, or deleted.
- Notes are removed automatically with their recording through the database
  foreign key. Added a database test covering create, update, and delete.
- Kept the two tabs and note controls within the existing pill, colour, focus,
  spacing, and hover system instead of adding a separate visual language.
- Verification: `npm run build`; `cargo test` (34 passed); `git diff --check`.
- Files: `src/Detail.tsx`, `src/api.ts`, `src/types.ts`, `src/styles.css`,
  `src-tauri/src/db.rs`, `src-tauri/src/main.rs`, `CLAUDE.md`.

### 2026-08-03 — Multiline sidebar notes

- Replaced the note inputs with auto-growing textareas, both when creating a
  note and when editing an existing one. Line breaks are preserved.
- Enter creates a new line. Notes are saved with the existing confirmation
  button or with Ctrl/Cmd+Enter.
- Added the shared small corner radius, padding, focus border, and focus ring
  to the editable text area so its active bounds are visually clear.
- Verification: `npm run build`; `git diff --check`.
- Files: `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-03 — Editable note timestamps

- Note timestamps are now editable both in the new-note composer and on saved
  notes. Accepted values are seconds, `m:ss`, or `h:mm:ss`; values outside the
  recording are highlighted and are not saved.
- Split the previous timestamp button into two predictable controls: a small
  play button seeks to the note, while the adjacent time field edits its
  position. Enter confirms the time field.
- Extended the Tauri command and database update so changing a timestamp is
  persisted and the note list is sorted by its new position.
- Added backend validation for non-finite and negative timestamps. The existing
  note database test now verifies the timestamp update as well.
- Verification: `npm run build`; `cargo test` (34 passed); `git diff --check`.
- Files: `src/Detail.tsx`, `src/api.ts`, `src/styles.css`,
  `src-tauri/src/db.rs`, `src-tauri/src/main.rs`, `CLAUDE.md`.

### 2026-08-03 — Note control alignment

- Put saved-note controls on one 29 px top axis. The checkbox centre now
  matches the timestamp field centre, including while the field is focused.
- Changed the compact timestamp focus highlight from an outer ring to an inset
  ring so editing no longer makes the field look vertically displaced.
- Made the delete control 29 × 29 px and gave the note row equal 6 px top and
  right padding, placing the control symmetrically against the rounded corner.
- Aligned the new-note timestamp optically with the checkbox, first text line,
  and save icon using the same 7 px inset and an explicit 19 px line height.
- Verification: `npm run build`; `git diff --check`.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-03 — Interface text moves into a translation dictionary

- Changed: every string the user reads now comes from a dictionary instead of
  a literal in a component. Czech is the source language and lives in
  `src/locales/cs/`, split by screen into `common`, `app`, `library`, `detail`,
  `settings`, `wizard`, `dialogs`, `player`, `domain`, `errors`, `progress`, and
  `catalog`. 755 keys, transferred character for character from the existing
  copy; no wording was changed while moving it.
- Changed: `src/i18n.tsx` gained `tPlural`, `tDynamic`, `formatNumber`,
  `formatDate`, `compare`, and `capitalize`. `TranslationKey` is derived from
  the Czech dictionary, and `PluralKey` from the keys that end in `.other`, so a
  plural set missing a form is a compile error rather than a label that prints
  its own key at runtime.
- Changed: other languages are typed as partial and `t` falls back to Czech.
  A complete English dictionary would have to be either finished in one sitting
  or padded with placeholders; falling back means an untranslated key shows
  correct Czech instead of a blank label, and translation can land in batches.
- Changed: six hand-written Czech plural functions were removed in favour of
  `Intl.PluralRules` through `useFormats` (`src/formats.ts`). Czech has four
  categories and English two, so the grammatical choice cannot live in a
  component. Where the old code was ungrammatical for 1–4 items, the four forms
  were written correctly; those places are listed at the end of this entry.
- Changed: `COMPUTE_LABELS`, `MODEL_LABELS`, `MODEL_DESCRIPTIONS`, `LANGUAGES`,
  `LANGUAGE_OPTIONS`, `languageName`, and `modelName` are gone from
  `src/types.ts`, which now exports only the identifier lists behind them. Their
  names are read through `useLabels` (`src/labels.ts`). A module-level constant
  is evaluated once outside React and could never follow a language change.
- Changed: `Intl.DateTimeFormat("cs-CZ", …)` in three places, two
  `localeCompare(…, "cs")`, `toLocaleUpperCase("cs-CZ")`, and a manual
  `.replace(".", ",")` for decimals were all replaced by the locale from the
  active language. Playback speeds previously rendered as `0.75×` in Czech;
  they now follow the language.
- Changed: Rust no longer sends finished sentences to the window. A new
  `src-tauri/src/user_message.rs` defines `UserMessage { code, params, detail }`,
  and 53 commands return it instead of `String`. Progress descriptions, tool
  check issues, benchmark failures, and the download catalog carry codes as
  well. `From<anyhow::Error>` yields the code `unknown` and keeps the technical
  text in `detail`, so a failure with no dictionary entry is still readable
  rather than blank. The interface resolves codes in `src/messages.ts`.
- Preserve: the SQLite schema, its column names, and the recording statuses
  (`nova`, `prepisuje`, `hotova`, `chyba`) stay Czech, as `ARCHITECTURE.md`
  requires. `nahravky.chyba` now stores a serialized `UserMessage`; rows written
  by older versions hold a finished Czech sentence and are still displayed
  verbatim.
- Preserve: only what the user sees is translated. Identifiers, command and
  event names, comments, log output, prompts for the language model, the
  contents of exported documents, and developer-facing errors stay English or
  stay as they are.
- Added: `scripts/i18n.mjs` with `npm run i18n:check`, `i18n:export`, and
  `i18n:import`. Export writes one flat JSON of everything still untranslated,
  including the translator notes from the `*Context` maps, because a bare
  `Model` or `Kontrola` cannot be translated from the word alone. Import folds a
  translated file back and refuses any entry whose `{placeholders}` no longer
  match the source. Check reports missing plural forms, unused keys, stale keys,
  and one text appearing under several keys.
- Added: 363 translator notes across the `*Context` maps.
- Files: `src/i18n.tsx`, `src/labels.ts`, `src/formats.ts`, `src/messages.ts`,
  `src/locales/**`, `src/types.ts`, `src/App.tsx`, `src/Detail.tsx`,
  `src/Library.tsx`, `src/Settings.tsx`, `src/SetupWizard.tsx`, `src/player.tsx`,
  `src/PlaybackControls.tsx`, `src/AddRecordingDialog.tsx`,
  `src/RecordingActionsMenu.tsx`, `src/ConfirmationDialog.tsx`,
  `src-tauri/src/user_message.rs`, `src-tauri/src/main.rs`,
  `src-tauri/src/transcription.rs`, `src-tauri/src/ai_edit.rs`,
  `src-tauri/src/online_import.rs`, `src-tauri/src/download.rs`,
  `src-tauri/src/tools.rs`, `src-tauri/src/db.rs`, `scripts/i18n.mjs`,
  `package.json`, `ARCHITECTURE.md`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `cargo fmt --all`; `cargo check` with no
  warnings; `cargo test` (36 passed — the 34 existing tests unchanged, plus two
  covering `UserMessage`); `npm run i18n:check` reports no problems; an
  export/import round trip was run end to end, including a deliberately broken
  placeholder that the importer rejected.

**Copy that changed while moving, and why.** Everything else is byte-identical
to what it replaced.

- `Chybí N položek nutné pro přepis.` in Settings and `Stáhne se N položek,
  dohromady …` in the wizard were single sentences with a hard-coded plural.
  For one to four items they read as `Chybí 1 položek`. Written out as four
  forms, which corrects 1–4 and leaves 0 and 5 or more exactly as before.
- The watched-folder banner had two variants chosen by a boolean; it now has
  four forms, with the existing singular and plural wording reused verbatim.
- `Zkopírováno {n} GB.` after a portable copy now uses the shared size helper,
  so a copy under one gigabyte reads in megabytes instead of `0.8 GB`.

**Left alone deliberately, worth a decision later.** `Souběžně probíhá 2
přepisů` in the Archive is still one sentence with a hard-coded plural; it needs
new copy, not a mechanical change. `Přidat to slovníku` in the transcript
detail is missing a letter. `Shrnutí byl uložen` uses the wrong gender in two
places. The Archive mixes formal and informal address. The calendar still starts
its week on Monday for every language. None of these were touched, because this
change was a move, not an edit.

### 2026-08-03 — Adding a screen cannot skip translation

- Fixed: fifteen progress captions never resolved. Rust sent `progress.ai.
  preparing_model` while the interface prepends the dictionary name, so it
  looked up `progress.progress.ai.preparing_model`, found nothing, and showed
  the technical detail or the bare code instead of `Připravuji jazykový model`.
  Codes now carry only their own name, exactly like failure codes. The two
  benchmark codes whose whole text is the program's own output got `{detail}`
  entries, so no code is an exception any more.
- Added: `npm run i18n:new <namespace>` scaffolds a dictionary for a new screen
  and wires it up. `npm run i18n:sync` regenerates `src/locales/index.ts` from
  whatever is on disk and creates the missing language stubs. `index.ts` is now
  generated; edit the dictionaries, not the index.
- Added: `npm run i18n:check` refuses four things that would quietly leave text
  untranslated, each reported with its file and line — a dictionary that is not
  wired into `index.ts`, text still written inside a component, a code Rust can
  send that has no entry, and an incomplete or empty set of plural forms. It
  also reports stale keys and broken `{placeholders}` in a translated language.
  Unused keys and one text under several keys stay warnings, because both are
  sometimes right.
- Added: `npm run build` runs the check first, so a new screen cannot reach a
  release with its text in the components.
- Detection: a Czech letter in a live string literal is unambiguous but misses
  `Model` or `Export`, so a text node ending at a closing tag is checked as
  well. Comments are blanked before scanning, with offsets preserved, so a
  sentence in a comment is not a finding and the reported line is still right.
  A deliberate literal — a file name, a key on the keyboard, a fallback for a
  value the dictionary already holds — is excused by an `i18n-ignore: reason`
  comment on its line or the line above. Three exist today.
- Why: the dictionary made translation possible but nothing made it necessary.
  The next screen could be written the old way, and the only thing that would
  notice is a reader in another language.
- Files: `scripts/i18n.mjs`, `src/locales/index.ts`, `src/locales/cs/errors.ts`,
  `src-tauri/src/ai_edit.rs`, `src-tauri/src/download.rs`,
  `src-tauri/src/main.rs`, `src-tauri/src/online_import.rs`,
  `src-tauri/src/transcription.rs`, `src/Settings.tsx`, `src/SetupWizard.tsx`,
  `src/types.ts`, `package.json`, `ARCHITECTURE.md`, `CLAUDE.md`.
- Verified: `npm run i18n:check` passes and `sync` is idempotent; `npx tsc
  --noEmit`; `cargo fmt --all`; `cargo check`; `cargo test` (36 passed). All
  three guards were exercised on a throwaway screen — a scaffolded namespace, a
  component with two Czech literals, and a Rust code with no entry — each failed
  the check with its file and line and returned a non-zero exit code.

### 2026-08-03 — Correcting entry: package.json was overwritten

- What happened: the localization work was done in a scratch copy of the
  project. That copy had been given a throwaway `package.json` created by
  `npm init`, and the translation scripts were added to it in the belief that it
  was the real one. It was then delivered over the project's own file, removing
  every script and dependency, so `npm run tauri dev` failed with
  `Missing script: "tauri"`.
- Fixed: the original `package.json` was restored from the untouched source and
  the five `i18n:*` scripts were added to it. `build` now begins with
  `npm run i18n:check`.
- Why it was not caught: the delivered files were verified by comparing
  checksums against the scratch copy rather than against the project, so the one
  file that came from the wrong place matched itself. Compare against the
  original, not against the working copy.

### 2026-08-03 — English translation, for trying the switch out

- Added: a complete English dictionary, 733 keys, produced from the Czech source
  through `npm run i18n:export` and folded back with `npm run i18n:import`. The
  remaining 24 Czech keys are the `.few` and `.many` plural forms English never
  selects; coverage now counts only the forms the target language has, so a
  finished translation no longer reports itself as incomplete.
- Why: the language switch worked from the day it was built, but with an empty
  dictionary every key fell back to Czech, so English was indistinguishable from
  Czech. That is correct behaviour and a bad first impression of it.
- Translation decisions: English typography replaces Czech throughout — `“ ”`
  for `„ “`, no space before `%`, `1,234` for `1 234`. The transcript/
  transcription split is kept (document versus activity). Progress captions use
  the bare participle (`Converting audio`) for the Czech first person. The Czech
  copy's mixed formal and informal address collapses, as English has no such
  distinction.
- Corrected while translating, in English only: the summary empty state says the
  finished summary is translated into Czech, which is what `ai_edit.rs` actually
  does regardless of interface language. The Czech typo `Přidat to slovníku` was
  not carried over. Both remain wrong in the Czech source and are still listed
  as open in the localization entry above.
- Added: `npm run i18n:clear <language>` empties a language back to its stubs,
  so the interface falls back to Czech everywhere without unwiring anything.
  The plan is to remove English again after trying it and to add languages for
  real at version 1.0.
- Added: `i18n/` is ignored; it holds the hand-off files `i18n:export` writes.
- Files: `src/locales/en/**`, `scripts/i18n.mjs`, `package.json`, `.gitignore`,
  `CLAUDE.md`.
- Verified: `npm run i18n:check` reports 733/733 and no problems; `npx tsc
  --noEmit`; a sample across archive, detail, errors, progress, and plural forms
  was read side by side against the Czech.

### 2026-08-03 — Correcting entry: the progress-caption fix was incomplete

- What the user saw: `progress.playback.preparing` printed under the conversion
  progress bar instead of `Připravuji přesné přehrávání`, with the interface in
  Czech.
- Cause: the earlier fix in this file only searched for codes written directly
  as `UserMessage::new("…")`. Sixteen more are passed to the small wrappers
  `step` and `chunk_step`, and six more are chosen by an `if` inside the
  `UserMessage::new` call. All twenty-two still carried the `progress.` prefix
  that the interface adds itself, so the lookup missed and the raw code was
  shown. The check written alongside that fix had the same blind spot, which is
  why it reported the code base as clean.
- Fixed: all twenty-two codes now carry only their own name.
- Fixed: `backendCodes` in `scripts/i18n.mjs` no longer looks for one call
  shape. It reads the balanced argument list of each call, so a code chosen by
  an `if` is found, and it discovers wrappers by looking for a function that
  hands one of its own `&str` parameters to `UserMessage::new` — rather than
  listing `step` and `chunk_step` by name, which would break again the next time
  someone adds a third one. A literal compared against, as in `kind ==
  "summary"`, is dropped before the codes are read.
- Lesson worth keeping: a check that matches one spelling of a call is not a
  check. When the guard and the fix are written from the same assumption, the
  guard confirms the assumption instead of testing it. Verify a guard by making
  it fail on the real defect, not on a made-up one.
- Files: `src-tauri/src/transcription.rs`, `src-tauri/src/online_import.rs`,
  `src-tauri/src/ai_edit.rs`, `scripts/i18n.mjs`, `CLAUDE.md`.
- Verified: `npm run i18n:check` finds every code and reports no problems;
  `cargo fmt --all`; `cargo check`; `cargo test` (36 passed); `npx tsc
  --noEmit`. The rewritten scan was confirmed to report all twenty-two before
  the codes were corrected.

### 2026-08-03 — Choosing components by hand starts at the first step

- Changed: `Vybrat ručně` is in the footer of every wizard step, not only the
  last one. From steps one to four it switches to manual mode and goes straight
  to the component list; on the last step it keeps toggling between the manual
  list and the summary, as before.
- Why: someone who opens the wizard from Settings to add one known module had to
  answer four questions about quality, speakers, and language editing before the
  by-hand list appeared. The questions are the guided path, not a toll gate in
  front of the list.
- Changed: the button is one `ManualSelectionButton` component instead of markup
  repeated in five footers, so its icon and label cannot drift apart.
- Files: `src/SetupWizard.tsx`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; the three-button footer was
  rendered against the real stylesheet — the two quiet actions group on the left
  and the primary keeps its right edge, matching the last step.

### 2026-08-03 — Detected-configuration cards carry the shared icons

- Changed: the two cards on the wizard's first step — detected configuration and
  where transcription will run — now show an icon in the same circular surface
  the module tiles use, with the label and value beside it instead of stacked
  alone. The first uses the compute chip, the second a waveform.
- Added: `src/icons.tsx` holds the shared line icons and the `LineIcon`
  component that draws them. They were defined inside `Settings.tsx`, so a
  second screen could only copy them; the same idea must keep the same drawing
  everywhere. Settings now maps a module to an icon name and renders through the
  shared component.
- Added: a waveform on the 24×24 grid. The transcription progress bubble already
  had one, but on a 19×16 box — scaling it non-uniformly would have flattened
  its peaks, so it was redrawn.
- Files: `src/icons.tsx`, `src/Settings.tsx`, `src/SetupWizard.tsx`,
  `src/styles.css`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet at 2× and compared with a module tile for icon size, circle, and
  the gap to the text.

### 2026-08-03 — Wizard card labels are one word each

- Changed: on the wizard's first step, `Zjištěná konfigurace` is now
  `Konfigurace` and `Přepis proběhne` is now `Výpočet`. English follows with
  `Configuration` and `Compute`.
- Why: with an icon on each card the label no longer has to carry the whole
  explanation. `Zjištěná` repeated what the card already is, and
  `Přepis proběhne` was a sentence opening that the value below completed.
- Note for whoever revisits this: an earlier entry replaced the visible word
  `Výpočet` with `Výkon` throughout Settings. That decision stands for Settings;
  this label is the user's explicit choice for the wizard card, so the two words
  now coexist. If they should become one word, change the wizard rather than
  Settings — `Výkon a modely` is also a Settings tab name.
- Preserve: the values below the label stay lower case (`na grafické kartě`,
  `na procesoru, tedy pomaleji`).
- Files: `src/locales/cs/wizard.ts`, `src/locales/en/wizard.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet.

### 2026-08-03 — The wizard's second card is labelled Přepis

- Supersedes the label chosen in the entry immediately above: the second card on
  the wizard's first step is `Přepis`, not `Výpočet`. English is `Transcription`,
  not `Compute`. `Konfigurace` on the first card is unchanged.
- Why: it also settles the collision that entry flagged. `Výpočet` was the word
  Settings had deliberately dropped in favour of `Výkon`, so the wizard would
  have kept a retired term alive. `Přepis` names the activity the card is about
  and belongs to no other vocabulary.
- Preserve: the values below stay lower case, so the card reads
  `Přepis · na grafické kartě`. The label names the activity, not the finished
  document.
- Files: `src/locales/cs/wizard.ts`, `src/locales/en/wizard.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet.

### 2026-08-03 — The quality step asks about the trade-off, not the accuracy

- Changed: the second wizard step is headed `Potřebuješ přepis rychle nebo
  přesně?` instead of `Jak přesný přepis chceš?`. English follows with
  `Do you need the transcript fast or accurate?`.
- Changed: `v tomhle počítači` is now `v tomto počítači` in the estimate note.
- Supersedes: an earlier entry deliberately kept `Jak přesný přepis chceš?` when
  the raw export was renamed to `Hrubý přepis`, on the grounds that the question
  described a quality rather than a document. The new wording removes the
  overlap entirely — it never uses `přesný přepis` as a noun phrase — and it
  states what the three options actually trade against each other.
- Files: `src/locales/cs/wizard.ts`, `src/locales/en/wizard.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — The quality question is shortened

- Changed: the second wizard step is headed `Bude to rychle nebo přesně?`.
  English is `Fast or accurate?`.
- Supersedes the wording in the entry immediately above. The trade-off it named
  is unchanged; the sentence no longer repeats `přepis`, which the step, the
  three cards below it, and the wizard's own title all already say.
- Files: `src/locales/cs/wizard.ts`, `src/locales/en/wizard.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — Comma in the quality question

- Changed: `Bude to rychle, nebo přesně?`. Czech puts a comma before `nebo`
  when it separates alternatives that exclude each other, which is what the
  three quality options do. English keeps `Fast or accurate?` — the comma is a
  Czech rule, not a shared one.
- Files: `src/locales/cs/wizard.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — Correcting entry: the language-model cards lost their icon

- What the user saw: the three language-editing quality cards in Settings drew
  an empty grey circle instead of the sparkle icon.
- Cause: moving the icons into `src/icons.tsx` turned `MODULE_ICONS` from a map
  of path data into a map of icon names. `ModuleTile` was updated to match, but
  a second place inlined the same map into a raw `<path d={MODULE_ICONS.editor}>`
  and was missed, so it rendered `d="editor"`.
- Fixed: that card renders through `LineIcon` like everything else. No caller
  now reads a value out of the icon map.
- Lesson: when a constant changes meaning rather than value, the compiler cannot
  help — both shapes are strings. Grep for every reader of the constant, not
  only for the component that was being refactored.
- Files: `src/Settings.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; no `<path d={` reads the icon map anywhere in
  `src/`.

### 2026-08-03 — Language editing is switched on like every other section

- Changed: the `Jazyková úprava` switch moved from a footer row at the bottom of
  the card to the section pattern used by `Mluvčí` and `Rychlé tipy`: beside the
  heading, with the explanation on its left. The model cards and the note about
  deferred loading appear only when the feature is on; switched off, the card is
  one row.
- Why: a switch at the bottom governs what is above it, which the reader only
  learns after reading the whole card. Worse, a card that was switched off still
  offered three model choices, one of them badged `používá se` — the same
  contradiction an earlier entry fixed for the module status badge.
- Behaviour change: choosing a model no longer switches the feature on, because
  a model cannot be chosen while it is off. Switching on still restores the last
  model used, then the recommended one, then whatever is installed.
- Removed: `settings.editor.disabledNote`. The switch says it.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; both states rendered
  against the real stylesheet beside the `Mluvčí` card.

### 2026-08-03 — Notes are cards, and their position is optional

- Changed: a note is no longer a row in a four-column grid of checkbox, play,
  time, text, and delete. It is a card: the text gets the full panel width,
  clamped to three lines when closed. Clicking it opens it into an editor with
  its controls below. Only one is open at a time.
- Changed: a note no longer has to sit anywhere in the recording. A new note is
  written loose, and `+ Připnout k mm:ss` fixes it to wherever playback stands.
  An open pinned note can still have its exact time typed, and `Odepnout` takes
  it off the timeline without deleting it.
- Why: the text column was about 190 px wide, so anything longer than a phrase
  wrapped five times. And most remarks are about the recording, not about one
  second of it — the old form made every one of them claim a position, which
  buried general notes among timestamps.
- Data: `poznamky` gained a `pinned` flag. `cas` cannot be made nullable without
  rebuilding the table, and zero is a real position, so the flag carries the
  distinction. Notes written before this migration all had a position and stay
  pinned. Loose notes sort first in the order they were written, pinned ones
  after them in the order they occur; the interface repeats that comparison so
  a note does not jump when it is saved.
- Changed: `add_recording_note` and `update_recording_note` take
  `Option<f64>`, and `RecordingNote.time` is nullable through to TypeScript.
  One nullable field cannot disagree with itself the way a time and a separate
  flag could.
- Interaction: an open note closes when focus leaves the card; moving between
  its own controls is not leaving. An empty composer closes the same way, but
  text already written is never discarded by looking elsewhere. `Ctrl/Cmd+Enter`
  saves, `Escape` closes.
- Files: `src-tauri/src/db.rs`, `src-tauri/src/main.rs`, `src/Detail.tsx`,
  `src/api.ts`, `src/types.ts`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check`; `cargo test` (37 passed — two new
  ones covering an unpinned note keeping no position, and the order of loose
  notes against a note pinned at zero seconds, which must not be mistaken for
  one another); `npx tsc --noEmit`; `npm run i18n:check`; every state rendered
  against the real stylesheet at the panel's real width.

### 2026-08-03 — Language editing no longer translates a foreign transcript

- Fixed: an English transcript came back in Czech from `Vylepšit přepis`. The
  instructions in `system_prompt` are written in Czech and opened with `Jsi
  pečlivý český editor`, so the model answered in the language it was addressed
  in. Nothing in the prompt said to keep the source language.
- Changed: the prompt opens and closes with the rule against translating, the
  two positions a model weighs most, and no longer calls the editor Czech. The
  instructions stay in Czech, because they were tuned against Czech transcripts
  and their examples are Czech; only the language of the answer is now pinned to
  the language of the input.
- Files: `src-tauri/src/ai_edit.rs`, `CLAUDE.md`.
- Verified: `cargo test` (38 passed, including a new regression asserting both
  modes carry the rule at the start and the end and never call the editor
  Czech).

### 2026-08-03 — Notes lose the checkbox and gain paper colour

- Changed: the tick box no longer occupies a column of every note. Marking a
  note done is an action inside the open note, beside unpinning and deleting.
  The closed card is text and nothing else.
- Changed: notes are paper yellow rather than the neutral grey used by every
  other surface, in both themes. It is the one place in the interface that is
  not chrome, and the colour says so without a label.
- Trade-off worth knowing: ticking a note off now takes opening it first. If
  that turns out to be a nuisance in daily use, the alternative is a check that
  appears in the card's corner on hover, which costs no width.
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet at the panel's real width.

### 2026-08-03 — Sidebar tab counts sit at the trailing edge

- Changed: the count on each sidebar tab stays after the label and is pushed to
  the tab's trailing edge, inset as far from it as from the top and the bottom,
  so the bubble reads as placed rather than trailing the words. The label takes
  the leading edge. An empty slot holds the count's position when there is
  nothing to count, so nothing shifts as notes are added or uncertain places
  are cleared.
- Files: `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.

### 2026-08-03 — A note cannot be pinned before it says anything

- Changed: `+ Připnout k mm:ss` is disabled in the composer until the note has
  text. Pinning an empty note recorded a position for something that does not
  exist yet, and the note could not be saved in that state anyway.
- Preserve: a saved note can always be pinned and unpinned; the restriction
  belongs to the composer, where the note is not a note yet.
- Files: `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet.

### 2026-08-03 — Transcription asks how many people speak

- Added: when speaker separation is on, starting a transcription first asks how
  many people speak. One, two, three, four, or a typed number; `Nevím` leaves
  the decision to the clustering as before.
- Why: on a two-person interview the clustering found sixteen speakers. The
  number is the one thing that makes it reliable — sherpa ignores the distance
  threshold entirely when a count is given — and the person starting the
  transcription almost always knows it. The setting for it existed but was
  buried in Settings and defaulted to automatic, so nobody reached it.
- Scope: the answer belongs to the recording, not to the machine. It is passed
  to `start_transcription` and `transcribe_in_language` as `Option<i64>` and
  overrides the stored default for that run only; settings are not written.
- Structure: every transcription now starts through one function in `App`.
  Detail no longer calls the backend directly — it was one of seven call sites,
  and any of them left alone would have skipped the question. A batch from the
  watched folder or a multi-file drop asks once for the whole batch.
- Preserve: with speaker separation off, nothing is asked and the call is direct.
- Files: `src/SpeakerCountDialog.tsx`, `src/App.tsx`, `src/Detail.tsx`,
  `src/api.ts`, `src/styles.css`, `src/locales/cs/dialogs.ts`,
  `src/locales/en/dialogs.ts`, `src-tauri/src/main.rs`,
  `src-tauri/src/transcription.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check`; `cargo test` (38 passed);
  `npx tsc --noEmit`; `npm run i18n:check`; the dialog rendered against the real
  stylesheet.
- Still open: this makes the count reachable, it does not make the automatic
  guess better. The stored `cluster_threshold` of 0.5 is sherpa's own default
  and a smaller value means more speakers, so it is a candidate for raising —
  but not without measuring on a real recording. The word-level smoothing that
  discards a speaker island shorter than two words is a second candidate; a
  minimum measured in seconds would fit speech better than a word count.

### 2026-08-03 — Sidebar background, centred tabs, no struck-through notes

- Changed: the transcript sidebar uses the application background rather than
  the panel colour, so the paper-coloured notes sit on the same surface as the
  rest of the window.
- Changed: the tab label is centred in its half of the control and the count is
  taken out of the flow and pinned to the trailing edge. Neither pushes the
  other, so a two-digit count cannot shift a label.
- Changed: a finished note is muted but no longer struck through. The line made
  finished notes harder to read and the colour already says it.
- Changed: the Settings tab `Výkon a modely` is now `Modely a výkon`.
- Files: `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.

### 2026-08-03 — Acceleration is chosen on cards, and Saved counts itself down

- Changed: `Akcelerace zpracování` uses the same choice cards as the models
  above it instead of a dropdown. Each card carries what the option means, and
  the ones this machine has not downloaded say so on the card rather than only
  inside an opened menu. `Rozhodnout automaticky` is one of the cards.
- Why: a collapsed dropdown shows one line and hides the consequence. The
  backend is picked once and lived with, which is what the card pattern is for.
- Changed: the `Uloženo` confirmation is a small green pill with a ring that
  drains over the 1.4 s it is shown. The message and its lifetime became the
  same object, so it no longer disappears without having shown that it was
  about to. Reduced-motion turns the ring off and keeps the fade.
- Preserve: the plain build (`vychozi`) still appears as a card only where one
  is installed, so nobody is offered a choice their installation cannot make.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet.

### 2026-08-03 — A missing acceleration offers to be installed, not chosen

- Fixed: selecting a backend that was not downloaded badged it `používá se`
  while the transcription ran on something else entirely. A card that cannot be
  used must not claim to be in use.
- Fixed: the warning under the cards said `Modely pro CPU zatím nejsou stažené`
  no matter which backend was selected — `CPU` was written into the sentence.
  It now names no backend: the chosen way of processing is not downloaded, and
  transcription runs with what is available. The old key is gone.
- Changed: a card for a backend this machine does not have is not selectable.
  Its badge reads `Stáhnout` in the accent colour, its icon takes the warning
  treatment, and the whole card is that action — clicking it goes to the module
  wizard for exactly that component. The separate red strip with its own
  download button is removed; the offer sits on the card that caused it.
- Why: choosing something unusable, then reading a warning somewhere else, then
  pressing a button that names nothing, was three steps and two lies. Wanting a
  backend and installing it are now the same click.
- Preserve: `Rozhodnout automaticky` is never marked missing; it selects among
  whatever is installed.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; the missing, selected and
  ordinary card states rendered against the real stylesheet.

### 2026-08-03 — Vulkan includes NVIDIA rather than excluding it

- Changed: the Vulkan card reads `Jakákoli grafická karta, včetně NVIDIA.`
  English follows with `Any graphics card, including NVIDIA.`
- Why: `nejen NVIDIA` could be read as "NVIDIA needs the other option", when in
  fact Vulkan runs on NVIDIA cards too and is the fallback when the CUDA build
  is not installed. The positive form says what the option covers.
- Preserve: `NVIDIA` stays uninflected in the Czech sentence — that is the
  user's copy decision, noted for the translator.
- Files: `src/locales/cs/settings.ts`, `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — Shorter language-editing description

- Changed: `settings.editor.description` is now `Vytvoří nový dokument.
  Nepřepíše původní přepis a časové značky.` English follows.
- Note: the user's text arrived without the closing full stop. It was added, as
  every sibling description in Settings ends in one; say so if it should go.
- Files: `src/locales/cs/settings.ts`, `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — Correcting entry: the centred tabs never reached the file

- What happened: an earlier entry described the sidebar tab label as centred
  with the count pinned to the trailing edge. Only the second half was true. The
  edit that centred the label searched for a comment wording that no longer
  matched, replaced nothing, and reported success — Python's `str.replace` does
  not fail when it finds nothing. The screenshot taken at the time showed a
  layout that was never written to disk.
- Fixed: the rule is applied. Measured in the browser this time rather than
  looked at: the centre of each label and the centre of its tab agree to the
  pixel.
- Lesson: assert on every scripted replacement. A silent no-op is worse than an
  error, because everything downstream still reports success.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-03 — Sidebar section labels use the application's micro-label

- Changed: `Nejistá místa` and `Mluvčí` drop the 14 px override and use the same
  micro-label as module tiles and the wizard's detected-configuration cards:
  11 px, upper case, quiet. The gap below a header is 8 px instead of 10.
- Why: 14 px upper case with wide tracking was a third heading size that exists
  nowhere else in the application, and above a short list it shouted louder than
  the content it introduced.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; both sidebar tabs measured and rendered against
  the real stylesheet.

### 2026-08-03 — Notes are notes, not tasks

- Removed: the done state disappears from the note interface. The tick box went
  first to give the text room, the strike-through went next because it only made
  finished notes harder to read, and what was left — a `Hotovo` / `Vrátit` pair
  inside an opened note — marked a state that nothing showed. Four keys and the
  toggle handler are gone with it.
- Supersedes the note-as-task part of the sidebar entry from earlier today. An
  open note now offers exactly what it is for: its position, and deleting it.
- Data: `poznamky.hotovo` stays in the schema and is passed through unchanged on
  every update, so nothing written by the previous version is lost and the
  column costs nothing. Dropping it would need the table rebuilt for no gain.
  If notes are ever to be tasks again, this is where the state already is.
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet.

### 2026-08-03 — The sidebar is white again

- Changed: the transcript sidebar goes back to `--panel` from the application
  background, superseding the change made earlier today. In the light theme that
  is white; the token is used rather than a literal white so the dark theme gets
  its card colour instead of a glaring slab.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; rendered against the real stylesheet.

### 2026-08-03 — A note's timestamp plays from that moment

- Changed: the time chip on a note now starts playback at the note's position
  instead of only moving the cursor there. The transcript still scrolls to the
  segment containing it, but the position played is the note's own, not the
  start of whatever segment happens to hold it.
- Why: `seek` is deliberately quiet when the recording is already loaded,
  because stepping through uncertain places is reading. A note's timestamp is
  the opposite — it is clicked in order to hear that moment.
- Implementation: a new `playFrom` beside `seek`. If the player already owns the
  recording it seeks and starts if paused; otherwise the player takes the
  recording over and begins there, as it already did for a word click.
- Files: `src/Detail.tsx`, `CLAUDE.md`.

### 2026-08-03 — Merging speakers uses the shared Select

- Changed: the merge control in the speakers list was the last native `<select>`
  in the application. It is now the shared `Select`, so it has the same pill
  shape, colours, focus ring, and keyboard behaviour as every other menu. On
  Windows the native control is painted by the operating system — square
  corners and foreign colours no CSS can reach, which is why the custom one
  exists.
- Sizing: the control keeps a fixed 132 px so a long speaker name cannot
  stretch it and push the name onto a second line.
- Files: `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; rendered against the real
  stylesheet.

### 2026-08-03 — Speaker separation is offered in the AI dialog

- Added: a third card, `Rozpoznání mluvčích`, beside the two language-editing
  modes. Choosing it and confirming runs the existing sherpa separation; the
  confirm button reads `Rozlišit mluvčí` for it.
- Why: from the reader's side both are "let the machine work on this
  recording", and separation was reachable only from a text action in the
  sidebar. Nothing about the pass itself changed.
- Preserve: this is not a language-model mode. It shares the dialog and nothing
  else, and leaves through its own branch in `startAiEdit` without touching the
  AI progress state.
- Missing components: when the separation tools are not installed the card takes
  the warning treatment, says so, and its badge and the confirm button both read
  `Stáhnout`, leading to the module wizard — the same pattern as the
  acceleration cards in Settings.
- Files: `src/Detail.tsx`, `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; the dialog rendered
  against the real stylesheet.

### 2026-08-03 — Standalone speaker separation asks the same question

- Fixed: starting speaker separation on its own — from the sidebar or from the
  new card in the AI dialog — never asked how many people speak. The question
  was added to `runTranscription`, which every transcription now goes through,
  but `diarizeSpeakers` was still its own call straight to the backend. The one
  run that exists purely to separate speakers was the one run that could not be
  told how many there are.
- Fixed: the progress bubble was missing on Detail during that run. Detail kept
  a local `diarizing` flag and an effect that cleared it on
  `progress?.phase === "complete"`. That effect listed `diarizing` among its
  dependencies, so switching the flag on re-ran it immediately, and the
  `complete` left behind by the recording's finished transcription turned it
  straight back off. The bubble appeared and vanished within a frame.
- Changed: separation is started by `beginDiarization` in `App`, beside
  `beginTranscription`. It opens the speaker dialog, then calls
  `diarize_speakers` with the answer. `App` owns which recordings are
  separating, in `diarizingIds`, and clears an id when `transcription:complete`
  arrives for it. Detail receives `onDiarize` and `diarizing` as props and keeps
  no state of its own.
- Changed: `runTranscription` clears any stale progress entry for the ids it is
  about to start before starting them. A finished run's last event was
  outliving the run and being read as the state of the next one.
- Changed: `diarize_speakers`, `start_diarization_in_thread`, and
  `run_diarization` take `speaker_count: Option<i64>`, which overrides the
  stored default for that run only, exactly as transcription already did.
- Preserve: with speaker separation switched off nothing is asked, and `Nevím`
  still leaves the count to the clustering.
- Lesson worth keeping: an effect that both reads and writes a flag it depends
  on will run again on its own write. The state it then reads is whatever the
  previous job left behind, not the state of the job that just started.
- Files: `src/App.tsx`, `src/Detail.tsx`, `src/api.ts`,
  `src-tauri/src/main.rs`, `src-tauri/src/transcription.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (38 passed); `npx tsc --noEmit`; `npm run i18n:check` reports 749/749 and no
  problems.

### 2026-08-03 — A sentence is not cut in half on a tenth of a second

- What the user saw: a two-person interview came back as `Mluvčí 1` and
  `Mluvčí 2` trading places every few words, mid-clause — `I've been preaching
  for 35 | years, 25 in my own church`, `they don't need more content, they |
  need counterintuitive content`. Their words: it alternates like socks.
- Cause: `assign_speakers` decides a speaker for every word from its overlap
  with sherpa's turns, and then cut the sentence at *every* change. The only
  thing standing in the way was a smoothing rule measured in words — a run had
  to be shorter than two of them to be absorbed. Two words is under a second;
  three words was enough to become a turn of its own and take half a sentence
  with it. Sherpa returns a moment in time and Whisper returns words, and both
  are imprecise by roughly the length of one or two of them, so the cut landed
  wherever the two errors happened to add up.
- Changed: a change of speaker inside a sentence is believed only when the
  newcomer holds the floor for at least `MIN_TURN_SECONDS` (1.4) *and*
  `MIN_TURN_WORDS` (3). Both, not either: three short words are half a second,
  and one word before a long pause can be a second and a half.
- Changed: the smoothing undoes one change per pass, the least believable
  first, and rebuilds the runs each time. Absorbing an island joins the speech
  on both sides of it, and the joined run often clears a bar that neither half
  cleared alone. An absorbed run goes to whichever neighbour speaks longer, not
  to whichever one comes first.
- Changed: a change that survives is moved up to `PUNCTUATION_SNAP` (2) words
  onto the nearest clause ending, when one is within reach and neither side
  would be swallowed whole. `for 35 | years,` becomes `for 35 years, |`.
- Preserve: this all happens strictly *inside* one sentence. A one-word `mhm`
  or `jasně` comes back from Whisper as its own segment, never reaches this
  code, and keeps the speaker it overlaps — there is a test for exactly that.
  `--min-duration-on` remains unset for the reason recorded earlier.
- Not changed, on purpose: `cluster_threshold` stays at sherpa's own 0.5, and
  the embedding model stays `campplus_sv_en_voxceleb`. Both were suspected and
  neither can be judged from here — sherpa is a Windows binary and the archive
  lives outside the folders this session can reach. Raising the threshold or
  swapping in the 200k-speaker CAM++ are still open, and still need a
  measurement on a real recording first rather than a hopeful default.
- Files: `src-tauri/src/transcription.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (47 passed). Four new regressions, built from the reported transcript: a
  two-word island must not split a sentence, a real handover must still split
  it, a surviving cut must move to the comma, and a standalone short reply must
  keep its own speaker. The two that describe new behaviour were then run
  against the old rule — restored by setting the thresholds to 0.0/2 and the
  snap to 0 — and both failed, while the two guard tests passed in both
  directions. A guard that has not been seen failing is not a guard.

### 2026-08-03 — Correcting entry: the no-translation rule was not enough

- What the user saw: an English transcript improved into English for two
  thirds of the document and then continued in Czech, from `So I'm quite
  practical` onwards. The rule added this morning was in the prompt and the
  test asserting it still passes.
- Cause: the rule is abstract — *answer in the same language as the input* —
  and every chunk is its own request carrying instructions written in Czech.
  Over a long document the model let go of the rule and drifted into the
  language it was being addressed in. A prompt is a request, not a guarantee.
- Changed: the prompt now names the language. `effective_language` already
  resolves the detected language against the requested one, so an English
  recording is told, in as many words, that the input is in English and the
  answer must be in English even though the instructions are not. A concrete
  name holds where a rule about sameness does not.
- Added: a guarantee behind the request. After each chunk, the fraction of the
  source's words that survived into the answer is measured. Correcting a
  transcript keeps nearly all of them; translating keeps names and numbers.
  Below `MIN_KEPT_WORDING` (0.45) the answer is not an edit of that chunk, and
  the chunk is asked once more with the failure named. If it comes back wrong
  again, that chunk keeps its original text.
- Why keep the original rather than fail the whole document: a part of the
  transcript left uncorrected is a much smaller loss than a part silently
  replaced by words the speaker never said. The same check also catches the
  model summarising, or answering the instructions instead of applying them.
- Preserve: the guard belongs to document editing only. Translation and
  summary are *supposed* to keep almost none of the wording, so neither goes
  through it. Chunks under `MIN_WORDS_TO_JUDGE` (20) words are let through —
  too little text to tell a translation from a coincidence.
- Files: `src-tauri/src/ai_edit.rs`, `CLAUDE.md`.
- Verified: `cargo test` (47 passed). Five new tests, built from the sentences
  that actually failed: the real English→Czech pair must be rejected and score
  under 0.2, a repunctuated correction must pass, a cleaned chunk with its
  repetitions removed must still pass, a two-word chunk must not be judged, and
  the language of the recording must reach the prompt while an unmapped code
  must not invent one.

### 2026-08-03 — Correcting entry: the diarization defect was measured, and it was the model

- Supersedes the closing paragraph of the entry above, which said the embedding
  model and the clustering threshold could not be judged from here. That was
  wrong, and it was wrong because nobody looked. The user pointed out that the
  whole project had been shared. `models/` was shared; the running application
  simply does not use it — it reads `AppData\Local\Whisp`, while the archive
  sits in `AppData\Roaming\cz.znackarna.whisp`. Both were one request away.
  (Worth knowing separately: `Whisp\models\ggml-large-v3.bin`, 3 GB, is a dead
  copy. The application uses `large-v3-turbo-q5_0` from AppData.)
- Measured: the same sherpa-onnx, the same pyannote segmentation, and the same
  audio as the application, run in this session on a Linux build. The user's
  own `paul_radomil.mp4`, 10.6 minutes, whose truth is known from their own
  description — one voice throughout with a few short interjections.

  | embedding · threshold | speakers | turns | dominant voice |
  |---|---|---|---|
  | voxceleb · 0.5 (the default until now) | 16 | 119 | 41 % |
  | voxceleb · fixed at 2 | 2 | 65 | 55 % |
  | zh_en 200k · 0.5 | 14 | 40 | 68 % |
  | zh_en 200k · 0.7 | 9 | 37 | 70 % |
  | **zh_en 200k · 0.8** | 7 | **20** | **94 %** |
  | zh_en 200k · fixed at 2 | 2 | 17 | 94 % |
  | titanet-large · 0.8 | 7 | 20 | 94 % |

- The model is the larger cause. Told the count is two — the one condition
  under which the threshold is ignored entirely — the old model still produced
  65 turns and a 55/45 split. That is a coin toss, and it is exactly the
  "alternating like socks" the user reported. The new one gives 17 turns and
  94/6.
- The threshold is the second cause. At 0.5 even the better models find
  fourteen people in a two-person conversation.
- Changed: the embedding model is
  `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`. It is 28 MB
  against the old 29.6 MB and runs at the same speed, so this costs nothing but
  the download. `titanet-large` matches it and was rejected: 101 MB and 2.4×
  slower for the same numbers.
- Verified against the earlier decision it reverses: an old entry moved *away*
  from a 3D-Speaker model because it handled Czech badly. That model was
  `zh-cn`, trained on Chinese only. This one is trained on Chinese *and*
  English across a far larger speaker set, so the reasoning does not carry over
  — but it was checked rather than assumed. On the Czech version of the same
  conversation the old model gave 106 turns and a 34 % dominant voice; the new
  one gave 20 turns and 93 %. Czech got better, not worse.
- Changed: `cluster_threshold` from 0.5 to 0.8, with a one-time migration
  (`cluster-threshold-version`) so existing installations move too. It only
  touches a value still equal to the old default; anyone who chose their own
  keeps it.
- `tools.rs` prefers the new file but still accepts the old one, so nothing
  breaks before the download happens. A stale `zh-cn` model remains last in
  that list purely so an old installation still runs.
- Residual risk, stated plainly: on a third recording (`Janka`, 10 minutes) the
  two models disagree and there is no way to settle it here — the old one finds
  4 speakers at 80 % dominant, the new one 1–2 at ~100 %. If that recording is
  a monologue the new model is right; if it has an interviewer, the new model
  is merging them. The threshold barely moves that outcome (0.5 gives 2, 0.8
  gives 1), so it is a property of the model, not of this threshold change.
  Both models were verified against known truth on two recordings and the new
  one won both; that is the basis for this decision, and Janka is the case to
  re-examine if over-merging ever shows up in use.
- Also corrected here: the entry above claimed the sentence-splitting fix
  addressed the reported alternation. Measurement of the stored archive says
  otherwise — the median stored speaker turn is 10.2 s, and of 52 turns exactly
  **one** falls under the new 1.4 s / 3-word rule. That fix is real for the 21 %
  of segments that ended mid-clause, and the punctuation snap still earns its
  place, but it was the smaller half of the problem and was described as more.
- Files: `src-tauri/src/download.rs`, `src-tauri/src/tools.rs`,
  `src-tauri/src/db.rs`, `src-tauri/src/main.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (49 passed, two new ones covering the migration: an untouched 0.5 is raised
  once and not touched again, and a deliberately chosen 0.35 is left alone);
  `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — Speaker separation reports its progress inside a transcription

- What the user saw: a 45-minute recording sat at 90 % on `Rozlišuji mluvčí`
  for a long time and looked frozen.
- First diagnosis, and it was wrong: a pipe deadlock. `diarize` gives sherpa
  both pipes and reads only stdout; the thread that drains stderr was created
  only when progress was being reported, and the full-transcription path passes
  `None`. The comment above that spawn warns about exactly this failure, which
  made the story fit too well to check.
- Why it was wrong: `report.map(|…| …)` moves `stderr` into the closure, so on
  `None` the closure is dropped and the pipe's read end closes with it. Sherpa's
  writes then fail instead of blocking. Measured with a three-way reproduction —
  stderr dropped, held unread, and drained — writing 16 kB, 100 kB and 2 MB. Only
  *held unread* deadlocks, and above roughly 64 kB. The code does the first.
- What is actually true: that path reports no progress at all, by design, so the
  bar cannot move for the whole of diarization. And 45 minutes is simply four
  times the work of the recording it was compared against. Measured here on two
  cores: 10 minutes of audio takes 95 s, 45 minutes takes 447 s — linear, with
  no hidden collapse. On the user's machine it is faster still.
- Changed: the stderr thread is now unconditional. Reporting is optional;
  draining is not. The code no longer depends on a dropped pipe as its way of
  not hanging, which was an accident rather than a decision.
- Changed: `diarize` takes the percentage band it occupies — `(app, id, from,
  to)` — and maps sherpa's own 0–100 into it. A standalone run keeps 10–90 as
  before; inside a transcription it now moves 90 → 95 instead of standing at 90.
- Measured while here, and it settles the open question from the entry above:
  on the *complete* 45-minute Janka the new embedding model finds 5 speakers in
  19 turns with a 61 % dominant voice. The earlier worry that it collapses that
  recording to one speaker came from a 10-minute slice that happens to be an
  uninterrupted monologue. The model does not over-merge; the sample was too
  short. Nothing in that decision needs revisiting.
- Not added: an automated regression. Reproducing a full-pipe stall needs a
  child process writing tens of kilobytes, and a test that hangs when it
  regresses is worse than none. The three-way reproduction above is recorded
  here instead, and it is the thing to re-run if this is ever touched.
- Lesson worth keeping, and it is the second time today: a diagnosis that
  matches a warning already written in the file is the most persuasive kind and
  the easiest to get wrong. The comment described a real hazard in a path that
  did not have it. Reproduce the failure before naming it.
- Files: `src-tauri/src/transcription.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (49 passed); `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — Automatic thread count means the machine, not four

- Measured on the real `sherpa-onnx-offline-speaker-diarization` binary — the
  Linux build of the same v1.13.4 the application ships — with the project's own
  segmentation and embedding models, ten minutes of audio, two cores. Run twice
  in opposite orders because the result was surprising:

  | threads | first pass | second pass |
  |---|---|---|
  | 1 | 120 s | 122 s |
  | 2 | 88 s | 112 s |
  | 4 | **210 s** | **204 s** |

- Four threads on two cores is roughly twice as slow as two and slower than
  one. Oversubscription here does not flatten out, it reverses.
- Changed: automatic (`settings.threads == 0`) now uses
  `std::thread::available_parallelism()` instead of a flat four. Going beyond
  the core count is the harm that was measured; whether a lower cap helps a very
  wide machine was not measured and is deliberately not guessed at.
- Scope: this is the diarization call only. Whisper's own thread handling was
  not touched, because it was not measured.
- Found while measuring, and left alone on purpose: `--segmentation.pyannote-
  window-shift-ratio` does not exist in this sherpa version. The full option
  list is `clustering.{cluster-threshold,num-clusters}`,
  `embedding.{debug,model,num-threads,provider}`, `min-duration-{on,off}`,
  `segmentation.{debug,num-threads,provider,pyannote-model}`, plus `config`,
  `help`, `print-args`. The application already guards the flag with
  `supports(...)` and correctly omits it, so nothing is broken — but
  `segmentation_window_shift` in settings therefore changes nothing at all
  today. It is a live control over a dead flag. Either the guard should surface
  that in the interface or the field should go; that is a decision, not a fix,
  so it is recorded rather than made.
- Recorded for the GPU question, verified rather than assumed: this binary
  accepts `--segmentation.provider` and `--embedding.provider` with exactly
  `cpu, cuda, coreml`. There is no Vulkan and no DirectML. ONNX Runtime has no
  Vulkan execution provider at all — the request for one is open and was
  declined by its maintainers in favour of WebGPU. Whisper reaches Vulkan
  because whisper.cpp is ggml, a different stack entirely; the two cannot be
  reasoned about together. A GPU path for diarization therefore means CUDA, a
  CUDA build of sherpa, and a matching CUDA 12.x / cuDNN 9 runtime on the
  machine — which the sherpa documentation warns crashes without a message when
  the versions disagree.
- Files: `src-tauri/src/transcription.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (49 passed).

### 2026-08-03 — A build the machine cannot run is not a valid choice

- What the user has: an AMD Radeon 9070, and `compute = "cuda"` stored in
  settings. Their own module diagnostics show `bin\cuda\whisper-cli.exe` as the
  selected program. CUDA is NVIDIA-only, so the CUDA build finds no device and
  transcription falls back to the processor — while Settings goes on saying the
  work runs on the graphics card.
- Cause, `choose_compute`: an explicit choice was accepted on the strength of
  the folder existing.

  ```rust
  if choice != "auto" && k_dispozici.iter().any(|x| x == choice) { … }
  ```

  `has_nvidia()` was consulted only in the `auto` branch below it — the one
  place the question had already been asked. A downloaded folder proves the
  files are present, not that the machine can execute them.
- Changed: `usable_compute(backend)` asks the driver — `nvcuda.dll` for CUDA,
  `vulkan-1.dll` for Vulkan, always true for `cpu` and `vychozi`. An explicit
  choice must now pass it too; failing that, resolution falls through to the
  automatic order and lands on something that actually runs. The automatic
  branch calls the same predicate, so the two can no longer drift apart.
- Consequence worth stating: this silently overrides a stored preference. That
  is deliberate and matches the rule an earlier entry set for the Settings
  cards — a backend that cannot be used must not claim to be in use. The
  interface should eventually say so out loud rather than only correcting it;
  recorded as open.
- For this machine specifically: with an AMD card the answer is `vulkan`, which
  ggml supports natively and which `ggml-vulkan.dll` in `bin` is already there
  for. Nothing about diarization changes — sherpa is onnxruntime, which has no
  Vulkan provider at all.
- Files: `src-tauri/src/tools.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (52 passed — three new ones: a stored choice the machine cannot run is not
  honoured, the predicate gates only the accelerated builds, and the processor
  build is always acceptable); `npx tsc --noEmit`; `npm run i18n:check`.

### 2026-08-03 — Speakers are judged by listening, and merged by naming

- The user's read, and it is the right one: chasing the clustering threshold is
  the wrong fight. Six speakers where two exist is only a problem if sorting it
  out is slow. Make it twenty seconds and the algorithm's tail stops mattering.
- Measured first, because it changes what the interface has to survive. On the
  user's own `paul_radomil`, told the count is two, the pipeline is right:
  **2 speakers, 9 turns, 99.8 % / 0.2 %** — exactly their description. Left to
  the threshold at 0.8 it produces 95 % plus five slivers of 3.6, 0.6, 0.5, 0.3
  and 0.0 %. The dominant voice is never the error; the error is always a tail
  of tiny clusters. That is what the panel is now built to dispatch.
- Changed: each speaker row is `play · name · share`. The coloured dot became a
  play button that starts that speaker's **longest continuous stretch** —
  the clearest sample of a voice there is. Clicking again walks to the next
  stretch, longest first. Adjacent segments are joined across gaps under 0.6 s
  so one sentence split into blocks is not counted as several samples.
- Added: the share of spoken time on every row. A cluster holding 0 % is
  recognisable as noise without playing anything, which is most of the work.
- Changed: merging is naming. Type a name another row already has and the two
  become one. The merge menu is gone, and with it two keys.
- Why: the old control was a dropdown of `Mluvčí 3` … `Mluvčí 6`, which asks
  the reader to remember which number was whom while choosing. Naming is the
  step they were going to take anyway, so it carries the merge for free.
- Safety: the merge runs on blur or Enter, never mid-typing. Otherwise `Pa`
  would merge into `Pavel` on the way to `Paul`. Comparison is trimmed and
  case-insensitive through `toLocaleLowerCase`, so `paul` and `Paul` are one
  person in Czech and Turkish alike.
- Changed: the AI dialog's speaker card now shows a `hotovo` badge and says the
  separation already ran, and its confirm button reads `Rozlišit znovu`. It
  previously offered the same words whether or not the work had been done.
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check` reports no problems and no
  unused keys; `cargo test` (52 passed); the panel rendered against the real
  stylesheet at 2× — the play button, the name field and the share sit on one
  optical centre (34.1 px for all three), and a 0 % row reads as noise at a
  glance.
- Correcting a claim made to the user earlier today: the residual-risk note in
  the entry above guessed at Janka's truth from a ten-minute slice. The user has
  since stated the truth for their recording — two people, one holding 99 % —
  and the forced-count run reproduces it exactly. Threshold-based clustering
  fails structurally on that shape, because a dominant speaker's own embedding
  spread exceeds the distance to a rare second voice. No threshold fixes it;
  the count does, and so does this panel.

### 2026-08-03 — Both sidebar headings carry an icon

- Changed: `Mluvčí` gets the shared `speakers` line icon before its label, at
  14 px against the heading's 11 px upper case — an outline needs more room
  than a letter to weigh the same.
- Changed with it, and this was not asked for: `Nejistá místa` gets a matching
  icon. The two are siblings in the same panel using the same micro-label; one
  decorated heading beside a bare one reads as unfinished rather than
  deliberate. Say the word and this half goes back.
- Added: `uncertain` in `src/icons.tsx` — a question mark inside the same
  circle the `model` icon uses, so the two sit at one optical weight on the
  shared 24×24 grid.
- The icon takes `--text-tichy` while the label keeps the heading colour, so
  the words still lead and the icon only marks the place.
- Files: `src/icons.tsx`, `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; both headings rendered
  against the real stylesheet at 2× — each icon's centre matches its heading's
  centre to the pixel (33.0 and 104.0).

### 2026-08-03 — One verb for separating speakers: rozpoznat

- Changed: the sidebar button reads `Rozpoznat mluvčí` (and `Rozpoznat znovu`
  once it has run), per the user's wording.
- Changed with it: the whole vocabulary, because the feature was being called
  two different things. The AI dialog card has said `Rozpoznání mluvčích` since
  it was added, while every button beside it said `Rozlišit`. One feature, two
  verbs, and nothing in the interface explained which was which.
- Now uniformly `rozpoznat` / `rozpoznávám` / `rozpoznání`: the sidebar button
  and its running state, the progress caption on Detail and on archive cards,
  the AI dialog's confirm button in both states and its missing/done copy, the
  speaker-count dialog's explanation, the launch failure, and the Settings
  diagnostic line. English follows with `identify` throughout, replacing the
  mixed `Identify` / `Separate`.
- Supersedes `Rozlišit mluvčí` and `Rozlišit znovu` recorded earlier today; do
  not reintroduce `rozlišit` for this feature.
- Files: `src/locales/cs/{detail,progress,library,dialogs,errors,settings}.ts`,
  `src/locales/en/{detail,progress}.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; `cargo test` (52 passed);
  a grep across `src/locales/cs` finds no remaining `rozlišit`/`rozlišen` and
  across `src/locales/en` no remaining `separate`/`separated` for this feature.

### 2026-08-03 — The notes section gets the same header as its siblings

- Changed: the notes panel had no heading at all — only a right-aligned
  `+ Přidat`. It now uses the shared `sidebar-section-header`: a `Poznámky`
  micro-label with the new `note` icon on the left, the action on the right.
  All three sidebar sections are now `icon · label … action`.
- Added: `note` in `src/icons.tsx` — a page with a turned-up corner, which is
  what makes it a sticky rather than a document, matching what these notes are.
- Removed: `.notes-toolbar`, which existed only to right-align that one button.
  The shared header already does it.
- Worth knowing: the heading repeats the tab above it, since the Poznámky tab
  holds exactly one section. `Kontrola` holds two, so its headings carry real
  information. This one buys consistency at the cost of one repeated word —
  the alternative is moving the icons onto the tabs instead, which would drop
  the section headings entirely.
- Files: `src/icons.tsx`, `src/Detail.tsx`, `src/styles.css`,
  `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `npm run i18n:check`; no `notes-toolbar` remains
  in either the component or the stylesheet; rendered against the real
  stylesheet at 2× beside the speakers header — both headings start at the same
  19 px left edge and each icon shares its action's optical centre.

### 2026-08-03 — A clamped note opens itself when pointed at

- Changed: a note whose text is longer than the three lines it shows now
  reveals the rest on hover, and on keyboard focus. Clicking still opens the
  editor, so reading and editing are no longer the same gesture.
- Why: the note was clamped to three lines and the only way past them was to
  click, which put the note into an editor. Reading what you wrote should not
  cost an edit.
- Implementation: `-webkit-line-clamp: unset` under `:hover` and
  `:focus-within`. A note that already fits does not move, because lifting a
  clamp it never hit changes nothing — measured: the short note stays 44 px in
  every state.
- Trade-off worth knowing: an expanding note pushes the ones below it down
  while the pointer rests on it — measured, 83 px to 161 px on a six-line note.
  The alternative is floating the full text over its neighbours, which does not
  shift the list but does cover it. In a short sidebar list the shift is the
  smaller cost; revisit if the list ever gets long.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; rendered against the real stylesheet at 2× and
  measured in the browser in three states — at rest, hovering the long note,
  and hovering the short one.

### 2026-08-03 — The sidebar tab is Obsah, not Kontrola

- Changed: the first sidebar tab reads `Obsah`; English follows with
  `Contents`. Supersedes `Kontrola` / `Review` from the tabs entry earlier.
- Why: the tab holds two different things — the uncertain places in the
  transcript and the list of speakers. One is about accuracy, the other about
  identity, and no verb covers both. `Kontrola` named an activity that only
  half the panel is, and in Czech it also carries a supervisory sense the
  panel does not have. `Obsah` names what the panel contains and leaves the
  reader to decide what to do with it.
- Preserve: the key stays `detail.sidebar.reviewTab`, and the section headings
  inside it (`Mluvčí`, `Nejistá místa`) are unchanged — they are what makes
  the tab's two halves legible now that its own label no longer describes
  either one.
- Files: `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` reports 753/753
  for English and no problems.

### 2026-08-03 — The sidebar is one page with three folding sections

- Supersedes both the two-tab sidebar and the `Obsah` rename recorded above.
  There are no tabs. `Mluvčí`, `Nejistá místa`, and `Poznámky` are three
  sections on one page, each opening and closing on its own.
- Why: the tabs forced a choice between things that are read together —
  checking a speaker often means reading the note that says who they are — and
  the first tab had to be named after two unrelated lists at once, which is
  what made every name for it wrong.
- Changed: the headings are sentence case at 14 px instead of 11 px upper
  case. Three micro-labels down one column read as fine print rather than as
  structure; the label was carrying a tab strip that no longer exists.
- Changed: each heading's icon sits in the same 30 px circle the module tiles
  and acceleration cards use, at 17 px — the ratio those use at 22 in 38.
- Changed: the whole heading row is the toggle, sized to its content so the
  section's action keeps the far right. A full-width toggle pushed `Mluvčí`
  into an ellipsis while the row still looked half empty.
- The count badge shows only while a section is closed. Open, the list below
  is the answer; closed, the badge is the only thing the header still says.
- State: `sidebar-sections` in local storage holds one flag per section,
  replacing `sidebar-tab`. Anything missing or unrecognised counts as open, so
  a fresh installation shows all three rather than an empty panel.
- Added: `detail.speakers.empty` and `detail.review.empty`. A section that is
  always present needs something to say when its list is empty. Removed:
  `detail.sidebar.reviewTab` and `detail.sidebar.notesTab`.
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` reports 753/753
  for English and no problems; rendered against the real stylesheet at 2× in
  both states — each icon's circle centre matches its heading's centre to the
  pixel, and no heading is truncated at the 320 px panel width.

### 2026-08-03 — The note unrolls instead of jumping

- Changed: hovering a clamped note now eases it open over 220 ms after a 90 ms
  delay, and eases it closed over 190 ms. It previously changed height in one
  frame, which is what made passing the pointer over the list feel violent.
- The 90 ms delay is the point: sweeping the pointer down the sidebar on the
  way somewhere else must not set every note in it moving.
- How: CSS can only ease between two lengths it knows, and the height of
  wrapped text is not one of them. `Detail` measures each note's `scrollHeight`
  — which reports the whole text even while the clamp is showing three lines of
  it — and hands it to the stylesheet as `--sticky-full`. A `ResizeObserver` on
  the list re-measures when the sidebar is resized or a note is rewritten, and
  writes only on change, since it is watching the list it can resize.
- The clamp itself is a discrete property: it is lifted 90 ms into opening and
  restored only once the height has finished shrinking, through
  `transition-behavior: allow-discrete`. Without it the ellipsis would vanish
  before the note moved and the note would snap shut instead of closing — which
  is what an older WebView2 will do, and is exactly today's behaviour, so the
  fallback is no worse than what it replaces.
- Files: `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: measured in the browser against the real stylesheet, sampling
  height every ~50 ms. Opening: 59 → 60 → 90 → 98 px, clamp still `3` at 50 ms
  and gone by 100 ms. Closing: 74 → 63 → 59 px, clamp back to `3` only after
  the last frame. A note that already fits stays at its height in every state.

### 2026-08-03 — Correcting entry: the notes section said it was empty twice

- What the user saw: `Zatím bez poznámek.` twice under `Poznámky`.
- Cause: the accordion was assembled by lifting the existing lists out of the
  two tab panels with a script. The captured range for the notes list ended at
  the empty state, and the template that received it added the empty state
  again. Type checking cannot see two identical paragraphs, and the harness
  used to verify the layout was hand-written markup, not the component — so
  neither guard could have caught it.
- Fixed: one empty state. The same pass also straightened the indentation the
  lifting left behind — the moved lists had their first line re-indented and
  their contents left at the old depth, which compiles and reads badly.
- Lesson: when markup is moved by a script, diff the result against what was
  moved. A screenshot of a hand-built copy of the layout only proves the CSS.
- Files: `src/Detail.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; one occurrence
  of `detail.notes.empty` remains in the component.

### 2026-08-03 — Speaker separation says when it happens

- Changed: `settings.speakers.description` is now `Rozdělí text mezi jednotlivé
  mluvčí už při prvním přepisu. U nahrávek s jedním mluvčím nemá využití.`
  English follows with `as part of the first transcription`.
- Why: the switch decides whether separation runs *inside* transcription. With
  it off, nothing happens automatically — but separation is still reachable
  afterwards from the sidebar and the AI dialog, so the old sentence described
  a feature rather than what the switch does. `už při prvním přepisu` is the
  part that was missing.
- Files: `src/locales/cs/settings.ts`, `src/locales/en/settings.ts`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — Phase A of the audit: nothing may quietly destroy work

The read-only audit recorded in `whisp-hodnoceni.md` produced five blocking
findings. All five are fixed here; each is its own entry below, because each
has its own reason. Two things the audit reported are **not** defects and were
withdrawn after checking the user's own machine rather than the working copy:
the bundle icons are a complete Tauri set with a real `MS Windows icon
resource`, and the project does have a git repository — with two commits and
39 paths of uncommitted work, which is a decision the user has taken, not an
oversight.

Found while comparing the two trees, and worth more than any of the findings:
`tools.rs` and `transcription.rs` on the user's disk were **behind this log**.
`usable_compute` and the automatic thread count had been written, verified and
recorded, and never delivered. The consequence is exactly the complaint that
started that work: an AMD machine with `compute = "cuda"` stored kept
transcribing on the processor. Compare checksums against the user's tree, not
against the copy the work was done in — the same lesson as the `package.json`
entry, learned in the other direction.

### 2026-08-04 — A transcript is deleted only once its replacement exists

- Fixed: `run` deleted the existing segments as its third statement, before
  `tools::check`, before the audio was converted, before anything had been
  verified. A missing model, a moved recording or a failing ffmpeg — the
  ordinary failures of this pipeline — therefore destroyed a finished,
  hand-corrected transcript, together with its manual edits (`upraveno`),
  signed-off spots (`overeno`) and speaker assignments. Nothing was kept.
- Changed: the delete moved into the write transaction at the end of the run,
  beside the inserts, guarded by the same rollback the diarization path
  already used. A run that produces nothing now leaves the old text alone.
- Changed: starting a transcription for a recording whose status is `hotova`
  asks first, with the destructive treatment. Deleting the transcript from the
  same menu has always asked; starting a new run destroyed the same thing on
  one click. The question is asked once for a whole batch and names the
  recording when there is only one.
- Consequence worth knowing: while a re-run is in progress the old transcript
  stays on screen under the progress bubble instead of the screen going blank.
  That is better than blank — it can still be read and played — but it is a
  visible change.
- Files: `src-tauri/src/transcription.rs`, `src/App.tsx`,
  `src/locales/cs/dialogs.ts`, `src/locales/en/dialogs.ts`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (62 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — Portability is a decision, not a folder that appeared

- Fixed: `is_portable()` counted a `bin` folder beside the executable. That
  folder is created by this application's own downloader, and the NSIS
  installer's default directory is `%LOCALAPPDATA%\Whisp` — exactly what
  `tools_root()` computes for an ordinary installation. So running the setup
  wizard made an installed copy look portable from the next launch onward: the
  archive moved from `%APPDATA%\cz.znackarna.whisp\whisp.db` to
  `%LOCALAPPDATA%\Whisp\data\whisp.db`, `CREATE TABLE IF NOT EXISTS` made that
  empty file a valid archive, and the Archive came up blank and plausible.
  On the reported machine `bin\` and `models\` are already sitting in
  `%LOCALAPPDATA%\Whisp`, so this was waiting for the first installed build.
- Changed: only `prenosna.txt` marks a portable copy, and `create_portable_copy`
  is the only thing that writes it.
- Added: `archive_to_open` looks at the other candidate before starting a new
  archive. If a `whisp.db` is sitting there, that one is opened and the choice
  is logged. An empty folder cannot be told apart from a first run, so the
  question has to be asked before the schema is created, not after.
- Fixed while there: the marker file still introduced itself as `Přemysl`, a
  name this application has not had for a long time.
- Files: `src-tauri/src/tools.rs`, `src-tauri/src/main.rs`,
  `src-tauri/src/download.rs`.
- Verified: `cargo test` (62 passed, three new: the mode's own place wins when
  it holds an archive, an archive elsewhere is adopted rather than replaced by
  an empty one, and a genuine first run still starts where it belongs).

### 2026-08-04 — Speaker recognition ends, and the player comes back

- Fixed: `diarizingIds` had one place that added to it and no place that
  removed it. The `transcription:complete` listener threw away the id the
  backend sends. So after a standalone speaker recognition the flag stayed up
  for the rest of the session: the progress bubble froze at 100 %, the
  recording's own actions stayed hidden, `Rozpoznat znovu` stayed disabled and
  — because the player is rendered only when nothing is running — **the
  recording could not be played until the application was restarted**. Going
  back to the Archive did not help; the flag lives in `App`. The failure path
  did not clear it either.
- Fixed with it: `liveSegments` was never cleared, so re-transcribing showed
  the tail of the *previous* transcript under a bar reading 2 %, then appended
  the new lines after the old ones — and it held the tail of every recording
  transcribed that session for the lifetime of the window.
- Changed: both terminal events run one `finishJob(id)`, and `runTranscription`
  clears the live tail beside the stale progress it already cleared.
- An earlier entry claimed this listener already did this. It did not; that
  claim is withdrawn here.
- Files: `src/App.tsx`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — Cancelling is about the job, not about a handle in a map

- Fixed: `cancel` reported success only if a `std::process::Child` happened to
  be in the registry, and the only thing ever registered was whisper. During
  preparation (up to four ffmpeg passes) and during speaker recognition
  (measured at 447 s for 45 minutes of audio) it therefore found nothing,
  answered "nothing is running", and `cancel_transcription` took that as its
  cue to **clear the cancellation the user had just asked for** and set the
  row back to `nova`. The run carried on, finished, and wrote its transcript,
  while the bubble kept advancing. And because the row said `nova`, `Přepsat`
  became available again while the first worker was still going.
- Changed: `TranscriptionTask` now tracks `running` — recordings with a live
  worker — separately from `processes`, which says what to kill. `cancel`
  answers from `running`, and never clears its own flag; only `cleanup` does,
  when the worker has actually finished.
- Changed: `processes` holds a list per recording rather than one handle.
  Inserting a second child used to drop the first without killing it, which is
  how an orphaned whisper could keep writing to the same output file while a
  second one started.
- Changed: the run checks between its stages, so a cancellation lands at the
  next boundary even when the program running at that instant is not killable.
  The preparation programs are deliberately still not registered: each is
  bounded and short beside whisper or sherpa, and the wait is seconds.
- Changed: sherpa is registered, so speaker recognition can be killed. Its
  bubble on Detail now offers a cancel — it previously offered none at all,
  by design, because there was no backend for it. A cancelled recognition
  leaves the recording `hotova`: it only ever rewrites who said what, and it
  writes at the very end.
- Changed: when nothing is running, the tidy-up sets `nova` only if the row
  still says `prepisuje`. It used to do that unconditionally, which would now
  demote a finished recording after a late cancel of its speaker recognition.
- Files: `src-tauri/src/transcription.rs`, `src-tauri/src/main.rs`,
  `src/Detail.tsx`, `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`.
- Verified: `cargo test` (62 passed, four new: cancelling between programs
  still stops the run and keeps its flag, a finished run reports nothing to
  cancel, a new run does not inherit the previous cancellation, and every
  program of a run is kept rather than only the last — the last one spawns
  real child processes through `current_exe`, so it holds on Windows too).

### 2026-08-04 — Backups are kept by day, not by launch

- Fixed: `list_backups` filtered on the `.db` extension alone and sorted by
  the file's modification time, and everything past the newest three was
  deleted on every start. For an application opened far more often than it is
  left running, four launches in one morning could overwrite every copy of
  yesterday's good state — the recovery window was measured in launches, and
  could be minutes wide, while Settings promised "the newest three". A
  hand-parked `whisp-pred-upgradem.db` in that folder was treated as ours and
  deleted on the fourth launch.
- Changed: only `whisp-YYYY-MM-DD-HHMMSS.db` is listed, ordered by the stamp
  in the name rather than by a filesystem time that a copy or a restore can
  rewrite. Retention keeps the newest three whatever their date, plus the
  newest backup of each of the last seven days.
- Changed: the Settings description says so.
- Files: `src-tauri/src/db.rs`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`.
- Verified: `cargo test` (62 passed, three new: several launches in one day do
  not reach an older day, days beyond the window are discarded, and a file the
  user parked there is not ours to rotate).

### 2026-08-04 — The dictionary has a page

- Added: a fifth Settings tab, `Slovník`. The backend has had `dictionary`,
  `add_dictionary_entry`, `delete_dictionary_entry` and `apply_dictionary`
  since the beginning, and the only place anyone could reach them was the
  bubble that appears after a manual correction. An entry could be created and
  then never seen, changed or removed again.
- Layout: a new entry is two fields with an arrow between them, so it reads as
  the sentence it is — this comes out of the recording, that is what it should
  say. The list below repeats the same three columns, and each row is editable
  in place, saving on blur or Enter.
- Added: `update_dictionary_entry`, so an entry can be corrected rather than
  deleted and written again — including its hint flag, which is a button on the
  row rather than a menu, because it is a state with two values.
- Copy: `Napovědět předem` explains the part that is not obvious — a hinted
  term is handed to Whisper before it starts, which usually prevents the
  mistake rather than repairing it, but a long list of hints dilutes them.
- Not added: applying the dictionary to existing transcripts from here.
  `apply_dictionary` takes one recording, and doing it for the whole archive
  from Settings would be a batch job with its own progress and failure modes.
  The detail screen already offers it per recording.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/api.ts`,
  `src/locales/cs/settings.ts`, `src/locales/en/settings.ts`,
  `src-tauri/src/db.rs`, `src-tauri/src/main.rs`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; `cargo test`
  (66 passed); the page rendered against the real stylesheet at 2× with three
  entries, one of them hinted.

### 2026-08-04 — The transcript has a context menu

- Added: right-clicking the transcript opens the application's own menu
  surface where the pointer is, with five actions. The word that was pointed
  at carries its own moment (`data-time`), so `Přehrát odsud` and
  `Poznámka k mm:ss` mean exactly there rather than the start of the block.
- Actions: play from here; copy (the selection, or the whole block when there
  is none); fix text; a note pinned to that moment, which also opens the
  sidebar and its notes section; and transcribing that part again.
- Why these: clicking a word seeks and double-clicking edits, and neither is
  discoverable — the Quick Tips strip exists because of it. The menu says out
  loud what the transcript can do.
- Deliberately left out, after asking: adding the pointed-at word to the
  dictionary, and reassigning the speaker of a block. Both are good ideas and
  neither is built.
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the menu
  rendered against the real stylesheet at 2× over a real transcript block.

### 2026-08-04 — One part of a transcript can be redone with the best model

- Added: `retranscribe_region(id, from, to)`. It cuts the audio for that range
  with `-ss`/`-to` before `-i` (seeking the input rather than decoding and
  discarding), runs whisper over the slice with the most accurate model
  installed, shifts the result — including every word timing — back into the
  recording's own timeline, and replaces only the blocks the range touches.
- Why: the ordinary run is one model over a whole recording, chosen for speed
  as much as accuracy. When it garbles a paragraph, redoing that paragraph
  costs seconds where a whole re-run costs tens of minutes, and everything
  corrected by hand elsewhere survives.
- Model choice: `tools::best_model` ranks what is on disk by family, then
  penalises turbo and quantization — the right defaults for a whole recording
  and the wrong ones for a paragraph being redone deliberately. English-only
  models are skipped unless the recording is English, where they win.
- Boundaries: whole blocks, never halves. The range grows to the edges of
  every block it touches, and 0.6 s of audio is taken along on each side so
  the slice does not start mid-word — text landing in that padding is dropped
  by comparing midpoints, so it cannot duplicate a neighbour.
- Speakers: each new block inherits the speaker of the old block it stands in.
  Deciding who speaks is diarization's job and it runs over the whole
  recording; guessing it from one paragraph would be worse than inheriting.
- Safety: the write is one transaction with a rollback arm, the same shape as
  the two beside it. A run that hears nothing keeps the original text and says
  so. The confirmation names the range, and takes the destructive treatment
  when the range contains manual edits or signed-off spots — which it will
  destroy, and that is the one thing about this feature worth a warning.
- Files: `src-tauri/src/transcription.rs`, `src-tauri/src/tools.rs`,
  `src-tauri/src/main.rs`, `src/Detail.tsx`, `src/api.ts`,
  `src/locales/cs/{detail,errors,progress}.ts`,
  `src/locales/en/{detail,errors,progress}.ts`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (66 passed, four new over the model ranking: the full model beats turbo and
  quantized ones, a smaller family never wins over a bigger one, English-only
  models are skipped for a Czech recording and chosen for an English one, and
  nothing installed means no better model); `npx tsc --noEmit`;
  `node scripts/i18n.mjs check`.
- Not verified here, and it needs the running app: an actual re-transcription
  against real audio. The splice is arithmetic that reads correctly and has no
  test over real whisper output, because that needs a model and a recording.
  Try it first on a recording whose transcript you do not mind losing.

### 2026-08-04 — The dictionary page is built from Settings' own parts

- Supersedes the layout in the entry above. It had a tinted panel around the
  composer, its own paddings, and a list whose columns did not line up with
  the fields that made them — a pattern that exists nowhere else in this
  application, which is exactly how it read.
- Changed: the new entry is an ordinary `.pole` with a `.radka` that ends in
  its action, like the watched folder. The hint switch is `SettingsToggle`,
  which brings the divider and the 24/22 rhythm the rest of Settings uses. The
  saved entries follow after the same divider.
- Changed: the composer and the saved rows share one grid — two halves, the
  arrow between them, and a trailing column of fixed width. Without that
  shared width the button and the row's two marks pulled their halves apart by
  17 px, which is what made the spacing look wrong. Measured after: both the
  arrow and the second half align to the pixel.
- Changed: a saved row is edited in place with the same treatment as a speaker
  name — no box until the pointer or the keyboard arrives. Its own hover
  background is gone; two nested surfaces said nothing the row did not.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; rendered against
  the real stylesheet at 2× and measured — field 38 px, saved row 34 px, both
  starting at the same left edge, 24 px between groups, arrow delta 0.

### 2026-08-04 — What the hint does, said as what it gives

- Changed: `Napovězený výraz zná přepis dopředu, takže chybu často vůbec
  neudělá. Dlouhý seznam nápověd ale ztrácí sílu, tak ho nech jen u toho, na
  čem záleží.` is now `Napovězené slovo přepis většinou trefí rovnou a není co
  opravovat. Napovídej u jmen a výrazů, na kterých ti záleží.`
- Why: the first version explained the mechanism — the model knows the word in
  advance, hints dilute each other — which is true and is not what the reader
  needs. What they need is what they get: the word comes out right, and there
  is nothing to fix afterwards. The second sentence is now advice in the
  imperative rather than a caveat about lists losing force.
- Copy rule worth keeping: an explanatory note says what the option gives the
  person, not how it works inside. Reach for the mechanism only when it
  changes what they should do.
- Files: `src/locales/cs/settings.ts`, `src/locales/en/settings.ts`.

### 2026-08-04 — Two corrections on the dictionary page

- Copy: the hint note is the user's own wording — `Napovězené slovo většinou
  přepis trefí rovnou. Napovídej u jmen a slov, na kterých ti záleží.`
  Supersedes the sentence recorded immediately above; `a není co opravovat`
  said the same thing twice, and `výrazů` is a bigger word than the thing
  needs.
- Fixed: `Nový záznam` sat 8 px above its row. That is the shared distance
  between a label and one field, and above a row three times as wide it reads
  as crowded. It is now 14 px, and it had to be written as the label's own
  bottom margin: sibling margins collapse, so a `margin-top` on the row lost
  to the 8 px already above it every time.
- Scope: the override is keyed to `.pole:has(> .dictionary-row)`. Every other
  field in Settings keeps the shared 8 px.
- Files: `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; measured in the
  browser against the real stylesheet — label to row 14 px.

### 2026-08-04 — Correcting entry: re-transcribing a part left the old text underneath it

- What the user saw: after transcribing one part again, most of it looked
  gone. Measured in their own archive instead of guessed at — the words were
  not gone, they were doubled and out of order, which reads as worse than
  missing.
- Evidence, from `whisp.db` with its WAL replayed (the first look was at the
  stale `.db` alone, which is 19 hours behind in WAL mode — check the `-wal`
  file or you are reading yesterday):

  ```
  #16  84.45– 85.11  We agree.
  #17  84.61– 89.85  we agree, we agree, but they've got no strategy to outwork it…
  #18  85.11– 85.81  Yeah, we agree.
  #19  89.85– 97.42  the week. So. So the more you know…
  #20  96.82–100.66  sirmons, more content, and move on from where you've been
  #22 102.51–105.35  they've even outworked what you're currently doing. That's the
  #23 104.73–105.93  That's the temptation.
  ```

  Five overlapping pairs in the whole recording, all of them between 84 s and
  106 s — exactly the part that was redone. Everywhere else: none.
- Cause, and it is mine: whisper is handed 0.6 s of audio on each side of the
  region so it does not start in the middle of a word, and it transcribes that
  audio too. The old rule kept any fresh block whose *midpoint* fell inside the
  region — untouched, with its original times. A block straddling the boundary
  therefore came in whole, repeating words that the neighbouring block still
  holds and overlapping it in time.
- Not the cause, checked before being believed: input seeking. `-ss` before
  `-i` was measured against a sample-accurate reference on an AAC/MP4 built
  from the user's own audio — both input and output seeking landed on the same
  sample, offset 0.0 s. The suspicion was reasonable and wrong.
- Fixed: `trim_to_region` cuts a fresh block down to the region rather than
  judging it whole. With word timings the cut is exact — the run-up words are
  dropped and the text is rebuilt from what is left; without them the block is
  clamped. Anything with nothing inside the region is discarded.
- Fixed: `region_bounds` grows the region to the edges of every block it
  touches, and then to the edges of anything *those* touch. Without that
  second pass an already-overlapping neighbour — which this defect produced —
  would survive the delete and sit under the new text saying the same words
  again.
- Repair for an archive that already has this: run the same spot again. The
  overlapping blocks all intersect the region, so they are replaced together
  and the seam comes back clean.
- Files: `src-tauri/src/transcription.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (73 passed, seven new ones built from the numbers above). The three that
  describe the new behaviour were then run against the old midpoint rule and
  all three failed; the other four passed in both directions.

### 2026-08-04 — A worker thread may not fail silently

- What happened: transcribing a part again did nothing at all — no progress,
  no error, and measured in the user's own archive, no write. The binary had
  been rebuilt with the splice fix twenty minutes earlier, so the fix was in
  the running program; the run simply never reached the database.
- Changed: `run`, `run_region` and `run_diarization` are called through
  `without_panicking`, which turns a panic into an ordinary reported failure —
  code `unknown`, panic text in `detail` — so it reaches the notice bar
  instead of a console nobody has open. A panic is still a bug; it is now a
  visible one.
- Changed: a region run announces itself before any work — the first status
  event used to arrive only after ffmpeg had finished, so anything failing in
  between left the interface with nothing to show. It also prints the range
  and the model it chose to stderr, which is the line to look for in the dev
  console when this misbehaves again.
- Still unexplained, honestly: with the archive untouched and no error on
  screen, the cause is not yet known. This entry makes the next attempt
  report something rather than guessing at what it was.
- Files: `src-tauri/src/transcription.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (73 passed).

### 2026-08-04 — Correcting entry: what the screenshots showed, and the hole they exposed

- The user sent a before/after pair of the block at 2:57. Before: three blocks,
  the middle one whole. After: the block above it had lost its first thirteen
  words (`You could say to your congregation, we're not going to move on to the
  next` — the timestamp stayed 2:40), the redone block began mid-sentence at
  2:58 (`know, people always say…`), and a new 3:03 block carried the rest.
- Measured, not assumed: the archive **does not contain that state**. With the
  WAL attached, 150–200 s still holds the original blocks — 159.86 whole,
  177.18 whole — and no table anywhere holds the new wording. The raw file does
  contain those phrases in freed pages, i.e. they were written and then
  undone. Both backups written since (21:07 and 21:16) hold the original text
  as well.
- What that means: a run wrote the region, the interface reloaded and showed
  it, and afterwards the archive was back to the state before it. The most
  plausible mechanism, and a hole that exists regardless: **two region runs
  clobbering each other.** Each starts by reading every segment of the
  recording; the second to finish writes its own `existing` — the state from
  before the first one — back over the result. The earlier attempts that
  "did nothing" are exactly what a second run would look like.
- Why two runs were possible: `retranscribe_region` refused only when the row
  said `prepisuje`, and a region run **never set that status**. The frontend
  set it locally, so its own screen looked busy while the archive did not.
- Fixed: `run_region` marks the recording `prepisuje` before it starts, like
  every other run; the command additionally refuses when `TranscriptionTask`
  already has a worker for that id — the registry knows the instant a worker
  starts, the row only once it has said so; and the menu item is not offered at
  all while something is running on that recording.
- Added: `errors.unknown` renders `{detail}`, so the panic text the new guard
  produces reaches the notice bar instead of the bare word `unknown`.
- Honest limit: the clobbering is inferred from the evidence, not observed. If
  the next attempt still ends with the archive unchanged, the `region:` line in
  the dev console and the notice bar will say what actually happened — neither
  existed when this was reported.
- Files: `src-tauri/src/transcription.rs`, `src-tauri/src/main.rs`,
  `src/Detail.tsx`, `src/locales/cs/errors.ts`, `src/locales/en/errors.ts`,
  `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (73 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — Transcribing one part again is removed

- Removed: `retranscribe_region`, `start_region_in_thread`, `run_region`,
  `region_bounds`, `trim_to_region`, `shift_segment`,
  `tools::convert_range_to_wav`, `tools::best_model`, the menu item, the
  confirmation, and every string the feature owned. About 470 lines of Rust,
  its tests, and eleven keys. The context menu keeps its four other actions.
- Why, and it is the user's call made on evidence rather than taste:
  1. **It offered the same model.** `best_model` picks the most accurate file
     on disk; this machine has `large-v3`, and the recording in question was
     already transcribed with `large-v3`. Redoing a part therefore ran the
     identical model over the identical audio.
  2. **With less context, so plausibly worse.** Whisper conditions on what it
     has already heard; a twenty-second slice starts cold. The user's own
     before/after shows it — the redone block began mid-sentence and produced
     `sirmons` where the original run, which had the preceding minutes, had
     `sermons`.
  3. **It was the only feature that rewrites a finished transcript**, and in
     two days it damaged a real archive twice: overlapping duplicated blocks
     from the midpoint rule, then a state that never survived in the archive
     at all.
- Where it would have earned its place, for whoever reads this later:
  transcribing everything with turbo for speed and redoing the garbled
  paragraphs with `large-v3`. That is a real workflow — it is simply not this
  user's, who runs the largest model over everything from the start. If it
  comes back, it must be offered *only* when a strictly more accurate model
  than the one that produced the transcript is installed, name that model in
  the dialog, and give whisper a much longer run-up than 0.6 s.
- Kept from that work, because both are good regardless: `without_panicking`
  around all three workers, and `errors.unknown` rendering `{detail}` so a
  panic reaches the notice bar. Also kept: the busy guard now on every run —
  `TranscriptionTask::is_running` is public and consulted before starting.
- Files: `src-tauri/src/transcription.rs`, `src-tauri/src/tools.rs`,
  `src-tauri/src/main.rs`, `src/Detail.tsx`, `src/api.ts`,
  `src/locales/{cs,en}/{detail,errors,progress}.ts`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (62 passed — the 73 minus the eleven that covered the removed code);
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` reports no problems and no
  stale keys; a grep for `region` across the source finds nothing.

### 2026-08-04 — The dictionary's hint is a switch

- Changed: the `napovídá` pill on each saved row is the application's own
  switch, like every other yes/no in this interface. It was a button with
  `aria-pressed` styled as a badge — which reads as a state you look at, not
  one you can change.
- Changed with it: the word moves out of the rows and above the column, once.
  A label repeated down a list is what made the pill look like a badge in the
  first place. Each switch keeps an accessible name that includes its own
  entry (`Napovědět předem u „součas DNA“`), so the column heading is not the
  only thing naming it.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; rendered against
  the real stylesheet at 2×.

### 2026-08-04 — Technical details are a list, not a table of ticks

- Changed: each row in `Technické podrobnosti` is `mark · what it is · where
  it is`. The tick is the same 22 px circular mark the manual download list
  uses for a component already on the machine; a missing one takes the warning
  colour in the same circle. The tick used to be a `✓` character glued to the
  label through `::before`, at the label's own weight and colour.
- Changed: the path is set in the monospace family — a path is not prose, and
  a fixed pitch makes the folder names line up down the column. The whole path
  is in the tooltip, because the line shows only its end.
- Kept, and worth knowing why: `direction: rtl` on the path so the ellipsis
  falls at the *beginning*. The end of a path is what says which file this is.
  `unicode-bidi: plaintext` was tried and reverted — it re-derives direction
  from the content and moves the ellipsis back to the end, cutting the file
  name off.
- Files: `src/Settings.tsx`, `src/styles.css`.
- Verified: `npx tsc --noEmit`; rendered against the real stylesheet at 2×
  with all eight rows plus a missing one.

### 2026-08-04 — The saved dictionary gets a header; the note gets its gap

- Changed: the list of saved entries is headed. Two bare words and a switch
  gave the reader nothing to say which half is the error and which is the fix;
  the header names all three columns (`Co přepis slyší · Jak to má být ·
  Napovídá`) using the strings the fields already carried as accessible names,
  so the visible and the spoken label are the same words. It sits on the row
  grid, so a heading cannot drift off its column, and it is `aria-hidden` —
  the fields keep their own labels, and a screen reader would otherwise hear
  each heading twice.
- Replaced: `settings.dictionary.promptBadge` → `settings.dictionary.columnPrompt`.
  Same place on screen, but it is a column heading now, not a badge, and the
  key should say so. Sentence case in the source; the uppercase is the CSS's.
- Changed: 16 px between the switch and the delete cross, up from 4. One is a
  setting you flick, the other throws the row away; four pixels apart they
  were one control.
- Fixed: the note under the watch-folder file list had no gap at all.
  `.watch-folder-notice > .settings-info-note` asked for 12 px, but
  `.settings-info-note.compact { margin: 0 }` is written later at the same
  specificity and won — so the note sat directly on the panel's border. The
  selector now names `.compact` too, and the gap is 20 px. It stays 16 px from
  the footer rule below it, which is right: the sentence is about what
  `Ignorovat` does.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/Library.tsx` (unchanged —
  the note's markup was already correct), `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (778/778, no
  stale keys); rendered against the real stylesheet at 2× and measured — the
  headings start on the same pixel as the text of the fields below them, the
  `Napovídá` heading ends on the switch's right edge, and the note sits 20 px
  under the file panel.

### 2026-08-04 — Backups are one panel; the dictionary drops the small caps

- Changed: the backup block is one panel of three rows — when, how many,
  where — with a rule between each. It was a pair of loose lines at 6 px
  apart plus an orphan monospace path underneath that nothing named; three
  fragments about one thing. The folder is a row like the others now, so its
  value lines up with the date and the count above it (measured: all three
  flush on the same pixel).
- Changed: the path is a button. Nobody reads a path for its own sake, they
  read it to go there; clicking reveals the folder in the system's file
  manager through `revealItemInDir`. No new dependency and no new capability —
  `@tauri-apps/plugin-opener` was already in `package.json` and
  `opener:default` already grants `allow-reveal-item-in-dir`.
- Kept from the old rule: `direction: rtl` so a long path loses its beginning,
  not its end, with `bdi` inside so the text still reads left to right.
- Removed: `.udaje`, which had no other user.
- Changed: the dictionary's column headings are sentence case at 12 px. They
  were 11 px uppercase with letter-spacing — a treatment this application uses
  for step numbers and panel headers, but never over data, and Jakub read them
  as coming from somewhere else. A column heading is not a different kind of
  thing than the section title above it.
- Changed: `settings.dictionary.promptNote` is one sentence again —
  `Napovídej u jmen a slov, na kterých ti záleží.` is gone. The first sentence
  says what the switch does; the second told the reader how to feel about it.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (780/780);
  rendered against the real stylesheet at 2× in both colour schemes, and the
  three backup values measured to the same right edge.

### 2026-08-04 — The dictionary's second hint switch is gone

- Removed: the `Napovědět předem` switch that sat between the composer and the
  saved list. It was not a master switch over the `Napovídá` column, which is
  what its position and its name said — it only chose the initial value for
  the *next* entry, lived in component state, was stored nowhere and reset on
  every remount. Two controls with the same name doing different things is why
  the column read as broken.
- Changed: a new entry hints. That was the default the removed switch offered
  anyway, and the row's own switch appears the moment the entry does, so
  turning it off is one click in the place you are already looking.
- Moved: the sentence that switch carried (`Napovězené slovo … trefí rovnou`)
  is now the third sentence of the tab's description, where the reader starts.
  The three columns are each explained once, at the top, and nothing floats
  between the composer and the list any more.
- Removed with it: `settings.dictionary.promptNote`, now unused.
  `settings.dictionary.prompt` stays — it is the row switch's tooltip.
- Files: `src/Settings.tsx`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (779/779, no
  stale keys).
- Not fixed, worth knowing: `build_prompt` joins every hinted term into one
  string with no cap. Whisper's prompt window is 224 tokens; past that
  whisper.cpp keeps only the tail, so with a long dictionary the earliest
  entries stop hinting and nothing in the interface says so.

### 2026-08-04 — Uncertain spots are fixed where they are listed

- Changed: double-click on a row in `Nejistá místa` opens the text right
  there. Single click still travels to the spot; the gesture is the same one
  that opens a segment in the transcript, so there is nothing new to learn.
  Enter saves, Escape throws the draft away, clicking elsewhere saves.
- The point: the panel says which places are worth checking. Making the reader
  travel to the transcript and back for each one turned a list of small chores
  into a list of interruptions.
- Saves through the transcript's own `saveText`, not a second path to the
  database. That is what makes the transcript, the dictionary suggestion and
  the improved document's stale flag all react as if the edit had happened
  down there. `saveText` also marks the segment checked, so a fixed row leaves
  the list — which is what a worklist should do. A save that changes nothing
  returns early and the row stays, correctly.
- `editingUncertain` is its own state, not the transcript's `editing`. Both
  lists show the same segment; one shared id would open two textareas over one
  record and let whichever blurred last win.
- Escape: the field stops the event before the window handler sees it, and
  sets a flag the blur handler reads — otherwise cancelling would save the
  draft it is meant to discard, because Escape blurs the field on its way out.
- The open row keeps the read row's geometry — time in the same column, text
  starting on the same pixel (measured: 47 and 85.9 in both states) — and is
  recessed onto `--pozadi` with a hairline, because `--tlumene` already means
  hover and "currently sounding".
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; rendered against
  the real stylesheet at 2× with a row open beside a read row and the active
  row, and the two columns measured to the same pixel.
- Known limit: opening the editor is pointer-only, exactly as in the
  transcript. Keyboard users reach the same edit through the transcript's
  context menu.

### 2026-08-04 — The uncertain-spot field is the application's field

- Corrected the entry above: the open row was a 12 px `--r-karta` box with a
  one-pixel shadow ring around the time *and* the text, and the text itself
  had no field at all. That shape exists nowhere else here — it read as
  angular beside every real input.
- Changed: the field is the textarea, and it is the one this application
  already uses for multi-line text — `--r-maly` corners, a one-pixel accent
  border, `--prstenec-pole`. Exactly `.segment.upravuje textarea` in the
  transcript and `.sticky-editor` in a note. The time stays outside it, in its
  own column, and is padded by the field's border plus padding (1 + 7) so its
  line sits on the first line inside the field.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: rendered against the real stylesheet at 2× in both colour schemes,
  beside a read row and the currently-sounding row; the time's line box and
  the field's first line centre within 0.2 px.

### 2026-08-04 — `Nejistá místa` → `Slabá místa`

- Changed: the sidebar section, its empty state and the Tab tip in the quick
  tips strip. The list is named after what the reader does with it, not after
  the state the machine was in. English follows: `Weak spots`.
- Files: `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`,
  `src/locales/cs/dialogs.ts` (a context note that still said `nejistá`),
  `CLAUDE.md`.
- Unchanged on purpose: `detail.review.*` key names and `uncertainSegments` in
  the code. They describe the condition the segment is in — a low confidence
  score — which is still exactly what it is. Renaming keys to match a caption
  would churn every locale file for nothing.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; a grep for
  `nejist` across the locales finds only the sentences that describe the
  machine's state, never the caption.

### 2026-08-04 — The hint is gone; the sidebar lists what you corrected

Two changes, one decision. Jakub asked what the dictionary hint was worth once
the replacement already fixes the word everywhere, and the honest answer was
"almost nothing the reader can see". It is removed, and the sidebar gets the
thing he actually wanted in its place: what *this* transcript was corrected on.

**The hint is removed.**

- Removed: the `Napovídá` column, the switch on every row, `build_prompt`, and
  the `--prompt` flag. Whisper is no longer told anything in advance.
- Why: the outcome on screen was the same either way, because `apply_dictionary`
  rewrites the word in every segment after transcription regardless. The hint's
  only real gain was second-order — a name heard right the first time does not
  drag its neighbours down or lower the segment's confidence. Against that: a
  column, a switch, a tooltip and a concept, plus a documented failure mode
  where a long comma-separated list leads the model to hear those words where
  they were not said.
- And it barely worked. Measured against the whisper.cpp source rather than
  guessed at: without `--carry-initial-prompt` the initial prompt goes into the
  *rolling* context (`prompt_past1`), which is cleared and refilled from the
  decoded tokens after every window (`whisper.cpp:7612`). The dictionary
  therefore conditioned roughly the first 30 seconds and nothing after it. On
  top of that, `--max-context 64` caps the budget at `min(64, 224)` and takes
  the *last* 63 tokens (`whisper.cpp:7127`) — about 12–18 Czech terms, with the
  oldest silently dropped.
- Fixing it was possible and was rejected: `--carry-initial-prompt` plus
  `--max-context 64 + prompt` would have given the dictionary its own room
  while the previous sentence kept its 63 tokens. That is three flags and a
  token estimator in service of a difference nobody sees.
- Data: `slovnik.napoveda` stays in the schema, unread, with its default. SQLite
  cannot drop a column without rebuilding the table, and keeping it means a
  fresh archive has the same shape as an old one. `DictionaryEntry.prompt` is
  gone from Rust and TypeScript, and from both commands.

**Corrections are listed per transcript.**

- Added: a fourth sidebar section, `Opravy`, between `Slabá místa` and
  `Poznámky`. Every segment this recording was rewritten by hand, in transcript
  order, as `před → po`. Clicking a row travels to the spot.
- Added: `segmenty.puvodni`, written by `update_segment` as
  `puvodni = COALESCE(puvodni, text)` — the first rewrite records what the
  machine wrote and every later one leaves that record alone. The interesting
  comparison is always against the transcript, never against the previous
  attempt at fixing it.
- `describeEdit` narrows the row to the single word when the rewrite kept the
  same number of words and changed exactly one. Anything else — a word added, a
  clause rebuilt — cannot be reduced without lying about it, so both versions
  are shown whole and clamped to three lines.
- Segments edited before this column existed have no `puvodni`. They are still
  listed, showing only their current text: hiding a correction the reader made
  would be stranger than showing it without its before.
- The list and `Slabá místa` now share one row shell in the stylesheet. They are
  the same object — a time, a line of text, click to travel — and two copies of
  those rules would have drifted.
- Added: `edits` in `src/icons.tsx`, a nib-down pencil on the shared 24×24 grid.
- Not built, and worth considering later: an `add to dictionary` action on a
  row. The suggestion bubble after a single-word edit already offers it once;
  this list is where someone would go back and change their mind.
- Files: `src-tauri/src/db.rs`, `src-tauri/src/main.rs`,
  `src-tauri/src/transcription.rs`, `src/Detail.tsx`, `src/Settings.tsx`,
  `src/icons.tsx`, `src/api.ts`, `src/types.ts`, `src/styles.css`,
  `src/locales/{cs,en}/{detail,settings}.ts`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (62 passed — the in-memory schema in the sentence-layout test needed the new
  column, which is the one place a fixture duplicates the real `CREATE TABLE`);
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` reports no problems and no
  stale keys; the corrections list rendered against the real stylesheet at 2×
  with a one-word change, a whole-segment change, and a row with no stored
  original.

### 2026-08-04 — A corrected word is underlined where it stands

- Changed: words a human rewrote carry a dashed underline in the transcript,
  and the same mark in the sidebar's `Opravy` list wherever a row shows both
  versions whole. Dashed and quiet, against the dotted warning-coloured line an
  uncertain block wears: an uncertain place is a question, a correction is an
  answer. The two can never appear on one block — correcting a segment marks it
  checked — so the decorations cannot stack.
- Underline rather than a highlight: the transcript is set to be read, and a
  background down a paragraph would fight the text for attention.
- `changedWords` walks a longest-common-subsequence table rather than comparing
  position by position. Correcting one word into two, or dropping a word, shifts
  everything after it, and a naive compare would then mark the whole rest of the
  sentence. Words are compared exactly, so an added comma counts as a
  correction — because it is one. Bailed out past 400 words a side; the table is
  quadratic and a block that long is not a hand correction.
- Index alignment: a manual rewrite clears the stored word timings, so the words
  rendered in the transcript are always the plain whitespace split — the same
  one the diff walks. That is what lets an index from one address the other.
  The ordinals are counted once per segment rather than recounted inside the map.
- Changed: the trailing `✎` appears only when nothing in the line is underlined
  — a segment edited before the archive kept originals. Otherwise it repeated
  what the marks below the words already say.
- Not marked: a word that was *removed*. There is nothing left to underline, and
  the sidebar row shows the before in full.
- Files: `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; `cargo test`
  (62 passed); rendered against the real stylesheet at 2× in both colour
  schemes — a one-word correction, a two-word one, and an uncertain block beside
  them, so the dashed and the dotted lines could be told apart at reading size.

### 2026-08-04 — Two typos in the dictionary suggestion

- Fixed: `Přidat to slovníku` → `Přidat do slovníku`. Listed as open in the
  localization entry from 2026-08-03 and in the English-translation entry after
  it, where it was deliberately not carried over; it is now fixed at the source.
- Fixed: the prompt closed its quotations with a straight `"` while every other
  Czech string in the file uses `„…“`.
- Files: `src/locales/cs/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — `Slabá místa` → `Kontrola`, an eye, and pill rows

- Supersedes `Slabá místa` from earlier today, which was itself one day old.
  One word, a noun like every other section in the panel, and it pairs with
  `Opravy` directly below it: *Kontrola* is what is left to go through,
  *Opravy* is what has been gone through. One piece of work in two states.
- Why not the alternatives Jakub weighed: `Návrhy na opravu` promises a
  suggestion the application does not have — it flags a place, it does not know
  a better wording. `Sporná slova` is wrong twice: they are segments, not words,
  and nothing is in dispute; the machine simply hesitated.
- Why `Kontrola` is safe now although it was rejected before: that rejection was
  about the *tab*, which also held the speakers list, so the word described half
  a panel. Over this one list it is exact, and in a text context Czech reads
  `kontrola` as `kontrola pravopisu`, not as supervision.
- Copy: empty state `Přepis nemá co kontrolovat.`, Tab tip `další místo ke
  kontrole`. English: `Review`, `There is nothing to check in the transcript.`,
  `next spot to check`.
- Changed: the icon is an eye. The question mark in a circle named the machine's
  doubt, which is the thing the new name deliberately stops doing; an eye asks
  for a reading pass rather than announcing a verdict. Renamed `uncertain` →
  `review` in `src/icons.tsx`, since the key meant the old caption. No eye
  existed anywhere — the sidebar show/hide button is a panel glyph, so there is
  no collision with a visibility toggle.
- Changed: the rows in `Kontrola` and `Opravy` take `--r-pilulka` instead of
  `--r-karta`, and 10 px of side padding instead of 8 so the first character
  stays clear of the curve. A row here is a control the pointer picks up, not a
  card.
- Worth knowing: a three-line row in `Opravy` — both versions of a long segment
  shown whole — becomes a rather round blob when highlighted, because the
  browser scales the radius to half the box. One and two-line rows, which is
  nearly all of them, read as proper pills. Capping the radius at 22 px would
  keep the pill on short rows and give tall ones a soft corner instead; say the
  word.
- Files: `src/icons.tsx`, `src/Detail.tsx`, `src/styles.css`,
  `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`,
  `src/locales/cs/dialogs.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; both sections
  rendered against the real stylesheet at 2× in both colour schemes, with one,
  two and three-line rows highlighted so the radius could be judged at each.

### 2026-08-04 — Correcting entry: the sidebar rows are menu items, not pills

- Supersedes the pill radius in the entry above. Jakub's read is right and mine
  was not: a full lozenge says *one standalone control*, and these are a column
  of siblings you run down picking one — which is a menu.
- Changed: `Kontrola` and `Opravy` rows take exactly `.nabidka-akci-seznam
  button`'s shape — `--r-karta` and 12 px of side padding. Not a number chosen
  for these lists; the number the action menus already use.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: rendered against the real stylesheet at 2× in both colour schemes
  with one, two and three-line rows highlighted. The three-line blob the entry
  above flagged is gone with the pill that caused it.

### 2026-08-04 — The row lights up, tick included

- Changed: the highlight moved from the inner text button to the whole `li`, so
  a hovered or currently-sounding row includes its own tick. It used to stop
  short of it, which made the row look cut off before its own action — the
  thing that read as "not the right shape" whatever the corner radius was. The
  inner button no longer paints a surface; a second one inside the first would
  only show as a rectangle within a rectangle.
- `:has(> button.aktivni)` carries the sounding state up to the row.
  `:has` is already used in this stylesheet, so the support question is settled.
- Changed: the tick's own hover surface. At 10 % white it was invisible on a row
  that is already tinted; it now takes `--akcent-svetly` with `--akcent`, the
  circular icon-surface pair used everywhere else here — which also says what
  the click does, rather than only that something is under the pointer.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: rendered against the real stylesheet at 2× in both colour schemes,
  with a row hovered, a row sounding, and the tick hovered inside a lit row.

### 2026-08-04 — The Archive footer says what happens next

- Added: a right-hand group in the Archive status footer — the watched folder
  and the model new transcripts will use. The left side says what the archive
  *holds*; the right now says what will happen to the next recording, where it
  arrives from and which model will read it. Both are standing settings, which
  is what a status strip is for, and neither was visible anywhere outside the
  Settings tab that sets it.
- The folder shows its own name, not its path: a 30 px strip cannot hold
  `C:\Users\…`, and the name is what the reader recognises. `FooterStatusItem`
  gained an optional `detail`, so the whole path is in the tooltip and in the
  accessible name while the visible value stays short.
- Only when it applies: the folder item is absent when watching is off, exactly
  as the Detail footer omits a language it does not know.
- No visible `Sledovaná složka:` prefix, though Jakub wrote it that way. Every
  other item in both footers is icon plus value with the label in the tooltip,
  and a visible label here would be the only one — and would spend a third of
  the strip on a word the folder icon already says.
- Added: a `folder` icon to `RecordingMetadataIcon`, on its 16-grid at 1.4
  stroke like its siblings.
- Files: `src/App.tsx`, `src/RecordingMetadataIcon.tsx`,
  `src/locales/cs/app.ts`, `src/locales/en/app.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the footer
  rendered against the real stylesheet at 2× in both colour schemes at the
  window's real width.

### 2026-08-04 — Both sidebar actions carry an icon

- Changed: `Rozpoznat mluvčí` takes the shared `speakers` glyph at 15 px, as
  asked.
- Changed with it, and this was not asked for: `Přidat` in the notes header
  takes the same 15 px round-capped plus the header's `Nový přepis` uses, and
  the `+` that used to be typed into `detail.notes.add` is gone from the string.
  One of two sibling actions carrying a real icon while the other carries a
  character would read as unfinished — the same reasoning as the section
  headings. Say the word and the notes half goes back.
- `.sidebar-text-action` is a flex row with a 6 px gap; both actions keep the
  panel's right edge (measured: 326 for each).
- Worth knowing: the speakers glyph now appears twice in that one row — muted
  in the header's circle, accent inline in the action. At different weights and
  positions it reads fine, but if it grates, the action could take a different
  mark for the *act* of recognising rather than repeating its subject.
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; both headers
  rendered against the real stylesheet at 2× and measured — titles start on the
  same pixel, actions end on the same pixel.

### 2026-08-04 — The plus is drawn on the icon family's grid

- Fixed: the plus beside `Přidat` outweighed the speakers glyph next to it. It
  had been copied from the header's `Nový přepis` button, which draws it on a
  15 grid with arms spanning 11 of it and a 1.5 stroke — a tenth of the box.
  Every `LineIcon` is a 24 grid with a 1.6 stroke, under 7 %. A plus is
  full-bleed geometry where a pictogram spends its box on detail, so the same
  nominal 15 px read as clearly bigger.
- Changed: the plus is now the same 24 grid and 1.6 stroke, arms across 12.
  Unchanged in the header button, which is a 34 px control with 15 px type and
  wants the heavier mark.
- Files: `src/Detail.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; rendered against the real stylesheet at 2×
  beside the speakers action.

### 2026-08-04 — The speaker-count dialog opens in Jakub's words

- Changed: the first sentence of `dialogs.speakers.intro` and all four
  `introMany` forms is now `Pokud znáš počet mluvčích, nástroj pro rozpoznání
  bude mít lehčí úkol.` It replaces `Když počet víš, rozpoznání mluvčích ho
  použije místo odhadu.`, which described the mechanism; this one says what the
  answer buys.
- Kept: the second sentence of each. `Odhad se na dvou lidech často splete.` is
  the measured claim behind the request — on the user's own recording the old
  clustering produced 65 turns and a 55/45 split where the truth was 99/1 — and
  the `Platí pro {count} nahrávku.` forms are the only thing saying a batch
  answer covers more than one recording.
- Note for whoever revisits the vocabulary: this introduces `nástroj pro
  rozpoznání`, where the rest of the interface says `rozpoznání mluvčích`. Kept
  as written — it is the user's own wording and reads naturally under a heading
  that already names the subject.
- English follows: `If you know how many people speak, the tool has an easier
  job.`
- Files: `src/locales/cs/dialogs.ts`, `src/locales/en/dialogs.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — The window says what it is

- Added: `Whisp` beside the cube in the application header, with the version a
  shade back from it, so the pair reads as one label rather than two facts.
- Only in the Archive. Deeper in, the header carries the recording or the
  screen the reader is in, and a wordmark repeated there would take room from
  what actually changes.
- The version comes from `getVersion()` — that is, from `tauri.conf.json`, the
  file that already defines it. Typing `v1.0` here would have been one more
  place to remember on release day, and the first place to be wrong. It reads
  `v0.1.0` today; bumping `tauri.conf.json` (and `package.json` beside it) is
  what makes it say 1.0. `core:default` already grants `core:app:allow-version`,
  so no capability changed.
- `Whisp` is a literal with an `i18n-ignore`, which is what that escape is for:
  a product name is the same word in every language, and putting it in the
  dictionary would invite a translator to change it. `app.name` stays what it
  is — `Převod řeči na text`, the accessible description of the mark.
- Files: `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (the ignore is
  honoured, no new finding); rendered against the real stylesheet at 2× in both
  colour schemes at the window's real width.

### 2026-08-04 — The drop overlay says what will actually happen

- Fixed: dragging a file over the window always read `Pusť soubor a přepis
  začne sám`, including when automatic transcription is off. The handler is
  correct — `if (automaticRef.current) await beginTranscription(...)`, so with
  the switch off the file only lands in the archive — but the overlay promised a
  transcript that was never going to start. It now reads `Pusť soubor a přidá
  se do archivu` in that case.
- The overlay is the last thing read before letting go, so it has to describe
  this drop, not the usual one. The Archive drop zone under it already varies
  the same way (`Přepis se spustí automaticky.` / `Přepis spustíš tlačítkem
  přepsat.`); the full-window overlay was the one place that did not.
- Files: `src/App.tsx`, `src/locales/cs/app.ts`, `src/locales/en/app.ts`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the branch was
  read against the drop handler at `src/App.tsx:495`, which is what decides it.

### 2026-08-04 — Correcting entry: the file goes into the list, not the archive

- Changed: `Pusť soubor a přidá se do seznamu`, per Jakub. English follows with
  `into the list`.
- Worth flagging rather than deciding here: `Archiv` is the screen's name
  everywhere else — the back button, the footer, the confirmations. This one
  sentence now says `seznam`, which is right for it (the overlay is over the
  list, and that is where the row appears a second later) but it is the first
  place the two words meet. If the screen is ever renamed, this is one of the
  strings to sweep.
- Files: `src/locales/cs/app.ts`, `src/locales/en/app.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — The window is called Whisp

- Changed: the window title in `tauri.conf.json` from `Převod řeči na text` to
  `Whisp`. That string is what the native title bar, the taskbar button and
  Alt-Tab show, and it was the descriptive subtitle rather than the product's
  name — so the one place the operating system asks what this program is
  called, it answered with what it does. `productName` was already `Whisp`, so
  the installer and the shortcut have been right all along; only the window
  disagreed.
- `app.name` keeps `Převod řeči na text`. It is the accessible label of the
  cube, where a description is exactly what a screen reader wants.
- Not done, and it needs a decision: making the title follow the open recording
  (`Kázání 12. 7. — Whisp`), which is what makes a taskbar button useful when
  several things are open. `core:default` grants `allow-title` (reading) but not
  `allow-set-title`, so it would mean widening `src-tauri/capabilities/default.json`
  by one permission. Small, but a capability change is not something to slip in
  unasked.
- Files: `src-tauri/tauri.conf.json`, `CLAUDE.md`.
- Verified: the file still parses as JSON; `cargo check` with no warnings.

### 2026-08-04 — A failure fits on the compact row

- Fixed: `Přepis byl přerušen — aplikace se zavřela dřív, než skončil.` wrapped
  onto a second line in the compact list and pushed that row taller than every
  other one. `.recording-metadata` was already `nowrap` there, but the item's
  own text was not, so the sentence broke inside it.
- Changed: in the compact list the failure is one line cut with an ellipsis.
  The whole sentence stays in the tooltip and in the accessible name; the roomy
  list still shows it in full, which is where a whole sentence belongs.
- Changed: the squeeze lands entirely on the sentence. `.recording-metadata`
  gets `min-width: 0` so it can give way at all, the short facts take
  `flex: 0 0 auto` so they hold their size, and only the failure shrinks —
  otherwise a duration would have been the first thing clipped.
- Changed: every metadata tooltip is now `label: value`, not the label alone.
  Once a value can be cut, the tooltip is where the reader looks, and the label
  by itself was the one thing there with nothing to add.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; measured against
  the real stylesheet at three row widths — the metadata row stays 14 px tall at
  all three while the sentence goes 297 → 180 → 93 px and reports itself
  clipped, so nothing else on the row gives way first.

### 2026-08-04 — The application draws its own tooltips

- Added: `src/Tooltips.tsx`. A native `title` bubble is drawn by Windows —
  square corners, its own white border, its own font — and no CSS reaches it.
  The only way to make one belong to this interface is to draw it here.
- Surface: the action menus' own language, because a tooltip is the same kind of
  thing — panel colour, a hairline, `--stin-vysoky`, `--r-karta`, 12.5 px,
  wrapping at 288 px, `pointer-events: none` so a hint about a control never
  stands between the pointer and it.
- It reads the `title` attributes already on the markup instead of asking ~30
  call sites to adopt something new. On hover the attribute is lifted off the
  element — otherwise Windows would draw its bubble under ours — parked in
  `data-tooltip-held`, and put back when the pointer leaves. Restoring checks
  that nothing has since set a `title` of its own, since React may re-render the
  element while the bubble is up.
- Why that and not a `data-tooltip` sweep: five files carry `title=` 48 times,
  but a third of those are *component props* — `SidebarSection`,
  `SettingsToggle`, `ModuleTile`, `SettingsDisclosure` — not DOM attributes. A
  mechanical rename would have silently broken them. Reading the DOM at runtime
  cannot make that mistake, and it covers every `title` added later for free.
- Accessibility: the bubble is `aria-hidden`. Every element it can appear over
  already has a name from its own `aria-label` or its text, and saying the same
  words twice is noise. The attribute is gone only between pointer-enter and
  pointer-leave.
- Behaviour: 420 ms before showing on hover (about what Windows waits, and long
  enough that sweeping a toolbar does not set off a row of them), 60 ms on
  keyboard focus, which is deliberate. Hides on pointerdown, focusout, Escape,
  window blur, resize, and any scroll — captured, because a scroll anywhere
  moves the anchor out from under it.
- Files: `src/Tooltips.tsx`, `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real component, bundled with esbuild and driven in a browser
  against the real stylesheet — not a hand-built copy of it. Measured: the
  `title` is absent while the bubble is up and back afterwards, the bubble sits
  8 px under its element, clamps to 8 px from the right edge (681–812 in an
  820 px window), flips above at the bottom (bubble ends 353, element starts
  360), and a 59-character sentence wraps inside 288 px.

### 2026-08-04 — A correction row always says what changed

- Changed: `Opravy` lists only segments whose original is known. A row here is
  `před → po`; one that cannot say what changed is not a correction, it is a
  paragraph — and Jakub's screenshot is what that looks like: one row a
  two-word swap, the next two whole blocks with no arrow at all.
- Those are segments edited before `segmenty.puvodni` existed, so their original
  is not knowable. They are not lost: the transcript still marks each of them
  with its pencil, which is exactly the case that mark was kept for.
- Consequence worth stating plainly: on an archive that predates the column the
  list starts nearly empty and fills from the next correction on. That is
  better than three rows that look like a bug.
- Files: `src/Detail.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — The watched folder ignores nothing

- Changed, on Jakub's rule: everything in the watched folder is offered unless
  the archive already holds it. `Ignorovat` is gone — the button, the
  `ignore_watch_folder_files` command, the API call, its handler, its error code
  and its string.
- Removed: `watch_folder_files`, the ledger of `(path, fingerprint)` pairs the
  application kept quiet about, and the two functions that read and wrote it.
  An existing archive drops the table in `migrate_legacy_schema`: it has no
  reader and no writer left, and leaving it would suggest ignoring still exists
  somewhere.
- What decides now is `recording_path_exists` — is this file in the archive? A
  recording that is not converted is work still to do, and saying so is the
  point of watching a folder at all.
- Consequence, worth knowing before the next launch: files ignored in the past
  will be offered again once. There is no record of that decision any more,
  which is what was asked for.
- Kept: the two-scan stability wait. It is about a file that may still be being
  copied into the folder, not about ignoring anything, and it uses its own
  table (`watch_folder_observations`).
- Also changed by this: removing a recording from the archive now makes its
  source file reappear in the notice. An earlier entry designed deliberately
  against that; the new rule supersedes it, and it is consistent — the
  recording is no longer converted.
- Copy: the notice's info line said `Ignorované soubory se znovu objeví jen
  tehdy, když se změní.`, which is now false. It reads `Nabízí se všechno ze
  složky, co ještě není v archivu.`
- Files: `src-tauri/src/main.rs`, `src-tauri/src/db.rs`, `src/App.tsx`,
  `src/Library.tsx`, `src/api.ts`, `src/locales/{cs,en}/{library,errors}.ts`,
  `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (61 passed — 62 minus the one that covered the removed ledger);
  `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-04 — Correcting entry: three English strings were never written

- Found while running the check: `detail.edits.heading`, `.empty` and
  `.seekTitle` had no English. They were added to the Czech file and the same
  script's later write to the English one never ran — an assertion earlier in
  that script had already thrown, and every `sub1` before it had *already
  written its file*. The Czech landed, the English did not, and the step
  reported nothing because the failure came after the useful work.
- This is the silent-partial-write hazard from the `str.replace` entry, in its
  other form: there the script did nothing and said it worked; here it did half
  and said it failed, and half of it was kept. A multi-file script must either
  write once at the end or be re-run to completion after a fix.
- Also translated: `detail.dictionary.prompt`, which had been missing since the
  English dictionary was first written.
- Removed: `errors.watch_folder.ignore_interrupted`, orphaned by the entry
  above.
- Files: `src/locales/en/detail.ts`, `src/locales/{cs,en}/errors.ts`,
  `CLAUDE.md`.
- Verified: `node scripts/i18n.mjs check` reports 782/782 and no stale keys.

### 2026-08-04 — Correcting entry: the ignore ledger comes back

- Reverted, in full, the change two entries above. Jakub tried it and hit the
  consequence that entry flagged out loud: removing a recording from the
  archive immediately re-offered its source file. His words — the Ignore button
  was fine; what has to work is that dropping the file in *again* offers it
  again. It already did: the ledger is keyed on `(path, fingerprint)`, and the
  fingerprint is size and modification time, so a file copied in afresh is a
  different entry and comes back on its own.
- Restored: `watch_folder_files` and its two functions, both checks in the scan
  and the import, `ignore_watch_folder_files`, the button, the API call, the
  handler, the error string, and the notice's original info line. The
  `DROP TABLE` migration is gone.
- One thing does not come back: the ledger's contents. It was dropped on the
  build Jakub ran, so files ignored before that will be offered once more. Any
  answer given from now on sticks.
- Comments in the schema now say *why* the record outlives the archive card —
  deleting a recording is a decision about the archive, not an instruction to
  offer its source again — because that is precisely what got lost.
- Files: `src-tauri/src/main.rs`, `src-tauri/src/db.rs`, `src/App.tsx`,
  `src/Library.tsx`, `src/api.ts`, `src/locales/{cs,en}/{library,errors}.ts`,
  `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (62 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs check` (784/784).
- Lesson, and it is the second time today: a scripted multi-file edit that
  writes as it goes leaves half its work applied when an assertion throws
  mid-way. The two scripts here check every replacement against every file
  first and only then write — which is what the earlier entry should have
  concluded rather than merely describing the damage.

### 2026-08-04 — A short window does not keep a header it cannot afford

- Fixed: shrinking the window left the archive's drop zone stuck to the top
  while everything else scrolled under it — including the watch-folder notice,
  which is the application *asking the reader to decide something*. In a short
  window the collapsed drop zone is around a third of the height.
- Changed: below 760 px of viewport height the drop zone is not sticky and
  scrolls away like anything else. Above it, nothing changes.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-04 — The header says what the program is

- Changed: the wordmark reads `Whisp — Převod řeči na text v0.1.0`. The
  description is the existing `app.name`, so it follows the interface language;
  it is muted and at the name's size, because it is the same sentence rather
  than a second label.
- It is the first thing dropped when the bar runs out of room — below 1040 px
  the header keeps the name and the version, which are what identify the
  window; the description only introduces it.
- Files: `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: rendered against the real stylesheet at 2× at 1360 and 980 px.

### 2026-08-04 — The batch decides together, the file decides alone

- Fixed the case Jakub named: two new files, one to add and one to set aside.
  With one shared selection that took four steps — untick, click, tick the
  other, click — and by the time the pointer was on a button, the checkboxes
  that decide what it acts on were no longer where the eye was.
- Changed: the two things you do to a *batch* stay in the footer — `Přidat` and
  `Přepsat`, both on the selection. The thing you do to *one* file is now on
  that file: a cross at the end of its row that sets it aside immediately,
  regardless of what is ticked. The footer's `Ignorovat` is gone, so there is
  one way to do it rather than two.
- The cross is invisible until the row is pointed at or the button takes focus.
  It is the one destructive control in the notice and should not advertise
  itself down a list of five files.
- Markup: the `label` now covers the checkbox and the name only. A label
  forwards every click inside it to its control, so a button placed within one
  would tick the box instead of firing.
- Moved: the row's surface and its hover from the label to the `li`. Left on the
  label, the strip behind the cross was a different colour and the separator
  between rows stopped short of it — visible in the first render.
- Copy: `Ignorované soubory se znovu objeví, až když se změní.` →
  `Křížkem soubor odklidíš. Objeví se znovu, až se změní.` The rule is the same;
  the sentence now names the control that applies it. The per-file label is
  `Tuhle nahrávku už nenabízet` with the file's own name in it, so a screen
  reader says which row's cross it is on.
- Files: `src/Library.tsx`, `src/styles.css`, `src/locales/cs/library.ts`,
  `src/locales/en/library.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (784/784, no stale
  keys); rendered against the real stylesheet at 2× and measured — the row is
  one 42 px surface end to end, the label gives up exactly the cross's 28 px
  plus its margin, and a long name ellipsizes instead of pushing the cross out.

### 2026-08-04 — The cross is there before you look for it

- Changed: the dismiss cross on each watched-file row is visible from the start
  instead of appearing on hover. Revealing it kept the list calmer, but a
  control nobody can see is a control nobody uses — and this one is the whole
  answer to "this file, no". It stays quiet through colour rather than through
  hiding.
- Copy, Jakub's own: `Křížkem soubor odstraníš. Objeví se znovu, když ho
  změníš.` English follows.
- Worth a second look one day, not changed here: `odstraníš` beside a cross and
  a file name can be read as deleting the file from disk, which it does not do —
  it removes the row from this notice and records the answer. The sentence is
  the user's and the surrounding context is a list, so it reads correctly in
  place; noted in case anyone is ever confused by it.
- Files: `src/styles.css`, `src/locales/cs/library.ts`,
  `src/locales/en/library.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (784/784);
  rendered against the real stylesheet at 2× with neither row hovered.

### 2026-08-04 — 0.9.0, and the description moves to the window

- Version: `0.1.0` → `0.9.0` in all three places that carry it —
  `src-tauri/Cargo.toml`, `package.json`, `src-tauri/tauri.conf.json`. This
  build is everything but the recorder; recording from a microphone is what
  makes it 1.0. The header reads its number from the bundle, so it follows on
  its own.
- Changed: `Převod řeči na text` moved out of the application's own header and
  into the window title, which now reads `Whisp — Převod řeči na text`. The
  header is back to `Whisp v0.9.0`. `.header-brand-what` and its media query
  are gone.
- Worth knowing, and it is the cost of putting it there: the window title comes
  from `tauri.conf.json` and cannot follow the interface language — it stays
  Czech with the interface in English. Making it follow would mean setting the
  title at runtime, which needs `core:window:allow-set-title` in the
  capabilities. Recorded, not done.
- Files: `src-tauri/Cargo.toml`, `package.json`, `src-tauri/tauri.conf.json`,
  `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: both JSON files still parse; `cargo check` builds as `whisp v0.9.0`;
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` (784/784).

### 2026-08-04 — The version follows the description into the title bar

- Changed: the application's own header is just `Whisp` beside the cube. The
  version and the description are both in the window title, which now reads
  `Whisp — Převod řeči na text 0.9.0`.
- The title is set in `setup()` from `app.package_info()`, not written into
  `tauri.conf.json`. Putting the number in that string as well would keep it in
  two files, and the second one is the one that would be wrong on release day.
  The config's static title is only what shows for the instant before setup
  runs. No capability needed: the permission `core:window:allow-set-title`
  gates the frontend calling it over IPC, not Rust calling the API directly.
- Removed with it: `getVersion()` and its state in `App`, and
  `.header-brand-version`.
- Still true from the earlier entry: a title set this way is Czech whatever the
  interface language is. Making it follow would mean setting it from the
  frontend after a language change, which is the permission above.
- Files: `src-tauri/src/main.rs`, `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings;
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` (784/784).

### 2026-08-05 — Recording from the microphone

- Added: a third card in `Nový přepis` — `Nový záznam`. It opens a recorder:
  the microphone is asked for as the view opens (a permission prompt appearing
  the instant after pressing start would eat the first seconds of speech),
  then one surface carries the whole state — capsule icon, status, clock, and
  a live level bar. The bar is the honest part: a timer proves the application
  is counting, the level proves it hears. Square-root scaled, because hearing
  is logarithmic and quiet speech would keep a linear bar looking timid.
- Capture is MediaRecorder in the WebView (Opus/WebM, 96 kb/s, no new native
  dependency). The take goes to the backend as the raw invoke body —
  `#[tauri::command(async)]` with `tauri::ipc::Request`, the documented shape
  for binary uploads; JSON would mean serializing tens of megabytes as a number
  array. ffmpeg converts to M4A under `microphone/` beside the archive, named
  `Záznam 2026-08-05 09-30.m4a` — the file name is the title, counting up when
  two takes share a minute — and `create_recording` files it like any other.
- A finished take leaves only through its three named buttons — `Zahodit`,
  `Přidat`, `Přepsat`. Escape stops a running take (stopping is never loss) and
  otherwise does nothing in preview; the outside-click close is disabled while
  a take exists. Audio that cannot be re-made must not die to a stray click.
- `Přepsat` goes through `beginTranscription`, so the speaker-count question
  and the busy guard apply to a fresh take exactly as to a dropped file.
- Live transcription was considered and declined: whisper.cpp can stream, but
  over short windows with worse accuracy, and the live tail already shows text
  within seconds of `Přepsat`. Recorded here so the question is not reopened
  from scratch.
- Guards behind the button: takes under 4 kB are refused (`microphone.empty`),
  a missing ffmpeg says so (`microphone.ffmpeg_missing`), and conversion
  failures surface instead of leaving a silent card.
- Verified: `cargo fmt`; `cargo check` with no warnings; `cargo test` (62);
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` (804/804). The dialog was
  bundled with esbuild and driven in a real browser against the real stylesheet
  with a fake microphone: ready → recording (timer counts, level moves) →
  Escape lands in preview → Escape in preview changes nothing → `Zahodit`
  returns to ready. No console errors.
- Not verifiable here, say so out loud: the IPC save path (raw body →
  ffmpeg → archive row) needs the real application, and WebView2's microphone
  permission prompt on Windows needs the real machine. If the prompt never
  appears, the fix lives in WebView2's `PermissionRequested` handling — that is
  the first place to look.

### 2026-08-05 — The recorder's level is the player's spectrum

- Changed: the flat level bar in the recorder is gone. In its place is the same
  `Waveform` in `bars` mode the transport pill draws, fed live from the
  analyser's `getByteFrequencyData` — a real spectrum, not an imitation of one.
  44 bands like `MINI_BANDS`, the same gamma/floor shaping, drawn by the same
  code, so the recorder and the player speak one language by construction
  rather than by resemblance.
- Bands are log-spaced over roughly 90 Hz–15 kHz, because pitch is heard in
  octaves: linear spacing would spend most bars on hiss above 8 kHz and cram
  every voiced sound into the first three. Each band averages its slice of FFT
  bins; `fftSize` went 512 → 1024 so the low end has more than a couple of bins
  to land in.
- The spectrum runs from the moment the microphone opens, not only while
  recording: seeing the bars answer your voice before pressing start is the
  proof that the right microphone is listening. Quiet foreground while it
  merely listens, accent while recording — the same way the transport pill
  lights up on play. In preview it zeroes.
- Fixed underneath, and it also explains yesterday's timid level bar: the
  `AudioContext` is created after `getUserMedia` resolves — outside the click's
  user gesture — so it started *suspended*, and the analyser read eternal
  silence (the measured `scaleX(0.0078)` was exactly ±1 quantisation around
  the silence value; the probe showed identical painted pixels in every state).
  MediaRecorder was never affected; only the meter froze. One `context.resume()`
  fixes it.
- Fixed with it: the canvas needed the same `width/height: 100%` rule the
  player's canvases have — without it, it kept its attribute size (wrapper ×
  devicePixelRatio) and the bars escaped the dialog. `.mic-spektrum > canvas`
  joins `.vlnky`/`.mini-vlny` in that rule.
- Files: `src/AddRecordingDialog.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real component bundled and driven with a fake microphone;
  painted-pixel probe on the canvas: ~8,500 px while sound plays in ready and
  recording against 528 (bare minimum bars) before the resume fix and in
  preview after zeroing. Screenshot confirms the bars sit inside the stage.
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` (804/804); `cargo check`.

### 2026-08-05 — The take minimises into a mini recorder

- Added: the recorder window can be minimised mid-take. The recording keeps
  running and a pill appears in the header — the mini player's sibling, at
  Jakub's ask: same surface, same order of parts, but the mark is a pulsing
  record dot instead of play, the bars behind the text are the live spectrum
  instead of the stored envelope, and the trailing control is a stop square.
- Moved: the recorder's whole state out of the dialog into `RecorderProvider`
  (`src/recorder.tsx`), mounted beside `PlayerProvider`. The dialog and the
  pill are two views over one recording — the same relationship the mini
  player has to the transport bar. Closing the dialog therefore cannot kill a
  take any more, structurally.
- Behaviour: while recording, the footer offers `Minimalizovat` beside
  `Zastavit`; Escape and clicking outside the dialog now minimise instead of
  being blocked — closing loses nothing once the pill carries the state. The
  pill's stop button stops the take *and reopens the dialog*, so a finished
  take is never stranded out of sight; its whole surface reopens the recorder.
  A finished take still leaves only through its three named buttons.
- Detail replaces the application header, so the pill is rendered inside
  Detail's own header too (`onOpenRecorder` prop) — otherwise a minimised take
  would run with no sign of it on the whole screen.
- `useSpectrum(bands)` is the shared sampling hook; the dialog's stage and the
  pill both use it (44 and 30 bands), each with its own rAF loop over the one
  analyser. The spectrum state deliberately stays out of the context — a
  60 fps context value would re-render every consumer.
- Files: `src/recorder.tsx` (new), `src/AddRecordingDialog.tsx`, `src/App.tsx`,
  `src/Detail.tsx`, `src/main.tsx`, `src/styles.css`,
  `src/locales/{cs,en}/{app,dialogs}.ts`, `CLAUDE.md`.
- Verified: the real components bundled and driven with a fake microphone
  through the whole loop — record → `Minimalizovat` closes the dialog, the
  pill shows the live spectrum (4,185 painted px) and a ticking clock
  (0:01 → 0:03) → stop from the pill reopens the dialog in preview with the
  take's length and `Zahodit / Přidat / Přepsat`. `npx tsc --noEmit`;
  `node scripts/i18n.mjs check` (808/808); `cargo check`; `cargo test` (62).

### 2026-08-05 — The take plays back, and the spectrum matches the slider's

- Changed, both per Jakub after trying it on the real machine:
  1. A finished take can be heard before deciding. The capsule circle becomes a
     play/pause button in preview — the same circle, now an instruction instead
     of a picture — the time reads `position / length`, and the spectrum dances
     to the playback: the audio element routes through its own analyser, so the
     same bars that showed the take being made show it being played.
  2. The spectrum draws with the transport bar's own numbers — one bar per 7 px
     (`BAR_SPACING`), 2 px stroke, ceiling 0.82, peak 0.55 — instead of a fixed
     44 bands stretched over the dialog, which is what read as thin dotted
     lines. The band count follows the stage's measured width, so the density
     holds at any dialog size.
- Playback details worth keeping: the audio element and its context are created
  inside the click, so the context starts running — the mirror of the
  suspended-context lesson on the recording side. `Blob` URL is revoked and the
  context closed on discard, save, unmount, or a new take. Ended resets to the
  start. WebM from MediaRecorder reports no duration; the length shown is the
  recorder's own clock, never `audio.duration`.
- `spectrumEdges`/`sampleSpectrum` are now exported helpers shared by the mic
  hook and the playback loop — one band math, two instruments.
- Files: `src/recorder.tsx`, `src/AddRecordingDialog.tsx`, `src/styles.css`,
  `src/locales/{cs,en}/dialogs.ts`, `CLAUDE.md`.
- Verified: real components driven with a fake microphone in the light theme —
  record → minimize → stop from the pill → preview → play: the button flips to
  pause, the clock reads `0:01 / 0:03`, the canvas shows ~7,000 painted pixels
  while playing, and after the take ends the clock returns to the length.
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` (810/810); `cargo test` (62).

### 2026-08-05 — The untranscribed page says it once, in the middle

- What Jakub saw, on his first microphone take: the page said the recording is
  not transcribed twice — a strip under the header with a right-aligned
  `Přepsat`, and a lone muted line in the middle of the empty area. Two
  statements of one fact, and the action stood beside the less prominent one.
- Changed: the strip keeps only the sentence, now with the shared `InfoNote`
  treatment — the same blue info circle every explanatory note in Settings
  carries. Its button is gone; a strip that states a situation and a place
  that resolves it should not both offer the action.
- Changed: the middle of the empty transcript area is a proper empty state —
  the `transcription` waveform in the 44 px accent circle (the summary and
  translation empty states' own geometry), a heading, and the primary
  `Přepsat`. The heading is new copy, per Jakub's ask to devise one:
  `Tady bude přepis` — it names what the space is for and looks forward, so it
  cannot repeat the strip's fact. English: `The transcript will appear here`.
  No sentence between heading and button; the strip already explains the
  state, and the ask was a heading and a button.
- Deliberate: the centred state appears only for `nova` with the source file
  present. A failed transcription keeps its warning strip with `Opakovat`
  untouched, and a recording whose file is gone falls through to the plain
  `detail.empty.noTranscript` line — a file that is gone cannot be offered a
  transcription.
- Layout: `.prepis-prazdny` centres in the transcript area's content box;
  `.prepis`'s 120 px bottom padding biases it slightly above the middle,
  which is where an empty state wants to sit.
- Files: `src/Detail.tsx`, `src/styles.css`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (811/811, no
  problems); the exact markup rendered with the real `InfoNote` and `LineIcon`
  components against the real stylesheet at 2× in both colour schemes —
  circle 44 px round, icon, heading and button on one vertical axis to the
  pixel, 14 px icon-to-heading, 18 px heading-to-button.

### 2026-08-05 — The mini player comes back to the detail of another recording

- What Jakub saw: playing one recording and opening another one's detail, the
  mini player disappeared — the playback kept running with no sign of it and
  no control anywhere on the screen.
- Cause: in the original layout the application header rendered on every
  screen, and the mini player hid only when the open detail *was* the playing
  recording (`!(screen === "detail" && selectedId === player.recordingId)`).
  When Detail got its own contextual header, the app header stopped rendering
  there and the mini player went with it. The comment written at the time —
  "Detail owns its complete contextual header and full player" — assumed the
  full player covers it, which is true only for the open recording itself.
- Changed: `MiniPlayer` (and its private `AudioBars`) moved from `App.tsx`
  into `src/player.tsx` and is exported — it lives beside the player state it
  renders, the same relationship `MiniRecorder` has to the recorder, and both
  headers import it instead of one owning it privately.
- Changed: Detail's header renders the pill in `.detail-akce`, beside the
  mini recorder, whenever `player.recordingId !== id`. Clicking its title
  travels to the playing recording's detail through the new
  `onOpenRecording` prop, which App wires to the same `openRecording` the
  archive header uses.
- Copy, from the same message: the empty-state heading is Jakub's
  `Tady bude tvůj přepis`; English follows with `Your transcript will appear
  here`.
- Files: `src/player.tsx`, `src/App.tsx`, `src/Detail.tsx`,
  `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (811/811, no
  problems); the detail header rendered with the pill against the real
  stylesheet at 2× at 1360/1100/940 px — 57 px header height holds, nothing
  overflows, and at 940 px the recording title ellipsizes rather than pushing
  the pill or the document actions out.

### 2026-08-05 — A fresh correction reaches the Opravy list at once

- What Jakub saw: correcting a segment in a newly transcribed recording did
  not show up under `Opravy` until the detail was left and reopened.
- Cause: `saveText` mirrors the backend's segment update into local state —
  text, `edited`, `verified`, dropped `words` — but not
  `puvodni = COALESCE(puvodni, text)` (`db.rs:1019`). Locally `original`
  stayed `null` on a first-ever edit, and the corrections list deliberately
  shows only segments whose original is known, so the row appeared only after
  the next full load.
- Changed: the local update sets `original: x.original ?? x.text` — the same
  COALESCE, in the same spirit as the mirrored `words: null` beside it: the
  first rewrite records what the machine wrote, later rewrites leave that
  record alone.
- Files: `src/Detail.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (811/811, no
  problems); the mirrored expression was read against `db.rs:1019` rather
  than remembered.

### 2026-08-05 — The pills live in the middle of the header

- Changed, at Jakub's ask ("vždycky na střed headeru", with YouTube as the
  reference): the mini player and the mini recorder sit in a dedicated centre
  slot in both headers — `.lista-stred` in the application bar,
  `.detail-hlavicka-stred` in Detail's contextual header. Navigation keeps
  the left, actions keep the right, the thing that is running holds the
  middle, and it holds the *same* middle when navigating between screens.
- Both headers moved from flexbox to a `1fr auto 1fr` grid. The centre track
  is truly centred against the window, not against wherever the left content
  ends; the side tracks stay equal until one genuinely needs more room, at
  which point the slot yields rather than clipping (measured: at 980 px the
  app bar's slot cedes centre while the detail's, with one pill, holds it).
- Removed with it: the pill's `margin-left: 6px`, which was its old inset
  from the back button — centred in its own slot it only pushed the pill 6 px
  off the true middle. `.lista-levo` gains `min-width: 0` so a long left side
  ellipsizes instead of shoving the grid.
- Files: `src/App.tsx`, `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; both headers
  rendered against the real stylesheet at 2× at 1360/1100/980 px — slot
  centres at 680/680 against a 680 viewport middle, 57 px heights hold, no
  horizontal overflow at any width, title ellipsizes at 980.

### 2026-08-05 — Correcting entry: the pills go right, not centre

- Supersedes the centred-slot entry immediately above, minutes after it was
  written and before it ever reached the project: "youtube byl překlep" — the
  reference that motivated the centre slot was a typo, and Jakub's actual ask
  is the pills always at the right edge.
- Changed: both headers are back to their flex layouts. The mini player and
  the mini recorder open the right-hand group — `.lista-pravo` in the
  application bar, `.detail-akce` in Detail's header — before the named
  actions, so the pills hold the same corner on every screen.
- `.lista-stred` and `.detail-hlavicka-stred` are gone. Kept from the
  superseded change: no `margin-left` on the pill, and `min-width: 0` on
  `.lista-levo`, both good regardless of which side the pills live on.
- Spacing: `.lista-pravo` has a 4 px gap for its text buttons; the pill adds
  `margin-right: 4px`, so pill-to-pill and pill-to-button both come out 8 px —
  the same rhythm `.detail-akce`'s own 8 px gap gives the detail header.
- Files: `src/App.tsx`, `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; both headers
  rendered against the real stylesheet at 2× at 1360/1100/980 px — measured
  8 px between the two pills and 8 px pill-to-button at every width, 57 px
  header heights hold, no overflow, the title ellipsizes at 980; no
  `-stred` selector remains anywhere in the source.

### 2026-08-05 — No `Příprava…` in the empty transcript area

- Removed, at Jakub's ask: pressing `Přepsat` on a detail put a serif
  `Příprava…` in the middle of the empty transcript area while the first
  words were on their way. The progress bubble in the corner already says
  what is happening and with how many percent; a placeholder set in the
  transcript's own reading face looked like part of the transcript.
- The live-transcript area now simply stays empty until the first words
  arrive. The key `detail.empty.preparing` is gone from both languages and
  from the context notes — it had exactly one reader.
- Files: `src/Detail.tsx`, `src/locales/cs/detail.ts`,
  `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (810/810, no
  problems, no stale keys); a grep across `src/` finds no remaining reader of
  the removed key.

### 2026-08-05 — Starting a take pauses playback

- Added, Jakub's rule: pressing `Spustit záznam` pauses whatever the player
  is playing. The two could not sensibly run together anyway — the speakers
  would play straight into the microphone and end up inside the take.
- Where it lives: in `RecorderProvider.start`, the one place every take goes
  through, so no view that opens the recorder can forget it — the same
  reasoning that put the speaker-count question into `runTranscription`.
  The provider reads the player through a ref so its `start` callback stays
  stable; taking the player from the closure would rebuild the recorder's
  context value on every playback tick and re-render every consumer.
- Order note: `RecorderProvider` sits inside `PlayerProvider` in `main.tsx`,
  which is what makes `usePlayer` reachable from it. If the providers are
  ever reordered, this is the dependency that breaks.
- Files: `src/recorder.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The recorder locks playback out, from the first click

- Supersedes the pause-in-`start` entry from earlier today, on Jakub's
  follow-up after seeing both pills live at once: playback must stop the
  moment the recorder view opens, not only when the take starts, and it must
  not be startable — from the mini player or anywhere else — while recording.
- Changed: the player itself gained `playbackBlocked` /
  `setPlaybackBlocked`. Blocking pauses any running sound at once, and
  `start` and the play direction of `togglePlayback` refuse while it holds —
  so every way of starting sound (mini player, the full transport, a word
  click, the space key, a note's time chip) obeys it by construction, because
  they all go through those two methods. Pausing always works.
- Changed: the recorder switches it with its phase — on for `preparing`,
  `ready` and `recording` (the microphone is held), off otherwise. Preview is
  deliberately not blocked: the take is finished, and listening to it plays
  through the dialog's own element, not through the player. The pause that
  lived in `RecorderProvider.start` is gone; blocking covers it earlier.
- Visible state: the mini player's play button and the transport's big play
  button are disabled while blocked, so they say "not now" instead of
  ignoring the click. The transport's `PlayButton` reads the player context
  directly rather than threading a prop through three components.
- Files: `src/player.tsx`, `src/recorder.tsx`, `src/PlaybackControls.tsx`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The preview spectrum carries the playback position

- Added, from Jakub's screenshot of a 1:34 take: the finished take's spectrum
  doubles as its timeline. A dot rides on the strip at the playback position
  and dragging it seeks — a longer take needs to show where in it the
  playback stands, and the strip was already the one thing shaped like the
  whole recording.
- The dot is the shared `.posuvnik` thumb over an invisible track — the bars
  are the track. It sits low over the baseline rather than centred on the
  strip: the bars grow from the bottom, and a dot floating mid-air above a
  quiet spectrum reads as detached from what it controls.
- Position is fractional and driven by the same rAF loop that samples the
  playback spectrum, so the dot glides instead of stepping in the ~250 ms
  hops `timeupdate` fires at; the clock floors it. The slider's `max` is the
  recorder's own clock — MediaRecorder's WebM reports `Infinity` for
  `audio.duration`, the lesson already recorded on the playback entry.
- Restructured: element creation moved out of `togglePlayback` into
  `ensurePlayback`, because the slider needs the element too — dragging
  before ever pressing play creates it paused and seeks. Both callers are
  user gestures, so the AudioContext starts running (the suspended-context
  lesson, other direction).
- Files: `src/AddRecordingDialog.tsx`, `src/styles.css`,
  `src/locales/cs/dialogs.ts`, `src/locales/en/dialogs.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (811/811); the
  real dialog bundled and driven with a fake microphone — record → stop →
  the slider appears over the spectrum, playing moves the dot and the clock
  (`0:01 / 0:02` at value 1.2/2), dragging seeks (value lands where set and
  playback continues from there), dragging before the first play creates the
  element paused and seeks it; screenshots confirm the dot rides just above
  the baseline in both the playing and the paused state.

### 2026-08-05 — Narrow windows get compact pills

- What Jakub saw at the window's minimum width: the two pills crowded the
  detail header into overflow. His call, implemented as stated: the player
  pill shrinks to the play button and the cross.
- Changed: below 900 px of window width both pills drop their bars and title.
  The player keeps play and the cross (73 px against the full 290). The
  recorder — his ask extended to its sibling — keeps the pulsing dot, the
  clock and stop (109 px): a recording without a visible clock would look
  stalled, which is the one thing a recording indicator must never do.
- Known trade, chosen deliberately: the compact player has no title, so the
  pill no longer offers the jump to the playing recording's detail — at that
  width the click targets that remain are the ones that control sound. The
  full pill returns with the space.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: rendered against the real stylesheet at 2× at 770/900/1100 px —
  73/109 px compact pills, full 290 px pills above the breakpoint, no
  horizontal overflow at any width, the detail title ellipsizes beside them.

### 2026-08-05 — Correcting entry: the compact rule asked for a width the window cannot have

- What Jakub saw: nothing changed. The compact-pill rule from the entry above
  was written at `max-width: 900px` — and `tauri.conf.json` sets the window's
  `minWidth` to 1000. The rule could never fire. The overflow in his
  screenshot happens near 1180 px, on the detail, with both pills up.
- Changed: three thresholds, keyed to what actually shares the bar. The
  archive header holds only the wordmark and always fits at ≥1000 px; the
  900 px rule stays purely as a net in case the minimum ever drops. The
  detail player compacts below 1020 px, and below 1460 px whenever the
  recorder pill stands beside it (`.detail-akce:has(> .mini-rekorder)`) —
  two full pills plus the title and the document actions are what needs
  ~1400 px.
- Found while measuring, and fixed: `.mini-rekorder { width: 200px }` was a
  dead rule. The shared `.mini-prehravac { width: 290px }` added later in
  the file wins at equal specificity by order, so the recorder pill has been
  riding at the player's width without anyone deciding it. Now
  `.mini-prehravac.mini-rekorder`, and the recorder is its designed 200 px.
- Lesson, and the stylesheet's own `.seznam { margin: 0 }` entry already
  taught it once: a media query is a claim about reachable widths — check
  the window's real minimum before writing one. And a width that looks right
  in a harness proves nothing about a rule that a later selector overrides.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the detail header with both pills and the full action set
  rendered against the real stylesheet at 2× at 1000/1180/1460/1500 px —
  compact 73 px player and 200 px recorder up to 1460, full pills at 1500,
  no overflow at any width including the window minimum.

### 2026-08-05 — The detail header's document actions are one word each

- Changed, Jakub's call: the header buttons read `Vylepšit`, `Vylepšený`
  (once the improved document exists) and `Uložit` instead of `Vylepšit
  přepis`, `Vylepšený přepis` and `Uložit přepis`. They stand in the header
  of the transcript itself — the noun is the whole screen, and repeating it
  in every button was width spent twice, which is exactly what the header
  has been running out of. English follows: `Improve` / `Improved` / `Save`.
- Scope: header buttons only. The save-menu group headings (`Hrubý přepis`,
  `Vylepšený přepis`), the preview title, and the AI dialog's confirm
  (`Vylepšit přepis`) keep the noun — inside a menu or a dialog the context
  is no longer the header, and the earlier terminology entries stand.
- Files: `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (811/811, no
  problems).

### 2026-08-05 — Sound wins, the take waits

- Supersedes the hard lock from the entry `The recorder locks playback out`,
  hours after it was written, on Jakub's better idea: instead of dead play
  buttons, starting playback anywhere *pauses a running take*, and the take
  resumes by itself when the sound stops. Nothing from the speakers can end
  up inside the recording, and nothing on screen ever refuses a click.
- Removed: `playbackBlocked` / `setPlaybackBlocked` from the player, the
  guards in `start` and `togglePlayback`, and both disabled button states.
  Kept from that change: opening the recorder still pauses whatever is
  playing, once — now as a plain effect on the `preparing` phase.
- Changed: `RecorderProvider` watches `player.isPlaying`. Sound starts →
  `MediaRecorder.pause()`, the clock stops, `suspended` goes up. Sound stops
  — pause, close, or the track simply ending — → `resume()`, and the clock
  continues. The player's state is the single source of truth, so the take
  pauses whichever way sound was started: mini player, transport, a word
  click, the space key.
- Changed: pressing `Spustit záznam` while sound plays pauses the sound —
  recording is asked for explicitly, so it outranks what it found running.
- The clock survives pauses: `elapsedBase` accumulates finished segments and
  `begun` stamps the running one, so the shown length is speech, not wall
  time. `stop` finalises from the paused state too (legal per MediaRecorder)
  and clears the flag, as do release and reset.
- Visible state: the dialog's status reads `Záznam čeká, dokud hraje zvuk.`,
  the stage's pulse pauses, the pill's dot stands still and dims
  (`.pozastaveny`), and the spectrum flattens — the microphone is still open
  and the analyser would go on dancing to the room, which would say
  "recording" right when it is not (`useSpectrum` zeroes while suspended).
- Files: `src/player.tsx`, `src/PlaybackControls.tsx`, `src/recorder.tsx`,
  `src/AddRecordingDialog.tsx`, `src/styles.css`,
  `src/locales/cs/dialogs.ts`, `src/locales/en/dialogs.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (812/812, no
  problems). The coordination is an effect over two providers and a real
  MediaRecorder; the state transitions were reasoned through rather than
  driven end-to-end in the harness — the first Windows run should try:
  record → play from the mini player → the take pauses and says so → pause
  playback → the take resumes and the clock continues where it stopped.

### 2026-08-05 — Adding a file says so, wherever you stand

- What Jakub asked for: adding a new file or link from a detail should slide
  out the notice bar, so it is visible that something happened.
- Cause: a successful local-file add — picker or drag-and-drop — reported
  nothing at all, on any screen. On the archive the new row was the feedback;
  on a detail the archive is not on screen, so nothing visible happened. The
  microphone, online-import and watched-folder paths all already report.
- Changed: `acceptFiles` counts what it added and reports through the
  existing notice, count-aware and varying with automatic transcription. It
  reuses `app.watchFolder.transcribing` / `app.watchFolder.added` — the
  watched-folder import already says exactly this sentence (`Nahrávka je v
  Archivu a přepis začal.` and friends), and one meaning should live under
  one key rather than as a duplicate with a different name. The context
  notes now say the keys serve both paths; the `watchFolder` prefix is
  historical.
- The link path already reported on completion and shows live progress in
  the dialog while downloading, so it needed nothing.
- Also fixed while there: `reportError` was used inside `acceptFiles` but
  missing from its dependency list — harmless today (it is a stable
  callback), wrong tomorrow.
- Files: `src/App.tsx`, `src/locales/cs/app.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (812/812); the
  notice element renders outside the `screen !== "detail"` conditional
  (`App.tsx` line ~747), so the bar shows on the detail as well — read
  against the code, and the mic-path notice Jakub has already seen there
  confirms it in practice.

### 2026-08-05 — The pill compacts when squeezed, not when told, and it eases

- What Jakub saw: the mini player shrank with visible room still beside it.
  Right — the 1020/1460 px rules from the correcting entry above were widths
  *guessed to be safe*, so they compacted long before the header was actually
  tight (a short title at 1300 px has plenty of room; the rule shrank the
  pill anyway). Both media rules are gone.
- Changed: Detail measures instead. The pill gives up its words the moment
  the recording's name starts losing letters (`scrollWidth > clientWidth` on
  `.detail-jmeno`), and grows back once the name is whole *and* the left
  column's slack exceeds what expanding costs plus ~25 px. The two conditions
  cannot chase each other — compacting frees less than expanding demands —
  and a `ResizeObserver` on the stretched left column drives it, re-armed on
  `title` because a rename changes the name's width without changing the
  observed box.
- Changed: the shrink eases (Jakub's second ask). Width transitions 290 →
  89 px over the shared hover timing while the title, clock and bars fold
  (`max-width` → 0) and fade; nothing pops in or out. 89 is the pill's own
  arithmetic — two 30 px buttons, three 8 px gaps whose zero-width slots
  stay in the row, 5 px padding. `prefers-reduced-motion` turns the
  transitions off. The base 900 px net (below the window minimum) keeps its
  `display: none` form.
- Files: `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the same measure rule was driven in a browser against the real
  stylesheet and the real header markup with both pills, walking 1600 →
  1000 → 1600. Down: full through 1240, compact from 1180. Up: compact still
  at 1240, full again at 1300 — a real hysteresis band, and every state was
  re-measured twice as a fixed point (no flapping). Animation sampled at
  50 ms: 290 → 218 → 139 → 96 → 89. No overflow at any width including the
  1000 px minimum, where the name yields letters instead. Honest limit: the
  harness ran a copy of the measure function against the same DOM, not the
  component itself — the shipped code path needs one look on the real
  machine.

### 2026-08-05 — The compact pill is play, three bars, cross

- What Jakub said: after shrinking it is still fairly big — put the play and
  the cross next to each other, or at least three equalizer bars between them
  so it is visible whether sound is running.
- Changed: compact is now 83 px instead of 89, and the space between the two
  buttons is no longer empty. The three gaps the folded title and clock leave
  behind (6 px each) become one 18 px window holding a three-band equalizer.
  Dead air is what made the pill read as big; filling it costs nothing and
  restores the one thing the compact pill had lost — whether the sound is
  moving.
- Three bands, not 44: `equalizerAtTime` samples rather than averages, so
  three points across the stored bands are the low, the middle and the top of
  the spectrum. Forty-four bars in 18 px would be a smear. Stroke goes 1.5 →
  2.5 and the colour is the accent while playing (a quiet grey when paused),
  because here the bars are information rather than the decorative backdrop
  they are at full width.
- Structure: `MiniPlayer` takes `compact` and puts `.kompaktni` on the pill
  itself, so the CSS keys on the pill rather than on `.detail-akce.stisnene`
  — the state had been living in two places. Detail passes `pillsCompact`;
  the wrapper class is gone. The width and gap still ease, and the words
  still fold and fade.
- Known and unchanged: with no waveform loaded yet `AudioBars` renders
  nothing, so the window is briefly empty — the same as before, and it fills
  as soon as the envelope arrives.
- Files: `src/player.tsx`, `src/Detail.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Waveform` in the real pill markup against the real
  stylesheet at 3× — compact 83 px, exactly 18 px between play and cross, the
  bars measured inside that window (not overlapping either button), 634
  painted canvas pixels against 16,017 at full width; the full pill still
  measures 290. `npx tsc --noEmit`; `node scripts/i18n.mjs check`; no
  `stisnene` remains anywhere in the source.

### 2026-08-05 — The recorder's dot sits on the line, measured

- Fixed, Jakub's screenshot: the seek dot on the finished take floated above
  the line the equalizer bars grow from. It should be centred on it.
- Measured rather than reasoned: a 1× screenshot of the strip was decoded to
  raw pixels and the two centres read off it — the dot's widest row at y 25,
  the bars' baseline at y 37.5. Chromium positions this thumb from its own
  track box, so the arithmetic I would have derived was wrong twice already;
  the offset is now the measured 32.5 px, with a note to re-measure rather
  than re-reason if the strip's height changes.
- Added: 7 px of padding under the strip, so the dot's lower half lives
  inside the control's own box instead of hanging over what follows.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the same pixel measurement after the change — dot centre y 37,
  baseline y 36.5, half a pixel apart; and a 3× screenshot where the dot sits
  on the dotted line.

### 2026-08-05 — Correcting entry: the dot's own shadow moved it two pixels

- What Jakub saw: the seek dot still fell about two pixels below the line.
  He was right, and the earlier "measured" entry was measured badly.
- Cause: the probe found the dot by looking for blue pixels in a screenshot,
  and `box-shadow: 0 1px 3px rgb(0 0 0 / 0.3)` under the thumb reads as dark
  blue too. The blob it measured was the dot *plus* its shadow, whose centre
  sits below the dot's — so the correction overshot by 2.5 px.
- Fixed by measuring properly: the probe now switches the shadow off, and a
  sweep across `margin-top` 0/10/20 established the relation Chromium
  actually uses — the thumb's *top* lands on the margin, so its centre is
  `margin-top + 6.5`. The bars' minimum stubs paint canvas rows 36–37 of 38,
  centre 36.5, so the margin is 30 and the dot's centre lands at 36.0.
- Lesson worth keeping, and it is the third measurement lesson in this file:
  a pixel probe measures whatever is the same colour, not the thing you meant.
  Strip the decorations before reading, and prove the relation with a sweep
  rather than inferring it from one sample.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: after the change, the dot's centre reads y 36.0 against the
  bars' 36.5 — half a pixel, and on the correct side of it.

### 2026-08-05 — The audio can be saved out of the archive

- Jakub asked where microphone takes are kept, and said one should be able to
  save them. They are in `%APPDATA%\cz.znackarna.whisp\microphone\` as
  `Záznam YYYY-MM-DD HH-MM.m4a`; downloaded videos are in `online-media/`
  under a UUID. Neither is a place to send someone digging, which is the
  argument for the feature rather than for documentation.
- Added: `Uložit zvuk…` in the shared recording menu, so it is on Archive
  cards and on the transcript header alike. It opens the system save dialog
  with the recording's own title and its real extension, then copies the file.
- Backend: `export_audio(id, destination)` reads the recording's path from
  the archive rather than trusting one from the window, refuses when the
  source is gone (`audio_export.source_missing`), and reports a failed copy
  with the system's own reason in `{detail}`.
- One implementation, in `App`, beside the other recording actions: Library
  threads `onExportAudio(id)` to its card and Detail takes it as a prop. The
  two screens only say which recording — the same shape as transcription and
  speaker recognition, and for the same reason.
- Deliberately a copy, not a move: the archive goes on playing and
  transcribing from its own file. This hands over a duplicate.
- Files: `src-tauri/src/main.rs`, `src/api.ts`, `src/RecordingActionsMenu.tsx`,
  `src/App.tsx`, `src/Library.tsx`, `src/Detail.tsx`,
  `src/locales/{cs,en}/{dialogs,errors,app}.ts`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (62 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — Dialog headings lead their own sentence, and the tools list is a panel

- Changed, Jakub's ask across the AI, speaker-count and add-recording
  dialogs: the heading goes 17 → 19 px with slightly tighter tracking, and
  the sentence under it moves from 8 px to 4 px away. A dialog has nothing
  else competing for the eye, so its title can be the biggest thing in it;
  and at 8 px the sentence read as the first item of what followed rather
  than as the heading's own. The room the pair gives up above is handed back
  below, before the content.
- Changed: `Technické podrobnosti` uses the archive backups' container — one
  bordered, quietly filled panel with ruled 40 px rows — instead of a bare
  list leaning on the disclosure's indent. They are the same kind of thing,
  a short table of where things are, and they should not look like two
  different ideas.
- Removed with it: the disclosure's left rule and indent when it holds that
  panel. A framed panel inside a ruled indent is two borders saying one
  thing.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: rendered against the real stylesheet at 2× — heading 19 px, 4 px
  to its sentence, 18 px from there to the content; the tools panel and the
  backups panel measured identical (12 px radius, 40 px rows, same left
  edge) and the disclosure's border-left reads 0.
- Honest limit: this is a stylesheet change verified against hand-written
  markup, which proves the CSS and not the components' own output — the
  lesson from the duplicated empty state applies, so give the three dialogs
  one look on the real machine.

### 2026-08-05 — The portable-copy sentence names the file as a file

- Changed: `settings.portable.copyDescription` is Jakub's wording —
  `Zkopíruje aplikaci i modely na zvolený disk. Na jiném počítači pak stačí
  spustit soubor {file}.` The only difference from what was there is
  `soubor` before the name, and it earns its place: `spustit Whisp.exe`
  reads as a command, `spustit soubor Whisp.exe` as a thing to double-click,
  which is what the reader will actually do on the other machine.
- `{file}` is already rendered as `<code>Whisp.exe</code>` by the component,
  so the name keeps its monospace chip; nothing about that changed.
- English left as it was: `you just run {file}`. Adding the noun there would
  give `run the Whisp.exe file`, which is clumsy where Czech needs the case
  marker. The Czech copy decision does not carry over.
- Files: `src/locales/cs/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (no problems,
  the `{file}` placeholder still matches across both languages).

### 2026-08-05 — The Vzhled tab gets its opening sentence

- Fixed, Jakub's ask: `Vzhled` was the one Settings tab whose card had a
  heading and nothing under it, so it started with a bare `Jazyk` field while
  every sibling introduces itself first.
- Copy: `Jazyk aplikace a písmo, kterým se čte přepis. Ukázka dole se mění s
  každou volbou.` It names what the card holds — the tab's title alone does
  not say that the interface language lives here — and then points at the
  live sample, which is the thing that makes the choices decidable.
- Not the imperative Jakub sketched (`přizpůsob si podobu výpisu`): every
  other section description in Settings is declarative and names the object,
  and `výpis` is the archive's word, while this card is about the transcript.
  Say the word and it flips.
- Files: `src/Settings.tsx`, `src/locales/cs/settings.ts`,
  `src/locales/en/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (no problems);
  the sentence uses the shared `settings-section-description`, so its width
  limit, colour and 8/24 px rhythm are the ones every other card has.

### 2026-08-05 — Saving audio writes a real audio format

- Supersedes the plain copy in the entry above, on Jakub's question — should
  this not be a standard format? Two things were wrong with the copy: a
  recording whose source is `.mp4` or `.mkv` handed over a **video** from an
  action called `Uložit zvuk`, and the format was whatever the archive
  happened to hold rather than anything the person chose.
- Changed: the save dialog offers MP3, M4A and WAV, each named with the
  reason to pick it (`MP3 — otevře se všude`, `M4A — menší soubor`,
  `WAV — bez komprese`). The destination's extension is what decides; the
  backend writes that format with `-vn`, so a video source yields audio.
- Kept lossless where it is free: when the chosen format already equals an
  audio-only source's own format, the file is copied verbatim instead of
  re-encoded — re-encoding lossy audio into the same shape only shaves
  quality off for nothing, and a copy needs no ffmpeg at all. That case is
  offered first in the dialog for an audio source (an `.flac` recording gets
  `FLAC — beze změny` before the three), so the default is the faithful one;
  a video source starts at MP3.
- Settings: MP3 is `libmp3lame -q:a 2`, VBR around 190 kb/s — transparent for
  speech and small enough to send. M4A is `aac -b:a 192k`. WAV is
  `pcm_s16le`.
- Guards: an extension we cannot write says so and names the three
  (`audio_export.unsupported_format`); a missing ffmpeg says so on the
  converting path only (`audio_export.ffmpeg_missing`), since a same-format
  copy never needs it.
- Files: `src-tauri/src/main.rs`, `src/App.tsx`,
  `src/locales/{cs,en}/{app,errors}.ts`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (62 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs check`. The exact
  argument shapes the command passes were run against a real ffmpeg on a
  generated AAC file and a real H.264+AAC video: `m4a → mp3` gives one `mp3`
  audio stream, `mp4 → mp3` and `mp4 → wav` and `mp4 → m4a` each give exactly
  one audio stream and no video. Jakub's own bundled `ffmpeg.exe` was checked
  for `--enable-libmp3lame` before choosing MP3 as the default — it is there.
- Known limit: a long recording takes several seconds to convert and the only
  feedback is the confirmation afterwards. The command runs off the UI
  thread, so nothing freezes, but a progress state would be the next
  improvement if it ever feels slow.

### 2026-08-05 — Folders in the archive

Built from the analysis in `slozky-analyza.md` and the three decisions Jakub
made on it: a recording in a folder leaves the root list, clicking a folder
opens it, and the card takes the paper yellow the notes already use.

- Data: a `slozky` table (id, nazev, vytvoreno) and `nahravky.slozka`
  referencing it. The schema stays Czech, as `ARCHITECTURE.md:59` requires.
  A fresh archive declares `ON DELETE SET NULL`; an existing one gets the
  column through `migrate_legacy_schema` without the clause, since SQLite
  cannot add one — so `delete_folder` clears the column itself rather than
  trusting the constraint. That is what makes "delete the folder, keep the
  recordings" true on both shapes of archive.
- One level, deliberately. Nesting means a tree, a breadcrumb trail and
  moving folders into folders; for categories of sermons it buys nothing.
  Adding `rodic` later is small — designing the interface around it is not.
- Backend: `folders` (with each folder's count and total length from one
  query), `create_folder`, `rename_folder`, `move_to_folder` (null takes a
  recording back to the root), `delete_folder(contents)`. Creating and
  renaming refuse an empty or duplicate name, because two folders with one
  name are indistinguishable on a card.
- The list shows one level: the open folder, or the root. **The exception is
  a search or a date filter** — someone looking for a recording wants it
  found, not the place they filed it, so those look across every folder and
  the folder cards step aside. That also closes the trap the analysis named:
  `visibleResults` intersects the full-text hits with the visible list, so a
  root-only list would have made search quietly stop finding what is in
  folders. It now intersects with everything while searching.
- Folders sit *under* the transcripts, as asked. Worth repeating from the
  analysis: with ten or more recordings they fall below the fold. It is one
  line to flip if that turns out to be wrong in use.
- Three dialogs, as asked. `FolderDialog` names a folder — one field, used
  for both creating and renaming, since the question is the same and only
  the heading and the button differ. Moving is a submenu on the recording's
  own menu (`Vložit do složky`), which the menu already supports for the
  language list; it offers the folders, `Nová složka…`, and `Vyjmout ze
  složky` only when the recording is in one. Deleting asks with two answers
  rather than a toggle: `Jen složku` (quiet) and `Smazat i přepisy`
  (destructive), with the count in the sentence. `ConfirmationDialog` gained
  an optional `alternative` for exactly that shape.
- Creating a folder from a recording's menu puts that recording straight
  into it — that is what the person was doing when they reached for it.
- Files: `src-tauri/src/db.rs`, `src-tauri/src/main.rs`,
  `src-tauri/src/online_import.rs`, `src-tauri/src/export.rs`,
  `src/FolderDialog.tsx` (new), `src/App.tsx`, `src/Library.tsx`,
  `src/Detail.tsx`, `src/RecordingActionsMenu.tsx`, `src/ConfirmationDialog.tsx`,
  `src/api.ts`, `src/types.ts`, `src/styles.css`,
  `src/locales/{cs,en}/{dialogs,library,errors}.ts`, `slozky-analyza.md`,
  `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (66 passed — four new: a folder reports what it holds, deleting one returns
  its recordings to the root rather than orphaning them, moving takes
  recordings in and out, and an archive upgraded from a version without the
  column gets it); `npx tsc --noEmit`; `node scripts/i18n.mjs check`
  (846/846). The folder card rendered against the real stylesheet at 2× in
  both colour schemes — 80 px tall and the same width as a recording card,
  paper yellow in both themes.
- Not built, and named in the analysis: dragging a recording onto a folder
  (it fights the window's own file drop), per-folder colours, and nesting.

### 2026-08-05 — Correcting entry: the translation guard read the wrong copy

- Found while adding the folder code: `node scripts/i18n.mjs check` reported
  a literal at `src/types.ts:142` that is not one — a font stack — and the
  reported text spanned a hundred lines of unrelated code.
- Cause: `hardcodedText` computed `withoutComments(raw)` and then ran its
  string-literal regex over **`raw`**, using the blanked copy only to test
  the match's first character. An apostrophe inside a comment — mine was
  `null is the archive's root` — opens a string in the raw text that runs to
  the next quote anywhere in the file, so one bogus match swallowed the span
  between them and reported it at the wrong line.
- The changelog entry that introduced this guard says "comments are blanked
  before scanning, with offsets preserved". Half of that was true: they were
  blanked, and the scan then ignored the blanked copy.
- Fixed: the literal scan runs over the blanked copy. A comment cannot open a
  string there, and because `withoutComments` preserves offsets and newlines
  the reported line numbers are unchanged.
- Files: `scripts/i18n.mjs`, `CLAUDE.md`.
- Verified in both directions, which is what this file keeps asking for: with
  the apostrophe restored in `types.ts` the check passes, and a throwaway
  component holding one Czech sentence still fails it with a non-zero exit.

### 2026-08-05 — The empty folder list just says it is empty

- Changed, Jakub's wording: `library.folders.empty` is `Zatím tu není žádná
  složka.` English follows with `No folders here yet.`
- Supersedes `Zatím žádná složka. Hodí se, až se přepisy začnou hromadit.`
  written a few minutes earlier. The second sentence sold the feature to
  someone already looking at its heading and its `Nová složka` button — the
  same pattern the dictionary's `promptNote` was cut for. An empty state
  states the state.
- Files: `src/locales/cs/library.ts`, `src/locales/en/library.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The folder heading carries the same icon its cards do

- Changed: `Složky` gets the shared `folder` drawing in the sidebar's
  icon-in-a-circle, at 17 px in a 30 px circle — the geometry the module tiles
  and the sidebar's own section headings already use. A heading over a list
  looks the same wherever it stands.
- Added: `folder` to `src/icons.tsx`. Three places draw a drawer — the
  heading, the cards under it, and the recording menu's move action — and one
  registry is what keeps them from drifting into three drawings.
- Files: `src/icons.tsx`, `src/Library.tsx`, `src/RecordingActionsMenu.tsx`,
  `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — A folder card ends the way a transcript card does

- Changed, Jakub's call: the folder row's actions are `Otevřít` and then the
  same three dots a recording has. The `Přejmenovat` button and the lone trash
  icon are gone; both live in the menu, renaming with the pencil and deleting
  in the warning colour.
- Why it is the menu and not two buttons: a folder will collect more actions —
  and the point of the three dots is that the row does not have to grow a
  button each time.
- Changed: the icon's backing is a circle rather than a rounded square. Every
  other icon-in-a-surface in this interface is round; the card was the one
  place that was not.
- Changed: the breadcrumb over an open folder says what it holds with the same
  two icons the folder's own card uses — the card is what the breadcrumb
  replaced, so it should not say the same fact in a different shape. It gained
  the total length beside the count, which the card had and the crumb did not.
- Structural: `ActionMenu` and its icon table are exported from
  `RecordingActionsMenu`, so the folder menu is the recording menu's own
  surface with different items, not a second implementation of a dropdown.
- Files: `src/Library.tsx`, `src/RecordingActionsMenu.tsx`, `src/styles.css`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the real
  `ActionMenu`, `LineIcon` and `RecordingMetadataIcon` bundled with esbuild and
  driven in a browser against the real stylesheet at 2× — the mark measures a
  50 % radius, the row keeps the transcript card's height, and the menu opens
  with both items.

### 2026-08-05 — The move submenu says which item is an action

- Changed: every item under `Vložit do složky` carries an icon — the folders
  their own drawer, `Nová složka…` a drawer with a plus, `Vyjmout ze složky` a
  drawer with an arrow lifting out of it.
- Why all three and not only the one Jakub named: a menu where one item has an
  icon and the rest do not starts its labels at two different places. Giving
  the folder names the plain drawer keeps one column and still leaves the two
  actions distinguishable, because the plus and the arrow are what they add.
- The two action icons are built from `LINE_ICONS.folder` plus one stroke, so
  they cannot drift away from the drawer everything else draws.
- Files: `src/RecordingActionsMenu.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; the real menu bundled and opened in a browser
  against the real stylesheet at 2×, with a recording that is already in a
  folder so all three shapes appear at once.

### 2026-08-05 — Deleting a folder says it in Jakub's words

- Copy: `Složka obsahuje {count} přepisy. Můžeš je přesunout do archivu, nebo
  smazat spolu se složkou.` in all four Czech forms, and the destructive button
  is `Včetně přepisů` instead of `Smazat i přepisy`.
- Why the button is better short: it sits beside `Jen složku`, and the two
  answer one question — *what goes* — so each only has to name its own extent.
  `Smazat` was the verb of the heading repeated in one of its two answers.
- English follows: `The folder holds … You can move them to the archive, or
  delete them along with the folder.` / `Including transcripts`.
- Files: `src/locales/cs/dialogs.ts`, `src/locales/en/dialogs.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — A transcript is renamed in the same dialog as a folder

- Changed, Jakub's ask: renaming a recording opens the naming dialog rather
  than turning a row or a header into a field. Both places that could rename —
  the archive card and the transcript header — now use it.
- Renamed: `FolderDialog` → `NameDialog`, and the words come from the caller
  instead of being derived from the arguments. The old version decided between
  creating and renaming by whether `initialName` was empty, which is a safe
  reading for a folder and a wrong one for a recording: a title may legitimately
  be empty, and the dialog would then have offered to *create* something.
- What this removes, and it is the reason beyond consistency: two hand-built
  inline editors, each with its own Escape handling, its own blur-saves rule
  and its own fallback for an empty name. The header's needed a `renameCancelled`
  ref purely because Escape blurs the field on its way out and the blur would
  otherwise save the draft it was meant to discard. None of that exists in a
  dialog with a Cancel and a Save.
- Copy: `dialogs.rename.{title,text,label,placeholder}`. The text says what the
  rename does *not* touch — `Změní se název v archivu. Zvukový soubor na disku
  zůstane, jak se jmenuje.` — which is the one thing about renaming worth
  stating. `detail.header.titleLabel` is gone; the dialog's own label replaced
  it.
- Removed with them: `.radek-prejmenovani`, `.radek-prejmenovani-obal` and
  `.detail-title-rename`, plus `titleDraft` and `newTitle` — a draft is the
  dialog's business now.
- Files: `src/NameDialog.tsx` (was `src/FolderDialog.tsx`), `src/App.tsx`,
  `src/Library.tsx`, `src/Detail.tsx`, `src/styles.css`,
  `src/locales/{cs,en}/{dialogs,detail}.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (879 keys, no
  stale keys); the real `NameDialog` bundled with esbuild and opened in a
  browser against the real stylesheet at 2× — heading, sentence, labelled field
  and the Cancel/Save pair, with Save disabled on an empty name.

### 2026-08-05 — The interface vyká

- Changed: every Czech string the user reads addresses them formally. The
  copy had been mixed since the beginning — the watched-folder notice asked
  `Chcete je přidat…` two lines above `Křížkem soubor odstraníš` — and the
  localization entry from 2026-08-03 listed that mixture as open.
- Style, Jakub's choice: vykání where the interface actually addresses someone
  (prompts, questions, buttons), impersonal everywhere else. `Přepis se spustí
  automaticky.` was already right and did not change; `Sem přetáhni nahrávku`
  became `Sem přetáhněte nahrávku`.
- Register followed: `tenhle`, `tahle`, `tomhle`, `téhle` are colloquial beside
  formal address, so they are `tento`, `tato`, `tomto`, `této`. Nothing else
  about the wording changed.
- One sentence got better than a mechanical conversion: `V tomhle přepisu jsi
  zatím nic neopravil.` is now `V tomto přepisu zatím žádná oprava není.` The
  old one was masculine-only — `neopravil` has no form that fits every reader,
  and the impersonal sentence sidesteps the question rather than picking a
  gender.
- Added: `informalAddress()` in `scripts/i18n.mjs`, run by `i18n:check` and
  therefore by `npm run build`. It reads only the value maps of
  `src/locales/cs/*.ts` — the `*Context` notes speak to a translator and
  address them informally on purpose — and reports the file, the line and the
  offending word. Three signals: the singular pronouns and possessives, the
  singular auxiliary (`jsi`, `sis`, `ses`), a named list of singular
  imperatives, and any word ending in `-eš`/`-íš`/`-áš` that is not in a short
  list of adverbs and nouns that share those endings (`výš`, `spíš`,
  `nejspíš`, `koš`…). A deliberate exception takes the existing
  `i18n-ignore: reason` comment.
- Not touched, and worth knowing why: the Czech instructions in
  `ai_edit.rs` still use tykání. They address the language model, not the
  reader, and they were tuned by measurement against real transcripts —
  rewording them would mean re-running those tests for no user-visible gain.
  English is unchanged as well: it has no T–V distinction, so `you` was
  already the right and only form.
- Files: `src/locales/cs/{app,library,detail,dialogs,settings,wizard,errors}.ts`,
  `scripts/i18n.mjs`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (879 keys, no
  problems). The guard was proven by making it fail rather than by watching it
  pass — three informal strings were put back into `detail.ts`, one per signal
  (`tvůj`, the imperative `Vyber`, the verb `můžeš`), and the check reported
  all three with their line numbers and exited non-zero; restoring them
  returned it to zero. A separate scan for colloquial leftovers
  (`tenhle`, `bys`, `musíš`, `víš`…) across all twelve value maps came back
  empty.

### 2026-08-05 — Three quality tiers, one vocabulary: Precizní, Vyvážený, Rychlý

- Copy, Jakub's: `Precizní` — `Nejpřesnější čeština, nejnáročnější model.
  (3,1 GB)`; `Vyvážený` — `Srovnatelná kvalita, třetinová náročnost.
  (1,1 GB)`; `Rychlý` — `Občas méně přesný, několikanásobně rychlejší.
  (575 MB)`. The sizes he wrote as `xxxGB` are the real ones already in the
  dictionary.
- Why the descriptions are better than what they replaced: the old ones
  measured the model (`největší a nejpomalejší`, `třetinová velikost`), which
  is the wrong axis — nobody chooses a transcript model by how much disk it
  takes. `Náročnost` names what the choice actually costs, and the middle tier
  now says what it is for: the same result for a third of the work.
- Changed beyond the three lines asked for, for one vocabulary rather than
  three: the wizard's quality cards were `Nejrychlejší / Vyvážené / Nejlepší
  kvalita` and the download list said `Model s nejvyšší kvalitou`. All three
  places now use the same three words, so the model chosen in the wizard is
  recognisable in Settings under the same name. Say the word and the wizard
  and the catalogue go back.
- Punctuation followed through: every model description now ends its sentence
  before the size — `… nedoporučuje se. (1,5 GB)`. Four older entries used to
  run the size straight onto the clause.
- `i18n:check` now reports three more texts under several keys. That is the
  point of the change and not a defect: `Precizní` is deliberately the same
  word in the wizard and in Settings. `Nejlepší kvalita` stays on the language
  editing models — a different family, chosen on a different screen.
- Files: `src/locales/{cs,en}/{domain,wizard,catalog}.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (879 keys, no
  problems, no informal address). Not rendered: this is copy inside existing
  cards, and each new line is shorter than the one it replaces (48 characters
  against 54 for the longest) — worth one glance on the real machine to be
  certain nothing wraps differently.

### 2026-08-05 — Jeden vizuální systém: dialogy, pole, tlačítka, rytmus

- What Jakub saw: in `Nová složka` the field label sat 2 px under the sentence,
  closer to it than the sentence was to its own heading. His ask was wider than
  that one dialog: go through the interface and stop the styles jumping from
  screen to screen.
- How: six read-only audits in parallel (dialogs, fields, typography, buttons,
  surfaces, spacing), one synthesis, then one skeptical reviewer per proposed
  change whose job was to refute it. That last phase earned its cost — see the
  corrections below.
- **The reported defect.** `.dialog h2 + p` had `margin-bottom: 2px` and the
  real gap was whatever the content block brought with it: 18, 18, 18, 20 and
  16 px in five dialogs, and nothing at all in the two that had no content
  block of their own — `Nová složka` and `Přejmenovat`. The gap now belongs to
  the dialog (18 px) and every content block lost its `margin-top`. Measured
  before and after in a browser: 4 / 2 / 8 / 24 px became 4 / 18 / 8 / 22.
- **What the reviewers caught, and it would have shipped:** the plan wanted
  `.dialog > h2 + p`. In the online view of `Přidat nahrávku` the heading and
  the sentence sit inside a `<form>`, so the child combinator would have missed
  them — and since the same change zeroes `.add-recording-url`'s own 20 px,
  that dialog would have ended with the label 0 px under the sentence: a worse
  version of the exact bug being fixed. Descendant it is, with
  `.ai-preview-header h2 + p { margin-bottom: 0 }` to keep the fixed-height
  reading header from stretching.
- **A dead colour.** `.mluvci-podil` asked for `var(--text-2)`, which is defined
  nowhere. An invalid `var()` without a fallback drops the declaration, so the
  speaker's share of talking time was drawn in full text colour — as loud as the
  name beside it. Now `--text-tichy`, like every other secondary number.
- **Widths, fields, controls.** Four dialog widths (420/430/500/520) became two.
  The URL field was a hand-copied duplicate of the shared field rule differing
  in one value (40 px against 38) — deleted, and `input[type="url"]` joined the
  shared selector where it belonged. `.ai-document-tabs` lost a `min-height`
  that contradicted the comment two lines above the primitive it overrode, so
  the document tabs, the version switch and the language select in one dialog
  are now one height instead of three (40/36/34 → 36). The transcript menu's
  three dots went from 30 px to the 32 px every other circular icon button has.
  The reading window's five inner blocks moved from a 22 px inset to the
  dialog's own 26 px.
- **Typography closed to one scale:** weights 720/750 → 700, the wizard's
  27 px screen heading → 28 px like Settings', its 14.5 px intro → 14 px with
  the shared line height, two micro-labels (10 px/750, 12 px) → 11 px/700/0.09em.
- **Five rules that could never win were deleted** — `.nenapadny`,
  `.odebrat-vyraz*`, `.nastaveni section { margin-bottom }` with the rule that
  cancelled it, `.postranni section { margin-bottom }`, `.pole .vypinac`. Each
  was verified dead by its neutralising rule or by having no user in the JSX.
  Two numbers for one gap are how the wrong one gets edited next time.
- **Also:** a folder card now answers the keyboard (`:focus-within`) the way it
  answers the mouse, and the save menu's rows took the 12 px side padding the
  project's own action menus use.
- **Deliberately rejected** (the audit proposed them, the reasoning did not
  hold): rebuilding playback speed as a segmented control (a component swap, not
  a value); closing the 13–13.5 px helper band, which CLAUDE.md declares as
  intentional; unifying the calendar's radii and its 10.5 px weekday labels,
  where the smaller values are proportional to a 38 px tile and a 292 px
  popover; folding `.settings-tabs` into the segmented control, which would
  change the main navigation rather than align a number; and dropping
  `.settings-toggle:not(.section) .settings-info-note` entirely — the reviewer
  proved that would glue the description to its title in two places, so it was
  changed from 7 px to 8 px instead.
- Files: `src/styles.css` (42 edits), `src/SpeakerCountDialog.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; braces balanced;
  and measured in a browser against the real stylesheet with the real
  components — the folder dialog (4/18/8/22), the online view whose heading is
  inside a form (18 px, field 38 px), the speaker dialog (18 px, 14 px sentence,
  input and buttons both 34 px), the reading header (unstretched at 82.8 px,
  header and tabs flush at the same 26 px inset, both strips 36 px), and
  Settings (16 px between cards, 8 px from field to note).

### 2026-08-05 — The take's spectrum says what is behind the dot

- Changed, Jakub's ask: in the recorder's preview the bars behind the position
  dot are the accent colour and the ones ahead of it stay grey, exactly as the
  transport bar under a transcript already works. While recording every bar
  stays accent — there is no position yet, and the colour is what says the
  microphone hears something.
- Shared rather than copied: `SLIDER_THUMB` and `handleRatio()` moved into
  `player.tsx` and `PlaybackControls` now imports them instead of keeping its
  own `THUMB = 13`. The dot's centre is inset by its own radius at both ends,
  so the coloured bars and the dot would drift apart at the ends if either side
  computed it alone. `Waveform` gained `playedRatio`/`playedColor`, forwarding
  to what `drawBars` could already do; the accent is read from CSS and cached
  for 500 ms, because reading a custom property forces a style recalculation
  and this draws every frame.
- **Fixed underneath, and it is the more interesting half.** `.mic-spektrum`
  had `transition: color`. A canvas samples that colour only when it happens to
  repaint — and the recorder's spectrum stops repainting at the very moment the
  take ends. The strip therefore froze mid-transition and stayed accent-blue
  for good, which is why "all the bars are blue" was true even after the class
  had changed. The transition is gone; a canvas cannot animate a CSS colour.
- Also: `className` is now a dependency of the drawing effect. The colour comes
  from CSS, so a class change is a reason to repaint — without it the canvas
  keeps the old colour whenever the values stop arriving.
- Files: `src/player.tsx`, `src/PlaybackControls.tsx`, `src/AddRecordingDialog.tsx`,
  `src/styles.css`, `CLAUDE.md`.
- Verified: the real dialog bundled with esbuild and driven in a browser with a
  fake microphone — record, stop, drag the dot. Pixels counted on the canvas:
  at the start 854 grey against 16 accent (the handle's own inset), with the dot
  at half 496 accent left and 434 grey right. The stale-colour defect was found
  by that count disagreeing with the code, then confirmed by logging the colour
  `drawBars` actually resolved: `rgb(26, 110, 255)` while the element's computed
  colour was already grey.

### 2026-08-05 — The watched folder can transcribe on its own

- Added, Jakub's ask: a second switch under `Sledovaná složka` —
  `Přepisovat rovnou`. With it on, a file that appears in the folder is added to
  the archive and its transcription starts without the Archive asking first.
  Off by default, and switchable only while watching is on.
- Supersedes, as an opt-in, the rule from `Watched files require a decision in
  the Archive`: that decision stays the default and the notice is unchanged. The
  switch is for the case that entry did not cover — the files arrive while
  nobody is looking at the screen.
- Deliberate difference from every other transcription: the automatic path does
  **not** ask how many people speak. It uses the number stored in Settings. A
  question nobody is there to answer would hold the whole batch, and an import
  that opens a modal is not automatic. Everything else — the two-scan stability
  wait, the ignore ledger, the busy guard — is unchanged.
- Data: `settings.watch_folder_auto`, `#[serde(default)]` so an upgraded
  settings file reads as off.
- Files: `src-tauri/src/db.rs`, `src/App.tsx`, `src/Settings.tsx`,
  `src/types.ts`, `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (66 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs check`. Not exercised
  end to end here — that needs a real folder on Windows; the first run should
  drop a file into the watched folder with the switch on and see the transcript
  start without a prompt.

### 2026-08-05 — The take records its own envelope, so it has peaks while it stands

- Changed, Jakub's ask (the transport bar under a transcript shows its peaks
  with the audio stopped — do the same here): the finished take's strip is no
  longer a live analyser. While it runs, the recorder writes down what it
  sounded like — ten frames a second, 48 bands, 0–255 — and the preview draws
  that through `equalizerAtTime` at whatever position the dot stands on. Exactly
  what `PlaybackControls` does with a stored recording's envelope, from the same
  function and the same shape of data.
- Why it was flat before: a live analyser has nothing to say while the playback
  is paused, so the strip fell to its minimum stubs and read as broken rather
  than as stopped. Now the picture belongs to the take, not to whether anything
  is playing.
- Nothing is recorded while the take is suspended (sound started elsewhere and
  the take is waiting), because its clock does not advance then either. The
  frames and the clock must agree or the dot would point into the wrong part of
  the picture.
- Removed with it: the playback analyser, its `AudioContext` and the second
  frame loop that sampled it. Playing the take back now needs an `Audio`
  element and nothing else; one loop remains, and it only moves the position —
  the picture follows from that.
- Files: `src/recorder.tsx`, `src/AddRecordingDialog.tsx`, `CLAUDE.md`.
- Verified: the real dialog bundled and driven in a browser with a fake
  microphone. Stopped at position 0 the canvas has 1,646 painted pixels across
  15 distinct column heights — real peaks; before this change the same state
  drew 992 pixels of uniform stubs. Seeking to 60 % gives 8,320 accent pixels
  behind the dot and 1,854 grey ahead of it, with the audio not playing.

### 2026-08-05 — Two corrections in Settings

- Removed: `Režim: Grafická karta (Vulkan) · NVIDIA ne · Vulkan ano` under the
  acceleration cards, per Jakub — it repeated the card that is already marked
  `používá se` and then listed two drivers as `ano`/`ne`, which is a diagnostic
  and not a setting. The cards themselves already say which backends the
  machine has: a missing one offers `Stáhnout` instead of being selectable.
  Three keys went with it.
- Moved: `Detekce řeči` is now the last control in the transcription card.
  Jakub asked for the items under it to collapse when it is off, the way other
  toggles' fields do — but the two things under it were `Důkladnost hledání`
  and the decoding disclosure, which are Whisper's and apply whether speech
  detection runs or not. Hiding them would have hidden settings that still
  work; standing above them, the toggle claimed them. Now it owns nothing,
  which is the truth, and there is nothing left under it to collapse.
- Files: `src/Settings.tsx`, `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (no unused keys
  left behind by the removal).

### 2026-08-05 — A file added while standing in a folder lands in that folder

- Fixed, Jakub's ask: dropping a file into the window while a folder is open
  put the recording in the root, where the open folder cannot show it. It
  looked like nothing had been added at all — the notice said a recording had
  arrived and the list stayed empty.
- Changed: every recording created by hand goes into the open folder — a
  dropped file, one chosen from the picker, an online import, and a microphone
  take. The archive shows one level at a time, so the place the person is
  standing in is the place they mean.
- Not the watched folder, deliberately: those files arrive without anybody
  standing anywhere, and they would then land in whichever folder happened to
  be open at that second. They keep going to the root, and its notice keeps
  offering them.
- The move is a separate step after the recording exists, and a failed move is
  reported without touching the recording: it is already in the archive, only
  its place did not take.
- Implementation note: the handlers that add recordings are created above the
  folder state, so they read it through `openFolderRef` — the same pattern the
  automatic-transcription switch already uses. A dependency on the state itself
  would be a temporal dead zone at render, not a stale value.
- Files: `src/App.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; every path that
  creates a recording was read against the change — the drop listener and the
  picker both go through `acceptFiles`, and the dialog's two other outcomes
  have their own call. Not exercised end to end: adding a file needs the real
  application, so the first run should open a folder and drop something into
  the window.

### 2026-08-05 — Shorter sentence about the folders with programs and models

- Copy, Jakub's: `Programy i modely se stahují samy. Cestu měňte jen v případě
  potřeby.` The old second half — `jen když je potřebujete mít jinde` — spelled
  out a reason nobody needs spelled out; whoever changes that path knows why.
- English follows: `Change the path only if you need to.`
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — Search and the date filter follow the level they are used on

- Changed, Jakub's rule: in the root of the archive a search or a date filter
  reaches across every folder, as before. Inside an open folder they now stay
  inside it.
- Supersedes the paragraph in `slozky-analyza.md` (5.1) and the rule shipped
  with the folders, where a filter always went global. That was right for the
  root and wrong for a folder: someone who opened a drawer and typed into the
  search box is looking in that drawer, and a hit from somewhere else takes
  them out of the place they are standing in.
- The full-text search needed no change of its own. Results are intersected
  with the visible list, so scoping that list scopes the search with it — the
  same line that keeps a root search finding what sits in folders.
- Copy: inside a folder with a filter that matches nothing, the empty state is
  now `Tomuto filtru neodpovídá žádná nahrávka.` It used to say the folder is
  empty and offer to move a transcript into it, which was false — the folder
  has recordings, the filter hides them. The sentence about moving one in is
  kept for a folder that really is empty.
- Files: `src/Library.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; and the real
  `Library` bundled with esbuild and driven in a browser over five recordings
  in three folders — root without a filter shows the two loose recordings and
  the folder cards; root with `Dnes` shows all three of today's recordings
  across folders and hides the cards; inside `Kázání` the list is its two
  recordings, and with `Dnes` exactly the one of them from today (the other
  two recordings from today, which live elsewhere, do not appear); a folder
  whose only recording is older shows the filter's sentence rather than the
  empty-folder one. The search box itself needs the backend, so that half was
  read against the code rather than driven.

### 2026-08-05 — With speech detection off, the fine tuning is not offered

- Changed, Jakub's call after seeing it on screen: `Jemné ladění přepisu` is
  hidden while `Detekce řeči` is off. It sits directly under that toggle, so
  leaving it there said the two were unrelated — and one of its five values,
  `Práh ticha`, is a question about exactly the detection that is not running.
- Supersedes the reasoning in the entry from earlier today, which moved the
  toggle to the end of the card and argued the thresholds are Whisper's and
  should stay put. The move stands; not showing them is now the answer to what
  the toggle owns.
- Worth knowing: the values are not reset and Whisper still reads them. What
  disappears is the offer to change them.
- Files: `src/Settings.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The speakers description says only what the switch does

- Copy, Jakub's: `settings.speakers.description` drops its second sentence and
  reads `Rozdělí text mezi jednotlivé mluvčí už při prvním přepisu.` Nobody
  needs telling that separating speakers is pointless on a recording with one
  of them.
- English follows.
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — A slider is grabbed, not filled in

- Fixed, Jakub's ask: dragging a slider in Settings lit a pale blue halo around
  it. The rule that does that is `.pole input:focus` — written for text fields,
  and a range input matched it too. It now excludes `[type="range"]`.
- Kept: the keyboard ring. The global `:focus-visible` rule still gives the
  slider its outline, and a browser does not treat a pointer drag on a range as
  focus-visible, so the halo is gone exactly where it was noise and stays
  exactly where it is the only way to see where the focus stands.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: measured in a browser against the real stylesheet — after a mouse
  drag the slider's computed `box-shadow` is `none` and its value did change
  (5 → 6); after Tab it is the 2 px focus ring; a text field beside it still
  shows the blue field halo.

### 2026-08-05 — The notice bar counts itself down

- Added, Jakub's ask: the ring from the `Uloženo` pill in Settings now opens
  the notice bar at the top of the window and empties over the seconds the bar
  has left — five for a confirmation, nine for an error. A bar that disappears
  on its own should say that it is going to, and roughly when.
- Shared, not copied: `src/CountdownRing.tsx` holds the drawing, and the CSS
  keyframes moved from `.ulozeno-odpocet-drah` to a plain `.odpocet-drah`. The
  ring knows how to empty; how long it takes belongs to whatever it sits in.
- One number, not two: the lifetime is `NOTICE_LIFE` in `App`, used by the
  timer that hides the bar and handed to the ring as `--notice-life`. The
  stylesheet keeps a 5 s fallback for a bar rendered without it. A bar already
  on its way out stops the countdown — there is nothing left to count.
- Files: `src/CountdownRing.tsx` (new), `src/App.tsx`, `src/Settings.tsx`,
  `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; and both bars
  rendered against the real stylesheet with the real component — the confirmation's
  ring reads a 5 s animation and is empty (offset 40.2 of 40.2) by five seconds,
  the error's reads 9 s and is at 22.6 at the same moment. No occurrence of the
  old `ulozeno-odpocet` class remains.

### 2026-08-05 — More air between archive cards

- Changed, Jakub's ask: the gap between blocks in the archive goes 8 → 12 px in
  the roomy list and 5 → 8 px in the compact one. An 85 px card with a border of
  its own needs the room to read as a separate block; at 8 px the list read as
  one ruled table. Folder cards share `.seznam`, so they follow.
- Preserve the difference between the two lists: the compact one exists to fit
  more on screen, so it stays tighter than the roomy one rather than matching
  it.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Library` rendered against the real stylesheet at 2× and
  measured — 12 px between the roomy cards (85 px tall), 8 px between the
  compact ones (56 px tall). Easy to take back: it is one number in one rule.

### 2026-08-05 — The online-video card gets an icon that survives being small

- Fixed, Jakub's report: the `Online video` card drew a chain link — two arcs
  meeting at a diagonal bar. At 19 px the two halves read as two disconnected
  hooks; it looked broken because, at that size, it was.
- Changed: a screen with a play mark in it, added to `src/icons.tsx` as `video`
  and drawn through `LineIcon`. It goes in the shared registry rather than
  inline in the dialog, so the next place that needs the idea gets the same
  drawing — the rule that already applies to the folder and the waveform.
- Files: `src/icons.tsx`, `src/AddRecordingDialog.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; all three source cards rendered against the real
  stylesheet at 3× — the new mark holds together beside the document and the
  microphone and sits at their optical weight.

### 2026-08-05 — The acceleration list names the hardware and goes from slowest up

- Copy, Jakub's: `Automaticky`, `Procesor (CPU)`, `Grafická karta (Vulkan)`,
  `Grafická karta Nvidia (CUDA)`. The old labels named the technology first
  (`NVIDIA (CUDA)`, `Procesor`) and left the reader to know that CUDA means an
  Nvidia card; now the hardware comes first and the abbreviation stands in
  brackets as the detail it is. English follows.
- Changed: the order is `auto, cpu, vulkan, cuda` — the same list read from the
  slowest to the fastest, rather than the former auto/cuda/vulkan/cpu.
- Copy: the CUDA description drops its first sentence. `Grafická karta NVIDIA.`
  said what the label now says; what is left is the reason to pick it —
  `Nejrychlejší, když ji počítač má.`
- The spelling is Jakub's: `Nvidia` in this label, while `NVIDIA` remains
  uninflected in the Vulkan description, where an earlier entry recorded it as
  his choice.
- Files: `src/Settings.tsx`, `src/locales/{cs,en}/{domain,settings}.ts`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the four cards
  rendered against the real stylesheet at 2× in the order above, with the
  selected one and a missing one beside each other.

### 2026-08-05 — The top language-editing quality is Nejvyšší kvalita

- Copy, Jakub's: the best of the three language-editing models reads
  `Nejvyšší kvalita` instead of `Nejlepší kvalita`, in Settings and in the
  wizard. English follows with `Highest quality`.
- The name became free when the transcription models were renamed to
  `Precizní / Vyvážený / Rychlý` earlier today; it was the old label of the
  largest Whisper model.
- Left alone: `catalog.editor-model-best.name` is `Nejlepší jazyková úprava` —
  a different construction naming a download, not the quality tier. Say the
  word if it should follow.
- Files: `src/locales/{cs,en}/{settings,wizard}.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The window title drops the version

- Changed, Jakub's ask: the title bar reads `Whisp — Převod řeči na text`.
- Removed with it: the `set_title` call in `setup()`. It existed only so the
  version would come from the bundle rather than being typed into
  `tauri.conf.json` a second time; with the number gone the title is a constant
  and belongs in the config, where it already stood. Nothing sets it at runtime
  now.
- Still true, and it is the cost of a static title: it stays Czech with the
  interface in English. Making it follow the language would mean setting it
  from the frontend, which needs `core:window:allow-set-title` in the
  capabilities.
- Files: `src-tauri/src/main.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (66 passed).

### 2026-08-05 — An open folder carries its own actions

- Added, Jakub's ask: the three dots sit after the folder's name in the
  breadcrumb, with the same two items its card has — `Přejmenovat` and
  `Smazat složku`. Inside a folder its card is not on screen, so this was the
  only place from which the folder itself could not be acted on.
- Placed with the name rather than at the end of the row: the menu acts on the
  folder, while the facts after it (`2 přepisy · 1 h 20 min`) are about its
  contents.
- The same `ActionMenu` and the same icons as the card, at the 30 px trigger
  the transcript header uses — one menu, three places.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; the real `Library` rendered against the real
  stylesheet at 2× with a folder open — the row reads back-button, name, menu,
  facts; the trigger measures 30 px and sits 10 px after the name; the menu
  opens with both items and the destructive one in its colour.

### 2026-08-05 — Wizard quality copy, and the download marks sit in the middle

- Copy, Jakub's, on the wizard's quality step: `Přibližně jedna chyba na
  odstavec.` is now `Asi jedna chyba na odstavec.`, and the best option's
  `Nejvyšší dosažitelná přesnost českého přepisu.` drops `českého` — the
  sentence is about the model, and it is the most accurate whatever the
  language. English follows with `The highest accuracy available.`
- The names on that step are already `Rychlý / Vyvážený / Precizní` from this
  morning, and `{duration}` still comes from the machine's own estimate.
- Changed: the green download mark in the manual component list is centred
  against the whole row rather than sitting on its first line. The checkbox
  keeps the top — it belongs to the title beside it, while the mark is about
  the component as a whole.
- Files: `src/locales/{cs,en}/wizard.ts`, `src/styles.css`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the list rendered
  against the real stylesheet at 2× and measured — every mark's centre is
  exactly on its row's centre (deviation 0.0 px across four rows).

### 2026-08-05 — Finishing the wizard lands in the Archive

- Changed, Jakub's ask: `Jdeme přepisovat` on the wizard's last step goes to the
  Archive, whatever screen the wizard was opened from. It used to return to the
  origin — Settings, if that is where it started — which contradicted the words
  on the button.
- Supersedes half of `Module wizard returns to its origin`: that rule still
  holds for `Zpět` and for the header's back action, which are about leaving.
  Finishing is a different thing and now has its own path (`finishWizard`
  beside `leaveWizard`).
- It reloads the tool check, the settings snapshot and the recordings on the
  way — a wizard run can change which model, backend and modules the Archive's
  footer and its cards describe.
- Files: `src/App.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; both callers read
  against the change — `onBack` and the header's back button still use
  `leaveWizard`, only `onComplete` uses the new path.

### 2026-08-05 — Deleting a transcript gets an eraser, and the two re-runs stand together

- Changed, Jakub's call: `Přepsat v jazyce` moves from near the bottom of the
  recording menu to directly under `Přepsat znovu`. They are the same act with
  one extra decision, and a submenu's worth of folders and an export stood
  between them.
- Changed: `Smazat přepis` is drawn as an eraser instead of a document with a
  cross. What goes is the text; the recording stays in the archive. The trash
  can belongs to `Odebrat z archivu` two items below, and two crossed-out
  documents beside a bin made the difference between them a reading exercise.
- On the redundancy Jakub flagged: the item is not quite a duplicate — the
  language in Settings is the standing choice for every new transcription,
  while this one forces a language for this recording alone, without changing
  anything. It is worth keeping for exactly that, and it now sits where its
  meaning is obvious.
- Files: `src/RecordingActionsMenu.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; the real menu rendered against the real
  stylesheet at 3× — the order reads rename, transcribe again, transcribe in
  language, delete transcript, move to folder, save audio, remove from archive,
  and the eraser is legible beside the bin at menu size.

### 2026-08-05 — The watched folder's second switch appears when there is something to decide

- Fixed, Jakub's report: `Sledovat složku` and `Přepisovat rovnou` sat on top of
  each other with no room between them — two adjacent `.settings-toggle`
  elements had no spacing rule at all, only the field-to-toggle pairs did.
  They now have 20 px between them, and no divider: the second belongs to the
  first, and a rule would say they are independent.
- Changed: the second switch is shown only while watching is on. What to do
  with what the folder finds is not a question until something is finding it —
  and a permanently disabled control is a worse answer than no control.
- Files: `src/Settings.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the card rendered against the real stylesheet at 2× in both states
  — 20 px between the two switches with watching on, one switch and no gap left
  behind with it off.

### 2026-08-05 — Models and Performance are two tabs

- Changed, Jakub's ask: Settings reads `Přepis · Slovník · Modely · Výkon ·
  Vzhled · Soubory`. `Modely a výkon` was one tab whose own name admitted it
  held two questions — what is installed, and what it should run on.
- `Modely` holds the component tiles, the route to the downloader, the
  technical details, and the two folders those components live in. `Výkon`
  holds the acceleration cards, the thread count and the speed test.
- The red dot that marks a missing component moved with the tiles to `Modely`.
- Copy: `Složka s programy` → `Složka nástrojů`, and the English `Programs
  folder` → `Tools folder`. `Složka s modely` → `Složka modelů`.
- Files: `src/Settings.tsx`, `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the tab row
  rendered against the real stylesheet at 2× — six tabs in the order above,
  with the alert dot on `Modely`.

### 2026-08-05 — Two shorter sentences in the wizard

- Copy, Jakub's: the quality step is headed `Rychle, nebo přesně?` — the
  opening `Bude to` said nothing the question did not. The speakers step reads
  `Pokud mluví víc lidí, aplikace rozdělí text mezi ně.` instead of `Když v
  nahrávce mluví víc lidí, aplikace je umí rozlišit a text rozdělit mezi ně.`;
  `v nahrávce` is where the wizard already is, and `umí rozlišit a rozdělit`
  says one thing twice.
- English follows: `If several people speak, the app splits the text between
  them.` The quality heading stays `Fast or accurate?`, which was already the
  short form.
- Files: `src/locales/{cs,en}/wizard.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The language-editing step keeps its promise in fewer words

- Copy, Jakub's: `Zachová původní přepis a nic neposílá ven.` instead of
  `Původní přepis zachová a nic neposílá z počítače.` The verb comes first, as
  it does in the sentence before it, and `ven` is enough — the reader is being
  told nothing leaves, and where it would leave from is the computer they are
  sitting at.
- English follows: `It keeps the original transcript and sends nothing out.`
- Files: `src/locales/{cs,en}/wizard.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The Saved pill floats, because most settings are further down

- Fixed, Jakub's report: changing something low on the Settings page produced
  no visible confirmation. The pill sat beside the page's title, and by the
  time anyone reaches the speaker count or the decoding thresholds that title
  is off screen — the pill appeared, counted itself down and disappeared where
  nobody could see it.
- Changed: it is fixed to the window's lower right corner, 22 px from both
  edges, with the panel shadow and a hairline so it reads as floating rather
  than pasted onto a card. Same pill, same countdown ring, same 1.4 s; only its
  position no longer depends on where the page is scrolled. It enters from
  below now instead of from above, which is where it comes from.
- Not made sticky instead: `Settings tabs stay in the normal page flow` removed
  the last sticky layer from this screen on purpose, and a sticky header would
  bring it back for the sake of one pill.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real pill rendered against the real stylesheet at 2× — scrolled
  to the bottom of a long Settings page, a change in the last card shows it at
  opacity 1, inside the viewport, 22 px from the bottom and the right.

### 2026-08-05 — Model cards read Rychlý, Vyvážený, Precizní

- Fixed, Jakub's ask: the models on the transcription tab appeared in the order
  the backend found them, which is `list_models` sorting file names — so
  `large-v3` came before `large-v3-turbo-q5_0` because of an alphabet nobody
  reads. They are now shown fastest first: Rychlý, Vyvážený, Precizní, then the
  older generation.
- `MODEL_IDS` in `types.ts` is that order and is now what sorts the cards;
  a model the interface does not know by name still appears, at the end, and
  keeps its raw identifier. The backend keeps sorting by name — a file list is
  its business; the order they are offered in is the interface's.
- Copy, Jakub's: the note under the cards is `Zobrazuje pouze stažené modely.`
  instead of `Jen stažené modely. Další přidáte v sekci Modely.`, and it is an
  `InfoNote` now — with the shared blue icon, like every other explanatory
  sentence in Settings. The second half went with the split of the tabs: the
  route to more models is the `Modely` tab, which is now a tab and not a
  paragraph's promise. English: `Shows downloaded models only.`
- Files: `src/types.ts`, `src/Settings.tsx`, `src/locales/{cs,en}/settings.ts`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the comparator
  run over a list as the backend delivers it (alphabetical, including an
  unknown id) returns turbo-q5_0, q5_0, large-v3, medium, unknown.

### 2026-08-05 — Field notes all carry the same icon

- Changed, Jakub's ask about the language note, applied to its siblings so the
  card does not have two kinds of sentence: the notes under the transcription
  language, the thread count, the speaker count, the speaker-change search and
  the interface language are `InfoNote`s now, with the shared blue circle, like
  the search-thoroughness note that already stood among them.
- Deliberately not converted, and this is the line: `Měňte jen při konkrétním
  problému.` introduces the fine-tuning disclosure rather than explaining one
  control, and the five sentences under its sliders sit in a block where every
  line is explanatory — a mark that says "this one explains something" tells
  the reader nothing when everything around it does too. The dictionary's empty
  state and the portable-mode path are not notes either.
- Files: `src/Settings.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; rendered against
  the real stylesheet at 2× — the converted note and the one that was already
  an `InfoNote` share the same left edge for their icons (79 px) and the same
  8 px under their control.

### 2026-08-05 — Language and speech detection get their own card

- Changed, Jakub's ask: the transcription tab is two cards. `Přepis` holds the
  model and the search thoroughness — what reads the recording. The new
  `Jazyk a detekce řeči` holds the language, the speech-detection switch and
  the fine tuning under it — what is in the recording and what counts as speech
  in it.
- The fine tuning went with the switch that governs it: they are the same
  subject at a finer grain, and it is hidden when the switch is off, so the two
  could not be split across cards without one hiding the other from a distance.
- The tab's order is set in CSS (`order` on each card), so it reads model →
  recording → speakers → language editing whatever order the JSX declares.
- Copy: `Jazyk a detekce řeči`, `Čím se v nahrávce mluví a co se v ní má
  považovat za řeč.` English: `Language and speech detection`.
- Files: `src/Settings.tsx`, `src/styles.css`, `src/locales/{cs,en}/settings.ts`,
  `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; both cards
  rendered against the real stylesheet at 2× in their order.

### 2026-08-05 — Slovník moves behind Vzhled

- Changed, Jakub's ask: the Settings tabs read `Přepis · Modely · Výkon ·
  Vzhled · Slovník · Soubory`.
- Files: `src/Settings.tsx`, `CLAUDE.md`.

### 2026-08-05 — The three language-editing models are told apart by counting

- Changed, Jakub's ask (all three cards drew the same sparkle): the mark is now
  that sparkle counted out — one for `Úsporná`, two for `Doporučená`, three for
  `Nejvyšší kvalita`. The three-sparkle version is the `editor` icon itself, so
  the largest tier is exactly the drawing the feature carries everywhere else.
- Why counting and not three different pictures: the transcription models get a
  bolt, scales and a target because they trade different things — speed against
  accuracy. These three trade nothing; they do the same work with more of it.
  Three unrelated pictures would promise a distinction that is not there, while
  a count says "more of the same", which is the truth.
- The sparkles are the icon's own three shapes at their own positions and
  sizes, so the tiers grow into each other rather than being redrawn.
- Files: `src/Settings.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; the three cards rendered against the real
  stylesheet at 3× — one, two and three paths respectively, and the selected
  card's mark takes the accent like every other choice card.

### 2026-08-05 — The automatic acceleration card names what it picks between

- Copy, Jakub's: `Vybere nejrychlejší dostupnou technologii.` instead of
  `Vybere nejrychlejší z toho, co je v počítači.` The three cards below it are
  the technologies, so the sentence now points at them; where they live was
  never the question.
- English follows: `Picks the fastest technology available.`
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — Each acceleration is drawn as what it is

- Changed, Jakub's ask (all four cards drew the same chip): a wand for
  `Automaticky` — the choice is made for you; the chip for `Procesor (CPU)`;
  a graphics card with one fan for `Grafická karta (Vulkan)`; the same card
  with two fans for `Grafická karta Nvidia (CUDA)`, the bigger card being the
  fastest path there is.
- Four pictures here, a count for the language-editing tiers: these four differ
  in kind — a processor, a card, a faster card, and letting the application
  decide — while those three do the same work with more of it. The rule is the
  same one the transcription models already follow with their bolt, scales and
  target.
- Considered and rejected for CUDA: the card with a lightning bolt inside it.
  At 22 px the bolt lost its shape against the fan and the board; two fans stay
  legible at that size, which is the size the icon is actually used at.
- The plain build (`vychozi`) keeps the processor's chip on purpose: it is a
  build with no acceleration chosen, so the processor is what it runs on.
- Files: `src/Settings.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; five candidate marks rendered at 4× and judged
  side by side before choosing, then the four cards rendered against the real
  stylesheet at 3× — each mark distinct, and the selected card's mark takes the
  accent like every other choice card.

### 2026-08-05 — Correcting entry: the acceleration cards keep one icon

- Reverted the entry above. Jakub saw four candidate sets side by side at their
  real 22 px — hardware pictures, speed bars, a speedometer with the needle in
  four positions, and the original single chip — and chose the chip for all
  four.
- The reasoning worth keeping: on these cards the icon is the category's badge,
  not the thing that tells the options apart. What distinguishes them is the
  name and the sentence under it, and both are unambiguous — `Procesor (CPU)`,
  `Grafická karta (Vulkan)`. An icon that tries to carry the distinction as
  well either repeats what the words already say or, in the pictorial version,
  asks the reader to recognise hardware from a 22 px drawing.
- The language-editing tiers keep their counted sparkles: there the words are
  `Úsporná`, `Doporučená`, `Nejvyšší kvalita`, which are a scale and nothing
  else, so a mark that shows the scale adds something the words do not.
- Files: `src/Settings.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; no `ComputeMark`
  remains in the source.

### 2026-08-05 — Světlý a tmavý motiv se dá zvolit

- Added, Jakub's ask: `Motiv` at the top of the `Vzhled` card — `Podle
  systému`, `Světlý`, `Tmavý`. The application has had a dark palette since
  the beginning and no way to ask for it: it lived in
  `@media (prefers-color-scheme: dark)`, so the window followed Windows and a
  person who wanted the other one had nothing to press.
- Changed: the palette moved out of that media query to
  `:root[data-theme="dark"]`, and `applyTheme` in `types.ts` is the only thing
  that writes the attribute. A media query cannot be overridden by a decision —
  that is the whole reason for the move, and following the system is now one of
  three choices rather than the only behaviour.
- Data: `settings.theme`, `#[serde(default)]` to `system`, so a settings file
  written before this reads as what the application already did.
- No flash: `main.tsx` applies the choice from local storage before React
  mounts. The settings arrive from the backend a moment later and re-apply the
  same thing; without the local copy the window would open light and turn dark
  once they did.
- Following means following: while the choice is `system` a `change` listener
  keeps the palette on the operating system's. It is removed the moment a
  palette is chosen by hand.
- **Found by measuring, and it would have shipped:** `matchMedia` returns a
  *new* `MediaQueryList` on every call, so `removeEventListener` against a
  freshly asked-for object removes nothing. Every `applyTheme("system")` left
  its listener behind, and choosing `Světlý` then had the system flip the
  window back at the next change. The query is created once and kept.
- Added: `screen`, `sun` and `moon` to `src/icons.tsx`. Four pictures for four
  kinds of thing, which is the rule the acceleration cards ended on — the
  screen is the thing whose setting `Podle systému` defers to, and it differs
  from `video` by its stand.
- Files: `src/types.ts`, `src/main.tsx`, `src/App.tsx`, `src/Settings.tsx`,
  `src/icons.tsx`, `src/styles.css`, `src-tauri/src/db.rs`,
  `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (855/855, no
  problems); `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (66 passed). The real `applyTheme` and the real `LineIcon` bundled with
  esbuild and driven in a browser against the real stylesheet: with the OS
  light and the OS dark, `system` resolves to each; `dark` and `light` hold
  against an OS that flips twice; `--pozadi` reads `hsl(220 13% 96%)` and
  `hsl(240 5% 12%)` in the two palettes; the choice is in local storage; the
  card rendered at 2× in both palettes with the label 8 px above the control.
  The leak above was found by making the OS change while a palette was chosen,
  not by reading the code.

### 2026-08-05 — Two sidebar empty states, in Jakub's words

- Copy: `Přepis nemá co kontrolovat.` → `Přepis nemá nic ke kontrole.`, and
  `V tomto přepisu zatím žádná oprava není.` → `Přepis neobsahuje žádné
  opravy.` Both now open with the same subject, which is what makes them read
  as siblings in one panel; the second also drops `zatím`, which promised the
  reader corrections were expected of them.
- English is unchanged: `There is nothing to check in the transcript.` and
  `No corrections in this transcript yet.` say the same thing already.
- Files: `src/locales/cs/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — Correcting entry: the theme is chosen from a dropdown

- Changed, Jakub's call minutes after the entry above: `Motiv` is the shared
  `Select`, not a segmented control. He read the three-pill track as a tab
  strip — fairly, since the segmented control's other homes in this
  application are the document tabs and the archive's view switch, both of
  which change what is on screen rather than store a value.
- It is also the consistent answer: every other choice in the `Vzhled` card —
  the interface language and both fonts — is a dropdown, so the theme now
  looks like what it is, a setting among settings. A toggle was the other
  option Jakub offered and it cannot hold three states.
- Removed with it: `screen`, `sun` and `moon` from `src/icons.tsx`. They had
  one reader, and a drawing nothing draws is a drawing that drifts.
- Files: `src/Settings.tsx`, `src/icons.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the real
  `Select` rendered against the real stylesheet at 2× in both palettes, open
  and closed — 38 px trigger, the same height as the language and font fields
  under it.

### 2026-08-05 — The Vzhled card introduces itself in one clause

- Copy, Jakub's: `Jazyk, barevné schéma a písmo přepisu.` instead of `Jazyk
  aplikace a písmo, kterým se čte přepis. Ukázka dole se mění s každou
  volbou.` It is a list of what the card holds, now that the theme is one of
  them, and the sentence about the sample went with it — the sample is
  directly under the fields and demonstrates itself.
- English follows: `Language, colour scheme, and the type the transcript is
  read in.`
- Worth one look rather than a decision here: the sentence says `barevné
  schéma` while the field below it is labelled `Motiv`. Both are ordinary
  Czech for the thing; if they should be one word, the label is the shorter
  one to change.
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — Barevný motiv, and the language field comes first

- Copy, Jakub's: `Jazyk, barevný motiv a písmo přepisu.` — `barevné schéma`
  becomes `barevný motiv`, which settles the mismatch the entry above flagged:
  the sentence and the field below it now use the same word, and the field
  keeps its short `Motiv`. English follows with `colour theme`.
- Changed: the fields are ordered as the sentence lists them — `Jazyk
  aplikace`, then `Motiv`, then the two fonts. The sentence is read first and
  is what tells the eye where to look.
- Files: `src/Settings.tsx`, `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the two blocks
  were moved whole, so nothing about either field changed but its position.

### 2026-08-05 — The About tab

- Added, the thing Jakub asked for days ago and that was offered and never
  built: a seventh Settings tab, `O aplikaci`. Three cards — what the program
  is, what it can do, and what it stands on with the licence of each part.
- Why it earns a tab rather than a paragraph: the application runs fourteen
  other people's programs and models on the user's machine, two of them under
  terms that constrain what the *user* may do with a portable copy. That is
  not a footnote.
- `Co aplikace umí`: seven lines, each with the mark of the screen it belongs
  to — the transcription waveform, the speakers, the sparkle, the review eye,
  the note, the video and the folder. The circle and the 17 px icon are the
  sidebar headings' geometry, so a row here weighs what a heading there does.
- `Na čem to stojí`: six groups (aplikace, přepis, mluvčí, jazyková úprava,
  zvuk a video, písma), each a panel of `name — licence`. The panel is the
  backup block's own rule, extended by one selector rather than copied, so the
  two cannot drift.
- **Every licence was verified against its primary source, not remembered:**
  whisper.cpp, llama.cpp, ONNX Runtime, Silero VAD, the Whisper ggml
  conversions, pyannote segmentation 3.0, Deno, React — MIT; sherpa-onnx and
  3D-Speaker CAM++ — Apache 2.0; Tauri — MIT or Apache 2.0; yt-dlp —
  Unlicense; SQLite — public domain; the five fonts — SIL OFL 1.1.
- **The two that matter, and the note says so out loud.** FFmpeg: gyan.dev
  ships *only* GPLv3 builds of `ffmpeg-release-essentials.zip`, which is what
  the downloader fetches — so a portable copy handed to someone else carries
  GPLv3 with it. Gemma: not open source at all, but Google's own
  `Gemma Terms of Use` plus a prohibited-use policy, which must be passed
  downstream with the weights.
- Two things worth knowing rather than acting on now: the CAM++ *weights* are
  Apache-2.0 by the 3D-Speaker project's own licence, but ModelScope's page
  for that file could not be read from here to confirm per-weights terms; and
  the application itself declares no licence anywhere in the repository, so
  the card says nothing about its own — say the word and a row goes in.
- `Autor` reads `Radomil Martinec`, which is what `src-tauri/Cargo.toml`
  declares. If that is wrong it is one line in one place.
- The version comes from `getVersion()`, i.e. from the bundle. A number typed
  into this card would be the second place to remember on release day and the
  first to be wrong. `core:default` already grants `core:app:allow-version`.
- Files: `src/Settings.tsx`, `src/styles.css`,
  `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (877/877, no
  problems). **The real `Settings` component** was bundled with esbuild — the
  five `@tauri-apps` modules aliased to stubs that answer `load_settings`,
  `check_tools`, `catalog` and `dictionary`, so the screen is the shipped one
  and not hand-written markup — and driven in a browser against the real
  stylesheet at 2× in both palettes: seven tabs in order, three cards, 7
  ability rows with identical 30 px marks, 17 licence rows, no console error.

### 2026-08-05 — The About heading gets the gap a heading gets

- Fixed, Jakub's screenshot: `Co aplikace umí` sat directly on its first line
  with no gap at all. `.nastaveni h2` carries no bottom margin of its own — in
  every other card the introductory sentence provides the distance, and this
  card has none, so the list started 0 px under the title.
- Changed: `.nastaveni section > h2 + .about-abilities` takes 24 px, which is
  the number `h2 + .pole` already uses for the same situation. Not a value
  chosen for this card.
- Copy, Jakub's read that the sentences were not consistently Czech: the
  seven lines are one grammatical shape now, third person about the
  application, and the plurals are plural — `Přepíše nahrávky i videa`,
  `stáhne zvuk z online videí`. Two were rewritten beyond the plural:
  `Označí místa, kde si nebyl jistý` said the *reader* was unsure, so it is
  `kde si přepis nebyl jistý`; `Jazykový model přepis vylepší` changed subject
  mid-list and is `Vylepší přepis jazykovým modelem`.
- The opening sentence follows: `Nahrávky, přepisy i modely zůstávají v
  počítači a nic se neodesílá ven.` English follows all of it.
- Files: `src/styles.css`, `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the real
  `Settings` bundled and measured against the real stylesheet — heading to
  list 24 px, and the card's own rhythm (8 px heading→sentence, 24 px
  sentence→panel, 8 px group label→panel, 22 px between groups, 16 px between
  cards) matches every other Settings card.

### 2026-08-05 — The About card says where the work happens

- Copy, Jakub's: `Převádí řeč na text. Nahrávky, přepisy i jazykové modely
  běží pouze na vašem počítači a nic se neodesílá ven.`
- What it adds over the sentence it replaces: `jazykové modely` rather than a
  bare `modely` — the models are the part a reader would assume lives in
  somebody's cloud, so naming them is the whole point of the claim — and
  `běží pouze na vašem počítači` says the processing happens there, where
  `zůstávají v počítači` only said the files are stored there.
- English follows: `Recordings, transcripts and language models run on your
  computer alone, and nothing is sent out.`
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The author is Značkárna s.r.o.

- Changed, Jakub's correction: the `Autor` row on the About card and the
  `authors` field in `src-tauri/Cargo.toml` both read `Značkárna s.r.o.`
  instead of `Radomil Martinec`. Both places, because the card exists to
  mirror the package's own metadata and two answers to one question is how
  they drift.
- Capitalised as a proper noun, though Jakub wrote it mid-sentence in lower
  case; the domain and the bundle identifier (`cz.znackarna.whisp`) are the
  same name. Say the word if the company writes itself differently.
- Files: `src/Settings.tsx`, `src-tauri/Cargo.toml`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (the
  `i18n-ignore` on that literal now says company rather than person);
  `cargo check` with no warnings.

### 2026-08-05 — Correcting entry: the author writes itself with a small z

- Changed: `značkárna s.r.o.`, per Jakub. The previous entry capitalised it as
  a proper noun and said to say the word if the company writes itself
  differently — it does. Both places again: the About card and
  `src-tauri/Cargo.toml`.
- Files: `src/Settings.tsx`, `src-tauri/Cargo.toml`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `cargo check` with no warnings.

### 2026-08-05 — The first ability line names the language properly

- Copy, Jakub's: `Přepíše nahrávky i videa v češtině i dalších jazycích.`
  instead of `… , česky i v dalších jazycích.` — a noun where the sentence had
  an adverb, so both halves of the pair are now the same kind of word.
- His message dropped the `v` before `češtině`; it is a preposition the
  sentence cannot do without, so it was put back. Everything else is his.
- Files: `src/locales/cs/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The archive breathes: four gaps, each bigger than the last

- Changed, Jakub's ask for more room under the header and between the screen's
  parts: 32 px from the application bar to the drop zone (was 24), 24 px from
  it to the filter row (was 20), 26 px from there to the transcripts (was 18),
  and 40 px from the last transcript to `Složky` (was 26).
- The numbers rise on purpose rather than all landing on one value: the eye
  reads *header → controls → list → drawers* when each boundary is wider than
  the one before it, and reads four evenly spaced strips when they are equal.
  The biggest gap is where the biggest change of subject is — between what this
  archive holds and where the rest of it is filed.
- The compact drop zone follows (26/20 from 20/16) so collapsing the header
  does not also collapse the rhythm around it.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Library` bundled with esbuild — the five `@tauri-apps`
  modules stubbed — and measured in a browser against the real stylesheet with
  three recordings and two folders: 32 / 28 / 26 / 40 px between the boxes
  (the filter row carries its own 8 px above and 26 px below, so its controls
  sit 36 px under the drop zone and 26 px above the first card). No console
  error, nothing overflows at 1100 px.

### 2026-08-05 — Correcting entry: the archive's spacing goes back

- Reverted, in full, the four numbers from the entry above. Jakub tried it on
  the real machine: it does not look better. All four are back where they
  were — drop zone `24px 0 20px`, its compact form `20px 0 16px`, the filter
  row's `8px 0 18px`, and `.folder-block { margin-top: 26px }`.
- Worth keeping from the attempt, in case the ask comes back in another form:
  the rising 32/24/26/40 rhythm reads fine measured but not looked at. The
  likely reason is that the drop zone is a *dashed panel with its own inner
  padding* — 56 px at the top of its surface — so the space under the header
  was never the 24 px in the rule, and adding to it pushed an already airy
  block further down while the list below stayed dense. If this is retried,
  the number to move is inside the surface, not around it.
- Files: `src/styles.css`, `CLAUDE.md`.

### 2026-08-05 — Two numbers around the hero, and only those two

- Changed, after Jakub's screenshot of the real window: 40 px above the drop
  zone (was 24) and 28 px below it (was 20), so the filter row now stands
  40 px under the hero instead of 32.
- Only those two, deliberately. The earlier attempt moved four gaps at once —
  including the list and the folder block — and was reverted on sight. What he
  named both times is the space *around the hero*; the list's own rhythm was
  never the complaint, and changing it is what made the last pass read wrong.
- Why 40 and not 32: the number that matters is this gap against the block it
  introduces. The hero is a dashed panel 320 px tall at its minimum; 24 px
  above it reads as a seam between two surfaces rather than as a margin, and
  32 px was not enough to change that reading. 40 is where it starts to look
  chosen.
- The compact state keeps its own 20/16. That padding is sticky height — it is
  spent on every scrolled screen rather than once at the top — so the two
  states are deliberately not the same number, and the comment in the file
  says so.
- His wording covers two readings — `dropdown header` is either the drop zone
  or the row of dropdowns under it — and both gaps moved, so it is right
  either way.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Library` bundled with esbuild and driven at the window's
  own 1990 × 1330 against the real stylesheet, measured before and after in
  one run by putting the old padding back as a live style tag: 24 → 40 above
  the hero, 32 → 40 to the search field, and `filter → first card` (18) and
  `list → Složky` (26) unchanged, which is the point.

### 2026-08-05 — The Přepis card introduces itself like every other card

- Fixed, Jakub's report: `Přepis` was the last Settings card whose heading
  stood alone. Every sibling — `Jazyk a detekce řeči`, `Modely`, `Výkon`,
  `Vzhled`, `Slovník`, `Zálohy`, `O aplikaci` — opens with a sentence, and this
  one went straight from the title into the model cards.
- Copy: `Model, který nahrávku přepíše, a jak důkladně v ní hledá správná
  slova.` It names exactly the two things the card holds and nothing else —
  the model above and the search thoroughness below it. English follows.
- Worth knowing: this also restores the card's rhythm without a special rule.
  A heading with no sentence has no gap of its own (`h2` carries no bottom
  margin), which is the same defect the About tab's ability list needed an
  explicit 24 px for; here the description supplies it, as it does everywhere
  else.
- The only heading still standing alone is `Co aplikace umí`, and that one is
  deliberate — it is a heading over a list, with its own rule.
- Files: `src/Settings.tsx`, `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (no problems);
  every `<h2>` in `Settings.tsx` was read against its next line, which is how
  the one missing sentence was confirmed to be the only one.

### 2026-08-05 — The recorder's promise is made of words

- Copy, Jakub's: `dialogs.addRecording.micIntro` closes with `Ani slovo
  neopustí váš počítač.` instead of `Data neopustí počítač.`
- Why it is better where it stands: the dialog is about to record *speech*, so
  `ani slovo` is the literal unit of what the person is worried about, not the
  abstract `data` — and `váš` makes the promise to somebody rather than about
  a machine.
- Left alone deliberately: the archive drop zone's two hints keep
  `Data neopustí počítač.` There the thing being dropped is a file, so `data`
  is the right noun and `ani slovo` would be a promise about something the
  reader has not shown the application yet. The sentences are siblings, not
  copies.
- English is unchanged — `Nothing leaves your computer.` already says it.
- Files: `src/locales/cs/dialogs.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The microphone strip stops shouting

- What Jakub reported: while he speaks, every bar of the recorder's spectrum
  stands at the ceiling. Correct, and the cause is not the drawing — it is the
  analyser's own decibel window.
- Cause, measured rather than reasoned: `getByteFrequencyData` maps decibels
  linearly across `minDecibels…maxDecibels`, whose defaults are −100 to −30.
  Anything louder than −30 dB in a band therefore returns 255 before the
  drawing sees it, and ordinary speech is far louder than that in its strong
  bands. Driven through this same analyser with an oscillator at known gain,
  the old settings drew a **full bar from about −48 dB upward** — that is,
  for every level a voice ever reaches.
- Changed: `minDecibels = -85`, `maxDecibels = -20` on the recorder's analyser,
  and the drawing constants that were tuned against the old raw range follow —
  `gamma 0.7 → 0.85`, `floor 0.04 → 0.15`, `peak 0.55 → 0.95` on the dialog's
  strip and the same on the mini recorder's pill, so the two cannot disagree
  about how loud a voice looks.
- Measured after, same method: −55 dB draws 15 %, −50 → 26 %, −45 → 36 %,
  −40 → 46 %, −30 → 64 %, −20 → 81 %, −10 → 98 %. Room tone under −60 dB draws
  nothing, which is what the floor is for.
- Where to turn it next time: the window, not the shaping. The two decibel
  numbers are what sensitivity means here; the gamma/floor/peak trio only
  decides the shape of the curve between them, and a comment in `recorder.tsx`
  now says so.
- Files: `src/recorder.tsx`, `src/AddRecordingDialog.tsx`, `CLAUDE.md`.
- Verified: the real `AddRecordingDialog` bundled with esbuild and driven in a
  browser with a fake microphone — recording, the tallest column of the live
  strip reaches 68 % of the canvas height against the 100 % it was pinned at,
  with 3,696 painted pixels and no console error. The decibel table above was
  produced by the real `spectrumEdges`, `sampleSpectrum` and `emphasise`
  against a real `AnalyserNode`, not by arithmetic on paper.

### 2026-08-05 — The credits sentence names what the licences are for

- Copy, Jakub's: `Aplikace pro vás nepracuje sama. Tohle jsou licence
  jazykových modelů a nástrojů, které na výsledku spolupracují.`
- Better than what it replaced in two ways: `nepracuje pro vás sama` says the
  work is done on the reader's behalf by somebody else, where `nic nepočítá
  sama` only described a machine; and the sentence now leads with **licence**,
  which is what the panels under it actually list — the old one led with the
  programs and left the licences as an afterthought at the end.
- English follows: `The application does not work alone. These are the
  licences of the language models and tools that work on the result together.`
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The mouse's own back and forward buttons navigate

- Added, Jakub's ask: the two side buttons on a mouse walk the application's
  own history. Back goes to the last place, forward returns.
- What a place is: the three pieces of state that decide what is on screen —
  which screen, which recording, which folder. Nothing else is remembered,
  because nothing else changes where the reader is.
- How it is kept, and this is the decision worth recording: an effect watches
  that triple and appends when it changes, rather than a `push()` at each of
  the two dozen places that navigate. One of those would have been forgotten
  the next time a screen was added, and a history with a hole in it is worse
  than no history. Travelling moves the index *before* setting the state, so
  the effect finds the entry it already holds and adds nothing.
- Deliberately not places: the setup wizard (it can be required, and walking
  backwards out of it would leave the application unable to transcribe) and
  anything with a dialog open — a dialog is the top of the stack and the
  buttons belong to it. The dialog test asks the DOM for `.prekryv-dialogu`
  rather than listing the modals, so the next one is covered for free.
- WebView2 would otherwise do its own history navigation on the same buttons,
  so `mousedown` and `auxclick` are swallowed for buttons 3 and 4 and the walk
  happens on `mouseup`.
- Files: `src/App.tsx`, `CLAUDE.md`.
- Verified: the real `App` bundled with esbuild against stubbed Tauri modules
  and driven in a browser — archive → folder → detail, then three synthetic
  button-3 presses walked detail → folder → root and stopped at the root
  rather than going anywhere strange, and two button-4 presses walked back up
  to the detail. With the `Nový přepis` dialog open, button 3 changed nothing.
  No console error.

### 2026-08-05 — An open folder is marked like the list it came from

- Changed, Jakub's ask: the breadcrumb over an open folder starts with the
  same icon-in-a-circle the `Složky` heading carries on the root, and the way
  back is the application header's own back button — where every other screen
  keeps it.
- Removed: the `← Archiv` button that used to sit inside the breadcrumb. Two
  places to look for one idea, and the header's was the one that is always in
  the same corner.
- The header's back button now appears on the archive as well whenever a
  folder is open, and clears the folder instead of changing screen. It keeps
  reading `Archiv`, which is exactly where it goes.
- Files: `src/Library.tsx`, `src/App.tsx`, `CLAUDE.md`.
- Verified: the real `App` driven in a browser — inside a folder the crumb
  shows the 30 px mark 10 px before the name and no button of its own, the
  header shows `Archiv`, and pressing it returns to the root and takes the
  button away again. Rendered at 2× in both palettes.

### 2026-08-05 — The folder's mark is the way out of it

- Added, Jakub's ask: the icon in the breadcrumb becomes a left arrow under
  the pointer and takes the reader back to the archive. At rest it is still
  the drawer, so an open folder is marked the way the `Složky` heading marks
  the list it came from.
- Why it works rather than being a trick: the mark was decorative and sitting
  exactly where a way back belongs — the same corner of the same row. Giving
  it the job costs no width and no new control, and the header keeps its own
  `Archiv` button for anyone who never hovers.
- Implementation worth knowing: the drawer and the arrow are stacked in one
  grid cell and cross-fade, rather than being swapped in JavaScript. Two icons
  of different widths swapped in the DOM would shift the name beside them by a
  pixel as the pointer arrives.
- The keyboard gets it too (`:focus-visible`, not only `:hover`), the button
  carries `Archiv` as its accessible name and its tooltip, and
  `prefers-reduced-motion` turns the fade off.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real `App` bundled with esbuild and driven in a browser —
  measured at rest (drawer opacity 1, arrow 0, muted circle) and under the
  pointer (drawer 0, arrow 1, `--akcent-svetly` behind it), the box holding
  30 × 30 px in both, and clicking it returned to the archive root. Rendered
  at 3× in both states; no console error.

### 2026-08-05 — Correcting entry: the crumb's icon sat off centre

- What Jakub saw: after the mark became a button, the drawer no longer sat in
  the middle of its circle — the alignment before it was right.
- Cause: the button centres its grid items, but each layer was a bare `span`,
  which is an inline box. Its `svg` therefore sat on a text baseline inside it,
  and the extra descender space pushed the drawing up and left of the circle's
  true centre. The old markup had the `svg` as the grid item itself, so
  nothing stood between `place-items: center` and the drawing.
- Fixed: both layers fill the button and centre their own drawing
  (`display: grid; place-items: center; width/height: 100%`).
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: measured in a browser at 4× — the drawer's centre and the arrow's
  centre are each **0.00 px** from the button's centre in both axes, in both
  states, where before they were not.

### 2026-08-05 — The record button gets the record dot, not a red surface

- Added, Jakub's ask (`červené tlačítko, nebo aspoň record?`): `Spustit
  záznam` carries a 10 px red dot before its label. The button keeps its
  ordinary primary surface.
- Why the dot and not the whole button: red means *destructive* everywhere
  else in this application — `Smazat přepis`, `Odebrat z archivu`, `Včetně
  přepisů` — and a fully red button on the one action that destroys nothing
  would spend that meaning. As a small mark the red reads as the record
  convention instead, which is what it is.
- It is the same 10 px and the same `--vystraha` as the dot the mini recorder
  pulses with, so the mark that starts a take and the mark that says one is
  running are one idea rather than two reds that happen to be near each other.
  It does not pulse: nothing is running yet.
- Disabled (while the microphone is still opening) the dot fades with the
  button rather than staying bright on a dead control.
- Files: `src/AddRecordingDialog.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real dialog bundled with esbuild and driven in a browser with
  a fake microphone, rendered at 3× in both palettes and measured — 34 px
  button, 10 × 10 px dot, `rgb(245, 66, 46)` in light and `rgb(235, 88, 71)`
  in dark, dot centred on the button's own centre to 0.00 px, 9 px to the
  label.

### 2026-08-05 — The mark takes something in and lets something out

- Added, Jakub's ask: a block drives into the square on top of the cube and a
  ball rolls out of the round hole below it. The two pieces live in
  `src/mark.svg` itself, so every place that draws the mark has them — the
  header, the archive's hero, the detail. They are `opacity: 0` until a
  selector asks, so a still logo is byte for byte the logo it was.
- It runs on hover of the wordmark and of the hero's mark. Deliberately not on
  a timer: a logo that moves by itself is a thing to look away from, and this
  one has a reason to move only when somebody looks at it.
- The story is the application's: the same red object goes in as a block and
  comes out as a ball. One colour, two shapes — the transformation is the
  point, so a second colour would have made them two different things.
- Implementation worth keeping: each piece is a wrapper moved in screen space
  around an inner group that carries its face's own matrix. A CSS transform on
  the shape itself would replace that matrix and the piece would leave the
  cube's geometry. Nothing is clipped — the block simply stops being drawn at
  the frame it meets the opening, which at this size is indistinguishable from
  falling in.
- `prefers-reduced-motion` turns both off.
- Files: `src/mark.svg`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real mark bundled and driven in a browser — at rest both
  pieces read `opacity: 0`, and twelve frames sampled across one 2.2 s cycle
  by pausing the animation at known offsets show the block above the square,
  in it, then the ball in the hole, leaving, and gone.

### 2026-08-05 — The application is called Slobot

- Changed, Jakub's decision: `Slobot`. The window title is `Slobot™`, the
  header wordmark is `Slobot`, the installer and the executable follow from
  `productName`, and the portable-copy sentence names `Slobot.exe`.
- The About card leads with his tagline: `Převádí mluvené slovo na text.`
- **Two `Whisp` strings stay, and this is the reason:** `identifier` in
  `tauri.conf.json` is `cz.znackarna.whisp`, which decides
  `%APPDATA%\cz.znackarna.whisp` — the archive, its backups, microphone takes
  and downloaded media; and `tools_root()` in `tools.rs` is
  `%LOCALAPPDATA%\Whisp`, which holds the downloaded programs and several
  gigabytes of models. Renaming either sends the application to look in an
  empty folder: a blank archive, or an offer to download everything again.
  Both are invisible to the reader. Change them only with a migration, and
  only for a reason better than tidiness.
- Changed anyway, because it names the program rather than a place: the HTTP
  user agent the downloader introduces itself with.
- Not changed: every other `Whisp*` in the source is `Whisper`, the engine,
  which is somebody else's name.
- Files: `src-tauri/tauri.conf.json`, `src/App.tsx`, `src/Settings.tsx`,
  `src-tauri/src/download.rs`, `src/locales/cs/settings.ts`, `CLAUDE.md`.
- Verified: the config still parses; `cargo fmt --all`; `cargo check` with no
  warnings; `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The examples belong to nobody's trade

- Fixed, Jakub's report: the interface's own examples read as though the
  application were made for preachers. The font sample was a paragraph from
  the parable of the prodigal son with a verse from Ephesians in it, the
  rename dialog offered `Nedělní kázání` and the folder dialog `Kázání`.
- Changed: the sample is now a meeting — `Sešli jsme se ve čtvrtek odpoledne
  a mluvili spolu skoro dvě hodiny. „Nejdřív si to musíme poslechnout celé,“
  řekla — a měla pravdu. Přepis měl nakonec 1 234 slov a nechyběla v něm
  jediná věta.` The placeholders are `Porada týmu` and `Rozhovory`.
- The sample keeps every job it had, which is why it could not simply be
  shortened: Czech quotation marks, an em dash, a number with a non-breaking
  space, and a full spread of diacritics. English follows with its own
  typography (`“ ”`, `1,234`).
- Files: `src/locales/{cs,en}/{settings,dialogs}.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; a grep for
  `kázán`, `kazatel`, `sermon` and `Efezským` across every locale comes back
  with nothing but the word `ukazatele`.

### 2026-08-05 — Correcting entry: the cube animation is cancelled

- Reverted, in full, the entry `The mark takes something in and lets something
  out` from earlier today. Jakub saw it running and called it off in three
  words, so the block, the ball, and every rule that moved them are gone.
- `src/mark.svg` is back to the original five-element logo (md5
  `37b00348cfe78c1f78c858f229a02f0a`), and the 1,753-character animation block
  is out of `src/styles.css` — both wrapper groups, both keyframe sets, the
  hover selectors on the wordmark and on the archive's hero mark, and the
  `prefers-reduced-motion` override that existed only for them.
- Worth knowing, in case it is ever asked for again: the technique in that
  entry was the right one and is what should be reused — each piece a wrapper
  moved in screen space around an inner group carrying its face's own matrix,
  because a CSS transform on the shape itself replaces that matrix and the
  piece leaves the cube's geometry.
- Files: `src/mark.svg`, `src/styles.css`, `CLAUDE.md`.
- Verified: a grep for `znak-kostka` and `znak-kulicka` returns nothing in
  either file; `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-05 — The README is about Slobot

- Rewritten: `README.md` described `Whisper Studio` at version 0.1.0, addressed
  the reader informally throughout, used `kázání` as its running example, and
  made three claims that stopped being true days ago — that a transcription
  cannot be cancelled, that the dictionary is reachable only from the
  correction bubble, and that the hint is handed to Whisper in advance. The
  first two were fixed on 2026-08-04, the third was removed with the hint.
- Now: the name, the tagline, and the 0.9.0 installer; vykání and a meeting
  rather than a sermon as the example; the current feature list including the
  microphone, the watched folder, online imports, folders and notes; the
  shortcut table with the mouse side buttons; the three quality tiers under
  the names the interface uses (`Precizní`, `Vyvážený`, `Rychlý`); the three
  verification commands the work actually goes through; an architecture diagram
  that includes `ai_edit.rs` and `llama-server`; the full licence table from
  the About card; and the known limitations with the stale ones removed.
- The two paths are the ones the rename entry insists on and are stated as
  such: `%LOCALAPPDATA%\Whisp\` for the tools and models,
  `%APPDATA%\cz.znackarna.whisp\` for the archive. They still say `Whisp`
  because they are places, not the program's name.
- The licence paragraph repeats what the About card says out loud: everything
  but Gemma is open source, Gemma follows Google's own terms, and the bundled
  FFmpeg is GPLv3 — which matters when a portable copy is handed to somebody
  else.
- Files: `README.md`, `CLAUDE.md`.
- Verified: every command in the file was checked against `package.json`; the
  model file names and sizes against `src-tauri/src/download.rs`; the two paths
  against `tools.rs` and `tauri.conf.json`; the shortcut table against
  `src/Detail.tsx`; and each licence against the About card, which was itself
  verified against primary sources when it was written.

### 2026-08-06 — The portable copy is called Slobot, and so is the package

- Fixed, and it was the one place the old name was still visible to the
  reader: `create_portable_copy` wrote the executable as `Whisp.exe`, while
  Settings and the README both say `Na jiném počítači pak stačí spustit soubor
  Slobot.exe`. Anyone following that sentence on the other machine would have
  looked for a file that is not there. `prenosna.txt` introduced itself as
  Whisp as well.
- Changed: both names come from `app.package_info().name`, i.e. from
  `productName` in `tauri.conf.json`. A hard-coded `Slobot.exe` would have been
  correct today and wrong the next time the application is renamed — which has
  now happened once, which is the whole argument.
- Changed, Jakub's call: the Cargo package is `slobot` and so is the npm
  package. Neither is visible to a reader, but the crate name is what the built
  binary in `target\release\` is called, and the repository is
  `github.com/znackarna/slobot` — a package still calling itself `whisp` is a
  second name for one thing.
- **Unchanged, for the reason the rename entry gives:** `identifier` stays
  `cz.znackarna.whisp` (`%APPDATA%\cz.znackarna.whisp` — the archive, its
  backups, microphone takes, downloaded media) and `tools_root()` stays
  `%LOCALAPPDATA%\Whisp` (several gigabytes of programs and models). Renaming
  either without a migration means a blank archive or an offer to download
  everything again.
- Consequence of the crate rename, worth knowing before the next build: the
  fingerprints under `src-tauri/target/` are keyed by package name, so the
  first `cargo build` after this recompiles the dependency tree once — five to
  fifteen minutes. Nothing else changes.
- Files: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `package.json`,
  `src-tauri/src/download.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` builds as `slobot v0.9.0` with no
  warnings; `cargo test` (66 passed); `npx tsc --noEmit`;
  `node scripts/i18n.mjs check`. The lock file picked the new name up on its
  own; there is no `package-lock.json` in this project.

### 2026-08-06 — The wordmark is the size of a recording's name

- Changed, Jakub's ask with two screenshots side by side: `Slobot` in the
  archive header is 15 px / 700, exactly `.detail-hlavicka h1` — the recording's
  name in the detail header. It was 13.5 px / 650 with `letter-spacing:
  -0.01em`, which is gone with it.
- Why it is right rather than merely asked for: the two bars are the same bar.
  Whatever stands after the cube is the title of the screen you are on — the
  product in the archive, the recording in a detail — and one of them being a
  size and a weight smaller made the archive look like the lesser screen.
- The comment above the rule now names `.detail-hlavicka h1` and says to change
  them together, because two numbers meant to be equal in two places is how
  they stop being equal.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real `App` and the real `Detail` bundled with esbuild against
  stubbed Tauri modules and driven in one browser page against the real
  stylesheet at 2×, so both headers were measured in the same render: wordmark
  and recording name both `15px` / `700` / `normal` tracking / `Geist Variable`
  / `rgb(26, 26, 30)` with a 22.5 px line box; both cubes 24 px; both bars
  57 px. No console error.

### 2026-08-06 — The wordmark carries the trademark sign

- Added, Jakub's ask: `Slobot™` in the archive header. The window title has said
  `Slobot™` since the rename; the header was the one place the program named
  itself without it.
- Placement is measured, not derived: the sign's ink top sits exactly on the
  `S`'s cap height — 0.000 px apart at 8× — through a 0.5 em lift on its own
  9 px size. `vertical-align: super` overshoots at this size, and where the
  glyph's ink lands inside its em box is the font's decision rather than
  arithmetic, so the comment tells the next reader to measure again rather than
  scale the number if either size changes.
- Quiet on purpose: 9 px, weight 600, `--text-tichy`. It is a legal mark
  standing beside the name, not a syllable of it — at the wordmark's own 15/700
  it would read as part of the word.
- `aria-hidden`: the cube beside it already carries `app.name` as its
  accessible label, and a screen reader saying `Slobot trademark` on every
  archive screen is noise. Both literals keep an `i18n-ignore` — a product name
  and a symbol are the same in every language.
- Files: `src/App.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real `App` bundled with esbuild against stubbed Tauri modules,
  driven in a browser against the real stylesheet at 8×, and the screenshot
  decoded to raw pixels — the `S`'s cap top and the sign's ink top both land on
  5.875 px, the sign's ink runs 5.875–8.375 against the wordmark's 5.875–17.125
  baseline. `npx tsc --noEmit`; `node scripts/i18n.mjs check` (both ignores
  honoured, no new finding); no console error.

### 2026-08-06 — The Přepis card asks for a size and a quality

- Copy, Jakub's: `settings.transcription.description` is `Zvolte velikost
  jazykového modelu a kvalitu převodu.` It supersedes `Model, který nahrávku
  přepíše, a jak důkladně v ní hledá správná slova.`, written a day earlier —
  which described the two controls, where this one asks for the two decisions.
- English follows: `Choose the size of the language model and the quality of
  the conversion.`
- **Flagged rather than changed, because it is a vocabulary collision:** in
  this interface `jazykový model` has meant the Gemma editor everywhere else —
  `Jazyková úprava`, the About card's `Nahrávky, přepisy i jazykové modely`,
  the wizard's language-editing step. Whisper is called `model` or `model
  přepisu`. A reader who has seen the other screens may read this sentence as
  being about the editor rather than about transcription. `Zvolte velikost
  modelu a kvalitu převodu.` says the same thing without borrowing the other
  family's name; it is one word to change if that is wanted.
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`.

### 2026-08-06 — The speech card asks the question in Slobot's name

- Copy, Jakub's: `settings.speech.description` is `Jakou řečí se v nahrávce
  mluví a co má Slobot považovat za řeč.` It supersedes `Čím se v nahrávce
  mluví a co se v ní má považovat za řeč.` — `jakou řečí` names the thing the
  field below actually asks for, where `čím` left the reader to work it out,
  and the impersonal `má se považovat` becomes somebody doing the considering.
- English follows: `What language is spoken in the recording, and what Slobot
  should count as speech.`
- **This is the first time the product's name lives inside the dictionary**,
  and it is worth knowing why that is a decision rather than a detail. The
  header's wordmark is a literal with an `i18n-ignore` precisely so no
  translator is invited to change it, and the portable-copy sentence takes its
  `Slobot.exe` from the component through `{file}` rather than from the string.
  Here the name is part of the sentence, so it is translatable by construction.
- Guarded the only way that is available: a translator note on the key —
  `„Slobot“ je název aplikace — nechte ho v každém jazyce tak, jak je.` It
  travels with the string through `i18n:export`, which is what the `*Context`
  maps are for. If the name ever changes again, this string is now one of the
  places to sweep; nothing automatic will find it.
- Files: `src/locales/{cs,en}/settings.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (879 keys, no
  problems, no informal address — `Jakou řečí…` is impersonal, so the vykání
  guard has nothing to catch).

### 2026-08-06 — The balanced model is above average, not comparable

- Copy, Jakub's: `domain.modelDescription.large-v3-q5_0` reads `Nadprůměrná
  kvalita, třetinová náročnost. (1,1 GB)` instead of `Srovnatelná kvalita,
  třetinová náročnost. (1,1 GB)`.
- Why his is better: `srovnatelná` is a comparison with nothing named in the
  sentence — the reader has to look up at `Precizní` to learn what it is
  comparable *with*. `Nadprůměrná` says where the model stands on its own, and
  the card is read on its own.
- English follows: `Above-average quality, a third of the load. (1.1 GB)`.
- Left alone, and worth one look some day rather than a change here: the same
  model has a second sentence in the download catalogue,
  `catalog.model-large-q5.description` — `Kvalita skoro jako nejvyšší,
  třetinová velikost.` It is the older comparison this entry just removed from
  the card, in a different construction. Only the three tier *names* were
  unified when they were renamed; the catalogue kept its own descriptions.
- Files: `src/locales/{cs,en}/domain.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (879 keys, no
  problems).

### 2026-08-06 — Correcting entry: the crumb's back arrow filled its whole circle

- What Jakub saw: the arrow inside the breadcrumb's circle is enormous. It was,
  and by my own hand: **29.25 × 25 px of ink inside a 30 px circle**, against
  the drawer's 14.00 × 11.25 in the same button. Measured at 8× by hiding one
  layer at a time and reading the ink box off the raw pixels.
- Cause, and it is the correcting entry for `the crumb's icon sat off centre`:
  that fix gave both layers `width/height: 100%` so each could centre its own
  drawing. The drawer's layer is a `span` with an `svg` inside it, so only the
  wrapper stretched. The arrow **was** the `svg` — a direct grid child — so it
  took 100 % of the circle, and an `svg` with a `viewBox` scales its drawing
  with its box. Its `width="15" height="13"` attributes lost to the rule.
- Fixed: the arrow is wrapped in a `span` like the drawer, and it is now the
  header's own back arrow at its own size — the same 14 × 12 drawing
  `App.tsx` puts before `Archiv`, rather than the 15 × 13 copy this button
  carried. One arrow in the application, one size.
- The comment on the markup says why the wrapper exists, because the next
  person to add a layer here will hit exactly this.
- Files: `src/Library.tsx`, `CLAUDE.md`.
- Verified: the real `App` bundled with esbuild against stubbed Tauri modules,
  a folder opened by clicking its own `Otevřít`, and each layer screenshotted
  alone at 8× with the other hidden — the arrow's ink is 13.75 × 11.75 against
  the drawer's 14.00 × 11.25, and its centre sits on the button's own centre
  (15.00 / 15.00). Rendered at 4× in both palettes, hovered and at rest; no
  console error.

### 2026-08-06 — The hero shrinks first, then scrolls away with everything else

- What Jakub saw, twice: a recording card sliced in half under the compact
  hero, and then the whole filter row cut through its controls. His rule, in
  his words: `Nemá být přilepený. ale má se nejdřív zmenšit a pak scrollovat`.
- Changed: `.archive-drop-zone` is `position: relative` instead of
  `position: sticky; top: 0`. Nothing in the archive is pinned any more —
  hero, filter row, cards and folders are one column that scrolls as one.
- Kept, because it is the other half of the rule: the collapse. The first
  downward gesture is still consumed to shrink the hero from 389 px to
  132 px without moving the list, and only the next one scrolls. An upward
  gesture at the top expands it again.
- Supersedes every entry that tuned the sticky behaviour — the 121 px sticky
  offset, the `@media (max-height: 760px)` escape hatch that unstuck it on
  short windows (now redundant, and deleted), and the two entries that tried
  to stop the toolbar and the cards being covered. A pinned header slices
  whatever passes under it; no z-index, gradient or opaque padding fixes
  that, it only decides which half is visible.
- Nothing is lost by letting it go: `+ Nový přepis` stands in the application
  header on every screen, which is where the hero's action was needed from.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Library` bundled with esbuild against stubbed Tauri
  modules and driven in a browser against the real stylesheet at 2× over
  twelve recordings and a folder. Measured across four gestures: at rest the
  hero is 389 px at `position: relative`; the first wheel leaves `scrollTop`
  at 0 and the hero at 132.5 px; the second scrolls to 300 and the third to
  814, by which point the hero's bottom is 624 px above the scroller's own
  top — it is gone, not pinned. An upward gesture returns both. The
  screenshot at mid-scroll shows cards passing under the application bar with
  nothing sliced.

### 2026-08-06 — The watched folder transcribes one file after another

- Jakub's ask, twice in one session: `A jeste ten převod veci vce sledovací
  složce by mel jet jeden soubor za druhym` and, later, `Ten automatický
  prepis ze sledované sližby mel jít soubor po souboru.`
- What happened before: `Přepsat` on a batch of watched files, or the
  automatic path, started every file at once. Each run spawns whisper (and
  sherpa), each takes the whole GPU or every core it can get, so four files
  in parallel are not four times faster — they are the same work with four
  times the memory pressure, and on a machine that runs out of VRAM they are
  slower than one at a time.
- Changed: `TranscriptionTask` gained a `Gate` — a `VecDeque` of recording
  ids and a `Condvar`. A worker thread starts immediately, as before, but
  its first act is `wait_for_turn`, which blocks until its id is at the front.
  The heavy work therefore runs one at a time, in the order the runs arrived.
- Global, not per batch: two files dropped by hand and two found in the
  folder queue against each other as well. There is one graphics card.
- Visible: a recording that has to wait says so — a new `queued` phase at 0 %
  with `progress.transcription.queued` (`Čeká ve frontě` / `Waiting in the
  queue`), emitted only for a run that actually found somebody ahead of it.
- Cancelling a waiting recording takes it out of the queue rather than
  leaving a dead id at the front for everyone else to wait on
  (`leave_queue_if_waiting`, which deliberately never removes the front — the
  running one is cleaned up by its own worker, and pulling it out from under
  itself would let a second whisper start beside it).
- Why in Rust and not in the interface: the queue has to hold for every path
  that starts a transcription — the watched folder, a multi-file drop, the
  detail's `Přepsat`, a re-run from the menu. A queue in `App` would be one
  more thing each of those has to remember, which is the argument that put
  the speaker-count question into `runTranscription`.
- Files: `src-tauri/src/transcription.rs`, `src/locales/{cs,en}/progress.ts`,
  `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (70 passed — four new: the second recording waits for the first, a waiting
  worker wakes when the one ahead leaves (threaded, with a timeout so a
  regression fails rather than hangs), cancelling a waiting recording takes
  it out of the queue, and cancelling the running one leaves it at the
  front). The guard was proven by making it fail: with `wait_for_turn`
  temporarily returning true at once, two of the four failed and the other
  two passed, which is what a real guard does. `npx tsc --noEmit`;
  `node scripts/i18n.mjs check`.

### 2026-08-06 — Taking a recording out of a folder is its own item

- Changed, Jakub's ask: `Vyjmout ze složky` stands directly in the recording
  menu, under `Vložit do složky`, and only for a recording that is actually in
  one. It used to be the last item *inside* that submenu.
- Why it is better where it now stands: the submenu answers one question —
  which drawer — and every item in it is a drawer, except the one that was not.
  Taking a recording out is not a choice of folder; it is a single action with
  no argument, and an action hidden behind a list of choices reads as one more
  choice. It also cost two clicks for the only thing in that menu that needs
  none.
- Only for a recording in a folder, as asked, and for the same reason the
  submenu already hid it there: in the archive's root it would be an offer to
  take something out of nothing.
- Files: `src/RecordingActionsMenu.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the real
  `RecordingActionsMenu` bundled with esbuild against stubbed Tauri modules and
  opened in a browser against the real stylesheet at 3× in both states, with
  the item labels read out of the DOM rather than off the screenshot — in a
  folder the top level reads Přejmenovat · Přepsat znovu · Přepsat v jazyce ·
  Smazat přepis · Vložit do složky · **Vyjmout ze složky** · Uložit zvuk… ·
  Odebrat z archivu; in the root the same list without it. The submenu keeps
  its folders and `Nová složka…`.

### 2026-08-06 — Zrušit reaches the preparation programs, not only whisper

- What Jakub saw, with a 34-minute MP3 sitting at `Připravuji přesné
  přehrávání`: `Zrušit` does nothing at all. It did not.
- Cause: the preparation programs were run through `Command::output`, which
  owns its child and hands it to nobody. `cancel` set the flag, found nothing
  in `processes` to kill, and the ffmpeg encoding the whole recording to AAC
  ran to the end — followed by the waveform pass, and then **whisper**, which
  starts many minutes of work with no cancel check between it and the request.
  An earlier entry argued the preparation programs are "bounded and short
  beside whisper", which is true of the 16 kHz WAV pass on a short file and
  false of a 34-minute MP3 — and the playback step is the one whose caption
  names it, so it is the one somebody cancels during.
- Changed: `tools::CommandRunner` — a program is now run *by* somebody.
  `JobRunner` in `transcription.rs` registers each child before waiting on it,
  so `Zrušit` kills whatever is running; `PlainRunner` is for the one caller
  that no job owns, preparing playback on demand when a finished transcript is
  opened. `convert_to_wav` and `ensure_seekable_playback` take one.
- Waiting without holding the child: stderr is read to its end, which is what
  the pipe closing means, and only then is the child taken back out of the
  registry. Gone from there means cancellation took it — the same handshake
  `start_whisper` has always used. A killed encode deletes its own half-written
  `.part` file rather than leaving a growing pile of them.
- Changed: two more `stop_if_cancelled` — after the playback step, and
  immediately before whisper is started. Losing the playback cache is
  deliberately still not an error; being cancelled is, and starting the
  expensive program after a cancellation is what made the button look dead.
- Files: `src-tauri/src/tools.rs`, `src-tauri/src/transcription.rs`,
  `src-tauri/src/main.rs`, `CLAUDE.md`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (71 passed). The new test spawns a real long-running child — the test binary
  itself, running an ignored test that sleeps, so it exists on every platform
  — waits for it to be registered rather than guessing at a delay, cancels,
  and asserts the runner reports it was killed and that it stopped in under
  25 seconds rather than at its own end. The guard was proven by making it
  fail: with the child kept private again, exactly as it used to be, it failed
  and everything else passed. `npx tsc --noEmit`; `node scripts/i18n.mjs
  check`.

### 2026-08-06 — The pinned header, and the list dissolving into it

- Supersedes `The hero shrinks first, then scrolls away with everything else`
  from earlier today. Jakub's proposal, and it is the better answer: keep the
  hero and the filter row pinned, let the content pass under them once the
  hero has shrunk, and put a shadow or a gradient blur over what passes.
- Why it works where every earlier attempt did not: the problem with a pinned
  header was never that content goes under it — it is that the content is
  *cut*, mid-card, mid-control, with a hard edge that reads as a defect. Three
  earlier entries tried to fix that with z-index, opaque padding and a
  gradient, and each moved the seam rather than removing it. A blur removes
  it: what approaches the edge softens and fades out, so the boundary reads as
  glass the list slides under.
- Changed: `.archive-sticky` wraps the hero and the toolbar and is the one
  pinned layer. One layer, not two — two is what used to cover the first
  card's top edge — and the toolbar's offset is now its own place in that
  block rather than a copy of the compact hero's height that somebody has to
  keep in step with it.
- The blur is two masked layers below the block's edge, not one: 42 px of
  `blur(3px)` carrying the colour fade, and 18 px of `blur(9px)` above it.
  Stronger and shorter nearest the block, weaker over a longer run below —
  that progression is what makes it read as a gradient rather than as a
  frosted band with an edge of its own. Both are masked to nothing at their
  far end, and both are `pointer-events: none`: this is glass, not a surface.
  Where `backdrop-filter` is unavailable the colour fade alone still reads as
  the list dissolving upward.
- Kept: the collapse. The first downward gesture shrinks the block from 454 px
  to 187 px without moving the list; only the next one scrolls. That was
  Jakub's rule before the hero was unpinned and it is still his rule now.
- `.archive-drop-zone` itself stays `position: relative`; it is the wrapper
  that is pinned. Do not make both sticky.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Library` bundled with esbuild against stubbed Tauri
  modules and driven in a browser against the real stylesheet at 2× over
  fourteen recordings. Measured: the block is `sticky` at the scroller's top
  through every scroll position, the toolbar's bottom edge is the block's own
  bottom edge, and the list scrolls beneath both. Screenshotted with a card
  deliberately straddling the boundary, in both colour schemes — the card's
  text blurs and fades out instead of ending in a line. The date filter's
  popover was opened over the strip and stays sharp and opaque, because
  `.knihovna-lista` keeps its own stacking context above the two glass layers.

### 2026-08-06 — Correcting entry: the glass was there when there was nothing to dissolve

- What Jakub saw, and the folder screenshot is what made it obvious: a folder
  with nothing in it, scrolled to the very top, and its own name — `Jakostní
  přepisy zeleniny` — blurred and faded under the filter row. Same at the top
  of the archive. His words: it stays tucked in even when I scroll all the way
  up.
- Cause, mine, from the entry above: the two glass layers were painted always.
  They sit 60 px below the pinned block whatever the scroll position, so at the
  top of the list — where nothing is passing under anything — they lay over the
  first row and dimmed it. The blur is meant to say *this is going under the
  header*; sitting still, it said the first row was damaged.
- Changed: the glass is drawn only while the list is genuinely scrolled
  (`scrollTop > 2`), fading in and out over 160 ms. At the top there is nothing
  to dissolve, so there is nothing there.
- Changed, from the same report: the hero expands again on a real return to the
  beginning made *any* way — the scrollbar, Home, a fling — not only by an
  upward wheel gesture whose projection reaches the top. Two conditions that
  cannot chase each other: collapsing needs 64 px of scroll, expanding needs
  exactly zero *after* a positive position, so a layout settling at zero on its
  own still cannot reopen the header. That was the fear behind the wheel-only
  rule, and it is now met by remembering the previous position instead.
- Files: `src/Library.tsx`, `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Library` bundled with esbuild against stubbed Tauri
  modules and driven in a browser against the real stylesheet. Four states
  measured, with the pseudo-elements' computed opacity read rather than judged
  from a screenshot: at rest 0, collapsed but still at the top 0, scrolled 1,
  back at the top 0 — and unchanged after settling, so it does not flap. An
  empty folder opened at the top reports the glass off and its breadcrumb
  sharp. The scrollbar route was driven by setting `scrollTop` directly, with
  no wheel event at all, and the hero came back.

### 2026-08-06 — A choice card lifts under the pointer

- Changed, Jakub's ask and explicitly across the whole application: hovering a
  choice card adds the shared low `--stin` beside the border change it already
  had. One rule on `.volba`, so it reaches every one of them at once — the
  three sources in `Nový přepis`, the transcription models, the acceleration
  cards, the three language-editing tiers, the wizard's quality cards and the
  AI dialog's modes.
- The token is the one an archive row already lifts with, not a shadow chosen
  for these cards. A second elevation value is how two families that should
  read alike stop doing so.
- The keyboard gets the same lift (`:focus-visible`). The focus ring says where
  you are; the shadow says the thing under it is pickable, and that is the same
  statement whichever way you arrived.
- Not given one: `.modul-dlazdice`. It shares the card's frame but is a status
  tile, not a button — nothing happens when it is pointed at, and a shadow
  would promise that something does.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real `AddRecordingDialog` bundled with esbuild against stubbed
  Tauri modules and driven in a browser against the real stylesheet at 3× in
  both colour schemes, with the computed `box-shadow` read off all three cards
  rather than judged from a screenshot: `none, none, none` at rest and
  `none, 0 1px 4px, none` with the middle one hovered — so the lift belongs to
  the card under the pointer and to no other. The dialog's own autofocus makes
  the first card `:focus-visible` on open, which is what the keyboard half of
  the rule is for; the reading above was taken after blurring it.

### 2026-08-06 — The local-file mark smiles

- Fixed, Jakub's report: the document on the `Místní soubor` card had a frown.
  The arc bowed upward — drawn as the hill of a picture-file glyph — and at the
  19 px it is actually used at, a hill inside a document is a mouth. It now
  bows the other way.
- Judged at its own size, not at 4×: four candidates were rendered side by side
  both zoomed and at 19 px in the real circle. The hill and the smile are
  equally legible zoomed; only at 19 px does the first read as a face at all,
  which is why it was never noticed while drawing it.
- Considered and not done, worth knowing if this comes back: two dots above the
  smile make it unmistakably a face, and a small waveform in place of the arc
  would say *audio or video* instead — which is what the card's own sentence
  says, and what the other two cards do with a screen and a microphone. The
  smile is what was asked for and it is what a plain curve at this size can
  carry.
- Files: `src/AddRecordingDialog.tsx`, `CLAUDE.md`.
- Verified: the real `AddRecordingDialog` bundled with esbuild and rendered
  against the real stylesheet at 3× in both colour schemes, at the icon's real
  19 px inside its circle.

### 2026-08-06 — A folder block is a transcript block with a drawer in it

- Changed, Jakub's ask: same height, same title, same distance from the title
  down to what is written under it — the same layout, with the drawer where the
  calendar stands.
- Measured before, so the differences are facts and not impressions: the
  transcript block was 85 px and the folder 76 in the roomy list, 56 against 52
  in the compact one; the folder's name was 16 px/650 in both lists where a
  transcript's is 16/600 roomy and 14.5/600 compact; and the mark was 46 px
  wide against the calendar's 48, so the text column began two pixels further
  left. The gap under the title was already shared.
- Changed: `.folder-row .radek-jmeno`'s own size and weight are gone, so the
  name is whatever a transcript's name is, in both lists.
- Changed: the height of whatever stands at a row's left edge is one value,
  `--radek-znacka` (55 px, 38 compact). The calendar takes it, and the folder
  row asks for it as a minimum. The two block heights are therefore equal by
  construction rather than by two numbers that happen to agree today — which is
  exactly how they came to disagree.
- The mark stays a circle and does not fill that slot: it is 48 px, centred, so
  it reads as a mark rather than as a card pretending to be a calendar. Its
  width is the calendar's, which is what puts both text columns on one pixel.
- Files: `src/styles.css`, `CLAUDE.md`.
- Verified: the real `Library` bundled with esbuild against stubbed Tauri
  modules and both blocks measured in one render, in both lists: 85/85 and
  56/56 tall, 16 px/600 and 14.5 px/600, 7 px from the name down to the
  metadata in both, and the metadata's left edge at 172 for each. Rendered at
  2× in both colour schemes.

### 2026-08-06 — The header button after the work is done says what it opens

- Changed, Jakub's reading and it is right: `Vylepšit` is the state *before*,
  `Vylepšený` was the state *after* — and an adjective with no noun does not
  say what has been improved or what the button will open. It now reads
  `Vylepšený přepis`. English follows with `Improved transcript`.
- Partly supersedes `The detail header's document actions are one word each`
  from 2026-08-05, which shortened all three. That reasoning still holds for
  `Vylepšit` and `Uložit` — a verb takes its object from the screen it stands
  on. It does not hold for a name: `Vylepšený` is not the noun the screen
  supplies, it is a word waiting for one.
- The two states are also now different lengths, which is a small gain of its
  own: the button visibly becomes something else when the document exists,
  rather than losing two letters.
- Files: `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`. The width is
  what a longer header button risks, so the real `Detail` was bundled with
  esbuild against stubbed Tauri commands — an existing improved document, so
  the button is in its second state — and measured at 1400, 1200 and the
  window's own 1000 px minimum: the header holds 57 px, nothing overflows
  horizontally at any of them, and the recording's name still is not clipped.

### 2026-08-06 — English calls it Enhance, and it calls it that everywhere

- Changed, Jakub's ask on the header button: `Improved transcript` reads
  `Enhanced transcript`.
- Changed with it, and this is the part he did not ask for: the whole English
  vocabulary of the feature. `Improve` → `Enhance`, `AI improvement` →
  `AI enhancement`, `Improve transcript` → `Enhance transcript`, `Improve
  again` → `Enhance again`, the save-menu group, the preview title, the version
  switch, both toasts, four error messages and the progress caption. Sixteen
  strings.
- Why all of them: one feature under two English words is exactly the
  `rozlišit` / `rozpoznat` collision the interface was cleared of on
  2026-08-03, and it would have arrived the same way — one label changed, the
  rest left where they were. The button and the dialog it opens must not be
  two different features.
- Left alone: `settings.transcription.beamNote` — `A higher value improves
  accuracy` is the ordinary verb about search thoroughness, not this feature's
  name.
- Czech is untouched. `Vylepšit` / `Vylepšený přepis` is the vocabulary, and
  the two languages are allowed to choose their own word — this is a
  translation decision, not a rename.
- Files: `src/locales/en/{detail,errors,progress,settings}.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (no problems);
  a grep for `improve` across `src/locales/en` leaves only the beam note.

### 2026-08-06 — The model cards read best first

- Changed, Jakub's ask: the transcription models are offered `Precizní`,
  `Vyvážený`, `Rychlý`, then the older generation. It was the reverse — fastest
  first — set yesterday when the order stopped being the backend's alphabet.
- Not a plain reverse of that list, which is the thing worth recording:
  reversing it would have put `small` at the top, because the old order was
  *the three tiers fastest-up, then the older generation*, not one run from
  slow to fast. The new one is best-first within each part, older generation
  still last: `large-v3`, `large-v3-q5_0`, `large-v3-turbo`,
  `large-v3-turbo-q5_0`, `medium`, `medium-q5_0`, `small`. Within a family the
  full model outranks its quantized copy.
- `MODEL_IDS` in `types.ts` is that order and Settings sorts by it; the comment
  above it now says both the rule and the trap. Nothing else reads the
  constant, and the backend still lists files by name — a file list is its
  business, the order they are offered in is the interface's.
- Files: `src/types.ts`, `src/Settings.tsx`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the real
  `Settings` bundled with esbuild against stubbed Tauri commands, handed four
  installed models in a deliberately shuffled order, and the card titles read
  out of the DOM: `Precizní · Vyvážený · Rychlý · Starší`. Rendered at 2× with
  the selected card badged `používá se`.

### 2026-08-06 — The import notice names Slobot, and the two families read alike

- Copy, Jakub's: `app.watchFolder.transcribing.one` is `Nahrávka byla přidána
  do Archivu a Slobot zahájil přepis.` instead of `Nahrávka je v Archivu a
  přepis začal.` — somebody did the adding and somebody started the work,
  where the old sentence described a state that had appeared by itself.
- Changed with it, and this is the gain beyond the one line: the three plural
  forms followed the same construction, so the four now differ from the
  neighbouring `app.watchFolder.added.*` family by exactly their trailing
  clause — `Do Archivu byly přidány nové nahrávky ({count}).` and the same
  sentence plus `a Slobot zahájil přepis.` The two messages a person sees in
  the same place are one sentence with and without the transcription.
- English follows: `The recording was added to the Archive and Slobot started
  transcribing.`
- The product's name is now in the dictionary in a second place (the first was
  `settings.speech.description`), so the translator note on this key carries
  the same instruction — `„Slobot“ je název aplikace — nechte ho v každém
  jazyce tak, jak je.` These two strings are what a future rename has to
  sweep; nothing automatic finds them.
- Files: `src/locales/cs/app.ts`, `src/locales/en/app.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (no problems, no
  informal address).

### 2026-08-06 — Correcting entry: the balanced model is comparable again

- Reverted, on Jakub's word, the entry `The balanced model is above average,
  not comparable` from earlier today. `domain.modelDescription.large-v3-q5_0`
  is `Srovnatelná kvalita, třetinová náročnost. (1,1 GB)` again, English
  `Comparable quality, a third of the load.`
- The argument that entry made still stands on paper — `srovnatelná` compares
  with something the sentence does not name — and he read the two on screen
  and chose the comparison anyway. Worth knowing why that is reasonable: the
  card is never read alone. It sits directly under `Precizní` with its
  `Nejpřesnější čeština`, so the thing being compared with is one line above,
  and `nadprůměrná` measures against an average nobody has been shown either.
- Changed at the same time, Jakub's: the fast model drops `Občas` —
  `Méně přesný, několikanásobně rychlejší. (575 MB)`. English follows with
  `Less accurate, several times faster.` The hedge softened the one thing the
  reader is choosing against, and the three cards are a scale, so each only
  has to name its own end of it.
- Files: `src/locales/{cs,en}/domain.ts`, `CLAUDE.md`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (no problems).

### 2026-08-06 — Recognising speakers no longer wipes every correction

- The one defect in the audit that destroys work, and it is mine, from
  2026-08-04. `insert_segment` writes eleven columns. The table has twelve:
  `puvodni`, the machine's original wording, added that day so the `Opravy`
  list could show `před → po`. `segments()` selects it, so it was read back —
  it was simply never written.
- Why that is worse than a missing column: two paths delete every segment of a
  recording and insert them again from values that already carry `puvodni` —
  `run_diarization` (`transcription.rs:542`) and the one-time sentence-layout
  upgrade (`:1671`). Both round-trip through this function. So **recognising
  speakers on a recording that had been corrected by hand threw away the whole
  record of what was corrected**: the `Opravy` list emptied, and every dashed
  underline in the transcript went with it. Silently, in a transaction that
  reported success.
- The corrected *text* survives — it is in `text`, which is written. What is
  destroyed is the memory of what the machine had said before, which cannot be
  recovered from anywhere.
- Fixed: the column is in the INSERT, with a comment naming the two callers so
  the next person to add a column knows why this list is not free to fall
  behind the table.
- Files: `src-tauri/src/db.rs`.
- Verified: `cargo fmt --all`; `cargo check` with no warnings; `cargo test`
  (73 passed — two new: a segment keeps every column it was given, and
  rewriting the speakers of a corrected recording keeps the corrections). The
  guard was proven by making it fail: with the old eleven-column INSERT put
  back, exactly those two failed and the other 71 passed. A test fixture now
  holds the full `segmenty` schema, which is the second place that duplicates
  the real `CREATE TABLE` — both are noted in the file.

### 2026-08-06 — A screen does not stay lit for a question that was answered No

- What it looked like: pressing `Přepsat` on a transcript detail, then
  answering `Zrušit` to the confirmation or closing the speaker-count dialog,
  left the screen permanently busy — the status said `přepisuje`, the player
  was gone, the recording's own actions were hidden, and nothing was running.
  Only leaving the detail and coming back cleared it.
- Cause: `Detail` set `status("prepisuje")` optimistically the instant the
  button was pressed, on the assumption that pressing a button starts a run.
  It does not: `beginTranscription` may ask first — about overwriting a
  finished transcript, or about how many people speak — and the answer arrives
  much later, or never.
- Changed: starting a transcription now reports whether a run actually began.
  `beginTranscription` returns `Promise<boolean>` — `false` for its early
  exits and `false` when it opened a dialog instead of running — and both
  start paths in `Detail` set the status only when it says yes.
- Changed with it: `running` on the detail no longer rests on that local flag
  alone; it also derives from the live progress phase, so a run started from
  anywhere else lights the screen and a terminal phase clears it.
- Files: `src/App.tsx`, `src/Detail.tsx`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; every caller of
  `onTranscribe` was read against the new type rather than trusted to the
  compiler — the type change catches a forgotten `await`, not a caller that
  ignores the answer.

### 2026-08-06 — A dropped file asks the same questions as one chosen from the picker

- Fixed: dropping a file into the window with automatic transcription on never
  asked how many people speak. The question is `App`'s and every path was
  supposed to go through it; this one went through a *frozen copy* of it.
- Cause: `acceptFiles` is a `useCallback` with `[]` as its dependencies,
  because the window's drop listener is registered once and must not be torn
  down and rebuilt on every render. It therefore closed over the
  `beginTranscription` from the first render — a function whose own closure
  holds the first render's settings, where speaker recognition is off because
  the settings have not arrived from the backend yet. A stale closure, not a
  missing call.
- Changed: a ref holds the current `beginTranscription` and `acceptFiles` calls
  through it. The listener stays registered once and the function it reaches is
  always the current one.
- Changed with it: a batch asks once, for the whole batch. The obvious fix — a
  call per file — would have had each `setPendingTranscription` overwrite the
  last, so four dropped files would have produced one dialog governing one of
  them.
- Files: `src/App.tsx`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`. Not driven end
  to end: dropping a file needs the real window, so the first run should drop
  two files at once with speaker recognition on and see one dialog whose answer
  covers both.

### 2026-08-06 — The transcript does not eat Tab and the space bar

- Fixed: the detail's window key handler claimed `Tab` for walking the
  uncertain spots and `Space` for play/pause, and it did so for **every**
  keystroke in the window. Tab therefore could not move focus anywhere on that
  screen — including inside an open dialog, where it made the keyboard unable
  to reach a confirmation's buttons — and Space could not press a focused
  button, tick a checkbox, or type a space into a field the handler did not
  recognise.
- Changed: the handler stands aside for the things a key already belongs to —
  a text field or a `contenteditable` (it did check those), and now also a
  control (`button, a[href], select, summary, [role="button"], [tabindex]`)
  and any open dialog, found by asking the DOM for `.prekryv-dialogu` rather
  than by listing the modals, so the next one is covered for free.
- Changed, and this is a copy decision I made rather than one that was asked
  for: the uncertain-spot walker moved from `Tab` to `F3`. `Tab` is the
  keyboard's own way of moving between controls and cannot be borrowed
  politely — even guarded, it would still be swallowed everywhere the guards do
  not reach. `F3` is the conventional *find next* and collides with nothing in
  this window. The Quick Tips strip and the wizard's tip say `F3`, in both
  languages.
- Files: `src/Detail.tsx`, `src/SetupWizard.tsx`,
  `src/locales/cs/detail.ts`, `src/locales/en/detail.ts`,
  `src/locales/cs/wizard.ts`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (the wizard's
  `F3` literal keeps its `i18n-ignore`, and both Czech translator notes now
  name the new key — a key's name is the same in every language); the guard
  conditions were read against the dialog markup that produces
  `.prekryv-dialogu`, which is the one selector they depend on.

### 2026-08-06 — Cancelling a download is not something to be congratulated for

- Fixed: cancelling a download in the setup wizard ended on the screen that
  says everything is ready, and the wizard then let itself be finished with
  the component missing.
- Cause: the backend emits `cancelled` for the run and then `download:complete`
  unconditionally — completion means *the batch has stopped*, not *the batch
  succeeded*. The wizard counted only `error` as a failure, so a cancelled
  download was indistinguishable from a finished one.
- Changed: `failedIds` counts `error` and `cancelled` alike. A cancelled
  component is offered again, exactly like one that failed.
- Files: `src/SetupWizard.tsx`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; the two events
  were read against `download.rs` rather than remembered — the `complete` emit
  is outside the success branch, which is what makes this necessary.

### 2026-08-06 — The veil behind a dialog is dark in the dark theme too

- Fixed: `.prekryv-dialogu` was `hsl(var(--ds-foreground) / 0.35)`.
  `--ds-foreground` is the *text* colour, which in the dark palette is nearly
  white — so opening any dialog in the dark theme washed the window in white
  haze instead of dimming it, and the dialog sat on a background lighter than
  itself.
- Changed: a token of its own, `--zaves`, in both palettes —
  `hsl(240 7% 11% / 0.35)` light, `rgb(0 0 0 / 0.55)` dark. A scrim is its own
  decision, not a tint of something else; deriving it from a foreground colour
  is what let it invert.
- Files: `src/styles.css`.
- Verified: the real `ConfirmationDialog` bundled with esbuild and driven in a
  browser against the real stylesheet in both palettes, with the resolved
  colours and their relative luminance read out rather than judged from a
  screenshot — light: scrim `rgba(26, 26, 30, 0.35)` at 0.103 against a dialog
  at 1.00; dark: scrim `rgba(0, 0, 0, 0.55)` at 0.00 against a dialog at 0.154.
  The dialog is lighter than its veil in both, which is the whole point, and
  the dark screenshot was read to confirm the depth reads correctly.

### 2026-08-06 — A translation cannot go stale in silence any more

- The defect this closes is not a string, it is a blind spot. `i18n:check`
  could see a key with no translation, a key that no longer exists in the
  source, a broken `{placeholder}` and a missing plural form. It could not see
  the one thing that actually went wrong: a translation that was correct when
  it was written and whose Czech has been reworded since. Both look identical —
  a present, non-empty value under a key that exists in both languages.
- Jakub's question, and it is the right one to ask: the key *is* the same
  identifier in both files, so why is that not enough? Because a shared key
  binds the pair — this English belongs to that Czech — and says nothing about
  whether it is still its *translation*. The key survives a rewording untouched.
- Added: `src/locales/sources.json`, a fingerprint of the Czech each
  translation was written from — sha256, first twelve hex characters, one map
  per language. `check` compares it with the Czech of today and fails with the
  key, both values, and the command to accept it. `import` records the
  fingerprint for every key it folds in, because that is the step somebody
  would otherwise forget. `approve <language> [keys…]` records it by hand — for
  the case where Czech was reworded and the existing translation already says
  the new thing, which is a real case and must not require rewriting a correct
  sentence.
- Where the file lives is deliberate: `languages()` lists directories and
  `namespaces` reads only `cs/*.ts`, so a JSON file beside the language folders
  is mistaken for neither. `usedKeys()` and `sourceFiles()` both skip
  `locales/`, so it is not scanned as source either.
- Files: `scripts/i18n.mjs`, `src/locales/sources.json`, `ARCHITECTURE.md`,
  `README.md`.
- Verified by making it fail, not by watching it pass: one Czech value
  (`detail.edits.empty`) was reworded with English left alone, and the check
  named that key, printed both sentences and exited non-zero; restoring the
  Czech returned it to zero. It then fired for real, unprompted, on the four
  `errors.tools.*_missing_in` strings later in this batch — which is the first
  time this project has had a guard catch a defect in the same session it was
  written.
- Honest limit: the baseline was recorded with `approve en` after the review
  below, so it certifies exactly what that review checked. Anything both passes
  missed is now recorded as approved and will not be reported. The guard makes
  every *future* drift visible; it cannot vouch for the past.

### 2026-08-06 — The English says what the Czech says today

- Thirty-three English strings no longer matched their Czech source. Every one
  of them sits on a string Czech renamed after the translation was written,
  which is exactly the failure the guard above now catches.
- **Retired vocabulary, the half that matters.** `Cleaner edit` was still the
  translation of `Čistší text`, a name superseded on 2026-08-02 — the Czech has
  said `Vylepšená úprava` since, and English settled on the `Enhance` family on
  2026-08-06, so the one card in that dialog contradicted both. Four dictionary
  strings said `glossary` while the Settings tab they refer to is `Dictionary`.
  `settings.modules.compute` said `Compute`, the word Settings dropped in
  favour of `Výkon`/`Performance` on 2026-08-02, and the same Czech word two
  keys away already read `Performance`. Five strings said
  `separation`/`Separate speakers` for the feature unified as
  `rozpoznat`/`identify` on 2026-08-03. `wizard.editor.lightName` was `Light`
  where the same Czech tier is `Lightweight` in Settings.
- **The Czech was stale too, in five places**, and this is the more useful
  find: `catalog.sherpa.name`, `settings.modules.speakers` and
  `wizard.manual.groupSpeakers` still read `Rozlišení mluvčích`, and
  `settings.speakers.toggle` `Rozlišovat mluvčí`. The 2026-08-03 entry that
  unified this vocabulary claimed a grep found no `rozlišit`/`rozlišen`
  remaining — it was case-sensitive, and every survivor begins a sentence with
  a capital R. A grep is a guard, and a guard has to be tested against the
  thing it is meant to catch.
- **Fifteen straight apostrophes** — `don't`, `won't`, `Google's`,
  `Let's` — including one inside `settings.appearance.previewText`, the sample
  that exists to demonstrate typography.
- **Four sentences said something else.** `detail.edits.empty` still carried
  the second-person Czech dropped on 2026-08-05 for being gendered.
  `settings.about.abilityEditor` made the language model the subject where the
  Czech makes the application one, alone among seven sibling lines.
  `settings.dictionary.description` narrowed `odborné výrazy` to terms from the
  reader's own field and called the transcript the activity, against its own
  translator note. `dialogs.speakers.intro` said the guess "gets two people
  wrong" — misidentifying two speakers — where the Czech says the guess is
  often wrong *when there are two*, which is the measured claim the dialog
  exists for.
- **Two more said too much:** `catalog.ffmpeg.description` turned
  `Bez něj to nepoběží` into "Nothing runs without it", widening a claim about
  transcription into one about the whole application, and
  `catalog.vad.description` had the finished document getting stuck in a loop
  rather than the run.
- **Fixed at the source, both languages:** four error messages sent the reader
  to the `složka programů` and to `Moduly`. Settings renamed those to
  `Složka nástrojů` and `Modely`, so the messages named two things that are not
  on screen.
- Files: `src/locales/en/{app,catalog,detail,dialogs,errors,settings,wizard}.ts`,
  `src/locales/cs/{catalog,detail,dialogs,errors,settings,wizard}.ts`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` reports 879/879
  and no problems; a grep for `glossary`, `Speaker separation`,
  `Separate speakers`, `"Compute"`, `Cleaner edit`, any `rozliš` in the Czech,
  and any straight apostrophe between letters in English all come back empty.
  Method: two independent passes, both by readers with no memory of the other.
  The first compared the pairs directly against a list of settled vocabulary
  and found 29; the second back-translated each English value into Czech
  without looking at the Czech first, and found 4 more that the first had
  read past. The second pass is what justifies the baseline recorded above.
- Left alone, and it is a naming decision rather than a defect:
  `catalog.editor-model-best.name` is `Nejlepší jazyková úprava` while the
  tier it downloads is `Nejvyšší kvalita`. Both languages agree with each
  other, so this is the Czech disagreeing with itself. The 2026-08-05 entry
  that renamed the tier flagged the same thing and left it; it is still one
  string to change if the two should be one name.

### 2026-08-06 — The repository is ready to be pushed

- `.gitignore`: added what a portable copy or a dev run writes beside itself —
  `data/`, `playback-cache/`, `microphone/`, `online-media/`, `prenosna.txt`
  and the three SQLite files. The archive normally lives in `%APPDATA%`, but a
  portable copy keeps it in the program's own folder, and an archive is the
  user's recordings. Also `.harness/` (the esbuild bundle used to render real
  components in a browser), `.vscode/`, `.idea/` and `.env*`.
- `ARCHITECTURE.md` still called the application `Whisper Studio`, a name it
  has not had since the rename on 2026-08-05 — the one document that opens by
  saying what this program is. Its source layout was also three modules behind:
  `ai_edit.rs`, `online_import.rs` and `user_message.rs` were missing, and the
  list of what `i18n:check` refuses did not include the informal-address guard
  from 2026-08-05 or the staleness guard from today.
- `README.md` said **`Fronta neexistuje`** — ten dropped files start ten
  transcriptions at once and fight over the graphics card. That was true when
  it was written and stopped being true earlier today, when the serial queue
  was built. The paragraph now says the opposite, which is the point.
- `README.md` also told a fresh clone to run `npm run tauri icon
  icon-source.png` before anything would build. The generated icons are
  tracked — all 52 of them — so the step is only needed after changing the
  source image, and the note says so.
- Added: `.github/workflows/check.yml`. Two jobs on Ubuntu — `tsc --noEmit`
  plus `i18n check`, and `cargo fmt --check`, `cargo check --all-targets` with
  warnings as errors, `cargo test`. Ubuntu rather than Windows because these
  compile and test rather than bundle, the Rust is platform-independent, and a
  private repository pays double for a Windows runner. The installer is still
  built by hand on Windows.
- Not added: `SECURITY.md`. It exists to tell a stranger where to report a
  vulnerability privately, and this repository has no strangers.
- Files: `.gitignore`, `ARCHITECTURE.md`, `README.md`,
  `.github/workflows/check.yml`.
- Verified: every command the workflow runs was run here first, so the first
  push cannot arrive red — `cargo fmt --all --check`, `cargo check
  --all-targets` under `RUSTFLAGS=-D warnings` (silent), `cargo test`
  (73 passed), `npx tsc --noEmit`, `node scripts/i18n.mjs check`. The workflow
  file parses as YAML. The Tauri system libraries the Linux `cargo check`
  needs are installed explicitly in the job.

### 2026-08-06 — The installer says who made it, and what it is not carrying

Jakub's three decisions, taken on the questions the audit left open: the
publisher is the company, uninstalling keeps everything, and the program is to
be signed.

- **Publisher.** `tauri.conf.json` said `Radomil Martinec` while `Cargo.toml`
  said `značkárna s.r.o.` — the name a reader meets in the installer, in the
  file's own properties and in the SmartScreen window disagreed with the name
  in the package. Both now say `značkárna s.r.o.`, which is also what
  `cz.znackarna.whisp` and the repository already said. Added `copyright`
  beside it.
- **Three descriptions, one sentence.** `Cargo.toml` said "Local audio
  transcription with Whisper", `shortDescription` said `Přepis zvukových
  záznamů`, and the About card says `Převádí mluvené slovo na text.` The last
  one is the settled tagline, so `shortDescription` is now that; the new
  `longDescription` is the About card's own paragraph; the Cargo description
  is developer-facing and stays English, but says the same thing.
- **The licence page, and the thing worth getting right.** `bundle.licenseFile`
  points at a new `src-tauri/LICENSE.txt`, shown by NSIS before installing.
  The interesting part is what it can honestly claim: **the installer carries
  the program alone.** Every tool and model — ffmpeg included — is downloaded
  on first run, directly from its author, by `download.rs`. So this installer
  does not distribute FFmpeg, and its GPL v3 is not triggered by handing
  somebody the setup file. It *is* triggered by the portable copy, which
  bundles `bin/`, and the About card has said so since it was written. The
  licence page names both cases separately rather than blurring them into one
  warning, and does the same for Gemma, which is not open source at all.
- **Uninstalling keeps both folders**, Jakub's call and the default:
  `%LOCALAPPDATA%\Whisp` (2–12 GB of models) and
  `%APPDATA%\cz.znackarna.whisp` (the archive — somebody's recordings). NSIS
  removes the program only. Nothing had to be configured for this; it is
  recorded because it is a decision, and because the README now tells the
  reader where to look if they do want to clear it.
- **Signing** is documented rather than configured, and deliberately.
  A thumbprint identifies a certificate on one machine, so a value committed
  here would break the build for anyone else and be wrong the moment the
  certificate is replaced. `README.md` gained a `Vydání` section with the
  three lines to add and how to read the thumbprint out of the certificate
  store.
- Worth knowing before the certificate is bought, and it is why the README
  says it rather than just listing steps: since June 2023 the private key must
  live on a hardware token or in a cloud HSM for **both** OV and EV — the
  downloadable `.pfx` is gone. And the difference that matters here is not the
  strength of the signature but SmartScreen's reputation: EV is trusted
  immediately, OV has to earn it through downloads. Buying OV to make the blue
  window go away does not make the blue window go away.
- Added `publish = false` to `Cargo.toml`. Nobody is going to publish this to
  crates.io on purpose.
- Files: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  `src-tauri/LICENSE.txt`, `README.md`.
- Verified: `tauri.conf.json` still parses as JSON and every field added was
  checked against `tauri-utils 2.9.3`'s own `BundleConfig` rather than
  remembered — `copyright`, `shortDescription`, `longDescription` and
  `licenseFile` (serde `license_file`) all exist there, which is what the
  published schema is generated from. `cargo fmt --all --check`;
  `cargo check --all-targets` with warnings as errors; `cargo test`
  (73 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs check`.
- Not verified here, and it needs the real machine: `npm run tauri build` has
  never been run against this configuration. The field names are right, but
  whether the NSIS licence page renders `LICENSE.txt` the way it reads on
  paper is something only a build on Windows can show. Run it once before
  handing the installer to anybody.

### 2026-08-06 — The build broke on a compiler nobody upgraded on purpose

- What Jakub saw on the first `npm run tauri build` with the new installer
  configuration: it never reached the bundler. `tsc --noEmit`, which
  `npm run build` runs first, failed on `src/recorder.tsx:355` —
  `Uint8Array<ArrayBufferLike>` is not assignable to `Uint8Array<ArrayBuffer>`.
- Why it did not fail here, and this is the part worth keeping: `package.json`
  asked for `typescript: ^5.6.3`. This session had 5.6.3 installed; his
  `node_modules` and his `package-lock.json` both hold **5.9.3**. TypeScript 5.7
  made the typed arrays generic over their buffer, so `new Uint8Array(n)` is
  `Uint8Array<ArrayBuffer>` while a parameter written as a bare `Uint8Array`
  means `Uint8Array<ArrayBufferLike>` — and `getByteFrequencyData` accepts only
  the first. Under 5.6 the two are one type and the code is correct. Every
  `npx tsc --noEmit` recorded in this file was run against a compiler older
  than the one that actually builds the application.
- Fixed: the parameter's type is read off the DOM signature —
  `type FrequencyBins = Parameters<AnalyserNode["getByteFrequencyData"]>[0]`.
  Writing either spelling out is an error under the other version; taking it
  from the method that will receive it is right under both, and stays right if
  the lib changes again.
- Fixed properly, which is the other half: `typescript` is pinned to `5.9.3`
  exactly instead of `^5.6.3`. A caret range on a *compiler* means the build
  can break with no change to the code, from a machine that merely ran
  `npm install` on a different day — which is exactly what happened. Nothing
  else here needs a floating range less than the thing that type-checks it.
- Lesson, and it is the `package.json` lesson from 2026-08-03 wearing different
  clothes: a check run against a different toolchain than the one that ships is
  not the check. Compare versions with the user's tree, not only file contents.
  The CI workflow added earlier today uses `npm ci`, so it would have caught
  this on the first push — it takes the lock file's 5.9.3.
- Added while in the file: `npm run i18n:approve`, so the new command has a
  script beside its five siblings rather than only a path to remember.
- Files: `src/recorder.tsx`, `package.json`.
- Verified on both compilers, in one run: `npx tsc --noEmit` fails on 5.9.3
  before the change with exactly Jakub's error, and passes on 5.9.3 and 5.6.3
  after it. `node scripts/i18n.mjs check`; `cargo test` (73 passed).

### 2026-08-06 — The licence page is written the way NSIS reads it

- `LICENSE.txt` was written UTF-8 without a BOM and with plain LF endings,
  which is right for every other file in this repository and wrong for the one
  file NSIS reads.
- NSIS's own documentation for `LicenseData` says the text file must be in DOS
  format (`\r\n`). And a Unicode `makensis` recognises UTF-8 by its BOM;
  without one it reads the file in the system code page, so on a Czech Windows
  every diacritic on the first page of the installer would have arrived as
  mojibake — `LicenÄnÃ­ ujednÃ¡nÃ­`. Half of that page is Czech.
- Changed: the file carries a BOM and CRLF. `.gitattributes` gets
  `src-tauri/LICENSE.txt text eol=crlf`, beside the rule that already exists
  for `.bat`, `.cmd` and `.ps1` — without it the repository's blanket
  `* text=auto eol=lf` would put the LF endings straight back on the next
  checkout.
- Files: `src-tauri/LICENSE.txt`, `.gitattributes`.
- Verified: the bytes, not the intent — the file begins `EF BB BF`, holds 103
  CRLF line endings and no bare LF, and still decodes as UTF-8.
- Honest limit: the CRLF requirement is from the documentation and the BOM is
  the ordinary behaviour of a Unicode `makensis`, but neither was tried against
  a real build here. The first page of the installer answers it at a glance.

### 2026-08-06 — Leaving the setup is allowed; losing it is not

- Jakub's report: the first-run setup has a route into Settings, and somebody
  who takes it does not know how to get back. His question was how to make the
  setup run to the end with no detours; his answer, when asked, was that
  *"teď ne, jen se chci podívat"* should stay possible. That settles the shape:
  the defect is not that the door exists, it is that it opens one way.
- **The route he meant was mislabelled, not missing.** The Archive already
  shows a red strip when transcription cannot run, and its button already
  opened the wizard — but the button read `Nastavení` and its prop was called
  `onToSettings`. So the one control that finishes the job announced itself as
  the detour that loses people. It now reads `Dokončit nastavení`, is the
  primary button rather than a quiet one, and the prop is `onFinishSetup`.
- **Found by rendering it, and worse than the label:** that strip lived inside
  `archive-scroll-content`, *below* a 389 px hero. On a first run the whole
  screen was the hero — and the hero cheerfully said `Přepis se spustí
  automaticky. Data neopustí počítač.` over an installation with no ffmpeg and
  no model. The one sentence a new reader is certain to read was a promise the
  application could not keep, and the sentence correcting it was off the fold.
- Changed: the strip is the first thing on the screen, above the pinned block,
  with the hero's own 40 px inset. It is not a row in the list; it is the state
  of the application.
- Changed: while anything required is missing the hero says
  `Nahrávku můžete přidat, přepsat ji ale Slobot zatím neumí.` — which is both
  true and useful, since adding still works and the recording will simply wait.
- Changed: the required wizard keeps the ordinary back button in the header.
  One deliberate door, in the same corner as on every other screen, instead of
  a screen that pretends to have none while three accidental exits stay open.
  That is only safe because of the strip above — the way back is now the most
  prominent thing in the Archive for exactly as long as it is needed.
- Changed: `Vybrat ručně` remembers which step it was pressed from, so `Zpět`
  from the component list returns to the question that was being answered
  instead of dropping the reader on step 3, which they never walked.
- Considered and rejected, though it was my own proposal: deriving
  `wizardRequired` from the tool check on every reload, so the wizard reasserts
  itself and no exit can be forgotten. It is the more robust shape and it is
  the wrong one here — it makes "just let me look around" impossible, and Jakub
  asked for that explicitly. The same robustness is bought instead by making
  the way *back* impossible to miss, which does not cost the reader anything.
- Files: `src/App.tsx`, `src/Library.tsx`, `src/SetupWizard.tsx`,
  `src/styles.css`, `src/locales/cs/library.ts`, `src/locales/en/library.ts`.
- Verified: the real `Library` bundled with esbuild against stubbed Tauri
  modules and driven in a browser against the real stylesheet, in both states
  and both languages. With components missing: the strip is at y 40, fully
  visible at 1360×760 and at the window's own 1000×660 minimum, sits entirely
  above the hero, its button is `Dokončit nastavení` and clicking it fires
  `onFinishSetup`; the hero reads the blocked sentence. With nothing missing:
  no strip, the hero back at y 0 at its usual 388 px with its usual sentence,
  so the healthy screen is untouched. No horizontal overflow at either width.
  `npx tsc --noEmit`; `node scripts/i18n.mjs check` — which stopped the two
  reworded Czech strings until their English was confirmed.

### 2026-08-06 — The Czech installer had no Czech of its own

- Jakub's screenshot of the last installer page: a second checkbox under
  `Spustit program Slobot` with no label at all.
- What it is: `MUI_FINISHPAGE_SHOWREADME`, which Tauri repurposes as the
  desktop-shortcut option — `!define MUI_FINISHPAGE_SHOWREADME_TEXT
  "$(createDesktop)"` at `installer.nsi:405`.
- Why it was empty, read out of the generated script on his own disk rather
  than guessed: `installer.nsi` does `!insertmacro MUI_LANGUAGE "Czech"` and
  then `"English"`, so a Czech Windows runs the installer in Czech — but the
  only language file it includes is `English.nsh`, which defines all **27** of
  Tauri's own strings for `${LANG_ENGLISH}` alone. In Czech every one of them
  resolves to an empty string. The MUI text around them is Czech because that
  comes from NSIS's own `Czech.nlf`, which is what made the page look complete.
- So the missing checkbox label was the mildest symptom. On an upgrade the
  maintenance page draws its title from `$(alreadyInstalled)` and its radio
  buttons from `$(addOrReinstall)`, `$(uninstallBeforeInstalling)` and
  `$(dontUninstall)` (`installer.nsi:232–250`) — a blank heading over blank
  choices. `$(appRunning)` is the message box shown when the application is
  open during install. `$(deleteAppData)` labels the uninstaller's checkbox.
  All silent.
- Added: `src-tauri/nsis/Czech.nsh`, all 27 strings for `${LANG_CZECH}`, wired
  through `bundle.windows.nsis.customLanguageFiles`.
- Fixed in passing: Tauri's English file writes `{{product_name}}` in four
  strings and never substitutes it — the output file in `target` still holds
  the braces — so an English user is told `{{product_name}} is running!`. The
  Czech strings use `${PRODUCTNAME}`, which is a real NSIS constant defined in
  the same script.
- Kept as it is, and it matches the decision taken earlier today: the
  uninstaller's `deleteAppData` checkbox is created without `BM_SETCHECK`, so
  it is unticked by default — uninstalling keeps the archive unless somebody
  deliberately asks otherwise. It only ever lacked a label. Czech now says what
  it deletes, `data aplikace (archiv s přepisy)`, rather than the English's
  bare `the application data`.
- The file is UTF-8 with a BOM and CRLF, like `LICENSE.txt` and for the same
  reason — Tauri's own `English.nsh` begins with a BOM too, which is the
  confirmation that guess was right. `.gitattributes` gains `*.nsh text
  eol=crlf`.
- Files: `src-tauri/nsis/Czech.nsh`, `src-tauri/tauri.conf.json`,
  `.gitattributes`.
- Verified: the 27 identifiers were diffed against the ones Tauri's generated
  `English.nsh` actually defines — none missing, none invented. `$R4`, `$0`,
  `$1` and `$\n` are preserved where NSIS substitutes them, and `$R4` reads
  grammatically in Czech with either value it can take (`starší verze`,
  `neznámá verze`). `tauri.conf.json` still parses; `customLanguageFiles` is
  `custom_language_files` in `tauri-utils 2.9.3`, whose documentation requires
  the key to be a valid NSIS language present in `languages` — `Czech` is both.
- Not verified here: the build. The next `npm run tauri build` shows the
  checkbox with its label, and that is also the moment to look at the two
  pages nobody has seen in Czech yet — install over an existing copy to reach
  the maintenance page.

### 2026-08-06 — The microphone is not asked for by a stranger

- What Jakub saw when he started a recording: WebView2's permission prompt,
  asking on behalf of **tauri.localhost**.
- Why that name and not `Slobot`: WebView2 treats the application as a web page
  and prompts in the name of the origin serving it. On Windows Tauri serves
  from `http://tauri.localhost`, and the host is not configurable — the only
  related setting, `useHttpsScheme`, chooses the scheme and nothing else. Nor
  *should* it be configurable: a page that could choose how it is announced in
  a permission prompt would make the prompt worthless.
- So the name cannot be changed and the prompt can only be answered before it
  is raised. `allow_microphone` registers a `PermissionRequested` handler on
  the WebView2 controller and sets `MICROPHONE` to `ALLOW`.
- The consent is not skipped, it is moved to where it means something. The
  recorder is opened on purpose, and its own dialog says the microphone is
  being opened and that `ani slovo neopustí váš počítač`. The system prompt
  repeated that question in a name the person has never seen.
- Scope, deliberately narrow: only `MICROPHONE` is answered. Camera, location,
  notifications and clipboard fall through untouched and still prompt. This
  webview loads nothing but the bundled interface, so there is no third-party
  page that could be the one asking — which is also why the handler does not
  bother parsing the requesting URI, and the comment says so rather than
  leaving the next reader to wonder.
- Dependency: `webview2-com` at exactly `0.38.2`, Windows-only, which is the
  version `wry 0.55` already links. Two copies of these COM bindings in one
  binary would be two unrelated types sharing a name, and the error message for
  that is famously unhelpful.
- Files: `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
- Verified as far as this session can: `cargo tree --target
  x86_64-pc-windows-msvc -i webview2-com` resolves **one** version, 0.38.2,
  shared by `slobot`, `tauri`, `tauri-runtime` and `wry` — the version skew
  above is ruled out, and it was the likeliest way this breaks. `Cargo.lock`
  gains exactly one line. Every name and signature the new code uses was read
  out of the vendored sources rather than remembered: `PlatformWebview::
  controller()` in `tauri 2.11.5`, `CoreWebView2()` and
  `add_PermissionRequested(handler, *mut i64)` in `webview2-com-sys 0.38.2`,
  `PermissionRequestedEventHandler::create(EventClosure<Option<ICoreWebView2>,
  Option<ICoreWebView2PermissionRequestedEventArgs>>)` from the
  `#[event_callback]` macro, and `COREWEBVIEW2_PERMISSION_KIND` deriving
  `Default` and `PartialEq`. `cargo fmt --all --check`, `cargo check
  --all-targets` with warnings as errors and `cargo test` (73 passed) all pass
  on Linux.
- **Not compiled, and this is the honest limit.** The new code is behind
  `#[cfg(windows)]`, so nothing here has type-checked it: `rustup target add
  x86_64-pc-windows-msvc` cannot reach `static.rust-lang.org` from this
  session, and without that target's `rust-std` even `cargo check` refuses.
  This is the same shape of gap that let the TypeScript version skew through
  earlier today — recorded plainly rather than glossed. The build on Windows is
  the first thing that will read this code.

### 2026-08-06 — The installer carries the brand

- Jakub asked whether the installer's graphics can be changed and supplied two
  artworks made for it: a portrait lockup — cube, `Slobot™`, and the značkárna
  mark at the foot — and a horizontal one for the header.
- NSIS has three image slots and Tauri exposes all three. Two are now filled:
  `sidebarImage` (the panel on the welcome and finish pages, replacing MUI's
  default blue) and `headerImage` (the strip in the header of every other page).
  `installerIcon` is left alone; the setup executable already takes the
  application's own icon.
- The artworks arrived at the right proportions, which is why they need no
  cropping: the horizontal one is 300 × 114, exactly twice the header's
  150 × 57, and the portrait one is 328 × 632 against the panel's 164 × 314 —
  0.519 to the panel's 0.522, so it fits by height with half a pixel of white
  either side. Nothing is stretched and nothing is cut.
- Format is not a preference here: NSIS reads **24-bit uncompressed BMP** and
  nothing else. The files were verified by reading their own headers back —
  164 × 314 and 150 × 57, 24 bpp, compression 0.
- `.gitattributes` gains `*.bmp binary`, and that line matters more than it
  looks. The repository normalises everything with `* text=auto eol=lf`; a BMP
  is full of bytes that happen to equal CR and LF, and git would have rewritten
  them on checkout. The image would have arrived corrupt on a fresh clone and
  the build would still have succeeded.
- Not used, and worth recording so nobody hunts for it: an earlier pass built
  candidate panels from `src/logo.svg` and `src/wordmark.svg`. Those are
  `řečník` — a name this application has not had for a long time, kept in the
  repository and referenced by nothing.
- Files: `src-tauri/nsis/sidebar.bmp`, `src-tauri/nsis/header.bmp`,
  `src-tauri/tauri.conf.json`, `.gitattributes`.
- Verified: both bitmaps' headers, and both slots rendered into a mock of the
  welcome page and the header bar at 2× to check the artwork sits where MUI
  will put it. `tauri.conf.json` still parses, and `sidebarImage` and
  `headerImage` are `sidebar_image` and `header_image` in `tauri-utils 2.9.3`.
- Not verified: the build. The welcome page is the first thing the next
  `npm run tauri build` will show.

### 2026-08-06 — Nothing here quietly takes work away any more

The last blocking finding from the audit and the five things around it that can
cost somebody their work. Each is its own paragraph because each has its own
reason; all of them are covered by tests that were made to fail first.

**Closing the window takes the programs with it.** `std::process::Child` does
not kill on `Drop`, the worker threads are detached, and nothing asked them to
stop — so closing the window during a transcription left `whisper-cli` or
`sherpa-onnx` running, holding the graphics card and writing into
`%TEMP%\whisp\<id>`, which the next start deletes from underneath it. Worse,
`llama-server` stayed resident with a seven-gigabyte model. `TranscriptionTask::
kill_all` and `AiEditTask::kill_server` are called from `RunEvent::ExitRequested`
— while the state is still there to read — with `Exit` kept as the net.
`EditorServer` had to change shape for it: the child now lives in a shared
registry rather than inside the struct, because `Drop` is exactly the thing
that does not run when a process ends.

**A dictionary entry holding `$` no longer eats the text.** `replace_all` treats
the replacement as a template, so `$` opens a capture-group reference and
`cena $5` wrote `cena `. It ran on every transcription *and* on already saved,
hand-corrected text. `regex::NoExpand` — the replacement is what the person
typed, not a pattern.

**A row that cannot be read fails the read instead of disappearing.**
`segments()` used `filter_map(|r| r.ok())`, and it is what the two
delete-and-reinsert paths read from: a dropped row stopped being a hole in the
display and became a deletion. `folder_recording_ids` had the same shape, where
a dropped id is a recording orphaned in a folder that is about to go.

**A transcript that finished is not reported as a failure.** The terminal
`set_status` was `let _ =`; a failed write left the row on `prepisuje` and the
next start called it an interrupted run — a forty-minute transcript that went
fine came back as an error. It is retried on a fresh connection, and
`recover_interrupted` now heals the class rather than the instance: a
`prepisuje` row whose segments exist is a run that finished and failed to say
so. Segments are written in one transaction at the very end, including a
re-run, so their presence means a complete transcript either way.

**Unreadable settings are kept rather than thrown away.** `unwrap_or_default()`
handed back defaults and the next save wrote over the broken text, so the loss
was silent and permanent. The original is copied to `nastaveni-poskozeno`
first; defaults are still the only way to carry on, but the paths and choices
are recoverable by hand.

**Moving and deleting folders are one step or none.** Both looped with `?` in
the middle, so a failure left half a selection in one folder and half in
another, or a folder gone with its recordings still pointing at it. Both are
one transaction now, including the loop in `main.rs` that deletes a folder's
contents.

**A second speaker recognition cannot start beside the first.** The guard read
the recording's row, which is set only after the queue lets the worker through.
`TranscriptionTask::is_running` existed, was `pub`, and nothing called it — an
earlier entry claimed otherwise. It is called now, before the row is consulted.

**Four more, on the side the user touches.** A note — the one thing here a
person wrote themselves and the one thing that cannot be produced again — was
deleted on a single click, while deleting a folder asks and offers two answers;
it asks now, and shows the note's own text in the question. Two destructive
confirmations rendered `title ?? ""` and asked `Přepis  bude smazán.` about a
recording nobody had renamed; they fall back to the file name like everywhere
else. `ConfirmationDialog.action` was typed `() => void` while every caller
passes an `async` function, so a failed deletion closed the dialog and said
nothing — the type admits a promise, the dialog closes first and reports a
rejection. And `styles.css` carried `content: " — nejrychlejší"`, a Czech
sentence that appeared in the English interface and that `i18n:check` cannot
see, because it reads TypeScript.

**The waveform stops redrawing a picture that has not changed.** The rAF loop
was unconditional, so an open transcript repainted the canvas sixty times a
second whether or not anything was playing. A frame is now skipped when every
input to `drawBars` is identical. Worth recording: the first version of that
signature quantised the position to the played pixel and would have **frozen
the waveform during playback** — `equalizerAtTime` interpolates the envelope at
the exact time, so the bars move within a single pixel of travel. The signature
carries `readTime()` whole.

- Files: `src-tauri/src/db.rs`, `src-tauri/src/transcription.rs`,
  `src-tauri/src/ai_edit.rs`, `src-tauri/src/main.rs`,
  `src/ConfirmationDialog.tsx`, `src/App.tsx`, `src/Detail.tsx`,
  `src/PlaybackControls.tsx`, `src/Settings.tsx`, `src/styles.css`,
  `src/locales/cs/{detail,settings}.ts`, `src/locales/en/{detail,settings}.ts`.
- Verified: `cargo fmt --all`; `cargo check --all-targets` with warnings as
  errors; `cargo test` — **82 passed**, nine of them new. `npx tsc --noEmit`;
  `node scripts/i18n.mjs check`.
- Every new test was made to fail before it was believed. With the defects put
  back one at a time, six of the eight data tests failed and the two guard
  tests passed in both directions, which is what tells them apart. The
  window-closing test is the one worth describing: its first version asserted
  on counts and on the registry being emptied, and it **passed against a
  `kill_all` that merely forgot the children**. It now holds each child's
  stdout pipe open and reads it to EOF on another thread with a five-second
  timeout — the pipe closes when the process ends and not before — so the death
  is observed rather than inferred. Against the forgetting version it fails
  with `program 0 was still running after kill_all`.

### 2026-08-06 — A download outlives the screen that started it

- What Jakub saw: he started downloading a model, left Settings, came back —
  and it began downloading again, after which the progress jumped between two
  values.
- **Cause, and it is the backend.** `install_bundle` spawned a thread and
  guarded nothing. A second call therefore fetched the same components into the
  same destination while the first was still writing them, and both reported
  `download:progress` for the same id — which is the jumping. Worse, the
  command's first act was `download_cancellation.store(false)`, so starting a
  second download **wiped the stop request the first one was watching**. That
  is the same shape as the transcription `cancel` defect from 2026-08-04.
- Fixed: one `INSTALLING` flag for the whole application, taken with a `swap`
  so the check and the claim are one step, and dropped by a guard rather than a
  line at the end so a panic cannot leave it standing. The command asks it
  before clearing the cancellation, and a refused call says
  `Stahování už běží.` rather than starting a rival.
- The flag belongs to the application, not to a screen: what it protects is a
  destination on disk.
- **And the reason a person reached for the button twice.** The download was
  invisible the moment they left the wizard, so starting it again was the
  obvious move. Jakub's ask: a bubble in the lower right, like the other
  progress the application shows. There is now one — the same bubble the
  transcript detail uses, moved into `src/ProgressBubble.tsx` and shared rather
  than copied, with a third variant whose mark is an arrow into a tray. It
  names the component from the catalogue (`Stahuji Precizní model`), shows the
  percentage, and its cross cancels.
- Deliberately hidden on the wizard: that screen lists every component with its
  own progress, and a bubble repeating one of them would be noise.
- `download:progress` with a phase of `complete` means one component of the
  bundle, not the bundle. The bubble stays up until `download:complete`, which
  is what stops it flickering off and on between files.
- Files: `src-tauri/src/download.rs`, `src-tauri/src/main.rs`,
  `src/ProgressBubble.tsx` (new), `src/Detail.tsx`, `src/App.tsx`,
  `src/locales/{cs,en}/{app,errors}.ts`.
- Verified: `cargo fmt --all`; `cargo check --all-targets` with warnings as
  errors; `cargo test` (83 passed, one new over the guard). `npx tsc --noEmit`;
  `node scripts/i18n.mjs check`. The bubble was driven in a browser against the
  real `App` and the real stylesheet, with the Tauri event channel stubbed so
  progress could be fired by hand: absent before any event, then
  `Stahuji Precizní model · 20 %` 22 px from the right and 52 px from the
  bottom — clear of the status footer — the bar following to 70 %, the cross
  both hiding it and reaching `cancel_download`, and `download:complete`
  taking it away.

### 2026-08-06 — Checking for a new version

Jakub's two decisions: the full automatic updater, and a separate **public**
repository that holds only releases.

- **Why the releases repository is public, and why that is the right answer to
  the question he asked** — whether a token could be scoped to one repository.
  It can: GitHub's fine-grained tokens do exactly that, read-only, one repo,
  and Tauri's updater can carry custom headers. It still does not work, because
  the token would live inside an application handed to other people. Anything
  in a distributed binary is public; scoping only makes reading it one step
  harder. It would also expire — at most a year — and could not be replaced
  remotely, because it is in the copy already installed. The rule with no
  exception: nothing secret goes into a binary somebody else runs. A public
  releases repository needs no secret, so the *source* stays private, which is
  the thing that actually matters.
- Added: `tauri-plugin-updater` (rustls rather than the system TLS — one less
  thing that behaves differently on an old Windows) and `tauri-plugin-process`
  for the restart, `bundle.createUpdaterArtifacts`, and the two capabilities.
- **Nothing installs by itself.** The check is one request to a static file, at
  most once a day, four seconds after the window is up rather than in front of
  it, and silent on every failure — no connection, `tauri dev` where there is
  no bundle, an endpoint not there yet. None of those is the person's problem
  and none earns a red notice. The timestamp is written only on success, so a
  failed look is retried tomorrow rather than counting as today's.
- **And it will not interrupt work.** Installing closes the application and
  restarts it, which during a transcription is the orphaned process and the
  lost run this very session spent the afternoon fixing. The button is disabled
  while anything is running and says why.
- Where it shows: a row on the About card — `Máte poslední verzi.` with a
  `Zkontrolovat` for somebody who asks explicitly, or the offer and an
  `Aktualizovat`. The download reports itself in the shared `ProgressBubble`.
- **The privacy note is not optional.** The card promises nothing is sent out,
  and this is the one thing the application does on its own initiative. It says
  so, on the card, in a sentence: `Jednou denně se aplikace zeptá, jaká je
  poslední verze. Neposílá při tom nic o vás ani o nahrávkách.`
- Added: `scripts/release.mjs` (`npm run release`), which builds `latest.json`
  from what the bundler produced. Written by hand, every field in that file is
  a silent failure — a version that disagrees, a signature that is missing, a
  URL that points where the file is not. The script refuses on all three, and
  those refusals are its purpose rather than a formality.
- Fixed while in the file: the About card's heading still read `Whisp`.
- Files: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
  `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`,
  `src/updates.ts` (new), `src/App.tsx`, `src/Settings.tsx`, `src/styles.css`,
  `scripts/release.mjs` (new), `package.json`, `README.md`,
  `src/locales/{cs,en}/{app,settings}.ts`.
- Verified: `cargo fmt --all`; `cargo check --all-targets` with warnings as
  errors; `cargo test` (83 passed); `npx tsc --noEmit`; `node scripts/i18n.mjs
  check`. `release.mjs` was run against a fabricated bundle directory: it
  produced the expected `latest.json`, and then refused — with the right
  message each time — a `Cargo.toml` one patch version ahead and a missing
  `.sig`.
- **The next build will fail until the key exists**, and that is not avoidable:
  `createUpdaterArtifacts` needs `TAURI_SIGNING_PRIVATE_KEY` at build time, and
  `pubkey` is deliberately the placeholder `ZDE_PATRI_VEREJNY_KLIC` rather than
  a key that passed through this session. Generating it is one command and it
  is in README under `Vydání`. The private key must never reach the repository:
  without it no update can be published that already-installed copies would
  accept.

### 2026-08-06 — Correcting entry: the updater is withdrawn

- Reverted, on Jakub's word, everything in the entry above: the plugins, the
  config, `src/updates.ts`, `scripts/release.mjs`, the row on the About card
  and its strings. His reason, and it is the right one — a better way will turn
  up, and 0.9.0 does not need this to go out.
- The entry above stays where it is rather than being deleted. The reasoning in
  it is the part worth keeping: **why the releases repository has to be public**
  (a token inside an application handed to other people is not a secret, and it
  expires where nobody can replace it), what the check may and may not do
  (once a day, silent on failure, never in front of the window), and why
  installing must refuse while a run is going. Whoever picks this up next
  starts from there rather than from nothing.
- Kept from that work, because it was a defect of its own and nothing to do
  with updating: the About card's heading said `Whisp`, a name the application
  has not had since 2026-08-05. It says `Slobot`.
- Also true and worth stating plainly: the reason it had to be reverted rather
  than paused is that it **blocked the build**. `createUpdaterArtifacts` wants
  a signing key at build time, so the configuration cannot sit in the
  repository half-finished — it is either complete or it is out.
- Files: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`,
  `src-tauri/src/main.rs`, `src/App.tsx`, `src/Settings.tsx`,
  `src/styles.css`, `package.json`, `package-lock.json`, `README.md`,
  `src/locales/{cs,en}/{app,settings}.ts`, `src/locales/sources.json`;
  `src/updates.ts` and `scripts/release.mjs` removed.

### 2026-08-07 — A recording one worker holds is not offered to another

- What it was: `diarize_speakers` asked the registry *and* the row;
  `start_transcription` and `transcribe_in_language` asked only the row. Speaker
  recognition sets that row to `prepisuje` inside its worker, **after** the
  queue — so a recognition standing in line left the row on `hotova`, and
  `Přepsat` on the same recording went straight through. Two workers, one
  `recording_id`. The queue serialises them, but they aim at the same archive.
- Changed: one rule, `recording_is_busy(running, status)`, and all three
  commands ask it. Both sources are needed and the comment says why — the
  registry knows from the instant a run is started, including one still
  waiting; the row outlives the process, so it is what catches a run
  interrupted by a crash before `recover_interrupted` has had its say.
- Behaviour change worth stating out loud: `start_transcription` and
  `transcribe_in_language` used to answer `Ok(())` silently when the row
  already said `prepisuje`. They now return `transcription.still_running`,
  exactly as `diarize_speakers` already did. Silence is the wrong answer for
  the case this fixes: the caller cannot tell *already doing it* from *did
  nothing*, and the interface would light the screen up for a run that never
  started — which is the defect fixed on 2026-08-06 arriving through the other
  door.
- Changed with it, because the point above makes the return value matter:
  `runTranscription` answers whether a run actually started, and
  `askAboutSpeakers` passes that answer on instead of returning `true`
  unconditionally. Detail already refuses to set `prepisuje` on a `false`, so
  nothing else had to move.
- Files: `src-tauri/src/main.rs`, `src/App.tsx`.
- Verified: `cargo fmt --all --check`; `cargo check --all-targets` with
  `RUSTFLAGS=-D warnings`; `cargo test` — **86 passed** (83 plus three new over
  `recording_is_busy`); `npx tsc --noEmit`; `node scripts/i18n.mjs check`
  (886/886). The guard test was proven by making it fail: with the rule
  reverted to `status == "prepisuje"` alone,
  `a_queued_run_counts_as_busy_although_its_row_does_not_say_so` failed while
  the other two passed — which is what tells a guard from a description.
- Honest limits, two. The tests cover the *rule*, not the command:
  `start_transcription` needs Tauri `State`, so the wiring itself is verified
  by reading. And this ran on Linux, so the `#[cfg(windows)]` block
  (`allow_microphone`) was not compiled by any of it.
- The manual reproduction, for the next run on Windows: switch speaker
  recognition on, start transcribing A, press `Rozpoznat mluvčí` on B so it
  queues, then press `Přepsat` on B. It must say `Počkejte, až doběhne přepis.`
  rather than starting a second worker.

### 2026-08-07 — A setting is written from what landed, not from what was asked for

- What it was: the wizard already knew a cancelled download is not a finished
  one (2026-08-06) and offered the component again. But `download:complete`
  arrived unconditionally and `dokonci()` ran on it regardless, writing
  `changesApplied.model = MODELS[quality].settings` — **a model that was never
  downloaded**, from the moment Stop was pressed during the first one on a
  fresh installation. `load_settings` repairs that mismatch for `editor_model`
  and not for `model`.
- Second half, and it made a comment in the file untrue: the batch `break`s on
  a cancellation after reporting only the component it was interrupted on.
  Everything after it got no event at all — no phase, indistinguishable from
  still running — while the comment above `failedIds` said the opposite.
- Changed: cancelling reports `cancelled` for every component still in the
  batch, and `download:complete` carries the list of what did not land. The
  window cannot work that list out for itself, which is the whole reason it
  is sent rather than inferred.
- Changed: `dokonci(unfinished)` judges **each choice on its own component**.
  A language model that failed no longer throws away a transcription model
  that landed, and `diarization` is only switched on when all three of its
  components are there. `editingQuality === "off"` still writes the empty
  string — turning the feature off cannot fail to download.
- Preserve: `failedIds` stays as it is. It is the screen's own reading from
  the phases it saw, and it drives what step 5 shows. What a *setting* is
  written from must not depend on whether an event arrived, which is why that
  one now comes from the backend's list instead.
- Files: `src-tauri/src/download.rs`, `src/SetupWizard.tsx`.
- Verified: `cargo fmt --all --check`; `cargo test` — 86 passed;
  `npx tsc --noEmit`; `node scripts/i18n.mjs check`. The type checker caught
  the second caller of `dokonci` — the `Nothing to download` button on the
  last step, which passes an empty list because everything is already on disk.
- Honest limit: no automated test. `install_bundle` spawns a thread and needs
  an `AppHandle`, so both halves are verified by reading. The manual
  reproduction: start a fresh setup with the Precizní model, press Stop during
  the first download, then open Nastavení → Přepis. The model card must not
  claim a model that is not on the disk.

### 2026-08-07 — Everything this application starts dies with it

- What it was: `kill_all` on `ExitRequested` reaches the children a run
  registered in `JobRunner`, and that is the ordinary path. It reaches nothing
  else. Four spawners were never registered — `waveform_amplitude` and
  `equalizer_peaks` (`tools.rs`, both ffmpeg over the whole recording, both
  started from a detached thread), the `PlainRunner` conversion that prepares
  seekable playback, and the `ffprobe` duration probe. It cannot reach a
  grandchild at all. And it does not run when the process is killed rather
  than closed.
- Changed: `die_with_this_process()` in `main()`, before anything is started.
  It creates an unnamed Windows job object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and assigns this process to it. A
  process in a job puts its children in it too, so the limit fires on the whole
  tree when the last handle to the job goes — which is when this process ends,
  however it ends.
- The handle is deliberately never closed, and the comment says why rather than
  leaving it to look like a leak: `HANDLE` is a plain `Copy` value with no
  destructor, so letting it fall out of scope closes nothing, while calling
  `CloseHandle` would fire the limit at once and kill the application it is
  protecting.
- Preserve `kill_all`. The job is the class, `kill_all` is the case: it still
  stops a run's programs on a normal close, on a machine where the job could
  not be created, and it is what the existing test asserts on. Neither replaces
  the other.
- Silent on failure, all three steps. Nested jobs have been allowed since
  Windows 8, so sitting inside a debugger's job is not a reason to refuse to
  start; a machine where this cannot be done must still run the application.
  Each failure writes one line to stderr and carries on.
- Dependency: `windows = "0.61.3"` under `cfg(windows)`, four features. Same
  rule and same reason as `webview2-com` beside it — 0.61.3 is the version
  already in the tree, so this adds feature flags and no second copy of the
  Win32 bindings. `Cargo.lock` gains exactly one line, and `windows` still
  resolves to a single version.
- Files: `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`.
- Verified as far as a Linux session can: `cargo fmt --all --check`;
  `cargo check --all-targets` with `RUSTFLAGS=-D warnings`; `cargo test`
  (86 passed). `cfg` stripping happens after parsing, so the **syntax** of the
  new block is checked by all of that; its **types are not**, because
  `rustup target add x86_64-pc-windows-msvc` cannot reach
  `static.rust-lang.org` from here.
- Every name and signature was therefore read out of the vendored source of
  `windows 0.61.3` rather than remembered: `CreateJobObjectW` (behind
  `Win32_Security`, second argument `P1: Param<PCWSTR>`),
  `SetInformationJobObject`, `AssignProcessToJobObject`, `GetCurrentProcess`,
  `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` (derives `Default`, gated on
  `Win32_System_Threading`, which is why that feature is listed),
  `JobObjectExtendedLimitInformation`, and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
  typed as `JOB_OBJECT_LIMIT`, matching `BasicLimitInformation.LimitFlags`.
  `PCWSTR::null()` exists in `windows-strings` and reaches `windows::core`
  through `pub use windows_strings::*`; `PCWSTR: TypeKind<TypeKind = CopyType>`
  plus the reflexive `impl<T> CanInto<T> for T` is what satisfies the bound.
- **The first machine to compile this is yours.** Same shape of gap as the
  `webview2-com` entry from 2026-08-06, and it is worth saying twice rather
  than assuming it was read once.
- The manual reproduction, once it builds: start a transcription of a long MP3,
  wait for `Připravuji přesné přehrávání`, close the window from the title bar,
  and look in Správce úloh. No `ffmpeg.exe`, `whisper-cli.exe`, `sherpa-onnx*`
  or `llama-server.exe` may be left. Repeat with `Ukončit úlohu` instead of
  closing — that is the half `kill_all` never covered.

### 2026-08-07 — Every modal keeps the keyboard, and five smaller repairs

- Added `src/useDialog.ts`. Escape closes, Tab stays inside, and when the
  dialog goes the focus returns where it came from. All seven modals declare
  `aria-modal="true"`, which promises exactly that; three handled Escape, four
  did not, and `key === "Tab"` did not appear anywhere in `src/`. Tab therefore
  walked into the screen behind — the one the dialog says is not there.
- Applied to `ConfirmationDialog`, `NameDialog`, `SpeakerCountDialog` and the
  three modals in `Detail` (`missing`, `configure`, `preview`), which were the
  four Escape did nothing in. `AddRecordingDialog` takes the trap and keeps its
  own key: Escape there minimises a running take into the header's pill rather
  than throwing it away.
- Two things the browser taught rather than the code, both found by driving the
  real component and both wrong on the first attempt:
  1. **`document.activeElement` at effect time is already inside the dialog.**
     `autoFocus` runs while the DOM is committed, before a passive effect, so
     the "focus before" it reads is a control that is about to be removed.
     A module-level `focusin` listener remembers the last element focused
     outside a dialog instead — and it has to be installed on import, not when
     a dialog opens, because the click that opens the first one is the focus
     change that matters.
  2. **`!document.activeElement?.isConnected` is not how lost focus looks.**
     Closing drops it on `document.body`, which is connected, so the restore
     never ran. The condition is `!active || active === document.body`.
- Five repairs beside it:
  - A speaker's name is saved on blur, not on every keystroke. Writing
    `Pavel` was five IPC calls, five writes, and five times marking the
    improved document stale. Leaving the field unchanged now writes nothing,
    and the merge-by-name runs after the save, so it judges the stored name.
  - That field also has an accessible name at last
    (`detail.speakers.nameLabel`) — it had no `aria-label`, no `<label>`, no
    `placeholder` and no `title`.
  - A dictionary row with a side emptied goes back to what is stored. Doing
    nothing at all was worse than either saving or refusing: the screen showed
    one thing, the archive held another, and nobody was told. `dictionaryRef`
    is what the archive holds, as against `dictionary`, which follows the
    keystrokes.
  - Sorting by name uses `shownName()`, the same expression the card renders.
    Sorting the raw `title` while showing `title || fileName(path)` gathered
    every unnamed recording at one end under a name that is nowhere on screen.
    Both render sites now call the helper too, so the two cannot drift again.
  - `Uloženo` in the detail footer appears for a recording that has a
    transcript. It was a constant, lit even for a recording with nothing saved
    at all. There is no unsaved state to report — every edit is written as it
    is made — so it is a fact about a stored document, not a progress light.
- Files: `src/useDialog.ts` (new), `src/ConfirmationDialog.tsx`,
  `src/NameDialog.tsx`, `src/SpeakerCountDialog.tsx`,
  `src/AddRecordingDialog.tsx`, `src/Detail.tsx`, `src/Settings.tsx`,
  `src/Library.tsx`, `src/App.tsx`, `src/locales/{cs,en}/detail.ts`,
  `src/locales/sources.json`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (887/887, the new
  key approved with `i18n:approve`); `cargo test` (86 passed, untouched). The
  trap was driven in a real browser against the real `ConfirmationDialog`
  bundled with esbuild — not hand-written markup, which is the lesson from the
  duplicated empty state. Measured: focus opens on `Cancel`; six Tabs cycle
  Cancel → Jen složku → Smazat → Cancel and never reach the button behind the
  overlay; three Shift+Tabs walk back; Escape closes it; the focus returns to
  the control that opened it; no console error.
- Not done, and it needs a decision rather than a fix: the keyboard path to a
  **word** in the transcript. Giving every `<span>` a `tabIndex` would be ten
  thousand tab stops on an hour of audio, which is worse than today. Roving
  tabindex — the segment is one stop, arrows walk the words — is the shape that
  fits, and it changes how the transcript is operated.

### 2026-08-07 — A start that fails says so, and four commands stop holding the window

**A broken archive used to take the application with it, silently.** The failure
travelled out of `setup`, `build()` returned it, `.expect()` panicked — and with
`windows_subsystem = "windows"` there is no console for a panic to be printed
into. The window flashed and was gone, and the backups one folder away might as
well not have existed. `archive_path` is now separate from `connect_database`,
so the file can still be named when it cannot be opened, and
`report_unusable_archive` hides the window, shows a modal with the archive's
path and its backup folder, and ends the process when it is dismissed. The
dialog is opened from a thread of its own: `blocking_show` waits for a closure
the event loop has yet to run, so on the main thread — which `setup` is — it
would wait for ever. Hence `setup` returning `Ok`, and hence `try_state` in the
`RunEvent` handler, which would otherwise panic over a state that was never
managed. This is the one place where text a person reads is written in Rust,
and the comment says why: the dictionary lives in the window, which does not
exist yet, and the language they chose lives in the archive, which is the thing
that cannot be read.

**The download client can be interrupted, with one limit it still does not
have.** `timeout(None)` and nothing else meant a peer that vanished without
closing the connection left the reading thread blocked in `read` for as long as
the operating system allows — two hours on Windows — and `Zrušit` could not
reach it, because the flag is read between chunks and no further chunk was
coming. There is now a 15-second connect timeout, and TCP keepalive (30 s idle,
10 s apart, 6 tries) in place of a read timeout: reqwest's *blocking* client
exposes none — `read_timeout` is on the asynchronous one — and its `timeout` is
one deadline over the request and the reading of its body, so any value large
enough not to abandon a legitimate three-gigabyte download is not a limit at
all. The GitHub release listings do get a whole-request deadline of 30 seconds,
because a page of JSON has no reason to take one. Recorded rather than
pretended away: a peer that is alive and answers probes while sending nothing
still stalls, and fixing that means the asynchronous client and a new download
loop.

**Four commands no longer run on the window's thread.** In the whole of
`main.rs`, `#[tauri::command(async)]` appeared once. `create_portable_copy` is
the one that could not be anything else — it copies up to ten gigabytes and
reports its own progress, so the single command with a progress bar was the one
that could not draw it moving. `export_audio` converts an hour of audio,
`benchmark_compute` runs whisper once per installed backend, and `add_recording`
waits on ffprobe over a file that may be on a sleeping external disk. That last
one also held the archive's lock across the probe, so adding one recording
stopped every other command until it answered: `probe_duration` is now its own
step, taken before the lock, and `create_recording` receives the number. Its two
other callers were changed the same way.

**A waveform job gives its place back however it ends.** The removal from
`WAVEFORM_JOBS` was the last line of the worker closure, so a panic on the way
there left the id in the list for the lifetime of the process — after which that
recording's waveform was for ever "being computed" and no further attempt was
ever made. `WaveformJob` claims and releases through `Drop`, the same shape as
`INSTALLING` in `download.rs`, and it takes the id back out of a mutex poisoned
by an earlier panic as well.

**Deleting a folder takes one lock.** The contents were read under one lock and
deleted under another, so a recording moved into the folder in between survived
into the archive's root instead of going with it. The list is now read inside
the transaction that deletes it.

**The capability narrows.** `opener:default` grants `allow-open-url` beside the
reveal; nothing in this application opens a URL — `revealItemInDir` in Settings
is the only call — so the permission is now `opener:allow-reveal-item-in-dir`
alone.

**`eprintln!` in a released build goes nowhere**, and twenty-four of them are the
only record that something happened to somebody's archive: a backup that failed
before a schema upgrade, settings that could not be read and were copied aside,
transcriptions recovered after a crash, child processes that may have outlived
the window. `src-tauri/src/diagnostics.rs` and its `note!` macro write the same
line to stderr — `tauri dev` is unchanged — and to `slobot-log.txt` beside the
archive, capped at 512 kB. Deliberately not a logging library: there is no level
to filter on, no target to route by, and nothing here is written in a loop. What
was needed is a file somebody can be asked to send. The path is set as soon as
the archive's location is known, so the two lines from `main()` about the job
object still reach stderr only.

**Considered and left alone: the paths that arrive from the window.**
`export_audio`, `create_portable_copy` and `add_recording` take a path as it
comes, while `validate_watch_candidate` canonicalises and checks its parent. The
inconsistency is real and it is not a defect. Those three are answers to a system
file dialog — the picker is the person, so a rule invented here could only refuse
a folder they deliberately chose — and there is no attacker on the other side,
because the webview loads the bundled interface and nothing else; if there were,
it would call `delete_recording` long before it bothered writing an MP3
somewhere. A watched candidate is a different kind of thing: a list this program
produced earlier and handed out, acted on by starting a transcription, and the
settings say which directory it may come from. That is what makes checking
meaningful there and theatre here. The reasoning now sits above
`validate_watch_candidate` rather than in a change log nobody greps.

- Files: `src-tauri/src/main.rs`, `src-tauri/src/diagnostics.rs` (new),
  `src-tauri/src/download.rs`, `src-tauri/src/db.rs`,
  `src-tauri/src/transcription.rs`, `src-tauri/capabilities/default.json`.
- Verified: `cargo fmt --all -- --check`; `cargo check --all-targets` with
  warnings as errors; `cargo test` (88 passed — the 86 plus two over the waveform
  guard); `node scripts/i18n.mjs check`. Both new tests were made to fail first —
  with `Drop for WaveformJob` returning immediately, which is the old behaviour,
  exactly those two failed and the other 87 passed.
- Honest limits, and they all point the same way: none of this ran on Windows.
  The startup dialog is assembled from `tauri-plugin-dialog`'s own source —
  `show_message_dialog` posts through `run_on_main_thread` — not from watching it
  appear, and if the dialog cannot be shown at all the process now waits with a
  hidden window instead of crashing. The keepalive numbers are a choice, not a
  measurement. The four `async` commands are verified by compiling, not by
  clicking.

### 2026-08-07 — A white window is not an error message

Four things that could take the screen away, or spend a machine on nothing.

**A remembered panel state could take the window down.** `readOpenSections`
parsed `sidebar-sections` with no `try`, as a `useState` initialiser — so a
corrupt record, or a storage the engine refuses to read, threw during render
and left a white window with no way back. It is caught now and falls back to
every section open, which is what a fresh installation shows anyway.

**And nothing was there to catch it.** The project had no error boundary at
all, so any throw below the root unmounted the tree and left nothing — not
even something to report. `src/ErrorBoundary.tsx` is the one class component
here, because catching a render error is the only thing React has no hook for.
It sits inside `I18nProvider` and around the player, the recorder and the
application: the crash screen has to be able to say what happened, and those
three are what can throw. It shows the heading, the sentence that matters —
the archive is untouched, this is a drawing failure — the stack and the
component stack in a selectable block, and `Obnovit okno`. The message is not
printed twice: V8 opens `stack` with the line it was built from.

**The waveform redrew silence sixty times a second.** `AudioBackdrop`'s frame
loop depended on `[canvas]` alone, so an open transcript scheduled a callback,
measured the canvas and assembled a signature for as long as it was open. The
loop belongs to playback now, exactly as the sister loop driving the handle
and the ring already did; standing still, one frame is drawn and that is all.
The trap the signature was written for still holds — `readTime()` goes into it
whole, not quantised to the played pixel, or the picture would freeze during
playback. `stillTime = isPlaying ? 0 : time` keeps the eight ticks a second
React receives from restarting the loop it is not driving.

**The watch folder re-rendered the application twelve times a minute.** The
scan answers every five seconds with a fresh array, almost always holding the
same thing and usually nothing at all — and a new reference stored is a new
render of everything below. `sameCandidates` compares path and fingerprint;
an unchanged answer is dropped.

**Also:** `queued` was missing from `TranscriptionProgress.phase` while the
backend has been sending it since the serial queue was built, and from
`PHASE_ORDER`, where its absence let a late report throw the caption back to
the queue after the work had begun.

- Files: `src/Detail.tsx`, `src/ErrorBoundary.tsx`, `src/main.tsx`,
  `src/PlaybackControls.tsx`, `src/App.tsx`, `src/types.ts`,
  `src/locales/{cs,en}/app.ts`, `src/locales/sources.json`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (891/891, no
  problems). The two that cannot be judged by reading were driven in a browser
  against the real components bundled with esbuild, with
  `requestAnimationFrame` and the canvas context wrapped in counters rather
  than watched. The loop, over two seconds: 121 frames in silence before, 0
  after; 35 frames for a seek while paused before, 1 after; 240 frames and 32
  canvas calls while playing, unchanged, with the same 4,400 painted pixels on
  a 566 × 40 canvas — the picture is identical, only the work in silence is
  gone. The boundary, in both languages: the crash screen replaces the tree
  rather than emptying it, the block reports `user-select: text` over 16 lines,
  the button measures the shared 34 px pill, and pressing it fired a real
  `load` and brought the application back. Both palettes read their tokens.

**Left alone, and it is the larger one.** The player's context ticks eight
times a second and `App` consumes it, so the whole application — the archive
list included — re-renders with the clock while anything plays. `memo(Library)`
at the call site cannot pass: it receives about twenty inline closures, which
would have to be stabilised first, and that is a rebuild of `App.tsx` rather
than a cheap win. The transcript itself is already safe — `SegmentRow` is
memoised with a comparison where the time only matters to the segment currently
sounding. The fix belongs in `player.tsx`: `time` wants its own context, or a
subscription like `readTime`, so a consumer that only needs `recordingId` does
not repaint with the clock.

### 2026-08-07 — Colour that carries text, and the rules the file stopped obeying

- Fixed, all three measured in both palettes rather than taken on trust: white
  on the notice bar was 3.29 : 1 in the dark palette, white on every
  destructive button 3.69 / 3.50, and the `Uloženo` pill 2.36 : 1 in the light
  one. Three tokens now carry text where the brand value is tuned for the
  opposite job — `--akcent-plny` (4.77 both), `--vystraha-plna` (5.17 / 5.49)
  and `--uspech-text` (5.24 on a panel, 4.82 on the page). Same hue, same
  saturation, only the lightness moves, and the brand tokens above them do not,
  so nothing that merely borrows the colour follows.
- `--vystraha-plna` is 44 % and not 46 for one reason: at 46 the resting state
  passes at 4.79 but `filter: brightness(1.08)` takes the hover to 4.19. The
  hover is measured too.
- `--uspech-text` went to all five places that write grass on the grass/0.14
  tint, not only the pill the report named. It is one measured pair; fixing one
  of five and leaving the siblings failing would have been the worse half of a
  tidy-up. One token to revert if that is wrong.
- Not fixed, and worth knowing: the notice bar's own `Zavřít` chip is white on
  white/0.2 over the bar — 3.48 : 1, better than before because the bar
  darkened, still short. White on `--akcent` also survives on the archive
  calendar's month header on hover, at 9 px. The token exists for both.
- `.pruvodce h2` never drew anything. `.rucni h2` restated the type 1,580 lines
  later at the same specificity and won on file order alone, and the only `<h2>`
  in the wizard is inside `.rucni` — so the group label the type scale declares
  as 17/700 was always rendering as 13 px small caps. The scale is what settles
  it: `.rucni h2` keeps its margin, the type comes from one place, and both
  rules now say so.
- The scale itself: `550` ×3, `750` and `800` are gone. `.mic-stav.chyba` only
  reduced 600 to 550, which on the declared scale is the weight it overrode, so
  the declaration went and the colour stayed.
- Six circular button sizes, and only two of them documented. Three are load-
  bearing arithmetic recorded in this file — the 83 px compact pill is built on
  two 30 px buttons — so they are commented rather than resized.
  `.zkratky-skryt` is 20 px because the strip measures 35 px and a 32 px cross
  takes it to 47: measured both ways rather than argued.
- Seven radii outside the four tokens. Three had no reason and took one
  (`--r-karta` on the compact row, which stays 56 px tall; `--r-maly` on a focus
  ring; 3 px and 4 px were the same inline highlight twice). Four had a reason
  and got a comment naming it and the amount.
- Nine dead rule blocks removed, each re-verified by grep across `src/` in
  className position and whole-word — `odkaz` survives only inside Czech copy.
  A tenth, `.export`, is dead as well and was left because it was not on the
  list.
- `--pismo-cesty` was defined nowhere and lived on the fallback in two
  `var()`s, which could have drifted apart with nothing to notice. It is a token
  now.
- Two hard-coded black shadows aligned: the archive calendar takes `--stin`
  (`rgba(0,0,0,0.3)` in the dark palette where 8 % black was invisible), and the
  speaker preview's hover halo takes the foreground. The two knobs keep black on
  purpose — a white knob lifted off its own track is the one shadow that must
  not follow the palette — and now say so.
- Five media queries that cannot fire below the window's 1000 px minimum keep
  their place as nets, like the 900 px rule already does, each with the width
  and what it would do written above it.
- Reported, not changed: `--postup` is written to the slider on every frame by
  `PlaybackControls.tsx` and read by no rule. It is vestigial — the played part
  of the timeline has been painted by the waveform canvas since `playedRatio`,
  and a rule reading it now would paint that part twice. The write is what
  should go.
- File: `src/styles.css`.
- Verified: `npx tsc --noEmit`; braces balanced; and measured in a browser
  against the real stylesheet in both palettes — every contrast figure above is
  read off the rendered element and its composited backdrop, after the
  transitions settle, with the hover measured separately. Row heights (85 / 56),
  the tips strip (35 → 47) and the wizard heading (17 px / 700 / none) were
  measured, not looked at. No console errors.

### 2026-08-07 — The repository says what it stands on, and CI compiles the half it could not see

- **The hole this closes.** `#[cfg(windows)]` is stripped after parsing, so code
  behind it is parsed on Linux and never type-checked. The job object in
  `main.rs` and `set_webview2` in `tools.rs` are exactly that, and both landed
  with the two Ubuntu jobs reporting green — the first thing to read them was a
  build on somebody's desk. A `windows-latest` job now runs `cargo check
  --all-targets` (which type-checks the test binaries too) and `cargo test`. The
  tests earn their Windows minutes because the ones worth running are about
  process lifetime — killing a child, closing the window mid-run — which the
  operating system decides, not the code. `cargo fmt` stays on Ubuntu alone;
  formatting is platform-independent.
- **The installer is built on request, not on every push.** `npm run tauri
  build` links the release profile with LTO and then runs NSIS: twenty minutes
  at the Windows rate, for an answer `cargo check` has already given. The job is
  gated on a `v*` tag or a `workflow_dispatch` checkbox, needs the three
  checking jobs, and uploads the NSIS artifact. Tags were added to `on.push` so
  nothing is tagged that has not been checked. The artifact is unsigned and says
  so: the certificate lives on a hardware token and cannot be handed to a
  runner, so a release for anybody is still built by hand.
- **`SECURITY.md`, bilingual, Czech first** — the shape `LICENSE.txt` already
  has, and for the same reason: the users and the author are Czech, whoever
  finds a vulnerability may not be. It names `jsme@znackarna.cz`, and refuses to
  invent either a response window or a PGP key nobody holds.
- It also names, plainly, the two things that are true of this code. Downloaded
  programs are verified by **neither checksum nor signature** — the only check in
  `download.rs` is that `verification_path` exists once the archive is unpacked,
  so the whole integrity guarantee is HTTPS and the certificate chain; and six
  catalogue entries are found by **a regular expression over live GitHub
  releases**, so what is installed depends on what those projects publish at that
  moment. Then `csp: null` and `assetProtocol.scope: ["**"]`, with the scope's
  reason (a recording may sit on any drive) and its consequence (no second line
  of defence if foreign code ever reached the interface) stated separately
  rather than blurred. What holds today is the input side, and that was verified
  rather than assumed: the only three `dangerouslySetInnerHTML` in `src/` insert
  the same bundled `mark.svg`.
- **`NOTICE`**, built from the About card's own list and `package.json` — not
  from memory, which is how a licence gets invented. FFmpeg under GPL v3 and
  Gemma under Google's terms are lifted out of the list into their own section,
  with the distinction the list cannot carry: the installer contains neither, so
  handing somebody the installer triggers nothing, while a portable copy carries
  both and passing it on is distribution.
- The SIL OFL text travels with the fonts, as the licence requires — the fonts
  are the one third-party work bundled in the program itself rather than
  downloaded. It is byte-identical to the `LICENSE` in the font packages, and
  identical across all five, so it appears once with the five copyright lines
  above it. Source Serif 4's reads only `Google Inc.` in its package; it is
  copied as it stands rather than corrected on the author's behalf.
- **Fixed: `slozky-analyza.md` was versioned.** `*-analyza-*.md` demanded a
  hyphen on both sides of the word and matched only `slobot-analyza-0.9.0.md`.
  Both shapes are now one rule, and `*hodnoceni*.md` follows rather than waiting
  to be caught out by the next name. Note that ignoring it does not untrack it:
  `git rm --cached slozky-analyza.md` is still owed.
- Files: `.github/workflows/check.yml`, `SECURITY.md`, `NOTICE`, `.gitignore`.
- Verified: the workflow parses as YAML, four jobs, the installer job carries
  its `if` and its `needs`. `git check-ignore -v` against real names in both
  directions — the analysis names are caught, `README.md`, `ARCHITECTURE.md`,
  `CLAUDE.md`, `NOTICE`, `SECURITY.md` and `CHANGELOG.md` are not, and no
  tracked file is newly ignored. The OFL text `diff`s clean against the font
  package. Every licence in `NOTICE` was read out of a file — which is where
  `typescript` turned out to be Apache-2.0 rather than MIT.
- Not verified, and it needs a push: none of this has run on a runner.
- Not done, deliberately: no root `LICENSE`. Choosing one is the owner's legal
  decision. Worth knowing when it is taken — there is no GPL code in this
  repository at all, FFmpeg and Gemma are both fetched at runtime, so copyleft
  touches the portable copy and not the source tree.

### 2026-08-07 — Three loose ends, and a comment that explained the wrong thing

Four small things the audit left listed rather than done. None of them needed a
decision, and all four are verifiable without Windows — which is why they were
the ones taken while the `cfg(windows)` build waits on CI.

**The close chip was the worst-contrasting spot on the notice bar.** `.hlaska
button` painted `rgb(255 255 255 / 0.2)` under a white label. A white veil is
the obvious way to lift a control off a coloured bar, and it is the one thing
that cannot be done here: it lightens the very surface the label has to stand
on. So the chip read *worse* than the bare bar beside it — 3.48 : 1 against the
bar's own 4.76. The veil changed sign: `rgb(0 0 0 / 0.18)` takes the same
composite to 6.51 : 1 on the accent bar and 7.04 / 7.39 on the red one. The bar
colours are untouched, so nothing that merely borrows `--akcent-plny` or
`--vystraha-plna` moved with it, and no new token was needed.

- Correcting the report it came from: the finding said 3.48 : 1 *in both
  palettes*, which is true of the accent bar — `--akcent-plny` is deliberately
  one value for both. The red bar was a second failing case at 4.04 / 4.08,
  below 4.5 as well and not mentioned. Three failing composites, not one.

**`--postup` was written on every frame and read by nothing.** Both writes are
gone — `applyPosition` in `PlaybackControls.tsx` and the initial `style` on the
slider — and with them the `ratio` that existed only to feed the first and the
`CSSProperties` import that existed only to type the second. The played part of
the timeline has been painted by the waveform canvas since `playedRatio`; a rule
reading this property today would paint it a second time. Grepped rather than
assumed: `--postup` appears nowhere in `styles.css`, and `.prehrat-postup` and
`.mini-postup` are unrelated class names that merely share the word.

**`.export`** was the tenth dead block in `styles.css`, left behind when the
last sweep worked from a list it was not on. No `className` in `src/` names it.

**And the comment in `Cargo.toml` explained the wrong thing.** It said
`CreateJobObjectW` is behind `Win32_Security` and
`JOBOBJECT_EXTENDED_LIMIT_INFORMATION` behind `Win32_System_Threading`. Both are
behind `Win32_System_JobObjects`. The feature list itself is correct and always
was — it names `Win32_System_JobObjects` — so nothing was broken; the *reasons*
were attached to the wrong flags, which is the kind of comment that survives
precisely because it is never tested. Each of the four flags now says what it
carries: job objects the three calls and the struct, `Win32_Security` the
`SECURITY_ATTRIBUTES` in the signature that is passed as `None`,
`Win32_System_Threading` `GetCurrentProcess`, `Win32_Foundation` the `HANDLE`
they trade in. `PREDANI-LOKAL.md` repeats the same wrong claim and is not
versioned, so it is corrected only here.

- Files: `src/styles.css`, `src/PlaybackControls.tsx`, `src-tauri/Cargo.toml`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check` (891/891, no
  problems). Every contrast figure above was computed by a script that reads the
  token values and the chip's own `background` **out of `styles.css`** rather
  than from a transcription of them, composites the veil over the bar and
  reports the ratio. It was validated before it was believed: against the
  previous `rgb(255 255 255 / 0.2)` it returns 3.48 : 1 on the accent bar —
  exactly the figure the audit reported — and 4.76 / 5.17 / 5.48 for the three
  bare bars, matching the entry that introduced those tokens.
- Honest limit, and it is a step below the entry that set those tokens: those
  numbers came off **rendered pixels**, read from a real browser against the
  real stylesheet. These are computed from the stylesheet's declared values.
  The arithmetic is the same sRGB and WCAG formula and it reproduces the known
  figure, but a browser was not available in this session, so nothing here has
  been looked at. Worth one glance on the real machine that the darker chip
  still reads as a chip — the ratio guarantees it is legible, not that it is
  the right weight beside `--akcent-plny`.
- Not touched: `csp: null` and the player's tick re-rendering the archive, both
  still open in the audit. The first needs a running application and the second
  is a refactor, not a loose end.

### 2026-08-07 — The clock is its own context

- What it was: `time` sat in the player's `Status`, so the `useMemo` that builds
  the context value listed it among its dependencies and produced a new object
  eight times a second. Every consumer of `usePlayer()` therefore re-rendered
  with the clock — and `App` is one of them, which took the whole archive with
  it. Measured rather than argued: a consumer that reads nothing but
  `recordingId` rendered **17 times over 16 ticks**, i.e. once per tick, and
  `App.tsx` does not mention `time` anywhere.
- Changed: `PlayerTimeContext` holds the number and nothing else, nested inside
  the existing provider. `usePlayer()` returns `Status` without `time`;
  `usePlayerTime()` returns the clock and says in its own doc comment that it
  re-renders the caller on every tick, which is why it has to be asked for
  separately.
- Who follows the clock now: `MiniPlayer` (its ring), `AudioBars`, and `Detail`
  (word highlighting). Who stopped: `App`, `RecorderProvider`, and
  `PlaybackControls` — the last one never took `time` from the context at all,
  it receives it as a prop, so it was paying for a value it did not read.
- Why this works at all, and it is worth knowing before someone moves the
  provider: `<App />` is written as a child element in `main.tsx`, so
  `PlayerProvider` re-rendering does not re-render it. Only a changed context
  value does. Were `App` ever rendered *by* the provider instead of passed to
  it, the split would buy nothing.
- Fixed on the way, because the line had to change anyway: `Detail`'s cursor
  handover read `player.time` inside an effect cleanup whose dependencies are
  `[isCurrentRecording]`. `player` was a new object every tick, so the closure
  held the one from the render where this recording *took* the audio over — the
  cleanup restored the position playback started at, not the one it left off
  at, which is the opposite of what the comment above it promises. It reads a
  ref that follows the live clock instead, and the `eslint-disable` that hid
  the incomplete dependency list is gone with it.
- Files: `src/player.tsx`, `src/Detail.tsx`.
- Verified: `npx tsc --noEmit`; `node scripts/i18n.mjs check`; `npx vite build`.
  The counts above come from the **real `PlayerProvider`**, bundled with esbuild
  and mounted under jsdom with two probe children — one reading `usePlayer()`,
  one reading the clock — driven by sixteen `timeupdate` events on a faked audio
  element, since jsdom has no playback. After the change: status consumer 1
  render in total, clock consumer 17. The measurement was validated by making it
  report the defect: run against `HEAD:src/player.tsx` with the probe reading
  `usePlayer().time`, the status consumer reports 17, one per tick. The clock
  consumer reports 17 in both, so the tick itself is untouched.
- Honest limit: this counts renders, not milliseconds. It proves the archive no
  longer re-renders with the clock; it does not prove anybody could feel the
  difference. The audit's reason for wanting it — twenty inline closures make
  `memo(Library)` unreachable at the call site — is unchanged and is still the
  thing to fix if the archive ever feels slow for its own reasons.

### 2026-08-07 — The window has a content policy

- What it was: `csp: null`, and the promise on the About card — that nothing is
  sent out — was enforced by nothing but the absence of code that would break
  it. The audit left it open for one reason: a wrong policy is a white window,
  and nobody had run the application. That is no longer true.
- The policy is written from what the built bundle actually loads, not from a
  template. Read out of `dist/` rather than assumed: no `eval(` and no
  `new Function` anywhere in the bundle, so `script-src 'self'` costs nothing;
  every font is a same-origin `/assets/*.woff2`, so `font-src 'self'`; no `url()`
  in the CSS reaches outside; `index.html` links one script and one stylesheet,
  both same-origin.
- What had to be allowed, and why each one: `'unsafe-inline'` for styles,
  because React's `style={{…}}` is a style attribute and CSP governs those;
  `blob:` in `media-src`, because a finished microphone take is played from
  `URL.createObjectURL`; `asset:` and `http://asset.localhost`, because
  `convertFileSrc` is how a recording on any drive reaches the audio element;
  and `ipc:` with `http://ipc.localhost` in `connect-src`, which is how Tauri's
  own IPC travels on Windows — the one entry that is about the framework rather
  than about this application, and the likeliest single cause if the window
  ever does come up blank.
- `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'` are there
  because nothing in this application uses them, so they cost nothing and close
  three doors. `form-action` is deliberately *not* set: one dialog nests its
  heading in a `<form>`, and a directive that can block a submit is not worth
  the risk for a form that never navigates.
- Added to README: what to do if the window is blank — the console names the
  directive that refused, and `"csp": null` is the one-line test for whether the
  policy is even the cause. It says not to leave it there.
- **Left as it is, deliberately: `assetProtocol.scope: ["**"]`.** Narrowing it
  is not a config change. A recording may sit on any drive, so the only correct
  form is the runtime one — start with an empty scope and `allow_file` each
  recording as it is opened. That touches every path that plays audio, and it
  is Rust, which this session cannot compile. Recorded as the next step rather
  than half-done.
- Files: `src-tauri/tauri.conf.json`, `README.md`.
- Verified: the config still parses as JSON, and every directive was checked
  against what `npx vite build` actually emitted. `npx tsc --noEmit` and
  `node scripts/i18n.mjs check` still pass, though neither reads this file.
- **Not verified, and it is the whole risk:** no browser and no Windows in this
  session, so the policy has never been applied to a running window. It is one
  line in one file and reverting it is `"csp": null`. Try it once before
  anything else in this batch.

### 2026-08-07 — A word does not light up while nothing can be heard

- What Jakub saw: the last recording coloured its words before he said them,
  and he suspected the whistle he made at the start. He was right, and the
  archive says so — this was measured on his own take rather than reasoned
  about. Seven and a half seconds, `Včera jsem snědl milion tun kolibříků.`
  The file is **silent until 0.75 s**, the stored time of `Včera` is **0.52**,
  and from 1.0 to 1.9 s there is a narrow tone rising 785 → 2130 Hz at −4.7 dB,
  fifteen decibels louder than his voice. `jsem`, stored at 1.42, lands in the
  middle of it. By the end of the recording the error is down to 0.08 s.
- Two causes, and only one of them is ours. Speech detection took the whistle
  for speech and whisper spread the opening words across it — that is the
  second of lead at the start, and it needs alignment this application does not
  have. But **every** speech region also carries `--vad-speech-pad-ms 250`,
  a quarter second of padding so that VAD does not bite off a first syllable —
  and whisper places the region's first word at the beginning of the *padded*
  region. That quarter second is in every block of every recording.
- Changed: after the blocks are final, a block's start and the time of its
  first word move forward to the moment sound actually begins. Only the leading
  edge: the words inside were aligned by whisper's DTW against real audio and
  are not ours to second-guess; what is demonstrably wrong is the silence in
  front of the first one. A block whose first word already sits on speech does
  not move, and the first word can never pass the second — whisper sometimes
  gives two adjacent words one timestamp, and reordering them would be worse
  than the fault being fixed.
- Nothing new is downloaded or installed for it. The 16 kHz copy made for
  whisper is still on disk at that point, and where sound begins is a question
  energy can answer: an RMS envelope at 20 ms, and the first frame that rises
  above a fraction of the block's own peak. Relative and not absolute, so a
  quietly recorded interview is judged by its own speech rather than by a fixed
  number of decibels — there is a test for exactly that.
- The threshold was chosen by measurement, not taste: on the reference take
  every value between −26 and −40 dB below the block's peak returns the same
  answer (0.24 to 0.26 s), so the rule does not balance on the number. −32 dB
  sits in the middle of that plateau.
- Worth recording as an independent check on the diagnosis: the correction the
  rule finds for the first block is **0.24 s**, and it knows nothing about the
  250 ms of VAD padding that causes it.
- **Considered and rejected: importing a solution.** Jakub asked whether
  somebody has already done this well. They have — forced alignment against a
  phoneme model, which is what WhisperX (wav2vec2), stable-ts and the Montreal
  Forced Aligner do, and a whistle has no phonemes for words to slide onto. All
  three are Python and PyTorch, which this application has deliberately never
  needed. sherpa-onnx, which is already downloaded here for diarization, does
  **not** have forced alignment: it is an open feature request (#3536, April
  2026, no assignee, no branch) that closed two earlier requests for the same
  thing. CrispASR fits the shape exactly — MIT, one C++ binary, no Python,
  Windows and Vulkan — but Czech is not named anywhere in its documentation,
  there is no documented way to feed it an existing transcript, there are no
  prebuilt binaries, and it publishes no alignment accuracy figures at all. If
  this is ever revisited, that is the shortlist and those are the questions.
- Files: `src-tauri/src/transcription.rs`.
- Verified: the algorithm was written in Python first and run against **the
  real recording and its real stored word times**, which is what produced the
  0.24 and 0.07 above; the Rust is a transliteration of that. Five unit tests
  built from the same numbers: silence is skipped, the reported case moves to
  0.76 and carries its first word, a block starting on speech is untouched, the
  first word never passes the second, and a recording a hundred times quieter
  is measured against itself.
- **Honest limit, and it is the same one as the two entries above:** no `cargo`
  in this session, so none of this Rust has been compiled, the tests have never
  been run, and none of them has been seen to fail against the old behaviour.
  CI compiles and runs them on both platforms. Treat the first green run as the
  first reading of this code.

### 2026-08-07 — Correcting entry: the onset tests asked for a precision the frame cannot give

- The first CI run over the entry above came back red, and it is worth
  recording what was and was not wrong. **The code compiled**, on Linux and on
  Windows, and 90 of 93 tests passed. The three that failed were the three new
  ones, all with the same complaint: `expected the onset at about 0.76 s, got
  0.74`.
- Cause, and it is in the test rather than in the rule: the envelope is built
  in 20 ms frames, so the frame that *contains* the first sound begins up to
  one frame before the sound itself. On the synthetic signal — silence for
  exactly 0.75 s, then a tone — the first frame carrying any of that tone
  starts at 0.74, and 0.74 is the correct answer. The 0.76 came from the real
  recording, where the boundary happens to fall elsewhere in a frame, and it
  had no business being asserted against a different signal.
- The tolerance did not save it either: `(0.74 - 0.76).abs()` is
  0.020000000000000018, which is not `<= 0.02`. A margin written as exactly the
  error it is meant to absorb is not a margin.
- Fixed: all three assert that the onset lands within one frame of the true
  0.75 boundary, through a shared `TOLERANCE` equal to `FRAME_SECONDS`. That is
  what the rule can guarantee, and saying so is more useful than a number that
  fell out of one particular file.
- Worth keeping, because it is the opposite of the usual lesson in this file:
  the guard did its job. It caught a wrong expectation on its first run, on
  both platforms, in three minutes — and the two tests that describe behaviour
  rather than a number (`a_block_that_begins_on_speech_is_left_alone`,
  `the_first_word_never_moves_past_the_second`) passed. The assertions that
  broke were the ones tied to a measurement instead of to a property.
- Files: `src-tauri/src/transcription.rs`.
- Verified: by CI, which is the only thing in this session that can compile
  Rust at all.

### 2026-08-07 — The watched folder's switch is called Automatický přepis

- Changed: `settings.files.watchAuto` reads `Automatický přepis` instead of
  `Přepisovat rovnou`. English follows with `Automatic transcription` instead
  of `Transcribe right away`.
- Why it is the better name, beyond being Jakub's: the Archive's drop zone has
  had a switch called `Automatický přepis` since it was moved there, and it
  decides the same thing — whether a recording that has just arrived starts
  transcribing on its own. One decision under two names made them look like two
  features. The two switches are still separate settings, deliberately: one is
  about files you add by hand, the other about files that appear in the watched
  folder while nobody is looking.
- `i18n:check` now reports one more text under several keys, 77 rather than 76.
  That is the point of the change and not a defect, exactly as it was when the
  three quality tiers were unified.
- Files: `src/locales/cs/settings.ts`, `src/locales/en/settings.ts`,
  `src/locales/sources.json`.
- Verified: `node scripts/i18n.mjs check` reports 891/891 and no problems; the
  new English was approved with `i18n:approve` so the fingerprint matches the
  Czech it was written from.

### 2026-08-07 — The portable-copy hint drops the minute

- Changed: `settings.portable.copyHint` is `Z flash disku se modely načítají
  pomaleji.` instead of `Z flash disku se model načítá pomaleji, často asi o
  minutu.` English follows with `Models load more slowly from a flash drive.`
- Two things went, and both deserved to. The plural is the truth — a portable
  copy carries every model it was given, not one. And `často asi o minutu` was
  a number the application cannot stand behind: it depends on the drive, the
  port and which model, and a figure that specific invites somebody to time it
  and find it wrong. The sentence still says the thing that matters, which is
  that this trade exists at all.
- Files: `src/locales/cs/settings.ts`, `src/locales/en/settings.ts`,
  `src/locales/sources.json`.
- Verified: `node scripts/i18n.mjs check` reports 891/891 and no problems; the
  English was approved with `i18n:approve`.

### 2026-08-07 — The backup sentence drops a word it did not need

- Changed: `settings.backups.description` says `Při každém spuštění vznikne
  jeho kopie` instead of `Při každém spuštění aplikace se vytvoří jeho kopie`.
  What starts is obvious from the screen it is written on, and `vznikne` says
  in one word what `se vytvoří` said in two.
- English is unchanged: `every time the app starts` is idiomatic, and dropping
  the noun there would leave `it` pointing at the archive rather than at the
  application.
- Worth recording because it is the guard working as designed: changing the
  Czech alone made `i18n:check` fail with `en: 1 překladů proti změněnému
  zdroji` — the fingerprint said this English was written from a sentence that
  no longer exists. It was approved rather than rewritten, which is exactly the
  case `i18n:approve` was added for.
- Files: `src/locales/cs/settings.ts`, `src/locales/sources.json`.
- Verified: the check was watched failing before the approval and passing after
  it; 891/891 and no problems.

### 2026-08-07 — A narrow sidebar no longer puts the heading under its own action

- What Jakub saw: narrowing the window narrows the sidebar, and `Rozpoznat
  mluvčí` came to lie across the word `Mluvčí`.
- Cause: the header is `heading … action`, and the heading is a flex item that
  shrinks. The toggle *inside* it is not a flex item — it is an ordinary button
  with content width — so when the heading shrank, the button kept its size,
  spilled out of it and overlapped the action beside it.
- Fixed: `max-width: 100%` on the toggle. It is one line, and the interesting
  part is what it switches on: `.sidebar-section-toggle` already had
  `min-width: 0` and `.sidebar-section-title` already had the ellipsis rules.
  Both were written for this exact case and neither could ever take effect,
  because nothing bounded the button. The behaviour was designed; only the
  ceiling was missing.
- The negative `margin-left: -5px` does not undo it: margin sits outside the
  content box `max-width` limits, so the button ends five pixels short of the
  heading's right edge rather than past it.
- Preserve the content width. The comment above the rule explains why the
  toggle is not full width — a heading that claimed the space between itself
  and the action would ellipsize its own label while the row still looked half
  empty. A ceiling is not the same as claiming the space.
- Files: `src/styles.css`.
- Verified: by reading, and that is the honest limit — there is no browser in
  this session, so the narrow state has not been rendered. Worth one glance at
  a narrowed window; if the heading now truncates too eagerly, the next step is
  to let the action's label give way first, since every section heading here is
  a single short word.

### 2026-08-07 — Measured and shelved: speakers without a neural model

Nothing changed in the application. This is here so the experiment is not run
a second time, and because the numbers say something about the feature as it
stands.

- The question, Jakub's: could speakers be told apart by a series of cheap
  tricks instead of a model, so that it stops costing minutes on a machine
  whose GPU the model cannot use?
- What was tried, on his own material — a 25-minute press interview with the
  cast of *The Odyssey*, five speakers in one room. Per two-second window:
  median fundamental frequency by autocorrelation, twelve mel-cepstral means,
  and median loudness. Pure DSP, no model, faster than real time by orders of
  magnitude. Jakub labelled ten windows by ear, which is what made a real
  score possible.
- **The result, and it is a clear no.** Two windows of the *same* person sat
  7.69 apart on average; two windows of *different* people, 8.29. Those
  distributions all but coincide — Tom Holland's two samples are further apart
  than his are from Anne Hathaway's. Assigning each labelled window from the
  others scored **4 of 8**, against five classes.
- **The control is what makes that trustworthy.** The same code, given Jakub's
  own voice against a voice from the interview — different person, different
  language, different recording — split them **97.5 %** correctly. So the
  pipeline works; this material defeats it. Which is explicable: five people,
  one room, the same microphones, and a produced video whose compression and
  levelling flatten exactly the three cues the method leans on. Four of the
  five are men.
- A methodological correction worth keeping: silhouette was the wrong metre.
  The trivially separable control scored 0.236 and the interview 0.17, so the
  number that looked like "no structure at all" was in fact close to what
  "easy and correct" looks like with these features. It cannot decide this
  question; only labels can. An early conclusion drawn from it was withdrawn.
- Also learned, from choosing the ten samples by maximum mutual distance: the
  ten most distinct-sounding windows turned out to be five people, three of
  them repeatedly. One person's voice varies about as much as people differ —
  which is the same finding as the numbers above, arrived at by accident.
- **What survives.** Jakub's own proposal — the reader names a few voices and
  the rest is assigned by similarity — is right, and is unaffected: it needs
  the model's embeddings rather than cheap features, and it replaces the part
  that actually fails, which is guessing how many people there are. Recorded
  because today naming a speaker teaches the application nothing: it renames a
  cluster and merges two that share a name, so it can join what was wrongly
  split but never split what was wrongly joined. That is the defect Jakub
  reported, and it is by design.
- **Where the feature honestly stands**, from this and the earlier
  measurements: good on two speakers when told the count (99.8 / 0.2 on his own
  recording), poor on a panel, and structurally CPU-bound — ONNX Runtime has no
  Vulkan provider, so the AMD card cannot be used; DirectML would work but
  means owning a build of ONNX Runtime and sherpa-onnx; and no speaker
  embedding model exists in ggml, which is where Vulkan would come from free.
- Left as it is by decision, in the hope of a better idea. Nothing here argues
  for removing it.

**Two candidates checked the same day, so they are not checked again.**

- **FunASR** (modelscope). Its diarization *is* CAM++ — the same 7.2M embedder
  sherpa already loads — so there is no accuracy headroom in it by
  construction. And it lives only in the PyTorch pipeline: the Python-free GGUF
  runtime ships three ASR binaries and a VAD, no speaker model at all, and its
  Windows Vulkan package accelerates SenseVoiceSmall alone. Chinese-first
  throughout; no Czech in any GGUF-available model. Code MIT, weights under a
  separate FunASR licence.
- **vibevoice.cpp** (localai-org). The more interesting no. It does ASR,
  diarization and timestamps *jointly*, one ggml model, no CAM++, no clustering
  stage — architecturally the thing this problem wants. It fails on speed by an
  order of magnitude: their own benchmark is RTF 2.195 on CPU on a Ryzen
  9950X3D, against roughly 0.16 for the sherpa path being replaced. Vulkan is
  claimed in one line of prose and never built, benchmarked or documented.
  Fourteen commits, one author, no releases, no Windows build, Czech unstated.
  Revisit only if it ships a Vulkan Windows binary and publishes Czech numbers.
- Worth stealing from FunASR, and it is not code: they publish a
  `windows-x64-vulkan.zip` that deliberately relies on the driver's own
  `vulkan-1.dll` instead of carrying an SDK. That is proof the packaging this
  application would need works, for the day a ggml speaker model exists.

### 2026-08-07 — Correcting entry: the GPU is reachable after all, and not through Vulkan

Jakub kept sending candidates and asking whether nobody had solved this. The
sweep that followed found one fact that overturns the paragraph above, and it
is not about any of the projects.

- **`ort`, the Rust binding for ONNX Runtime, downloads a DirectML build on
  Windows by default.** There is no plain `x86_64-pc-windows-msvc` distribution
  in `ort-sys`' own `dist.tsv` — the default Windows dist *is* the DirectML
  one, `download-binaries` is a default feature, and the archive is hash
  verified. So GPU inference on an AMD Radeon needs no C++ toolchain, no
  `ORT_LIB_LOCATION`, and no build of ONNX Runtime. It needs a Rust dependency.
- What stands from the earlier entries: ONNX Runtime still has **no Vulkan**
  execution provider, and that was checked again. The mistake was concluding
  from "no Vulkan" that the card was unreachable. DirectML is the route, and it
  is vendor-neutral by design.
- Corrected too: the claim that no ggml speaker model exists.
  `localai-org/voice-detect.cpp` is one — GGUF, flat C ABI, Vulkan through
  ggml's own flags, and it returns L2-normalised embeddings. It is also **one
  commit, no releases, prebuilt binaries a TODO**, and it does recognition
  only: no segmentation, no clustering. Not adoptable; the sentence it corrects
  was still wrong.

**What the candidates actually offer**, each solving one half:

- `parakeet-rs` (302★, MIT/Apache, active) is the only project swept that
  *registers* a GPU provider rather than merely offering a feature flag —
  verified in `src/execution.rs`, `ort::ep::DirectML` with CPU fallback. Its
  diarizer is NVIDIA Sortformer, end to end. The cost is exact: **no
  embeddings at all**, four speakers maximum, English training corpora. It
  buys speed and forecloses the naming feature.
- `speakrs` (Apache-2.0, 7.1 % DER, exposes embeddings, PLDA + VBx clustering)
  is the accuracy answer and would fix the dominant-speaker collapse this file
  measured on `paul_radomil`. Its only providers are CUDA, CoreML and
  MIGraphX — and MIGraphX is a ROCm artefact that does not exist for Windows.
  So on this machine it is CPU.
- `diaric` is clustering alone, no inference: AHC then VBx, consuming
  embeddings from wherever. Surgical, and it replaces exactly the stage that
  fails.
- Rejected on inspection: `polyvoice` (serious work, but forwards only
  CoreML/NNAPI/XNNPACK, so CPU here), `rust-whisper-diarization` (3 commits,
  no licence file, wraps sherpa-onnx — the baseline itself), `audio.cpp` (right
  shape, no releases), `adk-audio` (diarization in someone else's cloud).
  `whisper.cpp` has gained nothing: `--tdrz` is still turn detection, `small.en`.

**The shape that satisfies both constraints is assembly, not a dependency.**
Because `ort` on Windows *is* the DirectML build, running the CAM++ model this
project already downloaded — through `ort`, in Slobot's own process, instead of
spawning `sherpa-onnx.exe` — would give GPU embeddings **and** the raw vectors
per segment, with `diaric` or polyvoice's `vbx` doing the clustering. That is
the only route that gets the speed and keeps the "name two voices, assign the
rest" feature, and it also removes a downloaded executable and a stdout parser.
Nobody packages it because it is three existing pieces in a new order.

- Not started. Recorded so the next attempt begins from the fact in the first
  bullet rather than from the Vulkan dead end.
- **The one measurement to make first**, before any of it: whether `ort` with
  DirectML actually gets that Radeon under load. If it does not, none of this
  changes the 95 seconds.

### 2026-08-07 — A measuring stick for the DirectML question

- Added `probe/ort-dml/`, a standalone crate that is **deliberately not part of
  the application**: it loads the CAM++ model the installer already downloads,
  feeds it synthetic input of whatever shape the model declares, and times N
  runs on DirectML and on the processor. Two commands, one number each.
- It is separate on purpose. `ort` in the application's own dependencies would
  pull the whole of ONNX Runtime into every build, and that is too much to pay
  for answering one question. If the answer is yes, this folder becomes the
  start of the real integration; if no, it is deleted.
- Pinned with `=` rather than a caret. `ort` is in release candidates and the
  API genuinely breaks between them — between rc.9 and rc.13 almost everything
  this probe touches was renamed (`ort::execution_providers` → `ort::ep`,
  `commit()` stopped returning a `Result`, `session.inputs` became a method,
  `ValueType::Tensor`'s `dimensions` became `shape`). Anything written from
  memory or from a blog post is rc.9-era and will not compile.
- Two things in it are requirements rather than tuning, and both are commented
  at the line: `with_memory_pattern(false)` is mandatory when DirectML is
  registered — Microsoft's documentation says session creation *errors* without
  it — and the warm-up run is excluded from the average because on DirectML it
  carries driver start-up and graph compilation and is much the longest.
- Why the timings are the answer and the log is not: a provider that fails to
  register falls through to the next one **silently**, with only a `tracing`
  error nobody is subscribed to, and even a successfully registered provider
  may still have ONNX Runtime place the nodes on the CPU. `is_available()`
  reports whether the build contains DirectML, not whether this machine can use
  it. Wall-clock is the only honest signal.
- Expect the dynamic frame count to be the biggest single factor if the numbers
  disappoint: DirectML's own documentation says it performs best when shapes
  are known at session creation, and CAM++ declares a variable number of
  frames. `with_dimension_override` is the lever, and the probe prints the
  symbol names needed to use it.
- Files: `probe/ort-dml/Cargo.toml`, `probe/ort-dml/src/main.rs`, `.gitignore`.
- Verified: every signature, feature name and default was read out of the
  `ort 2.0.0-rc.13` and `ort-sys 2.0.0-rc.13` sources on crates.io rather than
  from documentation prose. **Not compiled** — no cargo in that session, and the
  probe is outside the workspace so CI does not build it either. The first
  machine to compile this is the one that runs it.

### 2026-08-07 — What DirectML is worth, measured on the real machine

The probe compiled first time and ran on Jakub's Radeon. Numbers, median of 20
runs after a discarded warm-up, so that anyone can stop guessing.

**CAM++, the speaker embedding — the graphics card wins, but only in bulk.**

| batch | DirectML | processor | per segment on DML |
|---|---|---|---|
| 1 | 5.57 ms | 8.26 ms | 5.571 ms |
| 4 | 69.36 ms | 21.42 ms | 17.339 ms |
| 16 | 70.31 ms | 68.87 ms | 4.394 ms |
| 64 | 86.46 ms | 312.31 ms | 1.351 ms |
| 256 | 155.45 ms | 1390.43 ms | **0.607 ms** |

One segment at a time is 1.5×, which is nothing; 256 at a time is **8.9×**, and
the per-segment curve is still falling. The card was idle, not slow. Note the
constant ~65 ms that appears from batch 4 upward and does not grow with the
work — fixed overhead, and a hint that `with_dimension_override` would help,
since both of this model's dimensions are dynamic.

**pyannote, the segmentation — the graphics card is useless here.**

| batch | DirectML | processor |
|---|---|---|
| 1 | 22.08 ms | 12.21 ms |
| 4 | 1759.83 ms | 34.98 ms |
| 16 | 1762.01 ms | 94.30 ms |
| 64 | 1755.93 ms | 361.44 ms |
| 256 | 1783.17 ms | 1351.33 ms |

**Pinned at 1.76 s from batch 4 to batch 256** — sixty times the work in the
same time. That is not computation, it is a fixed cost paid every run, and the
processor is faster in every single row. The likely cause is that pyannote
carries a recurrent layer DirectML cannot place, so ONNX Runtime splits the
graph and copies tensors between device and host on every run. Not diagnosed
further, because the conclusion does not change: this model stays on the CPU.

- **And a number that does not add up, which matters more than either table.**
  Ten minutes of audio is on the order of 150 segments; at the measured CPU
  cost that is about a second of embedding, and the segmentation windows come
  to a few seconds more. The whole diarization takes 95 seconds. **So neither
  model's inference is where the time goes** — it is in feature extraction, in
  clustering, or in sherpa computing far more windows than assumed. Accelerating
  the models was the wrong thing to measure, and that is the finding.
- Files: `probe/ort-dml/src/main.rs` (gained `--sweep` and `--batch`).

### 2026-08-07 — Correcting entry: the embedding test was measured on the worst possible sample

- With the model reachable from Python in the session, the real CAM++ was run
  over Jakub's interview against his ten hand-labelled windows, to see whether
  "name a few voices, assign the rest" works with proper embeddings where cheap
  DSP scored 4 of 8. It scored **2 of 8**, and same-speaker cosine averaged
  0.159 where a working speaker embedding gives 0.7 or better.
- That reads as a catastrophic result and it is not one. The control says so:
  Jakub's own voice against itself is **+0.445**, and against a voice from the
  interview **−0.086**. Positive against negative — the model separates people
  cleanly. Nothing is broken.
- **The sample was the defect, and it was mine.** Those ten windows were chosen
  by *maximum mutual distance* in the cheap-DSP feature space — that is, the ten
  least typical moments in the recording: laughter, overlap, and places where a
  speaker changes mid-window. Two adjacent three-second windows at 2:02 score
  0.129 against each other, which is a speaker change, not a bad embedding. The
  model was scored on the hardest material in the file and the number reported
  as its accuracy.
- Second defect, smaller: the fbank here is hand-written and only approximates
  Kaldi's. Same-speaker similarity around 0.44 rather than 0.7 is the tell. A
  faithful implementation is `knf-rs`/`kaldi-native-fbank`, which is what sherpa
  itself uses.
- **So the question is still open.** A fair test picks windows from long
  continuous single-speaker stretches — medoids rather than outliers — and
  discards any window whose two halves disagree with each other, because that
  window contains a handover. Recorded so the next attempt does not repeat the
  selection error rather than the measurement.
- Lesson, and it is the third time today in a different costume: a measurement
  is only as good as its sample. Choosing the most extreme examples felt like
  choosing the most informative ones, and it was the opposite.

### 2026-08-07 — Speakers without pyannote: measured, and it works

Jakub's question, and it is the one that unlocked this: if CAM++ is the fast
model, do we need the slow one at all — is its output not enough to mark where
the same people speak? It is.

**Why pyannote is redundant here.** Its job is to find where speech is and
where speakers change. This application already knows where speech is, twice
over: Whisper returns a timestamp for every word, and Silero VAD is already
downloaded and run as part of transcription. So the expensive model is being
paid to compute something already on hand. And the 95 seconds stop mattering:
whatever sherpa spends them on, deleting the stage deletes the spending.

**The pipeline that replaces it**, all of it either free or measured today:
speech regions from the transcript → fbank → CAM++ in batches on DirectML
(0.607 ms per segment) → group by cosine similarity.

**Measured on the 25-minute five-speaker press interview**, cut into 2-second
windows at a 1-second hop inside continuous speech regions — 723 windows, 14.7
minutes of speech, no pyannote anywhere:

| check | result | |
|---|---|---|
| the two halves of one window against each other | **+0.408** | against +0.129 for a stranger's half |
| similarity to own cluster centre | **+0.613** | |
| adjacent windows changing speaker | **18 %** | chance would be ~80 % |

The last is the strongest: 82 % of the time consecutive windows stay with the
same person, so the assignment produces continuous turns rather than the
alternation this file once described as "like socks".

**Then a blind test, and this is the result that decides it.** Two medoids —
the most *typical* windows, not the most extreme — were taken from each of five
clusters, shuffled so the order gave nothing away, and Jakub named them by ear
without knowing which belonged together:

| cluster | samples | named | |
|---|---|---|---|
| 4 | 1, 10 | Matt Damon, Matt Damon | correct |
| 0 | 3, 5 | Anne Hathaway, Anne Hathaway | correct |
| 1 | 4, 9 | Tom Holland, Tom Holland | correct |
| 2 | 6, 8 | Nolan, Nolan | correct |
| 3 | 2, 7 | "music then Nolan" / "Damon then Zendaya" | — |

**Four clusters of five are exactly one person each, and no two clusters are
the same person.** The fifth is the interesting one: both of its medoids are
windows Jakub described as containing *two* things — music followed by a voice,
and one speaker followed by another. The clustering put the contaminated
windows together rather than scattering them among the people. That is the
behaviour an interface wants: a place to say "not sure" instead of guessing.
- Worth noting against the earlier failure: `k` was forced to five, and the
  recording clearly holds more than five voices — Jakub named Zendaya and Nolan
  here, neither of whom appeared in his first labelling. Even under-counted, no
  clean cluster mixed two people.
- The fbank used is the hand-written approximation, still not Kaldi-faithful.
  These numbers are therefore a floor, not a ceiling; `knf-rs` should raise
  same-speaker similarity from ~0.4 towards the ~0.7 a correct one gives.
- Not built. What this justifies building is recorded here rather than started:
  in-process `ort` with the CAM++ already downloaded, windows from the
  transcript's own word timings, and the user naming a few voices instead of
  the application guessing how many there are.

### 2026-08-07 — The numbers that settle the design

Everything below was measured against the real CAM++ and Jakub's own interview,
so the Rust that follows has parameters rather than guesses.

**The feature extractor was already right.** Nine variants were tried against
the hand-written fbank — no CMN, no pre-emphasis, no DC removal, input scale
1.0, Hann and Hamming windows, 7600 Hz ceiling, Slaney's mel formula, a 400-point
FFT. **Not one beat the baseline** (same speaker 0.386, different 0.080, gap
0.306). So the earlier "my fbank is approximate" worry was misplaced, and the
0.7 similarity expected for the same speaker was simply the wrong expectation
for a two-second window.

- **Cepstral mean normalisation is the one thing that matters.** Without it the
  same speaker scores 0.506 — higher — but different speakers score 0.401, and
  the gap collapses from 0.306 to 0.105. It is what removes the microphone and
  the room. Do not drop it as an optimisation.
- Input scale is irrelevant *because* of CMN: multiplying the waveform shifts
  every log-mel by a constant, which the mean subtraction then removes. 32768
  and 1.0 differ by 0.002.

**Window length: 1.5 to 3 seconds.** Accuracy of a single same/different
decision at the best threshold:

| window | same | different | gap | accuracy |
|---|---|---|---|---|
| 1.0 s | 0.272 | 0.050 | 0.222 | 80 % |
| 1.5 s | 0.363 | 0.039 | 0.324 | 86 % |
| 2.0 s | 0.359 | 0.060 | 0.299 | 86 % |
| 3.0 s | 0.483 | 0.122 | 0.361 | 86 % |
| 8.0 s | 0.559 | 0.143 | 0.417 | 83 % |
| 12.0 s | 0.526 | 0.213 | 0.313 | 79 % |

Longer windows raise both similarities and stop helping; past eight seconds
they start hurting, presumably because a long window collects more than one
speaker. Two seconds is the default to write down, and it happens to be the
size of a transcript block.

**And the feature itself, measured — naming a few voices and assigning the
rest:**

| examples named per person | assigned correctly |
|---|---|
| 1 | 88 % |
| 2 | **95 %** |
| 3 | 93 % |
| **5** | **100 %** |
| 8 | 98 % |

Five examples per person and it is perfect on this recording; two are enough
for 95 %. Against a blind clustering that found seven speakers in a
conversation between two, that is the whole argument for the change.

- **The caveat, stated because it is real:** the same/different pairs were
  drawn from the four clusters Jakub confirmed, so a wrong window inside one of
  them would flatter these numbers. Independent support comes from the
  split-half control (+0.408 against +0.129, no labels involved) and from the
  blind naming test, where he identified the medoids without knowing the
  groupings. It is not circular, but it is not a held-out set either.
- Not measured, and worth knowing before this ships: Czech. Every number here
  is from one English interview. CAM++ is trained on Chinese and English and
  speaker identity is largely language-independent, but that is an argument,
  not a measurement.

### 2026-08-07 — First half of speaker recognition without sherpa: the features

- Added `src-tauri/src/voiceprint.rs`: mono 16 kHz samples in, log-mel energies
  out, in the shape CAM++ declares (`x` is `[batch, frames, 80]`). It is the
  first piece of replacing the spawned `sherpa-onnx.exe` with inference inside
  the application.
- Deliberately dependency-free. A mel filterbank and a 512-point transform are
  about a hundred lines; `knf-rs`, the faithful Kaldi extractor, would drag
  CMake and Clang into the Windows build and CI for the same result. That trade
  is worth revisiting only if the measured quality turns out to need it — and
  the numbers say it does not: nine variants of this extractor were tried
  against the real model and none beat it.
- Every constant is measured, not chosen, and the two that matter are commented
  at the top of the file: **cepstral mean normalisation is not optional** (its
  absence collapses the gap between the same speaker and a different one from
  0.306 to 0.105 while making both numbers look better), and **the window wants
  about two seconds**.
- Written against golden values rather than blind. The reference implementation
  — the Python one that scored 100 % on five named examples against the real
  CAM++ — was run on a deterministic signal with no generator and no seed, and
  its output is asserted here: the frame count, three rows of band values, the
  positions and values of the loudest and quietest bands, and the sums of the
  window and the filterbank. One wrong constant anywhere moves at least one of
  those.
- `#![allow(dead_code)]` with a note: nothing calls this yet, because the model
  that consumes it is the next step. The exception goes when the embedder lands.
- Files: `src-tauri/src/voiceprint.rs`, `src-tauri/src/main.rs`.
- Verified: golden values generated in this session from the measured reference;
  braces balanced; the inner attribute sits after the module docs and before the
  first item. **Not compiled** — no cargo here. CI is the first reader, as with
  everything else in Rust today.

### 2026-08-07 — Where to look, taken from the transcript instead of a second model

- Added `windows()` to `voiceprint.rs`: transcript blocks in, stretches of audio
  worth asking the model about out. This is the step that lets pyannote and
  `sherpa-onnx.exe` go — their job was to find where speech is, and Whisper has
  already timestamped every word, so the expensive model was being paid for
  something the application had on hand.
- Blocks rather than words: a word is a fifth of a second, far too little to
  recognise a voice from, and a block boundary is where the application already
  believes a thought ends. Measured: one second reads 80 % correct, two 86 %.
- A block longer than the window is cut into overlapping two-second windows at
  a one-second hop, so that two people inside one block are not averaged into a
  single answer, and a handover always has a whole window on each side of it.
  The end of a block is always covered, by a full-length window reaching back
  into the one before it — somebody taking the floor for the last second and a
  half is exactly the case this exists for.
- Files: `src-tauri/src/voiceprint.rs`.
- Verified: the same logic was written a second time in Python and the seven
  test expectations run against it before the Rust was committed — a block of
  the right length gives one window, a block under 0.8 s gives none, six
  seconds gives five overlapping windows that never leave the block, a 5.5 s
  block ends with a window that ends where it does, every window carries its
  block index, and a block just over the window length does not produce a
  near-duplicate. The Rust itself is still uncompiled; this only means CI is
  not the first thing to check the arithmetic.
