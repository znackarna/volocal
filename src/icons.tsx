/** The line icons shared by module tiles, wizard cards, and anything else that
 *  needs one of these ideas.
 *
 *  They live here rather than beside the first screen that used them so the
 *  same idea keeps the same drawing everywhere. All are authored on a 24×24
 *  grid with a 1.6 stroke, so they sit at the same optical weight when placed
 *  in the shared circular surface.
 */
export const LINE_ICONS = {
  model:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  compute:
    "M8 8h8v8H8z M5 10V8a3 3 0 0 1 3-3h2 M19 10V8a3 3 0 0 0-3-3h-2 M5 14v2a3 3 0 0 0 3 3h2 M19 14v2a3 3 0 0 1-3 3h-2 M12 2v3 M12 19v3 M2 12h3 M19 12h3",
  speakers:
    "M9 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M3 20v-1.2C3 16.1 5.7 14 9 14s6 2.1 6 4.8V20 M16.5 5.2a3.2 3.2 0 0 1 0 6.2 M17.5 14.3c2.1.5 3.5 2.1 3.5 4v1.7",
  editor:
    "M12 3l1.1 3.9L17 8l-3.9 1.1L12 13l-1.1-3.9L7 8l3.9-1.1L12 3Z M18.5 13l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z M6 14l.9 3.1L10 18l-3.1.9L6 22l-.9-3.1L2 18l3.1-.9L6 14Z",
  /** A note. The turned-up corner is what makes it a sticky rather than a
   *  document, which is what the notes in this sidebar are. */
  note:
    "M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5Z M20 14h-5a1 1 0 0 0-1 1v5 M8 9h8 M8 12.5h5",
  /** Places worth looking at. An eye, because the section asks for a reading
   *  pass, not a verdict — the pupil is the same 2.6 radius the model icon's
   *  inner circle uses, so the two sit at one optical weight. */
  review:
    "M2.6 12s3.6-6 9.4-6 9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6Z M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z",
  /** A pencil, for the places a human rewrote. Drawn nib-down so it reads as
   *  writing rather than as a generic tool. */
  edits:
    "M5 19h3.5L19.4 8.1a1.9 1.9 0 0 0 0-2.7l-.8-.8a1.9 1.9 0 0 0-2.7 0L5 15.5V19Z M14.8 6.6l2.6 2.6",
  /** A drawer with its tab. Used by the archive's folder heading, its cards
   *  and the recording menu's move action, so the same idea keeps the same
   *  drawing in all three. */
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  /** Speech becoming text. The same shape as the transcription progress bubble,
   *  redrawn on this grid instead of being scaled — scaling it non-uniformly
   *  from its own 19×16 box would flatten the peaks. */
  transcription: "M2 12h2.6l2-6.4 3 12.8 2.4-9.4 2 5.2 1.6-2.2H22",
  /** A video on the web: a screen with a play mark in it. The card used to
   *  draw a chain link — two arcs that at 19 px met nowhere and read as
   *  broken. A screen says the same thing and survives being small. */
  video:
    "M3 6.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z M10.2 9.4l4.6 2.6-4.6 2.6V9.4Z",
} as const;

export type LineIconName = keyof typeof LINE_ICONS;

/** One icon in the shared style. Decorative by default: every place that uses
 *  it already names the thing in visible text beside it. */
export function LineIcon({ name, size = 22 }: { name: LineIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {LINE_ICONS[name].split(" M").map((segment, index) => (
        <path key={index} d={index === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}
