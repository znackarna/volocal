import type { ReactNode } from "react";

/** Shared treatment for short explanatory notes in settings-style screens. */
export default function InfoNote({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <span className={`drobne settings-info-note ${compact ? "compact" : ""}`}>
      <svg
        className="settings-info-note-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
      >
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.35" />
        <path
          d="M8 7.1v3.7M8 4.8h.01"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinecap="round"
        />
      </svg>
      <span>{children}</span>
    </span>
  );
}
