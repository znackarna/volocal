/** Captions for work in progress, reported by the Rust side.
 *
 *  Rust returns a stable `code` plus optional parameters. A phase that has no
 *  entry here falls back to the technical text that came with it, exactly like
 *  the failure messages in `errors`.
 */
export const csProgress = {
  // Transcription.
  "progress.preparation.converting_audio": "Převádím zvuk",
  "progress.playback.preparing": "Připravuji přesné přehrávání",
  "progress.transcription.running": "Přepisuji",
  "progress.transcription.cancelled": "Přepis přerušen",
  "progress.transcription.complete": "{count} úseků",
  "progress.saving": "Ukládám",

  // Telling speakers apart.
  "progress.diarization.preparing_audio": "Připravuji zvuk",
  "progress.diarization.running": "Rozpoznávám mluvčí",
  "progress.diarization.complete": "{count} mluvčích",

  // Language editing.
  "progress.ai.preparing_model": "Připravuji jazykový model",
  "progress.ai.preparing_summary": "Připravuji shrnutí",
  "progress.ai.preparing_translation": "Připravuji překlad",
  "progress.ai.loading_model": "Načítám jazykový model do paměti",
  "progress.ai.editing_chunk": "Upravuji část {index} z {total}",
  "progress.ai.translating_chunk": "Překládám část {index} z {total}",
  "progress.ai.reviewing_chunk": "Kontroluji češtinu v části {index} z {total}",
  "progress.ai.reading_chunk": "Čtu část {index} z {total}",
  "progress.ai.summarizing": "Sestavuji celkové shrnutí",
  "progress.ai.summarizing_source": "Sestavuji shrnutí v původním jazyce",
  "progress.ai.translating_summary": "Překládám hotové shrnutí do češtiny",
  "progress.ai.reviewing_summary": "Kontroluji češtinu ve shrnutí",
  "progress.ai.document_ready": "Vylepšený přepis je připravený",
  "progress.ai.summary_ready": "Shrnutí je připravené",
  "progress.ai.translation_ready": "Překlad je připravený",
  "progress.ai.cancelled": "Úprava byla zrušena",

  // Downloading modules.
  "progress.download.connecting": "Navazuji spojení",
  "progress.download.extracting": "Rozbaluji",
  "progress.download.cancelled": "Zrušeno",

  // Import from a web link.
  "progress.online_import.preparing_downloader": "Připravuji stahování z webu",
  "progress.online_import.preparing_javascript": "Připravuji podporu YouTube",
  "progress.online_import.reading_info": "Načítám informace o videu",
  "progress.online_import.downloading": "Stahuji zvuk",
  "progress.online_import.downloading_speed": "Stahuji zvuk · {speed}",
  "progress.online_import.downloading_eta": "Stahuji zvuk · zbývá {eta}",
  "progress.online_import.downloading_speed_eta": "Stahuji zvuk · {speed} · zbývá {eta}",
  "progress.online_import.converting": "Převádím stažený zvuk",
  "progress.online_import.complete": "Nahrávka je připravená",
} as const;

export const csProgressContext: Partial<Record<keyof typeof csProgress, string>> = {
  "progress.preparation.converting_audio":
    "První krok přepisu: zvuk se převádí do podoby, kterou Whisper umí přečíst. První osoba, průběhový tvar.",
  "progress.playback.preparing":
    "U dlouhých MP3 se připravuje kopie, ve které jde přesně skákat na slovo.",
  "progress.transcription.complete":
    "{count} je počet úseků hotového přepisu. Zobrazuje se místo popisu fáze, když je práce hotová.",
  "progress.saving": "Poslední krok: hotový přepis se zapisuje do archivu.",
  "progress.diarization.running":
    "„Rozpoznávám mluvčí“ = program hledá, kdo zrovna mluví. Průběhový tvar, první osoba.",
  "progress.diarization.complete": "{count} je počet rozpoznaných mluvčích.",
  "progress.ai.editing_chunk":
    "Dlouhý přepis se upravuje po částech. {index} je pořadí právě zpracované části, {total} jejich celkový počet.",
  "progress.ai.reviewing_chunk":
    "Po překladu do češtiny se každá část ještě čte znovu a opravují se kalky a pády.",
  "progress.ai.translating_summary":
    "Shrnutí vzniklo v jazyce nahrávky a teď se překládá do češtiny.",
  "progress.ai.cancelled": "Uživatel jazykovou úpravu sám zastavil. Není to chyba.",
  "progress.download.connecting":
    "Krátký popis prvního okamžiku stahování, než přijdou první data.",
  "progress.download.cancelled": "Stahování zastavil uživatel.",
  "progress.online_import.downloading_speed":
    "{speed} je rychlost stahování ve tvaru, jaký vypíše yt-dlp, například „1.20MiB/s“. Nepřekládá se.",
  "progress.online_import.downloading_eta":
    "{eta} je zbývající čas ve tvaru, jaký vypíše yt-dlp, například „00:12“. Nepřekládá se.",
};
