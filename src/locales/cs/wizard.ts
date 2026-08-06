/** Strings belonging to the `wizard` screen. */
export const csWizard = {
  // ------------------------------------------------------------------ 0. uvítání
  "wizard.welcome.titleFirstRun": "První spuštění",
  "wizard.welcome.titleAddModels": "Doplnit modely",
  "wizard.welcome.intro":
    "Před prvním přepisem je potřeba stáhnout nástroje a jazykový model. Stahování trvá několik minut, poté aplikace pracuje bez připojení k internetu.",
  "wizard.welcome.configurationLabel": "Konfigurace",
  "wizard.welcome.gpuNvidia": "Grafická karta NVIDIA",
  "wizard.welcome.gpuVulkan": "Grafická karta (Vulkan)",
  "wizard.welcome.gpuNone": "Bez podporované grafické karty",
  "wizard.welcome.transcriptionLabel": "Přepis",
  "wizard.welcome.onGpu": "na grafické kartě",
  "wizard.welcome.onCpu": "na procesoru, tedy pomaleji",
  "wizard.welcome.note": "Podle konfigurace je předvybrána vhodná sada. Změnit ji lze i později.",

  // ------------------------------------------------------------------ 1. kvalita
  "wizard.quality.title": "Rychle, nebo přesně?",
  "wizard.quality.introGpu": "Odhady časů platí pro grafickou kartu v tomto počítači.",
  "wizard.quality.introCpu": "Poběží to na procesoru, takže odhady jsou vyšší, než byste čekali.",
  "wizard.quality.fastestName": "Rychlý",
  "wizard.quality.balancedName": "Vyvážený",
  "wizard.quality.bestName": "Precizní",
  "wizard.quality.fastestSummary":
    "Hodinová nahrávka {duration}. Méně spolehlivý u vlastních jmen a odborných výrazů.",
  "wizard.quality.balancedSummary":
    "Hodinová nahrávka {duration}. Asi jedna chyba na odstavec. Vhodné pro většinu nahrávek.",
  "wizard.quality.bestSummary":
    "Hodinová nahrávka {duration}. Nejvyšší dosažitelná přesnost přepisu.",

  // ------------------------------------------------------------------ 2. mluvčí
  "wizard.speakers.title": "Přepisujete i rozhovory?",
  "wizard.speakers.intro":
    "Pokud mluví víc lidí, aplikace rozdělí text mezi ně.",
  "wizard.speakers.singleName": "Většinou mluví jeden člověk",
  "wizard.speakers.singleDescription": "Přednášky, diktování, poznámky. Nevyžaduje žádné doplňky.",
  "wizard.speakers.multipleName": "Nahrávám i rozhovory",
  "wizard.speakers.multipleDescription":
    "Text se rozdělí mezi jednotlivé mluvčí, které pak můžete pojmenovat.",

  // ------------------------------------------------------------- 3. jazyková úprava
  "wizard.editor.title": "Chcete z přepisu hotový dokument?",
  "wizard.editor.intro":
    "Volitelný místní model opraví interpunkci, odstavce a zjevné chyby. Zachová původní přepis a nic neposílá ven.",
  "wizard.editor.lightName": "Úsporná",
  "wizard.editor.balancedName": "Doporučená",
  "wizard.editor.bestName": "Nejvyšší kvalita",
  "wizard.editor.lightDescription": "Interpunkce, věty a odstavce. Dobrá volba pro slabší CPU.",
  "wizard.editor.balancedDescription":
    "Lépe opravuje zjevné chyby a drží souvislosti delší výpovědi.",
  "wizard.editor.bestDescription":
    "Nejspolehlivější výsledek. Na počítači bez grafiky bude pomalejší.",
  "wizard.editor.skip": "Přeskočit",

  // ------------------------------------------------------------- 4. výběr a stahování
  "wizard.download.failedTitle": "Stahování selhalo",
  "wizard.download.dismissError": "Rozumím",
  "wizard.download.recommendedBadge": "doporučeno",
  "wizard.download.downloadedBadge": "staženo",
  "wizard.download.downloadedLabel": "Staženo",
  "wizard.download.runningTitle": "Probíhá stahování",
  "wizard.download.reviewTitle": "Kontrola výběru",
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
  "wizard.download.startTranscribing": "Jdeme přepisovat",
  "wizard.download.downloadWithSize": "Stáhnout ({size})",

  // ------------------------------------------------------------------ ruční výběr
  "wizard.manual.switchToSimple": "Jednoduchý výběr",
  "wizard.manual.switchToManual": "Vybrat ručně",
  "wizard.manual.groupPrograms": "Programy",
  "wizard.manual.groupModels": "Jazykové modely",
  "wizard.manual.groupSpeakers": "Rozlišení mluvčích",
  "wizard.manual.groupEditor": "Jazyková úprava",

  // ------------------------------------------------------------------ 5. závěr
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

  // ------------------------------------------------------------------ navigace
  "wizard.nav.stepCounter": "Krok {step} z {total}",
} as const;

