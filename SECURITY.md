# Bezpečnost / Security

Česky i anglicky. Uživatelé jsou čeští, ale ten, kdo najde chybu, nemusí být.

In both languages. The users are Czech; whoever finds a flaw may not be.

---

## ČESKY

### Kam to hlásit

**jsme@znackarna.cz**

Napište, co jste našli, jak to zopakovat a co se tím dá způsobit. Než to
zveřejníte, dejte nám prosím vědět — ozveme se. značkárna s.r.o. je malá firma
bez noční směny, takže odpověď může trvat dny. Slibovat konkrétní lhůtu by
znamenalo slibovat něco, co nikdo nedodrží.

Veřejný PGP klíč nemáme. Potřebujete-li šifrovaně, napište nejdřív bez
podrobností a domluvíme se.

### Které verze

Opravy vycházejí jen v nové verzi. Podporovaná je vždycky ta poslední.

### Co Volocal dělá s vaším počítačem

Je to obyčejný program pro Windows. Běží pod vaším účtem a umí přesně to, co
umíte vy.

* **Okno nenačítá nic z internetu.** Zobrazuje rozhraní zabalené v programu.
  Žádná cizí stránka, reklama, analytika ani vzdálený skript.
* **Nic neodesílá.** Nahrávky, přepisy ani nastavení počítač neopouštějí. Žádná
  telemetrie, hlášení pádů ani účet.
* **Na aktualizaci se ptá, jen když si o to řeknete** tlačítkem v Nastavení.
* **Spouští cizí programy** — FFmpeg, whisper.cpp, llama.cpp, yt-dlp, Deno —
  a ty si samy stahuje. To je nejcitlivější místo celé aplikace a je popsané
  níž.

### Kde jsou slabá místa

Tři, a jsou to slabá místa vědomá.

**1. Aplikace si stahuje programy a modely a pak je spouští.**

Odkud, to stojí v `src-tauri/components.json`. Každá položka je pevná adresa
jednoho konkrétního souboru — žádné `latest`, žádná větev; test v
`src-tauri/src/download.rs` neprojde, kdyby tam něco takového bylo. Otisk
SHA-256 se počítá už při zápisu stahovaných bajtů a porovnává se dřív, než se
cokoli rozbalí.

Otisk do katalogu smí zapsat jen ten, kdo ho přečetl u vydavatele. Spočítat ho
z toho, co dorazilo sem, by dokazovalo jen to, že se soubor shoduje sám se
sebou.

**Jedna položka otisk nemá — model rozpoznávání hlasů.** Leží ve vydání
staršího data, než od kdy GitHub otisky počítá, a novější není. Nainstaluje se
s poznámkou `verified: false` a jedinou zárukou je u něj HTTPS. Že takových
zůstane jen tahle jedna, hlídá test: **patnáct z šestnácti** součástí otisk má.

HTTPS je pojistka slušná, ne úplná. Spojení je šifrované a certifikát se
ověřuje, takže důvěřujeme provozovatelům `github.com`,
`objects.githubusercontent.com` a `huggingface.co` — a všem certifikačním
autoritám ve vašem systému.

Kromě otisků platí: archiv, jehož obsah by mířil mimo cílovou složku, se odmítne
celý; stahuje se do dočasného souboru a přejmenuje až nakonec, takže přerušené
stahování nevypadá jako hotová součást; a když otisk nesedí, dočasný soubor jde
pryč a předchozí instalace zůstane.

**Novější verzi si aplikace nevybírá sama.** Hledá ji robot jednou týdně, přečte
otisk u vydavatele a otevře pull request, který někdo přečte. Aplikace jde vždy
jen na adresu z katalogu.

**2. Okno má Content Security Policy. Přístup k souborům ji stejně obchází.**

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: asset: http://asset.localhost;
media-src 'self' blob: data: asset: http://asset.localhost;
connect-src 'self' ipc: http://ipc.localhost asset: http://asset.localhost;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

Skript, styl, písmo ani obrázek se nenačtou odjinud než z programu. `eval` ani
`new Function` neběží. Zásuvné moduly jsou vyloučené, okno nejde vložit do cizí
stránky, a obvyklé cesty ven — `fetch`, XHR, WebSocket i obrázkový maják — jsou
zavřené.

Co to nezastaví, a je poctivé to říct: styly psané atributem povolené jsou,
protože tak je React zapisuje; přesměrování okna žádná z direktiv neřeší, takže
data v adrese by odejít mohla; a hlavně — CSP určuje, odkud se smí načíst
obsah, ne co smí dělat kód, který už běží.

První obrana je proto vstup, ne CSP. Rozhraní se skládá jako text, ne jako
HTML. Přepis, jména mluvčích, poznámky ani názvy souborů se jako HTML nikdy
nevykreslují.

A přístup k souborům: `"assetProtocol": { "scope": [] }` — okno nesmí číst nic.
Nahrávka může ležet kdekoli, takže seznam cest nejde napsat dopředu; místo toho
se vždy otevře jen ten jeden soubor, který se chystá hrát. Jiná cesta se tudy
nedostane.

**3. Instalátor není podepsaný.** Windows SmartScreen na něj proto upozorní. Je
to rozhodnutí, ne nedodělek: certifikát, který to varování opravdu odstraní, se
pro jednoho člověka koupit nedá. Nepodepsaný instalátor ale nerozeznáte od
podvrženého jinak než podle toho, odkud jste ho stáhli — berte ho jen ze
stránky vydání na GitHubu.

