/** Names and descriptions of the modules that can be downloaded.
 *
 *  Rust owns the catalogue but not its wording: it sends the identifier of
 *  each item and the key that belongs to it. The keys are `catalog.<id>.name`
 *  and `catalog.<id>.description`, where `<id>` is the identifier the two
 *  sides agree on and which must never be translated.
 */
export const csCatalog = {
  // Programs.
  "catalog.whisper-vulkan.name": "Přepis na grafické kartě",
  "catalog.whisper-vulkan.description": "Funguje na AMD, Intel i NVIDIA.",
  "catalog.whisper-cpu.name": "Přepis na procesoru",
  "catalog.whisper-cpu.description": "Záložní varianta pro počítače bez použitelné grafiky.",
  "catalog.whisper-cuda.name": "Přepis na kartě NVIDIA",
  "catalog.whisper-cuda.description":
    "Na kartách NVIDIA znatelně rychlejší než Vulkan. Velký kvůli knihovnám.",
  "catalog.ffmpeg.name": "Zpracování zvuku",
  "catalog.ffmpeg.description": "Připraví zvuk pro přepis. Bez něj to nepoběží.",
  "catalog.yt-dlp.name": "Online videa",
  "catalog.yt-dlp.description": "Stáhne zvuk z YouTube a dalších podporovaných webů.",
  "catalog.deno.name": "JavaScript pro online videa",
  "catalog.deno.description": "Řeší ověření YouTube při stahování zvuku.",

  // Transcription models.
  "catalog.vad.name": "Detekce řeči",
  "catalog.vad.description":
    "Vynechá ticho a šum. Bez ní se přepis na začátku zasekne v opakování.",
  "catalog.model-turbo.name": "Rychlý model",
  "catalog.model-turbo.description": "Několikanásobně rychlejší. Volba pro slabší počítače.",
  "catalog.model-large-q5.name": "Vyvážený model",
  "catalog.model-large-q5.description": "Kvalita skoro jako nejvyšší, třetinová velikost.",
  "catalog.model-large.name": "Přesný model",
  "catalog.model-large.description": "Nejpřesnější čeština. Vyplatí se na výkonném počítači.",

  // Language editing.
  "catalog.editor-vulkan.name": "Jazyková úprava na grafické kartě",
  "catalog.editor-vulkan.description": "Lokální llama.cpp pro AMD, Intel i NVIDIA přes Vulkan.",
  "catalog.editor-cpu.name": "Jazyková úprava na procesoru",
  "catalog.editor-cpu.description":
    "Univerzální varianta pro počítače bez podporované grafiky.",
  // Modely, které dělají touž práci s různým počtem parametrů. Co která z nich
  // umí navíc, nikdo neměřil, takže se to tady netvrdí: názvem je velikost a
  // v popisu jméno modelu s nároky, které z té velikosti plynou.
  //
  // A name here is read with nothing around it — `Stahuji {name}`, a row in the
  // by-hand list, a line in the failed-items list — so it has to say what the
  // thing is. `Stahuji Větší` is a sentence with a hole in it. The short labels
  // `Menší` and `Větší` belong to the cards on `Jazyková úprava`, where the
  // heading supplies the noun, and live in the settings dictionary.
  "catalog.editor-model-light.name": "Menší model jazykové úpravy",
  "catalog.editor-model-light.description":
    "Gemma 4 E2B. Potřebuje nejmíň paměti a je hotová dřív.",
  "catalog.editor-model-balanced.name": "Střední model jazykové úpravy",
  "catalog.editor-model-balanced.description":
    "Gemma 4 E4B. Aplikace ho sama nenabízí; funguje, pokud ho už v počítači máte.",
  "catalog.editor-model-best.name": "Větší model jazykové úpravy",
  "catalog.editor-model-best.description":
    "Gemma 4 12B. Dělá totéž s víc parametry a potřebuje na to víc paměti i času.",

  // Telling speakers apart.
  "catalog.model-hlasy.name": "Rozpoznání hlasů",
  "catalog.model-hlasy.description": "Spojí stejný hlas napříč celou nahrávkou.",
} as const;

export const csCatalogContext: Partial<Record<keyof typeof csCatalog, string>> = {
  "catalog.whisper-vulkan.name":
    "Položka ke stažení. Vulkan je rozhraní grafické karty; názvy AMD, Intel a NVIDIA se nepřekládají.",
  "catalog.whisper-cpu.name": "Položka ke stažení. Varianta přepisu, která běží jen na procesoru.",
  "catalog.ffmpeg.name":
    "Položka ke stažení — program ffmpeg. Název programu se v seznamu nezobrazuje, jen tenhle popis.",
  "catalog.vad.name":
    "Položka ke stažení. VAD najde v nahrávce místa, kde se skutečně mluví, a ticho vynechá.",
  "catalog.model-turbo.name":
    "Položka ke stažení — přepisovací model. Jméno rodiny modelů (large-v3-turbo) se v názvu neuvádí schválně.",
  "catalog.model-large.description":
    "„Nejpřesnější čeština“ platí pro české nahrávky; u jiných jazyků je model taky nejlepší z nabízených.",
  "catalog.editor-model-light.name":
    "Položka ke stažení. Objevuje se i ve větě „Stahuji {name}“, takže musí " +
    "sama o sobě říct, co to je — proto celé sousloví, ne jen „Menší“. Modely " +
    "jazykové úpravy se jmenují podle velikosti, ne podle kvality; o jejich " +
    "výstupu není nic změřeno.",
  "catalog.editor-model-light.description":
    "Gemma 4 E2B je název modelu a nepřekládá se. „Hotová dřív“ plyne z počtu " +
    "parametrů, ne z měření — porovnané ty modely nikdy nebyly.",
  "catalog.editor-model-balanced.name":
    "Prostřední velikost. Aplikace ji nikde nenabízí; název je potřeba pro " +
    "počítače, kde už ten model je.",
  "catalog.editor-model-best.name":
    "Větší z dvou nabízených modelů jazykové úpravy. Taky se objevuje ve větě " +
    "„Stahuji {name}“, proto celé sousloví.",
  "catalog.editor-model-balanced.description":
    "Gemma 4 E4B je název modelu. Tenhle model aplikace nikde nenabízí, jen " +
    "ho umí použít, když ho uživatel má z dřívějška.",
  "catalog.editor-model-best.description":
    "Gemma 4 12B je název modelu. „Víc parametrů“ je velikost modelu, ne lepší " +
    "výsledek — to nikdo neměřil.",
  "catalog.model-hlasy.name":
    "Identifikátor položky zůstal český z historických důvodů, název se překládá normálně.",
};
