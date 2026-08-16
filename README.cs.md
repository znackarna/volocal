[English](README.md) · **Čeština**

# Volocal

Převádí mluvené slovo na text. Nahrávky, přepisy i jazykové modely běží pouze
na vašem počítači a nic se neodesílá ven.

Program je vlastnictvím značkárny s.r.o. Zdrojový kód je veřejně čitelný, ale
není open source — podrobnosti v [LICENSE](LICENSE).

Postavené na whisper.cpp, Silero VAD, modelu hlasů CAM++ a llama.cpp. Aplikace
je Tauri 2: jádro v Rustu, rozhraní v Reactu, archiv v SQLite.

Technický přehled a pravidla pojmenování jsou v
[ARCHITECTURE.md](ARCHITECTURE.md), pracovní pravidla v [CLAUDE.md](CLAUDE.md)
a důvody jednotlivých rozhodnutí v [docs/history/](docs/history/README.md).

---

## Pro uživatele

1. Spusťte instalátor `Volocal_1.2.7_x64-setup.exe`.
2. Otevřete Volocal.
3. Při prvním spuštění se ukáže průvodce. Zmáčkněte **Stáhnout a nastavit**.
4. Přetáhněte nahrávku do okna.

Nic víc. Průvodce si sám stáhne whisper.cpp, ffmpeg, detekci řeči i modely a
předvybere variantu, která se hodí pro grafickou kartu v tomto počítači. Podle
výběru to je 700 MB až 1,7 GB. Po dokončení už aplikace internet nepotřebuje.

Nástroje a modely jdou do `%LOCALAPPDATA%\Whisp\`, přepisy do
`%APPDATA%\cz.znackarna.volocal\`. Instalace nepotřebuje práva správce. Ta
druhá cesta se změnila, když se ze Slobotu stal Volocal — starou složku si
aplikace při prvním spuštění sama přestěhuje, i se zálohami a poznámkami.

### Nová verze

V Nastavení → O aplikaci je **Zkontrolovat aktualizace**. Aplikace se ptá jen
tehdy, když o to požádáte. Vedle je přepínač **Automatické aktualizace**, ve
výchozím stavu vypnutý: po zapnutí se po spuštění jednou zeptá a nález ohlásí
v liště. Stáhne a nainstaluje se až na váš stisk.

### Kopie na flash disk

V Nastavení → Soubory je **Kopie na přenosný disk**. Zkopíruje program,
nástroje i modely na zvolený disk a označí složku jako přenosnou. Na jiném
počítači pak stačí spustit soubor `Volocal.exe` — bez instalace, bez zápisu do
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
| **F3** | skočí na další místo ke kontrole |
| Ctrl+F | hledání v přepisu (Enter a Shift+Enter mezi shodami) |
| Esc | zavře úpravu nebo hledání |
| pravé tlačítko | nabídka nad přepisem |
| boční tlačítka myši | zpět a vpřed v aplikaci |

Místa ke kontrole jsou tečkovaně podtržená a najdete je pohromadě v postranním
panelu. U hodinové nahrávky jich bývá pár desítek — projít je klávesou F3 trvá
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
npm run tauri dev
```

Ikony jsou v repozitáři (`src-tauri/icons/`); `npm run tauri icon
icon-source.png` je potřeba jen po změně zdrojového obrázku.

