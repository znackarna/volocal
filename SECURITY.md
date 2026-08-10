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

Volocal je ve verzi 0.9.0 a nemá zpětné vydávání oprav. Podporovaná je vždy
poslední vydaná verze; oprava přijde v té další.

### Hranice důvěry

Volocal je desktopová aplikace pro Windows. Běží pod účtem uživatele, který ji
spustil, a má přesně jeho oprávnění.

* **Webview nenačítá cizí obsah.** Zobrazuje jen rozhraní přiložené k programu,
  ze zdrojů, které jsou v binárce. Žádná externí stránka, žádná reklama, žádná
  analytika, žádný vzdálený skript.
* **Nikam nic neposílá.** Přepis, nahrávky ani nastavení neopouštějí počítač.
  Aplikace se neptá na aktualizace a neodesílá žádnou telemetrii.
* **Sama od sebe jde na síť jen kvůli stahování součástí** — nástrojů a modelů
  při prvním spuštění, a `yt-dlp` při vámi zadaném importu online videa.
  Instalátor k tomu stáhne od Microsoftu běhové prostředí WebView2, pokud ho
  počítač ještě nemá (`downloadBootstrapper` v `tauri.conf.json`).
* **Archiv je nešifrovaná databáze SQLite** ve vašem uživatelském profilu.
  Chrání ho jen oprávnění účtu a šifrování disku, pokud ho máte zapnuté.

### Co v aplikaci opravdu je a je dobré to vědět

Tohle nejsou hypotézy. Jsou to vlastnosti dnešního kódu, ověřené proti němu
10. srpna 2026.

**1. Stažené součásti se zatím neporovnávají s žádným kontrolním součtem.**

Volocal si při prvním spuštění stahuje nástroje (FFmpeg, whisper.cpp,
llama.cpp, yt-dlp, Deno) a modely, rozbaluje je a spouští je jako běžné
programy pod vaším účtem.

Postup na ověřování připravený je. `src-tauri/src/download.rs` počítá SHA-256
už během zápisu staženého souboru a porovnává ho dřív, než se cokoli rozbalí
nebo přesune na místo. Tabulka očekávaných otisků (`EXPECTED_HASHES`) je ale
**prázdná**, takže dnes se neporovnává nic, a to u žádné součásti. Otisk tam
smí přibýt teprve tehdy, až ho někdo přečte z vydání toho kterého projektu;
spočítat ho z toho, co dorazilo na tento stroj, by dokazovalo jen to, že se
soubor shoduje sám se sebou.

Jediná záruka integrity tedy zůstává HTTPS: spojení je šifrované (rustls) a
ověřuje se certifikát protistrany. To znamená, že důvěřujeme provozovatelům
`github.com`, `api.github.com`, `objects.githubusercontent.com`,
`huggingface.co` a `www.gyan.dev`, a celému řetězci certifikačních autorit ve
vašem systému.

Proti vydání 0.9.0 se změnilo jedno: aplikace už netvrdí, že původ ověřila.
Každá dokončená instalace zapíše do `installed.json` adresu, otisk toho, co
skutečně dorazilo, a `verified: false`, dokud nebylo s čím porovnávat. Samotná
existence souboru na disku už za doklad původu neplatí. Tento záznam ale zatím
není v rozhraní nikde vidět.

Nezávisle na otiscích už platí:

* archiv, jehož položka by skončila mimo cílovou složku (`..`, absolutní cesta,
  písmeno disku), se odmítne celý — nerozbalí se z něj ani zbytek;
* přerušené stahování nemůže vypadat jako hotová součást: zapisuje se do
  dočasného souboru a na cílové jméno se přejmenuje až nakonec;
* kdyby otisk nesouhlasil, dočasný soubor se smaže a předchozí funkční
  instalace zůstane nedotčená.

**Pět položek katalogu se nehledá na pevné adrese, ale regulárním výrazem
v živých vydáních na GitHubu** (`whisper-cpu`, `whisper-cuda`, `deno`,
`editor-vulkan`, `editor-cpu`). Šestá, `yt-dlp`, sice pevnou adresu má, ale
míří na `releases/latest/download/`, takže je to rovněž to, co projekt vydává
právě teď. Co se u těchto šesti nainstaluje, závisí na tom, co ty projekty
v daný okamžik publikují; kdyby se přejmenoval nebo podstrčil soubor, který
vzoru vyhoví, Volocal ho stáhne a spustí. Dokud nejsou připnuté na konkrétní
verzi, nemůže u nich žádný otisk vzniknout.

