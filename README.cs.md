[English](README.md) · **Čeština**

# Volocal

**Převádí řeč na text, u vás v počítači.**

Vložíte nahrávku a dostanete přepis, který si můžete přečíst, opravit,
prohledat a přehrát slovo po slovu. Pozná, kdo co řekl. Text umí učesat, shrnout
i přeložit.

Vaše nahrávky nikdy neopustí počítač. Žádný účet, žádný cloud, žádné nahrávání
na server — modely běží na vašem vlastním hardwaru, po prvním nastavení bez
připojení.

## Jak ho získat

**Windows 10 nebo 11.** [Stáhněte si instalátor](../../releases/latest) —
instaluje se jen pro vás a nechce práva správce.

Jedna věc, na kterou se připravte při prvním spuštění: instalátor není
podepsaný, takže Windows ukážou *Windows ochránil váš počítač*. Zvolte **Další
informace** → **Přesto spustit**. To varování mluví o chybějícím certifikátu, ne
o něčem, co by se v souboru našlo.

Pak otevřete Volocal, zmáčkněte v průvodci **Stáhnout a nastavit** a přetáhněte
nahrávku do okna. Průvodce si stáhne, co potřebuje — 700 MB až 1,7 GB podle
toho, které modely si vyberete — a po tom už je internet nepovinný.

## Co umí

- **Přepíše nahrávky a videa** v češtině i mnoha dalších jazycích.
- **Rozezná mluvčí** a rozdělí text mezi ně.
- **Vylepší přepis, shrne ho, přeloží ho** — jazykovým modelem běžícím u vás
  v počítači.
- **Označí místa, kde si nebyl jistý**, abyste věděli, kam se podívat.
- **Přehraje přesně na slovo** a nechá vás připnout poznámku k libovolnému
  okamžiku.
- **Nahraje z mikrofonu**, vezme zvuk z online služby, nebo hlídá složku, kterou
  si zvolíte.
- **Uloží** do TXT, Markdownu, SRT, VTT nebo JSON — a zvuk do MP3, M4A či WAV.

## Vaše nahrávky zůstávají u vás

To je celý smysl téhle aplikace, takže tady je přesně, kdy sahá na internet —
a jsou to jen tyhle tři případy:

1. **První spuštění**, aby stáhla přepisovací nástroje a modely, které jste si
   vybrali, ze stránek jejich autorů.
2. **Když vložíte odkaz** na online službu. Váš odkaz jde ven, zpátky přijde
   zvuk. Nic dalšího.
3. **Když se zeptáte, jestli je nová verze.** Je tu také přepínač, ve výchozím
   stavu vypnutý, který se na tuhle jedinou otázku zeptá po spuštění. Vždycky se
   jen ptá — nic se nestáhne, dokud něco nezmáčknete.

**A nic víc.** Žádná telemetrie, žádná hlášení o pádech, žádný účet. Vaše
nahrávky, přepisy, poznámky a nastavení leží v souboru na vašem disku.

K tomu prvnímu stahování: každá součást je připnutá na konkrétní verzi na
konkrétní adrese a všechny až na jednu se ověřují proti otisku, který zveřejnil
jejich autor. Když soubor nesedí, aplikace ho odmítne. Ta výjimka je model
hlasů, jehož autor žádný otisk nezveřejňuje — u něj je jen HTTPS a nic víc.
Podrobně to rozepisuje [SECURITY.md](SECURITY.md).

## Co nedělá dobře

Radši napsané tady než objevené později:

- **Časy slov jsou přibližné, ne přesné.** Na klikání a sledování textu dobré;
  u dlouhé věty s pauzou uprostřed se to může rozejít asi o vteřinu.
- **Dva lidé mluvící přes sebe** se slijí do toho, kdo je hlasitější. Ruční
  oprava je součástí toho, jak se to má používat.
- **Rozhovory ano, panelové diskuse spíš ne.** Dva hlasy jsou téměř bezchybné,
  když řeknete, že jsou dva. Pět lidí v jedné místnosti sloučilo jednu dvojici.