První `tauri dev` překládá Rust závislosti — 5 až 15 minut. Další spuštění
jsou v řádu vteřin. Instalátor sestavíte přes `npm run tauri build`; výsledek
je v `src-tauri\target\release\bundle\nsis\`.

Před odevzdáním práce projdou tyto kontroly:

```powershell
npx tsc --noEmit
npm run i18n:check      # texty ve slovníku, množné tvary, vykání, stáří překladu
cargo fmt --all ; cargo check ; cargo test
```

### Kdyby okno zůstalo bílé

Okno kreslí obsah pod pravidly `security.csp` v `src-tauri/tauri.conf.json`.
Zablokovaný skript nebo styl se neohlásí chybou — okno prostě zůstane prázdné.
Otevřete vývojářskou konzoli (`npm run tauri dev`, pak F12) a na kartě Console
uvidíte, co bylo odmítnuto a kterým pravidlem.

Rychlá zkouška, jestli za to může právě CSP: nastavte `"csp": null` a spusťte
znovu. Když se okno vrátí, chybí v pravidlech jedna položka — přidejte ji
a `null` zase odeberte. Nenechávejte `null` natrvalo; je to jediné místo,
které vynucuje, že aplikace nesmí nic načíst zvenčí.

### Vydání

```powershell
npm run tauri build
```

Výsledek je `src-tauri\target\release\bundle\nsis\Volocal_1.2.7_x64-setup.exe`.
Instalátor obsahuje **jen program** — nástroje a modely si Volocal stahuje sám
při prvním spuštění, takže má řádově megabajty, ne gigabajty. Instaluje se pro
přihlášeného uživatele (`installMode: currentUser`), takže nechce práva správce.

Odinstalace odebere jen program. Modely v `%LOCALAPPDATA%\Whisp\` i archiv
v `%APPDATA%\cz.znackarna.volocal\` zůstanou — přeinstalace je pak okamžitá a
nikdo nepřijde o přepisy. Kdo je chce uklidit, smaže obě složky ručně.

#### Před vydáním

Tři kontroly, které za nikoho neudělá stroj:

* **Verze souhlasí na třech místech:** `package.json`, `src-tauri/Cargo.toml`
  a `src-tauri/tauri.conf.json`.
* **`SECURITY.md` odpovídá konfiguraci.** Projděte každé konkrétní tvrzení
  proti kódu — `csp` a `assetProtocol.scope` v `src-tauri/tauri.conf.json`,
  `EXPECTED_HASHES` a položky hledané vzorem v `src-tauri/src/download.rs`,
  a jestli je instalátor podepsaný. Dokument u sebe nese datum posledního
  ověření; když se tvrzení a kód rozejdou, platí kód. Česká i anglická
  polovina se opravují zároveň, jinak si za měsíc odporují.
* **Kontroly projdou:** `npm run build`, `npm run test`,
  `cargo fmt --all --check`, `cargo test`,
  `cargo clippy --all-targets -- -D warnings`.
* **Na vydání jsou přísnější pravidla, a hlídá je CI u značky (tagu).**
  `node scripts/i18n.mjs check --strict` navíc odmítne překlad, jehož česká
  předloha nikdy nedostala otisk — při rozdělané práci je to jen upozornění,
  ale je to jediné, s čím se dá později porovnat, jestli se čeština nezměnila.
  Potom se sestaví instalátor, nainstaluje se na čistý stroj, spustí se a musí
  si stihnout založit archiv. Teprve pak je běh zelený.

#### Podpis

Bez podpisu ukáže Windows při prvním spuštění SmartScreen
(„Windows ochránil váš počítač" → *Další informace* → *Přesto spustit*).

**První vydání jde ven nepodepsané**, vědomě. Certifikát to okno sám o sobě
nezavře: OV certifikáty i levné cloudové podepisovací služby začínají bez
reputace a získávají ji tím, že si soubor lidé stahují — což je přesně to, co
se ještě nestalo. Okamžitou důvěru má jen EV, a ten stojí stovky dolarů ročně
a chce hardwarový token. Až bude co chránit, dá se to koupit; do té doby
`scripts\release.ps1 -Publish -Unsigned` vydá bez podpisu a řekne u toho, co
uživatel uvidí. Napište to i tam, odkud se stahuje — varování, na které nikdo
nepřipravil, zavírá stránky.

Od června 2023 nelze certifikát stáhnout jako soubor — soukromý klíč musí být
na hardwarovém tokenu nebo v cloudovém HSM, a to u OV i EV. Rozdíl mezi nimi
není v síle podpisu, ale v pověsti u SmartScreenu: **EV má důvěru okamžitě, OV
si ji musí teprve odchodit** stahováním. Kdo kupuje certifikát právě proto, aby
zmizelo modré okno, chce EV; OV ho na začátku stejně uvidí.

Až certifikát bude, přidá se do `src-tauri/tauri.conf.json` pod `bundle.windows`:

```jsonc
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.sectigo.com",
"certificateThumbprint": "OTISK BEZ MEZER"
```

Otisk vypíše `Get-ChildItem Cert:\CurrentUser\My | Format-List Subject,Thumbprint`
poté, co je certifikát vidět ve Windows (token nebo klient cloudové služby).
Časové razítko je důležité: bez něj přestanou podepsané soubory platit v den,
kdy certifikátu vyprší platnost, s ním platí dál.

Nástroj, který certifikát ve Windows nezpřístupní, se místo otisku zapojí přes
`"signCommand"` — `%1` je zástupný symbol za cestu k podepisovanému souboru.

Otisk je vázaný na konkrétní stroj, takže do repozitáře nepatří; drž ho
v lokální kopii konfigurace, nebo si ho na počítači, kde se vydává, doplň.

### Architektura

```
React (rozhraní)
   ↕ Tauri IPC + události
