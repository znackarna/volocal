/** Strings belonging to the `app` screen. */
export const csApp = {
  "app.name": "Převod řeči na text",
  "app.newTranscript": "Nový přepis",

  // ---------------------------------------------------------------- shell
  /* Dvojtečka, protože jméno součásti je vlastní jméno a ne pokračování věty.
     `Stahuji Menší model jazykové úpravy` se čte jako souvětí, kterému něco
     chybí; `Stahuji: Menší model jazykové úpravy` je popisek a hodnota, což to
     ve skutečnosti je. V bublině se jméno navíc zkracuje třemi tečkami, takže
     věta stejně nikdy nedojde do konce. */
  "app.download.running": "Stahuji: {name}",
  // Said when Transcribe is pressed while something needed is missing. The
  // archive's notice has been saying so above the list; this is what happens
  // when somebody presses anyway, and it carries the way out rather than only
  // the news.
  // Said the moment something needed goes missing while the application is
  // running — a folder emptied in Explorer, a component deleted in Nastavení.
  // The archive's notice says the same thing, but quietly and only where
  // somebody happens to be looking.
  // Said once at start-up when the graphics card is sitting out a run it could
  // have done. `choose_compute` substitutes the processor in silence because a
  // transcription must run; this is so the reader knows the slower run is a
  // stand-in and not how the application is.
  "app.computeFellBack": "Přepis počítá procesor, i když je v počítači grafická karta. Bude trvat déle.",
  "app.computeFellBack.where": "Kde to nastavit",
  "app.setupBroke": "V počítači chybí klíčové nástroje pro přepis.",
  "app.setupFirst": "Přepis zatím nemůže běžet, chybí k němu součásti.",
  "app.download.cancel": "Zrušit stahování",
  "app.shell.statusBar": "Stav aplikace",
  "app.shell.statusItem": "{label}: {value}",
  "app.shell.transcriptCount": "Počet přepisů",
  "app.shell.totalDuration": "Celková délka",
  "app.shell.watchFolder": "Sledovaná složka",
  "app.shell.model": "Model pro nové přepisy",
  "app.shell.documentState": "Stav dokumentu",
  "app.shell.recordingDuration": "Délka nahrávky",
  "app.shell.language": "Jazyk",
  "app.shell.twoLanguages": "{first} a {second}",
  "app.shell.segmentCount": "Počet úseků",

  // --------------------------------------------------------------- notice
  "app.notice.unsupportedFormat":
    "Tento formát neumíme. Zkuste mp3, wav, m4a nebo běžné video.",
  // The one place in the application that argues with the close button. A take
  // lives only in this window until it is saved, and the job object closes the
  // process tree with the window, so this question is the whole of what stands
  // between a recording and nothing.
  "app.recorder.closeTitle": "Zavřít Volocal?",
  "app.recorder.closeWhileRecording":
    "Nahrávání běží a zatím není uložené. Zavřením o něj přijdete.",
  "app.recorder.closeWhileUnsaved":
    "Hotový záznam ještě není uložený. Zavřením o něj přijdete.",
  "app.recorder.closeAnyway": "Zavřít i tak",
  "app.recorder.label": "Záznam",
  "app.recorder.open": "Otevřít nahrávání",
  "app.recorder.stop": "Zastavit záznam",
  "app.notice.audioSaved": "Zvuk byl uložen do {path}.",
  "app.audioFormat.mp3": "MP3 — otevře se všude",
  "app.audioFormat.m4a": "M4A — menší soubor",
  "app.audioFormat.wav": "WAV — bez komprese",
  "app.audioFormat.same": "{format} — beze změny",
  "app.notice.recordingAdded": "Záznam je v archivu.",
  "app.notice.recordingAddedTranscribing": "Záznam je v archivu a přepis začal.",
  "app.notice.onlineAddedTranscribing": "Online nahrávka je přidaná a přepis začal.",
  "app.notice.onlineAdded": "Online nahrávka je přidaná do archivu.",

  // ---------------------------------------------------------------- crash
  "app.crash.title": "Aplikace narazila na chybu",
  "app.crash.text":
    "Okno se nepodařilo vykreslit. Nahrávky ani přepisy v archivu tím nijak netrpí.",
  "app.crash.detailLabel": "Popis chyby, který se hodí poslat dál:",
  "app.crash.reload": "Obnovit okno",

  // ----------------------------------------------------------- file picker
  "app.filePicker.audioAndVideo": "Zvuk a video",

  // --------------------------------------------------------- watch folder
  "app.watchFolder.transcribing.one":
    "Nahrávka byla přidána do Archivu a Volocal zahájil přepis.",
  "app.watchFolder.transcribing.few":
    "Do Archivu byly přidány nové nahrávky ({count}) a Volocal zahájil přepis.",
  "app.watchFolder.transcribing.many":
    "Do Archivu byly přidány nové nahrávky ({count}) a Volocal zahájil přepis.",
  "app.watchFolder.transcribing.other":
    "Do Archivu byly přidány nové nahrávky ({count}) a Volocal zahájil přepis.",

  "app.watchFolder.added.one": "Nahrávka byla přidána do Archivu.",
  "app.watchFolder.added.few": "Do Archivu byly přidány nové nahrávky ({count}).",
  "app.watchFolder.added.many": "Do Archivu byly přidány nové nahrávky ({count}).",
  "app.watchFolder.added.other": "Do Archivu byly přidány nové nahrávky ({count}).",

  // -------------------------------------------------------------- confirm
  "app.confirm.removeTitle": "Odebrat z archivu?",
  "app.confirm.removeText":
    "Přepis nahrávky {title} bude smazán. Zvukový soubor na disku zůstane nedotčený.",
  "app.confirm.removeAction": "Odebrat",
  "app.confirm.deleteTranscriptTitle": "Smazat přepis?",
  "app.confirm.deleteTranscriptText":
    "Text i ruční úpravy u nahrávky {title} budou ztraceny. Nahrávka zůstane v archivu a lze ji přepsat znovu.",
  "app.confirm.deleteTranscriptAction": "Smazat přepis",

  // ------------------------------------------------------------- drop zone
  "app.dropZone.hint": "Pusťte soubor a přepis začne sám",
  "app.dropZone.hintManual": "Pusťte soubor a přidá se do seznamu",

  // ---------------------------------------------------------------- player
  "app.player.preparing": "Připravuji zvuk",
  "app.player.pause": "Pauza",
  "app.player.play": "Přehrát",
  "app.player.openTranscript": "Zpět k přepisu",
  "app.player.sourceMissing": "soubor chybí",
  "app.player.preparingShort": "připravuji…",
  "app.player.stop": "Zastavit přehrávání",
  "app.updateAvailable": "Je k dispozici verze {version}.",
  "app.updateOpen": "Zobrazit",
} as const;

