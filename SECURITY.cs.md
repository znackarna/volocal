[English](SECURITY.md) · **Čeština**

# Bezpečnost

### Kam hlásit chybu

**jsme@znackarna.cz**

Napište, co jste našli, jak to zopakovat a co se tím dá způsobit. Než to
zveřejníte, dejte nám prosím vědět — ozveme se. značkárna s.r.o. je malá firma
bez noční směny, takže odpověď může trvat dny.

Veřejný PGP klíč nemáme. Potřebujete-li šifrovaně, napište nejdřív bez
podrobností a domluvíme se.

### Které verze

Opravy vycházejí jen v nové verzi. Starší se neopravují.

### Co Volocal dělá s vaším počítačem

Je to obyčejný program pro Windows. Běží pod vaším účtem a umí přesně to, co
umíte vy.

* **Rozhraní není webová stránka.** Je součástí programu, takže se do něj nemá
  jak dostat reklama ani sledování.
* **Nahrávky ani přepisy neopustí váš počítač.** Žádná telemetrie, hlášení
  pádů, žádný účet.
* **Na aktualizaci se ptá, jen když si o to řeknete** tlačítkem v Nastavení.
* **Spouští programy od jiných autorů** — FFmpeg, whisper.cpp, llama.cpp,
  yt-dlp, Deno — a ty si samy stahuje. Tady je Volocal nejzranitelnější.

### Kde jsou slabá místa

Tři, a víme o nich.

**1. Program si stahuje jiné programy a pak je spouští.**

FFmpeg připravuje zvuk, whisper přepisuje. Volocal je v sobě nenese, stáhne si
je při prvním spuštění — a kdyby někdo cestou podstrčil jiný soubor, spustil by
se místo nich.

Brání tomu dvě věci. Adresa míří vždy na jedno konkrétní vydání, ne na
„nejnovější", takže se nemůže sama změnit. A ke každé patří **otisk**, tedy
kontrolní součet jednoho jediného souboru: Volocal ho spočítá ze stažených dat
dřív, než cokoli rozbalí, a když nesedí, stažené zahodí.

Otisk musí být opsaný od vydavatele. Spočítaný ze staženého souboru by
dokazoval jen to, že se soubor shoduje sám se sebou.

**Jedna položka otisk nemá: model rozpoznávání hlasů.** Jeho vydání je z doby,
kdy GitHub otisky ještě neuváděl, a novější verze neexistuje. Stáhne se tedy
s poznámkou, že jeho původ nikdo neověřil, a chrání ho jen HTTPS. Že zůstane
jedinou takovou položkou, hlídá automatický test:
**patnáct z šestnácti** součástí má otisk.

HTTPS je slušná pojistka, ne úplná. Spojení je šifrované a ověřuje se, s kým
mluvíte, takže věříme provozovatelům `github.com`,
`objects.githubusercontent.com` a `huggingface.co` — a všem certifikačním
autoritám, kterým věří váš Windows.

Bez ohledu na otisky pak platí tohle. Archiv, jehož obsah by při rozbalení
mířil mimo určenou složku, se odmítne celý. Stahuje se do dočasného souboru
a přejmenuje až na konci, takže přerušené stahování nevypadá jako hotová
součást. A novou verzi si program nenainstaluje sám: hledá ji robot jednou
týdně, opíše otisk od vydavatele a připraví změnu, kterou někdo schválí.

**2. Okno má ochranu proti cizímu obsahu. Přístup k souborům ji obchází.**

Okno, ve kterém Volocal běží, má pravidlo o tom, odkud se smí načíst obsah:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: asset: http://asset.localhost;
media-src 'self' blob: data: asset: http://asset.localhost;
connect-src 'self' ipc: http://ipc.localhost asset: http://asset.localhost;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

Skript, styl, písmo ani obrázek se nenačtou odjinud než z programu samotného,
okno nejde vložit do cizí stránky a obvyklé cesty, kudy by data odcházela ven,
jsou zavřené.

Co to nezastaví: pravidlo hlídá, **odkud** se smí načíst obsah — ne co smí dělat
program, který už běží. A přesměrování okna jinam neřeší, takže data schovaná
v adrese by teoreticky odejít mohla.

První obrana proto není tohle pravidlo, ale způsob, jakým se obrazovky skládají:
jako text, nikdy jako kód stránky. Ať už je v přepisu, ve jméně mluvčího nebo
v názvu souboru cokoli, nemůže se to začít chovat jako příkaz.

Otevírat soubory okno samo nesmí — v nastavení programu stojí
`"assetProtocol": { "scope": [] }`, tedy prázdný seznam povolených cest.
Nahrávka může ležet kdekoli na disku, takže vyjmenovat cesty dopředu nejde;
místo toho se pokaždé otevře jen ten jediný soubor, který se právě chystá hrát.

**3. Instalátor není podepsaný.** Windows proto při spuštění upozorní, že
program nezná. Je to rozhodnutí, ne nedodělek: certifikát, který to varování
opravdu odstraní, se pro jednoho člověka koupit nedá. Nepodepsaný instalátor ale
nerozeznáte od podvrženého jinak než podle toho, odkud jste ho stáhli — berte ho
jen ze stránky vydání na GitHubu.

### Co s tím můžete udělat vy

* Instalujte jen z oficiálního vydání, odnikud jinud.
* První spuštění, při kterém se stahují součásti, nechte proběhnout na síti,
  které věříte.
* Máte-li v archivu citlivé nahrávky, zapněte si šifrování disku. Volocal
  archiv sám nešifruje.
* Než přenosnou kopii předáte dál, přečtěte si `src-tauri/LICENSE.txt`
  a `NOTICE` — je tam FFmpeg pod licencí GPL v3 a modely Gemma pod podmínkami
  Googlu.

### Co za chybu nepovažujeme

* Že program přečte soubor, na který jste ho sami nasměrovali.
* Že přepis obsahuje chyby nebo že jazykový model vymyslí, co nezaznělo. Přepis
  je podklad ke kontrole, ne úřední dokument.
* Že program obejde někdo, kdo se už dostal k vašemu účtu. Kdo ovládá účet,
  ovládá všechno, co pod ním běží.
