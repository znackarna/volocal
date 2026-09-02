/** Messages for failures reported by the Rust side.
 *
 *  Rust returns a stable `code` plus optional parameters; the interface looks
 *  the code up here. A code with no entry falls back to the detail text that
 *  came with it, so a new backend failure is never shown as a blank message.
 */
export const csErrors = {
  // Missing programs and models, reported by the tool check.
  "errors.tools.ffmpeg_missing_in": "Ve složce nástrojů ({directory}) chybí ffmpeg.",
  "errors.tools.ffprobe_missing_in":
    "Ve složce nástrojů ({directory}) chybí ffprobe, který chodí s ffmpegem.",
  "errors.tools.whisper_missing_in": "Ve složce nástrojů ({directory}) chybí whisper-cli.exe.",
  "errors.tools.whisper_model_missing": "Chybí model ggml-{model}.bin ve složce modelů.",
  "errors.tools.vad_model_missing":
    "Chybí Silero VAD model. Bez něj Whisper na tichu halucinuje.",
  "errors.tools.embedding_model_missing": "Chybí model pro rozpoznání hlasů.",
  "errors.tools.editor_program_missing": "Chybí program pro místní jazykovou úpravu.",
  "errors.tools.editor_server_missing": "Chybí lokální server pro jazykovou úpravu.",
  "errors.tools.editor_model_missing": "Chybí model jazykové úpravy {model}.",
  "errors.tools.ffmpeg_missing": "Chybí ffmpeg",
  "errors.tools.model_missing": "Chybí model",

  // Transcription.
  "errors.transcription.still_running": "Počkejte, až doběhne přepis.",
  "errors.transcription.audio_conversion_failed": "Převod zvuku selhal: ffmpeg selhal: {reason}",
  "errors.transcription.whisper_launch_failed": "Nepodařilo se spustit whisper-cli",
  "errors.transcription.whisper_failed": "whisper-cli skončil s chybou (kód {code})",
  "errors.transcription.no_output_file":
    "Whisper doběhl, ale výstupní soubor nenapsal. V pracovní složce zůstalo: {contents}",
  "errors.transcription.no_output_file_empty":
    "Whisper doběhl, ale výstupní soubor nenapsal. V pracovní složce zůstalo: nic",
  "errors.transcription.empty_result":
    "Whisper nevrátil žádný text. Zkontrolujte, že v nahrávce je slyšet řeč.",
  "errors.transcription.interrupted":
    "Přepis byl přerušen — aplikace se zavřela dřív, než skončil.",

  // A failure with no code of its own: the technical text is all there is.
  // Same treatment as the two benchmark codes — show it rather than a
  // sentence we would have to invent.
  "errors.unknown": "{detail}",

  // Transcribing one part of a recording again.

  // Telling speakers apart.
  "errors.diarization.not_transcribed": "Nahrávka ještě není přepsaná.",
  "errors.diarization.launch_failed":
    "Rozpoznání mluvčích se nepodařilo spustit: {detail}",
  "errors.diarization.audio_unreadable":
    "Připravený zvuk se nepodařilo přečíst. Zkuste rozpoznání spustit znovu.",

  // Files and recordings.
  "errors.file.not_found": "Soubor neexistuje: {path}",
  "errors.file.write_failed": "Zápis selhal: {detail}",
  "errors.file.same_file": "Výřez by přepsal samotnou nahrávku. Vyberte jiné místo.",
  "errors.clip.audio_failed": "Zvuk výřezu se nepodařilo vyříznout: {reason}",
  "errors.recording.path_not_found": "Takový soubor neexistuje.",
  "errors.note.empty": "Poznámka nemůže být prázdná.",
  "errors.note.invalid_time": "Čas poznámky není platný.",

  // Watched folder.
  "errors.import.copy_failed": "Nahrávku se nepodařilo zkopírovat do složky: {detail}",
  "errors.watch_folder.disabled": "Sledovaná složka není zapnutá.",
  "errors.watch_folder.not_available": "Sledovaná složka není dostupná: {path}",
  "errors.watch_folder.file_gone": "Soubor už není dostupný: {name}",
  "errors.watch_folder.file_outside": "Soubor neleží přímo ve sledované složce: {name}",
  "errors.watch_folder.file_changed": "Soubor se mezitím změnil: {name}",
  "errors.watch_folder.scan_interrupted": "Kontrola sledované složky se přerušila: {detail}",
  "errors.watch_folder.ignore_interrupted": "Ignorování souborů se přerušilo: {detail}",
  "errors.watch_folder.import_interrupted": "Přidání souborů se přerušilo: {detail}",
  "errors.folder.empty_name": "Složka potřebuje název.",
  "errors.folder.duplicate_name": "Složka s tímto názvem už existuje.",
  // The picker opens in the recordings folder, so choosing the source itself is
  // one wrong click rather than a strange thing to do — and both export paths
  // would truncate it.
  "errors.audio_export.same_file":
    "Zvuk nejde uložit přes sám sebe. Vyberte prosím jiný soubor nebo složku.",
  "errors.audio_export.source_missing":
    "Zvukový soubor už na svém místě není, takže není co uložit.",
  "errors.audio_export.failed": "Zvuk se nepodařilo uložit: {detail}",
  "errors.audio_export.unsupported_format":
    "Do této přípony zvuk uložit neumíme. Vyberte MP3, M4A nebo WAV.",
  "errors.audio_export.ffmpeg_missing":
    "Na převod zvuku je potřeba ffmpeg. Doplňte ho v sekci Modely.",
  "errors.microphone.no_audio": "Záznam se nepodařilo přenést. Zkuste to znovu.",
  "errors.microphone.empty": "Záznam je moc krátký na přepis.",
  "errors.microphone.ffmpeg_missing":
    "Pro uložení záznamu chybí ffmpeg. Doplňte ho v sekci Modely.",
  "errors.microphone.save_failed": "Záznam se nepodařilo uložit: {detail}",
  // Names the file, because the take is kept now. Until 17 August 2026 it was
  // deleted before this failure was even noticed, and the sentence spoke about
  // audio that no longer existed.
  "errors.microphone.convert_failed":
    "Záznam se nepodařilo převést do zvukového souboru. Zůstal uložený jako {file}.",

  // Playback.
  "errors.update.install_failed":
    "Aktualizaci se nepodařilo připravit k instalaci. Zkuste to prosím znovu.",
  "errors.playback.ffmpeg_missing":
    "Chybí ffmpeg, takže nejde připravit přesné přehrávání MP3.",
  "errors.playback.source_missing": "Zvukový soubor už na svém místě není.",
  // Vzorkování jazyků nemá co s čím porovnat, dokud přepis neexistuje.
  "errors.second_language.no_transcript":
    "Nahrávka zatím nemá přepis, se kterým by šlo jazyky porovnat.",
  "errors.second_language.interrupted": "Doplnění dalšího jazyka se přerušilo.",
  "errors.second_language.same_as_first":
    "Druhý jazyk musí být jiný než ten, kterým je nahrávka přepsaná.",
  "errors.second_language.nothing_offered":
    "U této nahrávky se žádný další jazyk nenašel.",
  "errors.playback.conversion_failed": "Nepodařilo se připravit přesné přehrávání: {reason}",
  "errors.playback.preparation_interrupted": "Příprava přehrávání selhala: {detail}",

  // Import from a web link.
  "errors.online_import.already_running": "Jeden online import už probíhá",
  "errors.online_import.interrupted": "Online import se přerušil: {detail}",
  "errors.online_import.cancelled": "Online import byl zrušen",
  "errors.online_import.invalid_url": "Odkaz není platná webová adresa",
  "errors.online_import.unsupported_scheme": "Použijte odkaz začínající http:// nebo https://",
  "errors.online_import.credentials_in_url": "Odkaz nesmí obsahovat přihlašovací údaje",
  "errors.online_import.downloader_setup_failed":
    "Nepodařilo se připravit podporu online videí",
  "errors.online_import.javascript_setup_failed":
    "Nepodařilo se připravit JavaScript pro online videa",
  "errors.online_import.ffmpeg_missing": "Chybí ffmpeg pro převod staženého zvuku",
  "errors.online_import.ffmpeg_path_invalid": "Cesta k ffmpegu nemá nadřazenou složku",
  "errors.online_import.directory_failed": "Nepodařilo se vytvořit složku pro online nahrávku",
  "errors.online_import.launch_failed": "Nepodařilo se spustit stahování online videa",
  "errors.online_import.stderr_unavailable": "Nepodařilo se číst chyby stahování",
  "errors.online_import.stdout_unavailable": "Nepodařilo se číst průběh stahování",
  "errors.online_import.status_unavailable": "Nepodařilo se zjistit stav online importu",
  "errors.online_import.download_failed": "Online video se nepodařilo stáhnout",
  "errors.online_import.download_failed_details":
    "Online video se nepodařilo stáhnout:\n{details}",
  "errors.online_import.no_media_file": "Stahování skončilo, ale zvukový soubor nebyl nalezen",

  // Downloading modules.
  "errors.download.unknown_component": "Neznámý modul: {component}",
  // Said by one command only: deleting a component while the installer is
  // writing into the same folders. It was `already_running` and it was the
  // refusal of a second download as well — that refusal is a queue now, so
  // the key says what the one remaining caller means by it.
  "errors.download.busy_installing": "Během stahování nejde nic mazat. Zkuste to prosím, až doběhne.",
  "errors.download.component_busy": "Právě se používá. Až práce skončí, půjde smazat.",
  "errors.download.cannot_remove":
    "Aplikace neví, které soubory k této součásti patří. Po opětovném stažení " +
    "ji smazat půjde.",
  "errors.download.remove_failed": "Smazat se nepodařilo: {detail}",
  "errors.download.cancelled": "Zrušeno",
  // Řádek archivu, který se nepodařilo přečíst. Dřív takový záznam tiše zmizel
  // ze seznamu, což čtenář může pochopit jedině jako "někdo to smazal".
  "errors.archive.row_unreadable":
    "Tento záznam se nepodařilo přečíst z archivu ({id}). Přepis i zvuk mohou být v pořádku; poškozený je řádek, který je popisuje.",
  "errors.download.connection_failed": "Nepodařilo se spojit se serverem {host}: {reason}",
  "errors.download.rejected": "Server odmítl soubor vydat ({status})",
  "errors.download.tar_launch_failed":
    "Nepodařilo se spustit tar (je součástí Windows 10 a novějších)",
  "errors.download.extract_failed": "Rozbalení archivu selhalo",
  "errors.download.hash_mismatch":
    "Stažený soubor {file} neodpovídá tomu, co se čekalo. Nic se neinstalovalo a dosavadní verze zůstala beze změny.",
  "errors.download.unsafe_archive_path":
    "Archiv {archive} se pokusil zapsat mimo určenou složku. Nerozbalil se.",
  "errors.download.archive_without_programs":
    "Archiv {archive} neobsahuje žádný program. Bylo v něm: {contents}",
  "errors.download.archive_without_programs_empty":
    "Archiv {archive} neobsahuje žádný program. Bylo v něm: nic",
  "errors.download.file_not_in_archive":
    "Staženo, ale {file} v archivu není. Programy, které tam byly: {programs}",
  "errors.download.file_not_in_archive_empty":
    "Staženo, ale {file} v archivu není. Programy, které tam byly: žádné",

  // Language editing. The whole sentence used to be prefixed with
  // "Jazyková úprava selhala: " before it reached the window, so each entry
  // carries that opening itself.
  "errors.ai.already_running_here": "Jazyková úprava už probíhá pro tuto nahrávku.",
  "errors.ai.already_running_elsewhere": "Jazyková úprava už probíhá pro jinou nahrávku.",
  "errors.ai.unknown_mode": "Neznámý režim jazykové úpravy.",
  "errors.ai.unknown_output": "Neznámý druh shrnutí nebo překladu.",
  "errors.ai.document_missing": "Vylepšený přepis ještě není vytvořený.",
  "errors.ai.output_missing": "Tento výstup ještě není vytvořený.",
  "errors.ai.unsupported_document_format":
    "Vylepšený přepis lze uložit jen jako TXT nebo Markdown.",
  "errors.ai.unsupported_output_format":
    "Shrnutí a překlad lze uložit jen jako TXT nebo Markdown.",
  "errors.ai.no_model_selected": "Jazyková úprava selhala: není vybraný model jazykové úpravy",
  "errors.ai.transcript_empty": "Jazyková úprava selhala: přepis je prázdný",
  "errors.ai.document_required": "Jazyková úprava selhala: nejdřív vytvořte vylepšený přepis",
  "errors.ai.document_empty": "Jazyková úprava selhala: vylepšený přepis je prázdný",
  "errors.ai.server_missing":
    "Jazyková úprava selhala: chybí llama-server; doplňte modul Jazyková úprava",
  "errors.ai.model_missing": "Jazyková úprava selhala: chybí vybraný model jazykové úpravy",
  "errors.ai.unknown_summary_length": "Jazyková úprava selhala: neznámá délka shrnutí",
  "errors.ai.unknown_translation_language":
    "Jazyková úprava selhala: neznámý cílový jazyk překladu",
  "errors.ai.unknown_output_kind": "Jazyková úprava selhala: neznámý druh jazykového výstupu",
  "errors.ai.empty_prompt": "Napište prosím pokyn, podle kterého má model dokument vytvořit.",
  "errors.ai.prompt_too_long":
    "Pokyn je příliš dlouhý. Vejde se do něj nejvýše {limit} znaků.",
  "errors.ai.server_launch_failed":
    "Jazyková úprava selhala: nelze spustit místní jazykový server",
  "errors.ai.server_exited_while_loading":
    "Jazyková úprava selhala: jazykový server skončil při načítání ({status})",
  "errors.ai.model_load_timeout":
    "Jazyková úprava selhala: načítání jazykového modelu překročilo pět minut",
  "errors.ai.empty_response": "Jazyková úprava selhala: model vrátil prázdný text",
  "errors.ai.answer_truncated":
    "Jazyková úprava selhala: modelu došlo místo dřív, než dokument dopsal. " +
    "Nedopsaný dokument se neukládá, aby nevypadal jako hotový.",
  "errors.ai.server_failed": "Jazyková úprava selhala: jazykový server selhal: {reason}",
  "errors.ai.server_disconnected":
    "Jazyková úprava selhala: spojení s jazykovým serverem se přerušilo",
  "errors.ai.server_exited":
    "Jazyková úprava selhala: jazykový server během úpravy skončil ({status})",
  "errors.ai.cancelled": "Úprava byla zrušena",

  // Speed test.
  "errors.benchmark.no_recording":
    "Přidejte nejdřív nějakou nahrávku — zkouška potřebuje kus skutečného zvuku.",
  "errors.benchmark.clip_failed": "ffmpeg nezvládl vyříznout ukázku",
  "errors.benchmark.unknown_failure": "neznámá chyba",
  // The program's own last line is the whole message here; the dictionary only
  // decides whether anything wraps it. Keeping the entries means every code
  // Rust can emit has one, and the check needs no exceptions.
  "errors.benchmark.backend_failed": "{detail}",
  "errors.benchmark.launch_failed": "{detail}",
  // Replacing the archive, and copying it somewhere it survives this computer.
  // `archive.busy` is the guard the most destructive command in the application
  // did not have: a transcription, a jazyková úprava, an import and a waveform
  // each hold their own connection to the archive file.
  "errors.archive.busy":
    "Teď se s archivem pracuje. Zkuste to prosím, až doběhne přepis nebo jiná rozdělaná práce.",
  "errors.backup.unknown":
    "Tahle záloha ve složce se zálohami není. Zkuste seznam otevřít znovu.",
  "errors.archive.export.onto_itself":
    "Tohle je archiv, se kterým aplikace právě pracuje. Vyberte jiné místo nebo jiný název.",
  "errors.archive.import.not_an_archive":
    "Vybraný soubor není archiv Volocalu. Archiv je jediný soubor .db — buď volocal.db, nebo kopie, kterou jste si uložili.",
  "errors.archive.import.from_the_future":
    "Tenhle archiv vznikl v novější verzi Volocalu. Načtením byste přišli o to, co novější verze umí navíc. Aktualizujte aplikaci a zkuste to znovu.",
  "errors.archive.import.itself":
    "Tohle je archiv, se kterým aplikace právě pracuje. Nahrazovat ho jím samotným nedává smysl.",
} as const;