- **Jedna nahrávka po druhé.** Přetáhnete deset a všech deset se přijme, ale
  stojí ve frontě — je to vidět. Pouštět je najednou by bylo jen pomalejší.
- **Přerušené stahování začíná znovu.** Třígigabajtový model se v půlce navázat
  nedá.
- **Archiv není šifrovaný.** Je to obyčejný soubor s takovou ochranou, jakou má
  váš uživatelský účet.

## Otázky a problémy

- **Něco je špatně, nebo máte nápad:** založte issue.
- **Našli jste bezpečnostní díru:** prosím nezakládejte veřejné issue — napište
  na jsme@znackarna.cz. [SECURITY.md](SECURITY.md) říká, co je už teď známo jako
  slabé místo.

---

## Pro vývojáře

Desktopová aplikace pro Windows postavená na Tauri 2: jádro v Rustu, rozhraní
v Reactu, archiv v SQLite. Přepis obstarává whisper.cpp, rozeznání mluvčích
CAM++ přes ONNX Runtime, jazykovou úpravu llama.cpp.

**Licence: zdrojový kód veřejně čitelný, ne open source.** Smíte si tenhle kód
přečíst a sestavit ho pro sebe. Další šíření, forky a použití jinde potřebují
písemné svolení — viz [LICENSE](LICENSE), a
[src-tauri/LICENSE.txt](src-tauri/LICENSE.txt) pro samotný program.

```powershell
npm install
npm run tauri dev     # první běh překládá Rust: 5-15 minut. Další: vteřiny.
npm run tauri build   # instalátor přistane v src-tauri\target\release\bundle\nsis\
```

Výsledkem je `Volocal_1.2.10_x64-setup.exe`.

Před odevzdáním práce:

```powershell
npm run build     # i18n:check, pak tsc --noEmit, pak build přes Vite
npm run test      # rozhraní a text přepisu
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm run i18n:check` je ta neobvyklá. Odmítne text napsaný přímo v komponentě,
neúplnou sadu množných tvarů, českou větu, která čtenáři tyká, a překlad, jehož
česká předloha se mezitím přepsala. Čeština je zdrojový jazyk rozhraní.

Na vydání jsou přísnější pravidla: u značky (tagu) běží
`node scripts/i18n.mjs check --strict`, který navíc odmítne překlad, jehož česká
předloha nikdy nedostala otisk. Potom se sestaví instalátor, nainstaluje se na
čistý stroj, spustí se a musí si stihnout založit archiv — teprve pak je běh
zelený.

Kam se co instaluje: nástroje a modely do `%LOCALAPPDATA%\Whisp\`, archiv do
`%APPDATA%\cz.znackarna.volocal\`. Ta první cesta pořád říká `Whisp` — tak se
tohle jmenovalo před Slobotem a před Volocalem — protože přejmenovat ji by
znamenalo, že si každá existující instalace stáhne všechno znovu. Ta druhá se
přestěhovala, když se změnil název, migrací, která při prvním spuštění přenese
celou složku.

[ARCHITECTURE.md](ARCHITECTURE.md) má rozvržení modulů a pravidla pojmenování.
[CONTRIBUTING.md](CONTRIBUTING.md) má, co musí mít pull request.
[docs/history/](docs/history/README.md) má, proč je kód takový, jaký je, den po
dni.

## Na čem to stojí

| | Licence |
|---|---|
| Tauri 2, React 18 | MIT / Apache 2.0 |
| SQLite | volné dílo |
| whisper.cpp, modely Whisper, Silero VAD | MIT |
| ONNX Runtime, 3D-Speaker CAM++ | MIT / Apache 2.0 |
| llama.cpp | MIT |
| Gemma (Google) | Gemma Terms of Use |
| FFmpeg | GPL v3 |
| yt-dlp | Unlicense |
| Deno | MIT |
| Geist, Inter, Schibsted Grotesk, Literata, Source Serif 4 | SIL OFL 1.1 |

Vše kromě modelů Gemma je open source. Gemma se řídí vlastní licencí Googlu
a FFmpeg licencí GPL v3. Úplný seznam je v [NOTICE](NOTICE) a v aplikaci pod
Nastavení → Informace.
