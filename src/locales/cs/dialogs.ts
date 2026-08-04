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
    "Pokud znáš počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Odhad se na dvou lidech často splete.",
  "dialogs.speakers.introMany.one":
    "Pokud znáš počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávku.",
  "dialogs.speakers.introMany.few":
    "Pokud znáš počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávky.",
  "dialogs.speakers.introMany.many":
    "Pokud znáš počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávky.",
  "dialogs.speakers.introMany.other":
    "Pokud znáš počet mluvčích, nástroj pro rozpoznání bude mít lehčí úkol. Platí pro {count} nahrávek.",
  "dialogs.speakers.exactLabel": "Přesný počet mluvčích",
  "dialogs.speakers.morePlaceholder": "víc",
  "dialogs.speakers.note": "Odpověď platí jen pro tenhle přepis, v nastavení se nic nemění.",
  "dialogs.speakers.unknown": "Nevím",
  "dialogs.speakers.confirm": "Přepsat",
  // Add recording dialog — source picker.
  "dialogs.addRecording.title": "Nový přepis",
  "dialogs.addRecording.prompt": "Vyber, odkud chceš zvuk přidat.",
  "dialogs.addRecording.localFile": "Místní soubor",
  "dialogs.addRecording.localFileNote": "Zvuk nebo video uložené v počítači.",
  "dialogs.addRecording.onlineVideo": "Online video",
  "dialogs.addRecording.onlineVideoNote": "YouTube nebo jiný podporovaný web.",

  // Add recording dialog — online video step.
  "dialogs.addRecording.onlineTitle": "Online video",
  "dialogs.addRecording.onlinePrompt":
    "Vlož odkaz. Aplikace stáhne jen zvuk a přidá ho do archivu.",
  "dialogs.addRecording.urlLabel": "Odkaz na video",
  "dialogs.addRecording.urlPlaceholder": "https://www.youtube.com/watch?v=…",
  "dialogs.addRecording.downloadNote":
    "Při prvním použití se stáhne podpora online videí (asi 60 MB).",
  "dialogs.addRecording.invalidUrl": "Vlož platný odkaz začínající http:// nebo https://.",
  "dialogs.addRecording.preparingSupport": "Připravuji podporu online videí · {percent} %",
  "dialogs.addRecording.finishingSupport": "Dokončuji podporu online videí",
  "dialogs.addRecording.preparingVideo": "Připravuji online video",
  "dialogs.addRecording.percent": "{value} %",
  "dialogs.addRecording.submitting": "Přidávám…",
  "dialogs.addRecording.submit": "Stáhnout a přidat",

  // Per-recording action menu, shared by Archive cards and transcript Detail.
  "dialogs.recordingMenu.more": "Další akce",
  "dialogs.recordingMenu.retranscribe": "Přepsat znovu",
  "dialogs.recordingMenu.deleteTranscript": "Smazat přepis",
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
  "dialogs.recordingMenu.more":
    "Popisek pro čtečky obrazovky u tlačítka se třemi tečkami, které nabídku otevírá.",
  "dialogs.recordingMenu.retranscribe": "Zahodí hotový přepis a spustí přepis nahrávky znovu.",
  "dialogs.recordingMenu.transcribeInLanguage":
    "Položka, která otevírá podnabídku se seznamem jazyků. Jazyk se vybírá až v ní.",
  "dialogs.recordingMenu.remove":
    "Odstraní nahrávku z archivu. Není to totéž co „Smazat přepis“, který nahrávku nechává být.",
};
