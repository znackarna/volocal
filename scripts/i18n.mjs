#!/usr/bin/env node
/** Translation pipeline.
 *
 *  Czech is the source language and lives in `src/locales/cs/`. Other languages
 *  are produced in bulk outside this repository, so the useful unit of work is
 *  one flat file of everything still untranslated, not a hand-edited module.
 *
 *    node scripts/i18n.mjs check           refuse anything that would skip translation
 *    node scripts/i18n.mjs new <namespace> scaffold a dictionary for a new screen
 *    node scripts/i18n.mjs sync            rebuild index.ts and the missing language stubs
 *    node scripts/i18n.mjs export en       write i18n/en.todo.json for a translator
 *    node scripts/i18n.mjs import en file  fold a translated file back into src/locales/en/
 *    node scripts/i18n.mjs approve en      record that English matches today's Czech
 *
 *  `check` runs as the first step of `npm run build`, so a new screen cannot
 *  reach a release with its text still written into the components.
 *
 *  The export carries the translator notes from every `*Context` map, because a
 *  bare `Model` or `Kontrola` cannot be translated from the word alone.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "src", "locales");
const exportDir = join(root, "i18n");

const capitalize = (name) => name[0].toUpperCase() + name.slice(1);

const namespaces = readdirSync(join(localesDir, "cs"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => name.slice(0, -3))
  .sort();

/** Reads one dictionary module without running it.
 *
 *  A regex is enough and deliberate: the alternative is compiling TypeScript
 *  just to read a list of string literals, and these files are generated and
 *  checked by `tsc` anyway. Entries must therefore stay on the plain
 *  `"key": "value",` shape — anything computed is reported by `check`.
 */
function readModule(path) {
  if (!existsSync(path)) return { entries: {}, notes: {} };
  const source = readFileSync(path, "utf8");
  const contextAt = source.search(/^export const \w+Context/m);
  const body = contextAt === -1 ? source : source.slice(0, contextAt);
  const notesBody = contextAt === -1 ? "" : source.slice(contextAt);

  const collect = (text) => {
    const found = {};
    const pattern = /^\s{2}"((?:[^"\\]|\\.)+)":\s*("(?:[^"\\]|\\.)*"(?:\s*\+\s*\n?\s*"(?:[^"\\]|\\.)*")*)\s*,?\s*$/gm;
    for (const match of text.matchAll(pattern)) {
      // Long values are wrapped as "a" + "b" by the formatter; rejoin them.
      // Split on the literals, not on `+`, because a value may contain one.
      const value = [...match[2].matchAll(/"(?:[^"\\]|\\.)*"/g)]
        .map((literal) => JSON.parse(literal[0]))
        .join("");
      found[JSON.parse(`"${match[1]}"`)] = value;
    }
    return found;
  };

  return { entries: collect(body), notes: collect(notesBody) };
}

function load(language) {
  const entries = {};
  const notes = {};
  const owner = {};
  for (const namespace of namespaces) {
    const module = readModule(join(localesDir, language, `${namespace}.ts`));
    for (const [key, value] of Object.entries(module.entries)) {
      entries[key] = value;
      owner[key] = namespace;
    }
    Object.assign(notes, module.notes);
  }
  return { entries, notes, owner };
}

function languages() {
  return readdirSync(localesDir).filter(
    (name) => name !== "cs" && statSync(join(localesDir, name)).isDirectory()
  );
}

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];
const CLDR_FORMS = {
  en: ["one", "other"],
  de: ["one", "other"],
  fr: ["one", "many", "other"],
  pl: ["one", "few", "many", "other"],
  sk: ["one", "few", "many", "other"],
};

function pluralBase(key) {
  const dot = key.lastIndexOf(".");
  if (dot === -1) return null;
  return PLURAL_SUFFIXES.includes(key.slice(dot + 1)) ? key.slice(0, dot) : null;
}

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

// ------------------------------------------------- staleness of a translation

/** What a translation was written against.
 *
 *  Everything else here can be derived from the files. This cannot: a
 *  translation that no longer matches its source is indistinguishable from one
 *  that does, because both are a present, non-empty string under a key that
 *  exists. Twenty-nine of them accumulated before anyone read the two languages
 *  side by side. So the Czech value is fingerprinted at the moment a
 *  translation is accepted, and `check` compares that fingerprint with the
 *  Czech of today.
 *
 *  One file for every language, beside the dictionaries. `languages()` lists
 *  directories and `namespaces` reads only `cs/*.ts`, so a JSON file here is
 *  not mistaken for either.
 */
const sourcesPath = join(localesDir, "sources.json");

const fingerprint = (value) => createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);