export const csWizardContext: Partial<Record<keyof typeof csWizard, string>> = {
  "wizard.welcome.titleFirstRun":
    "Nadpis prvního kroku průvodce, když se průvodce otevřel sám, protože bez stažených součástí nelze přepisovat.",
  "wizard.welcome.titleAddModels":
    "Nadpis prvního kroku průvodce, když si ho uživatel otevřel sám z nastavení, aby doplnil další modely.",
  "wizard.welcome.configurationLabel":
    "Popisek karty s hardwarem, který aplikace sama našla. Uživatel ho nezadával.",
  "wizard.welcome.gpuNvidia":
    "Zjištěný hardware: v počítači je grafická karta NVIDIA s ovladačem CUDA.",
  "wizard.welcome.gpuVulkan":
    "Zjištěný hardware: grafická karta ovládaná přes Vulkan. Vulkan běží na jakékoli grafické kartě, ne jen na AMD.",
  "wizard.welcome.gpuNone": "Zjištěný hardware: žádná použitelná grafická karta, počítá se na procesoru.",
  "wizard.welcome.transcriptionLabel":
    "Popisek karty s tím, kde přepis poběží. Hodnota pod ním je „na grafické kartě“ nebo „na procesoru, tedy pomaleji“. Jde o činnost, ne o hotový dokument.",
  "wizard.welcome.onGpu": "Hodnota pod popiskem „Přepis“. Malé písmeno je záměr.",
  "wizard.welcome.onCpu": "Hodnota pod popiskem „Přepis“. Malé písmeno je záměr.",

  "wizard.quality.title":
    "Nadpis druhého kroku průvodce, nad třemi kartami s volbou kvality. „To“ je přepis, který se chystá. Otázka staví rychlost proti přesnosti; jsou to dva konce jedné volby, ne dvě samostatné vlastnosti. Čárka před „nebo“ je záměr — je to vylučovací poměr, ne výčet.",
  "wizard.quality.fastestName":
    "Název volby kvality přepisu, ne název modelu. Nejmenší a nejrychlejší model Whisper.",
  "wizard.quality.balancedName":
    "Název volby kvality přepisu: kompromis mezi rychlostí a přesností. Rod se řídí slovem „kvalita“ jen volně, dnes je to střední rod.",
  "wizard.quality.bestName": "Název volby kvality přepisu: nejpřesnější a zároveň nejpomalejší.",
  "wizard.quality.fastestSummary":
    "Popis volby. {duration} je odhad doby přepisu, například „asi minutu“ nebo „asi 8 minut“.",
  "wizard.quality.balancedSummary":
    "Popis volby. {duration} je odhad doby přepisu, například „asi 3 minuty“.",
  "wizard.quality.bestSummary":
    "Popis volby. {duration} je odhad doby přepisu, například „asi 35 minut“.",

  "wizard.speakers.singleName": "Název volby: v nahrávce mluví převážně jeden člověk.",
  "wizard.speakers.multipleName": "Název volby: uživatel nahrává i rozhovory s více mluvčími.",

  "wizard.editor.lightName":
    "Název volby jazykové úpravy: nejmenší model, nejmenší nároky na výkon.",
  "wizard.editor.balancedName": "Název volby jazykové úpravy, kterou průvodce doporučuje.",
  "wizard.editor.bestName": "Název volby jazykové úpravy: největší a nejpomalejší model.",
  "wizard.editor.lightDescription": "Popis volby. CPU je procesor, zkratku ponech.",
  "wizard.editor.skip": "Tlačítko, kterým uživatel čtvrtý krok přeskočí a jazykovou úpravu nechce.",

  "wizard.download.dismissError": "Tlačítko, kterým uživatel zavře hlášku o selhaném stahování.",
  "wizard.download.recommendedBadge":
    "Odznak u doporučené volby. Malé písmeno a krátký tvar jsou záměr, je to štítek, ne věta.",
  "wizard.download.downloadedBadge":
    "Odznak u volby, jejíž součásti už jsou na disku. Malé písmeno je záměr.",
  "wizard.download.downloadedLabel":
    "Popisek pro odečítač obrazovky u zaškrtnutí vedle stažené položky v ručním výběru.",
  "wizard.download.reviewTitle":
    "Nadpis pátého kroku před spuštěním stahování: přehled toho, co se stáhne.",
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
  "wizard.download.startTranscribing":
    "Hlavní tlačítko, když už je vše stažené. Zavře průvodce a pustí uživatele do aplikace.",
  "wizard.download.downloadWithSize":
    "Hlavní tlačítko se spustí stahování. {size} je celková velikost výběru, například „1,6 GB“.",

  "wizard.manual.switchToSimple": "Tlačítko zpět z ručního výběru součástí do průvodce po krocích.",
  "wizard.manual.switchToManual":
    "Tlačítko do ručního výběru, kde si uživatel odškrtává jednotlivé součásti sám.",
  "wizard.manual.groupPrograms": "Nadpis skupiny v ručním výběru: spustitelné programy, ne modely.",
  "wizard.manual.groupModels": "Nadpis skupiny v ručním výběru: modely pro rozpoznávání řeči.",
  "wizard.manual.groupSpeakers":
    "Nadpis skupiny v ručním výběru: součásti, které rozdělí text mezi jednotlivé mluvčí.",
  "wizard.manual.groupEditor":
    "Nadpis skupiny v ručním výběru: modely, které hotový přepis upraví do čitelného textu.",

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
