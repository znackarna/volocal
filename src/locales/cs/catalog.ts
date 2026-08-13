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
  "catalog.editor-model-light.name": "Úsporná jazyková úprava",
  "catalog.editor-model-light.description":
    "Gemma 4 E2B. Interpunkce, věty a odstavce i na CPU.",
  "catalog.editor-model-balanced.name": "Doporučená jazyková úprava",
  "catalog.editor-model-balanced.description":
    "Gemma 4 E4B. Lépe opravuje zjevné chyby a drží souvislosti.",
  "catalog.editor-model-best.name": "Nejlepší jazyková úprava",
  "catalog.editor-model-best.description":
    "Gemma 4 12B. Nejspolehlivější výsledek, na CPU je pomalejší.",

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
  "catalog.editor-model-light.description":
    "Gemma 4 E2B je název modelu a nepřekládá se. CPU = procesor.",
  "catalog.model-hlasy.name":
    "Identifikátor položky zůstal český z historických důvodů, název se překládá normálně.",
};