export const csAppContext: Partial<Record<keyof typeof csApp, string>> = {
  "app.crash.title":
    "Nadpis obrazovky, která se objeví místo aplikace, když se okno nepodaří " +
    "vykreslit. Konstatování, ne omluva.",
  "app.crash.text":
    "Věta pod nadpisem. Druhá polovina uklidňuje: chyba je ve vykreslení okna, " +
    "ne v datech.",
  "app.crash.detailLabel": "Popisek nad technickým výpisem chyby, který jde označit a zkopírovat.",
  "app.crash.reload": "Tlačítko, které načte okno aplikace znovu.",
  "app.name":
    "Jméno aplikace v hlavičce okna. Popisuje, co dělá; není to značka.",
  "app.newTranscript":
    "Tlačítko v hlavičce, které otevře přidání nové nahrávky k přepisu.",
  "app.download.running":
    "Bublina v pravém dolním rohu během stahování. {name} je název součásti " +
    "z katalogu; první osoba jako u ostatních průběhů.",
  "app.download.cancel": "Popisek křížku v té bublině.",
  "app.shell.statusBar": "Přístupný popis pruhu se stavem v dolní části okna.",
  "app.shell.statusItem":
    "Přístupný popis jedné položky stavového pruhu: {label} je její název, {value} její hodnota.",
  "app.shell.transcriptCount": "Popisek položky v patičce; hodnotou je počet hotových přepisů.",
  "app.shell.totalDuration": "Popisek položky v patičce; hodnotou je celková délka nahrávek v archivu.",
  "app.shell.watchFolder":
    "Popisek položky v patičce archivu. Vidět je jen název složky, v bublině je celá cesta. Ukazuje se, jen když je sledování zapnuté.",
  "app.shell.model":
    "Popisek položky v patičce archivu; hodnotou je model, kterým poběží další přepis.",
  "app.shell.documentState":
    "Popisek položky v patičce; hodnotou je stav rozpracovaného přepisu, například „Uloženo“.",
  "app.shell.language": "Popisek položky v patičce; hodnotou je jazyk nahrávky.",
  "app.shell.twoLanguages":
    "Hodnota téže položky, když byl do přepisu doplněn druhý jazyk. {first} je velkým písmenem, {second} malým: „Čeština a angličtina“.",
  "app.shell.segmentCount": "Popisek položky v patičce; hodnotou je počet úseků přepisu.",
  "app.notice.unsupportedFormat":
    "Hláška po přetažení souboru, který neumíme otevřít. Vyká uživateli, stejně jako zbytek aplikace.",
  "app.audioFormat.mp3":
    "Název formátu v systémovém dialogu pro uložení zvuku. Za pomlčkou je důvod, proč si ho vybrat.",
  "app.audioFormat.same":
    "Volba v dialogu pro uložení zvuku, když nahrávka už v tom formátu je: soubor se jen zkopíruje. {format} je zkratka jako FLAC.",
  "app.filePicker.audioAndVideo":
    "Název skupiny souborů v systémovém dialogu pro výběr souboru.",
  "app.watchFolder.transcribing.one":
    "Hláška po přidání nahrávek s okamžitým přepisem — ze sledované složky i ručně vybraným či přetaženým souborem. „Volocal“ je název aplikace — nechte ho v každém jazyce tak, jak je.",
  "app.watchFolder.added.one":
    "Hláška po přidání nahrávek bez spuštění přepisu — ze sledované složky i ručně vybraným či přetaženým souborem.",
  "app.confirm.removeText":
    "{title} je název nahrávky. Odebírá se přepis, zvukový soubor zůstává na disku.",
  "app.confirm.deleteTranscriptText": "{title} je název nahrávky.",
  "app.recorder.label":
    "Text v pilulce mini rekordéru v hlavičce, když nahrávání běží minimalizované.",
  "app.recorder.open": "Bublina nad pilulkou; kliknutí otevře dialog záznamu zpátky.",
  "app.recorder.stop":
    "Popisek čtvercového tlačítka v pilulce. Zastaví záznam a otevře dialog, aby hotový záznam nezůstal bez rozhodnutí.",
  "app.dropZone.hint":
    "Text přes celé okno, když uživatel drží přetahovaný soubor nad aplikací. Platí, když je zapnutý automatický přepis.",
  "app.dropZone.hintManual":
    "Tentýž text, když je automatický přepis vypnutý. Soubor se jen přidá; přepis spustí uživatel sám. „Seznam“, ne „archiv“ — mluví se o tom, co se objeví hned pod překryvem.",
  "app.player.preparing":
    "Popis tlačítka mini přehrávače, dokud se zvuk načítá a nejde spustit.",
  "app.player.openTranscript":
    "Bublina u názvu v mini přehrávači. Kliknutí otevře přepis přehrávané nahrávky.",
  "app.player.sourceMissing":
    "Text místo času v mini přehrávači, když zvukový soubor na disku není. Malé písmeno je záměr.",
  "app.player.preparingShort":
    "Text místo času v mini přehrávači, dokud se zvuk načítá. Malé písmeno je záměr.",
  "app.player.stop": "Popis křížku v mini přehrávači. Přehrávání skončí a přehrávač zmizí.",
  "app.updateAvailable":
    "Hláška v notifikační liště po spuštění, když je zapnutá automatická kontrola. Nic se nestahuje. Dřív končila větou „Najdete ji v Nastavení → O aplikaci“ — ta se zrušila, protože cestu teď nese tlačítko vedle a Aktualizace mezitím dostaly vlastní kartu. {version} je číslo verze, například 0.9.1.",
  "app.updateOpen":
    "Tlačítko v té liště. Otevře Nastavení rovnou na kartě Aktualizace, kde je co je nového i stažení. Nestahuje nic samo — proto „Zobrazit“ a ne „Nainstalovat“.",
};
