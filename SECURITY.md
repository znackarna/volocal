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

Volocal nemá zpětné vydávání oprav. Podporovaná je vždy poslední vydaná verze;
oprava přijde v té další.

### Hranice důvěry

Volocal je desktopová aplikace pro Windows. Běží pod účtem uživatele, který ji
spustil, a má přesně jeho oprávnění.

* **Webview nenačítá cizí obsah.** Zobrazuje jen rozhraní přiložené k programu,
  ze zdrojů, které jsou v binárce. Žádná externí stránka, žádná reklama, žádná
  analytika, žádný vzdálený skript.
* **Nikam nic neposílá.** Přepis, nahrávky ani nastavení neopouštějí počítač.
  Žádná telemetrie, žádné hlášení pádů, žádný účet.
* **Na aktualizace se ptá jen na vyžádání.** Tlačítko v Nastavení → O aplikaci
  stáhne z vydání tohohle projektu jeden malý soubor. Je tam i přepínač, **ve
  výchozím stavu vypnutý**, který tutéž otázku položí jednou po spuštění.
  Zeptá se; nestáhne nic bez stisku. Odchází při tom jen běžný požadavek na
  GitHub — žádné číslo verze se neposílá, porovnává se až u vás.
* **Sama od sebe jde na síť jen kvůli stahování součástí** — nástrojů a modelů
  při prvním spuštění, a `yt-dlp` při vámi zadaném importu online videa.
  Instalátor k tomu stáhne od Microsoftu běhové prostředí WebView2, pokud ho
  počítač ještě nemá (`downloadBootstrapper` v `tauri.conf.json`).
* **Archiv je nešifrovaná databáze SQLite** ve vašem uživatelském profilu.
  Chrání ho jen oprávnění účtu a šifrování disku, pokud ho máte zapnuté.

### Co v aplikaci opravdu je a je dobré to vědět

Tohle nejsou hypotézy. Jsou to vlastnosti dnešního kódu, ověřené proti němu
13. srpna 2026.

**1. Patnáct z šestnácti stažených součástí se porovnává s otiskem. Šestnáctá
ne, a je to na ní vidět.**

Volocal si při prvním spuštění stahuje nástroje (FFmpeg, whisper.cpp,
llama.cpp, yt-dlp, Deno) a modely, rozbaluje je a spouští je jako běžné
programy pod vaším účtem.

Odkud se berou a čemu se mají rovnat, stojí v `src-tauri/components.json`.
Každá položka míří na pevnou adresu jednoho konkrétního souboru — žádné
`latest`, žádná větev; `src-tauri/src/download.rs` má na to test a se špatnou
adresou sestavení neprojde. Tentýž soubor počítá SHA-256 už během zápisu
stahovaných bajtů a porovná ho dřív, než se cokoli rozbalí nebo přesune na
místo.

Otisk smí do katalogu zapsat jen ten, kdo ho přečetl u vydavatele: Hugging Face
ho vydává jako LFS oid, GitHub jako `digest` u souboru vydání, gyan.dev jako
`.sha256` vedle archivu. Spočítat ho z toho, co dorazilo na tento stroj, by
dokazovalo jen to, že se soubor shoduje sám se sebou.

**Jedna položka otisk nemá — model rozpoznávání hlasů (`model-hlasy`).** Leží ve
vydání, které bylo nahráno dřív, než GitHub začal otisky počítat, a novější
verze neexistuje, takže není co číst. Stáhne se, nainstaluje a zapíše si
`verified: false`, tedy původ neověřen. Je to dnes jediná součást, u které
zůstává jedinou zárukou HTTPS. Že to tak zůstane jen u ní, hlídá test
`every_component_carries_a_digest_except_the_one_that_cannot`.

HTTPS je pojistka slušná, ale ne úplná: spojení je šifrované (rustls) a ověřuje
se certifikát protistrany, takže důvěřujeme provozovatelům `github.com`,
`api.github.com`, `objects.githubusercontent.com`, `huggingface.co` a
`www.gyan.dev`, a celému řetězci certifikačních autorit ve vašem systému.

Aplikace přitom netvrdí víc, než ověřila. Každá dokončená instalace zapíše do
`installed.json` adresu, otisk toho, co skutečně dorazilo, a `verified` — true
jen tam, kde bylo s čím porovnávat. Samotná existence souboru na disku za doklad
původu neplatí, takže instalace pořízené dřív, než otisky existovaly, zůstávají
`false` a samy se nepovýší. Tento záznam ale zatím není v rozhraní nikde vidět.

Nezávisle na otiscích platí:

* archiv, jehož položka by skončila mimo cílovou složku (`..`, absolutní cesta,
  písmeno disku), se odmítne celý — nerozbalí se z něj ani zbytek;
* přerušené stahování nemůže vypadat jako hotová součást: zapisuje se do
  dočasného souboru a na cílové jméno se přejmenuje až nakonec;
