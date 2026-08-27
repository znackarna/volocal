Jasně. Níže je hotové zadání, které můžeš celé vložit Claudeovi. Je napsané tak, aby opravoval konkrétní slabiny, nerozvolnil design systém a nerozjel zbytečný přepis projektu.
Volocal — hardening report and implementation brief
Date: 25 August 2026
Current version reviewed: 1.2.20
Objective
Volocal has moved from a promising prototype to a credible public product. The earlier structural, testing, documentation and security weaknesses have mostly been addressed.
The remaining risks are now concentrated in:

1. release integrity and excessive release frequency;
2. public claims that are stronger than the available evidence;
3. WebView navigation and microphone-permission boundaries;
4. missing end-to-end coverage of critical product flows;
5. excessive documentation and large remaining modules;
6. incomplete dependency and component verification.

Implement the work below in priority order.
Product and design authority
The owner remains the final authority over:

* product behaviour;
* visual design;
* typography;
* spacing;
* colour and component families;
* Czech product copy;
* supported workflows;
* release timing.

Do not introduce a new design direction, visual family, token, interaction model or product promise without explicit approval.
Do not “improve” intentional visual details while working on technical hardening.
All public repository text, developer documentation, commit messages and pull-request descriptions must be in English. Czech remains the source language of the interface.
General implementation rules

* Work in small, reviewable changes.
* Prefer one problem per commit or pull request.
* Do not perform a large architectural rewrite.
* Preserve existing behaviour unless the task explicitly changes it.
* Add a regression test for every corrected defect where practical.
* Do not create a release, tag or public GitHub change without owner approval.
* Do not turn every implementation detail into a long historical essay.
* Active code comments should explain invariants and non-obvious constraints, not retell the complete history of a defect.

Priority 1 — release integrity
Complete this before the next regular public release.
1. Reject a dirty tree before building
The first pass of `scripts/release.ps1` currently builds the installer before requiring a clean working tree.
The second pass checks cleanliness, but that is insufficient:

1. an installer can be built from uncommitted changes at commit A;
2. the changes can be stashed;
3. the repository is then clean and still at commit A;
4. publication can pass even though the installer does not correspond to commit A.

Required change
Before running release checks or building the installer:

* reject modified tracked files;
* reject staged but uncommitted files;
* reject relevant untracked files;
* print the exact offending paths;
* allow only explicitly documented generated or ignored files.

Record enough source identity to prove what was built. At minimum use a clean commit SHA. If any source state beyond the commit can affect the result, record and verify that state too.
Acceptance criteria

* A clean tree builds normally.
* A modified tracked file stops the build.
* A staged file stops the build.
* An untracked source file stops the build.
* Stashing changes after a build cannot make an unverifiable installer publishable.
* The failure happens before the expensive installer build.

2. Make installer verification a pre-publication gate
The current tag-triggered installer smoke test does not clearly prevent publication. According to the release script, the final tag appears when the draft is published; the smoke test can therefore happen after the release becomes public.
Required change
Design a release flow in which the exact release candidate is checked before publication.
A suitable flow may be:

1. build from a clean, exact commit;
2. install the candidate;
3. start the installed application;
4. verify archive/database creation;
5. perform any safe additional smoke checks;
6. sign the verified installer;
7. create a draft;
8. publish only after the required checks have succeeded.

If CI and the local signing machine produce different binaries, document that distinction and make sure the actually published installer receives an appropriate post-signing check.
Do not place the updater private key in GitHub Actions.
Acceptance criteria

* A failed installer smoke test prevents publication.
* The tested candidate can be traced to the exact commit.
* The release script states which checks have passed.
* The manual escape hatch remains explicit and visibly dangerous.
* README and CONTRIBUTING describe the real enforced process, not the intended process.

3. Reduce release churn
The repository produced 32 tags across seven release days between 11 and 20 August. The changelog records several immediate regressions, including functionality restored after the preceding release removed or broke it.
Required process proposal
Add a concise release policy:

