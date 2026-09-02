/**
 * Who said which part of the recording.
 *
 * The voices themselves, the blocks each of them owns, the samples that let a
 * reader hear one, the shortlist of names waiting to be used, and the merge
 * that happens when two voices are given the same name.
 *
 * **Two rules here were paid for and must survive any later move.**
 *
 * A name is written back when the field is left, never while it is being
 * typed. Writing `Pavel` used to be five calls to the backend, five database
 * writes and five times marking the improved document stale.
 *
 * Removing a voice asks only when there is something to lose — and that
 * question is the screen's, not this hook's, because the confirmation dialog
 * belongs to the screen.
 *
 * **What it is given rather than owns.** The blocks and one named way to change
 * them, because a voice and the passages it speaks are each other's state and
 * splitting them would put the same fact in two places. The player, because
 * hearing a sample is playback. And three things that belong to the screen:
 * telling the reader about a failure, fetching the recording again, and marking
 * the improved document stale — the names are in that document, so changing one
 * makes it old.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useUserMessage } from "../messages";
import { forgetSpeakerName, returnSpeakerName, useSpeakerNamePool } from "../speakerNames";
import type { Segment, Speaker } from "../types";

/** Adjacent stretches closer than this are one sample: a sentence broken into
 *  blocks should not count as several short ones. */
const SAME_BREATH = 0.6;

export interface SpeakerManagement {
  state: {
    speakers: Speaker[];
    /** By key, for anything that has a key and wants the person. */
    byKey: Map<string, Speaker>;
    /** The language each voice speaks, as a code, and only on a transcript
     *  that holds more than one. On an interpreted recording it is the
     *  strongest hint about who is who — the English voice is the speaker and
     *  the Czech one the interpreter — and it is there before anybody plays a
     *  sample. Empty on an ordinary transcript, where naming the one language
     *  every voice speaks would be noise. */
    languages: Map<string, string>;
    /** Each voice's share of the spoken time, so a cluster holding two seconds
     *  is obvious. */
    share: Map<string, number>;
    /** Which voice's name field is being edited, which is the only row the
     *  shortlist appears under. */
    naming: string | null;
    /** The names typed before the run, still waiting for a voice. */
    namePool: string[];
    /** The row whose name field should take the keyboard as soon as it is
     *  drawn. A ref, because the field is focused when it appears and nothing
     *  else has to be re-rendered for it. */
    focusNewName: React.MutableRefObject<string | null>;
    /** Blocks nobody has been given, once anybody has been recognised at all.
     *  Before that every block is unassigned and a list of all of them says
     *  nothing. */
    unassigned: Segment[];
  };
  actions: {
    receive: (speakers: Speaker[]) => void;
    /** Repeated presses walk through that voice's stretches, longest first. */
    playSample: (key: string) => void;
    /** Typing. Not a decision, so it goes no further than the screen. */
    rename: (key: string, name: string) => void;
    /** Remembers what the name was, so leaving without a change writes
     *  nothing. */
    beginNaming: (key: string, name: string) => void;
    endNaming: (key: string) => void;
    /** Leaving the field, which is what saves. Merges by name afterwards, so
     *  the name the merge is judged on is the one that was stored. */
    commitName: (key: string, typed: string) => Promise<void>;
    /** Pressing a name on the shortlist. */
    takeName: (key: string, name: string) => Promise<void>;
    addVoice: () => Promise<void>;
    removeVoice: (speaker: Speaker) => Promise<void>;
    /** Hands one block to a voice that already exists. */
    giveToVoice: (segment: Segment, key: string) => Promise<void>;
    /** Hands one block to somebody the machine never found. */
    giveToNewVoice: (segment: Segment) => Promise<void>;
    /** The nearest block above or below that somebody else is speaking. */
    neighbourVoice: (segment: Segment, step: -1 | 1) => { key: string; name: string } | null;
  };
}

