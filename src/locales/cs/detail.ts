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

  "detail.header.speakersButton": "Mluvčí",
  "detail.header.improveButton": "AI nástroje",
  "detail.header.improvedButton": "Vylepšený přepis",
  "detail.header.staleHint": "Otevřít uložený výsledek; přepis nebo model se mezitím změnil",
  "detail.header.speakersMissing":
    "Součásti pro rozpoznání mluvčích zatím nejsou stažené. Tlačítko otevře jejich stažení.",
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
  "detail.progress.preparingCustom": "Připravuji dokument podle vašeho pokynu",
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
  "detail.tips.hideHint": "Skrýt. Vrátit se dají v nastavení rozhraní.",

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
  "detail.speakers.nameHint": "Stejné jméno sloučí mluvčí.",
  "detail.speakers.nameLabel": "Jméno mluvčího",
  "detail.speakers.add": "Přidat",
  "detail.clip.dialogTitle": "Co z výběru uložit?",
  "detail.clip.dialogText": "Vybráno od {from} do {to}, celkem {length}.",
  "detail.clip.shape.audio": "Zvuk",
  "detail.clip.shapeNote.audio": "Vyříznutý kus nahrávky",
  "detail.clip.shape.txt": "Text",
  "detail.clip.shapeNote.txt": "Holý přepis pro citaci",
  "detail.clip.shape.md": "Markdown",
  "detail.clip.shapeNote.md": "Text s mluvčími a časy",
  "detail.clip.shape.srt": "Titulky SRT",
  "detail.clip.shapeNote.srt": "Pro střihové programy a přehrávače",
  "detail.clip.shape.vtt": "Titulky VTT",
  "detail.clip.shapeNote.vtt": "Pro web a videa v prohlížeči",
  "detail.clip.saveButton": "Uložit",
  "detail.clip.saving": "Ukládám…",
  "detail.clip.saved": "Uloženo do {path}.",
  "detail.clip.savedMany.one": "Uložen {count} soubor.",
  "detail.clip.savedMany.few": "Uloženy {count} soubory.",
  "detail.clip.savedMany.many": "Uloženo {count} souboru.",
  "detail.clip.savedMany.other": "Uloženo {count} souborů.",
  "detail.menu.clipSelection": "Exportovat výběr",
  "detail.speakers.addTitle": "Přidat mluvčího",
  "detail.speakers.remove": "Odstranit mluvčího",
  "detail.speakers.removeTitle": "Odstranit mluvčího?",
  "detail.speakers.removeText":
    "{name} zmizí ze seznamu mluvčích. Text přepisu zůstane beze jména.",
  "detail.speakers.removeConfirm": "Odstranit",

  "detail.notes.heading": "Poznámky",
  "detail.notes.add": "Přidat",
  "detail.notes.timeLabel": "Čas poznámky",
  "detail.notes.timeHint": "Čas ve formátu 1:23",
  "detail.notes.placeholder": "Napsat poznámku…",
  "detail.notes.seekTo": "Přejít na {time}",
  "detail.notes.seekTitle": "Přejít na čas",
  "detail.notes.deleteTitle": "Smazat poznámku?",
  "detail.notes.empty": "Zatím bez poznámek.",
  "detail.notes.openTitle": "Otevřít poznámku",
  "detail.notes.pinAt": "+ Připnout k {time}",
  "detail.notes.unpin": "Odepnout",

  "detail.menu.play": "Přehrát odsud",
  "detail.menu.copy": "Kopírovat",
  "detail.menu.copied": "Zkopírováno do schránky.",
  "detail.menu.edit": "Opravit text",
  "detail.menu.note": "Poznámka k {time}",
  "detail.menu.toSpeaker": "Přiřadit mluvčího",
  "detail.menu.newSpeaker": "Nový mluvčí",
  "detail.find.open": "Hledat v přepisu (Ctrl+F)",
  "detail.find.placeholder": "Hledat v přepisu",
  "detail.find.count": "{at} z {total}",
  "detail.find.previous": "Předchozí nález",
  "detail.find.next": "Další nález",
  "detail.unassigned.heading": "Bez jména",
  "detail.unassigned.hint":
    "Tady bylo rozpoznání nejisté. Kliknutím přehrajete a tlačítkem přiřadíte.",
  "detail.unassigned.hearTitle": "Přehrát od tohoto místa",

  "detail.ai.offerTitle": "Chcete z přepisu hotový dokument?",
  "detail.ai.offerText":
    "Model upraví váš přepis přímo v počítači. Jednorázově stáhne asi {size} dat. Stahování běží na pozadí, můžete pracovat dál.",
  "detail.ai.downloadingTitle": "Model se stahuje",
  "detail.ai.downloadingText":
    "Až bude stažený, jazyková úprava se rovnou spustí odsud. Zatím můžete pracovat dál.",
  "detail.ai.configureTitle": "AI nástroje",
  "detail.ai.configureText": "Vytvoří nový dokument. Původní přepis zůstane beze změny.",
  "detail.ai.modeFaithful": "Věrná úprava",
  "detail.ai.modeFaithfulDescription": "Opraví interpunkci, odstavce a chyby.",
  "detail.ai.modeClean": "Vylepšená úprava",
  "detail.ai.modeCleanDescription": "Odstraní zjevná opakování, přeřeknutí a slovní vatu.",
  "detail.ai.recommended": "doporučeno",
  "detail.ai.configureNote": "Během úpravy můžete dál číst nebo přehrávat nahrávku.",
  "detail.ai.startEdit": "Vylepšit přepis",

  "detail.smaller.title": "Model se na tomhle počítači nespustil",
  "detail.smaller.text":
    "Nejspíš je na tenhle počítač velký. Mohlo to být i jednorázové — třeba měl počítač zrovna plno — a pak stačí zkusit znovu. Menší model je už stažený; po přepnutí se zpracování rovnou spustí a vrátit se dá kdykoliv v nastavení, v Jazykové úpravě.",
  "detail.smaller.textDownload":
    "Nejspíš je na tenhle počítač velký. Mohlo to být i jednorázové — třeba měl počítač zrovna plno — a pak stačí zkusit znovu. Menší model tu zatím není; můžeme ho stáhnout. Vrátit se dá kdykoliv v nastavení, v Jazykové úpravě.",
  "detail.smaller.again": "Zkusit znovu",
  "detail.smaller.switch": "Přepnout na menší",
  "detail.smaller.download": "Stáhnout menší",

  "detail.preview.emptyTitle": "Vylepšený přepis nebyl vytvořen",
  "detail.preview.emptyText":
    "Jazykový model z přepisu udělá text bez časových značek, s odstavci a interpunkcí.",
  "detail.preview.emptyDerived":
    "Shrnutí i překlad vznikají z vylepšeného přepisu, takže je potřeba nejdřív.",
  "detail.preview.title": "Vylepšený přepis",
  "detail.preview.subtitle": "Verze bez časových značek zpracovaná pomocí jazykového modelu.",
  "detail.preview.closeLabel": "Zavřít náhled",
  "detail.preview.staleWarning":
    "Přepis nebo vybraný model se od vytvoření této verze změnil. Starší výsledek můžete stále uložit, nebo ho vytvořit znovu.",
  "detail.preview.tabsLabel": "Obsah dokumentu",
  "detail.preview.transcriptTab": "Přepis",
  "detail.preview.summaryTab": "Shrnutí",
  "detail.preview.translationTab": "Překlad",
  "detail.preview.customTab": "Vlastní prompt",
  "detail.preview.versionLabel": "Verze přepisu",
  "detail.preview.versionImproved": "Vylepšený",
  "detail.preview.versionOriginal": "Původní",
  "detail.preview.lengthGroupLabel": "Délka shrnutí",
  "detail.preview.translationLanguageLabel": "Jazyk překladu",
  "detail.preview.discard": "Zahodit",
  "detail.preview.regenerateImproved": "Vylepšit znovu",
  "detail.preview.regenerateSummary": "Vytvořit znovu",
  "detail.preview.regenerateTranslation": "Přeložit znovu",
  "detail.preview.regenerateCustom": "Zpracovat znovu",
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

  // The label, the example and the sentence about the model stand both in the
  // dialog and in the tab of the preview window. One key each, so the two
  // cannot start saying it differently.
  "detail.custom.label": "Váš pokyn",
  "detail.custom.placeholder": "Například: Sepište z přepisu zápis z porady s úkoly a termíny.",
  "detail.custom.privacy": "Pokyn zpracuje jazykový model přímo ve vašem počítači.",
  "detail.custom.create": "Vytvořit dokument",
  "detail.custom.title": "Dokument podle vašeho pokynu",
  "detail.custom.emptyText": "Napište výše, co má model s přepisem udělat.",
  "detail.custom.staleWarning":
    "Přepis se od vytvoření tohoto dokumentu změnil. Starší výsledek můžete stále uložit, nebo ho vytvořit znovu.",

  "detail.saved.improved": "Vylepšený přepis byl uložen do {path}.",
  "detail.saved.summary": "Shrnutí byl uložen do {path}.",
  "detail.saved.translation": "Překlad byl uložen do {path}.",
  "detail.saved.custom": "Dokument byl uložen do {path}.",

  "detail.copied.improved": "Vylepšený přepis byl zkopírován do schránky.",
  "detail.copied.original": "Původní přepis byl zkopírován do schránky.",
  "detail.copied.summary": "Shrnutí byl zkopírován do schránky.",
  "detail.copied.translation": "Překlad byl zkopírován do schránky.",
  "detail.copied.custom": "Dokument byl zkopírován do schránky.",

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

  // Jazyk, který v nahrávce zazněl a v přepisu chybí. Objeví se jen tehdy,
  // když ho vzorkování opravdu našlo — u jednojazyčné nahrávky nikdy.
  "detail.secondLanguage.missing":
    "V nahrávce zní také {language}. Chcete doplnit přepis?",
  "detail.secondLanguage.fill": "Doplnit",
  "detail.secondLanguage.filling": "Doplňuji…",
  "detail.secondLanguage.no": "Nechat být",
  "detail.secondLanguage.added.one": "Doplnili jsme jeden chybějící úsek.",
  "detail.secondLanguage.added.few": "Doplnili jsme {count} chybějící úseky.",
  "detail.secondLanguage.added.many": "Doplnili jsme {count} chybějících úseků.",
  "detail.secondLanguage.added.other": "Doplnili jsme {count} chybějících úseků.",

  // Jména jazyků ve větě „mluví se také anglicky“, tedy příslovce.

  "detail.segment.wordHint": "Kliknutí přesune přehrávání, dvojklik otevře úpravu textu",
  "detail.segment.editedHint": "Ručně upraveno",
} as const;

