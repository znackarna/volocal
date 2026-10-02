import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { englishPage, stampVersion } from "./page.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..", "docs", "site");

export default async function config(phase) {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.VOLOCAL_PAGE_CHECKED) {
    await check();
    // Build workers load this file again; once is enough.
    process.env.VOLOCAL_PAGE_CHECKED = "1";
  }
  return {
    // `/en/` is the address the page names in its canonical and hreflang links.
    // Next.js would redirect it to `/en`.
    skipTrailingSlashRedirect: true,
    poweredByHeader: false,
    // `next dev` would otherwise write an AGENTS.md and a CLAUDE.md into this
    // folder; the repository's own rules are in the root CLAUDE.md.
    agentRules: false,
    // The repository root has a lockfile of its own (the application's); this
    // folder is the project, and nothing outside it is bundled.
    turbopack: { root: here },
    outputFileTracingRoot: here,
  };
}

// The two things that make site.yml fail, checked before the build, so a page
// it would have refused never replaces the one being served.
async function check() {
  let english;
  try {
    english = await englishPage(site);
  } catch (error) {
    throw new Error(`docs/site/translate.mjs refused the page:\n${error.stderr || error.message}`);
  }
  const czech = await readFile(join(site, "index.html"), "utf8");
  for (const [lang, html] of [["cs", czech], ["en", english]]) {
    const { found } = stampVersion(html, lang, "0.0.0");
    if (found !== 2) throw new Error(`docs/site (${lang}): expected 2 version mentions, found ${found}`);
  }
}
