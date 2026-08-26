/* The English page, made from the Czech one.
 *
 * `index.html` is the page. This reads it, swaps every piece of visible text
 * for the English in `en.json`, and writes the result somewhere else. Nothing
 * about the layout is duplicated, so a change to the page is a change to one
 * file and the English follows.
 *
 *   node docs/site/translate.mjs out/en/index.html   write the English page
 *   node docs/site/translate.mjs --check             say whether it could
 *   node docs/site/translate.mjs --extract           print the missing pairs
 *
 * `--check` runs in `npm run docs:check`, so a Czech sentence with no English
 * beside it stops a build rather than reaching a reader in the wrong language.
 * The other direction is checked too: an entry nobody uses is one the page has
 * moved past, and it is reported instead of sitting there looking translated.
 *
 * Keys are the Czech sentences themselves. There is no `data-t` on anything and
 * that is the trade: the markup stays a page rather than a template, and
 * rewriting a Czech sentence orphans its translation -- loudly, which is the
 * half that matters. Inline markup splits a sentence into a key per piece; the
 * pieces are what the file holds.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(here, "index.html");
const DICTIONARY = resolve(here, "en.json");

/* Attributes a reader can end up hearing or seeing. `content` is only the
   description meta -- every other `content` on the page is a machine's. */
const ATTRIBUTES = ["aria-label", "title", "alt", "placeholder"];

/* One escape hatch, for the one place keying by sentence cannot work: the words
   of the invented transcript are a `<span>` each, so `si` is a key that would
   have to be the same word in three sentences that do not share one. Those
   spans carry their English on themselves in `data-en`, which is used instead
   of the dictionary and does not survive into the page. */
const OVERRIDE = "data-en";

/* The version is written into two sentences and moves every release. Keyed as
   it stands, each release would orphan its own translation on the day it went
   out. So a number takes its place while the sentence is looked up, and the
   real ones come back in the order they were found. */
const VERSION = /\d+\.\d+\.\d+/g;

/* The English page is served a directory deeper, so what the Czech page finds
   beside itself is one level up from there. The stylesheet, the scripts and the
   four fonts are the whole of it -- copying them into `en/` as well would put
   600 kB of the same fonts on the site twice. */
const ASSETS = [
  ['href="brand.css"', 'href="../brand.css"'],
  ['href="app-shot.css"', 'href="../app-shot.css"'],
  ['src="brand.js"', 'src="../brand.js"'],
  ['src="chibi.js"', 'src="../chibi.js"'],
  ['src="preview.js"', 'src="../preview.js"'],
  ["url(fonts/", "url(../fonts/"],
];

/* What the page says about itself, and the two links that point at the other
   language. These are not sentences, so they are named rather than looked up. */
const HEAD_SWAPS = [
  ['<html lang="cs"', '<html lang="en"'],
  ['rel="canonical" href="https://volocal.app/"',
   'rel="canonical" href="https://volocal.app/en/"'],
  ['<a class="lang-switch" href="en/" hreflang="en" lang="en">English</a>',
   '<a class="lang-switch" href="../" hreflang="cs" lang="cs">Česky</a>'],
];

const hasLetters = (text) => /[A-Za-zÀ-ž]/.test(text);

/* One pass over the file, in the shape a browser reads it: comments and
   scripts are carried through untouched, tags are opened for their attributes,
   and everything between them is text somebody reads. */
function walk(html, onText, onAttribute) {
  let out = "";
  let i = 0;
  /* What the last opened tag said its English was, if it said anything. A tag
     and the text inside it are two steps of this loop, so the override has to
     wait here for the step that uses it. */
  let override = null;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i);
      const stop = end === -1 ? html.length : end + 3;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    const opening = /^<(script|style)\b/i.exec(html.slice(i, i + 8));
    if (opening) {
      const close = html.toLowerCase().indexOf(`</${opening[1].toLowerCase()}>`, i);
      const stop = close === -1 ? html.length : close + opening[1].length + 3;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      const stop = end === -1 ? html.length : end + 1;
      const tag = html.slice(i, stop);
      const said = new RegExp(`${OVERRIDE}="([^"]*)"`).exec(tag);
      override = said ? said[1] : null;
      out += onAttribute(tag.replace(new RegExp(`\s*${OVERRIDE}="[^"]*"`), ""));
      i = stop;
      continue;
    }
    const next = html.indexOf("<", i);
    const stop = next === -1 ? html.length : next;
    out += onText(html.slice(i, stop), override);
    override = null;
    i = stop;
  }
  return out;
}

