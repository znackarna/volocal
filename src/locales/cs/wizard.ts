/** Strings belonging to the `wizard` screen. */
export const csWizard = {
  // ---------------------------------------------- 0. what the machine can do
  // Nothing. The welcome screen's title and introduction went with the screen
  // on 13 August, and the seven `wizard.welcome.*` strings that survived it as
  // a two-panel grid under the one question — `Konfigurace / Grafická karta
  // (Vulkan)` beside `Přepis / na grafické kartě` — are gone with that block on
  // 14 August. The sentence above it, `wizard.quality.introGpu`, already said
  // the estimates were for the graphics card in this computer.

  // ------------------------------------------------------------------ 1. quality
  "wizard.quality.title": "Rychle, nebo přesně?",
  "wizard.quality.introGpu": "Odhady časů platí pro grafickou kartu v tomto počítači.",
  "wizard.quality.introCpu": "Poběží to na procesoru, takže odhady jsou vyšší, než byste čekali.",
  "wizard.quality.fastestName": "Rychlý",
  "wizard.quality.bestName": "Přesný",
  "wizard.quality.fastestSummary":
    "Hodinová nahrávka {duration}. Přepis může být proti zvuku posunutý až o tři sekundy, takže kliknutí na slovo netrefí přesné místo.",
  "wizard.quality.bestSummary":
    "Hodinová nahrávka {duration}. Kliknutí na slovo přehraje zvuk přesně od něj.",
  "wizard.quality.changeableNote":
    "Model lze změnit i později v nastavení. Už hotové přepisy se tím ale nepřepočítají.",

  // The speaker step and the language-editing step are gone, and so are their
  // words. Speaker recognition comes down with everything else and is switched
  // on where the reader has a recording to switch it on for; language editing
  // is asked for once, on the transcript screen, when a document is first
  // wanted. Neither is a question for a first run.

  // ------------------------------------------------------ 4. choosing and downloading
  "wizard.download.failedTitle": "Stahování selhalo",
  "wizard.download.dismissError": "Rozumím",
  "wizard.download.recommendedBadge": "doporučeno",
  "wizard.download.downloadedBadge": "staženo",
  "wizard.download.runningTitle": "Probíhá stahování",
  "wizard.download.reviewTitle": "Co se stáhne",
  "wizard.download.summary.one": "Stáhne se {count} položka, dohromady {size}.",
  "wizard.download.summary.few": "Stáhnou se {count} položky, dohromady {size}.",
  "wizard.download.summary.many": "Stáhne se {count} položky, dohromady {size}.",
  "wizard.download.summary.other": "Stáhne se {count} položek, dohromady {size}.",
  "wizard.download.preparing": "Připravuji",
  "wizard.download.extracting": "{name} — rozbaluji",
  "wizard.download.itemProgress": "{done} z {total}",
  "wizard.download.megabytesProgress": "{downloaded} z {total} MB",
  "wizard.download.statusDone": "hotovo",
  "wizard.download.statusError": "chyba",
  "wizard.download.statusWaiting": "čeká",
  "wizard.download.nothingNeeded": "Všechno potřebné už máte.",
  "wizard.download.downloadWithSize": "Stáhnout ({size})",
  "wizard.download.percent": "{percent} %",
  "wizard.download.viewLabel": "Podrobnost výpisu",
  "wizard.download.viewCompact": "Stručný výpis",
  "wizard.download.viewFull": "Podrobný výpis",

  // ------------------------------------------------------------- choosing by hand
  "wizard.manual.title": "Modely a nástroje",
  "wizard.manual.install": "Stáhnout",
  "wizard.manual.reinstall": "Stáhnout znovu",
  "wizard.manual.remove": "Smazat",
  "wizard.manual.removeTitle": "Smazat {name}?",
  "wizard.manual.removeText":
    "Uvolní se {size}. Stáhnout to jde kdykoli znovu, ale znovu to potrvá.",
  "wizard.manual.removeChosenText":
    "Uvolní se {size}. Tenhle model má aplikace nastavený, takže místo něj " +
    "vezme {next}. Stáhnout ho jde kdykoli znovu, ale znovu to potrvá.",
  "wizard.manual.removeLastText":
    "Uvolní se {size}. Tenhle model má aplikace nastavený a jiný stažený " +
    "není — o stažení si řekne, až ho bude potřebovat.",
  "wizard.manual.lockedBusy": "Právě se používá. Až práce skončí, půjde smazat.",
  "wizard.manual.lockedUnlisted":
    "Aplikace neví, které soubory k této součásti patří. Po opětovném stažení " +
    "ji smazat půjde.",
  "wizard.manual.groupPrograms": "Programy pro přepis",
  "wizard.manual.groupModels": "Jazykové modely pro přepis",
  "wizard.manual.groupSpeech": "Detekce řeči a mluvčích",
  "wizard.manual.groupEditor": "Programy a modely pro jazykovou úpravu",

  // ------------------------------------------------------------- 5. conclusion
  "wizard.done.introReady": "Vše je připraveno. Přetažením nahrávky do okna začne přepis.",
  "wizard.done.tabHint":
    "Klávesa {key} přeskakuje na místa s nízkou jistotou přepisu. Kontrola textu tak zabere jen několik minut.",
  "wizard.done.almostTitle": "Téměř hotovo",
  "wizard.done.failedTitle": "Instalace se nezdařila",
  "wizard.done.partialIntro": "Přepis je funkční. Nepodařilo se stáhnout pouze tyto položky:",
  "wizard.done.missingIntro": "Chybí položky nutné pro přepis:",
  "wizard.done.addLater": "Doplnit je lze kdykoliv v sekci Modely.",
  "wizard.done.backToSelection": "Zpět na výběr",
  "wizard.done.continueAnyway": "Pokračovat bez toho",

  // ---------------------------------------------------------------- navigation
  "wizard.nav.stepCounter": "Krok {step} z {total}",
} as const;

