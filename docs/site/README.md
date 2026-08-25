# The presentation page — handover

One page in Czech that answers *should I install this?* It is a static file with
no build step: open `docs/site/index.html` from disk and it works.

Written 2026-08-19, at the end of two days of work. The reasoning behind every
decision is in [docs/history/2026-08-18.md](../history/2026-08-18.md) and
[2026-08-19.md](../history/2026-08-19.md); this file is only what a new session
needs before touching anything.

## The files

| | |
|---|---|
| `index.html` | the whole page: markup, stylesheet, and the boot script at the foot |
| `brand.css`, `brand.js` | all three states of the mark, copied out of `src/brandArt.ts` and `Brand.tsx` |
| `chibi.js` | the cartoon in the hero — four beats, using the real face and mill |
| `preview.js` | the carousel, the playing transcript, the waveform, the archive's progress |
| `app-shot.css` | the application's own stylesheet, scoped under `.shot` |
| `scope-app-css.py` | what generates it. Run it when `src/css/*` changes; never edit the copy |
| `bundle.py` | builds one self-contained file (fonts inlined) for handing the page to somebody |
| `fonts/` | Geist and Literata, four woff2 out of `node_modules/@fontsource-variable/` |

## Looking at it

```powershell
python docs/site/bundle.py <output.html>   # one file, ~620 kB, fonts inlined
```

The bundle strips the document skeleton, which is the shape a hosted artifact
wants. The page the owner has been reviewing lives at
`https://claude.ai/code/artifact/7f591636-ecbd-45d9-8f51-8650c111791d` — publish
to **that URL** rather than making a second one.

Headless renders are how every visual claim in the history was checked:

```bash
chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1280,1500 --screenshot=out.png --virtual-time-budget=7000 \
  file:///D:/Repo/Slobot/docs/site/index.html
```

Give it 6–7 s of virtual time or the fonts and the mark are caught mid-flight.
To see one carousel slide, copy the file with
`.carousel-track{transform:translateX(calc(-N00% - N*120px))!important}` appended
to the stylesheet; to force a palette, put `data-theme="light"` on `<html>`.

## What is on the page, in order

1. **Header** — the mark (holds 5 s, closes to `olo`), *Stáhnout*, the light/dark switch
2. **Hero** — tagline *Co spolu přepíšeme?*, the headline, the lede, the download button, and the cartoon
3. **Carousel** — five views of the application, moved by hand only
4. **Co získáte?** — three lead cards, then ten rows with icons
5. **Zpracování nepotřebuje internet** — the three occasions it touches the network
6. **Na čem to běží** — Rust/Tauri, models, CPU/GPU, speed, disk
7. **Než začnete** — three cards
8. **Closing** — the mark writes itself, then the invitation
9. **Footer**

## The rules that hold it together

- **The windows are the application's own markup under its own stylesheet.**
  Nothing in them is drawn by hand. If a view needs a part of the interface that
  is not there yet, lift the DOM and the classes from `src/`, do not approximate.
- **Icons come from `src/icons.tsx`.** No new drawing has ever been made for this
  page and none should be.
- **Colour tokens are the application's**, unchanged, from `src/css/01-base.css`.
- **A component built for a window behaves differently in a picture of one.**
  Three faults came from this: `.dialog-overlay` is `position: fixed` and veils
  the page, a dialog sized in `vh` measures the browser rather than the 744 px
  window, and the app's blur under a dialog has to be copied deliberately.
- **The copy is the owner's.** Where an arrangement forces the writing to be
  shortened or summarised, the arrangement is wrong — that is the lesson the
  gains section cost five attempts to learn.
- **The page must not style bare elements.** `section {}` reaches inside the
  windows and breaks the application's cards. Every rule is bound to a class or
  to `main >`.

## Open, and waiting for a decision

- **Nothing publishes the page.** No Pages workflow, no domain, no link from the
  readme. It is a file waiting for a decision about where it should live.
- **`docs/site/` is untracked.** It has never been committed, so there is no
  undo: one `git clean` and two days are gone. On 19 August a window had to be
  recovered from a saved copy of a published artifact because of exactly this.
  Committing it locally was offered and left open.
- **The limits are parked.** *Co nedělá dobře* sits in an HTML comment in
  `index.html`, bound for a FAQ section. **Done on 25 August** — it is the
  `#faq` section, five `<details>` under the heading *Co nedělá dobře*, and the
  answers are the owner's sentences from that comment word for word.
- **Recommended hardware in numbers is missing on purpose.** Nothing in this
  repository has measured a memory threshold — the comment beside
  `recommendedQuality` in `SetupWizard.tsx` says so. Figures would have to be
  measured before they could be written.
- **The wordmark's 5 s hold does not happen under `prefers-reduced-motion`**,
  where the mark starts closed. Whether that should become an exception is
  unanswered.

## Publishing

`.github/workflows/site.yml`, on this branch, deploys `docs/site/` to GitHub
Pages on every push that touches it. There is no build: what is served is these
files, minus `_tokens.html`, `bundle.py` and `scope-app-css.py`, which are how
the page is worked on rather than part of it.

One thing is rewritten on the way out. The hero and the closing say *Verze
X.Y.Z*, and the file carries a real number so that opening it locally never
shows a placeholder; the workflow replaces it with the tag of the latest
GitHub release, which is the version a reader can actually download. It
asserts that it found exactly two mentions, so rewording that sentence fails
the build instead of quietly shipping an old number.

**It needs Pages switched on once, by hand:** Settings → Pages → Source →
GitHub Actions. Until that is done the workflow runs and the deploy step fails.

`bundle.py` is unrelated to any of this. It makes one self-contained file for
handing the page to somebody, and it strips the document skeleton because the
host it was written for supplies its own.

## Facts the page asserts, and where they came from

| claim | source |
|---|---|
| hour of recording ≈ 1 min on a card, 8 on a processor (fast model); 4 and 35 (accurate) | `estimatedMinutes`, `src/SetupWizard.tsx` |
| models 700 MB – 1.7 GB | the wizard's own download step |
| CUDA or Vulkan chosen by the machine; processor build always present | `src-tauri/src/tools.rs`, `download.rs` |
| Tauri 2, Rust, React, SQLite, whisper.cpp, Silero VAD | `README.cs.md` |
| the three occasions it reaches the network | `README.cs.md` |
| automatic update check exists | `settings.about.updateAuto` |

If a claim is added, add its source here.
