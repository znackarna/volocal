# Bezpečnost / Security

Dvojjazyčně, česky první, stejně jako `src-tauri/LICENSE.txt`. Uživatelé i
autor jsou čeští; ten, kdo najde zranitelnost, nemusí být.

Bilingual, Czech first, the same way `src-tauri/LICENSE.txt` is. The users and
the author are Czech; whoever finds a vulnerability may not be.

---

## ČESKY

### Kam hlásit

**jsme@znackarna.cz**

Napište, co jste našli, jak se to dá zopakovat a čeho tím jde dosáhnout.
Nezveřejňujte to prosím dřív, než se ozveme — a ozveme se. značkárna s.r.o. je
malá firma bez nepřetržité služby, takže odpověď může trvat dny, ne minuty.
Slibovat tady konkrétní lhůtu by znamenalo slibovat něco, co nikdo nedrží.

Nemáme veřejný PGP klíč. Pokud potřebujete šifrovaný kanál, napište nejdřív bez
podrobností a domluvíme se.

### Které verze

Slobot je ve verzi 0.9.0 a nemá zpětné vydávání oprav. Podporovaná je vždy
poslední vydaná verze; oprava přijde v té další.

### Hranice důvěry

Slobot je desktopová aplikace pro Windows. Běží pod účtem uživatele, který ji
spustil, a má přesně jeho oprávnění.

* **Webview nenačítá cizí obsah.** Zobrazuje jen rozhraní přiložené k programu,
  ze zdrojů, které jsou v binárce. Žádná externí stránka, žádná reklama, žádná
  analytika, žádný vzdálený skript.
* **Nikam nic neposílá.** Přepis, nahrávky ani nastavení neopouštějí počítač.
  Aplikace se neptá na aktualizace a neodesílá žádnou telemetrii.
* **Sama od sebe jde na síť jen kvůli stahování součástí** — nástrojů a modelů
  při prvním spuštění, a `yt-dlp` při vámi zadaném importu online videa.
* **Archiv je nešifrovaná databáze SQLite** ve vašem uživatelském profilu.
  Chrání ho jen oprávnění účtu a šifrování disku, pokud ho máte zapnuté.

### Co v aplikaci opravdu je a je dobré to vědět

Tohle nejsou hypotézy. Jsou to vlastnosti dnešního kódu.

**1. Stažené programy se neověřují kontrolním součtem ani podpisem.**

Slobot si při prvním spuštění stahuje nástroje (FFmpeg, whisper.cpp,
sherpa-onnx, llama.cpp, yt-dlp, Deno) a modely, rozbaluje je a spouští je jako
běžné programy pod vaším účtem. Jediná kontrola po stažení je, že očekávaný
soubor po rozbalení existuje — v `src-tauri/src/download.rs`, kde se testuje
`verification_path`. Žádný SHA-256, žádný podpis, žádné připnutí certifikátu.

Jediná záruka integrity je tedy HTTPS: spojení je šifrované (rustls) a ověřuje
se certifikát protistrany. To znamená, že důvěřujeme provozovatelům
`github.com`, `objects.githubusercontent.com`, `huggingface.co` a
`www.gyan.dev`, a celému řetězci certifikačních autorit ve vašem systému.

Šest položek katalogu se navíc nehledá na pevné adrese, ale **regulárním
výrazem v živých vydáních na GitHubu** (`whisper-cpu`, `whisper-cuda`, `deno`,
`editor-vulkan`, `editor-cpu`, `sherpa`). Co se nainstaluje, tedy závisí na
tom, co ty projekty v daný okamžik vydávají. Kdyby se přejmenoval nebo
podstrčil soubor, který vzoru vyhoví, Slobot ho stáhne a spustí.

**2. Webview nemá Content Security Policy a asset protokol vidí celý disk.**

V `src-tauri/tauri.conf.json` je `"csp": null` a
`"assetProtocol": { "scope": ["**"] }`.

Rozsah `**` je tam proto, že aplikace přehrává nahrávky odkudkoli, kam uživatel
ukázal — nahrávka může ležet na kterémkoli disku. Důsledek je, že webview
dokáže přečíst cokoli, na co má účet právo, ne jen soubory v archivu.

`csp: null` znamená, že kdyby se do rozhraní kdy dostal cizí kód, není žádná
druhá pojistka, která by ho zastavila. To, co dnes drží, je vstup: rozhraní se
skládá v Reactu jako text, ne jako HTML. Jediné tři výskyty
`dangerouslySetInnerHTML` v `src/` vkládají tentýž přiložený SVG znak
(`src/mark.svg`) zapečený v binárce. Přepis, jména mluvčích, poznámky ani názvy
souborů se jako HTML nikdy nevykreslují.

**3. Program není podepsaný.** Instalátor zatím nenese podpis, takže Windows
SmartScreen na něj upozorní. Podepisování je připravené (`Vydání` v README),
ale nasazené není — a nepodepsaný instalátor nedokážete odlišit od
podvrženého jinak než tím, odkud jste ho stáhli.

### Co s tím může udělat uživatel

* Instalujte jen z oficiálního vydání značkárna s.r.o. a nikde jinde.
* Nechte první spuštění (kdy se stahují součásti) proběhnout na síti, které
  věříte. Nejsou to megabajty, které by šlo dodatečně zkontrolovat.
