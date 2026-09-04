#!/usr/bin/env python3
"""Odmítne českou stránku, která zní jako překlad z angličtiny.

Zadání ze 4. 9. 2026 znělo „žádné kalky, anglicismy". Čtyři čtenáři tehdy
našli v jedné stránce jednadevadesát výrazů — talk, slide, screenshot, vizuál,
artefakt, backend, ale i „obsah, který obsahuje" a „stojí to skoro žádný čas",
což je kladné sloveso se záporným zájmenem, tedy anglická stavba. Ručně se to
najde jen tak, že to někdo přečte celé a nahlas.

Pravidlo „nepoužívej anglicismy" nikdo nedodrží, protože si u psaní nevšimne.
Kontrola, která je vypíše i s návrhem náhrady, se dodržet dá — a je to totéž,
co stránka sama hlásá: netvořit pravidla, ale nástroje.

Slova, která zůstávají vědomě, jsou v ZDOMÁCNĚLÉ. Kdo je bude chtít změnit,
ať to udělá tam, ne potichu v textu.

Nekontroluje kód: jména tříd, tokeny ani hodnoty vlastností. Bere jen to, co
čte člověk — nadpisy, odstavce, popisky, texty v SVG, alt a title — a k tomu
české komentáře, protože ty čte taky člověk.

Spouští se nad zdrojem s otazníky místo písem a obrázků:
    python3 cesky-check.py page.src.html
"""
import re
import sys
import unicodedata

# ---------------------------------------------------------------- co hledáme

# Anglicismus, pro který čeština má běžné slovo. Dvojice (vzor, čím nahradit).
ANGLICISMY = [
    (r"\btalk(u|em|y)?\b", "přednáška"),
    (r"\bslid[ey]?\b", "snímek"),
    (r"\bscreenshot\w*\b", "snímek obrazovky"),
    (r"\bworkflow\b", "postup"),
    (r"\bharness\b", "mantinely"),
    (r"\bfeedback\w*\b", "zpětná vazba"),
    (r"\bbrand(ing|ová|ové|ový)?\b", "značka"),
    (r"\bcontent\w*\b", "obsah"),
    (r"\bmeeting\w*\b", "schůzka"),
    (r"\bdeadline\w*\b", "termín"),
    (r"\bmanuál\w*\b", "příručka"),
    (r"\bimplementac\w*\b", "provedení"),
    (r"\bkonzistenc\w*\b", "jednotnost"),
    (r"\bdeterministick\w*\b", "pokaždé stejně"),
    (r"\borchestrac\w*\b", "řízení"),
    (r"\bvektorizac\w*\b", "?? vysvětlit"),
    (r"\bmetadat\w*\b", "?? vysvětlit"),
    (r"\bartefakt\w*\b", "?? rozhodnout"),
    (r"\bprototyp\w*\b", "?? rozhodnout"),
    (r"\btoken\w*\b", "?? rozhodnout"),
    (r"\bkompetenc\w*\b", "pravomoc"),
    (r"\brelevanc\w*\b", "použitelnost"),
    (r"\brelevantn\w*\b", "použitelný"),
    (r"\bdigitalizac\w*\b", "?? rozhodnout"),
    (r"\bdiskur[zs]\w*\b", "veřejná debata"),
    (r"\bmašineri\w*\b", "?? zvážit"),
    (r"\bbackend\w*\b", "co běží na pozadí"),
    (r"\bfrontend\w*\b", "co je vidět"),
    (r"\bsoftware\w*\b", "program"),
    (r"\bprompt\w*\b", "zadání"),
    (r"\bhover\w*\b", "najetí"),
    (r"\blayout\w*\b", "rozvržení"),
    (r"\bfeature\w*\b", "funkce"),
    (r"\bupdate\w*\b", "aktualizace"),
    (r"\brelease\w*\b", "vydání"),
    (r"\bcloud\w*\b", "?? zvážit"),
    (r"\bkonfigurovateln\w*\b", "nastavitelný"),
    (r"\bstrukturovan\w*\b", "?? zvážit"),
]

