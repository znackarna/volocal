/* What site.yml does to the page on its way to Vercel, shared by the build
 * check (`next.config.mjs`) and the server (`app/[[...path]]/route.js`), so the
 * two cannot disagree about it. */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The English page, written by `translate.mjs` exactly as site.yml writes it.
 *  Rejects when a sentence has no English, with the generator's own message in
 *  `stderr`. */
export async function englishPage(site) {
  const dir = await mkdtemp(join(tmpdir(), "volocal-en-"));
  try {
    const target = join(dir, "index.html");
    await run(process.execPath, [join(site, "translate.mjs"), target]);
    return await readFile(target, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const MENTION = {
  cs: { pattern: /Verze \d+\.\d+\.\d+/g, word: "Verze" },
  en: { pattern: /Version \d+\.\d+\.\d+/g, word: "Version" },
};

/** The hero and the closing name the version. site.yml replaces both with the
 *  latest release and refuses a page where it finds anything but two. */
export function stampVersion(html, lang, version) {
  const { pattern, word } = MENTION[lang];
  let found = 0;
  const stamped = html.replace(pattern, () => {
    found += 1;
    return `${word} ${version}`;
  });
  return { html: stamped, found };
}
