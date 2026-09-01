/**
 * The settings screen, mounted for a test.
 *
 * Imports `Settings`, and therefore the modules a test replaces — so a
 * `vi.mock` factory must never reach for this file. It takes
 * `screen.fixtures.ts` instead.
 */
import type { ComponentProps } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import SettingsScreen from "../Settings";
import { I18nProvider } from "../i18n";
import { enCommon } from "../locales/en/common";
import { enSettings } from "../locales/en/settings";

export const say = (key: keyof typeof enSettings) => enSettings[key]!;
export const sayCommon = (key: keyof typeof enCommon) => enCommon[key]!;

type SettingsProps = ComponentProps<typeof SettingsScreen>;

/** Mounts the screen. Pass only what a test cares about; the rest are the
 *  quiet defaults of somebody opening Settings from the archive. */
export function show(over: Partial<SettingsProps> = {}) {
  return render(
    <I18nProvider>
      <SettingsScreen
        onComplete={vi.fn()}
        onError={vi.fn()}
        onInfo={vi.fn()}
        onToModule={vi.fn()}
        foundUpdate={null}
        fetching={false}
        {...over}
      />
    </I18nProvider>
  );
}

/** The tab strip's buttons, by the name written on them. */
export function tabButton(container: HTMLElement, name: string) {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name
  );
  if (!found) throw new Error(`no tab named ${name} is on the screen`);
  return found;
}
