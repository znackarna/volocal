#!/usr/bin/env node
/** Refuses a document that names something this repository does not have.
 *
 *  Three documents were caught describing a repository that had moved, in one
 *  week. `SECURITY.md` said the webview has no Content Security Policy three
 *  days after one was added, and said nothing is compared against a checksum
 *  after the components had been pinned. Then `CLAUDE.md` — the file a new
 *  screen is supposed to inherit its values from rather than re-invent them —
 *  turned out to be citing `.pole`, `--pozadi` and `.segment-akce`, none of
 *  which had existed for days.
 *
 *  A rule citing a selector nobody can find is a rule nobody can follow, which
 *  is worse than no rule: it is read as authority.
 *
 *    node scripts/docs-check.mjs
 *
 *  Two kinds of check. Every rule-stating document has its *references*
 *  verified — paths, CSS classes, custom properties, Rust tests. `SECURITY.md`
 *  additionally has the four claims that quote configuration compared against
 *  it.
 *
 *  Runs as a step of `npm run build`, beside `i18n:check`, for the same reason:
 *  a promise this project makes should not depend on somebody remembering.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

/** Every document that states rules about the code. A document not listed here
 *  is prose somebody reads once; these are read as instructions. */
const DOCUMENTS = ["CLAUDE.md", "SECURITY.md", "SECURITY.cs.md", "ARCHITECTURE.md", "CONTRIBUTING.md"];

const problems = [];
const fail = (where, claim, reality) => problems.push({ where, claim, reality });

// -------------------------------------------------------------- what is here

const topLevel = new Set(readdirSync(root));

function rustSources(directory, found = []) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) rustSources(path, found);
    else if (name.endsWith(".rs")) found.push(readFileSync(path, "utf8"));
  }
  return found;
}
const rust = rustSources(join(root, "src-tauri", "src")).join("\n");

