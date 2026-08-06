/** Strings belonging to the `dialogs` group. */
export const csDialogs = {
  "dialogs.retranscribe.title": "Přepsat znovu?",
  "dialogs.retranscribe.textOne":
    "Hotový přepis nahrávky {title} nahradí nový. Ruční opravy i odklepnutá místa se ztratí.",
  "dialogs.retranscribe.textMany.one":
    "Hotový přepis jedné nahrávky nahradí nový. Ruční opravy i odklepnutá místa se ztratí.",
  "dialogs.retranscribe.textMany.few":
    "Hotové přepisy {count} nahrávek nahradí nové. Ruční opravy i odklepnutá místa se ztratí.",
  "dialogs.retranscribe.textMany.many":
    "Hotové přepisy {count} nahrávek nahradí nové. Ruční opravy i odklepnutá místa se ztratí.",
  "dialogs.retranscribe.textMany.other":
    "Hotové přepisy {count} nahrávek nahradí nové. Ruční opravy i odklepnutá místa se ztratí.",
  "dialogs.retranscribe.confirm": "Přepsat znovu",

  "dialogs.speakers.title": "Kolik lidí v nahrávce mluví?",
  "dialogs.speakers.intro":
    "Pokud znáte počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Odhad se na dvou lidech často splete.",
  "dialogs.speakers.introMany.one":
    "Pokud znáte počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávku.",
  "dialogs.speakers.introMany.few":
    "Pokud znáte počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávky.",
  "dialogs.speakers.introMany.many":
    "Pokud znáte počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávky.",
  "dialogs.speakers.introMany.other":
    "Pokud znáte počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávek.",
  "dialogs.speakers.exactLabel": "Přesný počet mluvčích",
  "dialogs.speakers.morePlaceholder": "víc",
  "dialogs.speakers.note": "Odpověď platí jen pro tento přepis, v nastavení se nic nemění.",
  "dialogs.speakers.unknown": "Nevím",
  "dialogs.speakers.confirm": "Přepsat",
  // Add recording dialog — source picker.
  "dialogs.addRecording.title": "Nový přepis",
  "dialogs.addRecording.prompt": "Vyberte, odkud chcete zvuk přidat.",
  "dialogs.addRecording.localFile": "Místní soubor",
  "dialogs.addRecording.localFileNote": "Zvuk nebo video uložené v počítači.",
  "dialogs.addRecording.onlineVideo": "Online video",
  "dialogs.addRecording.onlineVideoNote": "YouTube nebo jiný podporovaný web.",

  // Add recording dialog — online video step.
  "dialogs.addRecording.onlineTitle": "Online video",
  "dialogs.addRecording.onlinePrompt":
    "Vložte odkaz. Aplikace stáhne jen zvuk a přidá ho do archivu.",
  "dialogs.addRecording.urlLabel": "Odkaz na video",
  "dialogs.addRecording.urlPlaceholder": "https://www.youtube.com/watch?v=…",
  "dialogs.addRecording.downloadNote":
    "Při prvním použití se stáhne podpora online videí (asi 60 MB).",
  "dialogs.addRecording.invalidUrl": "Vložte platný odkaz začínající http:// nebo https://.",
  "dialogs.addRecording.preparingSupport": "Připravuji podporu online videí · {percent} %",
  "dialogs.addRecording.finishingSupport": "Dokončuji podporu online videí",
  "dialogs.addRecording.preparingVideo": "Připravuji online video",
  "dialogs.addRecording.percent": "{value} %",
  "dialogs.addRecording.submitting": "Přidávám…",
  "dialogs.addRecording.submit": "Stáhnout a přidat",

  "dialogs.addRecording.microphone": "Nový záznam",
  "dialogs.addRecording.microphoneNote": "Nahraje zvuk z mikrofonu.",
  "dialogs.addRecording.micIntro":
    "Záznam se uloží do archivu jako každá jiná nahrávka. Ani slovo neopustí váš počítač.",
  "dialogs.addRecording.micPreparing": "Připravuji mikrofon…",
  "dialogs.addRecording.micDenied":
    "Mikrofon se nepodařilo otevřít. Zkontrolujte oprávnění v nastavení systému.",
  "dialogs.addRecording.micReady": "Mikrofon je připravený.",
  "dialogs.addRecording.micRecording": "Nahrává se…",
  "dialogs.addRecording.micSuspended": "Záznam čeká, dokud hraje zvuk.",
  "dialogs.addRecording.micStopped": "Záznam je hotový.",
  "dialogs.addRecording.micStart": "Spustit záznam",
  "dialogs.addRecording.micStop": "Zastavit",
  "dialogs.addRecording.micMinimize": "Minimalizovat",
  "dialogs.addRecording.micSeek": "Pozice přehrávání",
  "dialogs.addRecording.micPlay": "Přehrát záznam",
  "dialogs.addRecording.micPause": "Pozastavit přehrávání",
  "dialogs.addRecording.micDiscard": "Zahodit",
  "dialogs.addRecording.micTranscribe": "Přepsat",
  "dialogs.addRecording.micSaving": "Ukládám…",

  // Per-recording action menu, shared by Archive cards and transcript Detail.
  "dialogs.recordingMenu.more": "Další akce",
  "dialogs.recordingMenu.retranscribe": "Přepsat znovu",
  "dialogs.recordingMenu.deleteTranscript": "Smazat přepis",
  "dialogs.recordingMenu.moveToFolder": "Vložit do složky",
  "dialogs.recordingMenu.newFolder": "Nová složka…",
  "dialogs.recordingMenu.outOfFolder": "Vyjmout ze složky",
  "dialogs.recordingMenu.exportAudio": "Uložit zvuk…",
  "dialogs.rename.title": "Přejmenovat přepis",
  "dialogs.rename.text": "Změní se název v archivu. Zvukový soubor na disku zůstane, jak se jmenuje.",
  "dialogs.rename.label": "Název přepisu",
  "dialogs.rename.placeholder": "Porada týmu",
  "dialogs.folder.createTitle": "Nová složka",
  "dialogs.folder.renameTitle": "Přejmenovat složku",
  "dialogs.folder.text": "Složka drží nahrávky pohromadě. Zvukové soubory na disku nechává, kde jsou.",
  "dialogs.folder.label": "Název složky",
  "dialogs.folder.placeholder": "Rozhovory",
  "dialogs.folder.create": "Vytvořit",
  "dialogs.folder.deleteTitle": "Smazat složku {name}?",
  "dialogs.folder.deleteEmpty": "Složka je prázdná, takže se nic dalšího neztratí.",
  "dialogs.folder.deleteText.one":
    "Složka obsahuje 1 přepis. Můžete ho přesunout do archivu, nebo smazat spolu se složkou.",
  "dialogs.folder.deleteText.few":
    "Složka obsahuje {count} přepisy. Můžete je přesunout do archivu, nebo smazat spolu se složkou.",
  "dialogs.folder.deleteText.many":
    "Složka obsahuje {count} přepisů. Můžete je přesunout do archivu, nebo smazat spolu se složkou.",
  "dialogs.folder.deleteText.other":
    "Složka obsahuje {count} přepisů. Můžete je přesunout do archivu, nebo smazat spolu se složkou.",
  "dialogs.folder.deleteKeep": "Jen složku",
  "dialogs.folder.deleteAll": "Včetně přepisů",
  "dialogs.recordingMenu.transcribeInLanguage": "Přepsat v jazyce",
  "dialogs.recordingMenu.remove": "Odebrat z archivu",
} as const;

