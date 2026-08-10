<!--
One pull request, one problem. English, please.
Delete the sections that genuinely do not apply — do not delete them because
the answer is inconvenient.
-->

## Problem

<!-- What is wrong today, and how it shows. Not "improve X". -->

## Solution

<!-- What you changed, and why this way rather than the obvious alternative. -->

## Behaviour that must remain unchanged

<!-- What a reviewer should check has NOT moved: visible text, layout,
     keyboard shortcuts, Tauri command names, database schema, defaults. -->

## Tests

<!--
Which of these were run, and the result. Paste the counts, not "passed".

- [ ] npm run build
- [ ] cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
- [ ] cargo test --manifest-path src-tauri/Cargo.toml
- [ ] cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

New tests: did you watch them fail before they passed?
Manual scenarios you walked through, and what could not be verified.
-->

## Screenshots (interface changes)

<!-- Before and after, same window size, both themes, 1000 × 660 and a larger
     size. No real recording, name or path in the picture.
     Which existing component or rule already solves this, and why it could
     not be used unchanged? -->

## Security and data migration

<!-- Does this touch downloads, file paths, the webview's file access, the
     CSP, the database schema, or anything in %APPDATA% / %LOCALAPPDATA%?
     What happens to an archive written by an older version? -->

## Owner decisions still required

<!-- Anything you deliberately did not decide: new visual elements, changed
     defaults, product direction. Say so rather than deciding it quietly. -->
