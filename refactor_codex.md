Níže je hotové zadání pro Claude Opus 5. Rozděluje práci do bezpečných etap, vysvětluje důvod a chrání chování i design.

---

# Volocal — rozdělení velkých React komponent

## Výchozí stav

Pracuješ na Volocalu 1.2.23. Aplikace je funkční, vydaná a používaná. Toto není přepis ani příležitost změnit její design.

Největší frontendové komponenty nyní soustřeďují příliš mnoho stavů a odpovědností:

- `src/Detail.tsx`: přibližně 3 500 řádků a 53 stavových proměnných;
- `src/Settings.tsx`: přibližně 2 900 řádků a 22 stavových proměnných;
- `src/App.tsx`: přibližně 1 960 řádků a 33 stavových proměnných;
- `src/SetupWizard.tsx`: přibližně 1 820 řádků;
- `src/Library.tsx`: přibližně 1 480 řádků.

Projekt má před zahájením práce zelený build:

- 187 frontendových testů;
- 248 procházejících Rust testů;
- TypeScript bez chyb;
- Clippy bez varování;
- dokumentace a překlady odpovídají kódu.

Na začátku si aktuální čísla znovu ověř. Mohla se od sepsání tohoto zadání změnit.

# Cíl

Rozděl velké React komponenty podle skutečných produktových odpovědností.

Výsledkem nemá být pouze více souborů. Výsledkem má být stav, kdy:

- logika jedné funkce leží pohromadě;
- její stav vlastní nejnižší rozumná komponenta nebo hook;
- změna poznámek nevyžaduje procházet přehrávač a správu mluvčích;
- vedlejší efekt má jasného vlastníka;
- jednotlivé funkce lze testovat přes jejich uživatelské chování;
- hlavní obrazovky především skládají funkční celky;
- současné chování a vzhled zůstanou stejné.

# Proč tuto změnu děláme

Problémem není samotná délka souborů. Dlouhý soubor může být přehledný a krátký soubor může skrývat špatné hranice.

Problémem je koncentrace odpovědností.

`Detail.tsx` současně řídí:

- načtení nahrávky;
- přehrávání a waveform;
- aktivní větu;
- hledání v přepisu;
- opravy textu;
- nejistá slova;
- slovník;
- mluvčí;
- poznámky;
- export;
- AI úpravy a dokumenty;
- několik dialogů;
- klávesové zkratky.

Změna jedné oblasti proto snadno zasáhne jinou. Vývojář musí při každé úpravě držet v hlavě téměř celou obrazovku.

Rozdělení má zmenšit oblast, kterou může jedna změna poškodit. Nemá vytvářet abstrakce pro jejich vlastní krásu.

# Závazná omezení

## Zachovej produkt

Neměň:

- vzhled;
- texty;
- rozložení;
- chování ovládacích prvků;
- klávesové zkratky;
- animace;
- pořadí prvků;
- CSS třídy;
- Tauri příkazy;
- názvy událostí;
- strukturu databáze;
- obsah exportů;
- způsob přehrávání;
- způsob přepisu;
- produktové rozhodnutí.

Pokud při práci objevíš skutečnou chybu, nejprve ji popiš. Opravu odděl od refaktoringu a přidej regresní test. Neschovávej změnu chování do commitu označeného jako refactoring.

## Zachovej designový systém

Nevytvářej:

- novou barvu;
- nový typ tlačítka;
- novou rodinu komponent;
- nový spacing token;
- nový způsob dialogu;
- novou typografii;
- vlastní CSS pro extrahovanou komponentu, pokud lze zachovat stávající pravidla.

Při přesunu JSX zachovej DOM strukturu a pořadí CSS tříd. Kaskáda a pořadí prvků mohou ovlivnit vzhled i bez změny samotného CSS.

## Nepřidávej globální správu stavu

Nepřidávej Redux, Zustand, MobX ani jinou knihovnu.

Volocal je jediné desktopové okno. Lokální stav, vlastní hooky a případně `useReducer` stačí.

Context použij pouze tam, kde jednu stabilní hodnotu skutečně čtou alespoň tři vzdálené větve a předávání přes props by nemělo produktový význam. Context nepoužívej jako místo, kam lze odložit libovolný stav.

## Nevyráběj komponenty s desítkami props

Přesunout 500 řádků JSX do komponenty s 25 props neřeší koncentraci logiky. Pouze ji schová.

Pokud nová komponenta potřebuje příliš mnoho props, polož si otázky:

1. Nemá vlastnit část stavu sama?
2. Patří obsluha událostí do vlastního hooku?
3. Lze props seskupit do smysluplného stavového modelu a sady akcí?
4. Není navržená hranice na špatném místě?