# Kalk: české slovo v anglické vazbě.
KALKY = [
    (r"\bdefakto\b", "de facto / vlastně — a nejspíš škrtnout"),
    (r"\bde facto\b", "škrtnout"),
    (r"\bv rámci\b", "při, během, v"),
    (r"\bna bázi\b", "na základě"),
    (r"\bna denní bázi\b", "každý den"),
    (r"\badresovat\b", "řešit, zabývat se"),
    (r"\bdělat rozhodnutí\b", "rozhodovat"),
    (r"\bmít dopad na\b", "ovlivnit"),
    (r"\bje to o tom, že\b", "jde o to, že — nebo rovnou škrtnout"),
    (r"\bza účelem\b", "aby, kvůli"),
    (r"\bz pohledu\b", "podle"),
    (r"\bnastavit očekávání\b", "říct dopředu"),
    (r"\bpokrýt\w* (potřeb|téma)", "?? zvážit vazbu"),
]

# Vata: slovo, které nic nepřidá.
VATA = [
    r"\bvlastně\b", r"\bprostě\b", r"\bv podstatě\b", r"\bjakoby\b",
    r"\bsamozřejmě\b", r"\bjednoduše řečeno\b", r"\bzjednodušeně řečeno\b",
    r"\bnějakým způsobem\b", r"\bdá se říct\b", r"\bde facto\b",
]

# Typografie a interpunkce.
TYPO = [
    (r'(?<![=<>/])"[^"]{2,}"', "anglické uvozovky — patří „takto“"),
    (r"\.\.\.", "tři tečky — patří …"),
    (r"\b\d{4,}\b(?<!\b(?:19|20)\d\d)", "číslo nad tisíc bez mezery — 12 378"),
    (r"(?<![-–—\w])\s-\s", "spojovník místo pomlčky – nebo —"),
    (r"\b[ksvzaiou] [A-Za-zÁ-Žá-ž]", "jednopísmenná předložka bez pevné mezery"),
]

# Zdomácnělá slova, u kterých by náhrada zněla křečovitě, a úřední termíny,
# které se jinak nejmenují. Rozhodnuto 4. 9. 2026; kdo to bude chtít změnit,
# ať to změní tady a ne potichu v textu.
# O těchhle třech rozhodl majitel 4. 9. 2026, když jsem mu je přeložil:
# vizuál ne na grafiku, design systém ne na designový, konzistentně ne na
# pokaždé stejně. Je to pracovní slovník oboru a jeho stránka.
ZDOMÁCNĚLÉ = [
    "vizuál", "design systém", "konzistentn",
    "marketér", "marketérka", "marketérce",
    "kampaň", "kampaně", "kampani",
    "generátor", "generátoru",
    "kvalifikovaný podpis", "kvalifikovaným podpisem",
    "prototyp",
]

# Výrazy, které se nepřekládají a nesmí spustit poplach.
NEDOTKNUTELNÉ = [
    "ABC Normal", "volocal.app", "GitHub", "ERP", "prefers-reduced-motion",
    "Payload", "hasOfferCatalog", "Figma",
] + ZDOMÁCNĚLÉ


def viditelny_text(html: str) -> list[tuple[int, str]]:
    """Vrátí (číslo řádku, text) pro každý kus, který čte člověk."""
    # pryč se skriptem a stylem, ale české komentáře v CSS si necháme
    bez_skriptu = re.sub(r"<script\b.*?</script>", " ", html, flags=re.S)
    styl = re.findall(r"<style\b.*?</style>", html, flags=re.S)
    komentare = []
    for blok in styl:
        komentare += re.findall(r"/\*(.*?)\*/", blok, flags=re.S)
    bez_stylu = re.sub(r"<style\b.*?</style>", " ", bez_skriptu, flags=re.S)
    komentare += re.findall(r"<!--(.*?)-->", bez_stylu, flags=re.S)
    bez_komentaru = re.sub(r"<!--.*?-->", " ", bez_stylu, flags=re.S)

    kusy: list[tuple[int, str]] = []
    for m in re.finditer(r'(?:alt|aria-label|title)="([^"]+)"', bez_komentaru):
        kusy.append((html[: m.start()].count("\n") + 1, m.group(1)))
    bez_znacek = re.sub(r"<[^>]+>", "\n", bez_komentaru)
    for i, radek in enumerate(bez_znacek.split("\n"), 1):
        t = radek.strip()
        if t:
            kusy.append((i, t))
    for k in komentare:
        for radek in k.split("\n"):
            t = radek.strip()
            if t:
                kusy.append((0, t))
    return kusy


