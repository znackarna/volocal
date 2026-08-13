#!/usr/bin/env node
/** Proposes newer versions of the downloaded components.
 *
 *    node scripts/update-components.mjs           report what is newer
 *    node scripts/update-components.mjs --write   rewrite components.json
 *
 *  Run weekly by `.github/workflows/update-components.yml`, which opens a pull
 *  request when anything changed. It never pushes to a branch anybody merges
 *  from: choosing a version is a decision, and the whole reason the catalogue
 *  stopped following "latest" is that nobody was making it.
 *
 *  THE ONE RULE. A digest is only ever copied from the publisher — GitHub's
 *  release asset `digest` or a Hugging Face LFS object id.
 *  It is never computed here from a downloaded file. A digest computed by
 *  whoever fetched the file attests that the file matches itself, which is not
 *  a fact about anything. If a publisher offers none, this script leaves the
 *  entry exactly as it is rather than proposing a version nobody can check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "src-tauri", "components.json");
const write = process.argv.includes("--write");

const headers = { "user-agent": "volocal-component-update" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function json(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function text(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.text()).trim();
}

/** The newest release carrying an asset whose name matches, with the digest
 *  GitHub computed for it. Walks back a few releases: projects occasionally
 *  ship a release with one platform's build missing. */
async function fromGithub({ repo, asset }) {
  const wanted = new RegExp(asset);
  const releases = await json(`https://api.github.com/repos/${repo}/releases?per_page=15`);
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const match = (release.assets ?? []).find((a) => wanted.test(a.name));
    if (!match) continue;
    // No digest means nothing to compare against later. Say so and change
    // nothing — a newer version we cannot verify is not an improvement.
    if (typeof match.digest !== "string" || !match.digest.startsWith("sha256:")) {
      return { skip: `${release.tag_name} publishes no digest` };
    }
    return {
      url: match.browser_download_url,
      sha256: match.digest.slice("sha256:".length),
      version: release.tag_name,
    };
  }
  return { skip: `no asset matching ${asset} in the last 15 releases` };
}

/** Hugging Face serves an LFS file's SHA-256 as its object id. The address is
 *  pinned to the repository's current revision, so the pair cannot drift: a
 *  digest beside `resolve/main` would start refusing the download the day the
 *  publisher pushed anything at all. */
async function fromHuggingFace({ repo, file }) {
  const model = await json(`https://huggingface.co/api/models/${repo}`);
  const tree = await json(`https://huggingface.co/api/models/${repo}/tree/main`);
  const entry = tree.find((item) => item.path === file);
  if (!entry) return { skip: `${file} is not in ${repo}` };
  const digest = entry.lfs?.oid;
  if (!digest) return { skip: `${file} is not stored with a digest` };
  return {
    url: `https://huggingface.co/${repo}/resolve/${model.sha}/${file}`,
    sha256: digest,
    version: model.sha.slice(0, 12),
  };
}

/* There was a third finder here, for gyan.dev's own site, and removing it is
 * the whole point of the change that did so. It fetched
 * `builds/release-version` and built a URL for that numbered archive —
 * deliberately the numbered one rather than the rolling `-release-` name,
 * which would mean a different build every few weeks.
 *
 * That reasoning was right and the host was wrong. gyan.dev deletes a numbered
 * archive when the next version replaces it, so the pin did not go stale — the
 * file went missing, and every fresh install met *Server odmítl soubor vydat*
 * for the one component the wizard calls required. The same builds are release
 * assets on `GyanD/codexffmpeg`, where GitHub keeps them: 9.0 is still
 * downloadable there after gyan.dev stopped serving it, byte for byte the same
 * archive by its digest. So ffmpeg tracks like everything else now.
 */
const finders = { github: fromGithub, huggingface: fromHuggingFace };

const components = JSON.parse(readFileSync(path, "utf8"));
const changed = [];
const skipped = [];
let failed = false;

for (const [id, entry] of Object.entries(components)) {
  if (id.startsWith("$") || !entry.track) continue;
  const find = finders[entry.track.kind];
  if (!find) {
    console.log(`${id}: unknown tracking kind ${entry.track.kind}`);
    failed = true;
    continue;
  }
  let found;
  try {
    found = await find(entry.track);
  } catch (error) {
    // A publisher being briefly unreachable must not fail the run and must not
    // silently drop that component from next week's check either.
    console.log(`${id}: could not ask — ${error.message}`);
    skipped.push(`${id}: ${error.message}`);
    continue;
  }
  if (found.skip) {
    console.log(`${id}: left alone — ${found.skip}`);
    skipped.push(`${id}: ${found.skip}`);
    continue;
  }
  if (found.url === entry.url && found.sha256 === entry.sha256) {
    console.log(`${id}: up to date`);
    continue;
  }
  // A proposed address that does not answer would turn every install of that
  // component into a failure, and the pull request would look fine.
  try {
    const head = await fetch(found.url, { method: "HEAD", headers, redirect: "follow" });
    if (!head.ok) throw new Error(`${head.status}`);
  } catch (error) {
    console.log(`${id}: left alone — ${found.version} does not answer (${error.message})`);
    skipped.push(`${id}: ${found.version} does not answer`);
    continue;
  }
  console.log(`${id}: → ${found.version}`);
  changed.push({ id, version: found.version, from: entry.url, to: found.url });
  entry.url = found.url;
  entry.sha256 = found.sha256;
}

if (write && changed.length) {
  writeFileSync(path, `${JSON.stringify(components, null, 2)}\n`, "utf8");
  console.log(`\nwrote ${changed.length} change(s) to src-tauri/components.json`);
}

// The workflow reads these two, so keep them machine-readable.
if (process.env.GITHUB_OUTPUT) {
  const summary = changed.map((c) => `- **${c.id}** → \`${c.version}\``).join("\n");
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=${changed.length}\nsummary<<EOF\n${summary}\n${
      skipped.length ? `\nLeft alone:\n${skipped.map((s) => `- ${s}`).join("\n")}\n` : ""
    }EOF\n`,
    { flag: "a" }
  );
}

console.log(`\n${changed.length} newer, ${skipped.length} left alone`);
process.exit(failed ? 1 : 0);
