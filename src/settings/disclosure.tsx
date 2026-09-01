/**
 * A band that opens. Used where a card carries something worth a look but not
 * worth the room it takes when nobody is looking.
 */
import type { ReactNode } from "react";

export function SettingsDisclosure({
  title,
  badge,
  children,
  /** Called the first time it is opened, for content worth fetching only then. */
  onOpen,
  /** `card-footer` when it is the last band of a card and wants its own rule. */
  className = "",
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <details
      className={`settings-disclosure ${className}`.trim()}
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) onOpen?.();
      }}
    >
      <summary>
        <svg className="settings-disclosure-chevron" width="10" height="10"
             viewBox="0 0 10 10" aria-hidden>
          <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{title}</span>
        {badge}
      </summary>
      <div className="settings-disclosure-content">{children}</div>
    </details>
  );
}
