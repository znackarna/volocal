# Výchozí protokol (balíček 0) — Slobot 0.9.0

Pořízeno 10. srpna 2026. Účel: zafixovat stav, proti kterému se poznají pozdější
regrese. **Nic v tomto balíčku se neopravovalo.** Nálezy Clippy zůstávají tak,
jak jsou.

## 1. Pracovní strom

Větev `main`, HEAD `a44478e` (*Slozka pro nahravky, hledani v prepisu, vypnuty
WebView2 defaulty*).

```
 M src/locales/cs/settings.ts
 M src/locales/en/settings.ts
 M src/locales/sources.json
?? PLAN-ZPEVNENI-PRO-CLAUDE.md
```

`git diff --stat`: 3 soubory, 9 vložení, 9 odebrání. Nic ve staging area.

Tyto změny patří vlastníkovi. Nebyly zapsané, zastagované ani vrácené a po
skončení kontrol jsou bajt po bajtu stejné (ověřeno níže).

## 2. Prostředí

| | |
|---|---|
| Kontroly z 10. srpna běžely v | Ubuntu 22.04 (Linux sandbox), Node v22.22.3, npm 10.9.8 |
| Rust toolchain v sandboxu | **není nainstalovaný** |

Doplněno na stroji vlastníka (Claude Code, 10. srpna 2026):

| | |
|---|---|
| Windows | 11 Pro, sestavení NT 10.0.26200.0 |
| Node | v22.23.1 |
| npm | 12.0.1 |
| rustc / cargo | 1.97.1 (`8bab26f4f`, 2026-07-14) |
| clippy | 0.1.97 |
| toolchain | `stable-x86_64-pc-windows-msvc` (výchozí) |

**Windows běh proběhl nad HEAD `3749ac3`, ne nad `a44478e` z odstavce 1.** Mezi
tím leží šest commitů (balíček 1, přejmenování CI, balíček 2 a rozdělení
změnového protokolu). Neuzamčené změny vlastníka ve třech souborech jsou
totožné — `git status --short` i `git diff --stat` vracejí přesně tytéž řádky
jako 10. srpna a SHA-256 těch tří souborů se po všech kontrolách nezměnily.

Sandbox má repozitář připojený, ale `node_modules` v pracovním stromu obsahuje
jen binárky pro Windows (`@esbuild/win32-x64`, `@rollup/rollup-win32-*`).
`npm ci` ani `npm install` proto v pracovním stromu **neproběhly**: přepsaly by
je linuxovými a rozbily sestavení na Windows, a `npm install` navíc přepisuje
sledovaný `package-lock.json`.

## 3. Výsledky kontrol

| Příkaz | Kde | Výsledek |
|---|---|---|
| `node scripts/i18n.mjs check` | sandbox, pracovní strom | **prošel**, exit 0 |
| `tsc --noEmit` | sandbox, pracovní strom | **prošel**, exit 0 |
| `vite build` | sandbox, **izolovaná kopie** v `/tmp` | **prošel**, exit 0, 770 ms |
| `npm run build` (celé) | Windows, pracovní strom | **prošel**, exit 0, 4,5 s |
| `cargo fmt --all --check` | Windows, pracovní strom | **prošel**, exit 0, bez výpisu |
| `cargo test` | Windows, pracovní strom | **prošel**, exit 0 — 138 prošlo, 0 selhalo, 1 ignorovaný |
| `cargo clippy --all-targets -- -D warnings` | Windows, pracovní strom | **selhal**, exit 101 — 21 nálezů, seznam níže |

`npm run build` je `i18n:check && tsc --noEmit && vite build`. V sandboxu
proběhly první dva kroky přímo nad pracovním stromem a třetí jen nad kopií, kam
bylo možné doinstalovat linuxové binárky (`@esbuild/linux-x64`,
`@rollup/rollup-linux-x64-gnu`) bez dopadu na pracovní strom. Na Windows běžel
celý řetěz nad pracovním stromem.

