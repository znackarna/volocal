# Složky v archivu — co by to potřebovalo

Analýza před stavbou. Vychází ze skutečného kódu, ne z odhadu: čísla řádků
odkazují na dnešní stav.

---

## 1. Jedno rozhodnutí, ze kterého plyne skoro všechno ostatní

**Zmizí nahrávka vložená do složky z hlavního výpisu?**

- **Ano** (model souborového správce). Nahrávka je právě na jednom místě.
  Složka pak něco *skutečně uklidí* — což je celý smysl kategorií.
- **Ne** (model štítků). Složka je jen pohled navíc, výpis zůstává úplný.
  Nic se neuklidí, ale nic se ani neztratí z očí.

Doporučuju **ano**. Odpovídá to tvému zadání („vytvoří složku a vloží do ní
záznam") a je to jediná varianta, kde má složka viditelný přínos. Ale nese to
jeden důsledek, který se musí ošetřit — viz 5.2, hledání.

---

## 2. Data

Nová tabulka a jeden sloupec. Schéma zůstává české, jak vyžaduje
`ARCHITECTURE.md` (řádek 59).

```sql
CREATE TABLE IF NOT EXISTS slozky (
    id        TEXT PRIMARY KEY,
    nazev     TEXT NOT NULL,
    vytvoreno TEXT NOT NULL
);

ALTER TABLE nahravky ADD COLUMN slozka TEXT
    REFERENCES slozky(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` dává variantu „smazat jen složku" **zadarmo a atomicky** —
nahrávky se samy vrátí do kořene. Varianta „smazat i s obsahem" je pak
explicitní smyčka přes `db::delete_recording` v jedné transakci.

Migrace patří do `migrate_legacy_schema` (`db.rs:572`) jako řádek
`ALTER TABLE …` vedle ostatních — u existujícího archivu prostě selže a nic
se nestane. `Recording` (`db.rs:13`) dostane `pub folder: Option<String>`,
`SELECT` na `db.rs:835` jeden sloupec navíc.

**Vnořené složky ne.** Jedna úroveň. Vnoření by přineslo strom, drobečkovou
navigaci a přesouvání složek do složek — pro „kategorie kázání" zbytečné.
Kdyby to jednou bylo potřeba, přidat `rodic` do `slozky` je malá změna;
navrhnout UI kolem toho je ta velká.

## 3. Backend

Pět příkazů, všechny triviální vedle toho, co v `main.rs` už je:

| příkaz | co dělá |
|---|---|
| `folders()` | seznam složek + počet nahrávek a součet délek (jeden `GROUP BY`) |
| `create_folder(name)` | vytvoří, vrátí ji |
| `rename_folder(id, name)` | přejmenuje |
| `move_to_folder(ids, folder)` | `folder = null` znamená vyjmout; bere pole, ať jde i dávka |
| `delete_folder(id, contents)` | `contents=false` → jen `DELETE FROM slozky`; `true` → napřed nahrávky přes stávající `delete_recording` (kvůli úklidu playback-cache), pak složku |

Zálohy a přenosná kopie fungují samy — je to všechno uvnitř `whisp.db`.

## 4. UI

### 4.1 Karta složky

Stejně vysoký blok jako přepis, jak jsi psal. Místo kalendáře ikona složky ve
„složkové" barvě, místo metadat počet přepisů a součet délek (stejné ikony
`layers` a `clock`, které karta nahrávky už používá). Vlastní menu se třemi
položkami: *Přejmenovat*, *Smazat*, případně *Otevřít*.

Potřebuje i kompaktní podobu — archiv má dva režimy výpisu a přepínač je
uložený.

### 4.2 Kam se karty dají

Podle tebe **pod výpis přepisů**. Udělám to tak, ale říkám nahlas, co to
znamená: při deseti a víc přepisech budou složky pod přehybem a člověk je
uvidí až po odrolování. Obvyklé pořadí je opačné. Je to jeden řádek kódu, dá
se otočit kdykoli.

### 4.3 Vstup do složky

Kliknutí složku **otevře** — výpis se vymění za její obsah, nahoře přibude
řádek `← Archiv / Kázání` a `Nový přepis` v ní zakládá rovnou do ní.
Alternativa (rozbalení na místě) vypadá lákavě, ale u dvaceti nahrávek ve
složce rozbije rytmus výpisu a nedá se v tom hledat.

### 4.4 Tři dialogy, jak jsi chtěl