function readSources() {
  if (!existsSync(sourcesPath)) return {};
  try {
    return JSON.parse(readFileSync(sourcesPath, "utf8"));
  } catch {
    console.log(`${sourcesPath} nejde přečíst — beru to, jako by nic zapsané nebylo`);
    return {};
  }
}

function writeSources(all) {
  const ordered = {};
  for (const language of Object.keys(all).sort()) {
    ordered[language] = {};
    for (const key of Object.keys(all[language]).sort()) ordered[language][key] = all[language][key];
  }
  writeFileSync(sourcesPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

/** Records today's Czech as what `language` was translated from.
 *
 *  With no keys named it accepts every key that language currently translates,
 *  which is the one-time baseline and the thing to run after a translation
 *  round. With keys named it accepts only those — for the case where Czech was
 *  reworded and the existing English already says the new thing.
 */
function approve(language, keys) {
  const source = load("cs");
  const target = load(language);
  const all = readSources();
  const recorded = { ...(all[language] ?? {}) };
  const chosen = keys.length ? keys : Object.keys(target.entries);
  let written = 0;
  for (const key of chosen) {
    if (!(key in target.entries)) {
      console.log(`přeskočeno — ${language} tenhle klíč nepřekládá: ${key}`);
      continue;
    }
    if (!(key in source.entries)) {
      console.log(`přeskočeno — klíč není ve zdroji: ${key}`);
      continue;
    }
    recorded[key] = fingerprint(source.entries[key]);
    written += 1;
  }
  all[language] = recorded;
  writeSources(all);
  console.log(`${language}: zapsáno ${written} otisků do src/locales/sources.json`);
}

function usedKeys() {
  const used = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "locales") walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/\b(?:t|tPlural)\(\s*"([^"]+)"/g)) used.add(match[1]);
      for (const match of source.matchAll(/"((?:common|app|library|detail|settings|wizard|domain|dialogs|player|errors|progress|catalog)\.[\w.\-@]+)"/g))
        used.add(match[1]);
    }
  };
  walk(join(root, "src"));
  return used;
}

// ------------------------------------------------- source scanning

/** Blanks out comments so a scanner only sees live code.
 *
 *  Offsets are preserved, so a line number computed afterwards still points at
 *  the real line. Regular-expression literals are not tracked; the cost of
 *  getting that right is not worth it here, and a `/` inside a string is
 *  already handled because strings are.
 */
function withoutComments(source) {
  const out = source.split("");
  let index = 0;
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      const stop = source.indexOf("\n", index);
      blank(index, stop === -1 ? source.length : stop);
      index = stop === -1 ? source.length : stop;
    } else if (two === "/*") {
      const stop = source.indexOf("*/", index + 2);
      blank(index, stop === -1 ? source.length : stop + 2);
      index = stop === -1 ? source.length : stop + 2;
    } else if (two[0] === '"' || two[0] === "'" || two[0] === "`") {
      const quote = two[0];
      index++;
      while (index < source.length && source[index] !== quote) {
        index += source[index] === "\\" ? 2 : 1;
      }
      index++;
    } else {
      index++;
    }
  }
  return out.join("");
}

const CZECH_LETTER = /[ěščřžýáíéúůťďňóĚŠČŘŽÝÁÍÉÚŮŤĎŇÓ]/;

/** Text that is only punctuation, digits, or a symbol is not a sentence.
 *  A glyph such as `—`, `·`, `×`, or `✎` may stay in the markup. */
const NOT_A_SENTENCE = /^[^\p{L}]*$/u;

/** A test file is not a screen. Its strings are read by whoever runs the tests
 *  and by nobody else, and the ones that check Czech text handling — stripping
 *  diacritics so `reknu` finds `řeknu` — have to *be* Czech to mean anything.
 *  Putting them in the dictionary would offer them for translation, which is
 *  the opposite of what they are for. */
const isTest = (name) => /\.test\.tsx?$/.test(name);

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "locales") walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !isTest(entry.name)) {
        files.push(path);
      }
    }
  };
  walk(join(root, "src"));
  return files.sort();
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/** Marks a literal that is deliberately not translated: a file name, a key on
 *  the keyboard, a fallback for a value the dictionary already holds. Write it
 *  in a comment on the same line or the line above, with the reason. */
const IGNORE_MARKER = "i18n-ignore";

/** Finds text a reader would see that never reached the dictionary.
 *
 *  Two signals, because neither alone is enough. A Czech letter in a string
 *  literal is unambiguous but misses `Model` or `Export`. A bare text node
 *  between two tags catches those, whatever language they are written in.
 */
