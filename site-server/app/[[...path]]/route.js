/* The presentation page: the same files from
 * docs/site, the English page made from the Czech one, and the version a reader
 * can download written into both. Read from disk on request, so there is no
 * copy of the page to drift from the one in the repository. */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { englishPage, stampVersion } from "../../page.mjs";

export const dynamic = "force-dynamic";

const SITE = join(process.cwd(), "..", "docs", "site");

// What is served. The rest of docs/site is how the page is
// worked on, not part of it.
const FILES = new Set([
  "brand.css",
  "app-shot.css",
  "page.css",
  "brand.js",
  "chibi.js",
  "preview.js",
  "og.png",
  "og-en.png",
  "robots.txt",
  "sitemap.xml",
]);
const FONT = /^fonts\/[\w-][\w.-]*$/;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

// Vercel's own default for static files: always ask, answer 304 when unchanged.
const CACHE = "public, max-age=0, must-revalidate";

export async function GET(request, { params }) {
  const { path = [] } = await params;
  const name = path.join("/");

  if (name === "" || name === "index.html") {
    return send(request, await stamp(await readFile(join(SITE, "index.html"), "utf8"), "cs"), TYPES[".html"]);
  }
  if (name === "en" || name === "en/index.html") {
    return send(request, await stamp(await englishTemplate(), "en"), TYPES[".html"]);
  }
  if (FILES.has(name) || FONT.test(name)) {
    try {
      const body = await readFile(join(SITE, name));
      return send(request, body, TYPES[extname(name)] ?? "application/octet-stream");
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    }
  }
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CACHE },
  });
}

function send(request, body, type) {
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { "Content-Type": type, "Cache-Control": CACHE, ETag: etag };
  const asked = (request.headers.get("if-none-match") ?? "").split(",").map((tag) => tag.trim().replace(/^W\//, ""));
  if (asked.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

// ------------------------------------------------------------ the English page

// Made once per process and again only when the page or the dictionary changes
// on disk, which in production is never: a deploy is a new process.
let english = { key: "", html: "" };

async function englishTemplate() {
  const [page, dictionary] = await Promise.all([stat(join(SITE, "index.html")), stat(join(SITE, "en.json"))]);
  const key = `${page.mtimeMs}:${dictionary.mtimeMs}`;
  if (english.key !== key) english = { key, html: await englishPage(SITE) };
  return english.html;
}

// ----------------------------------------------------------------- the version

// The latest release is written into the page. A release is not an event the
// server hears about, so the number is asked for every ten minutes instead.
const RELEASES = "https://api.github.com/repos/znackarna/volocal/releases/latest";
const FRESH = 10 * 60_000;
const RETRY = 60_000;

let known = null;
let nextCheck = 0;
let pending = null;

function refresh() {
  pending ??= (async () => {
    try {
      const response = await fetch(RELEASES, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "volocal-site-server" },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { tag_name: tag } = await response.json();
      if (typeof tag !== "string" || !/^v?\d+\.\d+\.\d+$/.test(tag)) throw new Error(`unexpected tag ${tag}`);
      known = tag.replace(/^v/, "");
      nextCheck = Date.now() + FRESH;
    } catch (error) {
      console.error("version: the latest release could not be read:", error.message);
      nextCheck = Date.now() + RETRY;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

async function latestRelease() {
  if (Date.now() >= nextCheck) {
    const asking = refresh();
    // Once a number is known, readers get it at once and the next one arrives
    // in the background; only the very first reader waits for GitHub.
    if (known === null) await asking;
  }
  return known;
}

async function stamp(html, lang) {
  const version = await latestRelease();
  // GitHub unreachable since the process started: the number the file carries,
  // which is a real version rather than a placeholder.
  if (version === null) return html;
  const { html: stamped, found } = stampVersion(html, lang, version);
  if (found === 2) return stamped;
  console.error(`version: ${found} mentions in the ${lang} page, expected 2; served as written`);
  return html;
}