* když otisk nesouhlasí, dočasný soubor se smaže a předchozí funkční instalace
  zůstane nedotčená.

**Novější verzi součásti nevybírá aplikace.** Vzor nad vydáními na GitHubu,
který tady dřív běžel při samotném stahování, se přestěhoval do
`scripts/update-components.mjs`. Ten se spouští jednou týdně z
`.github/workflows/update-components.yml`, najde novější soubor, přečte jeho
otisk u vydavatele a otevře pull request, který někdo přečte a schválí. Vydání
bez otisku přeskočí. Sama aplikace jde vždy jen na tu adresu, která je
v katalogu.

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
  věříte. U patnácti součástí to hlídá otisk, u modelu rozpoznávání hlasů ne.
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

Volocal does not backport fixes. The supported version is always the latest
release; a fix arrives in the next one.

### Trust boundary

Volocal is a Windows desktop application. It runs as the user who started it and
has exactly that user's rights.

* **The webview loads no foreign content.** It renders only the interface
  bundled with the program, from sources compiled into the binary. No external
  page, no advertising, no analytics, no remote script.
* **It sends nothing out.** Transcripts, recordings and settings never leave the
  computer. No telemetry, no crash reporting, no account.
* **It checks for updates only when asked.** The button on Settings → About
  fetches one small file from this project's releases page. There is also a
  switch, **off by default**, that asks the same question once when the window
  opens. It asks; it downloads nothing without a press. What leaves is an
  ordinary request to GitHub — no version number is sent, the comparison
  happens on your machine.
* **It reaches the network on its own only to fetch components** — the tools and
  models on first run, and `yt-dlp` for an online video import you asked for.
  The installer additionally fetches the WebView2 runtime from Microsoft if the
  machine does not already have it (`downloadBootstrapper` in
  `tauri.conf.json`).
* **The archive is an unencrypted SQLite database** in your user profile. It is
  protected by account permissions and by disk encryption if you have it on.

### What is actually in the application, and worth knowing

These are not hypotheticals. They are properties of today's code, checked
against it on 13 August 2026.

**1. Fifteen of the sixteen downloaded components are compared against a
digest. The sixteenth is not, and it says so.**

On first run Volocal downloads tools (FFmpeg, whisper.cpp, llama.cpp, yt-dlp,
Deno) and models, unpacks them, and runs them as ordinary programs under your
account.

Where they come from and what they must hash to is in
`src-tauri/components.json`. Every entry points at a fixed address naming one
exact file — no `latest`, no branch; `src-tauri/src/download.rs` has a test for
that, and a wrong address fails the build. The same file computes a SHA-256 as
the downloaded bytes are written and compares it before anything is unpacked or
moved where it belongs.

A digest may only be written into the catalogue by somebody who read it from the
publisher: Hugging Face serves it as an LFS object id, GitHub as a release
asset `digest`, gyan.dev as a `.sha256` beside the archive. Computing it from
whatever arrived on this machine would attest that the file matches itself, and
nothing more.

**One entry has no digest — the speaker recognition model (`model-hlasy`).** It
sits in a release uploaded before GitHub computed asset digests, and there is no
newer version to follow, so there is nothing to read. It downloads, installs and
records itself `verified: false` — origin unverified. It is the one component
for which HTTPS remains the only guarantee today. That it stays the only one is
held by a test — `every_component_carries_a_digest_except_the_one_that_cannot`.

HTTPS is a decent guarantee, not a complete one: the connection is encrypted
(rustls) and the peer's certificate is validated, which means trusting whoever
operates `github.com`, `api.github.com`, `objects.githubusercontent.com`,
`huggingface.co` and `www.gyan.dev`, and the whole chain of certificate
authorities on your system.

The application claims no more than it checked. Every completed installation
records the address, the digest of what actually arrived, and `verified` — true
only where there was something to compare against — in `installed.json`. A file
sitting in the right place is not accepted as evidence of where it came from, so
installations made before digests existed stay `false` and do not promote
themselves. That record is not yet shown anywhere in the interface.

Regardless of digests, this holds:

* an archive with an entry that would land outside the destination folder
  (`..`, an absolute path, a drive letter) is refused whole — not even the rest
  of it is unpacked;
* an interrupted download cannot look like a finished component: bytes go to a
  temporary file that is renamed to the target name only at the end;
* when a digest does not match, the temporary file is deleted and the previous
  working installation is left untouched.

**The application does not choose a newer version of anything.** The regular
expression over GitHub releases, which used to run here during the download
itself, now lives in `scripts/update-components.mjs`. It runs once a week from
`.github/workflows/update-components.yml`, finds the newer file, reads its
digest from the publisher and opens a pull request for somebody to read and
approve. A release that publishes no digest is skipped. The application itself
only ever fetches the address written in the catalogue.

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
  network you trust. A digest guards fifteen of them; the speaker recognition
  model has none.
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
