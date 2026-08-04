/** Strings belonging to the Settings screen. */
export const csSettings = {
  "settings.title": "Nastavení",
  "settings.groups": "Skupiny nastavení",
  "settings.tab.transcription": "Přepis",
  "settings.tab.performance": "Modely a výkon",
  "settings.tab.appearance": "Vzhled",
  "settings.tab.dictionary": "Slovník",
  "settings.tab.files": "Soubory",
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
  "settings.portable.copyTitle": "Kopie na přenosný disk",
  "settings.portable.copyDescription":
    "Zkopíruje aplikaci i modely na zvolený disk. Na jiném počítači pak stačí spustit {file}.",
  "settings.portable.copyDestination": "Kam vytvořit přenosnou kopii",
  "settings.portable.copyHint":
    "Z flash disku se model načítá pomaleji, často asi o minutu.",
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
  "settings.modules.speakers": "Rozlišení mluvčích",
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
  "settings.editor.best.title": "Nejlepší kvalita",
  "settings.editor.best.description": "Nejspolehlivější, ale na CPU pomalejší.",
  "settings.editor.missing": "Model jazykové úpravy zatím není stažený.",
  "settings.editor.enabledNote": "Model se načte až při spuštění úpravy.",

  // Compute backend, threads and the speed test.
  "settings.performance.title": "Výkon",
  "settings.performance.description":
    "Rychlost se liší několikanásobně podle způsobu zpracování.",
  "settings.performance.autoDescription": "Vybere nejrychlejší z toho, co je v počítači.",
  "settings.performance.cudaDescription": "Grafická karta NVIDIA. Nejrychlejší, když ji počítač má.",
  "settings.performance.vulkanDescription": "Jakákoli grafická karta, včetně NVIDIA.",
  "settings.performance.cpuDescription": "Bez grafické karty. Několikanásobně pomalejší.",
  "settings.performance.defaultDescription": "Sestavení bez zvolené akcelerace.",
  "settings.performance.compute": "Akcelerace zpracování",
  "settings.performance.selectedMissing":
    "Vybraný způsob zpracování zatím není stažený. Přepis zatím běží tím, co je k dispozici.",
  "settings.performance.notDownloaded": "není stažené",
  "settings.performance.mode": "Režim: {mode} · NVIDIA {nvidia} · Vulkan {vulkan}",
  "settings.performance.yes": "ano",
  "settings.performance.no": "ne",
  "settings.performance.threads": "Vlákna procesoru",
  "settings.performance.threadsAuto": "automaticky",
  "settings.performance.threadsNote": "Nula znamená automatickou volbu.",
  "settings.performance.benchmarkNote":
    "Test přepíše kousek nahrávky každým dostupným režimem a nejrychlejší rovnou nastaví.",
  "settings.performance.benchmarking": "Měřím…",
  "settings.performance.benchmark": "Změřit rychlost",
  "settings.performance.benchmarkFailed": "nelze použít — {error}",
  "settings.performance.benchmarkResult": "{factor}× realtime ({seconds} s)",

  // Folders: where the programs and models live, and which folder is watched.
  "settings.files.locations": "Umístění",
  "settings.files.locationsPortable":
    "Relativní cesty se vztahují ke složce s programem, takže nezáleží na písmenu disku.",
  "settings.files.locationsDescription":
    "Programy i modely se stahují samy. Cestu měň, jen když je potřebuješ mít jinde.",
  "settings.files.binDirectory": "Složka s programy",
  "settings.files.modelsDirectory": "Složka s modely",
  "settings.files.choose": "Vybrat…",
  "settings.files.watchTitle": "Sledovaná složka",
  "settings.files.watchDescription":
    "Hlídá nové nahrávky ve vybrané složce. V Archivu je nabídne k přepisu.",
  "settings.files.watchDirectory": "Složka s nahrávkami",
  "settings.files.watchPlaceholder": "Není vybraná žádná složka",
  "settings.files.watchRemove": "Odebrat",
  "settings.files.watchToggle": "Sledovat složku",
  "settings.files.watchToggleNote":
    "Nabídne i soubory, které už ve složce jsou. Vnořené složky neprohledává.",

  // Fonts and the sample paragraph that shows them off.
  "settings.appearance.fontUi": "Písmo rozhraní",
  "settings.appearance.fontText": "Písmo přepisu",
  "settings.appearance.fontGroupSerif": "Patkové (na čtení)",
  "settings.appearance.fontGroupSans": "Bezpatkové",
  "settings.appearance.fontSize": "Velikost textu v přepisu",
  "settings.appearance.fontSizeValue": "{value} px",
  "settings.appearance.lineHeight": "Řádkování",
  "settings.appearance.previewSpeaker": "Radomil",
  "settings.appearance.previewText":
    "A tak se ten syn vrátil domů, k otci, kterého předtím opustil. Je psáno v listu Efezským, v páté kapitole: „Muži, milujte své ženy.“ Otec ho uviděl už zdálky — 1 234 kroků daleko — a běžel mu naproti.",
  "settings.appearance.previewDiacritics": "Háčky a čárky: ě š č ř ž ý á í é ú ů ň ť ď",

  // What Whisper is told to do.
  "settings.transcription.model": "Model",
  "settings.transcription.modelDescription": "Stažený model.",
  "settings.transcription.modelNote": "Jen stažené modely. Další přidáš v sekci Modely.",
  "settings.transcription.language": "Jazyk",
  "settings.transcription.languageNote":
    "Předem vybraný jazyk urychlí přepis. U více jazyků nech automatiku.",
  "settings.transcription.vad": "Detekce řeči",
  "settings.transcription.vadNote":
    "Vynechá ticho a šum a brání zacyklení začátku přepisu. Nech zapnuté.",
  "settings.transcription.beam": "Důkladnost hledání",
  "settings.transcription.beamNote":
    "Vyšší hodnota zvyšuje přesnost a prodlužuje dobu přepisu.",

  // Telling speakers apart.
  "settings.dictionary.description":
    "Slova, která přepis plete pokaždé stejně: jména, místa, odborné výrazy. Opraví se ve všech nových přepisech.",
  "settings.dictionary.newEntry": "Nový záznam",
  "settings.dictionary.find": "Co přepis slyší",
  "settings.dictionary.findPlaceholder": "součas DNA",
  "settings.dictionary.replace": "Jak to má být",
  "settings.dictionary.replacePlaceholder": "součást DNA",
  "settings.dictionary.add": "Přidat",
  "settings.dictionary.empty": "Slovník je zatím prázdný.",

  "settings.speakers.title": "Mluvčí",
  "settings.speakers.toggle": "Rozlišovat mluvčí",
  "settings.speakers.description":
    "Rozdělí text mezi jednotlivé mluvčí už při prvním přepisu. U nahrávek s jedním mluvčím nemá využití.",
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
    "Archiv tvoří jediný soubor. Při každém spuštění aplikace se vytvoří jeho kopie: zůstávají tři poslední a k tomu jedna z každého z posledních sedmi dnů.",
  "settings.backups.latest": "Poslední záloha",
  "settings.backups.none": "zatím žádná",
  "settings.backups.count": "Uloženo kopií",
  "settings.backups.directory": "Složka",
  "settings.backups.reveal": "Otevřít složku se zálohami",
  "settings.backups.note": "Záloha se vytváří automaticky při spuštění.",
  "settings.backups.running": "Zálohuji…",
  "settings.backups.action": "Zálohovat teď",

  // Whisper decoding thresholds, hidden behind a disclosure.
  "settings.decoding.title": "Jemné ladění přepisu",
  "settings.decoding.modified": "upraveno",
  "settings.decoding.note":
    "Měň jen při konkrétním problému. Výchozí hodnoty odpovídají nastavení Whisperu.",
  "settings.decoding.silence": "Práh ticha",
  "settings.decoding.silenceNote":
    "Zvyš, když vzniká text v tichu. Sniž, když mizí tiše pronesená slova.",
  "settings.decoding.confidence": "Práh jistoty",
  "settings.decoding.confidenceNote": "Blíž k nule znamená přísnější kontrolu a delší přepis.",
  "settings.decoding.entropy": "Práh jednotvárnosti",
  "settings.decoding.entropyNote": "Nižší hodnota dřív zastaví opakování stejné věty.",
  "settings.decoding.temperature": "Teplota",
  "settings.decoding.temperatureNote": "Vyšší hodnota přidává náhodu. Pro běžný přepis nech nulu.",
  "settings.decoding.temperatureStep": "Krok teploty",
  "settings.decoding.temperatureStepNote":
    "Při dalším pokusu zvýší teplotu o tuto hodnotu. Nula další pokusy vypne.",
  "settings.decoding.reset": "Zpět na výchozí",

  // Where each tool and model was found on disk.
  "settings.diagnostics.title": "Technické podrobnosti",
  "settings.diagnostics.modelWhisper": "model Whisperu",
  "settings.diagnostics.modelVad": "model VAD",
  "settings.diagnostics.diarizationProgram": "diarizace (program)",
  "settings.diagnostics.diarizationSegmentation": "diarizace (segmentace)",
  "settings.diagnostics.diarizationEmbedding": "diarizace (hlasové otisky)",
  "settings.diagnostics.notFound": "nenalezeno",
} as const;

