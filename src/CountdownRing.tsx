/**
 * A ring that empties over the time the thing it sits in has left.
 *
 * Used by the `Uloženo` pill in Settings and by the notice bar at the top of
 * the window, so in both places the message and its own lifetime are one
 * object: nothing vanishes without having shown that it was about to. How long
 * it takes belongs to the surface it stands on — the stylesheet gives each one
 * its duration.
 */
export default function CountdownRing({
  className = "",
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={`odpocet ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6.4"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.7"
      />
      <circle
        className="odpocet-drah"
        cx="8"
        cy="8"
        r="6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}
