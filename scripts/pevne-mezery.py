#!/usr/bin/env python3
"""Doplní pevné mezery tam, kde je čeština chce, a nikde jinde.

Pouští se až úplně nakonec. Kdyby běžela dřív, rozbila by doslovné řetězce,
podle kterých se hledají ostatní opravy — a hledání by pak tiše nenacházelo
nic, což vypadá stejně jako čistý text.

Sazba nesmí nechat jednopísmennou předložku na konci řádku. Totéž platí pro
číslo oddělené od jednotky a pro řády ve velkém čísle.

Sahá jen na text mezi značkami a na obsah atributů `alt`, `aria-label`
a `title`. Do jmen tříd, cest, kódu ani do textů v SVG nezasahuje — v SVG by
se pevná mezera vysázela, ale zalomení tam stejně nehrozí, protože každý
řádek je vlastní `<text>`.

    python3 pevne-mezery.py page.src.html
"""
import re
import sys

NBSP = " "

# jednopísmenné předložky a spojky, které nesmí zůstat na konci řádku
KRATKA = "AIKOSUVZaikosuvz"


def opravy_v_textu(t: str) -> str:
    # jednopísmenné slovo následované mezerou a dalším slovem
    t = re.sub(rf"(?<=[\s(„\"'—–-])([{KRATKA}]) (?=[0-9A-Za-zÁ-Žá-ž„])",
               lambda m: f"{m.group(1)}{NBSP}", t)
    # a totéž na začátku kusu textu, kam lookbehind nedosáhne
    t = re.sub(rf"^([{KRATKA}]) (?=[0-9A-Za-zÁ-Žá-ž„])",
               lambda m: f"{m.group(1)}{NBSP}", t)
    # číslo a jednotka nebo slovo za ním: 60 hodin, 15 px, 9 kB
    t = re.sub(r"(\d) (?=(?:px|kB|MB|GB|ms|h|s|%|×|hodin|minut|vrstev|"
               r"typů|sekcí|uzlů|taxonomií|otázky|stránek|procent)\b)",
               lambda m: m.group(1) + NBSP, t)
    # řády ve velkém čísle: 12 378 -> 12<nbsp>378
    t = re.sub(r"(\d) (?=\d{3}\b)", lambda m: m.group(1) + NBSP, t)
    # datum se na konci řádku nedělí: 4. 9. 2026
    t = re.sub(r"(\d{1,2}\.) (?=\d{1,2}\. ?\d{0,4})",
               lambda m: m.group(1) + NBSP, t)
    t = re.sub(r"(\d{1,2}\.) (?=\d{4}\b)", lambda m: m.group(1) + NBSP, t)
    return t


def main() -> int:
    cesta = sys.argv[1]
    s = open(cesta, encoding="utf-8").read()

    # rozřež na kusy: uvnitř <style>, <script> a <svg> se nesahá na text
    chranene = []

    def schovej(m):
        chranene.append(m.group(0))
        return f"\x00{len(chranene) - 1}\x00"

    s = re.sub(r"<(style|script|svg)\b.*?</\1>", schovej, s, flags=re.S)

    # text mezi značkami
    kusy = re.split(r"(<[^>]+>)", s)
    for i, kus in enumerate(kusy):
        if kus.startswith("<"):
            # jen čitelné atributy
            kusy[i] = re.sub(
                r'((?:alt|aria-label|title)=")([^"]+)(")',
                lambda m: m.group(1) + opravy_v_textu(m.group(2)) + m.group(3),
                kus)
        elif "\x00" not in kus:
            kusy[i] = opravy_v_textu(kus)
    s = "".join(kusy)

    s = re.sub(r"\x00(\d+)\x00", lambda m: chranene[int(m.group(1))], s)

    puvodni = open(cesta, encoding="utf-8").read()
    kolik = s.count(NBSP) - puvodni.count(NBSP)
    open(cesta, "w", encoding="utf-8").write(s)
    print(f"Doplněno {kolik} pevných mezer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