Rustové příkazy byly volány s `--manifest-path src-tauri/Cargo.toml`, jak je
předepsáno v `CLAUDE.md`. `target/` byl už zahřátý, takže naměřené časy (test
25 s, clippy 12 s) měří inkrementální překlad, ne studený. Samotný běh testů
trval 0,17 s.

### Co při windowsovém běhu vyšlo jinak než v sandboxu

Slovník teď hlásí **939 českých klíčů** ve 12 souborech a **angličtinu 909/909
(100 %)**, proti 941 a 911/911 z 10. srpna; překladů bez otisku zdroje je 7,
ne 5. Není to regrese: sandboxový běh měřil `a44478e`, tento `3749ac3`, a mezi
tím leží šest commitů — mimo jiné ten, který přestal stahovat nepoužívané
součásti a odstranil s nimi klíče `catalog.sherpa.*`
a `catalog.model-segmentace.*`. Obě varování zůstávají varováními, exit kód je 0.

Velikost sestavení pro srovnání s pozdějšími balíčky: `dist/assets/index-*.js`
495,71 kB (gzip 141,35 kB), `index-*.css` 94,25 kB (gzip 16,32 kB), 100
transformovaných modulů, vite 1,36 s.

### Zaznamenaná varování `i18n:check`

Obojí je varování, ne chyba; exit kód je 0.

- `79 textů pod více klíči` — z velké části záměr (`Precizní` v průvodci
  i v Nastavení, `Nový přepis` na čtyřech místech).
- `en: 5 překladů bez otisku zdroje` — pochází z nezapsaných změn vlastníka
  v `src/locales/*/settings.ts`. Po dokončení té práce je čeká
  `npm run i18n:approve en …`.

Slovník při tomto běhu: 941 českých klíčů ve 12 souborech, angličtina 911/911
(100 %). Windowsový běh o šest commitů později hlásí 939 a 909/909 — proč, je
o odstavec výš.

### Nálezy Clippy (21)

Pořízeno na Windows nad `3749ac3` příkazem
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`,
exit 101. **Nic z toho se neopravovalo**; seznam je vstup pro balíček 7 a měřítko,
proti kterému se pozná, jestli mezitím nepřibyl nález nový.

Čtrnáct nálezů je v samotné binárce, sedm jen v testech. Rozdělení je doložené
druhým během **bez** `--all-targets`, který vypsal právě těch čtrnáct.

V binárce:

| Lint | Místo |
|---|---|
| `too_many_arguments` (12/7) | `ai_edit.rs:596` |
| `too_many_arguments` (8/7) | `ai_edit.rs:718` |
| `too_many_arguments` (9/7) | `ai_edit.rs:869` |
| `too_many_arguments` (8/7) | `transcription.rs:908` |
| `manual_pattern_char_comparison` | `export.rs:45`, `transcription.rs:1427`, `transcription.rs:1507` |
| `redundant_closure` | `tools.rs:101` |
| `cloned_ref_to_slice_refs` | `tools.rs:347`, `tools.rs:348`, `tools.rs:350`, `tools.rs:351` |
| `for_kv_map` | `transcription.rs:180` |
| `needless_range_loop` | `voiceprint.rs:587` |

Jen v testech:

| Lint | Místo |
|---|---|
| `field_reassign_with_default` | `db.rs:1662`, `db.rs:1681`, `tools.rs:989` |
| `unnecessary_get_then_check` | `download.rs:1290` |
| `bool_assert_comparison` | `transcription.rs:2910` |
| `excessive_precision` | `voiceprint.rs:818`, `voiceprint.rs:828` |

Všechny cesty jsou relativní k `src-tauri/src/`. Čísla řádků platí pro
`3749ac3` a posunou se s každou úpravou v těch souborech — pro pozdější
srovnání je spolehlivější dvojice *lint + soubor* než přesný řádek.

`HANDOVER.md` odhadoval „zhruba dvacet nálezů"; přesné číslo je 21.

### Ověření, že se nic nezměnilo

`sha256sum` všech 62 souborů v `src/` a `scripts/` před kontrolami a po nich —
seznamy jsou totožné. `git status --short` po kontrolách vrací přesně tytéž
čtyři řádky jako před nimi.

Totéž po windowsovém běhu: `git status --short` hlásí tři `M` řádky
v `src/locales/` a nesledované `BASELINE-0.9.0.md`
a `PLAN-ZPEVNENI-PRO-CLAUDE.md`, `git diff --stat` pořád 3 soubory, 9 vložení,
9 odebrání, a SHA-256 těch tří souborů vlastníka se nezměnily. `npm run build`
zapisuje do `dist/`, které je ignorované; `cargo` do `src-tauri/target/`, rovněž
ignorovaného.

## 4. Změřený rozsah kódu

| Soubor | Řádky |
|---|---|
| `src/Detail.tsx` | 3 748 (118 volání React hooků) |
| `src/styles.css` | 3 279 |
| `src/Settings.tsx` | 1 848 |
| `src/App.tsx` | 1 555 |
| `src/Library.tsx` | 1 442 |
| `src-tauri/src/transcription.rs` | 3 619 |
| `src-tauri/src/main.rs` | 2 421 (64 příkazů `#[tauri::command]`, 64 v `generate_handler!`) |
| `src-tauri/src/db.rs` | 2 271 |
| `src-tauri/src/ai_edit.rs` | 1 283 |
| `src-tauri/src/voiceprint.rs` | 1 165 |
| `CLAUDE.md` | 10 235 |