### Co s tím můžete udělat vy

* Instalujte jen z oficiálního vydání, odnikud jinud.
* První spuštění, kdy se stahují součásti, nechte proběhnout na síti, které
  věříte.
* Máte-li v archivu citlivé nahrávky, zapněte si šifrování disku. Aplikace
  archiv sama nešifruje.
* Než přenosnou kopii předáte dál, přečtěte si `src-tauri/LICENSE.txt`
  a `NOTICE` — je tam FFmpeg pod GPL v3 a modely Gemma pod podmínkami Googlu.

### Co za chybu nepovažujeme

* Že program přečte soubor, na který jste ho sami nasměrovali.
* Že přepis obsahuje chyby nebo že jazykový model vymyslí, co nezaznělo. Přepis
  je podklad ke kontrole, ne úřední dokument.
* Že program obejde někdo, kdo už má váš účet. Kdo ovládá účet, ovládá všechno,
  co pod ním běží.

---

## ENGLISH

### Where to report

**jsme@znackarna.cz**

Tell us what you found, how to repeat it, and what it lets someone do. Please
let us know before you publish — we will answer. značkárna s.r.o. is a small
company with no night shift, so a reply can take days. Promising a deadline
here would be promising something nobody keeps.

We have no public PGP key. If you need an encrypted channel, write first
without the details and we will arrange one.

### Which versions

Fixes ship in a new version only. The latest release is the supported one.

### What Volocal does to your computer

It is an ordinary Windows program. It runs under your account and can do
exactly what you can.

* **The window loads nothing from the internet.** It shows the interface
  bundled inside the program. No third-party page, advert, analytics or remote
  script.
* **It sends nothing out.** Recordings, transcripts and settings never leave
  the machine. No telemetry, no crash reports, no account.
* **It checks for updates only when you ask it to**, with a button in Settings.
* **It runs other people's programs** — FFmpeg, whisper.cpp, llama.cpp, yt-dlp,
  Deno — and fetches them itself. That is the most sensitive thing here, and it
  is the first item below.

### Where the weak spots are

Three, and all three are deliberate.

**1. The application downloads programs and models, then runs them.**

Where from is in `src-tauri/components.json`. Every entry is a fixed address of
one particular file — no `latest`, no branch; a test in
`src-tauri/src/download.rs` fails if one appears. The SHA-256 is computed while
the bytes are being written and compared before anything is unpacked.

A digest may be written into the catalogue only by someone who read it at the
publisher. Computing it from what arrived here would prove only that the file
matches itself.

**One entry has no digest — the speaker-recognition model.** It sits in a
release older than the day GitHub began computing digests, and there is no
newer one. It installs with `verified: false`, and HTTPS is its only guarantee.
A test keeps that to this one alone: **fifteen of the sixteen** components
carry a digest.

HTTPS is a decent safeguard, not a complete one. The connection is encrypted
and the certificate checked, so we trust whoever runs `github.com`,
`objects.githubusercontent.com` and `huggingface.co` — and every certificate
authority your system trusts.

Digests aside: an archive whose contents would land outside the target folder is
refused whole; a download is written to a temporary file and renamed only at the
end, so an interrupted one cannot look finished; and when a digest does not
match, the temporary file goes and the previous installation stays.

**The application does not pick newer versions itself.** A robot looks once a
week, reads the digest at the publisher and opens a pull request somebody reads.
The application only ever goes to the address in the catalogue.

**2. The window has a Content Security Policy. File access gets around it
anyway.**

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: asset: http://asset.localhost;
media-src 'self' blob: data: asset: http://asset.localhost;
connect-src 'self' ipc: http://ipc.localhost asset: http://asset.localhost;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

No script, style, font or image loads from anywhere but the program. `eval` and
`new Function` do not run. Plugins are excluded, the window cannot be framed by
another page, and the usual ways out — `fetch`, XHR, WebSocket, tracking pixel —
are closed.

What it does not stop, said plainly: inline styles are allowed, because that is
how React writes them; navigating the window away is covered by none of these
directives, so data in a URL could still leave; and above all — a CSP governs
where content may be loaded from, not what already-running code may do.

So the first defence is the input, not the CSP. The interface is assembled as
text, never as HTML. Transcripts, speaker names, notes and file names are never
rendered as markup.

And file access: `"assetProtocol": { "scope": [] }` — the window may read
nothing. A recording can be anywhere, so a list of paths cannot be written in
advance; instead exactly one file is opened, the one about to play. Nothing else
gets through that way.

**3. The installer is not signed.** Windows SmartScreen warns about it. That is
a decision rather than an omission: a certificate that actually removes the
warning cannot be bought by one person. But an unsigned installer is
indistinguishable from a tampered one except by where you got it — take it only
from the releases page on GitHub.

### What you can do about it

* Install only from the official release, nowhere else.
* Let the first run, when components are downloaded, happen on a network you
  trust.
* If your archive holds sensitive recordings, turn on disk encryption. The
  application does not encrypt the archive itself.
* Before passing a portable copy on, read `src-tauri/LICENSE.txt` and `NOTICE` —
  FFmpeg is under GPL v3 and the Gemma models under Google's terms.

### What we do not treat as a flaw

* That the program reads a file you pointed it at.
* That a transcript contains mistakes, or that a language model invents
  something nobody said. A transcript is material to check, not a legal record.
* That the program can be bypassed by someone who already has your account.
  Whoever controls the account controls everything running under it.
