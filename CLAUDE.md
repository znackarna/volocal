# Claude project report: precise transcript seeking

Read `ARCHITECTURE.md` before changing cross-layer behavior. New internal
identifiers and comments use standard English; visible UI copy remains Czech.

## Mandatory change record

Every code, behavior, data, copy, or UI change must be appended to the
`Change log` in this file before the work is considered finished. Each entry
must state what changed, why, the important files, and how it was verified.
Do not delete or silently rewrite older entries; add a correcting entry if an
earlier decision is superseded. This keeps hand-offs between Claude, Codex,
and the user from losing the reasoning behind the current implementation.

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