Rust jádro ── SQLite (přepisy, mluvčí, slovník, poznámky, fulltext)
   ├── stahování    katalog součástí, průběh, rozbalení
   ├── ffmpeg       převod na 16 kHz mono, export zvuku
   ├── whisper-cli  přepis (cuda / vulkan / cpu)
   ├── CAM++        rozpoznání mluvčích přímo v procesu (ONNX Runtime)
   └── llama-server jazyková úprava, shrnutí, překlad
```

Externí nástroje jsou samostatné procesy, ne linkované knihovny. Kterýkoli jde
vyměnit bez zásahu do aplikace, a když jeden spadne, nespadne s ním okno.

Výjimkou je rozpoznání mluvčích. Od srpna 2026 neběží jako samostatný program:
model hlasů CAM++ počítá ONNX Runtime přímo uvnitř Volocalu, na Windows přes
DirectML se záložním během na procesoru. Kde je řeč, se přitom nehledá znovu —
to už řekl přepis. Program `sherpa-onnx` ani segmentační model pyannote, které
tuhle práci dělaly dřív, se proto od té doby nestahují.

| Soubor | |
|---|---|
| `src-tauri/src/main.rs` | příkazy volané z rozhraní, start |
| `src-tauri/src/download.rs` | katalog součástí, stahování, přenosná kopie |
| `src-tauri/src/tools.rs` | hledání programů, volba výpočtu, přenosný režim |
| `src-tauri/src/transcription.rs` | běh přepisu včetně VAD a rozpoznání mluvčích |
| `src-tauri/src/voiceprint.rs` | příznaky hlasu, model CAM++, shlukování mluvčích |
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
| 3D-Speaker CAM++ | Apache 2.0 |
| ONNX Runtime | MIT |
| llama.cpp | MIT |
| Gemma (Google) | Gemma Terms of Use |
| FFmpeg | GPL v3 |
| yt-dlp | Unlicense |
| Deno | MIT |
| Geist, Inter, Schibsted Grotesk, Literata, Source Serif 4 | SIL OFL 1.1 |

Vše kromě modelů Gemma je open source. Gemma se řídí licencí Google a FFmpeg
licencí GPL v3.

---

## Známá omezení

**Časy jednotlivých slov jsou odhad.** Whisper vrací značky po úsecích, ne po
slovech. Na klikání i zvýrazňování to sedí, ale u dlouhého úseku s pauzou
uprostřed se to rozejde o vteřinu.

**Rozpoznání mluvčích neřeší překryv.** Když dva lidé mluví přes sebe, úsek se
přiřadí tomu, kdo převažuje. Ruční oprava je součástí návrhu, ne selhání.

**Přepisy jdou po jednom.** Přetáhnete-li deset souborů, přidají se všechny,
ale přepisovat se bude vždy jeden — ostatní čekají ve frontě a je to vidět na
kartě. Deset běhů naráz by se pralo o jednu grafickou kartu a trvalo by to
dohromady déle.

**Program není podepsaný.** Při prvním spuštění ukáže Windows SmartScreen modré
okno „Windows ochránil váš počítač" — *Další informace* → *Přesto spustit*.

**Stahování se nedá navázat.** Když spojení spadne uprostřed třígigabajtového
modelu, začíná se znovu.