**2. Webview má Content Security Policy. Asset protokol i tak vidí celý disk.**

V `src-tauri/tauri.conf.json` je od 7. srpna 2026 tato politika (zalomená kvůli
šířce stránky; v konfiguraci je to jeden řádek):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: asset: http://asset.localhost;
media-src 'self' blob: data: asset: http://asset.localhost;
connect-src 'self' ipc: http://ipc.localhost asset: http://asset.localhost;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

Co zastaví: skript, styl, písmo ani obrázek se nenačte odjinud než z binárky.
`script-src 'self'` neobsahuje `'unsafe-eval'`, takže `eval` ani `new Function`
neběží. `object-src 'none'` vylučuje zásuvné moduly, `base-uri 'self'`
přepsání základní adresy, `frame-ancestors 'none'` vložení okna do cizí
stránky. A `connect-src` dovoluje jen `self`, `ipc:` a `asset:`, takže obvyklé
cesty, kterými by cizí kód posílal data ven, jsou zavřené: `fetch`, XHR,
WebSocket i obrázkový maják, protože `img-src` cizí adresu nepřipouští.

Co nezastaví, a je potřeba to říct nahlas:

* `style-src` má `'unsafe-inline'`, protože React zapisuje styly atributem;
* zavřené jsou *obvyklé* cesty ven, ne všechny: přesměrování okna
  (`window.location`) žádná z těchto direktiv neřeší a `form-action` nastavená
  není, takže data v adrese by odejít mohla;
* a hlavně — CSP určuje, odkud se smí načíst obsah, ne co smí dělat kód, který
  už běží. Neomezuje, které příkazy Tauri smí okno zavolat, a most IPC musí
  zůstat otevřený.

CSP je tedy druhá pojistka, ne první.

První je pořád vstup: rozhraní se skládá v Reactu jako text, ne jako HTML.
Jediné tři výskyty `dangerouslySetInnerHTML` v `src/` vkládají tentýž přiložený
SVG znak (`src/mark.svg`) zapečený v binárce. Přepis, jména mluvčích, poznámky
ani názvy souborů se jako HTML nikdy nevykreslují.

`"assetProtocol": { "scope": [] }` — webview nesmí číst nic. Nahrávka může ležet
na kterémkoli disku, takže seznam cest nelze napsat dopředu; místo toho se
otevře vždy jen ten jeden soubor, který se chystá hrát, a to v `playback_source`
(`src-tauri/src/commands/detail.rs`). Jiná cesta se přes `asset:` nedostane.
CSP na tom nic nemění — `media-src` i `img-src` protokol `asset:` povolují —
rozhoduje ten rozsah.

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

Volocal is at 0.9.0 and does not backport fixes. The supported version is
always the latest release; a fix arrives in the next one.

### Trust boundary

Volocal is a Windows desktop application. It runs as the user who started it and
has exactly that user's rights.

* **The webview loads no foreign content.** It renders only the interface
  bundled with the program, from sources compiled into the binary. No external
  page, no advertising, no analytics, no remote script.
* **It sends nothing out.** Transcripts, recordings and settings never leave the
  computer. The application does not check for updates and sends no telemetry.
* **It reaches the network on its own only to fetch components** — the tools and
  models on first run, and `yt-dlp` for an online video import you asked for.
  The installer additionally fetches the WebView2 runtime from Microsoft if the
  machine does not already have it (`downloadBootstrapper` in
  `tauri.conf.json`).
* **The archive is an unencrypted SQLite database** in your user profile. It is
  protected by account permissions and by disk encryption if you have it on.

### What is actually in the application, and worth knowing

These are not hypotheticals. They are properties of today's code, checked
against it on 10 August 2026.

**1. Downloaded components are not yet compared against any checksum.**

On first run Volocal downloads tools (FFmpeg, whisper.cpp, llama.cpp, yt-dlp,
Deno) and models, unpacks them, and runs them as ordinary programs under your
account.