* Zapněte si šifrování disku (BitLocker), pokud v archivu máte citlivé
  nahrávky. Aplikace archiv sama nešifruje.
* Než předáte přenosnou kopii dál, přečtěte si `src-tauri/LICENSE.txt` a
  `NOTICE` — je v ní FFmpeg pod GPL v3 a modely Gemma pod podmínkami Googlu.

### Co za zranitelnost nepovažujeme

* Že aplikace přečte soubor, na který jste ji sami nasměrovali.
* Že přepis pořízený strojem obsahuje chyby, nebo že jazykový model vymyslí
  něco, co nezaznělo. Přepis je podklad ke kontrole, ne úřední dokument.
* Že program lze upravit nebo obejít někým, kdo už má přístup k účtu, pod
  kterým běží. Kdo ovládá účet, ovládá i všechno, co pod ním běží.

---

## ENGLISH

### Where to report

**jsme@znackarna.cz**

Tell us what you found, how to reproduce it, and what it gets an attacker.
Please hold off publishing until we have replied — and we will reply.
značkárna s.r.o. is a small company with no round-the-clock rota, so an answer
may take days rather than minutes. Promising a fixed window here would mean
promising something nobody holds.

There is no public PGP key. If you need an encrypted channel, write first
without the details and we will arrange one.

### Which versions

Slobot is at 0.9.0 and does not backport fixes. The supported version is
always the latest release; a fix arrives in the next one.

### Trust boundary

Slobot is a Windows desktop application. It runs as the user who started it and
has exactly that user's rights.

* **The webview loads no foreign content.** It renders only the interface
  bundled with the program, from sources compiled into the binary. No external
  page, no advertising, no analytics, no remote script.
* **It sends nothing out.** Transcripts, recordings and settings never leave the
  computer. The application does not check for updates and sends no telemetry.
* **It reaches the network on its own only to fetch components** — the tools and
  models on first run, and `yt-dlp` for an online video import you asked for.
* **The archive is an unencrypted SQLite database** in your user profile. It is
  protected by account permissions and by disk encryption if you have it on.

### What is actually in the application, and worth knowing

These are not hypotheticals. They are properties of today's code.

**1. Downloaded programs are verified by neither checksum nor signature.**

On first run Slobot downloads tools (FFmpeg, whisper.cpp, sherpa-onnx,
llama.cpp, yt-dlp, Deno) and models, unpacks them, and runs them as ordinary
programs under your account. The only check afterwards is that the expected file
exists once the archive is unpacked — in `src-tauri/src/download.rs`, where
`verification_path` is tested. No SHA-256, no signature, no certificate pinning.

The single integrity guarantee is therefore HTTPS: the connection is encrypted
(rustls) and the peer's certificate is validated. Which means trusting whoever
operates `github.com`, `objects.githubusercontent.com`, `huggingface.co` and
`www.gyan.dev`, and the whole chain of certificate authorities on your system.

Six catalogue entries are not fetched from a fixed address at all but **found by
a regular expression over live GitHub releases** (`whisper-cpu`, `whisper-cuda`,
`deno`, `editor-vulkan`, `editor-cpu`, `sherpa`). What gets installed therefore
depends on what those projects publish at that moment. An asset renamed or
substituted so that it satisfies the pattern would be downloaded and run.

**2. The webview has no Content Security Policy, and the asset protocol sees
the whole disk.**

`src-tauri/tauri.conf.json` carries `"csp": null` and
`"assetProtocol": { "scope": ["**"] }`.

The `**` scope is there because the application plays recordings from wherever
the user pointed it — a recording may sit on any drive. The consequence is that
the webview can read anything the account may read, not only the archive.

`csp: null` means that if foreign code ever reached the interface, there is no
second line of defence to stop it. What holds today is the input side: the
interface is composed in React as text, not as HTML. The only three occurrences
of `dangerouslySetInnerHTML` in `src/` insert the same bundled SVG mark
(`src/mark.svg`), compiled into the binary. Transcripts, speaker names, notes
and file names are never rendered as HTML.

**3. The program is not signed.** The installer carries no signature yet, so
Windows SmartScreen warns about it. Signing is prepared (`Vydání` in README) but
not in place — and an unsigned installer cannot be told apart from a forged one
except by where you downloaded it.

### What a user can do

* Install only from an official značkárna s.r.o. release, and nowhere else.
* Let the first run — the one that downloads the components — happen on a
  network you trust. These are not megabytes anyone can check afterwards.
* Turn on disk encryption (BitLocker) if the archive holds sensitive
  recordings. The application does not encrypt it.
* Before handing a portable copy to somebody, read `src-tauri/LICENSE.txt` and
  `NOTICE` — it carries FFmpeg under GPL v3 and the Gemma models under Google's
  own terms.

### What we do not treat as a vulnerability

* That the application reads a file you pointed it at yourself.
* That a machine-made transcript contains errors, or that a language model
  invents something nobody said. A transcript is material to be checked, not an
  official document.
* That the program can be modified or bypassed by somebody who already has
  access to the account it runs under. Whoever controls the account controls
  everything running under it.
