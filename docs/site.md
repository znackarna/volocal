# The presentation page

It lives on the **`site` branch**, not here.

```bash
git checkout site        # the page, and its own history
git merge main           # when it needs what the application has changed
```

## Why it moved

The page and the application have different rhythms. A sentence on the page
gets rewritten because a better one occurred to somebody; the application is
released when there is something to release. While both lived on `main`, the
second waited for the first: `scripts/release.ps1` refuses a working tree with
uncommitted changes in it — correctly, because it cannot tell which of those
edits the installer contains — so a half-finished paragraph blocked a release
three times in one day.

And once it did worse than block. On 20 August ten thousand lines of the page
were swept into a release commit whose message was entirely about something
else, because the page had been committed locally and never pushed. The
correction is in [history/2026-08-20.md](history/2026-08-20.md).

## Why a branch and not a repository of its own

**The page is built out of the application's own files.** It uses `brandArt.ts`
and `Brand.tsx` for the mark and its animation, and the application's own
stylesheet and markup for the windows it shows — which was asked for, and is
the most valuable thing about it: nothing on that page is a second drawing of
something the product already has.

In a separate repository that link becomes a copy or a package. A copy goes
stale, and a package for two files is a thing nobody maintains. A branch keeps
the files one `git merge main` away.
