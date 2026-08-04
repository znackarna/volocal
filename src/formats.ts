import { useMemo } from "react";
import { useI18n } from "./i18n";

/** Counts, durations, and sizes rendered for reading rather than for parsing.
 *
 *  Every one of these used to be a hand-written Czech function, duplicated
 *  across screens. Czech needs four grammatical forms and English two, so the
 *  choice belongs to `Intl.PluralRules` and the sentence belongs to the
 *  dictionary. Nothing here assembles a phrase from fragments.
 */
export function useFormats() {
  const { t, tPlural, formatNumber } = useI18n();

  return useMemo(
    () => ({
      segmentCount: (count: number) => tPlural("common.count.segment", count),
      transcriptCount: (count: number) => tPlural("common.count.transcript", count),
      itemCount: (count: number) => tPlural("common.count.item", count),
      fileCount: (count: number) => tPlural("common.count.file", count),
      /** Rough estimate shown in the setup wizard. */
      approximateMinutes: (count: number) => tPlural("common.count.minute", count),

      /** Total length of everything in the archive, rounded to whole minutes. */
      archiveDuration: (seconds: number) => {
        if (seconds <= 0) return t("common.unit.minutes", { value: 0 });
        const minutes = Math.max(1, Math.round(seconds / 60));
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return hours > 0
          ? t("common.unit.hoursMinutes", {
              value: formatNumber(hours),
              minutes: String(rest).padStart(2, "0"),
            })
          : t("common.unit.minutes", { value: formatNumber(minutes) });
      },

      /** Download sizes. The decimal separator follows the active language, so
       *  this must never be produced by a manual string replacement. */
      dataSize: (megabytes: number) =>
        megabytes >= 1024
          ? t("common.unit.gigabytes", {
              value: formatNumber(megabytes / 1024, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            })
          : t("common.unit.megabytes", { value: formatNumber(megabytes) }),
    }),
    [t, tPlural, formatNumber]
  );
}
