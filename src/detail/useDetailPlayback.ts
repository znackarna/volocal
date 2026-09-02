/**
 * The join between this screen and the player the whole application shares.
 *
 * The most sensitive area of the transcript screen, and the last thing moved,
 * once there was less code around it. Nothing about how a seek behaves is
 * changed here — see `CLAUDE.md` for why MP3 playback goes through a private
 * AAC proxy and why stored word timestamps must never be stretched to
 * compensate for it.
 *
 * **Everything the handlers need comes from a ref, not from dependencies.**
 * The player's context value changes on every tick of the clock. Were `seek`
 * to depend on it, that function would change several times a second — and
 * since every transcript block receives it, none of them would pass the `memo`
 * comparison and the whole transcript would repaint over and over. On an
 * hour-long sermon that is a thousand blocks and twenty thousand elements per
 * tick. That is the reason this file looks the way it does, and it is the one
 * thing not to tidy away.
 *
 * **Three ways to move, and they differ in whether sound follows.**
 * `updateCursor` only moves the cursor — dragging the slider, and arriving
 * from search, are reading. `seek` takes the audio over when it belongs
 * elsewhere, because clicking a word is an instruction. `playFrom` also makes
 * sure it is running, because a note's timestamp is asked for in order to hear
 * that moment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_WAVEFORM, loadWaveform, usePlayer, usePlayerTime } from "../player";
import type { Waveform } from "../player";
import type { Segment } from "../types";

export interface DetailPlayback {
  state: {
    /** Whether the shared player is holding this recording. */
    isCurrentRecording: boolean;
    /** Where the cursor stands: the player's clock when it holds this
     *  recording, and the local cursor when it does not. */
    time: number;
    isPlaying: boolean;
    /** The player's own duration once it knows one, since the database's comes
     *  from ffprobe at import and may be unknown — and without it the played
     *  ratio would be zero, so neither ring nor handle would render. */
    trackDuration: number;
    waveform: Waveform;
    /** The block that last began, rather than the one the playhead sits
     *  inside. Between two sentences there is a pause that belongs to neither,
     *  and demanding a strict match made the highlight blink out for it before
     *  reappearing a line lower. */
    active: Segment | undefined;
    /** The transcript list, which the auto-scroll measures against. */
    listRef: React.RefObject<HTMLDivElement>;
  };
  actions: {
    /** Moves the cursor without starting anything. */
    updateCursor: (time: number) => void;
    /** Moves, taking the audio over if it is elsewhere. */
    seek: (time: number) => void;
    /** Moves and makes sure the audio is running. */
    playFrom: (time: number) => void;
    /** Plays one stretch and stops at the end of it. What a place put up for
     *  checking asks for: hear *this*, not the rest of the recording. */
    playRange: (from: number, to: number) => void;
    togglePlayback: () => void;
  };
}

