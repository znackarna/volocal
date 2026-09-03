# Prefixes every rule in the application's stylesheet with `.shot`, so the real
# UI can stand inside a marketing page without its rules reaching the page.
# `:root` blocks stay global on purpose: the page is drawn from the same tokens.
import io, sys, re

SCOPE = ".shot"
KEEP_AS_IS = ("@keyframes", "@-webkit-keyframes", "@font-face", "@import",
              "@charset", "@property", "@page", "@counter-style")
RECURSE = ("@media", "@supports", "@container", "@layer", "@scope")


def split_top(css):
    """Yield (prelude, body_or_None, raw) chunks at the current nesting level."""
    out, i, n = [], 0, len(css)
    start = 0
    while i < n:
        c = css[i]
        if c == "/" and css[i:i + 2] == "/*":
            end = css.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if c in "\"'":
            q = c
            i += 1
            while i < n and css[i] != q:
                i += 2 if css[i] == "\\" else 1
            i += 1
            continue
        if c == ";" and css[start:i].strip().startswith("@"):
            out.append((css[start:i + 1], None))
            i += 1
            start = i
            continue
        if c == "{":
            prelude = css[start:i]
            depth, j = 1, i + 1
            while j < n and depth:
                d = css[j]
                if d == "/" and css[j:j + 2] == "/*":
                    e = css.find("*/", j + 2)
                    j = n if e == -1 else e + 2
                    continue
                if d in "\"'":
                    q = d
                    j += 1
                    while j < n and css[j] != q:
                        j += 2 if css[j] == "\\" else 1
                    j += 1
                    continue
                if d == "{":
                    depth += 1
                elif d == "}":
                    depth -= 1
                j += 1
            out.append((prelude, css[i + 1:j - 1]))
            i = start = j
            continue
        i += 1
    tail = css[start:]
    if tail.strip():
        out.append((tail, None))
    return out


def prefix_selector(sel):
    sel = sel.strip()
    if not sel:
        return sel
    if sel.startswith(":root"):
        # A token block stays global; anything descending from :root keeps the
        # theme stamp and gets the scope inserted after it.
        head = re.match(r":root(\[[^\]]*\])*", sel).group(0)
        rest = sel[len(head):].strip()
        return head if not rest else head + " " + SCOPE + " " + rest
    if sel in ("html", "body", "#root", "html, body, #root"):
        return SCOPE
    if sel == "*":
        return SCOPE + " *"
    if sel.startswith("::"):
        return SCOPE + " " + sel
    return SCOPE + " " + sel


# A heading in the page's imitation of the application is not a heading of the
# page. It is drawn as one and it must go on looking exactly like one, but a
# crawler counted four `<h1>` that say the name of a recording, and a screen
# reader read them as the page's own structure.
#
# The markup there carries `<div data-h="2">` instead of `<h2>`, and this is
# what keeps the two in step: every rule that styles a bare `h1`...`h6` is
# emitted a second time with `[data-h="N"]` in its place. The application's
# stylesheet stays the single source -- restating those rules in the page's own
# CSS is the thing that would drift on the next regeneration.
HEADING = re.compile(r"(?<![\w#.\-\[])h([1-6])(?![\w\-])")


def heading_alias(sel):
    """The same selector addressed to `[data-h="N"]`, or None where the
       selector has no bare heading element in it."""
    alias, hits = HEADING.subn(lambda m: '[data-h="%s"]' % m.group(1), sel)
    return alias if hits else None


def prefix_prelude(prelude):
    lead = ""
    m = re.match(r"^(\s*(?:/\*.*?\*/\s*)*)", prelude, re.S)
    if m:
        lead, prelude = m.group(1), prelude[m.end():]
    parts = [p for p in split_selector_list(prelude)]
    out = []
    for part in parts:
        if not part.strip():
            continue
        prefixed = prefix_selector(part)
        out.append(prefixed)
        alias = heading_alias(prefixed)
        if alias:
            out.append(alias)
    return lead + ",\n".join(out)


def split_selector_list(prelude):
    out, depth, cur = [], 0, ""
    i, n = 0, len(prelude)
    while i < n:
        c = prelude[i]
        if c == "/" and prelude[i:i + 2] == "/*":
            e = prelude.find("*/", i + 2)
            cur += prelude[i:(n if e == -1 else e + 2)]
            i = n if e == -1 else e + 2
            continue
        if c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        if c == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    out.append(cur)
    return out


def walk(css):
    out = []
    for prelude, body in split_top(css):
        head = re.sub(r"/\*.*?\*/", "", prelude, flags=re.S).strip()
        if body is None:
            out.append(prelude)
            continue
        if head.startswith(KEEP_AS_IS):
            out.append(prelude + "{" + body + "}")
        elif head.startswith(RECURSE):
            out.append(prelude + "{" + walk(body) + "}")
        else:
            out.append(prefix_prelude(prelude) + " {" + body + "}")
    return "".join(out)


parts = ["01-base", "02-library", "03-detail", "04-settings", "05-later"]
chunks = []
for p in parts:
    src = io.open("src/css/%s.css" % p, encoding="utf-8").read()
    chunks.append("/* ==== src/css/%s.css ==== */\n" % p + walk(src))
out = io.open("docs/site/app-shot.css", "w", encoding="utf-8", newline="")
out.write("""/* The application's own stylesheet, so the window on this page is the window.
 *
 * `src/css/01-base.css` … `05-later.css` concatenated in the import order of
 * `src/styles.css` — that order is load-bearing, see the note at the top of
 * that file — and mechanically prefixed with `.shot`, so the application's
 * rules cannot reach the page around them. Nothing else was changed: no rule
 * was rewritten, dropped or reordered.
 *
 * `:root` blocks are left global on purpose. The page is drawn from the same
 * tokens as the application, which is the whole idea.
 *
 * Regenerate whenever the application's CSS changes; the page has no other
 * copy of it.
 */
""")
out.write("\n".join(chunks))
out.close()
print("written")
