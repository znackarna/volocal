/** The names typed before a transcription, waiting for the voices to arrive.
 *
 *  They are a shortlist, not archive data. The clustering produces anonymous
 *  groups and nothing in them points at Roman, so these cannot name anybody by
 *  themselves — they only save the typing once the reader has heard a sample
 *  and knows which group is whom. The moment a voice is named, the archive
 *  holds the name and this record has done its job.
 *
 *  Hence local storage rather than a column in the archive: losing it costs the
 *  reader one round of typing, and it is the same list they would have typed
 *  anyway. Do not promote it to the database without a reason beyond tidiness.
 */
const KEY = "speaker-names";

type Pools = Record<string, string[]>;

function read(): Pools {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Pools) : {};
  } catch {
    // A shortlist is never worth taking the window down for.
    return {};
  }
}

function write(pools: Pools) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pools));
  } catch {
    /* Full or refused: the reader types the names instead. */
  }
}

/** One list per recording, because a batch answered one question together but
 *  each recording is named on its own screen afterwards. */
export function rememberSpeakerNames(ids: string[], names: string[]) {
  const pools = read();
  for (const id of ids) {
    if (names.length > 0) pools[id] = names;
    else delete pools[id];
  }
  write(pools);
}

export function speakerNamesFor(id: string): string[] {
  const pool = read()[id];
  return Array.isArray(pool) ? pool.filter((n) => typeof n === "string") : [];
}

/** Once a name is on a voice, it is in the archive and has no business being
 *  offered again. An emptied list takes its whole entry with it. */
export function forgetSpeakerName(id: string, used: string) {
  const pools = read();
  const left = (pools[id] ?? []).filter((n) => n !== used);
  if (left.length > 0) pools[id] = left;
  else delete pools[id];
  write(pools);
}
