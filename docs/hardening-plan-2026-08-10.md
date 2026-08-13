# Slobot: plán zpevnění pro Clauda

> **Archiv, 13. srpna 2026.** Tento dokument vznikl 10. srpna 2026, kdy se
> aplikace jmenovala Slobot a měla verzi 0.9.0. Jako pracovní zadání dosloužil
> a zůstává tu proto, že vysvětluje, proč dnešní repozitář vypadá, jak vypadá.
>
> Balíčky 0, 1, 2, 5, 7, 8 a 9 jsou splněné. Balíčky 4 (testy frontendu) a 6
> (rozdělení `Detail.tsx`) jsou splněné z větší části a zbytek z nich je
> zlepšení, ne oprava. Balíček 3 byl splněn 10. srpna, znovu zestárl a byl
> opraven 13. srpna.
>
> Kontrola bod po bodu je v [docs/history/2026-08-13.md](history/2026-08-13.md).
> Nic pod touto čarou se od 10. srpna nezměnilo; opravovat archiv by znamenalo
> zahladit, co se tehdy vědělo.

## Účel dokumentu

Tento dokument je pracovní zadání pro Clauda. Nezadává nové funkce ani redesign.
Jeho úkolem je odstranit bezpečnostní, testovací a architektonická slabá místa,
která zůstala po rychlém vývoji Slobotu 0.9.0.

Produktový směr, chování aplikace, texty a design určuje vlastník projektu.
Claude je zde technický realizátor. Nesmí si sám domýšlet nový vzhled, měnit
výchozí chování ani „vylepšovat“ texty, které s úkolem nesouvisejí.

## Výsledek, kterého má práce dosáhnout

Po dokončení má Slobot:

1. působit jako srozumitelný a důvěryhodný veřejný projekt;
2. ověřovat každý stažený program a model před instalací;
3. mít bezpečnostní dokumentaci, která přesně odpovídá kódu;
4. zachytit regresi ve frontendu dřív, než ji uvidí uživatel;
5. projít produkčním sestavením, testy, formátováním a Clippy bez varování;
6. mít menší a srozumitelnější moduly bez změny vzhledu a chování;
7. omezit přístup webview k souborům na skutečně nutný rozsah;
8. držet další práci uvnitř existujícího design systému.

## Co dnes víme

Výchozí stav byl ověřen 10. srpna 2026:

- `npm run build` prošel;
- `cargo fmt --all --check` prošel;
- `cargo test` dokončil 129 testů úspěšně, 1 pomocný test je záměrně ignorovaný;
- `cargo clippy --all-targets -- -D warnings` neprošel kvůli přibližně 20 nálezům;
- frontend nemá automatizované komponentové ani end-to-end testy;
- `Detail.tsx` má přibližně 3 750 řádků a 116 React hooků;
- `transcription.rs` má přibližně 3 620 řádků;
- `styles.css` má přibližně 3 280 řádků;
- `main.rs` má přibližně 2 420 řádků a obsluhuje 59 Tauri příkazů;
- `CLAUDE.md` má přes 10 000 řádků;
- `https://github.com/znackarna/slobot` je veřejný repozitář s výchozí větví
  `main` a 79 veřejnými commity;
- veřejné pole About nemá popis, web ani témata;
- README je pouze česky a názvy commitů jsou převážně česky bez diakritiky;
- repozitář nemá kořenový `LICENSE`, `CONTRIBUTING.md`, šablonu issue ani
  šablonu pull requestu;
- `src-tauri/LICENSE.txt` obsahuje vlastní podmínky použití aplikace, ale
  GitHub je jako licenci zdrojového repozitáře nerozpoznává;
- pracovní strom už obsahuje nezapsané změny v lokalizacích. Nejsou součástí
  tohoto plánu a nesmějí se přepsat, zahodit ani přidat do cizího commitu.

Než Claude cokoli změní, musí znovu spustit `git status --short` a `git diff`.
Existující změny patří uživateli.

## Pevné mantinely

### Produkt a design

Claude nesmí bez výslovného schválení vlastníka:

- měnit viditelné chování;
- měnit texty rozhraní;
- přidat nebo odebrat funkci;
- změnit výchozí nastavení;
- vytvořit nový druh tlačítka, karty, pole, panelu nebo dialogu;
- přidat designový token, barvu, stín, poloměr, typografickou úroveň nebo ikonu;
- měnit rozestupy jen proto, že jiná hodnota „vypadá lépe“;
- přejmenovat existující CSS selektory při funkční změně;
- měnit identifikátor aplikace, historické cesty `Whisp` nebo uložené hodnoty
  databáze bez samostatného migračního zadání.

Když technická oprava vyžaduje viditelnou změnu, Claude práci zastaví a předloží:

1. co přesně dnes uživatel vidí;
2. proč to bez viditelné změny nejde opravit;
3. nejmenší možnou variantu;
4. snímek nebo náčrt výsledku;
5. seznam dotčených pravidel design systému.

### Rozsah jedné změny

Jeden commit řeší jeden problém. Refaktor nesmí současně měnit funkci, text ani
vzhled. Bezpečnostní oprava nesmí obsahovat úklid CSS. Test nesmí být napsaný
tak, že jen potvrzuje novou implementaci; musí popsat očekávané chování.

### Dokazování místo tvrzení

Claude nesmí napsat „hotovo“, „bez regrese“ nebo „bezpečné“, dokud neuvede:

- konkrétní spuštěné příkazy a jejich výsledek;
- ručně ověřené scénáře;
- co nešlo ověřit;
- zbývající rizika;
- u UI snímky před a po ve stejném rozměru okna.

## Pořadí práce

Balíčky níže se plní v uvedeném pořadí. Každý má vlastní větev nebo oddělenou
sadu commitů a vlastní ověření. Claude nesmí rozpracovat všechny najednou.

---

## Balíček 0: uzamknout výchozí stav

### Úkol

Vytvořit reprodukovatelný výchozí protokol, podle kterého půjde poznat, zda
pozdější změna něco nerozbila.

### Postup

1. Zapsat stav pracovního stromu, verzi Node, Rustu a Windows.
2. Spustit:

   ```powershell
   npm run build
   cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
   cargo test --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   ```

3. Uložit seznam existujících varování. Nálezy Clippy neopravovat v tomto
   balíčku.
4. Ručně otevřít hlavní obrazovky v rozměrech 1000 × 660 a 1360 × 900.
5. Pořídit referenční snímky Archivu, Detailu, Nastavení a hlavních dialogů.

### Přijetí

- existuje krátký protokol s výsledky a odkazy na snímky;
- žádný zdrojový soubor se nezměnil;
- nezapsané změny uživatele zůstaly nedotčené.

---

## Balíček 1: upravit veřejný repozitář

### Problém

Veřejná stránka dnes návštěvníkovi nevysvětlí, co Slobot je. Pole About je
prázdné, nejsou nastavená témata, README začíná česky a historie změn mluví
česky bez diakritiky. Chybí také jasná pravidla pro příspěvky a kořenová
licence zdrojového kódu.

Veřejný repozitář neznamená automaticky open source. Soubor
`src-tauri/LICENSE.txt` dovoluje program používat, ale nedává běžná práva open
source licence k úpravám a šíření zdrojového kódu. Tuto otázku nesmí Claude
rozhodnout za vlastníka.

### Jazyk veřejného projektu

Od schválení tohoto balíčku platí:

- commit messages, názvy pull requestů, issue a vývojářská dokumentace jsou
  anglicky;
- viditelné rozhraní Slobotu má nadále češtinu jako zdrojový jazyk;
- česká uživatelská dokumentace zůstane dostupná;
- interní identifikátory a komentáře zůstávají anglicky podle
  `ARCHITECTURE.md`.

### Metadata GitHubu

Nastavit po schválení vlastníkem:

**Description**

> Privacy-first speech-to-text for Windows — local transcription, speaker
> recognition, editing and export.

**Topics**

```text
speech-to-text  transcription  offline  privacy  windows  tauri  rust
react  whisper-cpp  speaker-diarization  local-ai  czech
```

