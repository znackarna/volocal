/** Strings belonging to the `library` screen. */
export const csLibrary = {
  // Drop zone above the archive list.
  "library.dropZone.title": "Sem přetáhněte nahrávku",
  "library.dropZone.automatic": "Přepis se spustí automaticky. Data neopustí počítač.",
  "library.dropZone.manual": "Přepis spustíte tlačítkem přepsat. Data neopustí počítač.",
  "library.dropZone.add": "Nový přepis",
  "library.dropZone.automatic.label": "Automatický přepis",
  "library.dropZone.automatic.hint": "Spustit přepis hned po přidání nahrávky",

  // Full-text search over the transcripts.
  "library.search.placeholder": "Hledat v přepisech…",
  "library.search.location": "{title} · {time}",

  // Date filter.
  "library.filter.description": "Filtrovat podle data",
  "library.filter.anytime": "Kdykoli",
  "library.filter.today": "Dnes",
  "library.filter.week": "7 dní",
  "library.filter.month": "30 dní",
  "library.filter.pickDay": "Vybrat den…",
  "library.filter.pickAnotherDay": "Vybrat jiný den…",

  // Calendar popover of the date filter.
  "library.calendar.title": "Vybrat den",
  "library.calendar.previousMonth": "Předchozí měsíc",
  "library.calendar.nextMonth": "Další měsíc",
  "library.calendar.weekday.mon": "Po",
  "library.calendar.weekday.tue": "Út",
  "library.calendar.weekday.wed": "St",
  "library.calendar.weekday.thu": "Čt",
  "library.calendar.weekday.fri": "Pá",
  "library.calendar.weekday.sat": "So",
  "library.calendar.weekday.sun": "Ne",

  // Sort order.
  "library.sort.description": "Seřadit nahrávky",
  "library.sort.newest": "Nejnovější",
  "library.sort.oldest": "Nejstarší",
  "library.sort.titleAsc": "A–Z",
  "library.sort.titleDesc": "Z–A",

  // List density.
  "library.view.description": "Zobrazení archivu",
  "library.view.classic": "Klasický výpis",
  "library.view.compact": "Kompaktní výpis",

  // Banner shown when transcription cannot start.
  "library.issues.title": "Volocal zatím neumí přepisovat",
  "library.issues.finish": "Dokončit nastavení",
  "library.dropZone.blocked": "Nahrávku můžete přidat, přepsat ji ale Volocal zatím neumí.",

  // Watch folder banner.
  "library.watchFolder.title.one": "Ve sledované složce přibyl nový soubor",
  "library.watchFolder.title.few": "Ve sledované složce přibyly nové soubory",
  "library.watchFolder.title.many": "Ve sledované složce přibyly nové soubory",
  "library.watchFolder.title.other": "Ve sledované složce přibyly nové soubory",
  "library.watchFolder.question.one": "Chcete ho přidat do archivu, nebo rovnou přepsat?",
  "library.watchFolder.question.few": "Chcete je přidat do archivu, nebo rovnou přepsat?",
  "library.watchFolder.question.many": "Chcete je přidat do archivu, nebo rovnou přepsat?",
  "library.watchFolder.question.other": "Chcete je přidat do archivu, nebo rovnou přepsat?",
  "library.watchFolder.ignoreOne": "Tuto nahrávku už nenabízet",
  "library.watchFolder.files": "Soubory",
  "library.watchFolder.clearSelection": "Zrušit výběr",
  "library.watchFolder.hint": "Křížkem soubor odstraníte. Objeví se znovu, když ho změníte.",
  "library.watchFolder.selection": "Vybráno {selected} z {total}",
  "library.watchFolder.transcribe": "Přepsat",
  "library.watchFolder.transcribeBlocked": "Nejdřív doplňte položky nutné pro přepis.",
  "library.watchFolder.processing": "Zpracovávám…",

  // Recording card.
  "library.card.metadata": "{label}: {value}",
  "library.card.duration": "Délka nahrávky",
  "library.card.language": "Jazyk",
  "library.card.model": "Model",
  "library.card.segments": "Počet úseků",
  "library.card.error": "Chyba",
  "library.card.unknownError": "Neznámá chyba",
  "library.card.transcribe": "Přepsat",
  "library.card.percent": "{value} %",
  "library.card.addedOn": "Datum přidání: {date}",
  "library.card.addedOnUnknown": "Datum přidání není známé",

  // Date badge on the card. Three-letter abbreviations, upper case.
  "library.card.monthUnknown": "DAT",
  "library.card.month.jan": "LED",
  "library.card.month.feb": "ÚNO",
  "library.card.month.mar": "BŘE",
  "library.card.month.apr": "DUB",
  "library.card.month.may": "KVĚ",
  "library.card.month.jun": "ČVN",
  "library.card.month.jul": "ČVC",
  "library.card.month.aug": "SRP",
  "library.card.month.sep": "ZÁŘ",
  "library.card.month.oct": "ŘÍJ",
  "library.card.month.nov": "LIS",
  "library.card.month.dec": "PRO",

  // Progress captions. Used only until the backend sends its own wording.
  "library.card.phase.preparation": "Převádím zvuk",
  "library.card.phase.playback": "Připravuji přesné přehrávání",
  "library.card.phase.transcription": "Přepisuji",
  "library.card.phase.diarization": "Rozpoznávám mluvčí",
  "library.card.phase.saving": "Ukládám",
  "library.card.phase.error": "Chyba",
  "library.card.phase.cancelled": "Přerušeno",
  "library.card.phase.working": "Pracuji",
  "library.card.aiEditing": "Upravuji dokument",

  // Empty states.
  "library.folders.heading": "Složky",
  "library.folders.create": "Nová složka",
  "library.folders.empty": "Zatím tu není žádná složka.",
  "library.folders.count": "Počet přepisů",
  "library.folders.delete": "Smazat složku",
  "library.empty.folder": "Ve složce zatím nic není. Přesuňte sem přepis přes nabídku u nahrávky.",
  "library.empty.filter": "Tomuto filtru neodpovídá žádná nahrávka.",
  "library.empty.results": "Žádné výsledky.",

  // Note under the list.
  "library.notice.concurrent":
    "Souběžně probíhá {count} přepisů. Sdílejí jednu grafickou kartu, postupné zpracování by bylo rychlejší.",
} as const;