export function useSpeakerManagement({
  recordingId,
  segments,
  updateSegments,
  playFrom,
  onError,
  markAiStale,
  reveal,
  reload,
  progressPhase,
}: {
  recordingId: string;
  segments: Segment[];
  /** The one named way this hook changes the transcript. */
  updateSegments: (change: (segments: Segment[]) => Segment[]) => void;
  playFrom: (time: number) => void;
  onError: (message: string) => void;
  /** The names are in the improved document, so changing one makes it old. */
  markAiStale: () => void;
  /** Opens the speakers section, for a voice made from the transcript. */
  reveal: () => void;
  /** Fetches the recording again. A merge rewrites which voice owns which
   *  block across the whole transcript, and guessing at that locally would be
   *  a second implementation of what the backend just did. */
  reload: () => Promise<void>;
  /** Where a run stands, which is what tells the shortlist a run has begun. */
  progressPhase: string | undefined;
}): SpeakerManagement {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [namePool, setNamePool] = useSpeakerNamePool(recordingId, progressPhase);
  const userMessage = useUserMessage();

  const byKey = useMemo(() => {
    const m = new Map<string, Speaker>();
    speakers.forEach((x) => m.set(x.key, x));
    return m;
  }, [speakers]);

  /* The longest continuous stretch is the clearest sample there is. Adjacent
     segments are joined across short gaps so one sentence broken into blocks
     does not count as several short samples. */
  const samples = useMemo(() => {
    const by = new Map<string, { start: number; end: number }[]>();
    for (const segment of segments) {
      if (!segment.speakers) continue;
      const list = by.get(segment.speakers) ?? [];
      const last = list[list.length - 1];
      if (last && segment.start - last.end < SAME_BREATH) last.end = segment.end;
      else list.push({ start: segment.start, end: segment.end });
      by.set(segment.speakers, list);
    }
    for (const list of by.values()) {
      list.sort((a, b) => b.end - b.start - (a.end - a.start));
    }
    return by;
  }, [segments]);

  const share = useMemo(() => {
    const seconds = new Map<string, number>();
    let total = 0;
    for (const segment of segments) {
      if (!segment.speakers) continue;
      const length = Math.max(0, segment.end - segment.start);
      seconds.set(segment.speakers, (seconds.get(segment.speakers) ?? 0) + length);
      total += length;
    }
    const out = new Map<string, number>();
    for (const [key, value] of seconds) out.set(key, total > 0 ? value / total : 0);
    return out;
  }, [segments]);

  /* The language a voice speaks, by the time it spends in each — not by the
     number of blocks, which counts a two-second interjection against a minute
     of speech. Only where the transcript really holds two: `keep_voices_to_
     one_language` ties a voice to one, so a second code appearing here would
     be worth seeing rather than hidden. */
  const languages = useMemo(() => {
    const seconds = new Map<string, Map<string, number>>();
    const heard = new Set<string>();
    for (const segment of segments) {
      const language = segment.language?.trim().toLowerCase();
      if (!segment.speakers || !language) continue;
      heard.add(language);
      const per = seconds.get(segment.speakers) ?? new Map<string, number>();
      per.set(language, (per.get(language) ?? 0) + Math.max(0, segment.end - segment.start));
      seconds.set(segment.speakers, per);
    }
    const out = new Map<string, string>();
    if (heard.size < 2) return out;
    for (const [key, per] of seconds) {
      const most = [...per].sort((a, b) => b[1] - a[1])[0];
      if (most) out.set(key, most[0]);
    }
    return out;
  }, [segments]);

  const unassigned = useMemo(
    () => (speakers.length > 0 ? segments.filter((s) => !s.speakers) : []),
    [segments, speakers]
  );

  const nextSample = useRef<Record<string, number>>({});
  const playSample = useCallback(
    (key: string) => {
      const list = samples.get(key);
      if (!list || list.length === 0) return;
      const index = (nextSample.current[key] ?? 0) % list.length;
      nextSample.current[key] = index + 1;
      playFrom(list[index].start);
    },
    [playFrom, samples]
  );

  const neighbourVoice = useCallback(
    (segment: Segment, step: -1 | 1) => {
      const at = segments.findIndex((s) => s.id === segment.id);
      if (at < 0) return null;
      for (let i = at + step; i >= 0 && i < segments.length; i += step) {
        const key = segments[i].speakers;
        if (key && key !== segment.speakers) {
          return { key, name: byKey.get(key)?.name ?? key };
        }
      }
      return null;
    },
    [byKey, segments]
  );

  const giveToVoice = useCallback(
    async (segment: Segment, key: string) => {
      updateSegments((p) => p.map((x) => (x.id === segment.id ? { ...x, speakers: key } : x)));
      try {
        await api.setSegmentSpeaker(segment.id, key);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, updateSegments, userMessage]
  );

  /* A passage that belongs to somebody the machine never found. The panel has
     always been able to join two groups that are one person; this is the
     direction it was missing. */
  const giveToNewVoice = useCallback(
    async (segment: Segment) => {
      try {
        const voice = await api.addSpeaker(recordingId);
        setSpeakers((p) => [...p, voice]);
        updateSegments((p) =>
          p.map((x) => (x.id === segment.id ? { ...x, speakers: voice.key } : x))
        );
        await api.setSegmentSpeaker(segment.id, voice.key);
        // Open the panel on it: the name it was given is a placeholder, and
        // renaming it is the next thing anybody will want to do.
        reveal();
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, recordingId, reveal, updateSegments, userMessage]
  );

  const focusNewName = useRef<string | null>(null);

  /** A person the reader knows is in the recording, before any passage has been
   *  handed to them. The transcript's menu can also make one, but only while
   *  giving it a block; somebody who writes down the participants first had no
   *  way in at all. */
  const addVoice = useCallback(async () => {
    try {
      const voice = await api.addSpeaker(recordingId);
      setSpeakers((p) => [...p, voice]);
      // The stored name is a placeholder; selecting it means the first thing
      // typed replaces it rather than being appended to "Mluvčí 3".
      focusNewName.current = voice.key;
    } catch (e) {
      onError(userMessage(e));
    }
  }, [onError, recordingId, userMessage]);

  /** Their passages stay exactly where they are and lose only the name, so the
   *  panel's list of unnamed places is where they turn up — nothing has to be
   *  found again. */
  const removeVoice = useCallback(
    async (speaker: Speaker) => {
      try {
        await api.deleteSpeaker(recordingId, speaker.key);
        setSpeakers((p) => p.filter((m) => m.key !== speaker.key));
        updateSegments((p) =>
          p.map((x) => (x.speakers === speaker.key ? { ...x, speakers: null } : x))
        );
        markAiStale();
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [markAiStale, onError, recordingId, updateSegments, userMessage]
  );

  const rename = useCallback((key: string, name: string) => {
    setSpeakers((s) => s.map((m) => (m.key === key ? { ...m, name } : m)));
  }, []);

  /** What the name was when the field was entered, so that leaving it without
   *  changing anything writes nothing. */
  const nameAtFocus = useRef("");

  const beginNaming = useCallback((key: string, name: string) => {
    nameAtFocus.current = name;
    setNaming(key);
  }, []);

  const endNaming = useCallback((key: string) => {
    setNaming((current) => (current === key ? null : current));
  }, []);

  const commitName = useCallback(
    async (key: string, name: string) => {
      if (name === nameAtFocus.current) return;
      const before = nameAtFocus.current.trim();
      nameAtFocus.current = name;
      /* Emptying the field is the exact opposite of taking a name off the
         shortlist, so it goes back on. `forgetSpeakerName` removed it when it
         landed on this voice — right, because it was in the archive then and
         offering it again would be offering the same answer twice. Clearing it
         ends that, and the name is waiting again rather than gone.

         Only emptying, not changing. A name replaced by another was wrong for
         this voice and may be wrong everywhere; a name deleted is one somebody
         has decided does not belong here yet, which is what the list is for. */
      const typed = name.trim();
      if (!typed && before) {
        returnSpeakerName(recordingId, before);
        setNamePool((pool) => (pool.includes(before) ? pool : [...pool, before]));
      }
      /* And the other half of the same rule, so the list means one thing: a
         name is on it when it is not on a voice. Pressing it in the list has
         always taken it off; typing the same thing by hand did not, and after
         the line above that became easy to reach — clear the field, watch the
         name come back, type it again, and it would be offered while it was
         already in use. */
      if (typed) {
        forgetSpeakerName(recordingId, typed);
        setNamePool((pool) => pool.filter((n) => n !== typed));
      }
      markAiStale();
      try {
        await api.renameSpeaker(recordingId, key, name);
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [markAiStale, onError, recordingId, setNamePool, userMessage]
  );

  const merge = useCallback(
    async (from: string, toKey: string) => {
      try {
        await api.mergeSpeakers(recordingId, from, toKey);
        await reload();
      } catch (e) {
        onError(userMessage(e));
      }
    },
    [onError, recordingId, reload, userMessage]
  );

  const takeName = useCallback(
    async (key: string, name: string) => {
      rename(key, name);
      await commitName(key, name);
      /* `commitName` does this too, and both are idempotent. It is still here
         because it does it only when it has something to write: press a name
         the voice already carries and the write is skipped, and the list would
         keep offering it. Cheaper to say it twice than to depend on that. */
      forgetSpeakerName(recordingId, name);
      setNamePool((pool) => pool.filter((n) => n !== name));
      setNaming(null);
    },
    [commitName, recordingId, rename, setNamePool]
  );

  /** Two voices given the same name are one person. Runs when the field is
   *  left, never mid-typing, or `Pa` would merge into `Pavel`. */
  const mergeByName = useCallback(
    (key: string, typed: string) => {
      const name = typed.trim();
      if (!name) return;
      const twin = speakers.find(
        (other) =>
          other.key !== key && other.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      if (twin) void merge(key, twin.key);
    },
    [merge, speakers]
  );

  const commitAndMerge = useCallback(
    async (key: string, typed: string) => {
      await commitName(key, typed);
      mergeByName(key, typed);
    },
    [commitName, mergeByName]
  );

  return {
    state: {
      speakers,
      byKey,
      languages,
      share,
      naming,
      namePool,
      focusNewName,
      unassigned,
    },
    actions: {
      receive: setSpeakers,
      playSample,
      rename,
      beginNaming,
      endNaming,
      commitName: commitAndMerge,
      takeName,
      addVoice,
      removeVoice,
      giveToVoice,
      giveToNewVoice,
      neighbourVoice,
    },
  };
}
