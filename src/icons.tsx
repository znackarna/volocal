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
  /** A voice nobody has named yet. The question mark sits in the same circle
   *  the model icon's outer ring uses, so it weighs what its neighbours weigh.
   *  Distinct from `review`, which is an eye: that section asks for a reading
   *  pass, this one asks a question only the reader can answer. */
  unnamed:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M9.1 9.5a3 3 0 0 1 5.8 1c0 2-2.9 2.9-2.9 2.9 M12 17.3h.01",
  /** A pencil, for the places a human rewrote. Drawn nib-down so it reads as
   *  writing rather than as a generic tool. */
  edits:
    "M5 19h3.5L19.4 8.1a1.9 1.9 0 0 0 0-2.7l-.8-.8a1.9 1.9 0 0 0-2.7 0L5 15.5V19Z M14.8 6.6l2.6 2.6",
  /** A trash can. Used by the recording menu and by the speaker rows in the
   *  transcript's panel: both take something off a list for good. */
  remove: "M4 7h16 M10 4h4 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
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
  /** A release tag, for the version row on `Informace`. The dot is its hole,
   *  drawn the way `unnamed` draws its full stop — a zero-length path with a
   *  round cap — so the two weigh the same. */
  tag:
    "M11.6 3H5a2 2 0 0 0-2 2v6.6a2 2 0 0 0 .6 1.4l7.4 7.4a2 2 0 0 0 2.8 0l6.6-6.6a2 2 0 0 0 0-2.8L13 3.6a2 2 0 0 0-1.4-.6Z M7.4 8.4h.01",
  /** One person, for the author row beside it. Deliberately not `speakers`,
   *  which is two of them at a smaller radius and means the voices in a
   *  recording: same subject matter, different idea, so a different drawing
   *  rather than one glyph asked to mean both. */
  author:
    "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 20v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1",
  /** A graphics card: a wide board with its fan, and nothing else.
   *
   *  Two subpaths, which is what `video` and `note` are built from — the first
   *  attempt added the bracket pins and a row of memory and came out as a
   *  drawing of a board rather than a silhouette of one. At 22 px inside a
   *  38 px circle the detail turns to grain, and the set's rule is that the
   *  icons look like each other before any one of them looks good.
   *
   *  It is deliberately a different object from `compute`, which is a die with
   *  its legs: the pair on `Výkon` is the chip already in the machine against
   *  the card you add to it, and telling those two apart at that size is the
   *  whole job. `compute` was not reused for both — the wizard's detected block
   *  uses it for the line about graphics drivers, but one glyph standing for
   *  both halves of a two-card choice would make the choice unreadable. */
  graphicsCard:
    "M4 7h16a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 7Z M9 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  /* An `automatic` glyph stood here — one path forking into two arrows — for a
     third compute card reading `Automaticky`. There is no third card: automatic
     is the absence of a pick, said in a sentence under the two. An icon with no
     user is a drawing nobody will remember the reason for, so it is gone. */
  /* One square drawn at three sizes, for the language-editing models —
     `Menší`, `Střední`, `Větší`.

     The same shape at a different size, because size is the only thing known
     about the difference between those models: nothing in `docs/history/` has
     ever compared their output, and the entry that once gave them one, two and
     three sparkles says they "trade nothing; they do the same work with more of
     it". A drawing that changed shape as well would be saying something else.

     Worth knowing before reusing them: they read as a set and are weak alone.
     Only one is ever on the screen at a time — the card on `Přepis` names the
     model that follows the first-run answer — so beside that word the glyph
     reinforces rather than informs. That is the honest ceiling for a pair whose
     whole meaning is a comparison. */
  sizeSmall: "M9 7h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
  sizeMedium:
    "M8 5.5h8A2.5 2.5 0 0 1 18.5 8v8a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 16V8A2.5 2.5 0 0 1 8 5.5Z",
  sizeLarge: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z",
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

/** Icon reflecting what a transcription model is known for: speed, balance or
 *  accuracy. 1.6 stroke on a 22 square, like the rest of the UI.
 *
 *  It lived in `Settings.tsx` and is here because the wizard's two quality
 *  cards draw the same two models Settings lists — the lightning is
 *  `large-v3-turbo`, the target is `large-v3` — and the same model must not
 *  wear one drawing on the first screen and another on the fifth. Importing it
 *  out of `Settings.tsx` would have made a cycle, which is the same reason
 *  `SettingsToggle` moved into `settings/toggle.tsx`.
 *
 *  Keyed on the model identifier rather than on a passed name, so an unknown
 *  model still gets the drawing its family implies. */
export function ModelMark({ id }: { id: string }) {
  const drawing = id.includes("turbo")
    ? // lightning — speed
      "M13 3L5.5 13.2h5L10 21l7.5-10.2h-5L13 3Z"
    : id.includes("q5") || id.includes("q4")
      ? // scales — a balance struck
        "M12 4v16 M7 20h10 M4 8h16 M4 8l-2.5 6h5L4 8 M20 8l-2.5 6h5L20 8"
      : id.includes("medium") || id.includes("small")
        ? // a smaller circle — a smaller model
          "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"
        : // target — highest accuracy
          "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 11.4a0.6 0.6 0 1 0 0 1.2 0.6 0.6 0 0 0 0-1.2Z";

  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {drawing.split(" M").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}