export const csLibraryContext: Partial<Record<keyof typeof csLibrary, string>> = {
  "library.issues.title":
    "Nadpis pruhu v Archivu, když chybí něco, bez čeho přepis nepojede. " +
    "„Volocal“ je název aplikace — nechte ho v každém jazyce tak, jak je.",
  "library.issues.finish":
    "Tlačítko v tom pruhu. Otevře průvodce prvním nastavením, ne Nastavení aplikace.",
  "library.dropZone.blocked":
    "Věta pod nadpisem hlavního pruhu, dokud chybí něco nutného pro přepis. " +
    "Nahradí slib o automatickém přepisu, který by aplikace nesplnila. " +
    "„Volocal“ je název aplikace — nechte ho v každém jazyce tak, jak je.",
  "library.dropZone.manual":
    "„tlačítkem přepsat“ odkazuje na tlačítko Přepsat na kartě nahrávky.",
  "library.dropZone.automatic.hint": "Popisek u přepínače Automatický přepis.",

  "library.search.location":
    "Záhlaví jednoho výsledku hledání: název nahrávky a čas, kde se nalezené slovo vyskytuje.",

  "library.filter.anytime":
    "Volba filtru data znamenající „bez omezení“. Zároveň se zobrazí, když vybrané datum nejde přečíst.",
  "library.filter.today": "Volba filtru data: jen dnešní nahrávky.",
  "library.filter.week": "Volba filtru data: nahrávky za posledních 7 dní.",
  "library.filter.month": "Volba filtru data: nahrávky za posledních 30 dní.",
  "library.filter.pickAnotherDay":
    "Stejná volba jako Vybrat den…, jen když už nějaký den vybraný je.",

  "library.calendar.weekday.mon": "Zkratka dne v týdnu v hlavičce kalendáře: pondělí.",
  "library.calendar.weekday.tue": "Zkratka dne v týdnu v hlavičce kalendáře: úterý.",
  "library.calendar.weekday.wed": "Zkratka dne v týdnu v hlavičce kalendáře: středa.",
  "library.calendar.weekday.thu": "Zkratka dne v týdnu v hlavičce kalendáře: čtvrtek.",
  "library.calendar.weekday.fri": "Zkratka dne v týdnu v hlavičce kalendáře: pátek.",
  "library.calendar.weekday.sat": "Zkratka dne v týdnu v hlavičce kalendáře: sobota.",
  "library.calendar.weekday.sun": "Zkratka dne v týdnu v hlavičce kalendáře: neděle.",

  "library.sort.titleAsc": "Řazení podle názvu od začátku abecedy.",
  "library.sort.titleDesc": "Řazení podle názvu od konce abecedy.",

  "library.view.classic": "Zobrazení archivu s vyšším řádkem a všemi údaji.",
  "library.view.compact": "Zobrazení archivu se zhuštěnými řádky.",

  "library.watchFolder.selection":
    "Kolik souborů ze sledované složky je zaškrtnutých. {selected} z {total}.",
  "library.watchFolder.transcribeBlocked":
    "Popisek u zakázaného tlačítka Přepsat, když chybí model nebo jiná náležitost.",
  "library.watchFolder.processing": "Stav tlačítka Přepsat, dokud běží rozhodnutí o souborech.",

  "library.card.metadata":
    "Skládá popisek a hodnotu do jednoho textu pro čtečku obrazovky, například „Jazyk: čeština“.",
  "library.card.duration": "Popisek u ikony na kartě nahrávky. Jak je nahrávka dlouhá.",
  "library.card.language": "Popisek u ikony na kartě nahrávky. Jazyk, ve kterém se mluví.",
  "library.card.model": "Popisek u ikony na kartě nahrávky. Model, kterým se přepisovalo.",
  "library.card.segments": "Popisek u ikony na kartě nahrávky. Kolik úseků přepis má.",
  "library.card.error": "Popisek u ikony na kartě nahrávky. Čím přepis selhal.",
  "library.card.unknownError": "Zobrazí se, když nahrávka selhala, ale nepřišel žádný popis chyby.",
  "library.card.transcribe": "Tlačítko na kartě nahrávky, které spustí přepis.",
  "library.card.percent": "Procenta u ukazatele průběhu. V češtině je před znakem % mezera.",
  "library.card.addedOn": "Popisek datového štítku na kartě. {date} je datum přidání nahrávky.",

  "library.card.monthUnknown":
    "Zkratka na datovém štítku, když datum není známé. Zkráceno ze slova „datum“ na tři znaky, aby se vešlo na místo zkratky měsíce.",
  "library.card.month.jan": "Zkratka měsíce na datovém štítku: leden.",
  "library.card.month.feb": "Zkratka měsíce na datovém štítku: únor.",
  "library.card.month.mar": "Zkratka měsíce na datovém štítku: březen.",
  "library.card.month.apr": "Zkratka měsíce na datovém štítku: duben.",
  "library.card.month.may": "Zkratka měsíce na datovém štítku: květen.",
  "library.card.month.jun": "Zkratka měsíce na datovém štítku: červen.",
  "library.card.month.jul": "Zkratka měsíce na datovém štítku: červenec.",
  "library.card.month.aug": "Zkratka měsíce na datovém štítku: srpen.",
  "library.card.month.sep": "Zkratka měsíce na datovém štítku: září.",
  "library.card.month.oct": "Zkratka měsíce na datovém štítku: říjen.",
  "library.card.month.nov": "Zkratka měsíce na datovém štítku: listopad.",
  "library.card.month.dec": "Zkratka měsíce na datovém štítku: prosinec.",

  "library.card.phase.preparation": "Průběh přepisu: převod zvuku do formátu, který model umí číst.",
  "library.card.phase.playback": "Průběh přepisu: příprava dat pro přesné přehrávání podle textu.",
  "library.card.phase.transcription": "Průběh přepisu: samotný převod řeči na text.",
  "library.card.phase.diarization": "Průběh přepisu: rozdělení textu podle jednotlivých mluvčích.",
  "library.card.phase.saving": "Průběh přepisu: zápis hotového přepisu na disk.",
  "library.card.phase.error": "Průběh přepisu: přepis skončil chybou.",
  "library.card.phase.cancelled": "Průběh přepisu: přepis přerušil uživatel.",
  "library.card.phase.working": "Průběh přepisu, když není známo, co se právě děje.",
  "library.card.aiEditing": "Průběh úpravy hotového přepisu jazykovým modelem.",

  "library.notice.concurrent":
    "Upozornění pod seznamem, když běží víc přepisů najednou. Zobrazuje se od dvou souběžných přepisů výš.",
};
