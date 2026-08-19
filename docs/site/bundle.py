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

page = io.open(os.path.join(HERE, "index.html"), encoding="utf-8").read()


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
page = re.sub(r"<meta[^>]*>\s*", "", page)
page = re.sub(r'<link rel="icon"[^>]*>\s*', "", page)
page = page.replace("</head>\n<body>\n", "")
page = page.replace("</body>\n</html>\n", "")

io.open(OUT, "w", encoding="utf-8", newline="").write(page)
print("%s — %d kB" % (OUT, len(page.encode("utf-8")) / 1024))
