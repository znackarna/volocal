/** Strings belonging to the Settings screen. */
export const csSettings = {
  "settings.title": "Nastavení",
  "settings.groups": "Skupiny nastavení",
  "settings.tab.transcription": "Přepis",
  "settings.tab.interface": "Rozhraní",
  "settings.tab.performance": "Výkon",
  "settings.tab.tools": "Nástroje",
  "settings.tab.files": "Soubory",
  "settings.tab.updates": "Aktualizace",
  "settings.tab.about": "Informace",
  "settings.missingRequired": "Některé povinné modely chybí",
  "settings.language.title": "Jazyk aplikace",
  "settings.language.description": "Změna se projeví hned. Přepisy zůstanou v původním jazyce.",


  // Portable mode and the copy it can make of itself.
  "settings.portable.title": "Přenosný režim",
  "settings.portable.description":
    "Aplikace běží ze složky {directory}. Přepisy, programy i modely jsou uložené tamtéž. Do systému se nezapisuje nic.",
  "settings.portable.machineBundled": "Počítač: {machine} · zobrazovací jádro je přiložené",
  "settings.portable.machineSeparate":
    "Počítač: {machine} · zobrazovací jádro není přiložené; na počítači bez WebView2 se okno neotevře",
  "settings.portable.copyTitle": "Přenosný disk",
  "settings.portable.copyDescription":
    "Zkopíruje aplikaci a modely na zvolený disk. Na jiném počítači pak stačí spustit soubor {file}.",
  "settings.portable.copyDestination": "Kam vytvořit přenosnou kopii",
  "settings.portable.copyHint":
    "Z flash disku se modely načítají pomaleji.",
  "settings.portable.copyingFile": "Kopíruji: {file}",
  "settings.portable.copying": "Kopíruji…",
  "settings.portable.copyAction": "Vytvořit kopii",
  "settings.portable.copied": "Zkopírováno {size}.",

  // Overview of everything that has to be downloaded before a transcript runs.
  "settings.modules.title": "Modely",
  "settings.modules.description":
    "Nástroje a jazykové modely pro lokální přepis. Po stažení zůstávají v počítači.",
  "settings.modules.missingRequired.one": "Chybí {count} položka nutné pro přepis.",
  "settings.modules.missingRequired.few": "Chybí {count} položky nutné pro přepis.",
  "settings.modules.missingRequired.many": "Chybí {count} položky nutné pro přepis.",
  "settings.modules.missingRequired.other": "Chybí {count} položek nutné pro přepis.",
  "settings.modules.complete": "Vše potřebné je stažené.",
  "settings.modules.add": "Doplnit",
  "settings.modules.manage": "Spravovat modely",

  // Local model that turns a raw transcript into a readable document. Dvě
  // karty, jedna z nich je vždycky vybraná. Vypínat není co: úprava se spustí
  // jen tehdy, když si u přepisu vyžádáte dokument.
  "settings.editor.title": "Jazyková úprava",
  "settings.editor.description": "Model, který z přepisu udělá čitelný text.",
  "settings.editor.modelSmall": "Menší",
  "settings.editor.modelMiddle": "Střední",
  "settings.editor.modelLarge": "Větší",
  "settings.editor.note": "Úprava se spustí pouze na vyžádání a vytvoří nový dokument.",

  // Where the transcription computes. Dvě karty, klidový stav je nevybráno —
  // a pod nimi to, co doopravdy běželo.
  "settings.compute.title": "Výkon",
  "settings.compute.description":
    "Kde se přepis počítá. Volba platí pro další přepisy, hotové nijak nemění.",
  "settings.compute.modeGpu": "Grafická karta (GPU)",
  "settings.compute.modeGpuNote":
    "S grafickou kartou je přepis rychlejší. Kterou knihovnu použít, pozná aplikace sama.",
  "settings.compute.modeCpu": "Procesor (CPU)",
  "settings.compute.modeCpuNote": "Funguje na každém počítači. Přepis ale trvá déle.",
  "settings.compute.autoNote": "Aplikace sama zvolí výkonnější variantu.",
  "settings.compute.letItDecide": "Automaticky",
  "settings.compute.graphicsCardIdle":
    "V počítači je grafická karta, ale sestavení pro ni zatím není stažené.",
  "settings.compute.graphicsCardRefused":
    "Vybraná je grafická karta, ale sestavení pro ni zatím není stažené. Přepis zatím počítá procesor.",
  "settings.compute.processorRefused":
    "Vybraný je procesor, ale sestavení pro něj zatím není stažené. Přepis zatím počítá grafická karta.",
  "settings.compute.noGraphicsCard":
    "Tento počítač nemá podporovanou grafickou kartu, přepis proto počítá procesor.",

  // Folders: where the programs and models live, and which folder is watched.
  "settings.files.locationsTitle": "Umístění nástrojů a modelů",
  "settings.files.locationsPortable":
    "Relativní cesty se vztahují ke složce s programem, takže nezáleží na písmenu disku.",
  "settings.files.locationsDescription":
    "Programy i modely se do složky stahují samy. Cestu měňte jen v případě potřeby.",
  "settings.files.binDirectory": "Složka nástrojů",
  "settings.files.modelsDirectory": "Složka modelů",
  "settings.files.choose": "Vybrat…",
  "settings.files.watchTitle": "Sledovaná složka",
  "settings.files.watchDescription":
    "Hlídá nové nahrávky ve vybrané složce. V Archivu je nabídne k přepisu.",
  "settings.files.watchDirectory": "Umístění",
  "settings.files.watchPlaceholder": "Není vybraná žádná složka",
  "settings.files.watchRemove": "Odebrat",
  "settings.files.watchAuto": "Přepisovat nové soubory automaticky",
  "settings.files.watchAutoNote":
    "Bez zapnutí je aplikace jen nabídne v Archivu. Neprohledává vnořené složky.",

  "settings.recordings.title": "Složka pro nahrávky",
  "settings.recordings.description":
    "Do této složky se ukládají záznamy z mikrofonu a online videí.",
  "settings.recordings.directory": "Umístění",
  "settings.recordings.defaultPlace": "Ve složce s archivem",
  "settings.recordings.reset": "Výchozí",
  "settings.recordings.movedNote":
    "Změna platí pro nové nahrávky. Stávající zůstanou na místě.",
  "settings.recordings.copyImports": "Kopírovat přidané soubory",
  "settings.recordings.copyImportsNote":
    "Archiv vytváří kopie přidaných souborů. Zabere to místo navíc.",

  // Fonts and the sample paragraph that shows them off.
  "settings.appearance.title": "Vzhled",
  "settings.appearance.description":
    "Barevný motiv a písmo, kterým se čte přepis.",
  "settings.appearance.theme": "Motiv",
  "settings.appearance.themeSystem": "Podle systému",
  "settings.appearance.themeLight": "Světlý",
  "settings.appearance.themeDark": "Tmavý",
  "settings.appearance.fontUi": "Písmo rozhraní",
  "settings.appearance.fontText": "Písmo přepisu",
  "settings.appearance.fontGroupSerif": "Patkové (na čtení)",
  "settings.appearance.fontGroupSans": "Bezpatkové",
  "settings.appearance.fontSize": "Velikost textu v přepisu",
  "settings.appearance.fontSizeValue": "{value} px",
  "settings.appearance.previewSpeaker": "Radomil",
  "settings.appearance.previewText":
    "Sešli jsme se ve čtvrtek odpoledne a mluvili spolu skoro dvě hodiny. „Nejdřív si to musíme poslechnout celé,“ řekla — a měla pravdu. Přepis měl nakonec 1 234 slov a nechyběla v něm jediná věta.",
  "settings.appearance.previewDiacritics": "Háčky a čárky: ě š č ř ž ý á í é ú ů ň ť ď",

  // The About page: what the application is, does, and stands on.
  "settings.about.description":
    "Převádí mluvené slovo na text. Data zpracovává pouze na vašem počítači a nic neodesílá ven. Nahrávky, přepisy a modely jsou plně pod vaší kontrolou.",
  "settings.about.version": "Verze",
  "settings.about.author": "Autor",
  "settings.about.updateCheck": "Zkontrolovat aktualizace",
  "settings.about.updateNote": "Aplikace hledá novou verzi pouze na vaši žádost.",
  "settings.about.updateAuto": "Automatické aktualizace",
  "settings.about.updateAutoDescription":
    "Po spuštění hledá novější verzi. Stáhne ji až na vaše svolení.",
  "settings.about.updateChecking": "Kontroluji…",
  "settings.about.updateCurrent": "Máte nejnovější verzi.",
  "settings.about.updateFound": "K dispozici je verze {version}.",
  "settings.about.updateInstall": "Stáhnout a nainstalovat",
  "settings.about.updateNotesTitle": "Verze {version}",
  "settings.about.updateNotesLead": "Co je lepší a novější?",
  "settings.about.updateNotesLater": "Teď ne",
  "settings.about.updateNotesReopen": "Co je nového",
  "settings.about.updateDownloading": "Stahuji… {percent} %",
  "settings.about.updateDownloadingUnknown": "Stahuji…",
  "settings.about.updateInstalling":
    "Instaluji. Aplikace se za chvíli zavře a po dokončení se sama spustí.",
  "settings.about.updateFailed":
    "Nepodařilo se zjistit, jestli je dostupná novější verze. Zkontrolujte připojení k internetu.",
  "settings.about.abilities": "Schopnosti",
  "settings.about.abilityTranscribe": "Přepíše nahrávky i videa v češtině i dalších jazycích.",
  "settings.about.abilitySpeakers": "Rozpozná mluvčí a rozdělí text mezi ně.",
  "settings.about.abilityEditor": "Vylepší přepis jazykovým modelem, shrne ho a přeloží.",
  "settings.about.abilityReview": "Označí místa, kde si přepis nebyl jistý, a drží opravy pohromadě.",
  "settings.about.abilityNotes": "Přehraje přesně na slovo a připne poznámku k libovolnému místu.",
  "settings.about.abilitySources": "Nahraje z mikrofonu, stáhne zvuk z online videí, hlídá vybranou složku.",
  "settings.about.abilityExport": "Uloží přepis do TXT, Markdownu, SRT, VTT nebo JSON a zvuk do MP3.",
  "settings.about.credits": "Technologie",
  "settings.about.creditsDescription":
    "Aplikace pro vás nepracuje sama. Tohle jsou licence jazykových modelů a nástrojů, které na výsledku spolupracují.",
  "settings.about.groupApp": "Aplikace",
  "settings.about.groupTranscription": "Přepis",
  "settings.about.groupSpeakers": "Mluvčí",
  "settings.about.groupEditor": "Jazyková úprava",
  "settings.about.groupMedia": "Zvuk a video",
  "settings.about.groupFonts": "Písma",
  "settings.about.publicDomain": "volné dílo",
  "settings.about.licenceNote":
    "Vše kromě modelů Gemma je open source. Gemma se řídí podmínkami Googlu a FFmpeg licencí GPL v3.",

  // What Whisper is told to do.
  "settings.transcription.model": "Model přepisu",
  "settings.transcription.modelDescription": "Stažený model.",
  "settings.transcription.modelNote": "Chybějící model se výběrem automaticky stáhne.",
  "settings.transcription.modelDownloading": "stahuje se…",
  "settings.transcription.language": "Jazyk nahrávky",
  "settings.transcription.languageNote":
    "Předem vybraný jazyk urychlí přepis. U více jazyků nechte automatiku.",
  "settings.transcription.beam": "Důkladnost hledání",
  "settings.transcription.beamNote":
    "Vyšší hodnota zvyšuje přesnost a prodlužuje dobu přepisu.",

  // Words the transcript gets wrong the same way every time.
  "settings.dictionary.title": "Slovník oprav",
  "settings.dictionary.description":
    "Slova, která se v nových přepisech opraví pokaždé stejně: jména, místa, odborné výrazy.",
  "settings.dictionary.newEntry": "Nový výraz",
  "settings.dictionary.find": "Co přepis slyší",
  "settings.dictionary.findPlaceholder": "součas DNA",
  "settings.dictionary.replace": "Jak to má být",
  "settings.dictionary.replacePlaceholder": "součást DNA",
  "settings.dictionary.add": "Přidat",
  "settings.dictionary.empty": "Slovník je zatím prázdný.",

  "settings.speakers.title": "Mluvčí",
  "settings.speakers.toggle": "Rozlišení mluvčích",
  "settings.speakers.description":
    "Spustí rozlišení mluvčích během prvního přepisu.",

  // Copies of the archive database.
  "settings.backups.title": "Záloha archivu",
  "settings.backups.description":
    "Archiv tvoří jediný soubor. Při každém spuštění vznikne kopie: zůstávají tři poslední a jedna pro každý z posledních sedmi dnů.",
  "settings.backups.latest": "Poslední záloha",
  "settings.backups.none": "zatím žádná",
  "settings.backups.count": "Uloženo kopií",
  "settings.backups.directory": "Složka",
  "settings.backups.reveal": "Otevřít složku se zálohami",
  "settings.backups.restoreTitle": "Obnovit ze zálohy",
  "settings.backups.emptyList": "Zatím tu není záloha, ke které by se šlo vrátit.",
  "settings.archive.export": "Export archivu",
  "settings.archive.note":
    "Export neobsahuje zdrojové nahrávky. Import nahradí současný archiv.",
  "settings.archive.exportSaving": "Exportuji…",
  "settings.archive.exported": "Kopie archivu je uložená: {path}",
  "settings.archive.fileFilter": "Archiv Volocalu",
  "settings.archive.import": "Import archivu",
  "settings.archive.importConfirmTitle": "Nahradit archiv načteným souborem?",
  "settings.archive.importConfirmText":
    "Současný archiv se nahradí souborem {name}. Stávající stav se uloží stranou jako volocal-before-import.db, takže se k němu jde vrátit. Zvukové soubory na disku zůstanou nedotčené.",
  "settings.archive.importAction": "Nahradit archiv",
  "settings.backups.restoreNote":
    "Vybraná záloha nahradí současný archiv. Pozdější přepisy v archivu nebudou.",
  "settings.backups.restoreAction": "Obnovit",
  "settings.backups.restoreConfirmTitle": "Obnovit archiv ze zálohy?",
  "settings.backups.restoreConfirmText":
    "Archiv se nahradí zálohou z {when}. Současný stav se uloží stranou jako volocal-before-restore.db, takže se k němu jde vrátit. Zvukové soubory na disku zůstanou nedotčené.",

  // Everything folded away at the foot of the transcription tab.
  "settings.advanced.title": "Pokročilé",
  "settings.advanced.modified": "upraveno",
  "settings.advanced.note":
    "Pro běžný přepis není potřeba nic z toho měnit. Výchozí hodnoty odpovídají nastavení Whisperu.",
  "settings.advanced.reset": "Zpět na výchozí",

  // Whisper decoding thresholds, inside that block.
  "settings.decoding.silence": "Práh ticha",
  "settings.decoding.silenceNote":
    "Zvyšte, když vzniká text v tichu. Snižte, když mizí tiše pronesená slova.",
  "settings.decoding.confidence": "Práh jistoty",
  "settings.decoding.confidenceNote": "Blíž k nule znamená přísnější kontrolu a delší přepis.",
  "settings.decoding.entropy": "Práh jednotvárnosti",
  "settings.decoding.entropyNote": "Nižší hodnota dřív zastaví opakování stejné věty.",
  "settings.decoding.temperature": "Teplota",
  "settings.decoding.temperatureNote": "Vyšší hodnota přidává náhodu. Pro běžný přepis nechte nulu.",
  "settings.decoding.temperatureStep": "Krok teploty",
  "settings.decoding.temperatureStepNote":
    "Při dalším pokusu zvýší teplotu o tuto hodnotu. Nula další pokusy vypne.",

  // Where each tool and model was found on disk.
} as const;

