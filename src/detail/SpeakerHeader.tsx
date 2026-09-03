/**
 * The name over a run of blocks, and — where the transcript holds two
 * languages — which one this run is in.
 *
 * Its own file rather than four lines inside the transcript screen. The screen
 * composes; what a heading is made of is the heading's business, and the rule
 * about which language a block is in is not something anybody should have to
 * find in the middle of a thousand-line render.
 */
import type { Segment } from "../types";

/** Does this transcript hold a second language at all?
 *
 * **A block carries a language only where the second-language pass wrote it.**
 * An unlabelled block is the recording's own — which is why a bilingual
 * transcript looks monolingual if the languages are read literally, and why
 * this asks whether any block says something *different* rather than counting
 * distinct values.
 */
export function holdsTwoLanguages(segments: Segment[], language: string): boolean {
  const own = language.trim().toLowerCase();
  return segments.some((s) => s.language && s.language.trim().toLowerCase() !== own);
}

export function SpeakerHeader({
  name,
  color,
  /** The block this run starts with; its language is the run's. */
  segment,
  /** The recording's own language, which an unlabelled block is in. */
  language,
  /** Drawn only where there are two — on an ordinary transcript the code under
   *  every name would repeat what the footer already says. */
  showLanguage,
}: {
  name: string;
  color: string;
  segment: Segment;
  language: string;
  showLanguage: boolean;
}) {
  return (
    <div className="speaker-header" style={{ color }}>
      {name}
      {showLanguage && (
        <sup className="speaker-header-language">
          {(segment.language || language).toUpperCase()}
        </sup>
      )}
    </div>
  );
}