Webovou adresu přidat pouze tehdy, pokud existuje skutečná stránka projektu
nebo stabilní stránka vydání. Claude nesmí vymyslet neexistující web. Později
lze přidat také obrázek pro sdílení na sociálních sítích.

### README

Veřejný `README.md` má být anglicky a během první obrazovky odpovědět:

1. co Slobot dělá;
2. že běží na Windows a přepisuje místně;
3. kdy přesto používá internet;
4. v jakém stavu projekt je;
5. kde se stáhne vydání;
6. jak se sestaví ze zdrojů;
7. jaká jsou známá omezení;
8. kam hlásit chybu nebo zranitelnost.

Českou verzi přesunout do `README.cs.md` a propojit oba soubory viditelnými
odkazy `English · Čeština`. Obsah se nesmí při přesunu zkrátit tak, že zmizí
omezení, síťové chování, licence součástí nebo varování o nepodepsaném programu.

README má dostat alespoň jeden současný snímek aplikace. Snímek nesmí obsahovat
skutečnou nahrávku, jméno, cestu ani jiný soukromý údaj.

### Licence: rozhodnutí vlastníka

Claude nejdřív položí jedinou otázku: má být Slobot open source, nebo pouze
veřejně čitelný zdrojový kód?

Podle odpovědi:

- **open source:** vlastník po právní kontrole zvolí standardní licenci, která
  dovolí používání, úpravy a šíření;
- **source available:** vznikne kořenový `LICENSE` s přesnými vlastními
  podmínkami a README nebude projekt nazývat open source;
- **zatím nerozhodnuto:** README výslovně řekne `All rights reserved` a
  příspěvky se nepřijímají, dokud se podmínky nevyjasní.

`NOTICE` a licence stažených nástrojů jsou jiná vrstva. Nenahrazují licenci
samotného Slobotu. Claude nemá poskytovat právní výklad ani sám vybrat MIT, GPL
nebo jinou licenci.

### Pravidla příspěvků

Přidat `CONTRIBUTING.md`, který popíše:

- podporovaný Windows vývojový postup;
- povinné kontroly před pull requestem;
- že produktový směr a design schvaluje vlastník;
- že nová vizuální rodina nebo designový token vyžaduje předchozí souhlas;
- že změna uživatelského textu začíná v českém slovníku;
- že pull request řeší jeden problém;
- že veřejné commity a pull requesty používají angličtinu.

Přidat stručnou šablonu pull requestu s položkami:

- problem;
- solution;
- behavior that must remain unchanged;
- tests;
- screenshots for UI changes;
- security and data migration impact;
- owner decisions still required.

Issue šablony mají oddělit chybu a návrh funkce. Pro zranitelnost se nesmí
vytvořit veřejná issue šablona. Nastavení issue má odkázat na `SECURITY.md` a
na neveřejný způsob hlášení. Pokud GitHub nabízí soukromé hlášení zranitelností,
Claude ho zařadí mezi navržená nastavení repozitáře.

`CODEOWNERS` přidat až poté, co vlastník určí GitHub účet nebo tým pro kontrolu
UI, bezpečnosti a release workflow.

### Anglické commit messages

Odteď používat krátký anglický rozkazovací nebo popisný název. První řádek má
říct, co se změnilo; tělo vysvětlí proč a upozorní na migraci nebo riziko.

Příklady pro současný projekt:

```text
Add recordings directory and transcript search
Recover playback from the cached proxy
Disable WebView2 browser shortcuts and context menus
Keep short speaker gaps assigned to the same voice
Verify downloaded components before installation
```

Nepřidávat automaticky prefixy `feat:`, `fix:` nebo čísla issue. Conventional
Commits jsou samostatné rozhodnutí vlastníka, ne podmínka kvalitní historie.

### Co se starými českými commity

Výchozí rozhodnutí: **historii nepřepisovat**. Změna zprávy mění SHA commitu a
u starého commitu také SHA všech jeho potomků. Vynutila by force push, rozbila
odkazy a zkomplikovala každou existující lokální kopii. To je příliš vysoká
cena za kosmetické sjednocení.

Místo toho:

1. všechny nové commity psát anglicky;
2. vytvořit anglický `CHANGELOG.md` se srozumitelným souhrnem verze 0.9.0;
3. první veřejné release notes napsat anglicky a přidat odkaz na českou verzi;
4. starou historii brát jako vývoj před otevřením projektu.

Pokud vlastník přesto chce historii přepsat, Claude nejdřív doloží, že nejsou
veřejné release, pull requesty, externí forky ani známí uživatelé větve. Potom
předloží přesný plán zálohy a obnovy. Bez nového výslovného souhlasu nesmí
spustit rebase ani force push.

### Ochrana veřejného repozitáře

Prověřit a navrhnout nastavení:

- ochrana `main` před přímým pushnutím;
- povinný pull request a úspěšné CI;
- zrušení zastaralého schválení po novém pushi;
- secret scanning a push protection;
- soukromé hlášení zranitelností;
- Dependabot upozornění a aktualizační pull requesty;
- code scanning pro TypeScript a Rust, pokud dává použitá konfigurace užitečné
  výsledky;
- podepsané release tagy a SHA-256 vydaných instalátorů.

Claude smí připravit konfiguraci a přesný seznam nastavení. Změnu pravidel
větve, oprávnění organizace a veřejných metadat provede až po výslovném souhlasu
vlastníka.

### Přijetí

- veřejné pole About má schválený anglický popis a témata;
- anglický README představí projekt, český obsah zůstane dostupný;
- kořenová licence přesně odpovídá rozhodnutí vlastníka;
- `CONTRIBUTING.md` vyžaduje anglické commity a chrání designové rozhodování;
- existují použitelné šablony issue a pull requestu;
- anglický changelog shrne českou historii bez jejího přepisování;
- nový commit má krátký a přesný anglický název;
- žádná historie nebyla přepsána a neproběhl force push;
- veřejné CI a bezpečnostní nastavení mají doložený stav.

---

## Balíček 2: ověřovat stažené součásti

### Problém

`src-tauri/src/download.rs` dnes pozná dokončenou instalaci podle existence
`verification_path`. Neověřuje SHA-256 ani podpis. Některé programy navíc hledá
regulárním výrazem v živých GitHub releases. Nalezený soubor pak rozbalí a
Slobot ho později spustí pod účtem uživatele.

To je nejvážnější současné riziko.

### Požadované řešení

1. Každá položka katalogu dostane:

   - pevnou verzi nebo jednoznačný identifikátor vydání;
   - pevnou adresu artefaktu;
   - očekávanou velikost, pokud je stabilní;
   - SHA-256 výsledného staženého souboru.

2. Produkční katalog přestane vybírat spustitelné soubory pomocí vzoru nad
   „latest“ vydáními. Automatické aktualizace součástí jsou jiné produktové
   zadání a do této opravy nepatří.
3. Stahování zapíše data do dočasného souboru a během zápisu spočítá SHA-256.
4. Teprve shodný hash dovolí rozbalení nebo přesun do cílové cesty.
5. Při neshodě Slobot:

   - soubor nespustí ani nerozbalí;
   - dočasný soubor odstraní;
   - zachová předchozí funkční instalaci;
   - zobrazí přeložitelnou chybu s názvem součásti;
   - zapíše očekávaný a skutečný hash pouze do technického detailu nebo logu.

6. Rozbalování musí odmítnout cestu, která by unikla z cílové složky. Audit se
   týká `..`, absolutních cest, prefixů disků a odkazů v archivu.
7. Částečné stažení ani přerušená instalace nesmí vypadat jako dokončená
   součást.
8. Úspěšná instalace zanechá atomický záznam o ověřeném ID, verzi a hashi.
   Samotná existence `verification_path` už nestačí k tvrzení, že byla daná
   verze ověřena.

### Migrace současných instalací

Uživatelé už mohou mít stažené několikagigabajtové modely a programy, o jejichž
původu Slobot uchovává jen existenci souboru. Claude je nesmí potichu označit za
ověřené, ale nesmí je ani bez souhlasu znovu stáhnout.

Před implementací migrace předloží vlastníkovi varianty:

1. označit starou instalaci jako neověřenou a nabídnout výslovné nové stažení;
2. ověřit místní výsledné soubory, pokud katalog obsahuje také hashe
   rozbalených programů a modelů;
3. ponechat starou instalaci funkční s jasným stavem „původ neověřen“ a
   vyžadovat ověření až při příští aktualizaci.

U každé varianty Claude uvede objem nového stahování, chování bez internetu,
dopad na přenosnou kopii a riziko falešného pocitu bezpečí. Bez rozhodnutí
vlastníka migraci nenaprogramuje.

### Povinné testy

- správný hash dovolí instalaci;
- jediný změněný byte instalaci zastaví;
- neshoda nesmaže předchozí funkční soubor;
- přerušené stahování po sobě nenechá dokončený cíl;
- archiv s `../outside.exe` nic nezapíše mimo cílovou složku;
- existující `verification_path` bez záznamu ověřené verze neznamená, že je
  součást důvěryhodná;
- migrační test pokryje instalaci vytvořenou verzí 0.9.0;
- testy nepoužívají veřejnou síť.

### Přijetí

- produkční instalace neobsahuje cestu, která stáhne a spustí neověřený program;
- testy pokrývají správný soubor, poškození, přerušení i únik z archivu;
- `SECURITY.md` přesně popisuje novou hranici důvěry;
- kontrolní součty mají dohledatelný původ z oficiálních vydání.

### Co sem nepatří

- kontrola aktualizací samotného Slobotu;
- automatické přecházení na nejnovější upstream vydání;
- podpis instalátoru Slobotu;
- změna obrazovky výběru modelů.

---

## Balíček 3: opravit bezpečnostní dokumentaci

### Problém

`SECURITY.md` stále tvrdí, že `csp` je `null`. Konfigurace už přitom obsahuje
Content Security Policy. Dokument zároveň správně upozorňuje na široký rozsah
asset protokolu a neověřené stahování.

### Úkol

1. Porovnat každé konkrétní tvrzení v `SECURITY.md` se současným kódem.
2. Opravit českou i anglickou část současně.
3. Popsat CSP přesným významem, ne větou „máme CSP, takže je bezpečno“.
4. Ponechat přiznaná omezení:

   - archiv není šifrovaný;
   - asset protokol je široký, dokud se neopraví v balíčku 8;
   - instalátor není podepsaný, pokud skutečně není;
   - aplikace používá síť při stahování součástí a online importu.

5. Přidat do checklistu vydání ruční kontrolu, že bezpečnostní dokumentace
   odpovídá konfiguraci.

### Přijetí

- v dokumentaci není tvrzení vyvrácené současným repozitářem;
- česká a anglická část říkají totéž;
- žádné riziko se neschová za obecnou formulaci.

---

## Balíček 4: testy frontendu a stavových přechodů

### Problém

Rust má rozsáhlé testy, ale React rozhraní nemá žádnou automatickou ochranu.
Přitom právě v rozhraní vznikaly regrese kolem kláves, zavírání dialogů,
kolabování hlavičky, stavů přehrávače a postranního panelu.

### Testovací vrstvy

#### A. Čisté funkce

Nejdřív oddělit a testovat logiku, která nepotřebuje DOM:

- odstranění diakritiky a normalizaci hledání;
- výpočet shod a přechod další/předchozí;
- formátování času, čísel a množných tvarů;
- redukci stavů přehrávače a běžících úloh;
- rozhodování o aktivním dokumentu a variantě AI výstupu.

#### B. Komponentové testy

Testovací prostředí musí umět nahradit `src/api.ts`, Tauri události, dialogy a
přehrávač. Povinné scénáře:

- Ctrl+F otevře hledání Slobotu, Escape ho zavře;
- Enter, Shift+Enter, F3 a Shift+F3 respektují kontext;
- hledání bez diakritiky najde české slovo;
- editace úseku uloží správný text a při chybě ho neztratí;
- změna mluvčího obnoví správný stav;
- dialog po zrušení nespustí práci na pozadí;
- rozpracovaná úloha správně reaguje na zrušení a opožděnou událost;
- chybějící zdroj nabídne změnu cesty a nehlásí falešné přehrávání;
- postranní panel zachová otevřené sekce při běžném obnovení dat.