export function useDetailPlayback({
  recordingId,
  path,
  title,
  duration,
  segments,
  /** Where the screen was opened at, coming from the archive's search. */
  seekTime,
  /** How many blocks are on the page, which the auto-scroll needs: on arrival
   *  the block being read usually has no element yet. */
  drawnBlocks,
}: {
  recordingId: string;
  path: string;
  title: string;
  duration: number;
  segments: Segment[];
  seekTime: number | null;
  drawnBlocks: number;
}): DetailPlayback {
  const player = usePlayer();
  /* Asked for separately from the player: this is the one screen that follows
     the clock, and it is what makes the tick worth paying for here. */
  const playerTime = usePlayerTime();

  const isCurrentRecording = player.recordingId === recordingId;
  /** Cursor in a transcript that does not own the audio yet. */
  const [localTime, setLocalTime] = useState(0);
  const time = isCurrentRecording ? playerTime : localTime;
  const isPlaying = isCurrentRecording && player.isPlaying;
  const trackDuration =
    isCurrentRecording && player.duration > 0 ? player.duration : duration;

  const listRef = useRef<HTMLDivElement>(null);

  /* The screen loads the waveform itself rather than through the player. The
     player only knows the one currently playing, so the waveform would appear
     only after pressing play, leaving an empty track under the slider. */
  const [waveform, setWaveform] = useState<Waveform>(EMPTY_WAVEFORM);
  useEffect(() => {
    let disposed = false;
    setWaveform(EMPTY_WAVEFORM);
    loadWaveform(recordingId, setWaveform, () => disposed);
    return () => {
      disposed = true;
    };
  }, [recordingId]);

  // See the note at the top: this ref is the reason the transcript does not
  // repaint on every tick.
  const current = useRef({
    isCurrentRecording,
    player,
    id: recordingId,
    path,
    title,
    duration,
    localTime,
  });
  current.current = {
    isCurrentRecording,
    player,
    id: recordingId,
    path,
    title,
    duration,
    localTime,
  };

  const seekTo = useCallback((t: number, silently = false) => {
    const s = current.current;
    if (s.isCurrentRecording) {
      s.player.seek(t);
    } else if (!silently && s.path) {
      s.player.start(s.id, s.path, s.title, s.duration, Math.max(0, t));
    } else {
      setLocalTime(Math.max(0, t));
    }
  }, []);

  /* Where a stretch that is playing on its own should stop, and the frame
     watch that stops it.

     **The clock is watched rather than a timer set.** The reader can change
     the speed or drag the slider while the stretch runs, and a timer started
     at the click would then cut in the wrong place. `readTime` is the one
     reading that costs no render, which is why the loop may run every frame.

     The watch is dropped the moment the reader asks the screen for another
     moment — a word, the slider, the play button — so a stop never lands on
     playback it was not set for. */
  const stopAt = useRef<number | null>(null);
  const watching = useRef(0);

  const stopWatching = useCallback(() => {
    stopAt.current = null;
    if (watching.current) cancelAnimationFrame(watching.current);
    watching.current = 0;
  }, []);

  const seek = useCallback(
    (t: number) => {
      stopWatching();
      seekTo(t);
    },
    [seekTo, stopWatching]
  );
  const updateCursor = useCallback(
    (t: number) => {
      stopWatching();
      seekTo(t, true);
    },
    [seekTo, stopWatching]
  );

  const startPlaying = useCallback((t: number) => {
    const s = current.current;
    if (s.isCurrentRecording) {
      s.player.seek(t);
      if (!s.player.isPlaying) s.player.togglePlayback();
    } else if (s.path) {
      s.player.start(s.id, s.path, s.title, s.duration, Math.max(0, t));
    } else {
      setLocalTime(Math.max(0, t));
    }
  }, []);

  const playFrom = useCallback(
    (t: number) => {
      stopWatching();
      startPlaying(t);
    },
    [startPlaying, stopWatching]
  );

  const playRange = useCallback(
    (from: number, to: number) => {
      stopWatching();
      startPlaying(from);
      if (!current.current.path || !(to > from)) return;
      stopAt.current = to;
      const watch = () => {
        const s = current.current;
        const end = stopAt.current;
        if (end == null) return;
        // Playback moved to another recording: this stop is no longer about
        // anything on this screen.
        if (!s.isCurrentRecording) return stopWatching();
        if (s.player.readTime() >= end) {
          if (s.player.isPlaying) s.player.togglePlayback();
          return stopWatching();
        }
        watching.current = requestAnimationFrame(watch);
      };
      watching.current = requestAnimationFrame(watch);
    },
    [startPlaying, stopWatching]
  );

  useEffect(() => stopWatching, [stopWatching]);

  const togglePlayback = useCallback(() => {
    stopWatching();
    const s = current.current;
    if (s.isCurrentRecording) s.player.togglePlayback();
    else if (s.path) s.player.start(s.id, s.path, s.title, s.duration, s.localTime);
  }, [stopWatching]);

  /* Jump to the spot this screen was opened for, coming from search.

     Going through a ref is deliberate. The player context value changes on
     every tick, and the seek function changes with it. Were it in the
     dependencies, running audio would tear down and re-arm this effect
     constantly — and the deferred jump would never get its turn. */
  useEffect(() => {
    if (seekTime == null) return;
    // A short delay waits for the blocks to render; without them there is
    // nowhere to scroll. Quietly: arriving from search should place the
    // cursor, not start playback.
    const t = setTimeout(() => updateCursor(seekTime), 200);
    return () => clearTimeout(t);
  }, [seekTime, updateCursor]);

  /* When playback moves elsewhere, the cursor stays where it left off.

     Through a ref, and that is the whole point: the effect must not re-run
     eight times a second, so a cleanup reading the clock directly would close
     over whatever it said when this recording *took* the audio over — the
     moment it started, not the moment it stopped. */
  const lastPlayedTime = useRef(0);
  if (isCurrentRecording) lastPlayedTime.current = playerTime;
  useEffect(() => {
    if (!isCurrentRecording) return;
    return () => setLocalTime(lastPlayedTime.current);
  }, [isCurrentRecording]);

  /* Binary search rather than a scan: this runs on every frame of playback,
     and blocks arrive ordered by their position in the recording. */
  const active = useMemo(() => {
    let low = 0;
    let high = segments.length - 1;
    let found: Segment | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (segments[middle].start <= time) {
        found = segments[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }, [segments, time]);

  /* Keep the active block on screen, but only while audio is actually playing
     — during reading and editing, self-scrolling gets in the way.

     And only when it is genuinely out of sight. Clicking a word in the middle
     of the screen used to re-centre the whole transcript for no reason; now the
     text under your hand moves only when it would otherwise disappear. */
  useEffect(() => {
    if (!isPlaying || !active) return;
    const element = document.getElementById(`segment-${active.id}`);
    const list = listRef.current;
    if (!element || !list) return;

    const box = element.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    // Band near the edges where a block counts as "on its way out".
    const margin = Math.min(120, view.height * 0.15);
    if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    /* `drawnBlocks` is in here because on arrival the block being read is
       usually past the first screenful, has no element yet, and this leaves
       above without doing anything.

       It is not the difference between working and not — that was the first
       guess and it was wrong. The audio keeps running, so a few seconds later
       the reading crosses into the next block, `active` changes, and it lands
       then. This is the difference between immediate and one block late. */
  }, [active?.id, isPlaying, drawnBlocks]);

  return {
    state: { isCurrentRecording, time, isPlaying, trackDuration, waveform, active, listRef },
    actions: { updateCursor, seek, playFrom, playRange, togglePlayback },
  };
}
