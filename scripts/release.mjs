#!/usr/bin/env node
/** Assembles `latest.json` from what `npm run tauri build` produced.
 *
 *  The updater reads one small file, and every field in it has to agree with a
 *  file on disk: the version, the signature, and the URL the installer will
 *  actually live at. Written by hand, a mismatch is silent — the application
 *  either never offers the update or offers one it cannot verify, and neither
 *  says why. So it is generated, and the checks below are the point of the
 *  script rather than a formality.
 *
 *    node scripts/release.mjs
 *
 *  Then upload to the releases repository, as one release tagged `v<version>`:
 *    - Slobot_<version>_x64-setup.exe        what people download by hand
 *    - Slobot_<version>_x64-setup.nsis.zip   what the updater downloads
 *    - latest.json                           what the updater reads
 *
 *  `latest.json` must keep that exact name: the endpoint in tauri.conf.json
 *  points at `releases/latest/download/latest.json`, which GitHub resolves to
 *  whichever release is newest.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = config.version;
const product = config.productName;

const bundle = join(root, "src-tauri", "target", "release", "bundle", "nsis");
if (!existsSync(bundle)) {
  console.error(`nenalezeno: ${bundle}\nSpusť nejdřív npm run tauri build`);
  process.exit(1);
}

// The three places a version is written must already agree; the release is the
// worst moment to discover they do not.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const disagreeing = [
  ["package.json", pkg.version],
  ["src-tauri/Cargo.toml", cargoVersion],
].filter(([, value]) => value !== version);
if (disagreeing.length) {
  console.error(`tauri.conf.json má ${version}, ale:`);
  for (const [where, value] of disagreeing) console.error(`  ${where}: ${value}`);
  process.exit(1);
}

const archive = readdirSync(bundle).find((name) => name.endsWith(".nsis.zip"));
if (!archive) {
  console.error(
    `v ${bundle} není žádný .nsis.zip\n` +
      "Bez createUpdaterArtifacts a podepisovacího klíče se nevyrobí — " +
      "viz sekce Vydání v README."
  );
  process.exit(1);
}
if (!archive.includes(version)) {
  console.error(`${archive} neodpovídá verzi ${version} — starý build?`);
  process.exit(1);
}

const signaturePath = join(bundle, `${archive}.sig`);
if (!existsSync(signaturePath)) {
  console.error(`chybí podpis ${archive}.sig — build běžel bez TAURI_SIGNING_PRIVATE_KEY`);
  process.exit(1);
}
const signature = readFileSync(signaturePath, "utf8").trim();

const endpoint = config.plugins?.updater?.endpoints?.[0] ?? "";
const repository = endpoint.match(/github\.com\/([^/]+\/[^/]+)\/releases/)?.[1];
if (!repository) {
  console.error(`z endpointu v tauri.conf.json nejde vyčíst repozitář: ${endpoint}`);
  process.exit(1);
}

const notesPath = join(root, "RELEASE_NOTES.md");
const notes = existsSync(notesPath)
  ? readFileSync(notesPath, "utf8").trim()
  : `${product} ${version}`;

const latest = {
  version,
  notes,
  // Whole seconds with an offset, which is what the updater's parser wants.
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repository}/releases/download/v${version}/${archive}`,
    },
  },
};

const out = join(bundle, "latest.json");
writeFileSync(out, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
console.log(`${out}`);
console.log(`  verze     ${version}`);
console.log(`  balík     ${archive}`);
console.log(`  vydání    v${version} v repozitáři ${repository}`);
console.log("");
console.log("Nahraj do toho vydání: setup.exe, .nsis.zip a latest.json.");