#### C. Windows smoke test

Minimální test sestavené aplikace:

1. aplikace se spustí;
2. otevře testovací databázi;
3. zobrazí Archiv;
4. otevře Detail testovací nahrávky;
5. přehraje krátký přiložený WAV;
6. ukončí se bez visícího pomocného procesu.

Velké modely a veřejná síť do smoke testu nepatří.

### Přijetí

- testy selžou při úmyslném porušení uvedených scénářů;
- testy nečekají na skutečný model ani internet;
- testovací kód nevynucuje změnu produkčního designu;
- příkaz pro frontendové testy je součástí `package.json` a CI.

---

## Balíček 5: zpřísnit CI

### Požadované kontroly na pull requestu

Frontend:

```powershell
npm ci
npm run build
npm run test
```

Rust:

```powershell
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

### Další pravidla

1. Běžná kontrola musí spustit skutečný Vite build, ne pouze TypeScript.
2. Varování o překladu bez platného otisku zdroje nesmí projít jako zelený
   release. Pokud má být během rozpracované změny pouze upozorněním, release
   dostane přísnější samostatný režim.
3. Clippy nálezy se mají opravit. Plošné `#[allow(...)]` není oprava. Výjimka
   musí mít úzký rozsah a komentář, proč je daný tvar bezpečnější nebo čitelnější.
4. Instalátor se nemusí sestavovat při každém commitu, ale musí se sestavit pro
   každý release kandidát.
5. Release kandidát musí projít smoke testem nainstalované kopie.

### Přijetí

- větev nelze označit za připravenou, když neprojde build, testy nebo Clippy;
- CI používá stejné příkazy jako místní checklist;
- selhání jasně ukáže, která vrstva neprošla.

---

## Balíček 6: rozdělit frontend bez redesignu

### Zásada

Nejdřív test, potom přesun. Tento balíček nesmí změnit jediný pixel, text,
klávesovou zkratku ani Tauri příkaz.

### `Detail.tsx`

Oddělit po jednom celku. Vhodné hranice:

- logika hledání v přepisu;
- čtečka přepisu a vykreslení úseků;
- editor jednoho úseku;
- panel mluvčích a nepřiřazených vstupů;
- poznámky;
- AI dokument a jeho varianty;
- hlavička detailu;
- orchestrace načítání a Tauri událostí.

Názvy modulů mají být anglické podle `ARCHITECTURE.md`. Česká CSS jména se v
tomto refaktoru nepřejmenovávají. Nová interní jména musí být anglická.

### Stav komponenty

Množství navzájem závislých `useState` má nahradit několik pojmenovaných hooků
nebo reducerů s jasnými událostmi. Claude nesmí pouze přesunout 116 hooků do
jednoho nového souboru.

Každý nový hook musí říct:

- jaký stav vlastní;
- jaké události přijímá;
- jak uklízí listenery, timeouty a rozpracované požadavky;
- co se stane, když odpověď dorazí po změně nahrávky nebo zavření obrazovky.

### `styles.css`

Rozdělit po obrazovkách nebo funkčních celcích, ale zachovat pořadí kaskády.
Před přesunem najít selektory, jejichž výsledek závisí na pořadí. Takové místo
musí dostat test, snímek nebo stručný komentář.

### Cílový tvar

Nejde o soutěž v malých souborech. Přesto po refaktoru:

- `Detail.tsx` obsahuje hlavně orchestrace obrazovky, ne implementaci všech
  jejích částí;
- žádná nová komponenta nepřebírá celý původní monolit;
- sdílené komponenty mají skutečně více než jednoho uživatele;
- CSS pravidlo zůstává u obrazovky nebo rodiny komponent, které ovládá.

### Vizuální kontrola po každém kroku

Porovnat před a po:

- 1000 × 660 a 1360 × 900;
- světlý i tmavý motiv;
- Detail se zavřeným a otevřeným panelem;
- přehrávání, editaci úseku, otevřené hledání a AI náhled;
- focus, hover, disabled a running stavy.