export const csDetailContext: Partial<Record<keyof typeof csDetail, string>> = {
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

  "detail.header.speakersButton":
    "Tlačítko v hlavičce, které spustí rozpoznání mluvčích. Jen podstatné jméno, protože v hlavičce stojí v řadě jmen — vedle „AI nástroje“. Sloveso „Rozpoznat mluvčí“ zůstává v postranním panelu, kde je nadpis už řekl, o co jde.",
  "detail.header.improveButton":
    "Tlačítko v hlavičce, které otevře dialog s tím, co umí jazykový model. Název je množné číslo a věc, ne sloveso: pod tím tlačítkem jsou tři možnosti a nejsou to tři způsoby vylepšení. „Vylepšit“ stálo pod jednou z nich a slibovalo jen ji.",
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
    "Popisek křížku. Druhá věta říká, kde se proužek dá znovu zapnout — je to " +
    "tlačítko s klávesnicí v řádku přehrávače, které se objeví, až proužek zmizí.",

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
  "detail.speakers.playSample":
    "Popisek tlačítka, které přehraje kousek řeči daného mluvčího, aby šlo poznat, kdo to je.",
  "detail.speakers.nameLabel":
    "Přístupný název pole se jménem mluvčího. Pole nemá vedle sebe viditelný popisek, takže tohle je jediné, co se přečte nahlas.",
  "detail.speakers.nameHint":
    "Vysvětlení pod seznamem mluvčích: dva mluvčí se stejným jménem se spojí v jednoho.",
  "detail.speakers.add":
    "Tlačítko v hlavičce sekce přidá dalšího mluvčího, kterému zatím nepatří žádná pasáž. Stojí vedle „Rozpoznat mluvčí“, takže samotné slovo stačí. Plus kreslí ikona, do textu nepatří.",
  "detail.speakers.addTitle":
    "Bublina toho tlačítka. Tady je potřeba říct, co se přidává.",
  "detail.speakers.remove":
    "Popisek tlačítka u řádku mluvčího, které ho odstraní ze seznamu. Jen ikona koše, text se čte nahlas.",
  "detail.speakers.removeTitle": "Nadpis dotazu před odstraněním mluvčího ze seznamu.",
  "detail.speakers.removeText":
    "Vysvětlení v tom dotazu. {name} je jméno mluvčího a věta jím začíná, bez uvozovacího slova „Mluvčí“. Podstatné je, že se nic nemaže z přepisu — text zůstane, ztratí jen jméno.",
  "detail.speakers.removeConfirm": "Potvrzovací tlačítko toho dotazu.",

  "detail.notes.heading": "Nadpis sekce s poznámkami k nahrávce.",
  "detail.notes.add": "Tlačítko přidá novou poznámku. Plus vedle popisku kreslí rozhraní, do textu nepatří.",
  "detail.notes.timeHint":
    "Popisek pole s časem poznámky. „1:23“ je příklad zápisu minuty a sekundy.",
  "detail.notes.seekTo":
    "Popisek pro čtečky obrazovky. {time} je čas v nahrávce, například „1:23“.",
  "detail.notes.seekTitle": "Popisek tlačítka, které přesune přehrávání na čas poznámky.",
  "detail.notes.deleteTitle":
    "Nadpis potvrzení. Pod ním se ukáže vlastní text té poznámky, takže věta " +
    "nemusí říkat, o kterou jde.",
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
  "detail.menu.toSpeaker":
    "Položka nabídky, která rozbalí seznam mluvčích v nahrávce. Kliknutím na jméno se tenhle blok přiřadí jemu.",
  "detail.menu.newSpeaker":
    "Poslední položka v seznamu mluvčích. Založí dalšího a přiřadí mu tenhle blok — pro člověka, kterého rozpoznání vůbec nenašlo.",
  "detail.find.placeholder":
    "Zástupný text v poli pro hledání uvnitř otevřeného přepisu. Krátké, pole je úzké.",
  "detail.find.count":
    "Kolikátý nález z kolika. {at} a {total} jsou čísla, například „3 z 17“.",
  "detail.unassigned.heading":
    "Nadpis sekce v postranním panelu. Krátký, vedle Mluvčí, Kontrola, Opravy a Poznámky.",
  "detail.unassigned.hint":
    "Věta nad seznamem. Vysvětluje, co v něm je a co s tím.",
  "detail.unassigned.hearTitle":
    "Bublina u řádku se vsuvkou. Klepnutí přehraje zvuk od jejího začátku, nejen na ni najede.",
  "detail.ai.offerTitle":
    "Nadpis dialogu, který se ptá jednou: chcete jazykovou úpravu? Ptá se ve " +
    "chvíli, kdy o dokument uživatel poprvé stojí. Který model to bude, se " +
    "neptáme — vyplývá to z volby z průvodce.",
  "detail.ai.offerText":
    "Věta v tom dialogu. {size} je velikost stahovaných součástí i s jednotkou, " +
    "například „3,3 GB“.",
  "detail.ai.downloadingTitle":
    "Nadpis téhož dialogu, když už stahování běží a uživatel zmáčkl tlačítko podruhé.",
  "detail.ai.configureTitle":
    "Nadpis dialogu, který nastavuje úpravu přepisu jazykovým modelem. Stejné jméno jako tlačítko, které ho otevírá — dveře a místnost za nimi se jmenují stejně.",
  "detail.ai.modeFaithful": "Režim úpravy, který nemění formulace, jen je opraví.",
  "detail.ai.modeClean": "Režim úpravy, který text i přeformuluje do čitelnější podoby.",
  "detail.ai.recommended": "Odznak u doporučené volby. Malé písmeno záměrně.",
  "detail.ai.startEdit": "Potvrzovací tlačítko dialogu, spustí jazykovou úpravu.",
  "detail.smaller.title":
    "Nadpis dialogu, který přijde poté, co se jazykový model na tomhle stroji nepodařilo spustit. Říká, co se stalo, ne co si aplikace myslí o počítači — nic neměřila dopředu, jen ten pokus selhal.",
  "detail.smaller.text":
    "Text toho dialogu, když menší model už na disku je. „Nejspíš“ je záměr: aplikace ví, že se to nespustilo, ne proč. Druhá věta přiznává, že to mohla být chvilková věc — proto je vedle přepnutí i „Zkusit znovu“. Poslední věta jmenuje kartu, kde se to dá vrátit; přepnutí je změna nastavení, ne jednorázová výjimka.",
  "detail.smaller.textDownload":
    "Totéž, když menší model stažený není. Tlačítko pak vede na stahování, ne na přepnutí.",
  "detail.smaller.again":
    "Tlačítko: zopakuje totéž s týmž modelem a nic nezmění. Pro případ, že selhání bylo chvilkové.",
  "detail.smaller.switch": "Tlačítko: uloží menší model do nastavení a rovnou zopakuje, co se nepovedlo.",
  "detail.smaller.download": "Tlačítko: otevře stahování menšího modelu.",

  "detail.custom.label": "Popisek pole, do kterého uživatel píše vlastní pokyn pro model.",
  "detail.custom.placeholder":
    "Šedý text v prázdném poli pro vlastní pokyn. Ukázka toho, co si lze vyžádat.",
  "detail.custom.privacy":
    "Poznámka s ikonkou „i“ pod polem pro vlastní pokyn. Ubezpečení, že model běží v počítači uživatele — právě u vlastního pokynu lidé předpokládají službu na internetu. Ubezpečení nese samo spojení „přímo ve vašem počítači“ vedle informační ikonky, proto věta nic dalšího netvrdí.",
  "detail.custom.create": "Tlačítko spustí zpracování přepisu podle napsaného pokynu.",
  "detail.custom.title":
    "Název dokumentu, který vznikl podle vlastního pokynu. Nadpis okna i prázdné záložky.",
  "detail.custom.emptyText": "Pobídka v prázdné záložce: pokyn se píše do pole nad ní.",
  "detail.custom.staleWarning":
    "Upozornění nad dokumentem, který vznikl z jiné podoby přepisu, než jaká je v archivu teď.",
  "detail.header.speakersMissing":
    "Popisek tlačítka Rozpoznat mluvčí, když k tomu chybí stažené součásti.",

  "detail.preview.emptyTitle":
    "Nadpis prázdné záložky ve všech třech kartách, které vylepšený přepis potřebují. Pojmenovává chybějící krok, ne stav: „nebyl vytvořen“ ukazuje na tlačítko pod tím, kdežto „zatím není“ to spojení nechávalo na čtenáři. Trpný rod je tu záměr — nezajímá, kdo ho nevytvořil.",
  "detail.preview.emptyText":
    "Věta v té prázdné záložce na kartě Přepis: co z toho vznikne.",
  "detail.preview.emptyDerived":
    "Táž věta na kartách Shrnutí a Překlad. Říká, proč je tam prázdno — obojí se dělá z vylepšeného přepisu, ne z původního.",
  "detail.preview.title": "Nadpis náhledu upravené verze přepisu.",
  "detail.preview.closeLabel": "Popisek křížku, který zavře náhled dokumentu.",
  "detail.preview.transcriptTab": "Záložka náhledu s celým textem přepisu.",
  "detail.preview.summaryTab": "Záložka náhledu se shrnutím obsahu nahrávky.",
  "detail.preview.translationTab": "Záložka náhledu s překladem do jiného jazyka.",
  "detail.preview.customTab":
    "Záložka náhledu s dokumentem podle vlastního pokynu uživatele. „Prompt“ se nepřekládá.",
  "detail.preview.versionImproved":
    "Přepínač verze textu: upravená verze. Rod se řídí slovem „přepis“.",
  "detail.preview.versionOriginal":
    "Přepínač verze textu: verze přímo z rozpoznávání řeči. Rod se řídí slovem „přepis“.",
  "detail.preview.discard": "Tlačítko zahodí upravenou verzi přepisu. Původní přepis zůstane.",
  "detail.preview.regenerateSummary": "Tlačítko nechá shrnutí vytvořit znovu.",
  "detail.preview.regenerateCustom":
    "Tlačítko spustí zpracování podle téhož pokynu znovu a nahradí předchozí výsledek.",

  "detail.summaryLength.short": "Délka shrnutí: nejkratší volba. Rod se řídí slovem „shrnutí“.",
  "detail.summaryLength.shortDescription": "Popisek u volby délky shrnutí. Věta nezačíná.",
  "detail.summaryLength.standard": "Délka shrnutí: prostřední, výchozí volba.",
  "detail.summaryLength.standardDescription": "Popisek u volby délky shrnutí. Věta nezačíná.",
  "detail.summaryLength.detailed": "Délka shrnutí: nejdelší volba.",
  "detail.summaryLength.detailedDescription": "Popisek u volby délky shrnutí. Věta nezačíná.",

  "detail.saved.summary": "Potvrzení po uložení shrnutí. {path} je cesta k souboru.",
  "detail.saved.translation": "Potvrzení po uložení překladu. {path} je cesta k souboru.",
  "detail.saved.custom":
    "Potvrzení po uložení dokumentu podle vlastního pokynu. {path} je cesta k souboru.",
  "detail.copied.custom": "Potvrzení po zkopírování dokumentu podle vlastního pokynu.",

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