export const csErrorsContext: Partial<Record<keyof typeof csErrors, string>> = {
  "errors.download.component_busy":
    "Odmítnutí, když uživatel chce smazat něco, co aplikace zrovna používá — " +
    "běží přepis, převod zvuku, rozpoznávání mluvčích nebo jazyková úprava. " +
    "Je to **stejná věta jako wizard.manual.lockedBusy**, protože je to jeden " +
    "fakt řečený na dvou místech: v bublině zámku na řádku a tady, když se " +
    "práce rozeběhne mezi vykreslením seznamu a stiskem. Přelož obě stejně.",
  "errors.download.cannot_remove":
    "Odmítnutí u součásti nainstalované dřív, než si aplikace začala zapisovat " +
    "seznam souborů; sdílí složku s ostatními programy, takže bez toho seznamu " +
    "nejde smazat „jen ji“. To všechno je mechanismus a do věty nepatří. " +
    "**Stejná věta jako wizard.manual.lockedUnlisted** — přelož obě stejně. " +
    "Nemluv o chybě, je to hranice, ne porucha.",
  "errors.download.remove_failed":
    "Mazání selhalo na úrovni disku. {detail} je hlášení systému, nepřekládá se.",
  "errors.ai.empty_prompt":
    "Odmítnutí, když má vzniknout dokument podle vlastního pokynu a pokyn není napsaný. " +
    "Prázdný pokyn se modelu neposílá. Tlačítko v okně je v takové chvíli vypnuté; tohle je pojistka.",
  "errors.ai.prompt_too_long":
    "{limit} je největší povolený počet znaků pokynu, číslo. Pokyn se posílá s každou částí " +
    "přepisu, proto má strop.",
  "errors.tools.whisper_model_missing":
    "{model} je název přepisovacího modelu, například large-v3. Soubor se jmenuje ggml-<model>.bin, název souboru nepřekládej.",
  "errors.tools.vad_model_missing":
    "VAD = detekce řeči. Bez ní Whisper na tichých místech vymýšlí text, který nikdo neřekl.",
  "errors.tools.ffmpeg_missing":
    "Krátká zpráva u zkoušky výkonu, ne celá věta. Zobrazuje se v červeném pruhu.",
  "errors.tools.model_missing":
    "Krátká zpráva u zkoušky výkonu. „Model“ tu znamená přepisovací model Whisperu.",
  "errors.transcription.audio_conversion_failed":
    "{reason} je poslední řádek, který vypsal ffmpeg. Je anglicky a nepřekládá se.",
  "errors.transcription.whisper_failed":
    "{code} je návratový kód procesu, číslo. Zobrazuje se v závorce.",
  "errors.transcription.no_output_file":
    "{contents} je seznam názvů souborů oddělených čárkou. Názvy se nepřekládají.",
  "errors.transcription.interrupted":
    "Zapisuje se do archivu, když se aplikace zavřela během přepisu. Uživatel to uvidí u nahrávky ve stavu chyba.",
  "errors.file.write_failed":
    "{detail} je systémová chyba zápisu, anglicky. Zpráva se ukáže při ukládání exportu.",
  "errors.watch_folder.file_gone":
    "{name} je název souboru. Sledovaná složka je adresář, který aplikace pravidelně kontroluje.",
  "errors.watch_folder.scan_interrupted":
    "{detail} je technický popis, proč se vlákno přerušilo. Anglicky.",
  "errors.online_import.unsupported_scheme":
    "http:// a https:// jsou části adresy, nepřekládají se.",
  "errors.download.archive_without_programs":
    "{archive} je název staženého souboru, {contents} seznam toho, co v něm bylo. Nepřekládá se.",
  "errors.download.file_not_in_archive":
    "{file} je cesta k souboru, který se v archivu očekával. Nepřekládá se.",
  "errors.ai.server_missing":
    "„Jazyková úprava“ je modul ke stažení; llama-server je název programu a nepřekládá se.",
  "errors.ai.server_exited_while_loading":
    "{status} je stav, se kterým proces skončil, například „exit code: 1“. Anglicky.",
  "errors.ai.server_failed": "{reason} je hlášení knihovny, anglicky. Nepřekládá se.",
  "errors.ai.cancelled":
    "Ukáže se, když uživatel jazykovou úpravu sám zastaví. Není to chyba.",
  "errors.benchmark.no_recording":
    "Zkouška výkonu potřebuje skutečný zvuk, aby změřila, co je na tomhle počítači rychlejší.",
  "errors.benchmark.unknown_failure":
    "Malé písmeno je záměr: text se vkládá doprostřed věty o nezdařené zkoušce.",
  "errors.backup.unknown":
    "Ukáže se, když seznam záloh na obrazovce už neodpovídá tomu, co je na disku — soubor mezitím zmizel.",
  "errors.archive.export.onto_itself":
    "Uživatel v dialogu pro uložení vybral přímo živý archiv aplikace.",
  "errors.archive.import.not_an_archive":
    "Vybraný soubor neobsahuje tabulky archivu. Typicky se sáhlo vedle — třeba na zálohu jiného programu.",
  "errors.archive.import.from_the_future":
    "Archiv z novější verze. Odmítáme ho místo toho, abychom ho otevřeli a nevědomky z něj odstranili, co neznáme.",
  "errors.archive.import.itself":
    "Uživatel nabídl k načtení ten samý soubor, se kterým aplikace pracuje.",
};