/* The whitespace around a sentence belongs to the layout, not to the sentence:
   it is put back exactly as it was so the file's own shape survives. */
function translateText(chunk, lookup, override) {
  const text = chunk.trim();
  if (!text || !hasLetters(text)) return chunk;
  const english = override === null || override === undefined ? lookup(text) : override;
  if (english === null) return chunk;
  const start = chunk.slice(0, chunk.indexOf(text[0]));
  const end = chunk.slice(chunk.lastIndexOf(text[text.length - 1]) + 1);
  return start + english + end;
}

function translateTag(tag, lookup) {
  if (!/^<[a-zA-Z]/.test(tag)) return tag;
  return tag.replace(/([a-zA-Z-]+)="([^"]*)"/g, (whole, name, value) => {
    const translatable =
      ATTRIBUTES.includes(name) ||
      (name === "content" && /name="description"/.test(tag)) ||
      (name === "href" && value.startsWith("mailto:"));
    if (!translatable || !hasLetters(value)) return whole;
    const english = lookup(value);
    return english === null ? whole : `${name}="${english}"`;
  });
}

function build(html, dictionary, seen, missing) {
  const lookup = (text) => {
    const numbers = text.match(VERSION) ?? [];
    const key = numbers.length ? text.replace(VERSION, "{version}") : text;
    if (Object.prototype.hasOwnProperty.call(dictionary, key)) {
      seen.add(key);
      let english = dictionary[key];
      for (const number of numbers) english = english.replace("{version}", number);
      return english;
    }
    missing.add(key);
    return null;
  };
  let out = walk(
    html,
    (chunk, override) => translateText(chunk, lookup, override),
    (tag) => translateTag(tag, lookup)
  );
  for (const [from, to] of [...HEAD_SWAPS, ...ASSETS]) {
    if (!out.includes(from)) {
      throw new Error(`The page no longer carries: ${from}`);
    }
    out = out.split(from).join(to);
  }
  return out;
}

const page = readFileSync(PAGE, "utf8");
let dictionary = {};
try {
  dictionary = JSON.parse(readFileSync(DICTIONARY, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const seen = new Set();
const missing = new Set();
const english = build(page, dictionary, seen, missing);
const orphans = Object.keys(dictionary).filter((key) => !seen.has(key));

const mode = process.argv[2];

if (mode === "--extract") {
  const skeleton = {};
  for (const text of missing) skeleton[text] = "";
  process.stdout.write(JSON.stringify(skeleton, null, 2) + "\n");
  process.exit(0);
}

if (mode === "--check") {
  if (missing.size === 0 && orphans.length === 0) {
    console.log(
      `Anglická stránka je celá: ${seen.size} vět a popisků má svůj překlad a žádný nepřebývá.`
    );
    process.exit(0);
  }
  if (missing.size) {
    console.error(`\nBez překladu (${missing.size}) — doplňte do docs/site/en.json:`);
    for (const text of missing) console.error(`  ${JSON.stringify(text)}`);
  }
  if (orphans.length) {
    console.error(`\nPřeklad bez české věty (${orphans.length}) — stránka se změnila:`);
    for (const text of orphans) console.error(`  ${JSON.stringify(text)}`);
  }
  console.error("");
  process.exit(1);
}

if (!mode) {
  console.error("Kam se má anglická stránka zapsat? Například:");
  console.error("  node docs/site/translate.mjs docs/site/en/index.html");
  process.exit(1);
}

if (missing.size) {
  console.error(`${missing.size} vět nemá překlad. Spusťte --check a doplňte je.`);
  process.exit(1);
}

const target = resolve(process.cwd(), mode);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, english, "utf8");
console.log(`${target} — ${seen.size} přeložených vět a popisků.`);
