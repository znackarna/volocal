/** Where a transcription computes, read the same way everywhere.
 *
 *  Two screens ask about this and they used to ask separately: `Settings.tsx`
 *  owned `computeMode` and the card's own reading of what was refused, and
 *  anything else that wanted the answer would have had to reproduce it. Two
 *  rules for one idea is how a card and a notice come to disagree about the
 *  same machine, so the rules live here and both read them.
 */
import type { ToolCheck } from "./types";

/** What the stored value means, in the vocabulary the screen uses.
 *
 *  Settings written before 14 August 2026 name a build — `cuda` or `vulkan` —
 *  and both are the reader having asked for the graphics card, which is what
 *  the screen now calls that. They are left in the settings record rather than
 *  rewritten on sight: `choose_compute` honours them where the machine can run
 *  them, and a screen that quietly edited a stored value while merely being
 *  looked at would be a worse habit than a two-word translation here. The first
 *  press of either card replaces them with the new vocabulary.
 *
 *  Anything else — an empty value, a name from some future build — is
 *  automatic, which is what `choose_compute` also does with it. */
export function computeMode(stored: string): "auto" | "gpu" | "cpu" {
  if (stored === "cpu") return "cpu";
  return stored === "gpu" || stored === "cuda" || stored === "vulkan" ? "gpu" : "auto";
}

/** Is the graphics card sitting out a run it could have done?
 *
 *  `check.compute` is what `choose_compute` answered — the folder the next
 *  transcription's `whisper-cli` comes out of — not what is stored. The
 *  substitution behind it is silent by design, because a transcription must
 *  run; what it must not be is silent *on screen*. Several times slower, with
 *  nothing said, reads as how the application is rather than as a stand-in.
 *
 *  Three conditions and each excludes a case that is not a fall-back:
 *
 *  - the reader did not ask for the processor. Choosing it and getting it is
 *    the application doing as it was told;
 *  - the run is not on a graphics build, so there is something to say;
 *  - this machine has a driver. Without one the processor is not second best,
 *    it is the only thing here, and saying so on every launch would be a
 *    complaint about a computer nobody can do anything about.
 *
 *  It says nothing about *why* — a build never downloaded, a driver that
 *  stopped loading, a card swapped out. `Výkon` has the room for that and this
 *  does not; the bar's job is that the reader knows to look. */
export function computeFellBack(stored: string, check: ToolCheck | null): boolean {
  if (!check) return false;
  if (computeMode(stored) === "cpu") return false;
  const onGraphicsCard = check.compute === "cuda" || check.compute === "vulkan";
  const hasGraphicsDriver = !!(check.nvidia_driver || check.vulkan_driver);
  return !onGraphicsCard && hasGraphicsDriver;
}