export const csSettingsContext: Partial<Record<keyof typeof csSettings, string>> = {
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
  "settings.modules.speakersOn": "Hodnota dlaždice „Rozlišení mluvčích“, tedy střední rod.",
  "settings.modules.speakersReady": "Hodnota dlaždice „Rozlišení mluvčích“, tedy střední rod.",
  "settings.modules.speakersMissing": "Hodnota dlaždice „Rozlišení mluvčích“, tedy střední rod.",
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
  "settings.performance.mode":
    "{mode} je název výpočetního režimu, {nvidia} a {vulkan} jsou „ano“ nebo „ne“ podle toho, zda je ovladač k dispozici.",
  "settings.performance.yes": "Doplňuje se za název ovladače na řádku o výpočetním režimu.",
  "settings.performance.no": "Doplňuje se za název ovladače na řádku o výpočetním režimu.",
  "settings.performance.threads": "Kolik vláken procesoru smí přepis využít.",
  "settings.performance.threadsAuto":
    "Hodnota vedle popisku, když je počet vláken nastavený na nulu.",
  "settings.performance.benchmarking": "Stav tlačítka po dobu měření rychlosti.",
  "settings.performance.benchmarkFailed":
    "Výsledek měření u režimu, který se nepodařilo spustit. {error} je hlášení z programu.",
  "settings.performance.benchmarkResult":
    "Výsledek měření: {factor}× rychleji než skutečný čas nahrávky, {seconds} je doba testu v sekundách.",

  "settings.files.locations": "Název sekce s cestami ke složkám.",
  "settings.files.choose": "Tlačítko otevírající dialog pro výběr složky. Tři tečky jsou jeden znak.",
  "settings.files.watchPlaceholder": "Zástupný text v poli, dokud složka není vybraná.",
  "settings.files.watchRemove": "Odebere vybranou složku z nastavení. Nic nemaže na disku.",

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
  "settings.dictionary.newEntry": "Popisek řádku, ve kterém se zakládá nový záznam.",
  "settings.dictionary.find": "Popisek pole: co se v přepisu objevuje špatně.",
  "settings.dictionary.findPlaceholder":
    "Ukázka v poli. Skutečná chyba z reálné nahrávky; klidně nahraď příkladem ze svého jazyka.",
  "settings.dictionary.replace": "Popisek pole: čím se to má nahradit.",
  "settings.dictionary.replacePlaceholder": "Ukázka v poli: správný tvar předchozího příkladu.",
  "settings.dictionary.add": "Tlačítko, které přidá nový záznam do slovníku.",
  "settings.dictionary.empty": "Text místo seznamu, dokud slovník nemá žádný záznam.",
  "settings.speakers.title": "Nadpis sekce o rozlišování mluvčích (diarizaci).",
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
  "settings.diagnostics.modelWhisper": "Řádek kontroly: soubor s modelem Whisperu.",
  "settings.diagnostics.modelVad": "Řádek kontroly: model detekce řeči (VAD).",
  "settings.diagnostics.diarizationProgram":
    "Řádek kontroly: spustitelný program pro rozpoznání mluvčích.",
  "settings.diagnostics.diarizationSegmentation":
    "Řádek kontroly: model, který nahrávku dělí na úseky jednotlivých mluvčích.",
  "settings.diagnostics.diarizationEmbedding":
    "Řádek kontroly: model, který z hlasu spočítá otisk pro porovnání mluvčích.",
  "settings.diagnostics.notFound": "Hodnota místo cesty, když se soubor nenašel.",
};
