[English](README.md) · **Čeština**

# Volocal

**Převádí mluvené slovo na text — u vás v počítači.**

Přetáhnete nahrávku a dostanete přepis, který se dá číst, opravovat, prohledávat
a přehrát přesně na slovo. Pozná, kdo mluví. Text umí učesat, shrnout i přeložit.

Vaše nahrávky nikam neodcházejí. Žádný účet, žádný cloud, žádné nahrávání na
server — modely běží na vašem hardwaru, po prvním nastavení i bez internetu.

## Jak to získat

**Windows 10 nebo 11.** [Stáhněte si instalátor](../../releases/latest).
Instaluje se jen pro vás a nechce práva správce.

Jedna věc, na kterou se připravte: instalátor není podepsaný, takže Windows při
prvním spuštění ukážou **„Windows ochránil váš počítač"**. Zvolte *Další
informace* → *Přesto spustit*. To okno mluví o chybějícím certifikátu, ne o tom,
že by se v souboru něco našlo.

Pak už jen:

1. Otevřete Volocal.
2. V průvodci zmáčkněte **Stáhnout a nastavit**.
3. Přetáhněte nahrávku do okna.

Průvodce si sám stáhne whisper.cpp, ffmpeg, detekci řeči i modely a předvybere
variantu, která se hodí pro grafickou kartu v tomto počítači. Podle výběru to je
700 MB až 1,7 GB. Po dokončení už aplikace internet nepotřebuje.

## Co aplikace umí

- **Přepíše nahrávky i videa** v češtině i dalších jazycích.
- **Rozpozná mluvčí** a rozdělí text mezi ně.
- **Vylepší přepis jazykovým modelem**, shrne ho a přeloží — vše u vás.
- **Označí místa, kde si přepis nebyl jistý**, a drží opravy pohromadě.
- **Přehraje přesně na slovo** a připne poznámku k libovolnému místu.
- **Nahraje z mikrofonu**, stáhne zvuk z online služby, hlídá vybranou složku.
- **Uloží přepis** do TXT, Markdownu, SRT, VTT nebo JSON a zvuk do MP3, M4A
  nebo WAV.

## Vaše nahrávky zůstávají u vás

Je to celý smysl téhle aplikace, takže tady je přesně, kdy sahá na internet —
a jsou to jen tyhle tři případy:

1. **Při prvním spuštění**, aby stáhla přepisovací nástroje a modely, které jste
   si vybrali, přímo ze stránek jejich autorů.
2. **Když sami vložíte odkaz** na online službu. Ven jde ten odkaz, zpátky
   přijde zvuk. Nic víc.
3. **Když se zeptáte na novou verzi.** Vedle toho je přepínač, ve výchozím stavu
   vypnutý, který se na totéž zeptá jednou po spuštění. Vždycky se jen ptá —
   nic se nestáhne bez vašeho stisku.

**A nic dalšího.** Žádná telemetrie, žádná hlášení o pádech, žádný účet.
Nahrávky, přepisy, poznámky i nastavení leží v souboru na vašem disku.

K tomu prvnímu stahování: každá součást je připnutá na konkrétní verzi na
konkrétní adrese a všechny až na jednu se ověřují proti otisku, který zveřejnil
jejich autor. Když soubor nesedí, aplikace ho odmítne. Ta výjimka je model
hlasů, jehož autor otisk nezveřejňuje — u něj je jen HTTPS a nic víc.
Podrobnosti jsou v [SECURITY.md](SECURITY.md).

## Jak se to ovládá

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

### Volba modelu

| Volba | Model | Velikost |
|---|---|---|
| Přesný | `large-v3` | 3,1 GB |
| Vyvážený | `large-v3-q5_0` | 1,1 GB |
| Rychlý | `large-v3-turbo-q5_0` | 575 MB |

Naměřeno na Radeonu RX 9070: `large-v3` zvládl 38 minut zvuku za 2:18, tedy
16,6× rychleji než v reálném čase.

Přepis běží na kartě NVIDIA (CUDA), na jakékoli kartě přes Vulkan, nebo na
procesoru. Aplikace se rozhoduje sama podle ovladačů, které v systému najde —
`nvcuda.dll` → CUDA, `vulkan-1.dll` → Vulkan, jinak procesor. Co doopravdy
běželo, si přečtete v Nastavení → Modely.

### Nová verze

V Nastavení → **Aktualizace** je **Zkontrolovat aktualizace**. Aplikace se ptá
jen tehdy, když o to požádáte. Vedle je přepínač **Automatické aktualizace**, ve
výchozím stavu vypnutý: po zapnutí se po spuštění jednou zeptá a nález ohlásí
v liště. Stáhne a nainstaluje se až na váš stisk.

### Kopie na flash disk

