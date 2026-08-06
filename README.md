# Slobot

Převádí mluvené slovo na text. Nahrávky, přepisy i jazykové modely běží pouze
na vašem počítači a nic se neodesílá ven.

Postavené na whisper.cpp, Silero VAD, sherpa-onnx a llama.cpp. Aplikace je
Tauri 2: jádro v Rustu, rozhraní v Reactu, archiv v SQLite.

Technický přehled a pravidla pojmenování jsou v
[ARCHITECTURE.md](ARCHITECTURE.md), rozhodnutí a jejich důvody v
[CLAUDE.md](CLAUDE.md).

---

## Pro uživatele

1. Spusťte instalátor `Slobot_0.9.0_x64-setup.exe`.
2. Otevřete Slobot.
3. Při prvním spuštění se ukáže průvodce. Zmáčkněte **Stáhnout a nastavit**.
4. Přetáhněte nahrávku do okna.

Nic víc. Průvodce si sám stáhne whisper.cpp, ffmpeg, detekci řeči i modely a
předvybere variantu, která se hodí pro grafickou kartu v tomto počítači. Podle
výběru to je 700 MB až 1,7 GB. Po dokončení už aplikace internet nepotřebuje.

Nástroje a modely jdou do `%LOCALAPPDATA%\Whisp\`, přepisy do
`%APPDATA%\cz.znackarna.whisp\`. Instalace nepotřebuje práva správce.

### Kopie na flash disk

V Nastavení → Soubory je **Kopie na přenosný disk**. Zkopíruje program,
nástroje i modely na zvolený disk a označí složku jako přenosnou. Na jiném
počítači pak stačí spustit soubor `Slobot.exe` — bez instalace, bez zápisu do
systému, bez internetu. V přenosném režimu se archiv ukládá do `data\` vedle
programu, ne do profilu uživatele.

---

## Co aplikace umí

- **Přepíše nahrávky i videa** v češtině i dalších jazycích.
- **Rozpozná mluvčí** a rozdělí text mezi ně.
- **Vylepší přepis jazykovým modelem**, shrne ho a přeloží — vše lokálně.
- **Označí místa, kde si přepis nebyl jistý**, a drží opravy pohromadě.
- **Přehraje přesně na slovo** a připne poznámku k libovolnému místu.
- **Nahraje z mikrofonu**, stáhne zvuk z online videa, hlídá vybranou složku.
- **Uloží přepis** do TXT, Markdownu, SRT, VTT nebo JSON a zvuk do MP3, M4A
  nebo WAV.

### Jak se to ovládá

| Akce | Co udělá |
|---|---|
| klik na slovo | skočí ve zvuku na to místo |
| dvojklik na úsek | otevře úpravu textu |
| Enter | uloží úpravu (Shift+Enter = nový řádek) |
| mezerník | přehrát / pauza |
| **Tab** | skočí na další místo ke kontrole |
| Esc | zavře úpravu |
| pravé tlačítko | nabídka nad přepisem |
| boční tlačítka myši | zpět a vpřed v aplikaci |

Místa ke kontrole jsou tečkovaně podtržená a najdete je pohromadě v postranním
panelu. U hodinové nahrávky jich bývá pár desítek — projít je Tabem trvá
minuty místo přečítání celého textu.

**Slovník** je v Nastavení. Co přepis slyší špatně, zapíšete jednou a opraví
se to ve všech nahrávkách.

**Mluvčí** se objeví se zapnutým rozpoznáním. Přejmenujte jednou, změní se
všude; napsat dvěma řádkům stejné jméno je sloučí.

### Kde to počítá

Přepis běží na kartě NVIDIA (CUDA), na jakékoli kartě přes Vulkan, nebo na
procesoru. Aplikace se rozhoduje podle ovladačů, které v systému najde —
`nvcuda.dll` → CUDA, `vulkan-1.dll` → Vulkan, jinak procesor — a stažený
build, který tento počítač nemůže spustit, nenabídne jako volbu.

V Nastavení → Výkon je **Změřit rychlost**. Vezme kousek nahrávky, prožene ho
každým dostupným režimem a nejrychlejší rovnou nastaví.

### Volba modelu

| Volba | Model | Velikost |
|---|---|---|
| Precizní | `large-v3` | 3,1 GB |
| Vyvážený | `large-v3-q5_0` | 1,1 GB |
| Rychlý | `large-v3-turbo-q5_0` | 575 MB |

Naměřeno na Radeonu RX 9070: `large-v3` zvládl 38 minut zvuku za 2:18, tedy
16,6× rychleji než v reálném čase.

---

## Pro vývoj

```powershell
npm install
npm run tauri icon icon-source.png   # bez ikon sestavení na Windows selže
npm run tauri dev
```

První `tauri dev` překládá Rust závislosti — 5 až 15 minut. Další spuštění
jsou v řádu vteřin. Instalátor sestavíte přes `npm run tauri build`; výsledek
je v `src-tauri\target\release\bundle\nsis\`.

Před odevzdáním práce projdou tyto kontroly:

```powershell
npx tsc --noEmit
npm run i18n:check      # texty ve slovníku, úplné množné tvary, vykání
cargo fmt --all ; cargo check ; cargo test
```

### Architektura

```
React (rozhraní)
   ↕ Tauri IPC + události
