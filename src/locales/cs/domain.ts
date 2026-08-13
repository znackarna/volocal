/** Names of things the backend identifies by a stable code: compute backends,
 *  Whisper models, spoken languages, interface fonts.
 *
 *  These are read with `tDynamic`, because the identifier arrives from Rust at
 *  runtime and cannot be checked against `TranslationKey` at compile time. An
 *  unknown identifier falls back to the raw code rather than to an empty label.
 */
export const csDomain = {
  "domain.compute.cuda": "Grafická karta Nvidia (CUDA)",
  "domain.compute.vulkan": "Grafická karta (Vulkan)",
  "domain.compute.cpu": "Procesor (CPU)",
  "domain.compute.default": "Výchozí",
  "domain.compute.auto": "Automaticky",

  "domain.model.large-v3": "Přesný",
  "domain.model.large-v3-q5_0": "Vyvážený",
  "domain.model.large-v3-turbo-q5_0": "Rychlý",
  "domain.model.large-v3-turbo": "Rychlý (plný)",
  "domain.model.medium": "Starší",
  "domain.model.medium-q5_0": "Starší (zmenšený)",
  "domain.model.small": "Náhledový",

  "domain.modelDescription.large-v3": "Nejpřesnější čeština, nejnáročnější model. (3,1 GB)",
  "domain.modelDescription.large-v3-q5_0":
    "Srovnatelná kvalita, třetinová náročnost. (1,1 GB)",
  "domain.modelDescription.large-v3-turbo-q5_0":
    "Méně přesný, několikanásobně rychlejší. (575 MB)",
  "domain.modelDescription.large-v3-turbo": "Rychlý bez zmenšení. (1,6 GB)",
  "domain.modelDescription.medium": "Znatelně víc chyb ve jménech, nedoporučuje se. (1,5 GB)",
  "domain.modelDescription.medium-q5_0": "Zmenšená starší generace. (539 MB)",
  "domain.modelDescription.small": "Jen na rychlý náhled, hodně chyb. (488 MB)",

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
  "domain.compute.vulkan":
    "Vulkan běží na jakékoli grafické kartě, ne jen na AMD. Nepřekládat jako „AMD“.",
  "domain.model.large-v3":
    "Uživatelské jméno modelu Whisper large-v3. Přesnější z dvojice, kterou nabízí průvodce; tam se jmenuje stejně. Protipól je Rychlý.",
  "domain.model.medium": "Starší generace modelu, ne „střední velikost“.",
  "domain.model.small": "Model jen na rychlý náhled, ne „malý“.",
  "domain.language.auto":
    "Doplňuje se do věty o hotovém přepisu: „jazyk: rozpoznaný“. Jde o jazyk, který aplikace sama určila.",
  "domain.font.system": "Písmo, které je v systému. V závorce je jeho název na Windows.",
};