V Nastavení → Soubory je **Kopie na přenosný disk**. Zkopíruje program, nástroje
i modely na zvolený disk a označí složku jako přenosnou. Na jiném počítači pak
stačí spustit soubor `Volocal.exe` — bez instalace, bez zápisu do systému, bez
internetu. V přenosném režimu se archiv ukládá do `data\` vedle programu, ne do
profilu uživatele.

### Kam se co ukládá

Nástroje a modely jdou do `%LOCALAPPDATA%\Whisp\`, přepisy do
`%APPDATA%\cz.znackarna.volocal\`. Ta první cesta pořád říká `Whisp` — tak se
aplikace jmenovala před Slobotem a před Volocalem — a přejmenovat ji by
znamenalo, že si každá existující instalace stáhne všechno znovu. Ta druhá se
přestěhovala, když se ze Slobotu stal Volocal; starou složku si aplikace při
prvním spuštění sama přenese, i se zálohami a poznámkami.

Odinstalace odebere jen program. Modely i archiv zůstanou, takže přeinstalace je
okamžitá a nikdo nepřijde o přepisy. Kdo je chce uklidit, smaže obě složky ručně.

## Co neumí dobře

Radši napsané tady než objevené později:

- **Časy jednotlivých slov jsou odhad.** Na klikání a sledování textu to sedí,
  ale u dlouhého úseku s pauzou uprostřed se to rozejde asi o vteřinu.
- **Dva lidé mluvící přes sebe** se přiřadí tomu, kdo převažuje. Ruční oprava je
  součástí návrhu, ne selhání.
- **Rozhovor ano, panelová diskuse spíš ne.** Dva hlasy jsou při zadaném počtu
  téměř bezchybné. Pět lidí v jedné místnosti sloučilo jednu dvojici.
- **Přepisy jdou po jednom.** Přetáhnete deset souborů, přidají se všechny, ale
  čekají ve frontě — je to vidět na kartách. Deset běhů naráz by se pralo
  o jednu grafickou kartu a dohromady by to trvalo déle.
- **Přerušené stahování začíná znovu.** Třígigabajtový model se nedá navázat
  v půlce.
- **Archiv není šifrovaný.** Je to obyčejný soubor s takovou ochranou, jakou má
  váš uživatelský účet.

## Když je něco špatně

- **Chyba nebo nápad:** založte issue.
- **Bezpečnostní díra:** prosím **nezakládejte** veřejné issue, napište na
  jsme@znackarna.cz. [SECURITY.md](SECURITY.md) popisuje, co je už teď známo
  jako slabé místo.

---

## Pro vývoj

```powershell
npm install
npm run tauri dev
```

První `tauri dev` překládá Rust závislosti — 5 až 15 minut. Další spuštění jsou
v řádu vteřin. Instalátor sestavíte přes `npm run tauri build`; výsledek je
`src-tauri\target\release\bundle\nsis\Volocal_1.2.8_x64-setup.exe`. Obsahuje
**jen program** — nástroje a modely si Volocal stahuje sám, takže má řádově
megabajty, ne gigabajty.

Ikony jsou v repozitáři (`src-tauri/icons/`). Nepřegenerovávejte je samotným
`tauri icon`: ten neumí rozhodnout, co je uvnitř ICO, a tiše by zahodil velikost
36 px, kterou si Windows na obrazovce se 150% zvětšením žádají. Slouží k tomu
`scripts\make-ico.ps1`.

Před odevzdáním práce projdou tyhle kontroly:

```powershell
npm run build     # i18n:check, docs:check, tsc --noEmit, pak build
npm run test
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm run i18n:check` je ta neobvyklá: odmítne text napsaný přímo v komponentě,
neúplnou sadu množných tvarů, českou větu, která čtenáři tyká, a překlad, jehož
česká předloha se mezitím přepsala. Čeština je zdrojový jazyk rozhraní.

### Kdyby okno zůstalo bílé

Okno kreslí obsah pod pravidly `security.csp` v `src-tauri/tauri.conf.json`.
Zablokovaný skript nebo styl se neohlásí chybou — okno prostě zůstane prázdné.
Otevřete vývojářskou konzoli (`npm run tauri dev`, pak F12) a na kartě Console
uvidíte, co bylo odmítnuto a kterým pravidlem.

Rychlá zkouška, jestli za to může právě CSP: nastavte `"csp": null` a spusťte
znovu. Když se okno vrátí, chybí v pravidlech jedna položka — přidejte ji
a `null` zase odeberte. Nenechávejte `null` natrvalo; je to jediné místo, které
vynucuje, že aplikace nesmí nic načíst zvenčí.

### Vydání

Vydává `scripts\release.ps1` ve dvou průchodech; nápověda v hlavičce skriptu
říká proč. Poznámky k vydání jsou **přínosy, ne seznam změn** — pravidlo je
v [CLAUDE.md](CLAUDE.md).

Tři kontroly, které za nikoho neudělá stroj:

* **Verze souhlasí na třech místech:** `package.json`, `src-tauri/Cargo.toml`
  a `src-tauri/tauri.conf.json`. Přesouvá je `scripts\version.ps1`, který sáhne
  i na čtyři soubory, jež verzi jen říkají čtenáři.
* **`SECURITY.md` odpovídá konfiguraci.** Projděte každé konkrétní tvrzení proti
  kódu — `csp` a `assetProtocol.scope` v `src-tauri/tauri.conf.json`,
  `EXPECTED_HASHES` a položky hledané vzorem v `src-tauri/src/download.rs`.
  Dokument u sebe nese datum posledního ověření; když se tvrzení a kód rozejdou,
  platí kód. Česká i anglická polovina se opravují zároveň, jinak si za měsíc
  odporují.
* **Na vydání jsou přísnější pravidla, a hlídá je CI u značky (tagu).**
  `node scripts/i18n.mjs check --strict` navíc odmítne překlad, jehož česká
  předloha nikdy nedostala otisk. Potom se sestaví instalátor, nainstaluje se na
  čistý stroj, spustí se a musí si stihnout založit archiv. Teprve pak je běh
  zelený.

#### Podpis

**Vydání jdou ven nepodepsaná**, vědomě. Certifikát to modré okno sám o sobě
nezavře: OV certifikáty i levné cloudové podepisovací služby začínají bez
reputace a získávají ji tím, že si soubor lidé stahují — což je přesně to, co se
zatím nestalo. Okamžitou důvěru má jen EV, a ten stojí stovky dolarů ročně a
chce hardwarový token. `scripts\release.ps1 -Publish -Unsigned` vydá bez podpisu
a řekne u toho, co uživatel uvidí. Napište to i tam, odkud se stahuje —
varování, na které nikdo nepřipravil, zavírá stránky.

Od června 2023 nelze certifikát stáhnout jako soubor — soukromý klíč musí být na
hardwarovém tokenu nebo v cloudovém HSM, a to u OV i EV. Rozdíl mezi nimi není
v síle podpisu, ale v pověsti u SmartScreenu: **EV má důvěru okamžitě, OV si ji
musí teprve odchodit** stahováním.

Až certifikát bude, přidá se do `src-tauri/tauri.conf.json` pod `bundle.windows`:

```jsonc
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.sectigo.com",
"certificateThumbprint": "OTISK BEZ MEZER"
```

Otisk vypíše `Get-ChildItem Cert:\CurrentUser\My | Format-List Subject,Thumbprint`
poté, co je certifikát vidět ve Windows. Časové razítko je důležité: bez něj
přestanou podepsané soubory platit v den, kdy certifikátu vyprší platnost.
Otisk je vázaný na konkrétní stroj, takže do repozitáře nepatří.

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
| `src-tauri/src/main.rs` | start okna a jeho ikona |
| `src-tauri/src/commands/` | příkazy volané z rozhraní |
| `src-tauri/src/download.rs` | katalog součástí, stahování, přenosná kopie |
| `src-tauri/src/tools.rs` | hledání programů, volba výpočtu, přenosný režim |
| `src-tauri/src/transcription/` | běh přepisu včetně VAD, mluvčích a sazby textu |
| `src-tauri/src/voiceprint.rs` | příznaky hlasu, model CAM++, shlukování mluvčích |
| `src-tauri/src/ai_edit.rs` | jazyková úprava, shrnutí, překlad |
| `src-tauri/src/online_import.rs` | stažení zvuku z online služby |
| `src-tauri/src/db.rs` | schéma SQLite, dotazy, fulltext, zálohy |
| `src-tauri/src/export.rs` | TXT, Markdown, SRT, VTT, JSON |
| `src/App.tsx` | navigace, notifikace, přidávání nahrávek |
| `src/Library.tsx` | archiv, hledání, složky, průběh přepisu |
| `src/Detail.tsx` | přehrávač, editor napojený na zvuk, postranní panel |
| `src/Settings.tsx` | Přepis, Rozhraní, Výkon, Modely, Soubory, Informace, Aktualizace |
| `src/Brand.tsx` | značka v hlavičce a psaný obličej v archivu |

Veškerý text rozhraní je ve slovníku v `src/locales/`; `npm run i18n:check`
odmítne text napsaný přímo v komponentě. Čeština je zdrojový jazyk a vyká.

Proč je kód takový, jaký je, stojí den po dni v [docs/history/](docs/history/README.md).
Pracovní pravidla jsou v [CLAUDE.md](CLAUDE.md), rozvržení modulů
v [ARCHITECTURE.md](ARCHITECTURE.md), a co má mít pull request,
v [CONTRIBUTING.md](CONTRIBUTING.md).

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
licencí GPL v3. Úplný seznam je v [NOTICE](NOTICE) a v aplikaci pod
Nastavení → Informace.

Program je vlastnictvím značkárny s.r.o. Zdrojový kód je veřejně čitelný, ale
není open source — smíte si ho přečíst a sestavit pro sebe. Další šíření, forky
a použití v jiných projektech potřebují písemné svolení; podrobnosti
v [LICENSE](LICENSE).
