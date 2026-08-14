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
  /** Required, and it stays required. It was briefly made optional so that
   *  `Automatická kontrola` could take its sentence from a line elsewhere on
   *  the card; the owner turned that down, and the rule it broke is worth
   *  keeping in the type: **every switch says under its own heading what
   *  turning it on does.** A screen where some do and some do not reads as an
   *  accident, and the reader has to look around to find the missing half. */
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
      <label className="switch settings-toggle-control" title={label}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={label}
        />
        <span className="switch-track" aria-hidden />
      </label>
    </div>
  );
}
