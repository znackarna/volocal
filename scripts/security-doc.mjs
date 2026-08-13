#!/usr/bin/env node
/** Refuses a SECURITY.md that no longer describes this repository.
 *
 *  The document has gone stale twice. On 10 August it said the webview has no
 *  Content Security Policy, three days after one was added. On 13 August it
 *  still said nothing is compared against a checksum, after the components had
 *  been pinned with digests — and a pass through the file the day before had
 *  removed version numbers without reading what surrounded them.
 *
 *  Both times the wrong sentence was checkable by machine, which is what this
 *  is. It does not read the prose; it checks the handful of claims that quote
 *  something the code decides, and the structure that keeps the two languages
 *  saying the same thing.
 *
 *    node scripts/security-doc.mjs
 *
 *  Runs as a step of `npm run build`, beside `i18n:check`, for the same reason:
 *  a promise this project makes to whoever is deciding whether to trust it
 *  should not depend on somebody remembering.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const documentPath = join(root, "SECURITY.md");
const document = readFileSync(documentPath, "utf8");
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const components = JSON.parse(readFileSync(join(root, "src-tauri", "components.json"), "utf8"));

const problems = [];
const fail = (claim, reality) => problems.push({ claim, reality });

// ------------------------------------------------------------------ the CSP

/** The policy is quoted in the document, wrapped for page width, once in each
 *  language. A quotation is the claim most worth checking, because it is the
 *  one that looks verifiable and is copied by hand. */
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const quoted = [...document.matchAll(/```\n(default-src[\s\S]*?)```/g)].map((match) =>
  collapse(match[1]),
);
const policy = collapse(config.app.security.csp ?? "");

if (quoted.length !== 2) {
  fail(
    `politika CSP je v dokumentu ${quoted.length}×`,
    "má tam být dvakrát, česky i anglicky",
  );
}
for (const [index, block] of quoted.entries()) {
  if (block !== policy) {
    fail(
      `${index + 1}. opis CSP nesouhlasí s tauri.conf.json`,
      `konfigurace říká:\n    ${policy}\n  dokument říká:\n    ${block}`,
    );
  }
}

// --------------------------------------------------- what the webview may read

/** `scope: []` is the sentence a reader relies on most: the webview may read
 *  nothing until one file is opened for it. */
const scope = config.app.security.assetProtocol?.scope ?? [];
const scopeSaid = (document.match(/"assetProtocol": \{ "scope": \[\] \}/g) ?? []).length;
if (scope.length === 0 && scopeSaid !== 2) {
  fail(
    `věta o prázdném rozsahu asset protokolu je v dokumentu ${scopeSaid}×`,
    "má tam být dvakrát, česky i anglicky",
  );
}
if (scope.length > 0) {
  fail(
    "dokument tvrdí, že webview nesmí číst nic",
    `tauri.conf.json dává asset protokolu rozsah ${JSON.stringify(scope)}`,
  );
}

// ------------------------------------------------------------- the digests

/** How many components carry a digest read from their publisher. The document
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
  fail(
    `${digested} z ${total} součástí má otisk`,
    "ta čísla nejsou v tabulce slov v scripts/security-doc.mjs — doplň je",
  );
} else {
  const czech = `${CZECH[digested][0]} z ${CZECH[total][1]}`;
  const english = `${ENGLISH[digested]} of the ${ENGLISH[total]}`;
  const has = (phrase) => document.toLowerCase().includes(phrase.toLowerCase());
  if (!has(czech)) {
    fail(`česká věta o počtu otisků`, `components.json dnes říká „${czech}"`);
  }
  if (!has(english)) {
    fail(`anglická věta o počtu otisků`, `components.json dnes říká "${english}"`);
  }
}

// ------------------------------------------------- files the document names

/** A renamed file leaves the sentence about it standing. `whisp.db` outlived
 *  its rename by a day inside a CI step that was waiting for it. */
const topLevel = new Set(readdirSync(root));
const paths = new Set(
  [...document.matchAll(/`([\w.-]+(?:\/[\w.-]+)*)`/g)]
    .map((match) => match[1])
    .filter((candidate) => candidate.includes("/"))
    .filter((candidate) => topLevel.has(candidate.split("/")[0])),
);
for (const path of paths) {
  if (!existsSync(join(root, path))) {
    fail(`dokument jmenuje \`${path}\``, "takový soubor v repozitáři není");
  }
}

// ------------------------------------------------- tests the document names

/** A claim anchored to a test is only as good as the test still being there. */
function rustSources(directory, found = []) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) rustSources(path, found);
    else if (name.endsWith(".rs")) found.push(readFileSync(path, "utf8"));
  }
  return found;
}
const rust = rustSources(join(root, "src-tauri", "src")).join("\n");
const named = new Set(
  [...document.matchAll(/`([a-z][a-z0-9_]*)`/g)]
    .map((match) => match[1])
    .filter((candidate) => (candidate.match(/_/g) ?? []).length >= 3),
);
for (const test of named) {
  if (!rust.includes(`fn ${test}(`)) {
    fail(`dokument se odvolává na test \`${test}\``, "takový test v src-tauri/src není");
  }
}

// ------------------------------------------------------ the two halves match

/** The failure this document is most prone to: one half edited, the other left
 *  saying yesterday's thing. */
const czechHalf = document.slice(document.indexOf("## ČESKY"), document.indexOf("## ENGLISH"));
const englishHalf = document.slice(document.indexOf("## ENGLISH"));
const findings = (half) => (half.match(/^\*\*\d+\./gm) ?? []).length;
const headings = (half) => (half.match(/^### /gm) ?? []).length;

if (findings(czechHalf) !== findings(englishHalf)) {
  fail(
    "poloviny nemají stejný počet číslovaných nálezů",
    `česky ${findings(czechHalf)}, anglicky ${findings(englishHalf)}`,
  );
}
if (headings(czechHalf) !== headings(englishHalf)) {
  fail(
    "poloviny nemají stejný počet nadpisů",
    `česky ${headings(czechHalf)}, anglicky ${headings(englishHalf)}`,
  );
}

// ---------------------------------------------------------------- the verdict

/** 1 cesta, 2 cesty, 5 cest. The summary is read by a Czech reader, and a
 *  count of one is the case a bare plural gets wrong. */
const plural = (count, one, few, many) =>
  `${count} ${count === 1 ? one : count < 5 ? few : many}`;

if (problems.length === 0) {
  console.log(
    `SECURITY.md odpovídá kódu: CSP, rozsah asset protokolu, ${digested} z ${total} otisků, ` +
      `${plural(paths.size, "cesta", "cesty", "cest")}, ` +
      `${plural(named.size, "test", "testy", "testů")}, obě poloviny stejného tvaru.`,
  );
  process.exit(0);
}

console.error(`SECURITY.md tvrdí ${problems.length}× něco, co repozitář vyvrací:\n`);
for (const { claim, reality } of problems) {
  console.error(`  ${claim}`);
  console.error(`  → ${reality}\n`);
}
console.error("Oprav dokument, ne kontrolu — a obě jazykové poloviny současně.");
process.exit(1);