const stylesheets = readdirSync(join(root, "src", "css"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => read("src", "css", name))
  .concat(read("src", "styles.css"))
  .join("\n");

/** A class the stylesheet actually paints, and a custom property it defines.
 *  Reading the declaration rather than any mention: `--ground` used in a
 *  `var()` and never defined is the failure the visual system warns about. */
const painted = new Set(
  [...stylesheets.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((match) => match[1]),
);
const defined = new Set(
  [...stylesheets.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
);

/** `.db`, `.rs`, `.sha256` are file extensions wearing a class's shape. The
 *  documents talk about files at least as often as about selectors. */
const EXTENSIONS = new Set(
  ("db exe dll rs ts tsx css mjs js json md bin zip txt yml yaml svg png sha256 " +
    "bak wav mp3 m4a onnx toml lock ps1 html cmd").split(" "),
);

// ------------------------------------------- references, in every document

for (const name of DOCUMENTS) {
  const text = read(name);
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);

  // Paths. A first segment that is not a top-level entry of this repository is
  // a URL fragment or an example, not a claim about a file here. `YYYY-MM-DD`
  // is a shape somebody is told to write, not a file anybody can open.
  for (const span of new Set(spans)) {
    const path = span.trim();
    if (!/^[\w.-]+(\/[\w.-]+)+$/.test(path)) continue;
    if (!topLevel.has(path.split("/")[0])) continue;
    if (/YYYY|MM-DD|[<>*]/.test(path)) continue;
    if (!existsSync(join(root, path))) {
      fail(name, `jmenuje \`${path}\``, "takový soubor v repozitáři není");
    }
  }

  // The visual system is CLAUDE.md's, and so are the two kinds of name that
  // belong to it. Read everywhere, `.github` is a class and `--strict` is a
  // token; read here, they are what they look like.
  if (name === "CLAUDE.md") {
    // CSS classes, taken from anywhere in the span, so `.dialog h2 + p` is
    // three words and one class, and `.pole input…` is one class and a word.
    for (const span of new Set(spans)) {
      if (!span.startsWith(".") || span.includes("/")) continue;
      for (const [, className] of span.matchAll(/\.([a-z][a-z0-9-]*)/g)) {
        if (EXTENSIONS.has(className)) continue;
        if (!painted.has(className)) {
          fail(name, `pravidlo cituje \`.${className}\``, "žádné CSS pravidlo tu třídu nemá");
        }
      }
    }

    // Custom properties, which fail silently: an undefined `var()` does not
    // break loudly, it drops the declaration.
    for (const span of new Set(spans)) {
      for (const [, token] of span.matchAll(/(--[a-z0-9-]+)/g)) {
        if (!defined.has(token)) {
          fail(name, `pravidlo cituje \`${token}\``, "takový token není v :root definovaný");
        }
      }
    }
  }

  // Rust tests. A claim anchored to a test is worth what the test still being
  // there is worth.
  for (const span of new Set(spans)) {
    if (!/^[a-z][a-z0-9_]*$/.test(span)) continue;
    if ((span.match(/_/g) ?? []).length < 3) continue;
    if (!rust.includes(`fn ${span}(`)) {
      fail(name, `odvolává se na test \`${span}\``, "takový test v src-tauri/src není");
    }
  }
}

// ------------------------------- what SECURITY.md quotes from the configuration

const security = read("SECURITY.md");
const securityCs = read("SECURITY.cs.md");
const config = JSON.parse(read("src-tauri", "tauri.conf.json"));
const components = JSON.parse(read("src-tauri", "components.json"));

/** The policy is quoted in each half of the pair, wrapped for page width. A
 *  quotation is the claim most worth checking, because it is the one that looks
 *  verifiable and is copied by hand. */
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const policy = collapse(config.app.security.csp ?? "");

for (const [file, text] of [["SECURITY.md", security], ["SECURITY.cs.md", securityCs]]) {
  const quoted = [...text.matchAll(/```\n(default-src[\s\S]*?)```/g)].map((match) =>
    collapse(match[1]),
  );
  if (quoted.length !== 1) {
    fail(file, `politika CSP je v dokumentu ${quoted.length}×`, "má tam být jednou");
  }
  for (const block of quoted) {
    if (block !== policy) {
      fail(
        file,
        "opis CSP nesouhlasí s tauri.conf.json",
        `konfigurace říká:\n    ${policy}\n  dokument říká:\n    ${block}`,
      );
    }
  }
}

/** `scope: []` is the sentence a reader relies on most: the webview may read
 *  nothing until one file is opened for it. */
const scope = config.app.security.assetProtocol?.scope ?? [];
for (const [file, text] of [["SECURITY.md", security], ["SECURITY.cs.md", securityCs]]) {
  const said = (text.match(/"assetProtocol": \{ "scope": \[\] \}/g) ?? []).length;
  if (scope.length === 0 && said !== 1) {
    fail(file, `věta o prázdném rozsahu asset protokolu je v dokumentu ${said}×`, "má tam být jednou");
  }
}
if (scope.length > 0) {
  fail("SECURITY.md", "tvrdí, že webview nesmí číst nic", `tauri.conf.json dává asset protokolu rozsah ${JSON.stringify(scope)}`);
}

/** How many components carry a digest read from their publisher. Each document
 *  says the two numbers in words, so the words are what this compares. */
const entries = Object.entries(components).filter(([key]) => !key.startsWith("$"));
const total = entries.length;
const digested = entries.filter(([, entry]) => entry.sha256).length;

const CZECH = {
  13: ["třináct", "třinácti"],
  14: ["čtrnáct", "čtrnácti"],
  15: ["patnáct", "patnácti"],
  16: ["šestnáct", "šestnácti"],
  17: ["sedmnáct", "sedmnácti"],
  18: ["osmnáct", "osmnácti"],
  19: ["devatenáct", "devatenácti"],
  20: ["dvacet", "dvaceti"],
};
const ENGLISH = {
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
};

if (!CZECH[digested] || !CZECH[total] || !ENGLISH[digested] || !ENGLISH[total]) {
  fail("SECURITY.md", `${digested} z ${total} součástí má otisk`, "ta čísla nejsou v tabulce slov v scripts/docs-check.mjs — doplň je");
} else {
  const czech = `${CZECH[digested][0]} z ${CZECH[total][1]}`;
  const english = `${ENGLISH[digested]} of the ${ENGLISH[total]}`;
  const has = (text, phrase) => text.toLowerCase().includes(phrase.toLowerCase());
  if (!has(securityCs, czech)) fail("SECURITY.cs.md", "věta o počtu otisků", `components.json dnes říká „${czech}"`);
  if (!has(security, english)) fail("SECURITY.md", "věta o počtu otisků", `components.json dnes říká "${english}"`);
}

/** The failure this pair is most prone to: one language edited, the other left
 *  saying yesterday's thing. Same for the READMEs, which are the same shape. */
const findings = (text) => (text.match(/^\*\*\d+\./gm) ?? []).length;
// Every heading below the title, whatever its level: SECURITY uses three
// hashes and the READMEs two, and counting only one of them made the
// README pair compare nought with nought.
const headings = (text) => (text.match(/^#{2,} /gm) ?? []).length;

for (const [english, czech] of [["SECURITY.md", "SECURITY.cs.md"], ["README.md", "README.cs.md"]]) {
  const a = read(english);
  const b = read(czech);
  if (findings(a) !== findings(b)) {
    fail(english, `nemá stejný počet číslovaných bodů jako ${czech}`, `anglicky ${findings(a)}, česky ${findings(b)}`);
  }
  if (headings(a) !== headings(b)) {
    fail(english, `nemá stejný počet nadpisů jako ${czech}`, `anglicky ${headings(a)}, česky ${headings(b)}`);
  }
}

/** 1 dokument, 2 dokumenty, 5 dokumentů. A count of one is the case a bare
 *  plural gets wrong. */
const plural = (count, one, few, many) => `${count} ${count === 1 ? one : count < 5 ? few : many}`;
const records = (count) => plural(count, "záznam", "záznamy", "záznamů");

// --------------------------------------------- the change log against itself

/** `docs/history/README.md` is an index, and an index that disagrees with what
 *  it indexes is worse than none: the count is what somebody reads to decide
 *  whether a day is worth opening.
 *
 *  It had drifted on eight of twenty-seven days by 31 August, and the shape of
 *  the drift says how: two sessions writing the same week both added a row, so
 *  19 and 20 August had two rows each with different counts, 24 August had none
 *  at all, and four more had a number from before the day was finished.
 *
 *  Counting `### ` outside code fences, because a heading in an example is not
 *  an entry. */
const historyDirectory = join(root, "docs", "history");
const days = readdirSync(historyDirectory)
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
  .sort();

const entriesIn = (text) => {
  let fenced = false;
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && line.startsWith("### ")) count += 1;
  }
  return count;
};

const index = read("docs", "history", "README.md");
const rows = new Map();
const twice = [];
for (const [, day, claimed] of index.matchAll(/^\| \[(\d{4}-\d{2}-\d{2})\]\([^)]*\) \| (\d+) \|/gm)) {
  if (rows.has(day)) twice.push(day);
  else rows.set(day, Number(claimed));
}

for (const day of twice) {
  fail("docs/history/README.md", `má na ${day} víc než jeden řádek`, "dva sešly z různých sezení — nech jeden");
}

for (const name of days) {
  const day = name.slice(0, -3);
  const real = entriesIn(read("docs", "history", name));
  if (!rows.has(day)) {
    fail("docs/history/README.md", `nemá řádek na ${day}`, `${name} přitom existuje a má ${records(real)}`);
  } else if (rows.get(day) !== real) {
    fail("docs/history/README.md", `říká o ${day}, že má ${records(rows.get(day))}`, `${name} jich má ${real}`);
  }
}

for (const day of rows.keys()) {
  if (!days.includes(`${day}.md`)) {
    fail("docs/history/README.md", `odkazuje na ${day}`, `docs/history/${day}.md tu není`);
  }
}

const listed = [...rows.keys()];
const ordered = [...listed].sort();
if (listed.join() !== ordered.join()) {
  fail("docs/history/README.md", "nemá dny v pořadí", "řádky se při souběžném zápisu zamíchaly — seřaď je podle data");
}

// ---------------------------------------------------------------- the verdict

if (problems.length === 0) {
  console.log(
    `${plural(DOCUMENTS.length, "dokument odpovídá", "dokumenty odpovídají", "dokumentů odpovídá")} kódu: ` +
      `cesty, třídy, tokeny a testy, které jmenují, existují; ` +
      `SECURITY.md a SECURITY.cs.md navíc sedí na CSP, rozsah asset protokolu a ${digested} z ${total} otisků.`,
  );
  process.exit(0);
}

console.error(`Dokumentace ${problems.length}× jmenuje něco, co repozitář nemá:\n`);
for (const { where, claim, reality } of problems) {
  console.error(`  ${where} ${claim}`);
  console.error(`  → ${reality}\n`);
}
console.error("Oprav dokument, ne kontrolu — a u dvojjazyčných obojí najednou.");
process.exit(1);
