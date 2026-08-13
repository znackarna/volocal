import { useEffect, useState } from "react";

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

/** Phases after which the shortlist is worth reading again. */
const RUN_ENDED = ["complete", "cancelled", "error"];

/** The shortlist for one recording, kept in step with the runs on it.
 *
 *  **Reading it when the recording changes is not enough, and that was the
 *  bug.** The names are typed into the dialog that *starts* a run, and when
 *  that run is started from the transcript already on screen — which is where
 *  the button for it is — the recording never changes. So the list stayed the
 *  empty one from before the question was asked: the reader typed two names,
 *  chose two voices, and was then offered nothing under either of them.
 *
 *  Hence the second trigger. A run reaching a terminal phase is exactly the
 *  moment the voices it produced appear, which is the moment their names are
 *  wanted.
 */
export function useSpeakerNamePool(id: string, phase: string | undefined) {
  const [pool, setPool] = useState<string[]>(() => speakerNamesFor(id));
  const ended = RUN_ENDED.includes(phase ?? "");
  useEffect(() => {
    setPool(speakerNamesFor(id));
  }, [id, ended]);
  return [pool, setPool] as const;
}