The machinery for verifying them is in place. `src-tauri/src/download.rs`
computes a SHA-256 as the downloaded bytes are written and compares it before
anything is unpacked or moved where it belongs. But the table of expected
digests (`EXPECTED_HASHES`) is **empty**, so today nothing is compared, for any
component. A digest may only be written there once somebody has read it from
that project's own release; computing it from whatever arrived on this machine
would attest that the file matches itself, and nothing more.

The single integrity guarantee therefore remains HTTPS: the connection is
encrypted (rustls) and the peer's certificate is validated. Which means trusting
whoever operates `github.com`, `api.github.com`,
`objects.githubusercontent.com`, `huggingface.co` and `www.gyan.dev`, and the
whole chain of certificate authorities on your system.

One thing has changed since 0.9.0 was released: the application no longer claims
the origin was checked. Every completed installation records the address, the
digest of what actually arrived, and `verified: false` while there was nothing
to compare against, in `installed.json`. A file sitting in the right place is no
longer accepted as evidence of where it came from. That record is not yet shown
anywhere in the interface.

Regardless of digests, this already holds:

* an archive with an entry that would land outside the destination folder
  (`..`, an absolute path, a drive letter) is refused whole — not even the rest
  of it is unpacked;
* an interrupted download cannot look like a finished component: bytes go to a
  temporary file that is renamed to the target name only at the end;
* were a digest not to match, the temporary file is deleted and the previous
  working installation is left untouched.

**Five catalogue entries are not fetched from a fixed address at all but found
by a regular expression over live GitHub releases** (`whisper-cpu`,
`whisper-cuda`, `deno`, `editor-vulkan`, `editor-cpu`). A sixth, `yt-dlp`, does
have a fixed address, but it points at `releases/latest/download/`, so it too is
whatever that project publishes right now. What gets installed for these six
depends on what those projects publish at that moment; an asset renamed or
substituted so that it satisfies the pattern would be downloaded and run. Until
they are pinned to a version, no digest can exist for them.

**2. The webview has a Content Security Policy. The asset protocol still sees
the whole disk.**

`src-tauri/tauri.conf.json` has carried this policy since 7 August 2026 (wrapped
for the page; in the configuration it is a single line):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: asset: http://asset.localhost;
media-src 'self' blob: data: asset: http://asset.localhost;
connect-src 'self' ipc: http://ipc.localhost asset: http://asset.localhost;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

What it stops: no script, style, font or image loads from anywhere but the
binary. `script-src 'self'` carries no `'unsafe-eval'`, so `eval` and
`new Function` do not run. `object-src 'none'` rules out plugins, `base-uri
'self'` rewriting the base address, `frame-ancestors 'none'` embedding the
window in a foreign page. And `connect-src` allows only `self`, `ipc:` and
`asset:`, so the usual ways foreign code would send data out are closed:
`fetch`, XHR, WebSocket, and the image beacon too, because `img-src` admits no
foreign address.

What it does not stop, said plainly:

* `style-src` carries `'unsafe-inline'`, because React writes styles as an
  attribute;
* what is closed are the *usual* ways out, not all of them: navigating the
  window (`window.location`) is governed by none of these directives, and
  `form-action` is not set, so data in an address could still leave;
* and above all — a CSP governs where content may be loaded from, not what code
  already running may do. It does not restrict which Tauri commands the window
  may call, and the IPC bridge has to stay open.

The policy is a second line of defence, not the first.

The first is still the input side: the interface is composed in React as text,
not as HTML. The only three occurrences of `dangerouslySetInnerHTML` in `src/`
insert the same bundled SVG mark (`src/mark.svg`), compiled into the binary.
Transcripts, speaker names, notes and file names are never rendered as HTML.

`"assetProtocol": { "scope": [] }` — the webview may read nothing. A recording
may sit on any drive, so the list of paths cannot be written in advance;
instead the one file about to be played is opened for it, and only there, in
`playback_source` (`src-tauri/src/commands/detail.rs`). No other path travels
over `asset:`. The policy changes nothing about that — both `media-src` and
`img-src` admit the `asset:` protocol — the scope is what decides.

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
