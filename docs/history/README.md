# Change log

The reasoning behind every decision in Volocal, one file per day, moved out of
`CLAUDE.md` on 2026-08-10 because that file had grown to 630 000 characters —
four times what a session can read — and was being loaded in full before every
task. Nothing was rewritten or dropped in the move.

Read a day when you need the reason behind something you are about to change.
A correcting entry never deletes the one it corrects; it is added after it, so
the later entry wins and the earlier one still explains what was believed at
the time.

| Day | Entries | |
|---|---|---|
| [2026-08-01](2026-08-01.md) | 4 | Precise seeking for long VBR MP3 recordings … |
| [2026-08-02](2026-08-02.md) | 136 | Adaptive readable transcript blocks … |
| [2026-08-03](2026-08-03.md) | 52 | Multiline sidebar notes … |
| [2026-08-04](2026-08-04.md) | 50 | Phase A of the audit: nothing may quietly destroy work … |
| [2026-08-05](2026-08-05.md) | 99 | Recording from the microphone … |
| [2026-08-06](2026-08-06.md) | 41 | The portable copy is called Slobot, and so is the package … |
| [2026-08-07](2026-08-07.md) | 40 | A recording one worker holds is not offered to another … |
| [2026-08-08](2026-08-08.md) | 10 | The unnamed interjections get a list of their own … |
| [2026-08-09](2026-08-09.md) | 4 | The audio the application makes has a folder of its own … |
| [2026-08-10](2026-08-10.md) | 23 | The change log leaves CLAUDE.md … |
| [2026-08-11](2026-08-11.md) | 26 | Volocal 1.0.0, and a signing key that is worth something |
| [2026-08-12](2026-08-12.md) | 33 | The code speaks English, and five releases go out … |
| [2026-08-13](2026-08-13.md) | 40 | A backup taken twice in one second is one backup … |
| [2026-08-14](2026-08-14.md) | 53 | Settings regrouped, then cut to seven one-word tabs … |
| [2026-08-15](2026-08-15.md) | 4 | The empty dictionary is a row to write in … |
| [2026-08-16](2026-08-16.md) | 19 | The cube leaves and the name closes to its own middle … |
| [2026-08-17](2026-08-17.md) | 29 | The mark turns on its side, then the whole application is surveyed … |
| [2026-08-18](2026-08-18.md) | 16 | A presentation page: invented, rebuilt from the application, cut to a column, and the live windows returned as figures … |
| [2026-08-19](2026-08-19.md) | 5 | The one live preview becomes five, driven by hand … |
| [2026-08-20](2026-08-20.md) | 16 | Online import fixed at the chunk that returns 403, and the link it came from is now kept … |
| [2026-08-21](2026-08-21.md) | 11 | The gains section on a phone, where it had nothing to show … |
| [2026-08-24](2026-08-24.md) | 1 | The page comes back into the repository … |
| [2026-08-25](2026-08-25.md) | 41 | The limits section is asked as a question … |
| [2026-08-26](2026-08-26.md) | 24 | The cube comes back out of the panel … |
| [2026-08-27](2026-08-27.md) | 26 | The four times in the wizard were measured all along … |
| [2026-08-28](2026-08-28.md) | 2 | The two failures worth logging were the two not being logged … |
| [2026-08-31](2026-08-31.md) | 15 | The three pieces of ballast, and what each one turned out to be … |
| [2026-09-01](2026-09-01.md) | 9 | The release script asks whether the version is already out; then what an interpreted recording showed Volocal was losing … |
| [2026-09-02](2026-09-02.md) | 77 | The first real fill stuck on screen and was then found to be chaos on paper; the second-language pass was rebuilt from the sound rather than from the first transcript's word timings — 409 English blocks where there were 108. |

## What each day was about

**[2026-08-01](2026-08-01.md)** — Precise seeking in long VBR MP3s, and the phases of the transcription pipeline.

**[2026-08-02](2026-08-02.md)** — Readable transcript blocks, and the local language model put to work enhancing, summarising and translating. Online import arrived, and Settings had its first pass.

**[2026-08-03](2026-08-03.md)** — Interface text moved into a dictionary, with the checks that keep it there. Notes, the speaker-count question, and the embedding model that fixed diarization.