Neseskupuj nesouvisející hodnoty do anonymního objektu jen proto, aby byl počet props menší.

# Pracovní postup

Pracuj po malých etapách. Po každé etapě musí zůstat zelený build a testy.

Každý commit má řešit jednu srozumitelnou oblast a jeho název musí být anglicky.

Před změnami spusť:

```powershell
npm run build
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Rust se refaktoringem měnit nemá, ale jeho testy potvrzují, že se neporušila společná hranice.

# Etapa 1 — charakterizační testy

Než začneš přesouvat stav, projdi současné frontendové testy.

Doplň pouze testy potřebné k ochraně těchto cest:

## Detail

- otevření a zavření hledání;
- přechod mezi výsledky hledání;
- přidání, úprava a smazání poznámky;
- spuštění opravy segmentu a její uložení nebo zrušení;
- přiřazení a přejmenování mluvčího;
- otevření AI nástrojů;
- přepnutí náhledu mezi původním textem, úpravou, shrnutím a překladem;
- zachování shellové cesty pro přepis a rozpoznávání mluvčích.

## Settings

- přepínání záložek;
- změna nastavení a jeho uložení;
- přidání a úprava slovníkové položky;
- stav stahované komponenty;
- záloha a obnova;
- kontrola aktualizace.

## App

- přechod archiv → detail → zpět;
- zpracování průběhu přepisu;
- otevření dialogu pro mluvčí před zahájením příslušné operace;
- příjem souboru přetažením;
- práce se sledovanou složkou;
- zobrazení a zavření informační nebo chybové zprávy.

Testuj pozorovatelné chování. Netestuj názvy hooků, počet stavů ani vnitřní implementaci.

Nevyráběj snapshoty celé obrazovky.

# Etapa 2 — malé a bezpečné části Detailu

Začni oblastmi s jasnou hranicí a malým počtem vazeb.

## 2.1 Hledání v přepisu

Přesuň do vlastní funkční oblasti:

- `finding`;
- `findQuery`;
- `findAt`;
- výpočet výsledků;
- přechod na předchozí a další výsledek;
- otevření a zavření hledání;
- obsluhu Enter a Shift+Enter;
- vykreslení vyhledávacího řádku.

Navržené soubory:

```text
src/detail/useTranscriptSearch.ts
src/detail/TranscriptSearch.tsx
```

Hook smí vystavit jen stav a akce potřebné obrazovkou a klávesovou obsluhou.

## 2.2 Pruh klávesových tipů

Přesuň jeho vykreslení do samostatné komponenty. Stav viditelnosti může komponenta vlastnit, pokud ho nepotřebuje nic dalšího.

```text
src/detail/TranscriptTips.tsx
```

Zachovej současný klíč v `localStorage`, texty i CSS třídy.

## 2.3 Průběh operace

Sjednoť rozhodnutí, který `ProgressBubble` se vykreslí, v malé prezentační komponentě:

```text
src/detail/DetailProgress.tsx
```

Nepřesouvej do ní řízení přepisu ani AI operace. Má pouze zobrazit již známý stav a zavolat dodanou akci pro zrušení.

Po této etapě spusť všechny kontroly a ověř Detail při velikostech 1000×660 a 1360×900 v obou barevných režimech.

# Etapa 3 — poznámky jako první úplný svislý řez

Poznámky mají jasná data, vlastní stav i vlastní uživatelské akce. Jsou vhodným prvním příkladem správného rozdělení.

Přesuň pohromadě:

- načtené poznámky nebo jejich řízenou část;
- rozepsanou poznámku;
- otevřenou poznámku;
- čas nové poznámky;
- rozepsané časy;
- přidání;
- změnu;
- změnu času;
- smazání;
- řazení;
- vykreslení sekce.

Navržené soubory:

```text
src/detail/useRecordingNotes.ts
src/detail/NotesSection.tsx
```

Existující pomocné funkce v `src/detail/notes.tsx` zachovej a použij. Nevytvářej jejich druhou kopii.

Hook může přijmout například:

- ID nahrávky;
- délku;
- aktuální čas;
- způsob vyhledání času v přehrávači;
- hlášení chyby.

Musí vrátit pojmenovaný model a pojmenované akce. Nevracej neuspořádaný seznam setterů.

Po dokončení nesmí `Detail.tsx` znát jednotlivé drafty poznámek.

# Etapa 4 — správa mluvčích

Přesuň správu mluvčích jako druhý svislý řez.

Oblast zahrnuje:

- mapování mluvčích podle klíče;
- výpočet ukázek a podílů;
- přehrání ukázky;
- pojmenování;
- vrácení jména do zásobníku;
- přidání hlasu;
- odstranění hlasu;
- sloučení;
- přiřazení segmentu;
- vytvoření nového hlasu;
- příslušnou část postranního panelu.

Navržené soubory:

```text
src/detail/useSpeakerManagement.ts
src/detail/SpeakersSection.tsx
```

Dodrž důležitou hranici:

- `Detail` nesmí začít volat backend pro přepis nebo rozpoznání mluvčích přímo;
- `onTranscribe` a `onDiarize` zůstávají shellové operace vlastněné `App`;
- shell musí dál zobrazit otázku na počet mluvčích před zahájením příslušné práce.

Pokud je stav mluvčích úzce spojený se segmenty, hook smí dostat segmenty a jednu pojmenovanou akci pro jejich aktualizaci. Nemá přebírat celý Detail.

# Etapa 5 — editace přepisu

Přesuň:

- `editing`;
- `editingUncertain`;
- návrh slovníkové opravy;
- zahájení editace;
- uložení textu;
- potvrzení nejistého úseku;
- vytvoření slovníkové položky;
- odvozené seznamy upravených a nejistých segmentů;
- kontextové akce nad segmentem.

Navržené soubory:

```text
src/detail/useTranscriptEditing.ts
src/detail/TranscriptPane.tsx
src/detail/ReviewSections.tsx
```

Využij existující:

- `src/detail/corrections.tsx`;
- `src/detail/keys.ts`;
- `src/detail/TranscriptContextMenu.tsx`;
- `src/transcriptText.ts`.

Neměň význam kláves Tab, Enter, Escape, mezerníku ani dvojkliku.

`TranscriptPane` nemá vlastnit mluvčí, poznámky ani AI dokumenty. Má vykreslit přepis a předat uživatelské akce příslušnému controlleru.

# Etapa 6 — AI dokumenty

Toto je největší a nejrizikovější samostatná oblast. Začni ji až po stabilizaci předchozích etap.

Přesuň společně:

- dostupnost a konfiguraci lokálního editoru;
- stav probíhající AI práce;
- režim opravy;
- délku shrnutí;
- jazyk překladu;
- vlastní zadání;
- náhledové záložky;
- uložené AI dokumenty a výstupy;
- nabídku menšího modelu;
- nabídku stažení editoru;
- spuštění, opakování a zrušení operace;
- ukládání dokumentů;
- dialogy a náhledy AI nástrojů.

Navržená struktura:

```text
src/detail/ai/useAiWorkspace.ts
src/detail/ai/AiToolsDialog.tsx
src/detail/ai/AiPreviewDialog.tsx
src/detail/ai/AiModelOffer.tsx
```

Zvaž `useReducer`, protože několik hodnot přechází mezi společnými stavy:

- zavřeno;
- chybí model;
- nabídka konfigurace;
- připraveno;
- běží;
- náhled;
- chyba.

Nepřeváděj mechanicky každý `useState` na reducer. Reducer použij pouze pro stavy, které musí přecházet společně.

Zachovej existující helpery z `src/detail/documents.tsx`.

# Etapa 7 — přehrávání

Přehrávání upravuj až po předchozích etapách.

Přesuň lokální spojení mezi Detailem a společným přehrávačem:

- waveform;
- lokální čas;
- seek;
- tiché posunutí kurzoru;
- spuštění od konkrétního času;
- aktivní segment;
- automatické posouvání přepisu;
- stav chybějícího zdrojového souboru.

Navržený hook:

```text
src/detail/useDetailPlayback.ts
```

Toto je kritická oblast. Zachovej přesně současné chování seeku, přehrávání MP3, kliknutí na slovo a automatického scrollování.

Před přesunem doplň charakterizační test, pokud některá z těchto cest ještě ochranu nemá.

# Etapa 8 — načtení detailu a výsledná kompozice

Teprve po přesunu jednotlivých funkcí zvaž:

```text
src/detail/useRecordingDetail.ts
src/detail/DetailHeader.tsx
```

`useRecordingDetail` může vlastnit základní údaje nahrávky:

- titul;
- cestu;
- délku;
- stav;
- chybu;
- jazyk;
- složku;
- segmenty;
- slovník;
- načtení a obnovení detailu;
- posluchače změn, které tato data skutečně mění.

Nevkládej do něj přehrávání, AI, poznámky ani stav dialogů jen proto, aby se `Detail.tsx` zkrátil.

`DetailHeader` vytáhni až nyní. Kdybys ho vytáhl dříve, vznikla by komponenta s příliš mnoha nesouvisejícími props.

Po této etapě má být `Detail.tsx` především kompozice:

```tsx
function Detail(props: Props) {
  const recording = useRecordingDetail(...);
  const playback = useDetailPlayback(...);
  const search = useTranscriptSearch(...);
  const editing = useTranscriptEditing(...);
  const speakers = useSpeakerManagement(...);
  const notes = useRecordingNotes(...);
  const ai = useAiWorkspace(...);

  return (
    <main className="detail">
      <DetailHeader ... />
      <DetailProgress ... />
      <PlaybackControls ... />
      <TranscriptSearch ... />
      <TranscriptPane ... />
      <DetailSidebar ... />
      <AiToolsDialog ... />
      <AiPreviewDialog ... />
    </main>
  );
}
```

Toto je ilustrace odpovědností, ne příkaz slepě kopírovat přesný tvar API.

# Etapa 9 — Settings

Po dokončení Detailu rozděl `SettingsScreen` podle existujících záložek.

Navržená struktura:

```text
src/settings/SettingsNavigation.tsx
src/settings/FilesSettings.tsx
src/settings/ToolsSettings.tsx
src/settings/PerformanceSettings.tsx
src/settings/TranscriptionSettings.tsx
src/settings/InterfaceSettings.tsx
src/settings/UpdatesSettings.tsx
src/settings/AboutSettings.tsx
src/settings/useSettingsModel.ts
src/settings/useDictionary.ts
```

Existující `Backups`, `About`, `UpdateCheck` a `SettingsToggle` znovu použij. Nepiš jejich náhrady.

## Vlastnictví stavu

`SettingsScreen` nebo `useSettingsModel` může dál vlastnit načtený objekt `Settings` a jednu cestu pro jeho ukládání.

Jednotlivé záložky mají dostat:

- nastavení, která skutečně zobrazují;
- pojmenovanou akci pro změnu;
- data nástrojů, pokud je potřebují.

Slovník má vlastní data a CRUD operace, proto ho přesuň do vlastního hooku a komponenty.

Stahování komponent může mít vlastní controller, pokud se tím nezdvojí globální stav stahování z `App`.

Po dokončení má `SettingsScreen` řídit hlavně:

- aktivní záložku;
- načtení společného modelu;
- navigaci;
- vykreslení vybrané záložky.

# Etapa 10 — App jako kompoziční kořen

`App` musí zůstat vlastníkem celého okna. Neodstraňuj jeho roli jen kvůli kratšímu souboru.

Má dál rozhodovat:

- která obrazovka je otevřená;
- která nahrávka je vybraná;
- zda se zobrazí wizard;
- jak spolu komunikují archiv, detail a nastavení;
- které operace vyžadují otázku před spuštěním.

Přesuň pouze jasné funkční celky:

```text
src/app/useNotices.ts
src/app/useAppNavigation.ts
src/app/useTranscriptionRuntime.ts
src/app/useWatchFolder.ts
src/app/useFolderManagement.ts
src/app/AppFooter.tsx
src/app/AppDialogs.tsx
```

## Důležité hranice

`useTranscriptionRuntime` může vlastnit:

- průběhy přepisu;
- živé segmenty;
- průběhy AI;
- posluchače backendových událostí;
- přechody mezi fázemi;
- frontu čekající na otázku o mluvčích.

`useWatchFolder` může vlastnit:

- kandidáty;
- automatický režim;
- přijetí;
- ignorování;
- spuštění automatického přepisu.

`useAppNavigation` může vlastnit historii obrazovek, ale nepřidávej React Router. Aplikace nemá URL navigaci a router by zde nepřinesl užitek.

`AppDialogs` smí být prezentační vrstva. Nemá se stát druhým skrytým správcem aplikace.

# Co zatím nedělat

V prvním kole nerozděluj `SetupWizard.tsx` ani `Library.tsx`, pokud to nevyžaduje čistá hranice vzniklá při práci na `App`.

Nejdříve dokonči Detail, Settings a shell. Rozšíření rozsahu by zvýšilo riziko, že vznikne dlouhá větev, kterou nepůjde bezpečně zkontrolovat.

Nedělej:

- přepis CSS;
- přejmenování tříd;
- změnu překladových klíčů;
- sjednocování textů;
- výměnu ikon;
- optimalizaci výkonu bez měření;
- změnu backendu;
- nový systém routování;
- nový design komponent;
- nový systém formulářů;
- hromadnou změnu názvů.

# Pravidla pro hooky a komponenty

## Stav ukládej co nejníže

Pokud stav potřebuje jen jedna komponenta, patří do ní.

Pokud ho sdílí několik částí jedné funkce, patří do feature hooku.

Pokud ho potřebují různé obrazovky nebo rozhoduje o běhu celé aplikace, zůstává v `App`.

## Vedlejší efekt má mít jednoho vlastníka

Každý:

- Tauri listener;
- timer;
- práce s `localStorage`;
- načtení dat;
- změna přehrávače;
- spuštění externí operace

musí mít jednoho jasného vlastníka a spolehlivý cleanup.

Nepřesuň listener do komponenty, která se může při běžném renderování opakovaně připojovat.

## Rozlišuj model a akce

Hook má vracet pojmenované části:

```ts
return {
  state: {
    query,
    currentHit,
    totalHits,
  },
  actions: {
    open,
    close,
    next,
    previous,
  },
};
```

Nemá vracet deset setterů, jejichž správné pořadí musí znát volající komponenta.

## Neskrývej závislosti

Nevytvářej univerzální `useDetailContext`, který zpřístupní celý Detail všem potomkům. To by koncentraci stavu pouze přesunulo do jiného souboru.

# Průběžné ověřování

Po každé etapě spusť:

```powershell
npm run build
npm run test
```

Po každé větší etapě spusť také:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Ručně ověř:

- 1000×660;
- 1360×900;
- světlý režim;
- tmavý režim;
- dlouhý český název;
- angličtinu;
- otevřený a zavřený postranní panel;
- přehrávání;
- hledání;
- klávesové zkratky;
- poznámky;
- mluvčí;
- AI dialog;
- nastavení.

Pokud se vzhled změnil, nepovažuj to automaticky za zlepšení. Najdi příčinu a obnov předchozí podobu.

# Měřítko úspěchu

Počet řádků není hlavní cíl. Přesto očekáváme, že po smysluplném přesunu odpovědností:

- `Detail.tsx` bude převážně kompoziční obrazovka;
- `Settings.tsx` nebude obsahovat implementaci každé záložky;
- `App.tsx` nebude obsahovat podrobnosti sledované složky, složek archivu a všech event listenerů;
- feature stav nebude vlastnit vzdálený rodič bez důvodu;
- nové soubory budou čitelné samostatně;
- nevznikne univerzální globální store;
- žádná funkce ani vzhled se nezmění.

Nevynucuj konkrétní počet řádků. Pokud soubor zůstane delší, ale má jednu soudržnou odpovědnost, je to přijatelnější než krátký soubor s nečitelným API.

# Commity

Používej malé anglické commity, například:

```text
Extract transcript search from Detail
Move recording notes into their own controller
Separate speaker management from the transcript screen
Extract the AI document workspace
Move Settings tabs into feature components
Isolate transcription events from the application shell
```

Nemíchej několik etap do jednoho commitu.

Dodrž současná pravidla `CLAUDE.md`. Historii zapisuj stručně. Mechanický seznam přesunutých řádků patří do commitu, ne do několikastránkového deníku.

# Závěrečné předání

Na konci vrať stručný report:

1. jaké odpovědnosti byly odděleny;
2. které nové komponenty a hooky vznikly;
3. kdo nyní vlastní jednotlivé skupiny stavu;
4. které závislosti musely zůstat ve společném rodiči a proč;
5. počet řádků a stavových proměnných před a po změně;
6. jaké testy přibyly;
7. výsledky všech kontrol;
8. co jsi záměrně nerozdělil;
9. kde stále vidíš příliš silnou vazbu;
10. zda se změnil vzhled nebo chování.

Nevytvářej release ani tag. Nepublikuj změny bez souhlasu vlastníka.

---

## Stručné odůvodnění pro tebe

Pořadí není náhodné:

- Hledání a tipy Clauda naučí přesouvat malé části bez zásahu do produktu.
- Poznámky jsou první úplná funkce se stavem, API i vlastním rozhraním.
- Mluvčí a editace jsou složitější, ale mají pořád rozpoznatelnou hranici.
- AI nástroje mají nejvíc společných stavových přechodů, proto přicházejí později.
- Přehrávání je nejcitlivější část celé obrazovky a přesouvá se až ve chvíli, kdy je kolem něj méně okolního kódu.
- Hlavička se přesouvá nakonec, protože na začátku by pouze dostala obrovské množství props.
- `App` zůstává kompozičním kořenem. Cílem není odstranit centrální řízení, ale zbavit ho detailů jednotlivých funkcí.

Tímto způsobem Claude nebude jen stříhat soubory. Postupně přesune stav i odpovědnost tam, kam patří, a po každém kroku bude možné ověřit, že Volocal zůstal stejným produktem.