export const csDialogsContext: Partial<Record<keyof typeof csDialogs, string>> = {
  "dialogs.retranscribe.title": "Nadpis potvrzení, než se hotový přepis nahradí novým.",
  "dialogs.retranscribe.textOne":
    "Text potvrzení pro jednu nahrávku. {title} je její název. „Odklepnutá místa“ jsou místa ke kontrole, která už uživatel označil za správná.",
  "dialogs.retranscribe.textMany.one":
    "Text potvrzení pro víc nahrávek najednou. Tvar pro jednu; počet se v něm záměrně neopakuje.",
  "dialogs.retranscribe.textMany.few": "Tvar pro 2–4 nahrávky.",
  "dialogs.retranscribe.textMany.many": "Tvar pro desetinná čísla; v této hlášce nenastane.",
  "dialogs.retranscribe.textMany.other": "Tvar pro pět a víc nahrávek.",
  "dialogs.retranscribe.confirm": "Potvrzovací tlačítko. Ničivá akce, stejné sloveso jako v nabídce.",
  "dialogs.speakers.title":
    "Nadpis dialogu, který se ptá před přepisem, když je zapnuté rozlišování mluvčích.",
  "dialogs.speakers.unknown":
    "Tlačítko pro případ, kdy uživatel počet nezná. Nechá rozhodnutí na odhadu, není to zrušení.",
  "dialogs.speakers.confirm": "Hlavní tlačítko dialogu: spustí přepis se zvoleným počtem.",
  "dialogs.speakers.morePlaceholder":
    "Zástupný text v poli pro počet vyšší než čtyři. Musí být velmi krátký, pole je úzké.",
  "dialogs.addRecording.title":
    "Nadpis dialogu pro přidání nahrávky. Uživatel v něm vybírá zdroj zvuku, přepis začne až potom.",
  "dialogs.addRecording.localFile":
    "Volba v dialogu Přidat nahrávku — soubor z disku, ne z internetu.",
  "dialogs.addRecording.onlineVideo":
    "Volba v dialogu Přidat nahrávku — stažení zvuku z videa na webu.",
  "dialogs.addRecording.onlineTitle":
    "Nadpis druhého kroku téhož dialogu, kde se vkládá odkaz. Text je shodný s volbou, překlad se ale lišit může.",
  "dialogs.addRecording.urlPlaceholder":
    "Ukázkový odkaz v prázdném poli, ne text ke čtení. Měň jen tehdy, pokud se v cílové zemi používá jiná doména.",
  "dialogs.addRecording.preparingSupport":
    "Průběh stahování nástroje na stahování online videí (yt-dlp). Zobrazuje se v pruhu průběhu.",
  "dialogs.addRecording.finishingSupport":
    "Poslední fáze instalace téhož nástroje — rozbalování staženého archivu.",
  "dialogs.addRecording.percent":
    "Číslo v procentech vedle pruhu průběhu. Mezera před znakem je záměrná.",
  "dialogs.addRecording.submitting":
    "Popisek hlavního tlačítka, zatímco stahování běží. Tlačítko je v té chvíli neaktivní.",
  "dialogs.addRecording.microphone":
    "Třetí karta v dialogu Nový přepis a nadpis pohledu se záznamem z mikrofonu.",
  "dialogs.addRecording.microphoneNote": "Popisek karty: odkud zvuk přijde.",
  "dialogs.addRecording.micIntro":
    "Věta pod nadpisem záznamu. Říká, kde záznam skončí a že nikam neodchází.",
  "dialogs.addRecording.micPreparing":
    "Stav, než systém povolí mikrofon. Může u něj viset dialog oprávnění.",
  "dialogs.addRecording.micDenied":
    "Stav po odmítnutí mikrofonu systémem nebo uživatelem.",
  "dialogs.addRecording.micReady": "Stav před spuštěním: mikrofon je otevřený, nic se nenahrává.",
  "dialogs.addRecording.micRecording": "Stav během nahrávání, vedle běží časomíra.",
  "dialogs.addRecording.micStopped": "Stav po zastavení, časomíra ukazuje délku záznamu.",
  "dialogs.addRecording.micStart": "Hlavní tlačítko, spustí nahrávání.",
  "dialogs.addRecording.micStop": "Hlavní tlačítko během nahrávání, ukončí záznam.",
  "dialogs.addRecording.micMinimize":
    "Zavře dialog, ale nahrávání běží dál — v hlavičce zůstane mini rekordér.",
  "dialogs.addRecording.micPlay":
    "Popisek kulatého tlačítka u hotového záznamu. Přehraje ho přímo v dialogu, před rozhodnutím.",
  "dialogs.addRecording.micPause": "Tentýž ovladač během přehrávání.",
  "dialogs.addRecording.micSuspended":
    "Stav běžícího záznamu: sám se pozastavil, protože hraje přehrávání, a po zastavení zvuku sám pokračuje.",
  "dialogs.addRecording.micSeek":
    "Popisek táhla pozice přes spektrum u hotového záznamu. Táhnutím se přetáčí.",
  "dialogs.addRecording.micDiscard":
    "Zahodí hotový záznam a vrátí pohled do stavu před nahráváním. Jediná cesta, jak o záznam přijít.",
  "dialogs.addRecording.micTranscribe":
    "Hlavní tlačítko u hotového záznamu: uloží ho do archivu a rovnou spustí přepis.",
  "dialogs.addRecording.micSaving": "Popisek hlavního tlačítka, zatímco se záznam ukládá.",
  "dialogs.recordingMenu.more":
    "Popisek pro čtečky obrazovky u tlačítka se třemi tečkami, které nabídku otevírá.",
  "dialogs.recordingMenu.retranscribe": "Zahodí hotový přepis a spustí přepis nahrávky znovu.",
  "dialogs.recordingMenu.moveToFolder":
    "Položka v nabídce nahrávky. Otevře podnabídku se seznamem složek.",
  "dialogs.rename.text":
    "Vysvětluje, že přejmenování se týká jen archivu, ne souboru na disku.",
  "dialogs.folder.deleteTitle": "{name} je název složky.",
  "dialogs.folder.deleteText.one":
    "Vysvětluje volbu mezi dvěma tlačítky: vrátit přepisy do archivu, nebo je smazat i se složkou.",
  "dialogs.folder.deleteKeep":
    "Tlačítko: smaže složku, ale přepisy z ní vrátí do archivu.",
  "dialogs.recordingMenu.exportAudio":
    "Uloží zvukový soubor nahrávky jinam. Vlastní záznamy a stažená videa leží ve složce aplikace, kde je nikdo nehledá.",
  "dialogs.recordingMenu.transcribeInLanguage":
    "Položka, která otevírá podnabídku se seznamem jazyků. Jazyk se vybírá až v ní.",
  "dialogs.recordingMenu.remove":
    "Odstraní nahrávku z archivu. Není to totéž co „Smazat přepis“, který nahrávku nechává být.",
};
