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

  "domain.modelDescription.large-v3": "Whisper 3 Large. Kvalitnější přepis. Precizní časové značky slov.",
  "domain.modelDescription.large-v3-q5_0": "Whisper 3 Large q5_0. Třetinová náročnost, aplikace ho sama nenabízí.",
  "domain.modelDescription.large-v3-turbo-q5_0": "Whisper 3 Turbo. Rychlejší přepis. Zvuk může získat mírný skluz.",
  "domain.modelDescription.large-v3-turbo": "Whisper 3 Turbo. Bez zmenšení, tedy větší soubor.",
  "domain.modelDescription.medium": "Whisper Medium. Starší generace, aplikace ji sama nenabízí.",
  "domain.modelDescription.medium-q5_0": "Whisper Medium q5_0. Zmenšená starší generace.",
  "domain.modelDescription.small": "Whisper Small. Nejmenší z nalezených, aplikace ho sama nenabízí.",

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
  // The rest of what whisper can hear. Named because the interface says them
  // out loud — "V nahrávce se mluví také velština" — and a bare code says
  // nothing to anybody. Not in `LANGUAGE_CODES`, which is the shorter list the
  // reader picks from.
  "domain.language.zh": "čínština",
  "domain.language.ko": "korejština",
  "domain.language.ja": "japonština",
  "domain.language.pt": "portugalština",
  "domain.language.tr": "turečtina",
  "domain.language.ca": "katalánština",
  "domain.language.nl": "nizozemština",
  "domain.language.ar": "arabština",
  "domain.language.sv": "švédština",
  "domain.language.id": "indonéština",
  "domain.language.hi": "hindština",
  "domain.language.fi": "finština",
  "domain.language.vi": "vietnamština",
  "domain.language.he": "hebrejština",
  "domain.language.el": "řečtina",
  "domain.language.ms": "malajština",
  "domain.language.ro": "rumunština",
  "domain.language.da": "dánština",
  "domain.language.hu": "maďarština",
  "domain.language.ta": "tamilština",
  "domain.language.no": "norština",
  "domain.language.th": "thajština",
  "domain.language.ur": "urdština",
  "domain.language.hr": "chorvatština",
  "domain.language.bg": "bulharština",
  "domain.language.lt": "litevština",
  "domain.language.la": "latina",
  "domain.language.mi": "maorština",
  "domain.language.ml": "malajálamština",
  "domain.language.cy": "velština",
  "domain.language.te": "telugština",
  "domain.language.fa": "perština",
  "domain.language.lv": "lotyština",
  "domain.language.bn": "bengálština",
  "domain.language.sr": "srbština",
  "domain.language.az": "ázerbájdžánština",
  "domain.language.sl": "slovinština",
  "domain.language.kn": "kannadština",
  "domain.language.et": "estonština",
  "domain.language.mk": "makedonština",
  "domain.language.br": "bretonština",
  "domain.language.eu": "baskičtina",
  "domain.language.is": "islandština",
  "domain.language.hy": "arménština",
  "domain.language.ne": "nepálština",
  "domain.language.mn": "mongolština",
  "domain.language.bs": "bosenština",
  "domain.language.kk": "kazaština",
  "domain.language.sq": "albánština",
  "domain.language.sw": "svahilština",
  "domain.language.gl": "galicijština",
  "domain.language.mr": "maráthština",
  "domain.language.pa": "paňdžábština",
  "domain.language.si": "sinhalština",
  "domain.language.km": "khmerština",
  "domain.language.sn": "šonština",
  "domain.language.yo": "jorubština",
  "domain.language.so": "somálština",
  "domain.language.af": "afrikánština",
  "domain.language.oc": "okcitánština",
  "domain.language.ka": "gruzínština",
  "domain.language.be": "běloruština",
  "domain.language.tg": "tádžičtina",
  "domain.language.sd": "sindhština",
  "domain.language.gu": "gudžarátština",
  "domain.language.am": "amharština",
  "domain.language.yi": "jidiš",
  "domain.language.lo": "laoština",
  "domain.language.uz": "uzbečtina",
  "domain.language.fo": "faerština",
  "domain.language.ht": "haitská kreolština",
  "domain.language.ps": "paštština",
  "domain.language.tk": "turkmenština",
  "domain.language.nn": "norština (nynorsk)",
  "domain.language.mt": "maltština",
  "domain.language.sa": "sanskrt",
  "domain.language.lb": "lucemburština",
  "domain.language.my": "barmština",
  "domain.language.bo": "tibetština",
  "domain.language.tl": "tagalog",
  "domain.language.mg": "malgaština",
  "domain.language.as": "ásámština",
  "domain.language.tt": "tatarština",
  "domain.language.haw": "havajština",
  "domain.language.ln": "lingalština",
  "domain.language.ha": "hauština",
  "domain.language.ba": "baškirština",
  "domain.language.jw": "javánština",
  "domain.language.su": "sundština",
  "domain.language.yue": "kantonština",
  "domain.language.auto": "rozpoznaný",
  "domain.language.autoOption": "Rozpoznat automaticky",

  "domain.font.system": "Systémové (Segoe UI)",

  "domain.appLanguage.cs": "Čeština",
  "domain.appLanguage.en": "Angličtina",
} as const;

export const csDomainContext: Partial<Record<keyof typeof csDomain, string>> = {
  "domain.model.large-v3":
    "Uživatelské jméno modelu, který se v popisu pod ním jmenuje Whisper 3 " +
    "Large. Přesnější z dvojice, kterou nabízí průvodce; tam se jmenuje stejně. " +
    "Protipól je Rychlý.",
  "domain.modelDescription.large-v3":
    "Popis pod názvem karty Přesný. **Napsal to majitel a je to převzaté " +
    "doslova** — nezjemňuj, nezostřuj, nepřeformulovávej. Whisper 3 Large je " +
    "název modelu a v každém jazyce zůstává takhle. **„Kvalitnější“ je druhý " +
    "stupeň schválně**: karta nad ní je Rychlý a věta říká, že tenhle model je " +
    "lepší než tamten. Nedělej z toho absolutní tvrzení („bezchybný“, " +
    "„nejlepší“) — na to by musel existovat standard, ke kterému to nikdo " +
    "neměřil. Viz záznam změn ze 14. srpna 2026.",
  "domain.modelDescription.large-v3-turbo-q5_0":
    "Popis pod názvem karty Rychlý, taky **doslova od majitele**. „Mírný " +
    "skluz“ je jeho slovo pro to, čemu naměřená hodnota říká 3,34 s — viz " +
    "záznam změn ze 14. srpna 2026. Nechávej to tak, jak to je.",
  "domain.model.medium": "Starší generace modelu, ne „střední velikost“.",
  "domain.model.small": "Model jen na rychlý náhled, ne „malý“.",
  "domain.language.auto":
    "Doplňuje se do věty o hotovém přepisu: „jazyk: rozpoznaný“. Jde o jazyk, který aplikace sama určila.",
  "domain.font.system": "Písmo, které je v systému. V závorce je jeho název na Windows.",
};
