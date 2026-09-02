/**
 * The box beside a thing the reader is choosing.
 *
 * The native control cannot be drawn to this system in any browser, so the
 * input is hidden — `.check-box-input`, which every caller puts immediately
 * before this — and the box is a span the stylesheet owns. Put both inside a
 * `<label>` and the click, the keyboard and the screen reader all still work.
 *
 * It was drawn for the list of files a watched folder offers and lived under
 * that name until 2 September, when the clip dialog needed the same control
 * for the same question: which of these do you want.
 *
 * **Not the green circle with a tick.** That one means *done* or *installed*
 * — the component list, the release notes, the dictionary — and a control the
 * reader is still choosing with must not wear the mark for finished.
 */
export function CheckBox() {
  return (
    <span className="check-box" aria-hidden>
      <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
        <path
          d="m1.5 5 3 3 6-6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
