/** Strings belonging to the `detail` screen. */
export const csDetail = {
  // Descriptions of the export formats. Kept short so the menu label fits on a
  // single line.
  "detail.format.txt": "Textový soubor",
  "detail.format.md": "Markdown",
  "detail.format.srt": "Titulky",
  "detail.format.vtt": "Webové titulky",
  "detail.format.json": "Data pro aplikace",

  "detail.export.button": "Uložit",
  "detail.export.rawGroup": "Hrubý přepis",
  "detail.export.improvedGroup": "Vylepšený přepis",

  "detail.header.improveButton": "Vylepšit",
  "detail.header.improvedButton": "Vylepšený přepis",
  "detail.header.staleHint": "Otevřít uložený výsledek; přepis nebo model se mezitím změnil",
  "detail.header.newTranscript": "Nový přepis",
  "detail.header.deleteTranscriptTitle": "Smazat přepis?",
  "detail.header.deleteTranscriptText":
    "Text i ruční úpravy u nahrávky {title} budou ztraceny. Nahrávka zůstane v archivu a lze ji přepsat znovu.",
  "detail.header.deleteTranscriptConfirm": "Smazat přepis",
  "detail.header.removeTitle": "Odebrat z archivu?",
  "detail.header.removeText":
    "Přepis nahrávky {title} bude smazán. Zvukový soubor na disku zůstane nedotčený.",
  "detail.header.removeConfirm": "Odebrat",

  "detail.progress.percent": "{value} %",
  "detail.progress.transcribing": "Přepisuji",
  "detail.progress.diarizing": "Rozpoznávám mluvčí",
  "detail.progress.editing": "Upravuji dokument",
  "detail.progress.preparingModel": "Připravuji jazykový model",
  "detail.progress.preparingSummary": "Připravuji shrnutí",
  "detail.progress.preparingTranslation": "Připravuji překlad",
  "detail.progress.cancelTranscription": "Zrušit přepis",
  "detail.progress.cancelDiarization": "Zrušit rozpoznávání mluvčích",
  "detail.progress.cancelAi": "Zrušit jazykové zpracování",

  "detail.empty.notTranscribed": "Tato nahrávka ještě není přepsaná.",
  "detail.empty.heading": "Tady bude váš přepis",
  "detail.empty.transcribe": "Přepsat",
  "detail.empty.failed": "Přepis se nepovedl.",
  "detail.empty.noTranscript": "Nahrávka zatím není přepsaná.",

  "detail.source.fileFilter": "Zvuk a video",
  "detail.source.missing":
    "Zvukový soubor už na svém místě není. Přepis zůstává, přehrát ho ale nelze.",
  "detail.source.locate": "Najít soubor",

  "detail.player.hidePanel": "Skrýt postranní panel",
  "detail.player.showPanel": "Zobrazit postranní panel",

  "detail.tips.title": "Rychlé tipy",
  "detail.tips.spaceKey": "mezerník",
  "detail.tips.spaceAction": "přehrát",
  "detail.tips.clickKey": "klik na slovo",
  "detail.tips.clickAction": "posun ve zvuku",
  "detail.tips.doubleClickKey": "dvojklik",
  "detail.tips.doubleClickAction": "úprava textu",
  "detail.tips.tabKey": "F3",
  "detail.tips.tabAction": "další místo ke kontrole",
  "detail.tips.hide": "Skrýt rychlé tipy",
  "detail.tips.hideHint": "Skrýt. Vrátit se dají v nastavení.",

  "detail.sidebar.label": "Postranní panel",

  "detail.review.heading": "Kontrola",
  "detail.review.empty": "Přepis nemá nic ke kontrole.",
  "detail.review.markCorrectTitle": "Je to správně",
  "detail.review.markCorrectLabel": "Označit jako správné",
  "detail.review.fixText": "Opravit text",
  "detail.review.editHint": "Kliknutí přejde na místo, dvojklik otevře text k opravě",

  "detail.edits.heading": "Opravy",
  "detail.edits.empty": "Přepis neobsahuje žádné opravy.",
  "detail.edits.seekTitle": "Přejít na opravené místo",

  "detail.speakers.heading": "Mluvčí",
  "detail.speakers.empty": "Mluvčí zatím nejsou rozpoznaní.",
  "detail.speakers.diarize": "Rozpoznat mluvčí",
  "detail.speakers.diarizeAgain": "Rozpoznat znovu",
  "detail.speakers.diarizing": "Rozpoznávám…",
  "detail.speakers.playSample": "Přehrát ukázku hlasu",
  "detail.speakers.nameHint": "Stejné jméno mluvčí sloučí.",

  "detail.notes.heading": "Poznámky",
  "detail.notes.add": "Přidat",
  "detail.notes.timeLabel": "Čas poznámky",
  "detail.notes.timeHint": "Čas ve formátu 1:23",
  "detail.notes.placeholder": "Napsat poznámku…",
  "detail.notes.seekTo": "Přejít na {time}",
  "detail.notes.seekTitle": "Přejít na čas",
  "detail.notes.empty": "Zatím bez poznámek.",
  "detail.notes.openTitle": "Otevřít poznámku",
  "detail.notes.pinAt": "+ Připnout k {time}",
  "detail.notes.unpin": "Odepnout",

  "detail.menu.play": "Přehrát odsud",
  "detail.menu.copy": "Kopírovat",
  "detail.menu.copied": "Zkopírováno do schránky.",
  "detail.menu.edit": "Opravit text",
  "detail.menu.note": "Poznámka k {time}",

  "detail.ai.missingTitle": "Jazyková úprava není připravená",
  "detail.ai.missingText":
    "Stáhněte si místní model a program pro jazykovou úpravu. Potom bude fungovat bez internetu a text neopustí počítač.",
  "detail.ai.chooseModel": "Vybrat model",
  "detail.ai.configureTitle": "AI vylepšení",
  "detail.ai.configureText": "Vytvoří nový dokument. Původní přepis zůstane beze změny.",
  "detail.ai.modeFaithful": "Věrná úprava",
  "detail.ai.modeFaithfulDescription": "Opraví interpunkci, odstavce a chyby.",
  "detail.ai.modeSpeakers": "Rozpoznání mluvčích",
  "detail.ai.modeSpeakersDescription": "Rozdělí přepis mezi jednotlivé mluvčí podle hlasu.",
  "detail.ai.modeSpeakersMissing": "Součásti pro rozpoznání mluvčích zatím nejsou stažené.",
  "detail.ai.modeSpeakersDone": "Mluvčí už rozpoznaní jsou. Spustí rozpoznání znovu od začátku.",
  "detail.ai.speakersDoneBadge": "hotovo",
  "detail.ai.startSpeakersAgain": "Rozpoznat znovu",
  "detail.ai.startSpeakers": "Rozpoznat mluvčí",
  "detail.ai.modeClean": "Vylepšená úprava",
  "detail.ai.modeCleanDescription": "Odstraní zjevná opakování, přeřeknutí a slovní vatu.",
  "detail.ai.recommended": "doporučeno",
  "detail.ai.configureNote": "Během úpravy můžete dál číst nebo přehrávat nahrávku.",
  "detail.ai.startEdit": "Vylepšit přepis",

  "detail.preview.title": "Vylepšený přepis",
  "detail.preview.subtitle": "Verze bez časových značek zpracovaná pomocí jazykového modelu.",
  "detail.preview.closeLabel": "Zavřít náhled",
  "detail.preview.staleWarning":
    "Přepis nebo vybraný model se od vytvoření této verze změnil. Starší výsledek můžete stále uložit, nebo ho vytvořit znovu.",
  "detail.preview.tabsLabel": "Obsah dokumentu",
  "detail.preview.transcriptTab": "Přepis",
  "detail.preview.summaryTab": "Shrnutí",
  "detail.preview.translationTab": "Překlad",
  "detail.preview.versionLabel": "Verze přepisu",
  "detail.preview.versionImproved": "Vylepšený",
  "detail.preview.versionOriginal": "Původní",
  "detail.preview.lengthLabel": "Délka",
  "detail.preview.lengthGroupLabel": "Délka shrnutí",
  "detail.preview.translateTo": "Přeložit do",
  "detail.preview.translationLanguageLabel": "Jazyk překladu",
  "detail.preview.discard": "Zahodit",
  "detail.preview.regenerateImproved": "Vylepšit znovu",
  "detail.preview.regenerateSummary": "Vytvořit znovu",
  "detail.preview.regenerateTranslation": "Přeložit znovu",
  "detail.preview.copyFailed": "Text se nepodařilo zkopírovat do schránky.",

  "detail.summaryLength.short": "Stručné",
  "detail.summaryLength.shortDescription": "5–7 hlavních bodů",
  "detail.summaryLength.standard": "Běžné",
  "detail.summaryLength.standardDescription": "několik odstavců",
  "detail.summaryLength.detailed": "Podrobné",
  "detail.summaryLength.detailedDescription": "témata a souvislosti",

  // One whole sentence per length. The adjective is declined, so the heading
  // must never be assembled from a fragment and a noun.
  "detail.summary.createShortTitle": "Vytvořit stručné shrnutí",
  "detail.summary.createStandardTitle": "Vytvořit běžné shrnutí",
  "detail.summary.createDetailedTitle": "Vytvořit podrobné shrnutí",
  "detail.summary.emptyText":
    "Model nejprve shrne přepis v původním jazyce. Hotové shrnutí pak přeloží do češtiny.",
  "detail.summary.create": "Vytvořit shrnutí",

  "detail.translation.emptyTitle": "Přeložit celý vylepšený přepis",
  "detail.translation.emptyText": "Překlad zachová odstavce, jména, čísla i popisky mluvčích.",
  "detail.translation.create": "Vytvořit překlad",

  "detail.saved.improved": "Vylepšený přepis byl uložen do {path}.",
  "detail.saved.summary": "Shrnutí byl uložen do {path}.",
  "detail.saved.translation": "Překlad byl uložen do {path}.",

  "detail.copied.improved": "Vylepšený přepis byl zkopírován do schránky.",
  "detail.copied.original": "Původní přepis byl zkopírován do schránky.",
  "detail.copied.summary": "Shrnutí byl zkopírován do schránky.",
  "detail.copied.translation": "Překlad byl zkopírován do schránky.",

  // Single quotes so the typographic and straight quotation marks of the
  // original copy survive without escaping.
  "detail.dictionary.prompt": "Opravovat „{from}“ na „{to}“ i příště?",
  "detail.dictionary.confirm": "Přidat do slovníku",
  "detail.dictionary.decline": "Ne",
  // Nothing was replaced: a different sentence, not a plural form of the one
  // below, so it stays out of the plural set.
  "detail.dictionary.savedNoOther":
    "„{from}“ → „{to}“ je ve slovníku. Jinde v tomto přepisu se nevyskytuje.",
  "detail.dictionary.savedApplied.one":
    "„{from}“ → „{to}“ je ve slovníku. Opraveno i na jednom dalším místě.",
  "detail.dictionary.savedApplied.few":
    "„{from}“ → „{to}“ je ve slovníku. Opraveno i na {count} dalších místech.",
  "detail.dictionary.savedApplied.many":
    "„{from}“ → „{to}“ je ve slovníku. Opraveno i na {count} dalších místech.",
  "detail.dictionary.savedApplied.other":
    "„{from}“ → „{to}“ je ve slovníku. Opraveno i na {count} dalších místech.",

  "detail.segment.wordHint": "Kliknutí přesune přehrávání, dvojklik otevře úpravu textu",
  "detail.segment.editedHint": "Ručně upraveno",
} as const;

