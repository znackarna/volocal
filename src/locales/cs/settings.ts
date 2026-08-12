/** Strings belonging to the Settings screen. */
export const csSettings = {
  "settings.title": "Nastavení",
  "settings.groups": "Skupiny nastavení",
  "settings.tab.transcription": "Přepis",
  "settings.tab.models": "Modely",
  "settings.tab.performance": "Výkon",
  "settings.tab.appearance": "Vzhled",
  "settings.tab.dictionary": "Slovník",
  "settings.tab.files": "Soubory",
  "settings.tab.about": "O aplikaci",
  "settings.missingRequired": "Některé povinné modely chybí",
  "settings.language.title": "Jazyk aplikace",
  "settings.language.description": "Změna se projeví hned. Přepisy zůstanou v původním jazyce.",
  "settings.language.label": "Jazyk rozhraní",

  "settings.badge.inUse": "používá se",

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
  "settings.modules.status.complete": "připraveno",
  "settings.modules.status.missing": "chybí",
  "settings.modules.status.optional": "nestažené",
  "settings.modules.model": "Model přepisu",
  "settings.modules.compute": "Výkon",
  "settings.modules.editor": "Jazyková úprava",
  "settings.modules.editorReady": "Připravená, vypnutá",
  "settings.modules.editorMissing": "Nestažená",
  "settings.modules.speakers": "Rozpoznání mluvčích",
  "settings.modules.speakersOn": "Zapnuté",
  "settings.modules.speakersReady": "Připravené, vypnuté",
  "settings.modules.speakersMissing": "Nestažené",
  "settings.modules.missingRequired.one": "Chybí {count} položka nutné pro přepis.",
  "settings.modules.missingRequired.few": "Chybí {count} položky nutné pro přepis.",
  "settings.modules.missingRequired.many": "Chybí {count} položky nutné pro přepis.",
  "settings.modules.missingRequired.other": "Chybí {count} položek nutné pro přepis.",
  "settings.modules.complete": "Vše potřebné je stažené.",
  "settings.modules.add": "Doplnit",
  "settings.modules.manage": "Spravovat modely",

  // Local model that turns a raw transcript into a readable document.
  "settings.editor.title": "Jazyková úprava",
  "settings.editor.description":
    "Vytvoří nový dokument. Nepřepíše původní přepis a časové značky.",
  "settings.editor.light.title": "Úsporná",
  "settings.editor.light.description": "Interpunkce, věty a odstavce. Dobrá i pro slabší CPU.",
  "settings.editor.balanced.title": "Doporučená",
  "settings.editor.balanced.description": "Lépe opravuje zjevné chyby a drží souvislosti.",
  "settings.editor.best.title": "Nejvyšší kvalita",
  "settings.editor.best.description": "Nejspolehlivější, ale na CPU pomalejší.",
  "settings.editor.missing": "Model jazykové úpravy zatím není stažený.",
  "settings.editor.enabledNote": "Model se načte až při spuštění úpravy.",

  // Compute backend, threads and the speed test.
  "settings.performance.title": "Výkon",
  "settings.performance.description":
    "Rychlost se liší několikanásobně podle způsobu zpracování.",
  "settings.performance.autoDescription": "Vybere nejrychlejší dostupnou technologii.",
  "settings.performance.cudaDescription": "Nejrychlejší, když ji počítač má.",
  "settings.performance.vulkanDescription": "Jakákoli grafická karta, včetně NVIDIA.",
  "settings.performance.cpuDescription": "Bez grafické karty. Několikanásobně pomalejší.",
  "settings.performance.defaultDescription": "Sestavení bez zvolené akcelerace.",
  "settings.performance.compute": "Akcelerace zpracování",
  "settings.performance.selectedMissing":
    "Vybraný způsob zpracování zatím není stažený. Přepis zatím běží tím, co je k dispozici.",
  "settings.performance.notDownloaded": "není stažené",
  "settings.performance.threads": "Vlákna procesoru",
  "settings.performance.threadsAuto": "automaticky",
  "settings.performance.threadsNote": "Nula znamená automatickou volbu.",
  "settings.performance.benchmarkNote":
    "Test přepíše kousek nahrávky a rovnou nastaví nejrychlejší režim.",
  "settings.performance.benchmarking": "Měřím…",
  "settings.performance.benchmark": "Změřit rychlost",
  "settings.performance.fastest": "nejrychlejší",
  "settings.performance.benchmarkFailed": "nelze použít — {error}",
  "settings.performance.benchmarkResult": "{factor}× realtime ({seconds} s)",

  // Folders: where the programs and models live, and which folder is watched.
  "settings.files.locations": "Umístění",
  "settings.files.locationsPortable":
    "Relativní cesty se vztahují ke složce s programem, takže nezáleží na písmenu disku.",
  "settings.files.locationsDescription":
    "Programy i modely se stahují samy. Cestu měňte jen v případě potřeby.",
  "settings.files.binDirectory": "Složka nástrojů",
  "settings.files.modelsDirectory": "Složka modelů",
  "settings.files.choose": "Vybrat…",
  "settings.files.watchTitle": "Sledovaná složka",
  "settings.files.watchDescription":
    "Hlídá nové nahrávky ve vybrané složce. V Archivu je nabídne k přepisu.",
  "settings.files.watchDirectory": "Složka s nahrávkami",
  "settings.files.watchPlaceholder": "Není vybraná žádná složka",
  "settings.files.watchRemove": "Odebrat",
  "settings.files.watchToggle": "Sledovat složku",
  "settings.files.watchToggleNote":
    "Nabídne nové soubory pro přepis. Neprohledává vnořené složky.",
  "settings.files.watchAuto": "Automatický přepis",
  "settings.files.watchAutoNote":
    "Přidá nové soubory do archivu a zahájí automatický přepis.",

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
  "settings.appearance.description":
    "Jazyk, barevný motiv a písmo přepisu.",
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
  "settings.appearance.lineHeight": "Řádkování",
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
    "Všechno kromě modelů Gemma je open source. Gemma se řídí podmínkami Googlu a FFmpeg licencí GPL v3 — s tím počítejte, když přenosnou kopii předáváte dál.",

  // What Whisper is told to do.
  "settings.transcription.description":
    "Zvolte velikost jazykového modelu a kvalitu převodu.",
  "settings.speech.title": "Jazyk a detekce řeči",
  "settings.speech.description":
    "Jakou řečí se v nahrávce mluví a co má Volocal považovat za řeč.",
  "settings.transcription.model": "Model",
  "settings.transcription.modelDescription": "Stažený model.",
  "settings.transcription.modelNote": "Zobrazuje pouze stažené modely.",
  "settings.transcription.language": "Jazyk",
  "settings.transcription.languageNote":
    "Předem vybraný jazyk urychlí přepis. U více jazyků nechte automatiku.",
  "settings.transcription.vad": "Detekce řeči",
  "settings.transcription.vadNote":
    "Vynechá ticho a šum a brání zacyklení začátku přepisu. Nechte zapnuté.",
  "settings.transcription.beam": "Důkladnost hledání",
  "settings.transcription.beamNote":
    "Vyšší hodnota zvyšuje přesnost a prodlužuje dobu přepisu.",

  // Telling speakers apart.
  "settings.dictionary.description":
    "Slova, která přepis plete pokaždé stejně: jména, místa, odborné výrazy. Opraví se ve všech nových přepisech.",
  "settings.dictionary.newEntry": "Nový výraz",
  "settings.dictionary.find": "Co přepis slyší",
  "settings.dictionary.findPlaceholder": "součas DNA",
  "settings.dictionary.replace": "Jak to má být",
  "settings.dictionary.replacePlaceholder": "součást DNA",
  "settings.dictionary.add": "Přidat",
  "settings.dictionary.empty": "Slovník je zatím prázdný.",

  "settings.speakers.title": "Mluvčí",
  "settings.speakers.toggle": "Rozpoznávat mluvčí",
  "settings.speakers.description":
    "Rozdělí text mezi jednotlivé mluvčí už při prvním přepisu.",
  "settings.speakers.count": "Počet mluvčích",
  "settings.speakers.countNote":
    "Nula znamená automatický odhad. Skutečný počet výsledek výrazně zpřesní.",
  "settings.speakers.shift": "Hledání změn mluvčího",
  "settings.speakers.shiftFast": "Rychle",
  "settings.speakers.shiftFastNote": "hrubší hranice",
  "settings.speakers.shiftBalanced": "Vyvážené",
  "settings.speakers.shiftDetailed": "Podrobně",
  "settings.speakers.shiftDetailedNote": "až dvakrát déle",
  "settings.speakers.shiftNote":
    "Podrobnější hledání určí hranice přesněji, ale trvá déle.",

  // The shortcut strip under the player on the transcript screen.
  "settings.tips.title": "Rychlé tipy",
  "settings.tips.toggle": "Zobrazovat tipy nad přepisem",
  "settings.tips.description": "Pruh nápovědy s klávesovými zkratkami pod přehrávačem.",

  // Copies of the archive database.
  "settings.backups.title": "Záloha archivu",
  "settings.backups.description":
    "Archiv tvoří jediný soubor. Při každém spuštění vznikne kopie: zůstávají tři poslední a jedna pro každý z posledních sedmi dnů.",
  "settings.backups.latest": "Poslední záloha",
  "settings.backups.none": "zatím žádná",
  "settings.backups.count": "Uloženo kopií",
  "settings.backups.directory": "Složka",
  "settings.backups.reveal": "Otevřít složku se zálohami",
  "settings.backups.restoreTitle": "Vrátit se k záloze nebo přenést archiv",
  "settings.backups.emptyList": "Zatím tu není záloha, ke které by se šlo vrátit.",
  "settings.archive.export": "Export archivu",
  "settings.archive.note":
    "Export uloží jen texty bez zdrojové nahrávky. Import nahradí současný archiv.",
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
  "settings.backups.note": "Záloha se vytváří automaticky při spuštění.",
  "settings.backups.running": "Zálohuji…",
  "settings.backups.action": "Zálohovat teď",

  // Whisper decoding thresholds, hidden behind a disclosure.
  "settings.decoding.title": "Jemné ladění přepisu",
  "settings.decoding.modified": "upraveno",
  "settings.decoding.note":
    "Měňte jen při konkrétním problému. Výchozí hodnoty odpovídají nastavení Whisperu.",
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
  "settings.decoding.reset": "Zpět na výchozí",

  // Where each tool and model was found on disk.
  "settings.diagnostics.title": "Technické podrobnosti",
  "settings.diagnostics.copy": "Zkopírovat údaje",
  "settings.diagnostics.showLog": "Otevřít log",
  "settings.diagnostics.noLog": "Log zatím neexistuje.",
  "settings.diagnostics.copyNote":
    "Vloží se do schránky. Nikam se nic neposílá — kam text pošlete, je na vás.",
  "settings.diagnostics.copied": "Technické údaje jsou ve schránce.",
  "settings.diagnostics.copyRefused":
    "Systém zkopírování odmítl. Zkuste to znovu, nebo pošlete soubor volocal-log.txt.",
  "settings.diagnostics.copyFailed": "Technické údaje se nepodařilo připravit.",
  "settings.diagnostics.modelWhisper": "model Whisperu",
  "settings.diagnostics.modelVad": "model VAD",
  "settings.diagnostics.diarizationEmbedding": "diarizace (hlasové otisky)",
  "settings.diagnostics.notFound": "nenalezeno",
} as const;

