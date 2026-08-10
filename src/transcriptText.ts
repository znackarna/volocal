/** Text work on a transcript that needs no DOM and no React.
 *
 *  Both of these lived inside `Detail.tsx`. They are here so they can be tested
 *  on their own — a rule about Czech diacritics and a diff algorithm are the
 *  two places in the reading screen where being wrong is quiet: the search
 *  simply finds nothing, or the wrong word is underlined, and neither raises
 *  anything. Moving them changes no behaviour; `Detail.tsx` imports them.
 */

/** Lower case and without diacritics, so that `reknu` finds `řeknu`.
 *
 *  Not a nicety in Czech: the diacritics are exactly what somebody typing
 *  quickly leaves out, and a search that misses because of a háček is a search
 *  nobody trusts twice. NFD splits a letter from its marks, and the marks are
 *  then thrown away. */
export function plain(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** A segment longer than this is not diffed. The table below is quadratic, and
 *  a block this size means something other than a hand correction. */
export const MAX_DIFF_WORDS = 400;

/**
 * Which words of `text` were not in `original`, by index.
 *
 * A longest-common-subsequence walk rather than a position-by-position
 * comparison: correcting one word into two, or dropping a word, shifts
 * everything after it, and a naive compare would then mark the whole rest of
 * the sentence as changed. Words are compared exactly, so a comma added is a
 * correction — because it is one.
 */
export function changedWords(original: string, text: string): Set<number> {
  const changed = new Set<number>();
  const before = original.trim().split(/\s+/).filter(Boolean);
  const after = text.trim().split(/\s+/).filter(Boolean);
  if (before.length > MAX_DIFF_WORDS || after.length > MAX_DIFF_WORDS) return changed;

  const common: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0)
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i][j] =
        before[i] === after[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      i++;
      j++;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      i++; // a word that is gone leaves nothing to underline
    } else {
      changed.add(j);
      j++;
    }
  }
  while (j < after.length) changed.add(j++);
  return changed;
}