Testy: 130 atributů `#[test]` v Rustu, z toho 1 `#[ignore]` — sedí na „129 testů
prošlo, 1 ignorovaný“ z plánu. Ve frontendu **0 testovacích souborů** a
`package.json` nemá skript `test`.

Odchylky proti číslům v plánu: `main.rs` má 64 příkazů, ne 59; `Detail.tsx` má
118 volání hooků, ne 116. Řádkové rozsahy sedí.

## 5. Referenční snímky

**Pořízeny 10. srpna z běžící aplikace na stroji vlastníka.** Šestnáct snímků
v `D:\Repo\slobot-snimky\`, spolu s vlastním návodem a nástrojem `snap.ps1`,
kterým jdou pořídit znovu stejně.

| | 1360 × 900 | 1000 × 660 |
|---|---|---|
| Archiv | světlý, tmavý | světlý, tmavý |
| Detail přepisu | světlý, tmavý | světlý, tmavý |
| Detail s otevřeným panelem | světlý | — |
| Nastavení → Modely | světlý, tmavý | světlý, tmavý |
| Nastavení → Vzhled | světlý | — |
| Dialog Nový přepis | světlý, tmavý | — |

**Schválně mimo repozitář.** Ten je veřejný a na snímcích jsou skutečné
nahrávky vlastníka — jména, délky, obsah přepisu. Slouží k jedinému: až se bude
dělit `Detail.tsx` a `styles.css`, porovná se výsledek s nimi. Snímek do
`README.md` je jiná věc a musí vzniknout z vymyšlených dat.

Rozměry v názvech jsou v jednotkách aplikace. Displej běží na 150 %, takže
1360 × 900 je soubor 2040 × 1350.

### Past, kvůli které první tři pokusy vyšly nakřivo

Obsah byl posunutý a vpravo useknutý, ve všech pokusech stejně. Vypadalo to
jako vada zobrazení v aplikaci a nebyla to ona: **proces, který Windows neřekne,
že rozumí zvětšení displeje, dostává přepočítané souřadnice.** `GetWindowRect`
pak hlásí dvě třetiny skutečné velikosti, snímek se založí moc malý a stránka
vypadá vysázená do širšího okna, než jaké má. Rozhodl to až snímek pořízený
druhou cestou — z obrazovky místo z okna — na kterém bylo vidět, že okno leží
jinde a je větší, než co API tvrdilo.

Řeší to jeden řádek na začátku `snap.ps1`, `SetProcessDpiAwarenessContext(-4)`,
a musí být dřív, než se sáhne na první okno. Kdo ten postup přenese jinam, ať
ho vezme s sebou: bez něj selže tiše a vypadá to jako vada aplikace.

### Co se při focení v aplikaci měnilo

Motiv byl na dobu tmavé sady přepnutý na `Tmavý` a pak vrácený na
`Podle systému`. Nic jiného; archiv ani nastavení se nezměnily.

## 6. Nález mimo zadání: co je v instalátoru

Otázka vlastníka zněla, jestli jsou `onnxruntime.dll` a `DirectML.dll` opravdu
vedle `Slobot.exe`. Z repozitáře plyne:

- **`onnxruntime.dll` nikde není** — v celém `src-tauri/target` se nevyskytuje.
  `ort` ho linkuje staticky; odpovídá tomu i 35,3 MB `slobot.exe`.
- **`DirectML.dll` build script vedle exe kopíruje** (`target/release/`,
  `target/debug/`, `deps/`, `examples/`).
- **Vygenerovaný `target/release/nsis/x64/installer.nsi` instaluje jediný
  soubor:** `File "${MAINBINARYSRCPATH}"`. Žádné `resources`, žádná DLL.
  `tauri.conf.json` klíč `bundle.resources` vůbec nemá.

Takže `DirectML.dll` v instalátoru **není**. Že rozpoznávání mluvčích
z nainstalované kopie funguje, má dvě možná vysvětlení a rozlišit je umí jen
stroj vlastníka:

1. Windows mají vlastní `DirectML.dll` v `System32` (od verze 1903), takže se
   načte systémová — pak závisí na tom, jak je stará, a na cizím stroji může být
   starší, než `ort` potřebuje.
2. Registrace DirectML tiše selhala a běh spadl zpět na procesor. To je
   navržené chování a zapisuje se do `slobot-log.txt` vedle archivu.

Rozliší to: zda je `DirectML.dll` v instalační složce, řádek o pádu zpět
v `slobot-log.txt` a doba rozpoznávání proti spuštění z `target/release`.

**Neopraveno.** Patří k vydání a integritě součástí, ne k balíčku 0.

## 7. Protokolu už nechybí nic

Doplněno 10. srpna na stroji vlastníka: verze Windows, Node a Rustu
(odstavec 2), všechny čtyři příkazy včetně seznamu nálezů Clippy (odstavec 3)
a šestnáct referenčních snímků (odstavec 5).

**Balíček 0 je tím hotový.** Výchozí stav je uzamčený a pozdější balíčky mají
proti čemu měřit — balíček 6 (rozdělení frontendu) včetně, protože má konečně
čím doložit, že nezměnil ani pixel.

## 8. GitHub: stav nastavení repozitáře (balíček 1)

Ověřeno 10. srpna 2026. Balíček 1 je zapsaný a odeslaný — pět commitů nad
`a44478e`, anglicky:

```
f8548cd Correct stale keyboard and speaker-recognition facts in the README
819d4d4 Add a source-available licence for the repository
e6b792c Add an English README and move the Czech one to README.cs.md
8c40c69 Add a contributing guide and GitHub templates
f91adef Add an English changelog for 0.9.0
```

Historie nebyla přepsána, force push neproběhl. Repozitář hlásí 84 commitů,
výchozí větev `main`, 0 forků, 0 hvězd, žádné vydání.

### Čím se ověřovalo

**GitHub konektor v tomto sezení není.** V adresáři konektorů žádný GitHub
neexistuje (nainstalované jsou Gmail, Kalendář a Disk). Dál chybí `gh`, token
i připojený prohlížeč — `list_connected_browsers` vrátil prázdný seznam.
Sandbox nemá přímý přístup ven: `api.github.com` končí na 403 od proxy.

Zbylo tedy jediné: **nepřihlášené načtení veřejných stránek** repozitáře. Tím
lze doložit část otázek. Zbytek jsou nastavení, která GitHub ukazuje jen
přihlášenému správci, a **z tohoto sezení je ověřit nelze.**

### Doloženo

| Co | Stav | Důkaz |
|---|---|---|
| **Soukromé hlášení zranitelností** | **zapnuto** | `/security` vykresluje tlačítko *Report a vulnerability* mířící na `/security/advisories/new`. GitHub to tlačítko ukazuje jen tehdy, když je funkce zapnutá. |
| About — popis | nastaven | `Privacy-first speech-to-text for Windows - local transcription, speaker recognition, editing and export.` |
| About — témata | 12, přesně podle plánu | `czech`, `local-ai`, `offline`, `privacy`, `react`, `rust`, `speaker-diarization`, `speech-to-text`, `tauri`, `transcription`, `whisper-cpp`, `windows` |
| About — web | nevyplněn | odpovídá plánu: skutečná stránka projektu zatím neexistuje |
| `SECURITY.md` | GitHub ji zná jako bezpečnostní politiku | karta *Security policy* v About, obsah se vykresluje na `/security` |
| `LICENSE`, `CONTRIBUTING.md` | GitHub je zná | karty *License* a *Contributing* v About |
| Veřejná bezpečnostní poradenství | žádná | *There aren't any published security advisories* |
| README | anglický, s odkazem `English · Čeština` na `README.cs.md` | vykreslený README na hlavní stránce |

Drobnost: popis má obyčejný spojovník tam, kde plán psal pomlčku
(`Windows - local` místo `Windows — local`). Kosmetika, ne chyba.

### Neověřeno — přečte to jen přihlášený správce

| Co | Kde se to přečte |
|---|---|
| Secret scanning | Settings → Advanced Security |
| Push protection | Settings → Advanced Security |
| Dependabot alerts | Settings → Advanced Security |
| Dependabot security updates | Settings → Advanced Security |
| Ochrana větve `main` | Settings → Rules → Rulesets (případně starší Branches) |

Přesné adresy k odečtení:

```
https://github.com/znackarna/slobot/settings/security_analysis
https://github.com/znackarna/slobot/settings/rules
```

Dokud tyto pole nikdo neodečte, **nemá balíček 1 splněnou podmínku „veřejné CI
a bezpečnostní nastavení mají doložený stav"**. Doložené je zatím jedno z pěti.

### Dva místní nálezy, které k tomu patří

1. **`.github/dependabot.yml` neexistuje.** Rutinní pull requesty na povýšení
   verzí tedy nevznikají bez ohledu na to, jak jsou nastavené alerts. Security
   updates jsou samostatný přepínač a tento soubor nepotřebují; version updates
   ano. Jsou to dvě různé věci a je snadné je zaměnit.
2. **Workflow `Kontroly` běží i na `pull_request`** (`.github/workflows/check.yml`
   řádek 21), takže povinné kontroly v pravidle větve by fungovaly. Jména úloh,
   která by se do pravidla zapsala:

   - `TypeScript a slovníky` (ubuntu),
   - `Rust na Windows`.

   Úloha `Instalátor (NSIS)` se spouští jen na tagu `v*` nebo ručně. Do
   povinných kontrol **nepatří** — pull request by čekal na běh, který se
   nikdy nespustí.

### Poznámka mimo tento úkol

Živá `SECURITY.md` stále tvrdí `"csp": null`, zatímco
`src-tauri/tauri.conf.json` už CSP obsahuje
(`default-src 'self'; script-src 'self'; …`). Rozsah asset protokolu `["**"]`
dokument popisuje správně. Je to přesně nález, na který míří balíček 3;
zapsáno sem jen proto, že se to při čtení veřejné stránky potvrdilo.