**[2026-08-04](2026-08-04.md)** — The audit, under one rule: nothing may quietly destroy work. Cancelling, backups, the dictionary page, the transcript context menu, and corrections kept beside the text.

**[2026-08-05](2026-08-05.md)** — Recording from the microphone, folders in the archive, saving audio out of it, and the About tab. The longest day in this log at ninety-nine entries, most of them the interface being settled one card and one sentence at a time.

**[2026-08-06](2026-08-06.md)** — The repository made ready to be public, and the installer given its branding, its Czech and a licence page written the way NSIS reads it. It ends with an updater that was published and then withdrawn.

**[2026-08-07](2026-08-07.md)** — Speaker recognition moved inside the application: DirectML measured, sherpa-onnx dropped, CAM++ through ONNX Runtime. The window got its content policy the same day.

**[2026-08-08](2026-08-08.md)** — Unnamed interjections, names offered before a run, and the sidebar rebuilt as cards. One rule for choosing among a row replaced the three-way split written earlier that morning.

**[2026-08-09](2026-08-09.md)** — A folder for the audio the application makes, search inside a transcript, and WebView2's own shortcuts switched off.

**[2026-08-10](2026-08-10.md)** — The hardening plan, start to finish: this log moved out of `CLAUDE.md`, the security documentation made to match the code, all 21 Clippy findings fixed with CI refusing new ones, fifteen downloads pinned against a published digest, and the webview's disk access closed to one file at a time. Then Slobot became Volocal, identifier and all, with a migration that carries the archive over.

**[2026-08-11](2026-08-11.md)** — Volocal 1.0.0, and by the end of the night an update that installed itself end to end. Getting there took a release carrying the previous version's installer, and a job object that killed the installer a moment after starting it.

**[2026-08-12](2026-08-12.md)** — Every Czech identifier, class name and comment turned English, the database schema with them, and a migration that carries each archive over. Five releases in one day, two of them withdrawn: 1.0.5 refused the archive it had just migrated, and 1.0.8 pointed the application at a folder of browser cache.

**[2026-08-13](2026-08-13.md)** — Pressing *Zálohovat teď* twice in one second reported a broken archive that was fine, and the archive card was rearranged the way its owner wanted it. Then the simplification: a first run that asks one question instead of four and downloads 1.2 GB instead of 6.4, and Settings taken from seven tabs and 59 controls to three tabs and two dozen.

**[2026-08-14](2026-08-14.md)** — Settings rebuilt at the screen across fifty-three entries — three tabs back up to five, then six one-word tabs, then a seventh for `Výkon` — each name arrived at by the owner reading it rather than from the code. The dictionary lost its form and became a listing, and the development port moved for the third time.

**[2026-08-15](2026-08-15.md)** — Four corrections to the dictionary's copy: an empty dictionary is a row to write in rather than a sentence saying it is empty, and the placeholders say what goes in the field. *Chybný* replaced *Špatný*, and the model note names the reader's act rather than the model's condition.

**[2026-08-16](2026-08-16.md)** — The cube left the interface, the name closed to its own middle, and 1.2.0 went out. Then three rounds spent judging an icon Windows was no longer using, before the discovery that the title bar had been stretching a 16 px icon to 24.

**[2026-08-17](2026-08-17.md)** — The mark turns on its side and becomes a rolling mill, and five releases go out between 1.2.1 and 1.2.5 — one refusing itself over a missing fingerprint, another shipping without the writing being visible. Then the whole application is surveyed, and the blur nobody could reproduce is answered by finding that nothing renders it on that machine.

**[2026-08-18](2026-08-18.md)** — A presentation page for Volocal, invented first and then rebuilt out of the application itself, because the invented one described a program that does not exist. The headline is the owner's, and it is a joke on one letter.

**[2026-08-19](2026-08-19.md)** — The page's one live window becomes a carousel of five, moved by hand and never by itself. The gains section went through five arrangements and ended on the second one, which is the entry worth reading.

**[2026-08-20](2026-08-20.md)** — Online import stopped after a megabyte, and the megabyte was the diagnosis; the setup learned to say why it had failed on somebody else's network. Sixteen entries, ending with the presentation page moving to a branch of its own.

