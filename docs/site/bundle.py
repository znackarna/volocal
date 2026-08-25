# Builds a single self-contained copy of the page: stylesheets, scripts and the
# four font files inlined, and the document skeleton taken off, which is the
# shape a hosted artifact wants. `docs/site/index.html` stays the source; this
# is only a way to hand the page to somebody as one file.
#
#   python docs/site/bundle.py <output.html>
import base64
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "volocal-page.html")

# The page to bundle. `index.html` unless a second argument names another one,
# which is how a one-off sample beside it gets the same fonts and stylesheet.
SOURCE = sys.argv[2] if len(sys.argv) > 2 else "index.html"

page = io.open(os.path.join(HERE, SOURCE), encoding="utf-8").read()


def read(name):
    return io.open(os.path.join(HERE, name), encoding="utf-8").read()


def font(name):
    with open(os.path.join(HERE, "fonts", name), "rb") as f:
        return "url(data:font/woff2;base64," + base64.b64encode(f.read()).decode("ascii") + ")"


# Stylesheets and scripts, in the order the page loads them.
for link, name in re.findall(r'(<link rel="stylesheet" href="([^"]+)">)', page):
    page = page.replace(link, "<style>\n" + read(name) + "\n</style>")
for tag, name in re.findall(r'(<script src="([^"]+)"></script>)', page):
    page = page.replace(tag, "<script>\n" + read(name) + "\n</script>")

# The faces themselves.
for name in ["geist-latin-wght-normal", "geist-latin-ext-wght-normal",
             "literata-latin-wght-normal", "literata-latin-ext-wght-normal"]:
    page = page.replace("url(fonts/%s.woff2)" % name, font(name + ".woff2"))

# The host supplies doctype, head and body; the title stays, it names the page.
page = re.sub(r"^<!doctype html>\s*<html lang=\"cs\">\s*<head>\s*", "", page, flags=re.I)
# `[^>]*` is the obvious way to say *the rest of this tag* and it is wrong:
# an attribute may hold a `>`, and this page's icon does -- it is an inline
# SVG in a `data:` URI. That regex stopped at the first `>` inside the drawing
# and left the rest of it, and the closing quote and bracket, standing in the
# page as text in the top left corner of every copy built between 25 August
# and this fix. `TAG_REST` takes either a whole quoted value or a character
# that is neither a quote nor the end of the tag, so a `>` inside quotes
# cannot end it.
TAG_REST = r'(?:"[^"]*"|[^>"])*'

page = re.sub(r"<meta" + TAG_REST + r">\s*", "", page)
page = re.sub(r'<link rel="icon"' + TAG_REST + r'>\s*', "", page)
page = page.replace("</head>\n<body>\n", "")
page = page.replace("</body>\n</html>\n", "")

# Everything the head held is either inlined above or removed, so between the
# title and the first `<style>` nothing may be left but comments. This is the
# check the icon would have failed loudly instead of quietly.
leftover = page.split("</title>", 1)[1].split("<style>", 1)[0]
leftover = re.sub(r"<!--.*?-->", "", leftover, flags=re.S).strip()
if leftover:
    raise SystemExit("stripping the head left something behind: " + leftover[:160])

io.open(OUT, "w", encoding="utf-8", newline="").write(page)
print("%s — %d kB" % (OUT, len(page.encode("utf-8")) / 1024))