export const csWizardContext: Partial<Record<keyof typeof csWizard, string>> = {
  "wizard.quality.title":
    "Nadpis druhého kroku průvodce, nad dvěma kartami s volbou kvality. „To“ je přepis, který se chystá. Otázka staví rychlost proti přesnosti; jsou to dva konce jedné volby, ne dvě samostatné vlastnosti. Čárka před „nebo“ je záměr — je to vylučovací poměr, ne výčet.",
  "wizard.quality.fastestName":
    "Název volby kvality přepisu, ne název modelu. Nejmenší a nejrychlejší model Whisper.",
  "wizard.quality.bestName": "Název volby kvality přepisu: nejpřesnější a zároveň nejpomalejší.",
  "wizard.quality.changeableNote":
    "Poznámka pod kartami. Říká, že volba není nevratná, ale že se zpětně neprojeví na už hotových přepisech.",
  "wizard.quality.fastestSummary":
    "Popis volby. {duration} je odhad doby přepisu, například „asi minutu“ nebo „asi 8 minut“.",
  "wizard.quality.bestSummary":
    "Popis volby. {duration} je odhad doby přepisu, například „asi 35 minut“.",

  "wizard.download.dismissError": "Tlačítko, kterým uživatel zavře hlášku o selhaném stahování.",
  "wizard.download.recommendedBadge":
    "Odznak u doporučené volby. Malé písmeno a krátký tvar jsou záměr, je to štítek, ne věta.",
  "wizard.download.downloadedBadge":
    "Odznak u volby, jejíž součásti už jsou na disku. Malé písmeno je záměr.",
  "wizard.download.reviewTitle":
    "Nadpis výpisu v průvodci před spuštěním stahování. Nic se v něm nedá " +
    "měnit, takže ne „kontrola výběru“ — žádný výběr tam není. Ruční výpis ze " +
    "Spravovat modely má vlastní nadpis, wizard.manual.title.",
  "wizard.download.summary.one":
    "Věta nad seznamem. {size} je celková velikost, například „1,6 GB“.",
  "wizard.download.preparing":
    "Zástupný název položky, než začne stahování první součásti. Vypisuje se místo jejího názvu.",
  "wizard.download.extracting":
    "{name} je název stahované součásti z katalogu. Rozbaluje se stažený archiv.",
  "wizard.download.itemProgress": "Kolikátá položka z kolika se právě stahuje, například „2 z 5“.",
  "wizard.download.megabytesProgress":
    "Kolik megabajtů z kolika je staženo. Obě čísla jsou celá, jednotka je za nimi.",
  "wizard.download.statusDone": "Stav položky v seznamu stahování. Malé písmeno je záměr.",
  "wizard.download.statusError": "Stav položky v seznamu stahování. Malé písmeno je záměr.",
  "wizard.download.statusWaiting":
    "Stav položky v seznamu stahování: ještě na ni nedošlo. Malé písmeno je záměr.",
  "wizard.download.nothingNeeded": "Ukáže se místo seznamu, když není co stahovat.",
  "wizard.download.downloadWithSize":
    "Hlavní tlačítko se spustí stahování. {size} je celková velikost výběru, například „1,6 GB“.",
  "wizard.download.viewLabel":
    "Popisek přepínače nad výpisem pro odečítač obrazovky. Nezobrazuje se.",
  "wizard.download.viewCompact":
    "Popisek jedné ze dvou poloh přepínače nad výpisem. Přepínač má jen ikony, " +
    "takže se text nezobrazuje — čte ho odečítač obrazovky a ukáže se v bublině " +
    "nad tlačítkem. Tahle poloha: řádek je jen název a velikost. Výchozí stav. " +
    "Tvar věty drž stejný jako u „Kompaktní výpis“ v archivu, je to týž ovladač.",
  "wizard.download.viewFull":
    "Druhá poloha téhož přepínače, taky jen jako popisek: pod názvem je navíc " +
    "věta, co ta položka dělá.",

  "wizard.manual.install":
    "Popisek kolečka na řádku výpisu, které stáhne jednu položku. Nezobrazuje " +
    "se jako text — je v bublině a čte ho odečítač obrazovky. Sloveso.",
  "wizard.manual.reinstall":
    "Týž popisek, když už položka stažená je: kolečko pod kurzorem nabídne " +
    "stáhnout ji znovu. Je to jediná oprava, kterou tahle obrazovka má pro " +
    "soubor, co se stáhl poškozený — proto „znovu“, ne „aktualizovat“: nová " +
    "verze se tím nezíská, komponenty jsou připíchnuté v components.json.",
  "wizard.download.percent":
    "Průběh stahování na řádku, místo velikosti. Mezera před procentem je " +
    "česká typografie; v angličtině se nepíše.",
  "wizard.manual.remove":
    "Popisek koše na řádku výpisu. Nezobrazuje se jako text — je v bublině a " +
    "čte ho odečítač obrazovky — a je i na potvrzovacím tlačítku v dialogu, " +
    "kde vidět je. Sloveso, ne podstatné jméno.",
  "wizard.manual.removeTitle":
    "Nadpis potvrzovacího dialogu. {name} je název položky z katalogu, třeba " +
    "„Větší model jazykové úpravy“.",
  "wizard.manual.removeText":
    "Věta v tom dialogu. {size} je uvolněné místo i s jednotkou. Druhá půlka " +
    "věty je podstatná: smazání není nevratné, jen drahé — u sedmigigového " +
    "modelu je to znovu celé stahování.",
  "wizard.manual.removeChosenText":
    "Táž věta, ale u modelu, který má aplikace nastavený — smazat ten, kterým " +
    "se pracuje, je něco jiného než smazat rezervu, tak to dialog říká. " +
    "{next} je název jiného staženého modelu, který nastavení převezme; " +
    "aplikace ho tam opravdu zapíše, tohle není odhad.",
  "wizard.manual.removeLastText":
    "Táž věta, když už žádný jiný stažený model není. Nastavení se vyprázdní " +
    "a aplikace si o model řekne, až ho bude potřebovat — proto ne varování, " +
    "ale konstatování, co bude dál.",
  "wizard.manual.lockedBusy":
    "Bublina zámku na řádku výpisu, který teď nejde smazat, protože ho něco " +
    "používá — běží přepis, převod zvuku, rozpoznávání mluvčích nebo jazyková " +
    "úprava. Která z těch prací to je, se v bublině neříká schválně: čtenář " +
    "s tím stejně nic nedělá. Druhá půlka věty je ta podstatná — je to dočasné " +
    "a stačí počkat. Krátce; delší verze zněla jako výmluva.",
  "wizard.manual.lockedUnlisted":
    "Bublina zámku u součásti, která se nainstalovala dřív, než si aplikace " +
    "začala zapisovat seznam souborů, a sdílí složku s ostatními programy — " +
    "bez toho seznamu nejde smazat „jen ji“. Tohle všechno je mechanismus a do " +
    "věty nepatří: čtenáře zajímá proč to nejde a co s tím. Opětovné stažení " +
    "ten seznam zapíše, proto věta slibuje smazání až po něm, ne hned.",
  "wizard.manual.title":
    "Nadpis ručního výpisu ze Spravovat modely. Je pod ním všechno, co se dá " +
    "stáhnout, včetně toho, co v počítači už je — proto ne „co se stáhne“, to " +
    "je nadpis výpisu v průvodci.",
  "wizard.manual.groupPrograms":
    "Nadpis skupiny v ručním výběru: spustitelné programy, ne modely. Jsou pod " +
    "ním sestavení whisperu, ffmpeg a stahovač online videí — všechno je to " +
    "cesta k přepisu. „Pro přepis“ tam je proto, že programy pro jazykovou " +
    "úpravu mají vlastní skupinu.",
  "wizard.manual.groupModels":
    "Nadpis skupiny v ručním výběru: modely, kterými se nahrávka přepisuje. " +
    "„Pro přepis“ je nutné rozlišení — v seznamu jsou i jazykové modely pro " +
    "úpravu textu, takže samotné „Jazykové modely“ by neoddělovalo nic.",
  "wizard.manual.groupSpeech":
    "Nadpis skupiny v ručním výběru. Jsou pod ním dvě položky: detekce řeči " +
    "(kde se v nahrávce mluví) a rozpoznání mluvčích (kdo mluví). Obě rozhodují " +
    "o zvuku, ne o slovech — nadpis proto pojmenovává tu práci, ne ty dva " +
    "pojmy. Oba druhé pády jsou záměr, ne překlep.",
  "wizard.manual.groupEditor":
    "Nadpis skupiny v ručním výběru. Jsou pod ním dva programy (llama.cpp pro " +
    "grafickou kartu a pro procesor) a jazykové modely, které hotový přepis " +
    "upraví do čitelného textu. Nadpis vyjmenovává obojí schválně: jinak by " +
    "čtenář hledal ty programy o tři skupiny výš, u ostatních programů.",

  "wizard.done.tabHint":
    "{key} je název klávesy F3, vypisuje se tučně a nepřekládá se.",
  "wizard.done.almostTitle":
    "Nadpis závěru, když se nepodařilo stáhnout jen doplňkové součásti a přepisovat už jde.",
  "wizard.done.failedTitle": "Nadpis závěru, když chybí něco, bez čeho přepis nefunguje.",
  "wizard.done.addLater": "Modely jsou název sekce v nastavení aplikace.",
  "wizard.done.backToSelection": "Tlačítko zpět na pátý krok, kde se vybírá, co se má stáhnout.",
  "wizard.done.continueAnyway":
    "Tlačítko, kterým uživatel zavře průvodce, přestože se něco nestáhlo.",

  "wizard.nav.stepCounter": "Číslo kroku nad nadpisem, například „Krok 2 z 5“.",
};