**[2026-08-21](2026-08-21.md)** — `SECURITY.md` rewritten for people, and the rule that came out of it: say the thing and stop, and write Czech as Czech rather than as translated English. The gains section was repaired for the phone, where one line of the stylesheet had been throwing all ten proof cards away, and the page went live after two refusals.

**[2026-08-24](2026-08-24.md)** — The presentation page comes back into the repository after four days on a branch of its own, because the split was standing in for a habit: commit page work like any other work. The merge brought back less than it looked like, and the deploy said so within ten seconds.

**[2026-08-25](2026-08-25.md)** — *Co nedělá dobře* becomes *Jaké má limity?*, and all four FAQ answers end up in the owner's own words. Then the menu for the phone, and the panel for companies rewritten until it stopped asking and started answering.

**[2026-08-26](2026-08-26.md)** — The cube comes back out of the panel an hour after going in, and the branching rule becomes one `main`, one `dev`, merged only when the owner says so. Also 1.2.21, a release that redeploys the page by itself, and an English page that was saying *your* three times as often as the Czech.

**[2026-08-27](2026-08-27.md)** — The four times in the wizard turn out to have been measured all along, and the window is zoomed rather than scaled. The offer for companies is settled in the owner's words, and GitHub Pages is switched off now that Vercel answers on volocal.app.

**[2026-08-28](2026-08-28.md)** — Two whole classes of failure were leaving no trace: a Rust panic with no hook, and a crash in the window whose text `ErrorBoundary` only ever showed on screen. Both reach the log now, and the day ends with a tidy-up plan written down instead of remembered.

**[2026-08-31](2026-08-31.md)** — Points A and B of that plan worked through: the untracked bundle file identified, #214 closed with the three live bumps applied by hand, Dependabot pointed at `dev`, and this index repaired where it had drifted from the files it indexes. Also a recording labelled `Přesný` that the fast model wrote, a record button that failed silently, a download bubble stuck at 100 %, and 1.2.22. Last, the stop button gains the square that answers the record dot, and a photograph of `Nová složka` turns out to be almost nothing: measured in a browser against the real stylesheet, the plus sits on zero and the letters are 0.17 px low — the 0.67 px first reported came from a harness counting JSX whitespace. The same class carries four labels and the offset is set by which letters they contain, `Rozpoznat znovu` sitting 2.17 px low for the descender in `p`; no `line-height` centres both, so nothing was changed. And `Zahodit` learns to mean be done rather than start over: a take stopped from the minimised pill took three presses to get away from, because discarding re-armed the microphone and the button labelled `Zrušit` steps back to the source cards. It closes now, through `releaseMicrophone` so the device goes too; the guard against clicking an undecided take away is kept and pinned by a test. The day closes on 1.2.23 and two mistakes that made each other worse: 1.2.22 was published at 23:01 and this session kept building it for another three-quarters of an hour without checking, and the three commits made after that build went onto `main` while being reported as `dev`. Nothing was lost, but the release went out without the stop square and the discard, so 1.2.23 carries them.


**[2026-09-01](2026-09-01.md)** — The release script asks `origin` whether the version is already published, before the twenty minutes rather than after: 1.2.22 went out at 23:01 and this session kept building it, having twice broken its own promise to check. Checked against the real tags. Recorded with it: the guard was written mid-build and had to be set aside so the tree still matched the installer — a repair to the release machinery cannot land in the middle of a release. Then stage one of the split of the large React components, on a `refactor` branch: sixty-nine characterization tests across `Detail`, `Settings` and the shell — which nothing had rendered before — written against whole screens so that the moves they exist to protect will not have to rewrite them. 187 tests at the start of the day, 256 at the end, and not a line of the product changed. Then all ten stages of it, on the same branch: `Detail.tsx` from 3 507 lines and 53 pieces of state to 1 005 and 6, `Settings.tsx` from 2 929 to 1 099, `App.tsx` from 1 960 to 1 372 — and the tests written first passed unchanged the whole way through, which is the answer to whether writing them first was worth it. A review of the finished branch then found four regressions the split had left behind — the improved document never going stale being the worst of them — none of which the 256 tests had caught, because none is a thing a reader does. In the evening, a sixth feature and a measurement: an interpreted recording showed Volocal drops close to half the speech without saying so, and one flag — `--max-context 0` against today's 64 — recovers seven times more of the missing language. Characterization tests first, then the sweep that notices it.
