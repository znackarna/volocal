/** Strings shared by more than one screen. A label used on a single screen
 *  belongs in that screen's namespace, not here. */
export const csCommon = {
  "common.archive": "Archiv",
  "common.settings": "Nastavení",
  "common.close": "Zavřít",
  "common.saved": "Uloženo",
  "common.cancel": "Zrušit",
  "common.back": "Zpět",
  "common.add": "Přidat",
  "common.delete": "Smazat",
  "common.open": "Otevřít",
  "common.copy": "Kopírovat",
  "common.save": "Uložit",
  "common.loading": "Načítám…",
  "common.retry": "Zkusit znovu",
  "common.continue": "Pokračovat",
  "common.selectAll": "Vybrat vše",
  "common.rename": "Přejmenovat",
  "common.download": "Stáhnout",
  "common.stop": "Přerušit",
  "common.done": "Hotovo",

  // Units. Kept apart from sentences so a translator can change the spacing
  // and the abbreviation without touching the surrounding text.
  "common.unit.minutes": "{value} min",
  "common.unit.hoursMinutes": "{value} h {minutes} min",
  "common.unit.megabytes": "{value} MB",
  "common.unit.gigabytes": "{value} GB",

  "common.count.segment.one": "{count} úsek",
  "common.count.segment.few": "{count} úseky",
  "common.count.segment.many": "{count} úseku",
  "common.count.segment.other": "{count} úseků",

  "common.count.transcript.one": "{count} přepis",
  "common.count.transcript.few": "{count} přepisy",
  "common.count.transcript.many": "{count} přepisu",
  "common.count.transcript.other": "{count} přepisů",

  "common.count.item.one": "{count} položka",
  "common.count.item.few": "{count} položky",
  "common.count.item.many": "{count} položky",
  "common.count.item.other": "{count} položek",

  "common.count.file.one": "{count} soubor",
  "common.count.file.few": "{count} soubory",
  "common.count.file.many": "{count} souboru",
  "common.count.file.other": "{count} souborů",

  "common.count.minute.one": "{count} minuta",
  "common.count.minute.few": "{count} minuty",
  "common.count.minute.many": "{count} minuty",
  "common.count.minute.other": "{count} minut",
} as const;

export const csCommonContext: Partial<Record<keyof typeof csCommon, string>> = {
  "common.saved": "Stav v patičce okna. Znamená, že rozpracovaný přepis je uložený na disku.",
  "common.stop": "Přeruší probíhající stahování. Není to „zrušit dialog“.",
  "common.count.segment.one":
    "Úsek přepisu — jeden časovaný blok textu mezi dvěma značkami. Anglicky se používá „segment“.",
  "common.count.minute.one":
    "Odhad doby přepisu na kartě v průvodci; za ním následuje „na hodinu " +
    "záznamu“. Tvar pro jednu stál „asi minutu“ a byl dvakrát špatně: zahodil " +
    "číslovku, takže vedle „4 minuty“ na sousední kartě vypadal jako chyba, " +
    "a řekl „asi“ podruhé — poznámka pod kartami už říká, že jsou časy přibližné.",
  "common.unit.hoursMinutes": "Celková délka nahrávek v archivu, například „2 h 05 min“.",
};