function hardcodedText() {
  const found = [];
  for (const file of sourceFiles()) {
    const raw = readFileSync(file, "utf8");
    const code = withoutComments(raw);
    const name = file.slice(root.length + 1).replace(/\\/g, "/");
    const lines = raw.split("\n");
    const excused = (line) =>
      (lines[line - 1] ?? "").includes(IGNORE_MARKER) ||
      (lines[line - 2] ?? "").includes(IGNORE_MARKER);
    const report = (line, text) => {
      if (!excused(line)) found.push({ file: name, line, text });
    };

    /* Scanned over the comment-blanked copy, not over the raw source. An
       apostrophe inside a comment — `the archive's root` — opens a string in
       the raw text that runs to the next quote anywhere in the file, and the
       whole span between them was reported as one literal at the wrong line.
       Blanked comments cannot start one, so the desynchronisation is gone;
       offsets are preserved, which is what keeps the line numbers right. */
    for (const match of code.matchAll(/(["'`])((?:[^\\]|\\.)*?)\1/gs)) {
      if (!CZECH_LETTER.test(match[2])) continue;
      report(lineOf(code, match.index), match[2]);
    }

    // Only text that ends at a closing tag, and only when it contains none of
    // the punctuation that marks an expression. Without both conditions a
    // generic such as `useState<string>("library")` reads as a text node.
    for (const match of code.matchAll(/>([^<>{}();=:"'`]*\p{L}[^<>{}();=:"'`]*)<\//gu)) {
      const text = match[1].trim();
      if (!text || NOT_A_SENTENCE.test(text)) continue;
      report(lineOf(code, match.index), text);
    }
  }
  return found;
}

/** Reads the balanced argument list of a call that starts at `from`. */
function argumentsAt(source, from) {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(from + 1, i);
  }
  return "";
}

/** Every code Rust can send to the window, ignoring its test modules.
 *
 *  A code does not always sit inside `UserMessage::new("…")`. It may be chosen
 *  by an `if` inside that call, or passed to a small wrapper such as `step` or
 *  `chunk_step`. Missing those was how sixteen progress captions shipped
 *  broken, so the wrappers are discovered from their own bodies rather than
 *  listed here by name.
 */
function backendCodes() {
  const codes = new Map();
  const dir = join(root, "src-tauri", "src");
  if (!existsSync(dir)) return codes;

  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".rs"))
    .map((name) => {
      const raw = readFileSync(join(dir, name), "utf8");
      // Test fixtures name codes that are never emitted; the module sits at the
      // end of each of these files, so cutting it off is enough.
      const testAt = raw.search(/^#\[cfg\(test\)\]/m);
      return { name, source: withoutComments(testAt === -1 ? raw : raw.slice(0, testAt)) };
    });

  // A wrapper is any function that hands one of its parameters straight to
  // `UserMessage::new`. Its call sites then carry the real codes.
  const wrappers = new Set();
  for (const { source } of files) {
    for (const match of source.matchAll(/\bfn\s+(\w+)\s*\(\s*(\w+)\s*:\s*&str/g)) {
      const body = source.slice(match.index, match.index + 400);
      if (new RegExp(`UserMessage::new\\(\\s*${match[2]}\\b`).test(body)) wrappers.add(match[1]);
    }
  }

  const record = (code, where) => {
    if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(code) && !codes.has(code)) {
      codes.set(code, where);
    }
  };

  for (const { name, source } of files) {
    for (const caller of ["UserMessage::new", ...wrappers]) {
      const pattern = new RegExp(`${caller.replace(/[:]/g, "\\:")}\\s*\\(`, "g");
      for (const match of source.matchAll(pattern)) {
        // The argument may be an `if`, so drop what the condition compares
        // against — `kind == "summary"` names a mode, not a message.
        const args = argumentsAt(source, match.index + match[0].length - 1).replace(
          /[=!]=\s*"[^"]*"/g,
          ""
        );
        for (const literal of args.matchAll(/"([^"\\]*)"/g)) {
          record(literal[1], `${name}:${lineOf(source, match.index)}`);
        }
      }
    }
  }
  return codes;
}

// ----------------------------------------------------------------- sync

function indexSource() {
  const imports = (language, withNotes) =>
    namespaces
      .map((namespace) => {
        const name = `${language}${capitalize(namespace)}`;
        const bound = withNotes ? `{ ${name}, ${name}Context }` : `{ ${name} }`;
        return `import ${bound} from "./${language}/${namespace}";`;
      })
      .join("\n");
  const spread = (language) =>
    namespaces.map((namespace) => `  ...${language}${capitalize(namespace)},`).join("\n");
  const notes = namespaces
    .map((namespace) => `  ...cs${capitalize(namespace)}Context,`)
    .join("\n");

  return `/** Translation dictionaries.
 *
 *  Generated by \`npm run i18n:sync\`. Add a screen with \`npm run i18n:new\`
 *  rather than editing this file; \`npm run i18n:check\` fails when it no
 *  longer matches the dictionaries on disk.
 *
 *  Czech is the source language and is always complete: \`TranslationKey\` is
 *  derived from it, so adding a key means adding it here first. Other languages
 *  are deliberately typed as partial, because translation happens in bulk and an
 *  English dictionary that had to be complete would either block that work or
 *  fill the interface with untranslated placeholders. \`useI18n().t\` falls back
 *  to Czech instead.
 *
 *  Keys are \`namespace.area.name\`. Plural forms add a CLDR category suffix
 *  (\`.one\`, \`.few\`, \`.many\`, \`.other\`) and are read through \`tPlural\`.
 *
 *  \`*Context\` maps carry translator notes for keys whose meaning is not obvious
 *  from the text alone — a bare \`Model\` or \`Kontrola\` is a coin flip without
 *  them. They are shipped to the translator by the export script and are not
 *  used at runtime.
 */
${imports("cs", true)}

${imports("en", false)}

export const cs = {
${spread("cs")}
};

export type TranslationKey = keyof typeof cs;

export const en: Partial<Record<TranslationKey, string>> = {
${spread("en")}
};

/** Translator notes, keyed exactly like the dictionaries. Build tooling only. */
export const csContext: Partial<Record<TranslationKey, string>> = {
${notes}
};

export const NAMESPACES = [
${namespaces.map((namespace) => `  "${namespace}",`).join("\n")}
] as const;

export type Namespace = (typeof NAMESPACES)[number];
`;
}

function languageStub(language, namespace) {
  const capital = capitalize(namespace);
  return (
    `import type { cs${capital} } from "../cs/${namespace}";\n\n` +
    `/** Filled by \`npm run i18n:import\`. Missing keys fall back to Czech. */\n` +
    `export const ${language}${capital}: Partial<Record<keyof typeof cs${capital}, string>> = {};\n`
  );
}

function sync({ quiet = false } = {}) {
  const indexPath = join(localesDir, "index.ts");
  const wanted = indexSource();
  let changed = 0;
  if (!existsSync(indexPath) || readFileSync(indexPath, "utf8") !== wanted) {
    writeFileSync(indexPath, wanted, "utf8");
    changed++;
    if (!quiet) console.log("index.ts přepsán");
  }
  for (const language of languages()) {
    for (const namespace of namespaces) {
      const path = join(localesDir, language, `${namespace}.ts`);
      if (existsSync(path)) continue;
      writeFileSync(path, languageStub(language, namespace), "utf8");
      changed++;
      if (!quiet) console.log(`${language}/${namespace}.ts založen`);
    }
  }
  if (!quiet && !changed) console.log("Vše je v pořádku, nic se neměnilo.");
  return changed;
}

/** Empties a language without unwiring it, so the interface falls back to
 *  Czech everywhere and the work can start again later from a clean file. */
function clearLanguage(language) {
  if (language === "cs") {
    console.log("Čeština je zdroj, tu smazat nelze.");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(join(localesDir, language))) {
    console.log(`Jazyk ${language} tu není.`);
    process.exitCode = 1;
    return;
  }
  for (const namespace of namespaces) {
    writeFileSync(join(localesDir, language, `${namespace}.ts`), languageStub(language, namespace), "utf8");
  }
  console.log(`${language} vyprázdněn — rozhraní se všude vrátí k češtině.`);
}

function createNamespace(namespace) {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(namespace)) {
    console.log("Název musí být jedno slovo bez diakritiky, například `recorder`.");
    process.exitCode = 1;
    return;
  }
  const path = join(localesDir, "cs", `${namespace}.ts`);
  if (existsSync(path)) {
    console.log(`${namespace} už existuje.`);
    process.exitCode = 1;
    return;
  }
  const capital = capitalize(namespace);
  writeFileSync(
    path,
    `/** Strings belonging to the \`${namespace}\` screen. */\n` +
      `export const cs${capital} = {\n` +
      `  // "${namespace}.area.name": "Text, který uživatel uvidí",\n` +
      `} as const;\n\n` +
      `/** Notes for the translator, for keys whose meaning the text alone does\n` +
      ` *  not carry. Leave a whole, plain sentence without one. */\n` +
      `export const cs${capital}Context: Partial<Record<keyof typeof cs${capital}, string>> = {};\n`,
    "utf8"
  );
  namespaces.push(namespace);
  namespaces.sort();
  sync({ quiet: true });
  console.log(`Založeno: src/locales/cs/${namespace}.ts a protějšky v ostatních jazycích.`);
  console.log(`Piš do něj klíče ${namespace}.oblast.nazev a čti je přes t("${namespace}.…").`);
}

// ---------------------------------------------------------------- check
/** Words that address one person informally (tykání).
 *
 *  The application speaks to the reader formally, so an imperative or a verb
 *  in the second person singular is a defect rather than a matter of taste —
 *  and it is the kind that spreads, because the next sentence is written to
 *  match the ones around it.
 */
const INFORMAL_WORDS = new Set([
  // pronouns and possessives
  "ti", "tě", "tebe", "tobě", "tebou", "tvůj", "tvoje", "tvá", "tvé", "tvého",
  "tvému", "tvým", "tvých", "tvou", "tvoji", "tvojí", "tvůjm",
  // the auxiliary and the reflexive pair that only exist in the singular
  "jsi", "sis", "ses",
  // imperatives. Only the singular forms; the plural is what we want.
  "vyber", "zvol", "nech", "nechej", "přetáhni", "pusť", "klikni", "stiskni",
  "napiš", "zadej", "vlož", "zkus", "ulož", "spusť", "přidej", "doplň",
  "otevři", "zavři", "změň", "měň", "zvyš", "sniž", "počkej", "zkontroluj",
  "použij", "vytvoř", "přesuň", "odstraň", "smaž", "přejmenuj", "nastav",
  "zapni", "vypni", "potvrď", "vrať", "opakuj", "stáhni", "najdi", "vyplň",
  "podrž", "označ", "pojmenuj", "napovídej", "přepni", "přeskoč", "vyzkoušej",
]);

/** Endings of the second person singular. Adverbs and nouns share them, so the
 *  ones that do are named rather than guessed at. */
const INFORMAL_ENDING = /(?:eš|íš|áš|ješ)$/;
const NOT_A_VERB = new Set([
  "výš", "níž", "spíš", "nejspíš", "dřív", "koš", "myš", "veš", "tíž", "blíž",
]);

/** Reports every Czech source string that speaks to one person informally.
 *
 *  Only the value maps are read. The `*Context` notes below them are written
 *  to a translator, not to the reader, and address them informally on purpose.
 */
function informalAddress() {
  const found = [];
  for (const namespace of namespaces) {
    const file = join(localesDir, "cs", `${namespace}.ts`);
    const raw = readFileSync(file, "utf8");
    const end = raw.indexOf("} as const;");
    const code = withoutComments(end > 0 ? raw.slice(0, end) : raw);
    const lines = raw.split("\n");
    for (const match of code.matchAll(/[\p{L}]+/gu)) {
      const word = match[0].toLowerCase();
      const informal =
        INFORMAL_WORDS.has(word) ||
        (INFORMAL_ENDING.test(word) && !NOT_A_VERB.has(word) && word.length > 3);
      if (!informal) continue;
      const line = lineOf(code, match.index);
      const here = lines[line - 1] ?? "";
      const above = lines[line - 2] ?? "";
      if (here.includes(IGNORE_MARKER) || above.includes(IGNORE_MARKER)) continue;
      found.push({ file: `src/locales/cs/${namespace}.ts`, line, word, text: here.trim() });
    }
  }
  return found;
}

/** The everyday check, and the one a release has to pass.
 *
 *  `strict` promotes one warning to an error: a translation whose Czech source
 *  has never been fingerprinted. Without a fingerprint there is nothing to
 *  compare the Czech against later, so `drifted` — the one check that can catch
 *  a translation left behind by a reworded source — is blind to that key
 *  forever. During a change in progress that is a note to self; in something
 *  handed to somebody it is a hole in the only guard the dictionary has.
 *
 *  The other warnings stay warnings in both modes. A key nobody uses yet and a
 *  text sitting under two keys are untidiness, not a defect a reader would
 *  meet, and a release gate that is red for a reason nobody intends to fix is
 *  a gate everybody learns to ignore.
 */
function check(strict = false) {
  const source = load("cs");
  const keys = Object.keys(source.entries);
  const used = usedKeys();
  const errors = [];
  const warnings = [];

  console.log(`Zdroj (čeština): ${keys.length} klíčů v ${namespaces.length} souborech`);
  for (const namespace of namespaces) {
    const count = keys.filter((key) => source.owner[key] === namespace).length;
    console.log(`  ${namespace.padEnd(10)} ${String(count).padStart(4)}`);
  }

  // A dictionary nobody wired up is invisible: its keys exist but the app never
  // reads them and the export never offers them.
  if (sync({ quiet: true })) {
    errors.push("index.ts neodpovídal slovníkům a byl přegenerován — zkontroluj a spusť znovu");
  }

  // Text still living in a component never reaches the export, so it would be
  // silently left in Czech in every other language.
  const hardcoded = hardcodedText();
  if (hardcoded.length) {
    errors.push(`${hardcoded.length}× text přímo v komponentě místo ve slovníku`);
    console.log("\nText, který se nedostane do překladu:");
    console.log(`  (záměrnou výjimku označ komentářem \`${IGNORE_MARKER}: důvod\`)`);
    for (const item of hardcoded.slice(0, 30)) {
      const text = item.text.length > 56 ? `${item.text.slice(0, 56)}…` : item.text;
      console.log(`  ${item.file}:${item.line}  "${text}"`);
    }
    if (hardcoded.length > 30) console.log(`  … a dalších ${hardcoded.length - 30}`);
  }

  // The interface vyká. One sentence written in tykání makes the next one
  // sound wrong whichever form it picks, so this is caught at the source.
  const informal = informalAddress();
  if (informal.length) {
    errors.push(`${informal.length}× tykání v českém textu`);
    console.log("\nTexty, které uživateli tykají:");
    console.log(`  (záměrnou výjimku označ komentářem \`${IGNORE_MARKER}: důvod\`)`);
    for (const item of informal) {
      const text = item.text.length > 64 ? `${item.text.slice(0, 64)}…` : item.text;
      console.log(`  ${item.file}:${item.line}  „${item.word}“  ${text}`);
    }
  }

  // Rust sends codes, not sentences. A code with no entry falls back to the
  // technical detail, which is the one thing the user should never read.
  const missingCodes = [...backendCodes()].filter(
    ([code]) => !(`errors.${code}` in source.entries) && !(`progress.${code}` in source.entries)
  );
  if (missingCodes.length) {
    errors.push(`${missingCodes.length}× kód z Rustu bez textu ve slovníku`);
    console.log("\nKódy z Rustu, ke kterým chybí text:");
    for (const [code, where] of missingCodes) console.log(`  ${where.padEnd(28)} ${code}`);
    console.log("  Doplň je do src/locales/cs/errors.ts nebo progress.ts.");
    console.log("  Kód se píše bez názvu slovníku: `ai.cancelled`, ne `progress.ai.cancelled`.");
  }

  // Czech needs all four forms, or a count silently prints its own key.
  const bases = new Set(keys.map(pluralBase).filter(Boolean));
  const incomplete = [];
  for (const base of bases) {
    for (const form of ["one", "few", "many", "other"]) {
      if (!(`${base}.${form}` in source.entries)) incomplete.push(`${base}.${form}`);
    }
  }
  if (incomplete.length) {
    errors.push(`${incomplete.length}× chybějící tvar množného čísla`);
    console.log("\nChybějící tvary:");
    for (const key of incomplete) console.log(`  ${key}`);
  }

  const emptyValues = keys.filter((key) => !source.entries[key].trim());
  if (emptyValues.length) {
    errors.push(`${emptyValues.length}× prázdný text ve zdrojovém slovníku`);
    console.log("\nPrázdné klíče:");
    for (const key of emptyValues) console.log(`  ${key}`);
  }

  const dynamicPrefixes = ["domain.", "catalog.", "errors.", "progress."];
  const unused = keys.filter(
    (key) =>
      !used.has(key) &&
      !pluralBase(key) &&
      !dynamicPrefixes.some((prefix) => key.startsWith(prefix))
  );
  if (unused.length) {
    warnings.push(`${unused.length} nepoužitých klíčů`);
    console.log(`\nNepoužité klíče (${unused.length}):`);
    for (const key of unused) console.log(`  ${key}`);
  }

  // Two keys with the same Czech text are usually one key that got copied.
  //
  // Listing all of them was worse than not checking. Seventy-nine came up every
  // single run — Czech plural forms that are identical on purpose, one question
  // asked from two screens, and words that merely met by accident, all in one
  // heap. A warning that is always there is not a warning, and it made the real
  // one invisible.
  //
  // The real one is drift: the same Czech sentence translated two different
  // ways, or translated in one place and forgotten in the other. That is a
  // defect a reader can see — the same button worded differently depending on
  // where they opened it — and it cannot happen without somebody having edited
  // one and not the other.
  const byValue = new Map();
  for (const [key, value] of Object.entries(source.entries)) {
    if (value.length < 4) continue;
    byValue.set(value, [...(byValue.get(value) ?? []), key]);
  }
  const shared = [...byValue.entries()].filter(([, list]) => list.length > 1);
  const drifted = [];
  for (const language of languages()) {
    const target = load(language);
    for (const [value, list] of shared) {
      // A plural form is one key in several shapes and shares its wording on
      // purpose; the target language chooses between them, not us.
      if (list.every((key) => pluralBase(key)) && new Set(list.map(pluralBase)).size === 1) {
        continue;
      }
      const answers = new Map();
      for (const key of list) {
        answers.set(target.entries[key] ?? null, [
          ...(answers.get(target.entries[key] ?? null) ?? []),
          key,
        ]);
      }
      if (answers.size > 1) drifted.push({ language, value, answers });
    }
  }
  if (drifted.length) {
    warnings.push(`${drifted.length} textů přeložených nejednotně`);
    console.log(`\nJeden český text, víc překladů (${drifted.length}):`);
    for (const { language, value, answers } of drifted) {
      console.log(`  ${language}  "${value.slice(0, 48)}${value.length > 48 ? "…" : ""}"`);
      for (const [answer, keys] of answers) {
        console.log(`      ${answer === null ? "— nepřeloženo —" : `"${answer}"`}`);
        console.log(`          ${keys.join(", ")}`);
      }
    }
  }
  // Said as a number, not a list: it is worth knowing how much text is shared,
  // and worth nothing to read the same eighty lines every time.
  console.log(`\n${shared.length} českých textů leží pod víc klíči (bez rozporu v překladu)`);

  for (const language of languages()) {
    const target = load(language);
    const translated = Object.keys(target.entries);
    const forms = CLDR_FORMS[language] ?? ["one", "other"];
    // Czech has four plural categories and most languages have fewer. A form
    // the target language never selects is not missing, it is inapplicable.
    const wanted = keys.filter((key) => {
      const base = pluralBase(key);
      return !base || forms.includes(key.slice(base.length + 1));
    });
    const missing = wanted.filter((key) => !(key in target.entries));
    const stale = translated.filter((key) => !(key in source.entries));
    const percent = Math.round(((wanted.length - missing.length) / wanted.length) * 100);
    console.log(
      `\n${language}: přeloženo ${wanted.length - missing.length}/${wanted.length} (${percent} %)`
    );
    if (stale.length) {
      errors.push(`${language}: ${stale.length} klíčů, které ve zdroji nejsou`);
      console.log(`  klíče, které ve zdroji už nejsou: ${stale.join(", ")}`);
    }
    for (const key of translated) {
      const expected = placeholders(source.entries[key]);
      const actual = placeholders(target.entries[key]);
      if (expected.join() !== actual.join()) {
        errors.push(`${language}: rozdílné {placeholdery} u ${key}`);
        console.log(`  ROZDÍLNÉ {placeholdery}  ${key}: ${expected.join()} vs ${actual.join()}`);
      }
    }
    // The one defect no other check here can see: a translation that was right
    // when it was written and whose Czech has been reworded since.
    const recorded = readSources()[language] ?? {};
    const drifted = [];
    const unrecorded = [];
    for (const key of translated) {
      if (!(key in source.entries)) continue;
      if (!(key in recorded)) unrecorded.push(key);
      else if (recorded[key] !== fingerprint(source.entries[key])) drifted.push(key);
    }
    if (drifted.length) {
      errors.push(`${language}: ${drifted.length} překladů proti změněnému zdroji`);
      console.log(`\n  Zdroj se změnil, překlad ne (${drifted.length}):`);
      for (const key of drifted.slice(0, 30)) {
        const cs = source.entries[key];
        const target_ = target.entries[key];
        console.log(`    ${key}`);
        console.log(`      cs: ${cs.length > 72 ? `${cs.slice(0, 72)}…` : cs}`);
        console.log(`      ${language}: ${target_.length > 72 ? `${target_.slice(0, 72)}…` : target_}`);
      }
      if (drifted.length > 30) console.log(`    … a dalších ${drifted.length - 30}`);
      console.log(`  Oprav překlad, nebo — když už říká to nové — potvrď:`);
      console.log(`    node scripts/i18n.mjs approve ${language} ${drifted.slice(0, 3).join(" ")}…`);
    }
    if (unrecorded.length) {
      // The one warning a release does not get to pass with — see check().
      (strict ? errors : warnings).push(
        `${language}: ${unrecorded.length} překladů bez otisku zdroje`
      );
      console.log(
        `  bez otisku zdroje: ${unrecorded.length} — po kontrole spusť node scripts/i18n.mjs approve ${language}`
      );
    }
    if (missing.length) console.log(`  chybí ${missing.length} — spusť npm run i18n:export ${language}`);
  }

  console.log("");
  for (const warning of warnings) console.log(`upozornění: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.log(`CHYBA: ${error}`);
    console.log(
      strict
        ? "\nPro vydání to nestačí. Při běžné práci je otisk zdroje jen upozornění."
        : "\nPřeklad by o tenhle text přišel. Oprav to a spusť znovu."
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    strict
      ? "Slovník je připravený k vydání: každý překlad má otisk svého zdroje."
      : "Vše, co uživatel uvidí, je ve slovníku."
  );
  process.exitCode = 0;
}

// --------------------------------------------------------------- export
function exportLanguage(language) {
  const source = load("cs");
  const target = load(language);
  const forms = CLDR_FORMS[language] ?? ["one", "other"];

  const items = {};
  let skipped = 0;
  for (const [key, value] of Object.entries(source.entries)) {
    if (key in target.entries) continue;
    // Czech has four plural forms; most languages have fewer. Asking for a form
    // the target language does not use produces invented text.
    const base = pluralBase(key);
    if (base && !forms.includes(key.slice(base.length + 1))) {
      skipped++;
      continue;
    }
    const note = source.notes[key] ?? (base ? source.notes[`${base}.one`] : undefined);
    items[key] = {
      source: value,
      ...(note ? { note } : {}),
      ...(placeholders(value).length ? { placeholders: placeholders(value) } : {}),
    };
  }

  mkdirSync(exportDir, { recursive: true });
  const path = join(exportDir, `${language}.todo.json`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        target: language,
        sourceLanguage: "cs",
        instructions:
          "Translate every `source` into the target language and put the result in `translation`. " +
          "Keep {placeholders} exactly as they are, including their names. " +
          "`note` explains where the text appears; read it before translating short labels.",
        pluralForms: forms,
        items,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(`${path}: ${Object.keys(items).length} klíčů k překladu` +
    (skipped ? ` (${skipped} tvarů množného čísla vynecháno — cílový jazyk je nemá)` : ""));
}

// --------------------------------------------------------------- import
function importLanguage(language, file) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const source = load("cs");
  const existing = load(language);

  const incoming = {};
  for (const [key, item] of Object.entries(payload.items ?? payload)) {
    const value = typeof item === "string" ? item : item.translation;
    if (typeof value !== "string" || !value.trim()) continue;
    if (!(key in source.entries)) {
      console.log(`přeskočeno — klíč není ve zdroji: ${key}`);
      continue;
    }
    const expected = placeholders(source.entries[key]);
    if (placeholders(value).join() !== expected.join()) {
      console.log(`přeskočeno — rozbité {placeholdery}: ${key}`);
      continue;
    }
    incoming[key] = value;
  }

  const merged = { ...existing.entries, ...incoming };
  let written = 0;
  for (const namespace of namespaces) {
    const capital = namespace[0].toUpperCase() + namespace.slice(1);
    const keys = Object.keys(source.entries)
      .filter((key) => source.owner[key] === namespace && key in merged);
    const lines = keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(merged[key])},`);
    mkdirSync(join(localesDir, language), { recursive: true });
    writeFileSync(
      join(localesDir, language, `${namespace}.ts`),
      `import type { cs${capital} } from "../cs/${namespace}";\n\n` +
        `/** Generated by \`node scripts/i18n.mjs import\`. Missing keys fall back to Czech. */\n` +
        `export const ${language}${capital}: Partial<Record<keyof typeof cs${capital}, string>> = {\n` +
        `${lines.join("\n")}${lines.length ? "\n" : ""}};\n`,
      "utf8"
    );
    written += keys.length;
  }
  // An imported entry was translated from the Czech that is on disk right now,
  // so its fingerprint is recorded here rather than left for a later `approve`
  // — which is the step somebody would forget.
  const all = readSources();
  const recorded = { ...(all[language] ?? {}) };
  for (const key of Object.keys(incoming)) recorded[key] = fingerprint(source.entries[key]);
  all[language] = recorded;
  writeSources(all);
  console.log(`${language}: zapsáno ${written} klíčů (${Object.keys(incoming).length} nových)`);
}

const [command, language, file] = process.argv.slice(2);
if (command === "check") check(process.argv.includes("--strict"));
else if (command === "sync") sync();
else if (command === "new" && language) createNamespace(language);
else if (command === "clear" && language) clearLanguage(language);
else if (command === "export" && language) exportLanguage(language);
else if (command === "import" && language && file) importLanguage(language, file);
else if (command === "approve" && language) approve(language, process.argv.slice(4));
else {
  console.log("použití:");
  console.log("  i18n.mjs check                    kontrola před sestavením");
  console.log("  i18n.mjs check --strict           totéž, ale upozornění jsou chyby (vydání)");
  console.log("  i18n.mjs new <název>              nový slovník pro novou obrazovku");
  console.log("  i18n.mjs sync                     dorovnat index.ts a chybějící jazyky");
  console.log("  i18n.mjs export <jazyk>           vypsat, co zbývá přeložit");
  console.log("  i18n.mjs import <jazyk> <soubor>  načíst hotový překlad");
  console.log("  i18n.mjs approve <jazyk> [klíče]  potvrdit, že překlad odpovídá dnešní češtině");
  console.log("  i18n.mjs clear <jazyk>            vyprázdnit jazyk zpět na češtinu");
  process.exitCode = 1;
}
