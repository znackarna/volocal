# Whisper Studio

Technický přehled a pravidla pojmenování jsou v [ARCHITECTURE.md](ARCHITECTURE.md).

Lokální přepis kázání, přednášek a rozhovorů. Nic se nikam neodesílá — zvuk i text zůstávají v tvém počítači.

Postavené na whisper.cpp, Silero VAD a sherpa-onnx. Aplikace je Tauri: jádro v Rustu, rozhraní v Reactu.

---

## Pro uživatele

1. Spusť instalátor `Whisper Studio_0.1.0_x64-setup.exe`.
2. Otevři Whisper Studio.
3. Při prvním spuštění se ukáže průvodce. Zmáčkni **Stáhnout a nastavit**.
4. Přetáhni nahrávku do okna.

Nic víc. Průvodce si sám stáhne whisper.cpp, ffmpeg, detekci řeči i jazykový model — a předvybere přesně tu variantu, která se hodí pro grafickou kartu v tomhle počítači. Podle výběru to je 700 MB až 1,7 GB. Po dokončení už aplikace internet nepotřebuje.

Nástroje a modely jdou do `%LOCALAPPDATA%\WhisperStudio\`, takže instalace nepotřebuje práva správce.

### Kopie na flashku

V Nastavení je **Vybrat složku a vytvořit kopii**. Zkopíruje program, nástroje i modely na disk, který si vybereš, a označí složku jako přenosnou. Na cizím počítači pak stačí spustit `WhisperStudio.exe` — bez instalace, bez zápisu do systému, bez internetu.

Aplikace v přenosném režimu ukládá přepisy do `data\` vedle sebe, ne do profilu uživatele.

---

## Jak se to používá

**Přetáhni soubor** kamkoliv do okna. Přepis začne sám, text uvidíš přibývat.

| Akce | Co udělá |
|---|---|
| klik na slovo | skočí ve zvuku na to místo |
| dvojklik na úsek | otevře úpravu textu |
| Enter | uloží úpravu (Shift+Enter = nový řádek) |
| mezerník | přehrát / pauza |
| **Tab** | skočí na další místo, kde si model nebyl jistý |
| Esc | zavře úpravu |

Nejistá místa jsou tečkovaně podtržená. U hodinového kázání jich bývá pár desítek — projít je Tabem trvá minuty místo přečítání celého textu.

**Slovník se plní sám.** Opravíš v úseku jedno slovo a aplikace se zeptá, jestli to má opravovat vždycky. Uložené termíny se pak předávají Whisperu předem jako nápověda — příště je zvládne rovnou.

**Mluvčí** se objeví jen se zapnutou diarizací (Nastavení → Mluvčí). Přejmenuj jednou, změní se všude. Sloučení dvou řečníků je běžná operace, ne výjimka — diarizace často rozdělí jednoho člověka na dva, když změní hlasitost.

### Kde to počítá

Přepis umí běžet na kartě NVIDIA (CUDA), na jakékoli kartě přes Vulkan, nebo na procesoru. Aplikace se rozhoduje podle ovladačů, které v systému najde: `nvcuda.dll` → CUDA, `vulkan-1.dll` → Vulkan, jinak procesor.

V Nastavení je tlačítko **Změřit, co tenhle počítač zvládne**. Vezme 20 vteřin z první nahrávky, prožene je všemi staženými variantami a nejrychlejší nastaví. Na novém stroji se to vyplatí zmáčknout — Vulkan občas tiše spadne na procesor a člověk si měsíc myslí, že mu to jede na kartě.

### Vzhled

V Nastavení → Vzhled si vybereš písmo rozhraní (Geist, Schibsted Grotesk, Inter, systémové), písmo přepisu (Literata, Source Serif 4, Georgia nebo kterékoli bezpatkové), velikost textu a řádkování. Náhled se mění hned.

Písma se balí do aplikace přes Fontsource, nestahují se z internetu — přenosná verze tak vypadá stejně i na cizím počítači bez sítě. Všechna nabízená písma mají ověřenou plnou českou diakritiku včetně `ě ř ů ť ď`.

### Volba modelu

| Model | Velikost | Kdy |
|---|---|---|
| `large-v3` | 3,1 GB | silný počítač, nejlepší čeština |
| `large-v3-q5_0` | 1,1 GB | rozumný výchozí stav — kvalita skoro stejná |
| `large-v3-turbo-q5_0` | 575 MB | slabší stroj nebo běh na procesoru |

Naměřeno na Radeonu RX 9070: `large-v3` zvládl 38minutové kázání za 2:18 (16,6× realtime). Model `medium` byl rychlejší, ale dělal zhruba osmkrát víc chyb — komolil i názvy biblických knih. Proto v nabídce není.

---

## Pro vývoj

```powershell
npm install
npm run tauri icon icon-source.png   # bez ikon sestavení na Windows selže
npm run tauri dev
```

První `tauri dev` překládá Rust závislosti — 5 až 15 minut. Další spuštění jsou v řádu vteřin.

Instalátor:

```powershell
npm run tauri build
```

Výsledek v `src-tauri\target\release\bundle\nsis\`. WebView2 řeší instalátor sám (stáhne bootstrapper, pokud v systému chybí).

### Architektura

```
React (rozhraní)
   ↕ Tauri IPC + události