export const csSettingsContext: Partial<Record<keyof typeof csSettings, string>> = {
  /* Všech šest názvů záložek je jednoslovných a mají být jednoslovné i v
     překladu: stojí v jedné řadě vedle sebe a dvouslovný název mezi nimi
     vypadá důležitější než jeho sousedé. Když se jedno slovo hledá těžko,
     hledej nadřazený pojem, ne zkratku — složky i zálohy jsou soubory, výkon
     i modely jsou nástroje. Zkrácení by lhalo. */
  "settings.tab.transcription": "Název záložky. Jde o převod řeči na text, ne o opisování.",
  "settings.tab.interface":
    "Název záložky se dvěma kartami: jazyk aplikace a vzhled (motiv, písmo " +
    "přepisu, jeho velikost). Nadřazený pojem pro obojí — jazyk není vzhled, " +
    "takže „Vzhled“ by tu bylo zkrácení. Jde o jazyk rozhraní, ne o jazyk " +
    "nahrávky; ten je na záložce Přepis.",
  "settings.tab.performance":
    "Název záložky s jedinou kartou: kde se přepis počítá, na grafické kartě " +
    "nebo na procesoru. Je to výkon ve smyslu „na čem to poběží“, ne měření.",
  "settings.tab.tools":
    "Název záložky, na které je vidět, co je v tomhle počítači stažené a kam " +
    "se to ukládá. Nástroje jsou programy jako ffmpeg nebo whisper-cli a " +
    "modely, které k nim patří, ne funkce aplikace.",
  "settings.tab.files":
    "Název záložky, na které je složka pro nahrávky, sledovaná složka, zálohy " +
    "archivu a přenosná kopie. Všechno jsou to soubory a složky na disku. Dřív " +
    "se jmenovala Aplikace a neříkala o žádné z těch věcí nic.",
  "settings.tab.updates":
    "Název záložky a zároveň nadpis její jediné karty. Kontrola nové verze, co je v ní nového a její instalace.",
  "settings.tab.about":
    "Název poslední záložky: co aplikace je, co umí a na čem stojí. Nic se na ní nenastavuje, je jen ke čtení.",


  "settings.portable.description":
    "{directory} je cesta ke složce, ze které aplikace běží. Vypisuje se jako kód.",
  "settings.portable.machineBundled":
    "„Zobrazovací jádro“ je WebView2, součást Windows, kterou aplikace potřebuje k vykreslení okna.",
  "settings.portable.machineSeparate":
    "Druhá varianta téhož řádku, když WebView2 u kopie přiložený není.",
  "settings.portable.copyDestination":
    "Titulek systémového dialogu pro výběr složky. Otázka „kam“, ne příkaz.",
  "settings.portable.copyingFile": "{file} je název souboru, který se právě kopíruje.",
  "settings.portable.copied": "{size} je velikost i s jednotkou, například „2,5 GB“.",

  "settings.modules.missingRequired.one":
    "Počítají se chybějící stažené součásti. {count} je jejich počet.",
  "settings.modules.add": "Tlačítko, které vede na obrazovku stahování chybějících součástí.",

  "settings.editor.title":
    "Název sekce. Jde o dodatečnou úpravu textu jazykovým modelem, ne o editor jako program.",
  "settings.editor.description":
    "Věta pod nadpisem karty. Říká, co ten model dělá — obdoba věty „Model, " +
    "kterým se nahrávky přepisují“ o kus výš.",
  "settings.editor.modelLarge":
    "Název první karty pod nadpisem Jazyková úprava. Jedno slovo schválně — " +
    "podstatné jméno dodává nadpis. V seznamu ke stažení má týž model delší " +
    "název, protože tam stojí sám.",
  "settings.editor.modelMiddle":
    "Název prostřední karty. Ta se objeví jen na počítačích, kde ten model už " +
    "je; aplikace ho sama nenabízí.",
  "settings.editor.modelSmall": "Název poslední karty. Taky jedno slovo.",
  "settings.editor.note":
    "Věta pod kartami Menší a Větší. Nese dvě věci a obě jsou potřeba, takže " +
    "ji nezkracuj na jednu: nic se nespustí samo (proto tu není žádné vypínání " +
    "ani se zatím nic nestahuje) a výsledkem je nový dokument, ne přepsaný " +
    "původní přepis.",

  "settings.compute.title":
    "Nadpis karty na záložce Nástroje. Je nad přepínačem i nad řádkem, který " +
    "říká, na čem přepis skutečně počítá.",
  "settings.compute.description":
    "Věta pod nadpisem. Říká, čeho se volba týká — příštích přepisů, ne už hotových.",
  "settings.compute.modeGpu":
    "Název jedné ze dvou karet. Znamená kartu obecně — jestli se použije CUDA, " +
    "nebo Vulkan, rozhoduje aplikace podle ovladačů a uživatele se neptá. " +
    "Zkratku v závorce nech: český název je to, co si člověk přečte, a GPU je " +
    "to, co odjinud zná. Není to nadbytečné.",
  "settings.compute.modeGpuNote": "Věta pod názvem té karty. „Knihovna“ je CUDA nebo Vulkan.",
  "settings.compute.modeCpu":
    "Název druhé karty. Přepis počítá procesor. Zkratku v závorce nech, ze " +
    "stejného důvodu jako u GPU.",
  "settings.compute.modeCpuNote": "Věta pod názvem té karty.",
  "settings.compute.autoNote":
    "Vysvětlující věta u přepínače Automaticky. Popisuje, co se děje, když je " +
    "zapnutý; obě karty nad ním zůstávají vidět a ta z nich, kterou aplikace " +
    "vybrala, je zvýrazněná. Slovo „sama“ je záměr, ne synonymum k opravě: " +
    "přepínač vedle té věty se jmenuje Automaticky a „automaticky“ i tady by " +
    "uživateli vracelo tentýž popisek.",
  "settings.compute.letItDecide":
    "Popisek přepínače nad oběma kartami. Zapnutý znamená, že vybírá aplikace " +
    "podle ovladačů; vypnutý platí to, co je vybrané na kartě.",
  "settings.compute.graphicsCardIdle":
    "Věta vedle tlačítka Stáhnout, když si uživatel nevybral ani jednu kartu: " +
    "grafická karta v počítači je, ale program pro ni chybí.",
  "settings.compute.graphicsCardRefused":
    "Táž situace, ale kartu si uživatel vybral sám. Věta říká, že se jeho " +
    "volba splnit nedá a co běží místo toho.",
  "settings.compute.processorRefused":
    "Opačný případ: vybraný je procesor, ale stažené je jen sestavení pro " +
    "grafickou kartu, takže přepis běží na ní.",
  "settings.compute.noGraphicsCard":
    "Věta na počítači bez použitelné grafické karty. Není to chyba, jen konstatování.",

  "settings.files.locationsTitle":
    "Nadpis karty na záložce Nástroje. Pod ním jsou dva řádky, Složka nástrojů a " +
    "Složka modelů — proto pojmenuj místo, kam se stažené soubory ukládají, ne " +
    "soubory samotné.",
  "settings.files.locationsDescription":
    "Věta pod nadpisem na běžné instalaci. „Do složky“ a „cestu“ jsou schválně " +
    "jednotné číslo, i když jsou pod tím dvě pole: každá věc se stahuje do té " +
    "své a čtenář mění jednu cestu, ne obě najednou. Druhá věta vyká — „měňte“, " +
    "ne „měň“.",
  "settings.files.choose": "Tlačítko otevírající dialog pro výběr složky. Tři tečky jsou jeden znak.",
  "settings.files.watchDirectory":
    "Popisek jediného pole na kartě Sledovaná složka. Karta už je pojmenovaná nadpisem, tohle říká jen „kde“.",
  "settings.files.watchPlaceholder": "Zástupný text v poli, dokud složka není vybraná.",
  "settings.files.watchRemove": "Odebere vybranou složku z nastavení. Nic nemaže na disku.",
  "settings.files.watchAuto":
    "Popisek přepínače. Bez něj aplikace nové soubory jen nabídne v Archivu; s ním rovnou spustí přepis.",

  "settings.about.publicDomain":
    "Licence SQLite. Není to licence, ale vzdání se práv — dílo je volné pro kohokoli a k čemukoli.",
  "settings.about.licenceNote":
    "Gemma jsou jazykové modely Googlu; jejich podmínky nejsou open source a " +
    "omezují způsoby použití. FFmpeg je GPL v3. Věta jen vyjmenovává licence — " +
    "co z nich plyne pro toho, kdo přenosnou kopii předá dál, stojí v souboru " +
    "NOTICE, ne tady.",
  "settings.about.abilityReview":
    "Nejistý je přepis, ne čtenář — model sám označí místa s nízkou jistotou.",
  "settings.about.updateNote":
    "Vysvětlení pod tlačítkem. Aplikace slibuje, že sama nikam neposílá nic; tohle je jediné místo, kde se ptá vnějšího serveru, a jen na výslovné vyžádání.",
  "settings.about.updateAuto":
    "Popisek přepínače. Automatická je jen ta otázka, ne stažení ani instalace.",
  "settings.about.updateAutoDescription":
    "Vysvětlení pod přepínačem. Důležité je, že se nic nestáhne samo — aplikace jen zjistí, jestli novější verze existuje.",
  "settings.about.updateFound":
    "{version} je číslo nové verze, například 0.9.1. Bez slova „verze“ před číslem by věta zněla útržkovitě.",
  "settings.about.updateDownloading":
    "{percent} je celé číslo od 0 do 100, bez znaku procenta — ten je v textu.",
  "settings.about.updateInstalling":
    "Instalátor si aplikaci sám zavře a po dokončení ji znovu spustí. Uživatel nemusí dělat nic.",
  "settings.about.updateFailed":
    "Jediná hláška pro každé selhání kontroly. Technický důvod z Tauri je anglicky a uživateli nic neřekne — jde do konzole, ne na obrazovku.",
  "settings.about.updateNotesTitle":
    "Nadpis dialogu, který ukáže, co je v nové verzi. {version} je její číslo, například 1.0.5.",
  "settings.about.updateNotesLead":
    "Věta pod tím nadpisem, uvozuje seznam. Otázka, ne oznámení: čtenář se rozhoduje, jestli kvůli tomu přeruší práci, a ptá se přesně na tohle. Seznam pod ní píše autor vydání a je to v dialogu to podstatné.",
  "settings.about.updateNotesLater":
    "Tlačítko, kterým se dialog zavře bez instalace. Nabídka platí dál, nic se neztrácí.",
  "settings.about.updateNotesReopen":
    "Tlačítko v panelu, které ten dialog otevře znovu, když ho někdo zavřel a chce si text přečíst ještě jednou.",

  "settings.appearance.title":
    "Nadpis karty s motivem, písmem přepisu a jeho velikostí. Záložka nad ní " +
    "se jmenuje jinak — Jazyk a vzhled — protože vedle téhle karty je ještě " +
    "karta s jazykem aplikace.",
  "settings.appearance.description":
    "Úvodní věta té karty. Drží motiv, písmo přepisu a jeho velikost; pod nimi je živá ukázka přepisu.",
  "settings.appearance.theme":
    "Světlá, nebo tmavá barevnost celého okna.",
  "settings.appearance.themeSystem":
    "Barevnost se řídí nastavením operačního systému.",
  "settings.appearance.themeLight": "Světlá barevnost, bez ohledu na systém.",
  "settings.appearance.themeDark": "Tmavá barevnost, bez ohledu na systém.",
  "settings.appearance.fontGroupSerif":
    "Nadpis skupiny v nabídce písem. Patková písma mají na koncích tahů příčky.",
  "settings.appearance.fontGroupSans": "Nadpis skupiny v nabídce písem, protiklad patkových.",
  "settings.appearance.fontSizeValue": "px jsou obrazovkové body.",
  "settings.appearance.previewSpeaker":
    "Jméno mluvčího v ukázce písma. Smyšlené jméno, klidně nahraď obvyklým jménem v cílovém jazyce.",
  "settings.appearance.previewText":
    "Ukázkový odstavec, na kterém je vidět zvolené písmo. Obsahuje uvozovky, pomlčku i číslo s mezerou — v překladu je zachovej.",
  "settings.appearance.previewDiacritics":
    "Ukázka písmen s diakritikou. V jiném jazyce nahraď jeho vlastními zvláštními znaky.",

  "settings.transcription.model":
    "Nadpis karty s výběrem modelu Whisperu, kterým se přepisuje. „Přepisu“ je " +
    "nutné rozlišení, ne výplň: o kus níž je karta Jazyková úprava a ta je taky " +
    "volba mezi modely, takže samotné „Model“ by neřeklo který.",
  "settings.transcription.modelDescription":
    "Náhradní popis modelu, který aplikace nezná podle jména.",
  "settings.transcription.modelNote":
    "Věta pod kartami modelů. Je to **slib o chování**, ne popis toho, co je " +
    "v seznamu: karta modelu, který v počítači není, ukazuje velikost a " +
    "kliknutím se ten model rovnou stáhne. Nepřepisuj ji na větu o tom, co " +
    "seznam obsahuje — dřív tam taková byla a posílala uživatele stahovat " +
    "jinam.",
  "settings.transcription.modelDownloading":
    "Místo velikosti na kartě modelu, který se právě stahuje. Malé písmeno a " +
    "tři tečky jsou jeden znak, stejně jako u ostatních průběhových textů. " +
    "Vybraný zůstává pořád ten starý — přepne se, až je soubor stažený.",
  "settings.transcription.language":
    "Popisek volby jazyka nahrávky. Slovo „nahrávky“ je v něm schválně: o dvě karty dál stojí Jazyk aplikace a samotné „Jazyk“ se s ním pletlo.",
  "settings.transcription.beam":
    "Beam size Whisperu. Kolik možností si přepis drží, než vybere výsledek.",

  "settings.dictionary.title":
    "Nadpis karty se seznamem oprav. „Oprav“ je nutné rozlišení, ne výplň: " +
    "samotné „Slovník“ zve otázku slovník čeho, a na téže záložce jsou jazykové " +
    "modely i jazyk nahrávky. Druhý pád množného čísla od „oprava“.",
  "settings.dictionary.description":
    "Jedna věta pod tím nadpisem, příklady až na konci. Začíná nápravou — " +
    "slova, která se opraví — ne problémem; dřív začínala tím, že je přepis " +
    "plete. Nadpis „Slovník oprav“ nápravu pojmenoval, takže ji věta nemusí " +
    "nést podruhé a zbyde místo na příklady. Bez toho nadpisu by zkrácená " +
    "nefungovala. „Přepis“ je tu hotový text, ne činnost.",
  "settings.dictionary.newEntry":
    "Popisek řádku, ve kterém se zakládá nová dvojice. „Výraz“, ne „záznam“: záznam je v téhle aplikaci všude jinde nahrávka, takže ve slovníku četl jako nová nahrávka. Výraz je i proto, že ta dvojice může být sousloví, ne jen slovo.",
  "settings.dictionary.find": "Popisek pole: co se v přepisu objevuje špatně.",
  "settings.dictionary.findPlaceholder":
    "Ukázka v poli. Skutečná chyba z reálné nahrávky; klidně nahraď příkladem ze svého jazyka.",
  "settings.dictionary.replace": "Popisek pole: čím se to má nahradit.",
  "settings.dictionary.replacePlaceholder": "Ukázka v poli: správný tvar předchozího příkladu.",
  "settings.dictionary.add": "Tlačítko, které přidá nový záznam do slovníku.",
  "settings.dictionary.empty": "Text místo seznamu, dokud slovník nemá žádný záznam.",
  "settings.speakers.title":
    "Nadpis karty o rozpoznávání mluvčích (diarizaci). Podstatné jméno, protože " +
    "přepínač pod ním je ta činnost — stejná dvojice jako Model přepisu nad " +
    "svými kartami.",
  "settings.speakers.toggle":
    "Popisek přepínače diarizace, pod nadpisem Mluvčí. Opakování slova " +
    "„mluvčích“ v popisku a ve větě pod ním je záměr autora, nespojuj to.",
  "settings.speakers.description":
    "Věta pod přepínačem. Odlišuje tenhle přepínač od tlačítka Rozpoznat " +
    "mluvčí u konkrétní nahrávky: tohle běží jako součást přepisu, tamto až " +
    "dodatečně na vyžádání. Pozor, doslova to platí i pro opakovaný přepis " +
    "v jiném jazyce — viz záznam změn ze 14. srpna 2026.",

  "settings.backups.latest": "Popisek údaje: kdy se záloha vytvořila naposledy.",
  "settings.backups.none": "Hodnota vedle „Poslední záloha“, dokud žádná není.",
  "settings.backups.count": "Popisek údaje: kolik záloh je uloženo.",
  "settings.backups.directory": "Popisek údaje: kde zálohy leží. Hodnotou je cesta.",
  "settings.backups.reveal":
    "Bublina nad cestou. Kliknutí otevře složku ve správci souborů daného systému.",
  "settings.backups.restoreTitle":
    "Nadpis skrytého bloku se seznamem záloh. Sloveso, protože to je jediné, co se v tom bloku dělá — export a import archivu se přestěhovaly nahoru na kartu a nadpis už nemusí pojmenovat dvě věci najednou.",
  "settings.backups.emptyList":
    "Místo seznamu, dokud žádná záloha není. Blok je vidět i tak, protože načíst archiv ze souboru jde i na čerstvě nainstalovaném počítači.",
  "settings.archive.export":
    "Tlačítko ve skrytém bloku. Uloží kopii archivu tam, kam uživatel ukáže — na disk, který přežije tenhle počítač. Krátký název, protože vedle něj stojí Import archivu.",
  "settings.archive.note":
    "Jedna poznámka pro obě tlačítka, věta na každé. U exportu to, co v kopii není — archiv drží přepisy a cesty ke zvuku, ne zvuk sám. U importu slovo nahradí, ne spojí. Obě věty říkají, co chybí nebo co zmizí; nic z toho není pochvala funkce.",
  "settings.archive.exportSaving": "Stav tlačítka po dobu ukládání kopie. Tvar podle sousední dvojice Zálohovat teď / Zálohuji…",
  "settings.archive.exported": "Hlášení po uložení. {path} je celá cesta k souboru.",
  "settings.archive.fileFilter":
    "Název skupiny souborů v dialogu, tedy soubory .db. Jméno programu nepřekládej.",
  "settings.archive.import":
    "Tlačítko ve skrytém bloku. Otevře dialog pro výběr souboru s archivem. Dvojice s Exportem archivu, proto stejně krátce.",
  "settings.archive.importConfirmTitle": "Nadpis potvrzovacího dialogu.",
  "settings.archive.importConfirmText":
    "{name} je název vybraného souboru. Název volocal-before-import.db je skutečný název souboru, nepřekládej ho.",
  "settings.archive.importAction":
    "Potvrzovací tlačítko v dialogu. Pojmenuj tím, co se stane, ne slovem „Načíst“.",
  "settings.backups.restoreNote":
    "Vysvětlení nad seznamem. Podstatné je to, co se ztratí: práce, která vznikla po té záloze.",
  "settings.backups.restoreAction":
    "Tlačítko u každé zálohy, a zároveň potvrzovací tlačítko v dotazu.",
  "settings.backups.restoreConfirmTitle": "Nadpis dotazu před nahrazením archivu.",
  "settings.backups.restoreConfirmText":
    "Vysvětlení v tom dotazu. {when} je datum a čas zálohy. Jméno souboru je tam schválně — je to jediná cesta zpátky, kdyby si někdo vybral špatné datum.",

  "settings.advanced.title":
    "Nadpis jediného skrytého bloku na konci záložky Přepis. Drží důkladnost hledání, prahy dekódování a akceleraci; složky a technické podrobnosti se přestěhovaly na záložku Nástroje.",
  "settings.advanced.modified":
    "Odznak u toho nadpisu, když je uvnitř cokoli jiného než výchozí. Malé písmeno je záměr, jako u ostatních odznaků.",
  "settings.advanced.note":
    "Úvodní věta uvnitř bloku. Podstatné je, že nic z toho měnit nemusí — a že výchozí hodnoty nejsou naše, ale Whisperu.",
  "settings.advanced.reset":
    "Tlačítko vracející na výchozí všechny hodnoty v bloku. Od chvíle, kdy se složky přestěhovaly na Nástroje, jsou v bloku samé hodnoty a žádná výjimka.",

  "settings.decoding.silence": "Od jaké hodnoty se úsek prohlásí za ticho.",
  "settings.decoding.confidence": "Jak jistý si přepis musí být, aby úsek přijal.",
  "settings.decoding.entropy":
    "Práh entropie. Jak jednotvárný smí být výstup, než se úsek zkusí znovu.",
  "settings.decoding.temperature":
    "Teplota vzorkování. Vyšší hodnota znamená víc náhody ve výběru slov.",
  "settings.decoding.temperatureStep": "O kolik se teplota zvýší při dalším pokusu.",

};
