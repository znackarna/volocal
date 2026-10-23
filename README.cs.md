[English](README.md) · **Čeština**

# Volocal

**Převádí řeč na text, u vás v počítači.**

Vložíte nahrávku a dostanete přepis, který si můžete přečíst, opravit,
prohledat a přehrát slovo po slovu. Pozná, kdo co řekl. Text umí učesat, shrnout
i přeložit.

Vaše nahrávky nikdy neopustí váš počítač. Žádný účet, žádný cloud, žádné nahrávání
na server — modely běží na vašem vlastním hardwaru, po prvním nastavení bez
připojení.

## Jak ho získat

**Windows 10 nebo 11.** [Stáhněte si instalátor](../../releases/latest) —
instaluje se jen pro vás a nechce práva správce.

**Stav: vydáno, 1.3.1.** Autor ho používá denně.

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
- **Funguje i z příkazové řádky.** `volocal-cli` přepisuje, vyhledává a ukládá
  ze skriptu i přímo z libovolného terminálu, ve stejném archivu a s živým
  průběhem přepisu — viz [docs/cli.md](docs/cli.md).

## Vaše nahrávky zůstávají u vás

To je celý smysl téhle aplikace. Na internet sahá ve třech případech:

1. **První spuštění**, aby stáhla přepisovací nástroje a modely, které jste si
   vybrali, ze stránek jejich autorů.
2. **Když vložíte odkaz** na online službu. Váš odkaz jde ven, zpátky přijde
   zvuk. Nic dalšího.
3. **Když se zeptáte, jestli je nová verze.** Je tu i přepínač, ve výchozím
   stavu vypnutý, který se na to zeptá po spuštění. Nic se nestáhne, dokud
   něco nezmáčknete.

**A nic víc.** Žádná telemetrie, žádná hlášení o pádech, žádný účet. Vaše
nahrávky, přepisy, poznámky a nastavení leží v souboru na vašem disku.

K tomu prvnímu stahování: každá součást je připnutá na konkrétní verzi na
konkrétní adrese a všechny až na jednu se ověřují proti otisku, který zveřejnil
jejich autor. Když soubor nesedí, aplikace ho odmítne. Ta výjimka je model
hlasů, jehož autor žádný otisk nezveřejňuje — u něj je jen HTTPS a nic víc.

## Jaké má limity?

- **Časy slov jsou přibližné, ne přesné.** Na klikání a sledování textu dobré;
  u dlouhé věty s pauzou uprostřed se to může rozejít asi o vteřinu.
- **Dva lidé mluvící přes sebe** se slijí do toho, kdo je hlasitější. Ruční
  oprava je součástí toho, jak se to má používat.
- **Rozhovory ano, panelové diskuse spíš ne.** Dva hlasy jsou téměř bezchybné,
  když řeknete, že jsou dva. Pět lidí v jedné místnosti sloučilo jednu dvojici.
- **Jedna nahrávka po druhé.** Přetáhnete deset a všech deset se přijme, ale
  stojí ve frontě — je to vidět. Pouštět je najednou by bylo jen pomalejší.
- **Přerušené stahování naváže tam, kde skončilo** — kromě modelu hlasů, u
  kterého autor nezveřejňuje otisk, takže rozdělaný soubor nejde ověřit a stahuje
  se znovu od začátku.
- **Archiv není šifrovaný.** Je to obyčejný soubor s takovou ochranou, jakou má
  váš uživatelský účet.

## Otázky a problémy

- **Něco je špatně, nebo máte nápad:** založte issue.
- **Našli jste bezpečnostní díru:** prosím nezakládejte veřejné issue — napište
  na jsme@znackarna.cz.

---

## Licence

Volocal patří značkárně s.r.o. Smíte ho nainstalovat a používat; jeho zdrojový
kód není veřejný. Podmínky najdete v [LICENSE](LICENSE).

Součásti, na kterých stojí, a jejich licence najdete v [NOTICE](NOTICE)
a v aplikaci pod Nastavení → Informace.