1. **Nová složka** — jedno pole, `Vytvořit`. Prázdný a duplicitní název
   odmítnout hned pod polem, ne až chybovou hláškou nahoře.
2. **Vložit do složky** — v menu nahrávky. Menu už umí podnabídku (dělá to
   volba jazyka, `RecordingActionsMenu.tsx`), takže: seznam složek +
   `Nová složka…` a u nahrávky, která už ve složce je, navíc `Vyjmout`.
   Podnabídka stačí, samostatný dialog by tu byl navíc.
3. **Smazat složku** — dvě tlačítka, ne přepínač:
   `Smazat jen složku` (nahrávky se vrátí do archivu) a
   `Smazat i s přepisy` v destruktivní barvě. Druhé projde stávajícím
   potvrzením a řekne počet: „Přijdeš o 7 přepisů. Zvukové soubory na disku
   zůstanou." — což je pravda, `delete_recording` soubor nemaže.

## 5. Co se to dotkne (tahle část je ta podstatná)

### 5.1 Filtry a řazení — `Library.tsx:481`

`visibleRecordings` dnes filtruje podle data a řadí. Ve složkovém světě musí
napřed vybrat *úroveň* (kořen nebo otevřená složka). A hlavně: **když je
zapnutý filtr nebo hledání, složky nedávají smysl** — člověk hledá nahrávku,
ne místo, kam ji uložil. Návrh: při aktivním hledání nebo datovém filtru
ukázat plochý seznam napříč všemi složkami, karty složek schovat a doplnit u
každého výsledku jméno složky.

### 5.2 Hledání — `Library.tsx:510`, past

Tohle je jediné místo, kde by se to dalo tiše rozbít.
`visibleResults` protíná výsledky s `visibleRecordings`:

```ts
const positions = new Map(visibleRecordings.map((r, i) => [r.id, i]));
return results.filter((result) => positions.has(result.recording_id))
```

Kdyby `visibleRecordings` obsahoval jen kořen, **fulltext by přestal nacházet
všechno ve složkách** — a nijak by to neřekl. Musí se protínat s úplným
seznamem, ne s viditelnou úrovní. Píšu to sem, protože je to přesně ten druh
chyby, která se objeví až za měsíc.

### 5.3 Co přichází zvenčí

Sledovaná složka, přetažení souboru do okna, nový záznam z mikrofonu, import
odkazu — všechno padá do kořene. To je správně; jediná otázka je, jestli má
`Nový přepis` **uvnitř otevřené složky** zakládat do ní (viz 4.3, myslím že
ano).

### 5.4 Patička

`archiveFooterStatus` (`App.tsx:609`) počítá přes všechny nahrávky, takže
zůstává správná i po zavedení složek. Uvnitř otevřené složky by měla mluvit o
ní — jinak řekne číslo, které na obrazovce neodpovídá ničemu.

### 5.5 Prázdné stavy

Prázdná složka a archiv, kde jsou jen složky, potřebují každý svou větu.

## 6. Co bych do první verze nedával

- **Přetahování nahrávky na složku.** Vypadá to samozřejmě, ale znamená to
  HTML5 drag & drop uvnitř okna, který se pere s tím, jak okno už teď přijímá
  soubory z Průzkumníka. Menu stačí a je hned. Přidat se dá potom.
- **Barvy a ikony jednotlivých složek.** Až bude jasné, jestli jich vůbec
  vznikne víc než pět.
- **Přesun složky do složky.** Viz vnořování.

## 7. Otevřené otázky

1. **Barva.** Poznámky v postranním panelu už jsou papírově žluté. Složky a
   poznámky se nikdy nepotkají na jedné obrazovce, takže stejnou žlutou lze
   použít i tady. Nebo dát složkám vlastní, o něco teplejší manilový odstín.
2. **Řazení složek mezi sebou** — podle názvu, nebo podle poslední změny?
   Myslím podle názvu; složky se nepřidávají často.
3. **Smazání poslední nahrávky ze složky** složku nemaže. Souhlas?

## 8. Rozsah

Odhadem: schéma a pět příkazů s testy je menší půlka; větší je výpis, protože
se dotkne úrovní, filtrů, hledání, obou režimů výpisu a patičky. Není v tom
nic riskantního — jediné dvě místa, kde se dá něco ztratit, jsou mazání
složky (ošetřeno dvěma explicitními variantami) a hledání (5.2).
