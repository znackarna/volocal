/** A switch with its own title and explanation.
 *
 *  Lifted out of `Settings.tsx` unchanged so the About page can use it too;
 *  importing it back out of `Settings.tsx` would have made a cycle. Nothing
 *  about the markup, the classes or the defaults is different.
 */
import type { ReactNode } from "react";
import InfoNote from "../InfoNote";

export function SettingsToggle({
  title,
  description,
  label,
  checked,
  onChange,
  disabled = false,
  heading = false,
  separated = false,
}: {
  title?: string;
  description: ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  heading?: boolean;
  separated?: boolean;
}) {
  return (
    <div className={`settings-toggle ${heading ? "section" : ""} ${separated ? "separated" : ""}`}>
      <div className="settings-toggle-copy">
        {title && (heading
          ? <h2>{title}</h2>
          : <strong className="settings-toggle-title">{title}</strong>)}
        <InfoNote compact={!heading}>{description}</InfoNote>
      </div>
      <label className="vypinac settings-toggle-control" title={label}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={label}
        />
        <span className="vypinac-drazka" aria-hidden />
      </label>
    </div>
  );
}
