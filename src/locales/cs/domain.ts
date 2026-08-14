/** Names of things the backend identifies by a stable code: Whisper models,
 *  spoken languages, interface fonts.
 *
 *  These are read with `tDynamic`, because the identifier arrives from Rust at
 *  runtime and cannot be checked against `TranslationKey` at compile time. An
 *  unknown identifier falls back to the raw code rather than to an empty label.
 *
 *  The five `domain.compute.*` names were here — `Grafická karta (Vulkan)`,
 *  `Procesor (CPU)` and the rest — and are gone with the last screen that
 *  printed one. Nothing names a build to the reader any more: `Výkon` asks for
 *  the card or the processor, and which build suits the card is
 *  `choose_compute`'s business rather than a question or a report.
 */
export const csDomain = {
  "domain.model.large-v3": "Přesný",
  "domain.model.large-v3-q5_0": "Vyvážený",
  "domain.model.large-v3-turbo-q5_0": "Rychlý",
  "domain.model.large-v3-turbo": "Rychlý (plný)",
  "domain.model.medium": "Starší",
  "domain.model.medium-q5_0": "Starší (zmenšený)",
  "domain.model.small": "Náhledový",

  "domain.modelDescription.large-v3": "Whisper large-v3. Kliknutí na slovo přehraje zvuk přesně od něj.",
  "domain.modelDescription.large-v3-q5_0": "Whisper large-v3-q5_0. Třetinová náročnost, aplikace ho sama nenabízí.",
  "domain.modelDescription.large-v3-turbo-q5_0": "Whisper large-v3-turbo. Přepis může být proti zvuku posunutý až o tři sekundy.",
  "domain.modelDescription.large-v3-turbo": "Whisper large-v3-turbo. Bez zmenšení, tedy větší soubor.",
  "domain.modelDescription.medium": "Whisper medium. Starší generace, aplikace ji sama nenabízí.",
  "domain.modelDescription.medium-q5_0": "Whisper medium-q5_0. Zmenšená starší generace.",
  "domain.modelDescription.small": "Whisper small. Nejmenší z nalezených, aplikace ho sama nenabízí.",

  // Lower case: these appear inside sentences such as "přepsáno v čeština".
  // The interface capitalizes them through `capitalize` where a list needs it.
  "domain.language.cs": "čeština",
  "domain.language.sk": "slovenština",
  "domain.language.en": "angličtina",
  "domain.language.de": "němčina",
  "domain.language.pl": "polština",
  "domain.language.uk": "ukrajinština",
  "domain.language.ru": "ruština",
  "domain.language.es": "španělština",
  "domain.language.fr": "francouzština",
  "domain.language.it": "italština",
  "domain.language.auto": "rozpoznaný",
  "domain.language.autoOption": "Rozpoznat automaticky",

  "domain.font.system": "Systémové (Segoe UI)",

  "domain.appLanguage.cs": "Čeština",
  "domain.appLanguage.en": "Angličtina",
} as const;

export const csDomainContext: Partial<Record<keyof typeof csDomain, string>> = {
  "domain.model.large-v3":
    "Uživatelské jméno modelu Whisper large-v3. Přesnější z dvojice, kterou nabízí průvodce; tam se jmenuje stejně. Protipól je Rychlý.",
  "domain.model.medium": "Starší generace modelu, ne „střední velikost“.",
  "domain.model.small": "Model jen na rychlý náhled, ne „malý“.",
  "domain.language.auto":
    "Doplňuje se do věty o hotovém přepisu: „jazyk: rozpoznaný“. Jde o jazyk, který aplikace sama určila.",
  "domain.font.system": "Písmo, které je v systému. V závorce je jeho název na Windows.",
};
