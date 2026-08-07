/** Strings belonging to the `app` screen. */
export const csApp = {
  "app.name": "Převod řeči na text",
  "app.newTranscript": "Nový přepis",

  // ---------------------------------------------------------------- shell
  "app.download.running": "Stahuji {name}",
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
  "app.shell.segmentCount": "Počet úseků",

  // --------------------------------------------------------------- notice
  "app.notice.unsupportedFormat":
    "Tento formát neumíme. Zkuste mp3, wav, m4a nebo běžné video.",
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
    "Nahrávka byla přidána do Archivu a Slobot zahájil přepis.",
  "app.watchFolder.transcribing.few":
    "Do Archivu byly přidány nové nahrávky ({count}) a Slobot zahájil přepis.",
  "app.watchFolder.transcribing.many":
    "Do Archivu byly přidány nové nahrávky ({count}) a Slobot zahájil přepis.",
  "app.watchFolder.transcribing.other":
    "Do Archivu byly přidány nové nahrávky ({count}) a Slobot zahájil přepis.",

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
    "Hláška po přidání nahrávek s okamžitým přepisem — ze sledované složky i ručně vybraným či přetaženým souborem. „Slobot“ je název aplikace — nechte ho v každém jazyce tak, jak je.",
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
};