Rust jádro ── SQLite (přepisy, mluvčí, slovník, poznámky, fulltext)
   ├── stahování    katalog součástí, průběh, rozbalení
   ├── ffmpeg       převod na 16 kHz mono, export zvuku
   ├── whisper-cli  přepis (cuda / vulkan / cpu)
   ├── sherpa-onnx  rozpoznání mluvčích na CPU
   └── llama-server jazyková úprava, shrnutí, překlad
```

Každý nástroj je samostatný proces, ne linkovaná knihovna. Kterýkoli jde
vyměnit bez zásahu do aplikace, a když jeden spadne, nespadne s ním okno.

| Soubor | |
|---|---|
| `src-tauri/src/main.rs` | příkazy volané z rozhraní, start |
| `src-tauri/src/download.rs` | katalog součástí, stahování, přenosná kopie |
| `src-tauri/src/tools.rs` | hledání programů, volba výpočtu, přenosný režim |
| `src-tauri/src/transcription.rs` | běh přepisu včetně VAD a rozpoznání mluvčích |
| `src-tauri/src/ai_edit.rs` | jazyková úprava, shrnutí, překlad |
| `src-tauri/src/db.rs` | schéma SQLite, dotazy, fulltext, zálohy |
| `src-tauri/src/export.rs` | TXT, Markdown, SRT, VTT, JSON |
| `src/App.tsx` | navigace, notifikace, přidávání nahrávek |
| `src/Library.tsx` | archiv, hledání, složky, průběh přepisu |
| `src/Detail.tsx` | přehrávač, editor napojený na zvuk, postranní panel |
| `src/Settings.tsx` | modely, výkon, vzhled, slovník, soubory, o aplikaci |

Veškerý text rozhraní je ve slovníku v `src/locales/`; `npm run i18n:check`
odmítne text napsaný přímo v komponentě. Čeština je zdrojový jazyk a vyká.

---

## Na čem to stojí

| | Licence |
|---|---|
| Tauri 2, React 18 | MIT / Apache 2.0 |
| SQLite | volné dílo |
| whisper.cpp, modely Whisper, Silero VAD | MIT |
| sherpa-onnx, 3D-Speaker CAM++ | Apache 2.0 |
| ONNX Runtime, pyannote segmentation 3.0 | MIT |
| llama.cpp | MIT |
| Gemma (Google) | Gemma Terms of Use |
| FFmpeg | GPL v3 |
| yt-dlp | Unlicense |
| Deno | MIT |
| Geist, Inter, Schibsted Grotesk, Literata, Source Serif 4 | SIL OFL 1.1 |

Všechno kromě modelů Gemma je open source. Gemma se řídí podmínkami Googlu a
FFmpeg licencí GPL v3 — s tím počítejte, když přenosnou kopii předáváte dál.

---

## Známá omezení

**Časy jednotlivých slov jsou odhad.** Whisper vrací značky po úsecích, ne po
slovech. Na klikání i zvýrazňování to sedí, ale u dlouhého úseku s pauzou
uprostřed se to rozejde o vteřinu.

**Rozpoznání mluvčích neřeší překryv.** Když dva lidé mluví přes sebe, úsek se
přiřadí tomu, kdo převažuje. Ruční oprava je součástí návrhu, ne selhání.

**Fronta neexistuje.** Přetáhnete-li deset souborů, spustí se deset přepisů
naráz a poperou se o kartu.

**Program není podepsaný.** Při prvním spuštění ukáže Windows SmartScreen modré
okno „Windows ochránil váš počítač" — *Další informace* → *Přesto spustit*.

**Stahování se nedá navázat.** Když spojení spadne uprostřed třígigabajtového
modelu, začíná se znovu.
