import { useMemo } from "react";
import { useI18n } from "./i18n";
import { FONTS, LANGUAGE_CODES } from "./types";

/** Names for identifiers that arrive from the backend.
 *
 *  These cannot be plain constants. A constant is evaluated once at module load,
 *  outside React, so it could never follow a language change. Reading them
 *  through a hook keeps every label in step with the active language.
 *
 *  Every lookup falls back to the raw identifier, so an unknown model or
 *  language from a newer backend shows its code instead of an empty label.
 */
export function useLabels() {
  const { tDynamic, capitalize, compare } = useI18n();

  return useMemo(() => {
    // Older settings wrote the Czech value for "default"; the dictionary is
    // keyed in English. Translate it here rather than in every caller.
    const computeKey = (id: string) => (id === "vychozi" ? "default" : id);

    const language = (code: string) => tDynamic(`domain.language.${code}`, code);

    return {
      compute: (id: string) => tDynamic(`domain.compute.${computeKey(id)}`, id),
      model: (id: string) => tDynamic(`domain.model.${id}`, id),
      modelDescription: (id: string, fallback: string) =>
        tDynamic(`domain.modelDescription.${id}`, fallback),
      language,
      /** Sentence-initial or standalone use, where the lower-case dictionary
       *  form would look like a mistake. */
      languageCapitalized: (code: string) => capitalize(language(code)),
      languageOptions: () => [
        { value: "auto", label: tDynamic("domain.language.autoOption", "auto") },
        ...LANGUAGE_CODES.map((code) => ({
          value: code,
          label: capitalize(language(code)),
        })),
      ],
      fontTitle: (id: string) => {
        const font = FONTS[id];
        if (!font) return id;
        return font.titleKey ? tDynamic(font.titleKey, font.title) : font.title;
      },
      compareLabels: compare,
    };
  }, [tDynamic, capitalize, compare]);
}