export const csDetailContext: Partial<Record<keyof typeof csDetail, string>> = {
  "detail.ai.modeSpeakers":
    "Volba v dialogu vedle úprav textu. Na rozdíl od nich nejde o jazykový model, ale o rozdělení přepisu mezi mluvčí podle hlasu.",
  "detail.ai.startSpeakers": "Hlavní tlačítko dialogu, když je vybrané rozpoznání mluvčích.",
  "detail.format.txt": "Popis formátu TXT v nabídce uložení: prostý text bez formátování.",
  "detail.format.md": "Popis formátu MD. Název značkovacího jazyka Markdown, nepřekládá se.",
  "detail.format.srt": "Popis formátu SRT: titulky s časy pro přehrávače videa.",
  "detail.format.vtt": "Popis formátu VTT: titulky pro přehrávání ve webovém prohlížeči.",
  "detail.format.json":
    "Popis formátu JSON: strojově čitelná data pro další zpracování v jiném programu.",

  "detail.export.button": "Tlačítko v hlavičce, které otevře nabídku formátů uložení.",
  "detail.export.rawGroup":
    "Nadpis skupiny v nabídce uložení. Přepis přímo z rozpoznávání řeči, bez jazykové úpravy.",
  "detail.export.improvedGroup":
    "Nadpis skupiny v nabídce uložení. Verze přepisu upravená jazykovým modelem.",

  "detail.header.improveButton": "Tlačítko spustí jazykovou úpravu přepisu jazykovým modelem.",
  "detail.header.improvedButton":
    "Tlačítko v hlavičce, když už upravená verze existuje — otevře ji.",
  "detail.header.staleHint":
    "Popisek tlačítka, když se přepis nebo model po vytvoření upravené verze změnil.",
  "detail.header.removeConfirm":
    "Potvrzovací tlačítko: odebere nahrávku z archivu. Zvukový soubor na disku zůstane.",

  "detail.progress.percent":
    "Postup dlouhé úlohy v procentech. V češtině je mezi číslem a znakem % mezera.",
  "detail.progress.transcribing": "Stav probíhajícího převodu řeči na text. První osoba, průběh.",
  "detail.progress.diarizing":
    "Stav: program rozděluje nahrávku podle toho, kdo zrovna mluví (diarizace).",
  "detail.progress.editing": "Stav: jazykový model právě upravuje text přepisu.",
  "detail.progress.preparingModel": "Stav před začátkem jazykové úpravy: načítá se model.",
  "detail.progress.cancelDiarization":
    "Popisek křížku v bublině průběhu, když běží rozpoznávání mluvčích.",
  "detail.progress.cancelAi": "Popisek křížku, který přeruší jazykovou úpravu textu.",

  "detail.empty.heading":
    "Nadpis uprostřed prázdné plochy přepisu; přímo pod ním stojí tlačítko Přepsat.",
  "detail.empty.transcribe": "Tlačítko spustí převod řeči na text u dosud nepřepsané nahrávky.",

  "detail.source.fileFilter":
    "Název filtru v systémovém dialogu pro výběr souboru. Zvukové i video soubory.",

  "detail.tips.title": "Nadpis proužku s klávesovými zkratkami pod přehrávačem.",
  "detail.tips.spaceKey": "Název klávesy mezerník.",
  "detail.tips.spaceAction": "Co dělá mezerník. Stojí za názvem klávesy, ne ve větě.",
  "detail.tips.clickKey": "Kliknutí na slovo v přepisu.",
  "detail.tips.clickAction": "Co udělá klik na slovo: přehrávání skočí na dané místo.",
  "detail.tips.doubleClickKey": "Dvojité kliknutí.",
  "detail.tips.doubleClickAction": "Co udělá dvojklik: otevře text k ruční opravě.",
  "detail.tips.tabKey": "Název klávesy F3. Na klávesnicích se nepřekládá.",
  "detail.tips.tabAction": "Co udělá F3: skočí na další úsek, kterým si přepis není jistý.",
  "detail.tips.hideHint":
    "Popisek křížku. Druhá věta říká, že se proužek dá znovu zapnout v nastavení.",

  "detail.sidebar.label": "Popisek postranního panelu pro čtečky obrazovky.",

  "detail.review.empty": "Text místo seznamu, když si přepis nikde nebyl nejistý."
    + " Sloveso zůstává: „slabé místo“ je jen jméno seznamu, ne popis toho jevu.",
  "detail.review.heading":
    "Nadpis seznamu úseků, kterými si rozpoznávání řeči nebylo jisté. Jedno slovo, podstatné jméno jako ostatní sekce panelu. Páruje se s „Opravami“ pod ním: co zbývá projít proti tomu, co je projité.",
  "detail.review.markCorrectTitle":
    "Popisek tlačítka, kterým člověk potvrdí, že nejistý úsek je přepsaný správně.",
  "detail.review.fixText": "Popisek tlačítka, které otevře úsek k ruční opravě.",
  "detail.review.editHint":
    "Bublina nad řádkem v seznamu ke kontrole. Dvě různá gesta, dvě věty oddělené čárkou.",

  "detail.edits.heading":
    "Nadpis seznamu ručních oprav v tomhle přepisu. Podstatné jméno, ne sloveso.",
  "detail.edits.empty":
    "Text místo seznamu, dokud v přepisu nikdo nic ručně neopravil. Druhá osoba, stejně jako jinde v panelu.",
  "detail.edits.seekTitle": "Bublina nad řádkem. Kliknutí přesune přepis na to místo.",

  "detail.speakers.empty":
    "Text místo seznamu, dokud rozpoznání mluvčích neproběhlo.",
  "detail.speakers.heading": "Nadpis seznamu osob, které v nahrávce mluví.",
  "detail.speakers.diarize":
    "Tlačítko spustí rozpoznání jednotlivých mluvčích v nahrávce (diarizaci).",
  "detail.speakers.diarizeAgain": "Totéž jako „Rozpoznat mluvčí“, ale jednou už rozpoznaní byli.",
  "detail.speakers.diarizing": "Stav během rozpoznávání mluvčích. První osoba, průběh.",
  "detail.ai.modeSpeakersDone":
    "Popis karty rozpoznání mluvčích, když už jednou proběhlo.",
  "detail.ai.speakersDoneBadge": "Odznak na kartě: rozpoznání mluvčích už proběhlo.",
  "detail.ai.startSpeakersAgain": "Potvrzovací tlačítko, když mluvčí už rozpoznaní byli.",
  "detail.speakers.playSample":
    "Popisek tlačítka, které přehraje kousek řeči daného mluvčího, aby šlo poznat, kdo to je.",
  "detail.speakers.nameHint":
    "Vysvětlení pod seznamem mluvčích: dva mluvčí se stejným jménem se spojí v jednoho.",

  "detail.notes.heading": "Nadpis sekce s poznámkami k nahrávce.",
  "detail.notes.add": "Tlačítko přidá novou poznámku. Plus vedle popisku kreslí rozhraní, do textu nepatří.",
  "detail.notes.timeHint":
    "Popisek pole s časem poznámky. „1:23“ je příklad zápisu minuty a sekundy.",
  "detail.notes.seekTo":
    "Popisek pro čtečky obrazovky. {time} je čas v nahrávce, například „1:23“.",
  "detail.notes.seekTitle": "Popisek tlačítka, které přesune přehrávání na čas poznámky.",
  "detail.notes.openTitle":
    "Popisek zavřeného lístku s poznámkou. Kliknutím se otevře k úpravě.",
  "detail.notes.pinAt":
    "Tlačítko připne poznámku k místu v nahrávce, kde právě stojí přehrávání. {time} je ta pozice. Znaménko plus je součást popisku.",
  "detail.notes.unpin": "Tlačítko odebere poznámce místo v nahrávce. Poznámka zůstane, jen nebude nikam ukazovat.",

  "detail.menu.play": "Položka nabídky nad přepisem: spustí zvuk od klepnutého slova.",
  "detail.menu.copy":
    "Položka nabídky: zkopíruje označený text, a když nic označené není, celý úsek.",
  "detail.menu.copied": "Potvrzení po zkopírování.",
  "detail.menu.edit": "Položka nabídky: otevře úsek k ruční úpravě textu.",
  "detail.menu.note": "Položka nabídky: založí poznámku připnutou k tomuto času. {time} je mm:ss.",
  "detail.ai.missingTitle":
    "Nadpis dialogu. „Jazyková úprava“ je úprava textu jazykovým modelem, ne změna jazyka.",
  "detail.ai.configureTitle": "Nadpis dialogu, který nastavuje úpravu přepisu jazykovým modelem.",
  "detail.ai.modeFaithful": "Režim úpravy, který nemění formulace, jen je opraví.",
  "detail.ai.modeClean": "Režim úpravy, který text i přeformuluje do čitelnější podoby.",
  "detail.ai.recommended": "Odznak u doporučené volby. Malé písmeno záměrně.",
  "detail.ai.startEdit": "Potvrzovací tlačítko dialogu, spustí jazykovou úpravu.",

  "detail.preview.title": "Nadpis náhledu upravené verze přepisu.",
  "detail.preview.closeLabel": "Popisek křížku, který zavře náhled dokumentu.",
  "detail.preview.transcriptTab": "Záložka náhledu s celým textem přepisu.",
  "detail.preview.summaryTab": "Záložka náhledu se shrnutím obsahu nahrávky.",
  "detail.preview.translationTab": "Záložka náhledu s překladem do jiného jazyka.",
  "detail.preview.versionImproved":
    "Přepínač verze textu: upravená verze. Rod se řídí slovem „přepis“.",
  "detail.preview.versionOriginal":
    "Přepínač verze textu: verze přímo z rozpoznávání řeči. Rod se řídí slovem „přepis“.",
  "detail.preview.lengthLabel": "Popisek přepínače délky shrnutí.",
  "detail.preview.translateTo":
    "Popisek u výběru jazyka. Za popiskem stojí seznam jazyků, věta nepokračuje.",
  "detail.preview.discard": "Tlačítko zahodí upravenou verzi přepisu. Původní přepis zůstane.",
  "detail.preview.regenerateSummary": "Tlačítko nechá shrnutí vytvořit znovu.",

  "detail.summaryLength.short": "Délka shrnutí: nejkratší volba. Rod se řídí slovem „shrnutí“.",
  "detail.summaryLength.shortDescription": "Popisek u volby délky shrnutí. Věta nezačíná.",
  "detail.summaryLength.standard": "Délka shrnutí: prostřední, výchozí volba.",
  "detail.summaryLength.standardDescription": "Popisek u volby délky shrnutí. Věta nezačíná.",
  "detail.summaryLength.detailed": "Délka shrnutí: nejdelší volba.",
  "detail.summaryLength.detailedDescription": "Popisek u volby délky shrnutí. Věta nezačíná.",

  "detail.saved.summary": "Potvrzení po uložení shrnutí. {path} je cesta k souboru.",
  "detail.saved.translation": "Potvrzení po uložení překladu. {path} je cesta k souboru.",

  "detail.dictionary.prompt":
    "Nabídka po ruční opravě jednoho slova. {from} je původní slovo, {to} opravené.",
  "detail.dictionary.confirm":
    "Tlačítko uloží dvojici slov do slovníku náhrad. Poznámka: české znění obsahuje překlep („to slovníku“ místo „do slovníku“), přenesen beze změny.",
  "detail.dictionary.decline": "Odmítnutí nabídky. Odpověď na otázku „…i příště?“.",
  "detail.dictionary.savedNoOther":
    "Potvrzení, že se slovo uložilo, ale v tomhle přepisu už se nikde jinde neobjevilo.",
  "detail.dictionary.savedApplied.one":
    "Potvrzení, že se slovo uložilo a rovnou se opravilo i jinde v přepisu. {count} je počet dalších oprav.",

  "detail.segment.wordHint": "Popisek slova v přepisu. Vysvětluje, co udělá klik a co dvojklik.",
  "detail.segment.editedHint": "Popisek značky u úseku, který někdo ručně opravil.",
};