* normal changes are grouped into a release candidate;
* the candidate receives a short soak period;
* emergency hotfixes remain possible;
* known regressions block a normal release;
* a minimal acceptance checklist is completed before publication.

Keep the policy short. Do not add a large release-management framework.
Priority 2 — WebView security boundary
4. Block unexpected top-level navigation
The CSP limits loaded resources but does not prevent the whole WebView from navigating elsewhere. `SECURITY.md` already acknowledges this.
Required change

* Allow the main WebView to navigate only to Volocal’s bundled local origin and any strictly necessary internal schemes.
* Refuse all other top-level navigation.
* Continue opening the approved GitHub project link in the system browser through the existing restricted opener permission.
* Log refused navigation without leaking transcript or file contents.

Acceptance criteria

* The bundled application loads normally.
* A navigation attempt to an arbitrary HTTPS URL is refused.
* The approved external project link still opens outside Volocal.
* Tests cover allowed and refused navigation where technically practical.

5. Restrict automatic microphone permission by origin
The microphone permission handler currently checks the permission kind but not the requesting origin.
Required change

* Automatically allow microphone access only for the known bundled Volocal origin.
* Explicitly refuse microphone access requested by any other origin.
* Preserve the existing Volocal recording workflow.
* Document the invariant briefly next to the implementation.

Acceptance criteria

* Recording from Volocal still works.
* A microphone request from an unexpected origin is denied.
* Navigation protection and permission protection are independent barriers.

6. Correct the WebView description
Replace statements such as:
The interface is not a web page.
Use a technically accurate formulation such as:
The interface is loaded only from bundled local assets and contains no advertising or tracking code.
Keep the explanation understandable to non-technical readers.
Priority 3 — public claims and trust
7. Remove or substantiate unmeasured performance claims
The public website says:
Hodinu zvládne za minutu.
It also publishes concrete GPU and CPU times. However, the comment beside `estimatedMinutes()` explicitly says that the four values have never been measured.
This contradiction must not remain public.
Required change
Choose one of these approaches with the owner:

1. publish reproducible measurements with the exact hardware, model, backend, recording and Volocal version; or
2. replace the claim with an honest qualitative description and label all estimates as approximate.

Do not present unmeasured values as benchmark results.
A safe interim formulation would be:
Rychlost závisí na zvoleném modelu a výkonu počítače. Volocal zobrazuje orientační odhad; nejde o měření konkrétního zařízení.
The final Czech wording requires owner approval.
8. Replace absolute format claims
Replace:
Zpracuje libovolný zvukový formát…
The application supports a defined set of formats, not literally every format.
Prefer a claim such as:
Zpracuje běžné zvukové a videoformáty i nahrávky z podporovaných online služeb.
Confirm the wording against the actual supported-extension list and online-import behaviour.
9. Disclose the unsigned installer before download
README and SECURITY explain that the installer is not Authenticode-signed, but the public download page does not clearly prepare a user for the SmartScreen warning.
Add a short note near the download action. It should:

* say what Windows may display;
* explain where the official installer comes from;
* link to the security explanation;
* avoid pretending that the warning is harmless.

Final wording requires owner approval.
10. Unify Czech address
The website mixes formal address such as “Zapněte” and “Stáhněte” with “Přetáhni sem nahrávku”.
Review the site for inconsistent formal and informal address. Follow the owner’s selected voice consistently.
Do not automatically rewrite the application’s whole interface.
Priority 4 — tests that reflect real user flows
The project now has strong unit-level coverage:

* 290 frontend tests;
* 244 passing Rust tests;
* strict TypeScript, Clippy and formatting checks.

The remaining gap is between individual functions and complete product workflows.
11. Add a small critical-flow acceptance suite
Start with a limited set of high-value scenarios:

1. first launch and archive creation;
2. component download, cancellation and restart;
3. add recording → transcription progress → completed detail;
4. playback and seeking after transcription;
5. closing during an unfinished microphone recording;
6. update check and release-note display;
7. archive import or restore without damaging the current archive.

Use mocked Tauri IPC for frontend-flow tests where full desktop automation would be disproportionate. Keep at least the installer launch smoke test on Windows.
Acceptance criteria

* Tests protect behaviour, not incidental DOM structure.
* Each scenario has a clear user-visible outcome.
* The suite remains reliable in CI.
* Do not add dozens of low-value snapshot tests.

Priority 5 — supply-chain checks
12. Add Rust dependency advisory checking
The current npm dependency audit is clean, but Rust advisories are not checked automatically.
Add one maintained mechanism, for example:

* `cargo audit`;
* `cargo deny`;
* an official RustSec GitHub Action.

The check should fail on relevant unacknowledged vulnerabilities. Any exception must be narrow, documented and time-limited.
13. Pin the remaining voice model
Fifteen of sixteen downloaded components have a publisher-provided digest. The speaker-recognition model has none.
A digest calculated by Volocal maintainers cannot prove the original publisher’s identity, but it can freeze independently reviewed known-good bytes and prevent later silent substitution.
Required change
Evaluate adding a separately labelled maintainer-reviewed SHA-256:

* keep the distinction from a publisher-provided digest;
* document how the initial file was reviewed;
* verify the digest before parsing or installing the model;
* preserve the provenance warning where appropriate.

Do not claim stronger authenticity than this provides.
Priority 6 — maintainability without a rewrite
Large active files remain:

* `src/Detail.tsx` — approximately 3,500 lines;
* `src/Settings.tsx` — approximately 2,900 lines;
* `src/App.tsx` — approximately 2,000 lines;
* `src-tauri/src/db.rs` — approximately 4,000 lines.

Do not split them solely to reduce line counts.
14. Extract only stable responsibility boundaries
When future work touches these areas, prefer boundaries such as:
Detail

* playback and keyboard control;
* transcript editing;
* speaker management;
* export;
* notes and AI documents.

Settings

* component downloads;
* update handling;
* model selection;
* archive and backup controls;
* appearance settings.

Database

* schema and migrations;
* settings;
* recordings and folders;
* segments and speakers;
* dictionary and search;
* backups;
* AI documents.

Keep a small compatibility facade where it prevents broad churn. Move tests with the responsibility they protect.
Priority 7 — documentation discipline and repository hygiene
15. Stop writing a diary for every change
`docs/history` now contains more than 21,000 lines. One daily file exceeds 5,000 lines. The active source also contains many long comments recounting the full history of a defect.
Use this hierarchy:

* Git commits: what mechanically changed;
* CHANGELOG: what users gain or need to know;
* ADR or focused design note: long-lived architectural or security decisions;
* code comment: the invariant a future editor must preserve.

Do not rewrite the existing archive merely to shorten it. Change the rule for future work and stop the growth.
16. Small repository corrections

* Ignore `.claude/settings.local.json`.
* Ensure no local Claude worktree or permission file can be committed accidentally.
* Add the product website to GitHub About.
* Add one current anonymised application screenshot to README.
* Correct README’s description of `npm run build`; it also runs `docs:check`.
* Resolve or explicitly allow the contextual translation warning for Czech “Přepis”, rather than leaving a permanent generic warning.

Required verification
Before handing the work back:

```
npm run build
npm run test
node scripts/i18n.mjs check --strict
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Also run every new release, security and installer check introduced by this work.
Expected hand-off
Return a concise report containing:

1. completed items grouped by priority;
2. files changed;
3. tests added;
4. exact verification results;
5. decisions still requiring owner approval;
6. remaining risks;
7. anything deliberately left unchanged and why.

Do not publish a release. Do not alter the product’s visual direction. Do not hide unresolved uncertainty behind stronger documentation wording.


Tady je doporučení od codexu. Jak bys je jako proifesionální architek SW zhodnotil?
