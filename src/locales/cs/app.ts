/** Strings belonging to the `app` screen. */
export const csApp = {
  "app.name": "Převod řeči na text",
  "app.newTranscript": "Nový přepis",

  // ---------------------------------------------------------------- shell
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
    "Tenhle formát neumíme. Zkus mp3, wav, m4a nebo běžné video.",
  "app.notice.onlineAddedTranscribing": "Online nahrávka je přidaná a přepis začal.",
  "app.notice.onlineAdded": "Online nahrávka je přidaná do archivu.",

  // ----------------------------------------------------------- file picker
  "app.filePicker.audioAndVideo": "Zvuk a video",

  // --------------------------------------------------------- watch folder
  "app.watchFolder.transcribing.one": "Nahrávka je v Archivu a přepis začal.",
  "app.watchFolder.transcribing.few":
    "Do Archivu přibyly nové nahrávky ({count}) a přepis začal.",
  "app.watchFolder.transcribing.many":
    "Do Archivu přibyly nové nahrávky ({count}) a přepis začal.",
  "app.watchFolder.transcribing.other":
    "Do Archivu přibyly nové nahrávky ({count}) a přepis začal.",

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
  "app.dropZone.hint": "Pusť soubor a přepis začne sám",
  "app.dropZone.hintManual": "Pusť soubor a přidá se do seznamu",

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
  "app.name":
    "Jméno aplikace v hlavičce okna. Popisuje, co dělá; není to značka.",
  "app.newTranscript":
    "Tlačítko v hlavičce, které otevře přidání nové nahrávky k přepisu.",
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
    "Hláška po přetažení souboru, který neumíme otevřít. Tyká uživateli, stejně jako zbytek aplikace.",
  "app.filePicker.audioAndVideo":
    "Název skupiny souborů v systémovém dialogu pro výběr souboru.",
  "app.watchFolder.transcribing.one":
    "Hláška poté, co aplikace sama převzala soubory ze sledované složky a rovnou je začala přepisovat.",
  "app.watchFolder.added.one":
    "Hláška poté, co aplikace sama převzala soubory ze sledované složky, ale přepis nezačal.",
  "app.confirm.removeText":
    "{title} je název nahrávky. Odebírá se přepis, zvukový soubor zůstává na disku.",
  "app.confirm.deleteTranscriptText": "{title} je název nahrávky.",
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