Jakýkoli rozdíl se považuje za regresi, dokud ho vlastník výslovně neschválí.

---

## Balíček 7: rozdělit Rust bez změny IPC

### `main.rs`

Tauri příkaz má být tenká vrstva: ověřit vstup, zavolat službu, převést výsledek
na `UserMessage`. Databázová, procesní a doménová logika nemá zůstat uvnitř
příkazu.

Vhodné skupiny modulů:

- recordings a folders;
- playback a waveform;
- transcription a speakers;
- dictionary a search;
- exports;
- backups;
- downloads a benchmark;
- AI documents;
- Windows lifecycle a WebView2.

Veřejný název Tauri příkazu, argumenty a návratový typ se nesmějí změnit, pokud
to není samostatně schválená migrace.

### `transcription.rs`

Rozdělit podle etap pipeline:

- fronta, rušení a životnost procesů;
- příprava audia;
- VAD a časové mapování;
- spuštění a čtení Whisperu;
- skládání vět a čitelných bloků;
- slovník;
- diarizace a přiřazení mluvčích;
- ukládání výsledku.

Stávající testy přesunout s logikou. Nesmějí se smazat jen proto, že po přesunu
nevidí na soukromou funkci. Raději vytvořit malý modul s úzkým rozhraním.

### Clippy

Funkce s osmi až dvanácti parametry rozdělit nebo jim dát pojmenovaný kontext.
Kontext nesmí být bezejmenný pytel všech závislostí; má seskupit údaje, které
skutečně patří k jednomu běhu nebo požadavku.

`Mutex::lock().unwrap()` zkontrolovat u produkčního stavu. Claude musí popsat,
co se stane po panice vlákna a zda otrávený mutex shodí všechny další příkazy.
Náhradu zvolit podle požadovaného chování, ne mechanickým přepisem.

### Přijetí

- všech 129 současných testů stále prochází;
- přibydou testy nových hranic modulů, kde mohou selhat přenosy dat;
- `cargo clippy --all-targets -- -D warnings` projde;
- názvy IPC a databázové schéma se nezmění;
- ukončení aplikace stále zabije všechny pomocné procesy.

---

## Balíček 8: zúžit přístup webview k disku

### Problém

`assetProtocol.scope` je dnes `['**']`, protože Slobot přehrává soubory z cest,
které vybral uživatel. Kdyby se do webview dostal škodlivý skript, tento rozsah
mu dovolí číst vše, co smí číst uživatelský účet.

### Povinná příprava

Claude nejdřív sepíše všechny cesty, které webview skutečně načítá:

- původní nahrávku;
- playback proxy;
- mikrofonní nahrávku;
- online import;
- případné obrázky nebo jiné assety.

Pak předloží dvě varianty s jejich riziky:

1. dynamicky povolit pouze konkrétní cesty aktuálních nahrávek;
2. poskytovat média přes úzký vlastní protokol nebo backendovou vrstvu.

Implementaci zvolí vlastník projektu. Claude ji nesmí vybrat jen podle toho,
která vyžaduje méně změn.

### Testy

- povolená nahrávka se přehraje;
- playback proxy se přehraje;
- jiný náhodný soubor z uživatelského profilu webview nenačte;
- změna cesty nahrávky odebere staré oprávnění;
- smazání záznamu odebere související oprávnění;
- přenosný režim funguje na jiném písmenu disku.

### Přijetí

- produkční konfigurace už nedává webview obecný přístup ke všem souborům;
- přehrávání všech podporovaných zdrojů zůstává funkční;
- `SECURITY.md` popíše výsledné řešení a jeho zbylé hranice.

---

## Balíček 9: zkrátit pracovní dokumentaci

### Problém

`CLAUDE.md` uchovává cenné důvody, ale přes 10 000 řádků už nelze spolehlivě
načíst a používat jako každodenní pravidla. Dokument obsahuje i překonaná
tvrzení, která opravují až pozdější záznamy.

### Návrh

Historii nesmazat. Rozdělit ji na:

- krátký pracovní soubor s aktuálními pravidly a checklistem;
- `ARCHITECTURE.md` s živou architekturou;
- samostatná rozhodnutí v `docs/decisions/` pro zásadní technické volby;
- archivní změnový deník, který zůstane dohledatelný, ale nenačítá se při každém
  úkolu.

Tento krok mění dosavadní pravidlo v `CLAUDE.md`, a proto ho Claude provede až
po výslovném schválení vlastníka.

### Přijetí

- nový pracovní soubor lze přečíst celý před začátkem úkolu;
- žádné historické rozhodnutí se neztratí;
- aktuální pravidlo není v rozporu s pozdějším dodatkem;
- zásadní rozhodnutí odkazují na soubory a testy, které je chrání.

---

## Produktová rozhodnutí, která Claude nesmí udělat sám

Následující body mohou být rozumná zlepšení, ale vyžadují rozhodnutí vlastníka:

- zda zapnout `copy_imports` ve výchozím stavu;
- zda se má aplikace ptát na kopírování při každém importu;
- zda přidat vlastní kontextové menu pro textová pole;
- jak má hledání zvýraznit frázi rozdělenou mezi více slov;
- zda ukládat seznam dříve použitých jmen mluvčích do databáze;
- zda a jak Slobot kontroluje vlastní aktualizace;
- jaký certifikát a způsob podpisu použít pro release;
- zda změnit některý text na stránce O aplikaci;
- jakákoli nová komponenta nebo změna design systému.

Claude smí u těchto bodů dodat varianty, důsledky a doporučení. Bez odpovědi
vlastníka nesmí změnu implementovat.

## Designová kontrola pro každý zásah do UI

Když vlastník viditelnou změnu schválí, Claude před implementací odpoví na
všechny otázky:

1. Která existující komponenta nebo pravidlo už tento problém řeší?
2. Proč ji lze nebo nelze použít beze změny?
3. Jaké tokeny, rozměry a stavy bude změna používat?
4. Které jiné obrazovky sdílejí dotčený selektor?
5. Jak vypadají hover, focus, active, disabled, running a error?
6. Co se stane v minimálním okně?
7. Co se stane v tmavém motivu?
8. Jak změnu ovládá klávesnice a čtečka obrazovky?
9. Které snímky před a po ji dokazují?

Pokud Claude na první čtyři otázky neumí odpovědět, nemá ještě dost podkladů k
úpravě CSS.

## Povinný závěrečný protokol každého balíčku

Claude odevzdá výsledek v tomto tvaru:

```markdown
## Co se změnilo
- konkrétní chování a soubory

## Co se nezměnilo
- veřejné API, data, texty a vzhled, pokud měly zůstat stejné

## Ověření
- přesný příkaz — výsledek
- ruční scénář — výsledek
- snímky před a po

## Neověřeno
- co nešlo spustit a proč

## Zbývající rizika
- konkrétní, nikoli „mohou existovat další problémy“

## Rozhodnutí vlastníka
- pouze body, bez kterých nelze bezpečně pokračovat
```

## Celková definice hotové práce

Plán je splněný teprve tehdy, když současně platí:

- žádný stažený program se neinstaluje bez ověření integrity;
- bezpečnostní dokumentace odpovídá skutečné konfiguraci;
- webview nemá obecný přístup k celému disku;
- produkční frontend, testy, Rust testy, formátování a Clippy procházejí;
- kritické stavové přechody frontendu mají automatické testy;
- refaktor nezměnil vzhled ani chování bez schválení vlastníka;
- nezůstaly skryté neověřené kroky;
- pracovní dokumentace je krátká, aktuální a historie zůstala dohledatelná;
- žádná uživatelova rozpracovaná změna se neztratila ani nepřimíchala do cizího
  commitu.

## První zadání pro Clauda

Začni pouze balíčkem 0. Nic neopravuj. Zkontroluj pracovní strom, spusť výchozí
kontroly a připrav protokol. Nezapisuj, nestaguj ani nevracej existující změny v
`src/locales/cs/settings.ts`, `src/locales/en/settings.ts` a
`src/locales/sources.json`. Po protokolu se zastav a vyžádej si souhlas s
balíčkem 1.