def cisty(text: str) -> str:
    """Vyhodí z textu to, co se nepřekládá, ať to nespouští poplach."""
    for slovo in NEDOTKNUTELNÉ:
        text = re.sub(re.escape(slovo), " ", text, flags=re.I)
    return text


def hledej(kusy, pravidla, znacka, s_navrhem=True):
    nalezy = []
    for radek, text in kusy:
        t = cisty(text)
        for polozka in pravidla:
            vzor, navrh = polozka if s_navrhem else (polozka, "")
            for m in re.finditer(vzor, t, flags=re.I):
                nalezy.append((znacka, radek, m.group(0), navrh, text[:110]))
    return nalezy


def main() -> int:
    cesta = sys.argv[1] if len(sys.argv) > 1 else "page.src.html"
    html = open(cesta, encoding="utf-8").read()
    # Entita se rozepíše na znak, který znamená: &nbsp; je pevná mezera,
    # ne obyčejná. Dokud tady stála obyčejná, kontrola si vyčítala mezery,
    # které v textu pevné jsou.
    html = html.replace("&nbsp;", "\u00a0").replace("&amp;", "&")
    kusy = viditelny_text(html)

    nalezy = []
    nalezy += hledej(kusy, ANGLICISMY, "anglicismus")
    nalezy += hledej(kusy, KALKY, "kalk")
    nalezy += hledej(kusy, VATA, "vata", s_navrhem=False)
    # v SVG a v komentářích se pevná mezera neuplatní: text v <text> se
    # nezalamuje a komentář se nesází
    bez_svg = re.sub(r"<svg\b.*?</svg>", " ", html, flags=re.S)
    bez_svg = re.sub(r"<title>.*?</title>", " ", bez_svg, flags=re.S)
    kusy_sazene = [k for k in viditelny_text(bez_svg) if k[0]]
    nalezy += hledej(kusy_sazene, TYPO, "typografie")

    # jeden výskyt slova hlásíme jednou, s počtem
    podle_slova: dict[tuple[str, str], list] = {}
    for znacka, radek, nalez, navrh, kontext in nalezy:
        klic = (znacka, unicodedata.normalize("NFC", nalez.lower()))
        podle_slova.setdefault(klic, []).append((radek, navrh, kontext))

    if not podle_slova:
        print("Čisté: žádný anglicismus, kalk, vata ani anglická typografie.")
        return 0

    poradi = {"anglicismus": 0, "kalk": 1, "vata": 2, "typografie": 3}
    for (znacka, slovo), vyskyty in sorted(
        podle_slova.items(), key=lambda p: (poradi[p[0][0]], -len(p[1]), p[0][1])
    ):
        navrh = next((n for _, n, _ in vyskyty if n), "")
        kolik = len(vyskyty)
        hlava = f"{znacka:12} {slovo!r} ×{kolik}"
        print(f"{hlava}{'  → ' + navrh if navrh else ''}")
        for radek, _, kontext in vyskyty[:3]:
            misto = f"ř. {radek}" if radek else "komentář"
            print(f"{'':14}{misto}: {kontext}")
        if kolik > 3:
            print(f"{'':14}… a další {kolik - 3}")
    print(f"\nCelkem {sum(len(v) for v in podle_slova.values())} nálezů "
          f"v {len(podle_slova)} různých výrazech.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