export const csSettingsContext: Partial<Record<keyof typeof csSettings, string>> = {
  "settings.speech.description":
    "Úvodní věta karty Jazyk a detekce řeči. „Volocal“ je název aplikace — nechte ho v každém jazyce tak, jak je.",
  "settings.performance.autoDescription":
    "Popis volby „Rozhodnout automaticky“ na kartě akcelerace.",
  "settings.performance.vulkanDescription":
    "Popis volby Vulkan. Vulkan běží na kartách všech výrobců včetně NVIDIE; časný omyl je, že jde jen o náhradu za CUDA. Název NVIDIA se ve větě neskloňuje záměrně.",
  "settings.performance.defaultDescription":
    "Popis staršího sestavení whisper.cpp, které nemá zvolenou akceleraci. Ukáže se jen tam, kde takové sestavení je.",
  "settings.tab.transcription": "Název záložky. Jde o převod řeči na text, ne o opisování.",

  "settings.badge.inUse":
    "Odznak na kartě modelu, který je právě nastavený. Malé písmeno je záměr.",

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

  "settings.modules.status.complete": "Odznak dlaždice: modul je stažený a použitelný.",
  "settings.modules.status.missing": "Odznak dlaždice: bez tohoto modulu přepis neproběhne.",
  "settings.modules.status.optional":
    "Odznak dlaždice: nepovinný modul, který zatím nikdo nestáhl.",
  "settings.modules.model": "Popisek dlaždice. Jde o model Whisperu, který převádí řeč na text.",
  "settings.modules.compute":
    "Popisek dlaždice pro výpočetní režim (procesor nebo grafická karta), ne pro rychlost přepisu.",
  "settings.modules.editor":
    "Popisek dlaždice. Jazyková úprava je oprava interpunkce a vět místním jazykovým modelem.",
  "settings.modules.editorReady":
    "Hodnota dlaždice. Rod se řídí slovy „jazyková úprava“ — proto ženský.",
  "settings.modules.editorMissing": "Hodnota dlaždice o jazykové úpravě, tedy ženský rod.",
  "settings.modules.speakers":
    "Popisek dlaždice pro diarizaci — rozdělení nahrávky mezi jednotlivé mluvčí.",
  "settings.modules.speakersOn": "Hodnota dlaždice „Rozpoznání mluvčích“, tedy střední rod.",
  "settings.modules.speakersReady": "Hodnota dlaždice „Rozpoznání mluvčích“, tedy střední rod.",
  "settings.modules.speakersMissing": "Hodnota dlaždice „Rozpoznání mluvčích“, tedy střední rod.",
  "settings.modules.missingRequired.one":
    "Počítají se chybějící stažené součásti. {count} je jejich počet.",
  "settings.modules.add": "Tlačítko, které vede na obrazovku stahování chybějících součástí.",

  "settings.editor.title":
    "Název sekce i popisek přepínače. Jde o dodatečnou úpravu textu jazykovým modelem, ne o editor jako program.",
  "settings.editor.light.title": "Nejmenší z modelů jazykové úpravy. Šetří paměť a čas.",
  "settings.editor.balanced.title": "Doporučená volba mezi třemi modely jazykové úpravy.",
  "settings.editor.light.description": "CPU je procesor počítače.",

  "settings.performance.title": "Název sekce o rychlosti zpracování.",
  "settings.performance.compute":
    "Popisek nad kartami, na kterých se volí procesor, CUDA nebo Vulkan.",
  "settings.performance.selectedMissing":
    "Vybraný způsob zpracování zatím není stažený. Přepis zatím běží tím, co je k dispozici.",
  "settings.performance.notDownloaded":
    "Poznámka u položky nabídky: tato varianta v počítači zatím není.",
  "settings.performance.threads": "Kolik vláken procesoru smí přepis využít.",
  "settings.performance.threadsAuto":
    "Hodnota vedle popisku, když je počet vláken nastavený na nulu.",
  "settings.performance.benchmarking": "Stav tlačítka po dobu měření rychlosti.",
  "settings.performance.fastest":
    "Přívlastek za názvem nejrychlejšího změřeného režimu. Vykresluje se za " +
    "pomlčkou, takže začíná malým písmenem.",
  "settings.performance.benchmarkFailed":
    "Výsledek měření u režimu, který se nepodařilo spustit. {error} je hlášení z programu.",
  "settings.performance.benchmarkResult":
    "Výsledek měření: {factor}× rychleji než skutečný čas nahrávky, {seconds} je doba testu v sekundách.",

  "settings.files.locations": "Název sekce s cestami ke složkám.",
  "settings.files.choose": "Tlačítko otevírající dialog pro výběr složky. Tři tečky jsou jeden znak.",
  "settings.files.watchPlaceholder": "Zástupný text v poli, dokud složka není vybraná.",
  "settings.files.watchRemove": "Odebere vybranou složku z nastavení. Nic nemaže na disku.",

  "settings.about.publicDomain":
    "Licence SQLite. Není to licence, ale vzdání se práv — dílo je volné pro kohokoli a k čemukoli.",
  "settings.about.licenceNote":
    "Gemma jsou jazykové modely Googlu; jejich podmínky nejsou open source a omezují způsoby použití. FFmpeg je GPL v3. Obojí je důležité pro toho, kdo přenosnou kopii aplikace předá dál.",
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

  "settings.appearance.description":
    "Úvodní věta záložky Vzhled. Karta drží jazyk rozhraní, motiv, obě písma, velikost a řádkování; pod nimi je živá ukázka přepisu.",
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
  "settings.appearance.lineHeight": "Mezera mezi řádky textu přepisu.",
  "settings.appearance.previewSpeaker":
    "Jméno mluvčího v ukázce písma. Smyšlené jméno, klidně nahraď obvyklým jménem v cílovém jazyce.",
  "settings.appearance.previewText":
    "Ukázkový odstavec, na kterém je vidět zvolené písmo. Obsahuje uvozovky, pomlčku i číslo s mezerou — v překladu je zachovej.",
  "settings.appearance.previewDiacritics":
    "Ukázka písmen s diakritikou. V jiném jazyce nahraď jeho vlastními zvláštními znaky.",

  "settings.transcription.model": "Popisek volby modelu Whisperu pro přepis.",
  "settings.transcription.modelDescription":
    "Náhradní popis modelu, který aplikace nezná podle jména.",
  "settings.transcription.language": "Popisek volby jazyka nahrávky, ne jazyka aplikace.",
  "settings.transcription.vad":
    "Detekce řeči (VAD) pozná, kde se v nahrávce mluví, a zbytek přeskočí.",
  "settings.transcription.beam":
    "Beam size Whisperu. Kolik možností si přepis drží, než vybere výsledek.",

  "settings.dictionary.description":
    "Úvodní věta záložky Slovník. „Přepis“ je tu ten hotový text, ne činnost.",
  "settings.dictionary.newEntry":
    "Popisek řádku, ve kterém se zakládá nová dvojice. „Výraz“, ne „záznam“: záznam je v téhle aplikaci všude jinde nahrávka, takže ve slovníku četl jako nová nahrávka. Výraz je i proto, že ta dvojice může být sousloví, ne jen slovo.",
  "settings.dictionary.find": "Popisek pole: co se v přepisu objevuje špatně.",
  "settings.dictionary.findPlaceholder":
    "Ukázka v poli. Skutečná chyba z reálné nahrávky; klidně nahraď příkladem ze svého jazyka.",
  "settings.dictionary.replace": "Popisek pole: čím se to má nahradit.",
  "settings.dictionary.replacePlaceholder": "Ukázka v poli: správný tvar předchozího příkladu.",
  "settings.dictionary.add": "Tlačítko, které přidá nový záznam do slovníku.",
  "settings.dictionary.empty": "Text místo seznamu, dokud slovník nemá žádný záznam.",
  "settings.speakers.title": "Nadpis sekce o rozpoznávání mluvčích (diarizaci).",
  "settings.speakers.toggle": "Popisek přepínače diarizace.",
  "settings.speakers.shift":
    "Jak často se hledá střídání mluvčích. Technicky posun segmentačního okna.",
  "settings.speakers.shiftFast": "Volba v nabídce: nejhrubší a nejrychlejší hledání.",
  "settings.speakers.shiftFastNote": "Poznámka u volby „Rychle“ v nabídce.",
  "settings.speakers.shiftBalanced": "Volba v nabídce mezi rychlostí a přesností.",
  "settings.speakers.shiftDetailed": "Volba v nabídce: nejjemnější a nejpomalejší hledání.",
  "settings.speakers.shiftDetailedNote": "Poznámka u volby „Podrobně“ v nabídce.",

  "settings.tips.title": "Nadpis sekce o pruhu s klávesovými zkratkami.",

  "settings.backups.latest": "Popisek údaje: kdy se záloha vytvořila naposledy.",
  "settings.backups.none": "Hodnota vedle „Poslední záloha“, dokud žádná není.",
  "settings.backups.count": "Popisek údaje: kolik záloh je uloženo.",
  "settings.backups.directory": "Popisek údaje: kde zálohy leží. Hodnotou je cesta.",
  "settings.backups.reveal":
    "Bublina nad cestou. Kliknutí otevře složku ve správci souborů daného systému.",
  "settings.backups.running": "Stav tlačítka po dobu zálohování.",
  "settings.backups.restoreTitle":
    "Nadpis skrytého bloku. „Vrátit se“, ne „obnovit“ — obnovit zní jako oprava něčeho rozbitého, tohle je návrat v čase. Blok drží všechno, co se s archivem jako celkem dělá: seznam záloh, uložení kopie jinam a načtení souboru.",
  "settings.backups.emptyList":
    "Místo seznamu, dokud žádná záloha není. Blok je vidět i tak, protože načíst archiv ze souboru jde i na čerstvě nainstalovaném počítači.",
  "settings.archive.export":
    "Tlačítko ve skrytém bloku. Uloží kopii archivu tam, kam uživatel ukáže — na disk, který přežije tenhle počítač. Krátký název, protože vedle něj stojí Import archivu.",
  "settings.archive.note":
    "Jedna poznámka pro obě tlačítka, věta na každé. U exportu to, co v kopii není: archiv drží přepisy a cesty ke zvuku, ne zvuk sám. U importu slovo nahradí — ne spojí, ne přidá.",
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

  "settings.decoding.title":
    "Nadpis skrytého bloku s prahovými hodnotami dekódování Whisperu.",
  "settings.decoding.modified": "Odznak u nadpisu, když jsou hodnoty jiné než výchozí.",
  "settings.decoding.silence": "Od jaké hodnoty se úsek prohlásí za ticho.",
  "settings.decoding.confidence": "Jak jistý si přepis musí být, aby úsek přijal.",
  "settings.decoding.entropy":
    "Práh entropie. Jak jednotvárný smí být výstup, než se úsek zkusí znovu.",
  "settings.decoding.temperature":
    "Teplota vzorkování. Vyšší hodnota znamená víc náhody ve výběru slov.",
  "settings.decoding.temperatureStep": "O kolik se teplota zvýší při dalším pokusu.",
  "settings.decoding.reset": "Tlačítko vracející všechny hodnoty na výchozí.",

  "settings.diagnostics.title": "Nadpis skrytého bloku s cestami k nalezeným souborům.",
  "settings.diagnostics.copy":
    "Tlačítko pod tím seznamem. Zkopíruje verzi, cesty, nastavení a konec logu, aby to šlo poslat, když se něco pokazí. Krátké schválně — co se kopíruje, říká věta pod ním.",
  "settings.diagnostics.showLog":
    "Tlačítko vedle kopírování. Otevře složku a označí v ní soubor s logem — pro případ, že posledních šedesát řádků v hlášení nestačí.",
  "settings.diagnostics.noLog":
    "Log se zapisuje až od prvního spuštění, které něco zaznamenalo. Do té doby soubor není.",
  "settings.diagnostics.copyNote":
    "Vysvětlení pod tlačítkem. Podstatné je, že aplikace nic neodesílá; text jde do schránky a rozhoduje uživatel.",
  "settings.diagnostics.copied": "Potvrzení v notifikační liště, že se kopírování povedlo.",
  "settings.diagnostics.copyRefused":
    "Schránku odmítl systém, ne aplikace. Proto se nabízí druhá cesta — poslat rovnou soubor s logem.",
  "settings.diagnostics.copyFailed":
    "Nepodařilo se ty údaje vůbec sestavit. Jiná chyba než odmítnutá schránka.",
  "settings.diagnostics.modelWhisper": "Řádek kontroly: soubor s modelem Whisperu.",
  "settings.diagnostics.modelVad": "Řádek kontroly: model detekce řeči (VAD).",
  "settings.diagnostics.diarizationEmbedding":
    "Řádek kontroly: model, který z hlasu spočítá otisk pro porovnání mluvčích.",
  "settings.diagnostics.notFound": "Hodnota místo cesty, když se soubor nenašel.",
};