Rust jádro ── SQLite (přepisy, mluvčí, slovník, fulltext)
   ├── stahování    katalog součástí, průběh, rozbalení
   ├── ffmpeg       převod na 16 kHz mono
   ├── whisper-cli  přepis (cuda / vulkan / cpu)
   └── sherpa-onnx  rozlišení mluvčích na CPU
```

Každý nástroj je samostatný proces, ne linkovaná knihovna. Kterýkoliv jde vyměnit bez zásahu do aplikace, a když jeden spadne, nespadne s ním okno. Diarizace běží na procesoru souběžně s přepisem na kartě, takže skoro nepřidává čas.

| Soubor | |
|---|---|
| `src-tauri/src/main.rs` | příkazy volané z rozhraní, start |
| `src-tauri/src/download.rs` | katalog součástí, stahování, rozbalení, přenosná kopie |
| `src-tauri/src/tools.rs` | hledání programů, volba výpočtu, přenosný režim |
| `src-tauri/src/transcription.rs` | běh přepisu včetně VAD a diarizace |
| `src-tauri/src/db.rs` | schéma SQLite, dotazy, fulltext |
| `src-tauri/src/export.rs` | TXT, Markdown, SRT, VTT, JSON |
| `src/SetupWizard.tsx` | první spuštění, doinstalování součástí |
| `src/Library.tsx` | archiv, hledání, průběh přepisu |
| `src/Detail.tsx` | přehrávač, editor napojený na zvuk, mluvčí |
| `src/Settings.tsx` | cesty, model, výpočet, kopie na flashku |

### Skripty ve složce `faze0`

Ruční příprava nástrojů přes PowerShell. Aplikace to dnes zvládá sama, takže je nepotřebuješ — hodí se jen pro offline přípravu nebo pro měření výkonu mimo aplikaci. Pokud v `faze0` už nástroje jsou, aplikace je při prvním spuštění najde a nestahuje znovu.

---

## Známá omezení

**Časy jednotlivých slov jsou odhad.** Whisper vrací značky po úsecích, ne po slovech. Pozice slova v úseku se dopočítává podle délky textu. Na klikání i zvýrazňování to sedí, ale u dlouhého úseku s pauzou uprostřed se to rozjede o vteřinu.

**Diarizace neřeší překryv.** Když dva lidé mluví přes sebe, úsek se přiřadí tomu, kdo převažuje. Ruční oprava je součástí návrhu, ne selhání.

**Přepis nejde zrušit.** Doběhne, i když zavřeš okno detailu.

**Fronta neexistuje.** Přetáhneš-li deset souborů, spustí se deset přepisů naráz a poperou se o kartu.

**Program není podepsaný.** Při prvním spuštění ukáže Windows SmartScreen modré okno „Windows ochránil váš počítač" — *Další informace* → *Přesto spustit*. Podpisový certifikát stojí několik tisíc ročně.

**Stahování se nedá navázat.** Když spojení spadne uprostřed třígigabajtového modelu, začíná se znovu.
