//! Everything the screen says in its own words, in Czech and in English.
//!
//! The engine's messages — phases, failures — come from the window's own
//! dictionaries (`common.rs`), so they read exactly as there. What is here is
//! only what the terminal screen alone says. Czech addresses the reader
//! formally, as the window does.

pub use crate::common::Lang;

pub struct Words {
    pub archive: &'static str,
    pub status_title: &'static str,
    pub new_transcription: &'static str,
    pub transcribing: &'static str,
    pub recordings: [&'static str; 3],
    pub speakers: [&'static str; 3],
    pub blocks: [&'static str; 3],
    pub of_sound: &'static str,
    pub of: &'static str,

    // archive
    pub folders: &'static str,
    pub all_recordings: &'static str,
    pub show: &'static str,
    pub filter_all: &'static str,
    pub filter_new: &'static str,
    pub filter_failed: &'static str,
    pub filter_missing: &'static str,
    pub sort: &'static str,
    pub sort_newest: &'static str,
    pub sort_oldest: &'static str,
    pub sort_az: &'static str,
    pub sort_za: &'static str,
    pub search_placeholder: &'static str,
    pub esc_clears: &'static str,
    pub col_title: &'static str,
    pub col_length: &'static str,
    pub col_added: &'static str,
    pub archive_empty: &'static str,
    pub nothing_matches: &'static str,
    pub in_terminal: &'static str,
    pub in_window: &'static str,
    pub failed: &'static str,
    pub not_transcribed: &'static str,

    // reader
    pub no_transcript: &'static str,
    pub go_to_time: &'static str,
    pub no_hits: &'static str,
    pub next: &'static str,
    pub previous: &'static str,
    pub close: &'static str,
    pub info_heading: &'static str,
    pub info_title: &'static str,
    pub info_file: &'static str,
    pub info_added: &'static str,
    pub info_length: &'static str,
    pub info_language: &'static str,
    pub info_model: &'static str,
    pub info_blocks: &'static str,
    pub info_source: &'static str,
    pub source_missing: &'static str,

    // new transcription
    pub sheet_sentence: &'static str,
    pub file: &'static str,
    pub drop_here: &'static str,
    pub complete: &'static str,
    pub language: &'static str,
    pub speakers_label: &'static str,
    pub model: &'static str,
    pub set_in_app: &'static str,
    pub as_in_app: &'static str,
    pub recognise_language: &'static str,
    pub speakers_unknown: &'static str,
    pub start_transcription: &'static str,
    pub cancel: &'static str,
    pub waiting_for_window: &'static str,
    pub waiting_why: &'static str,
    pub live_transcript: &'static str,
    pub stopped_kept: &'static str,
    pub stopped_lost: &'static str,
    pub fill_in: &'static str,
    pub leave_it: &'static str,
    pub transcript_start: &'static str,
    pub already_running: &'static str,
    pub stopping: &'static str,

    // export
    pub save_how: &'static str,
    pub save_several: &'static str,
    pub format_txt: &'static str,
    pub format_txt_note: &'static str,
    pub format_md: &'static str,
    pub format_md_note: &'static str,
    pub format_srt: &'static str,
    pub format_srt_note: &'static str,
    pub format_vtt: &'static str,
    pub format_vtt_note: &'static str,
    pub format_json: &'static str,
    pub format_json_note: &'static str,
    pub format_audio: &'static str,
    pub format_audio_note: &'static str,
    pub only_audio: &'static str,
    pub save_to: &'static str,
    pub files_named: &'static str,
    pub saved: &'static str,
    pub converting_audio: &'static str,
    // playback
    pub preparing_sound: &'static str,
    pub no_sound_device: &'static str,
    pub sound_failed: &'static str,
    pub sound_no_ffmpeg: &'static str,
    pub replace: &'static str,
    pub save_beside: &'static str,

    // status
    pub ready: &'static str,
    pub not_ready: &'static str,
    pub version: &'static str,
    pub stays_here: &'static str,
    pub micro_archive: &'static str,
    pub location: &'static str,
    pub size: &'static str,
    pub micro_parts: &'static str,
    pub missing: &'static str,
    pub transcription_model: &'static str,
    pub micro_performance: &'static str,
    pub runs_on: &'static str,
    pub memory: &'static str,

    // questions
    pub stop_title: &'static str,
    pub stop_text: &'static str,
    pub stop_action: &'static str,
    pub keep_running: &'static str,
    pub quit_title: &'static str,
    pub quit_text: &'static str,
    pub quit_action: &'static str,

    // keys
    pub key_move: &'static str,
    pub key_read: &'static str,
    pub key_show_in_transcript: &'static str,
    pub key_search: &'static str,
    pub key_new: &'static str,
    pub key_save_as: &'static str,
    pub key_quit: &'static str,
    pub key_help: &'static str,
    pub key_back: &'static str,
    pub key_block: &'static str,
    pub key_speaker: &'static str,
    pub key_time: &'static str,
    pub key_play: &'static str,
    pub key_pause: &'static str,
    pub key_skip: &'static str,
    pub key_done: &'static str,
    pub key_cancel_search: &'static str,
    pub key_recheck: &'static str,
    pub key_change: &'static str,
    pub key_select: &'static str,
    pub key_space: &'static str,
    pub key_audio_format: &'static str,
    pub key_save: &'static str,
    pub key_archive: &'static str,
    pub key_close_help: &'static str,
    pub stop_transcription: &'static str,
    pub back_keeps_running: &'static str,

    // help
    pub help_title: &'static str,
    pub help_sentence: &'static str,
    pub help_moving: &'static str,
    pub help_archive: &'static str,
    pub help_reading: &'static str,
    pub help_everywhere: &'static str,
    pub help_up_down: &'static str,
    pub help_panes: &'static str,
    pub help_page: &'static str,
    pub help_ends: &'static str,
    pub help_open: &'static str,
    pub help_back: &'static str,
    pub help_search_archive: &'static str,
    pub help_new: &'static str,
    pub help_filter: &'static str,
    pub help_sort: &'static str,
    pub help_save_as: &'static str,
    pub help_search_transcript: &'static str,
    pub help_hits: &'static str,
    pub help_speakers: &'static str,
    pub help_time: &'static str,
    pub help_play: &'static str,
    pub help_skip: &'static str,
    pub help_info: &'static str,
    pub help_running: &'static str,
    pub help_status: &'static str,
    pub help_ctrl_c: &'static str,
    pub help_quit: &'static str,
    pub help_select_text: &'static str,
}

pub const EN: Words = Words {
    archive: "Archive",
    status_title: "Status",
    new_transcription: "New transcription",
    transcribing: "Transcribing",
    recordings: ["recording", "recordings", "recordings"],
    speakers: ["speaker", "speakers", "speakers"],
    blocks: ["block", "blocks", "blocks"],
    of_sound: "of audio",
    of: "of",

    folders: "Folders",
    all_recordings: "All recordings",
    show: "Show",
    filter_all: "All",
    filter_new: "Not transcribed",
    filter_failed: "Failed",
    filter_missing: "Second language missing",
    sort: "Order",
    sort_newest: "Newest",
    sort_oldest: "Oldest",
    sort_az: "A to Z",
    sort_za: "Z to A",
    search_placeholder: "Search titles and transcripts…",
    esc_clears: "Esc clears",
    col_title: "TITLE",
    col_length: "LENGTH",
    col_added: "ADDED",
    archive_empty: "Nothing here yet. Press a to transcribe a file, or drop one onto the terminal.",
    nothing_matches: "Nothing matches.",
    in_terminal: "Being transcribed in the terminal",
    in_window: "Being transcribed in the Volocal app",
    failed: "The transcription failed",
    not_transcribed: "Not transcribed yet",

    no_transcript: "This recording has no transcript yet.",
    go_to_time: "Go to time:",
    no_hits: "Nothing found",
    next: "next",
    previous: "previous",
    close: "close",
    info_heading: "About the recording",
    info_title: "Title",
    info_file: "File",
    info_added: "Added",
    info_length: "Length",
    info_language: "Language",
    info_model: "Model",
    info_blocks: "Blocks",
    info_source: "Source",
    source_missing: "The original file is no longer where it was.",

    sheet_sentence: "Choose a file. The other settings come from the Volocal app.",
    file: "File",
    drop_here: "You can also drop the file onto the terminal.",
    complete: "completes",
    language: "Language",
    speakers_label: "Speakers",
    model: "Model",
    set_in_app: "set in the app",
    as_in_app: "as in the app",
    recognise_language: "recognise it",
    speakers_unknown: "not known",
    start_transcription: "Start",
    cancel: "Cancel",
    waiting_for_window: "Waiting for the Volocal app to finish its transcription",
    waiting_why: "Two transcriptions at once would take memory from each other.",
    live_transcript: "TRANSCRIPT SO FAR",
    stopped_kept: "Stopped. The recording stays in the archive with its transcript.",
    stopped_lost: "Stopped. The recording stays in the archive without a transcript; the text so far was not kept.",
    fill_in: "Fill in",
    leave_it: "Leave it",
    transcript_start: "THE BEGINNING",
    already_running: "A transcription is running already.",
    stopping: "Stopping the transcription…",

    save_how: "How would you like to save it?",
    save_several: "You can choose several formats at once.",
    format_txt: "Text",
    format_txt_note: "The plain transcript",
    format_md: "Markdown",
    format_md_note: "Text with speakers and times",
    format_srt: "SRT subtitles",
    format_srt_note: "For editors and players",
    format_vtt: "VTT subtitles",
    format_vtt_note: "For the web",
    format_json: "JSON",
    format_json_note: "Everything, for further processing",
    format_audio: "Audio",
    format_audio_note: "Without the transcript",
    only_audio: "Without a transcript only the audio can be saved.",
    save_to: "Save to",
    files_named: "The files are named after the recording.",
    saved: "Saved",
    converting_audio: "Converting the audio…",
    preparing_sound: "Preparing the sound…",
    no_sound_device: "The sound cannot be played: there is no sound device.",
    sound_failed: "The sound could not be prepared.",
    sound_no_ffmpeg: "The sound cannot be prepared without ffmpeg.",
    replace: "Replace",
    save_beside: "Save under a new name",

    ready: "Volocal is ready to transcribe.",
    not_ready: "Volocal cannot transcribe yet.",
    version: "Version",
    stays_here: "Recordings and transcripts stay on your computer.",
    micro_archive: "ARCHIVE",
    location: "Location",
    size: "Size",
    micro_parts: "PARTS",
    missing: "missing",
    transcription_model: "Transcription model",
    micro_performance: "PERFORMANCE",
    runs_on: "Runs on",
    memory: "Memory",

    stop_title: "Stop the transcription?",
    stop_text: "A first transcription stopped now stays in the archive without a transcript; the text so far is not kept.",
    stop_action: "Stop",
    keep_running: "Keep going",
    quit_title: "A transcription is still running",
    quit_text: "Stop it and quit?",
    quit_action: "Stop and quit",

    key_move: "Move",
    key_read: "Read",
    key_show_in_transcript: "Show in the transcript",
    key_search: "Search",
    key_new: "New transcription",
    key_save_as: "Save as",
    key_quit: "Quit",
    key_help: "Help",
    key_back: "Back",
    key_block: "Block",
    key_speaker: "Speaker",
    key_time: "Time",
    key_play: "Play",
    key_pause: "Pause",
    key_skip: "±5 s",
    key_done: "Done",
    key_cancel_search: "Clear the search",
    key_recheck: "Check again",
    key_change: "Change",
    key_select: "Select",
    key_space: "Space",
    key_audio_format: "Audio format",
    key_save: "Save",
    key_archive: "Archive",
    key_close_help: "Close the help",
    stop_transcription: "Stop the transcription",
    back_keeps_running: "Back to the archive, the transcription goes on",

    help_title: "Keys",
    help_sentence: "They work everywhere unless a group says otherwise.",
    help_moving: "MOVING",
    help_archive: "ARCHIVE",
    help_reading: "READING",
    help_everywhere: "EVERYWHERE",
    help_up_down: "Previous, next",
    help_panes: "Between panes",
    help_page: "A page",
    help_ends: "First, last",
    help_open: "Open",
    help_back: "Back, close",
    help_search_archive: "Search the archive",
    help_new: "New transcription…",
    help_filter: "Show (filter)",
    help_sort: "Order",
    help_save_as: "Save as…",
    help_search_transcript: "Search the transcript",
    help_hits: "Next, previous hit",
    help_speakers: "Next, previous speaker",
    help_time: "Go to a time",
    help_play: "Play from the block, pause",
    help_skip: "5 s back, 5 s on",
    help_info: "About the recording",
    help_running: "The running transcription",
    help_status: "Status",
    help_ctrl_c: "Stop the transcription / quit",
    help_quit: "Back; on the archive, quit",
    help_select_text: "Hold Shift and drag with the mouse to select text.",
};

pub const CS: Words = Words {
    archive: "Archiv",
    status_title: "Stav",
    new_transcription: "Nový přepis",
    transcribing: "Přepisuji",
    recordings: ["nahrávka", "nahrávky", "nahrávek"],
    speakers: ["mluvčí", "mluvčí", "mluvčích"],
    blocks: ["úsek", "úseky", "úseků"],
    of_sound: "zvuku",
    of: "z",

    folders: "Složky",
    all_recordings: "Všechny nahrávky",
    show: "Zobrazit",
    filter_all: "Vše",
    filter_new: "Nepřepsané",
    filter_failed: "Nepodařené",
    filter_missing: "Chybí druhý jazyk",
    sort: "Řazení",
    sort_newest: "Nejnovější",
    sort_oldest: "Nejstarší",
    sort_az: "Od A do Z",
    sort_za: "Od Z do A",
    search_placeholder: "Hledat v názvech i přepisech…",
    esc_clears: "Esc zruší",
    col_title: "NÁZEV",
    col_length: "DÉLKA",
    col_added: "PŘIDÁNO",
    archive_empty:
        "Zatím tu nic není. Soubor přepíšete klávesou a, nebo ho přetáhněte do terminálu.",
    nothing_matches: "Nic tomu neodpovídá.",
    in_terminal: "Přepisuje se v terminálu",
    in_window: "Přepisuje se v aplikaci Volocal",
    failed: "Přepis se nepodařil",
    not_transcribed: "Zatím nepřepsaná",

    no_transcript: "Tahle nahrávka zatím nemá přepis.",
    go_to_time: "Přejít na čas:",
    no_hits: "Nic jsme nenašli",
    next: "další",
    previous: "předchozí",
    close: "zavřít",
    info_heading: "O nahrávce",
    info_title: "Název",
    info_file: "Soubor",
    info_added: "Přidáno",
    info_length: "Délka",
    info_language: "Jazyk",
    info_model: "Model",
    info_blocks: "Úseky",
    info_source: "Zdroj",
    source_missing: "Původní soubor už není tam, kde byl.",

    sheet_sentence: "Vyberte soubor. Ostatní nastavení převezmeme z aplikace Volocal.",
    file: "Soubor",
    drop_here: "Soubor sem můžete také přetáhnout.",
    complete: "doplní",
    language: "Jazyk",
    speakers_label: "Mluvčí",
    model: "Model",
    set_in_app: "nastaveno v aplikaci",
    as_in_app: "jako v aplikaci",
    recognise_language: "rozpoznat",
    speakers_unknown: "nevím kolik",
    start_transcription: "Spustit přepis",
    cancel: "Zrušit",
    waiting_for_window: "Čeká, až skončí přepis v aplikaci Volocal",
    waiting_why: "Dva přepisy najednou by si braly paměť.",
    live_transcript: "PRŮBĚŽNÝ PŘEPIS",
    stopped_kept: "Přepis je zastavený. Nahrávka zůstává v archivu i s přepisem.",
    stopped_lost:
        "Přepis je zastavený. Nahrávka zůstává v archivu bez přepisu, dosavadní text se neuložil.",
    fill_in: "Doplnit",
    leave_it: "Nechat být",
    transcript_start: "ZAČÁTEK PŘEPISU",
    already_running: "Jeden přepis už běží.",
    stopping: "Zastavuji přepis…",

    save_how: "Jak chcete nahrávku uložit?",
    save_several: "Můžete vybrat několik formátů najednou.",
    format_txt: "Text",
    format_txt_note: "Čistý přepis",
    format_md: "Markdown",
    format_md_note: "Text s mluvčími a časy",
    format_srt: "Titulky SRT",
    format_srt_note: "Pro střihové programy a přehrávače",
    format_vtt: "Titulky VTT",
    format_vtt_note: "Pro web",
    format_json: "JSON",
    format_json_note: "Všechna data pro další zpracování",
    format_audio: "Zvuk",
    format_audio_note: "Bez přepisu",
    only_audio: "Bez přepisu lze uložit jen zvuk.",
    save_to: "Uložit do",
    files_named: "Soubory dostanou název podle nahrávky.",
    saved: "Uloženo",
    converting_audio: "Převádím zvuk…",
    preparing_sound: "Připravuji zvuk…",
    no_sound_device: "Zvuk nelze přehrát: chybí zvukové zařízení.",
    sound_failed: "Zvuk se nepodařilo připravit.",
    sound_no_ffmpeg: "Bez ffmpegu nelze zvuk připravit.",
    replace: "Nahradit",
    save_beside: "Uložit pod novým jménem",

    ready: "Volocal je připravený k přepisu.",
    not_ready: "Volocal zatím přepisovat nemůže.",
    version: "Verze",
    stays_here: "Nahrávky ani přepisy neopustí váš počítač.",
    micro_archive: "ARCHIV",
    location: "Umístění",
    size: "Velikost",
    micro_parts: "SOUČÁSTI",
    missing: "chybí",
    transcription_model: "Model přepisu",
    micro_performance: "VÝKON",
    runs_on: "Počítá na",
    memory: "Paměť",

    stop_title: "Zastavit přepis?",
    stop_text:
        "První přepis zastavený teď zůstane v archivu bez přepisu, dosavadní text se neuloží.",
    stop_action: "Zastavit",
    keep_running: "Pokračovat",
    quit_title: "Přepis ještě běží",
    quit_text: "Zastavit ho a skončit?",
    quit_action: "Zastavit a skončit",

    key_move: "Pohyb",
    key_read: "Číst",
    key_show_in_transcript: "Ukázat v přepisu",
    key_search: "Hledat",
    key_new: "Nový přepis",
    key_save_as: "Uložit jako",
    key_quit: "Konec",
    key_help: "Nápověda",
    key_back: "Zpět",
    key_block: "Úsek",
    key_speaker: "Mluvčí",
    key_time: "Čas",
    key_play: "Přehrát",
    key_pause: "Pozastavit",
    key_skip: "±5 s",
    key_done: "Hotovo",
    key_cancel_search: "Zrušit hledání",
    key_recheck: "Zkontrolovat znovu",
    key_change: "Změnit",
    key_select: "Vybrat",
    key_space: "Mezerník",
    key_audio_format: "Formát zvuku",
    key_save: "Uložit",
    key_archive: "Archiv",
    key_close_help: "Zavřít nápovědu",
    stop_transcription: "Zastavit přepis",
    back_keeps_running: "Zpět do archivu, přepis poběží dál",

    help_title: "Klávesové zkratky",
    help_sentence: "Platí všude, pokud u skupiny není uvedeno jinak.",
    help_moving: "POHYB",
    help_archive: "ARCHIV",
    help_reading: "ČTENÍ",
    help_everywhere: "VŠUDE",
    help_up_down: "Předchozí, další",
    help_panes: "Mezi panely",
    help_page: "O stránku",
    help_ends: "Na začátek, na konec",
    help_open: "Otevřít",
    help_back: "Zpět, zavřít",
    help_search_archive: "Hledat v archivu",
    help_new: "Nový přepis…",
    help_filter: "Zobrazit (filtr)",
    help_sort: "Řazení",
    help_save_as: "Uložit jako…",
    help_search_transcript: "Hledat v přepisu",
    help_hits: "Další, předchozí výsledek",
    help_speakers: "Další, předchozí mluvčí",
    help_time: "Přejít na čas",
    help_play: "Přehrát od úseku, pozastavit",
    help_skip: "5 s zpět, 5 s vpřed",
    help_info: "O nahrávce",
    help_running: "Běžící přepis",
    help_status: "Stav",
    help_ctrl_c: "Zastavit přepis / skončit",
    help_quit: "Zpět, v archivu konec",
    help_select_text: "Text vyberete tažením myši se stisknutým Shiftem.",
};

pub fn of(lang: Lang) -> &'static Words {
    match lang {
        Lang::En => &EN,
        Lang::Cs => &CS,
    }
}

/// A count with its noun: Czech chooses among three forms, English two.
pub fn count(lang: Lang, n: i64, forms: [&str; 3]) -> String {
    let form = match lang {
        Lang::En => {
            if n == 1 {
                forms[0]
            } else {
                forms[2]
            }
        }
        Lang::Cs => match n {
            1 => forms[0],
            2..=4 => forms[1],
            _ => forms[2],
        },
    };
    format!("{n} {form}")
}

/// A length of time for a summary: `5 h 12 min`, `12 min`, `40 s`.
pub fn span(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let (h, m) = (total / 3600, (total % 3600) / 60);
    match (h, m) {
        (0, 0) => format!("{total} s"),
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m} min"),
    }
}

/// When a recording was added, as a card says it: `Dnes 9:14`, `3. 9.`, or
/// with the year when it is not this one.
pub fn when(lang: Lang, stored: &str) -> String {
    use chrono::{DateTime, Datelike, Local, NaiveDateTime};
    let local = DateTime::parse_from_rfc3339(stored)
        .map(|t| t.with_timezone(&Local).naive_local())
        .or_else(|_| {
            NaiveDateTime::parse_from_str(stored.get(..19).unwrap_or(stored), "%Y-%m-%dT%H:%M:%S")
        });
    let Ok(at) = local else {
        return stored.get(..10).unwrap_or(stored).to_string();
    };
    let today = Local::now().date_naive();
    if at.date() == today {
        let word = match lang {
            Lang::En => "Today",
            Lang::Cs => "Dnes",
        };
        return format!("{word} {}", at.format("%-H:%M"));
    }
    match (lang, at.year() == today.year()) {
        (Lang::Cs, true) => format!("{}. {}.", at.day(), at.month()),
        (Lang::Cs, false) => format!("{}. {}. {}", at.day(), at.month(), at.year()),
        (Lang::En, true) => at.format("%-d %b").to_string(),
        (Lang::En, false) => at.format("%-d %b %Y").to_string(),
    }
}

/// A language's name, for the languages the window offers; otherwise the code.
pub fn language_name(lang: Lang, code: &str) -> String {
    let names: &[(&str, &str, &str)] = &[
        ("cs", "čeština", "Czech"),
        ("en", "angličtina", "English"),
        ("sk", "slovenština", "Slovak"),
        ("de", "němčina", "German"),
        ("pl", "polština", "Polish"),
        ("fr", "francouzština", "French"),
        ("es", "španělština", "Spanish"),
        ("it", "italština", "Italian"),
        ("uk", "ukrajinština", "Ukrainian"),
        ("ru", "ruština", "Russian"),
        ("auto", "rozpoznat", "recognise"),
    ];
    names
        .iter()
        .find(|(c, _, _)| *c == code)
        .map(|(_, cs, en)| match lang {
            Lang::Cs => cs.to_string(),
            Lang::En => en.to_string(),
        })
        .unwrap_or_else(|| code.to_string())
}

/// The language as an adverb, the way the window's question says it.
fn adverb(lang: Lang, code: &str) -> String {
    let adverbs: &[(&str, &str)] = &[
        ("cs", "česky"),
        ("en", "anglicky"),
        ("sk", "slovensky"),
        ("de", "německy"),
        ("pl", "polsky"),
        ("fr", "francouzsky"),
        ("es", "španělsky"),
        ("it", "italsky"),
        ("uk", "ukrajinsky"),
        ("ru", "rusky"),
    ];
    match lang {
        Lang::Cs => adverbs
            .iter()
            .find(|(c, _)| *c == code)
            .map_or_else(|| code.to_string(), |(_, a)| a.to_string()),
        Lang::En => language_name(lang, code),
    }
}

/// The window's own question (`detail.secondLanguage.missing`).
pub fn offer(lang: Lang, code: &str) -> String {
    match lang {
        Lang::Cs => format!(
            "V nahrávce zní také {}. Chcete doplnit přepis?",
            adverb(lang, code)
        ),
        Lang::En => format!(
            "{} can be heard in the recording too. Fill in the transcript?",
            adverb(lang, code)
        ),
    }
}

pub fn missing_language(lang: Lang, code: &str) -> String {
    match lang {
        Lang::Cs => format!("Chybí {}", language_name(lang, code)),
        Lang::En => format!("{} missing", language_name(lang, code)),
    }
}

pub fn not_a_file(lang: Lang, path: &str) -> String {
    match lang {
        Lang::Cs => format!("{path} není soubor."),
        Lang::En => format!("{path} is not a file."),
    }
}

/// The time left, from an estimate in seconds.
pub fn time_left(lang: Lang, seconds: f64) -> String {
    if seconds < 60.0 {
        return match lang {
            Lang::Cs => "Zbývá méně než minuta".into(),
            Lang::En => "Under a minute left".into(),
        };
    }
    let minutes = (seconds / 60.0).ceil() as i64;
    match lang {
        Lang::Cs => format!(
            "Zbývá asi {}",
            count(lang, minutes, ["minuta", "minuty", "minut"])
        ),
        Lang::En => format!(
            "About {} left",
            count(lang, minutes, ["minute", "minutes", "minutes"])
        ),
    }
}

/// What the transcription runs on, which is all the engine knows of it.
pub fn compute(lang: Lang, compute: &str) -> String {
    match (lang, compute) {
        (Lang::Cs, "cuda") => "grafické kartě (CUDA)".into(),
        (Lang::Cs, "vulkan") => "grafické kartě (Vulkan)".into(),
        (Lang::Cs, "cpu") => "procesoru".into(),
        (Lang::En, "cuda") => "graphics card (CUDA)".into(),
        (Lang::En, "vulkan") => "graphics card (Vulkan)".into(),
        (Lang::En, "cpu") => "processor".into(),
        (_, other) => other.to_string(),
    }
}

pub fn runs_on(lang: Lang, value: &str) -> String {
    match (lang, value) {
        (Lang::Cs, "cpu") => "přepisuje procesor".into(),
        (Lang::Cs, "cuda") => "přepisuje grafická karta (CUDA)".into(),
        (Lang::Cs, "vulkan") => "přepisuje grafická karta (Vulkan)".into(),
        (Lang::En, _) => format!("on the {}", compute(lang, value)),
        (_, other) => other.to_string(),
    }
}

/// `38:12 záznamu přepsáno za 3:12, 12× rychleji, než nahrávka trvá`.
pub fn speed(lang: Lang, duration: f64, took: f64) -> String {
    let length = crate::common::clock(duration);
    let time = crate::common::clock(took);
    // Under a second is a run that did not really run; no speed to boast of.
    let ratio = if took >= 1.0 { duration / took } else { 0.0 };
    let factor = if ratio < 10.0 {
        format!("{ratio:.1}")
    } else {
        format!("{ratio:.0}")
    };
    match lang {
        Lang::Cs => {
            let factor = factor.replace('.', ",");
            if ratio >= 1.2 {
                format!(
                    "{length} záznamu přepsáno za {time}, {factor}× rychleji, než nahrávka trvá"
                )
            } else {
                format!("{length} záznamu přepsáno za {time}")
            }
        }
        Lang::En => {
            if ratio >= 1.2 {
                format!(
                    "{length} of audio transcribed in {time}, {factor}× faster than the recording"
                )
            } else {
                format!("{length} of audio transcribed in {time}")
            }
        }
    }
}

pub fn megabytes(lang: Lang, bytes: u64) -> String {
    let mb = bytes as f64 / 1_048_576.0;
    let text = if mb < 10.0 {
        format!("{mb:.1}")
    } else {
        format!("{mb:.0}")
    };
    match lang {
        Lang::Cs => format!("{} MB", text.replace('.', ",")),
        Lang::En => format!("{text} MB"),
    }
}

pub fn save_files(lang: Lang, n: i64) -> String {
    match lang {
        Lang::Cs => match n {
            1 => "Uložit 1 soubor".into(),
            2..=4 => format!("Uložit {n} soubory"),
            _ => format!("Uložit {n} souborů"),
        },
        Lang::En => {
            if n == 1 {
                "Save 1 file".into()
            } else {
                format!("Save {n} files")
            }
        }
    }
}

pub fn clash(lang: Lang, n: usize) -> String {
    match lang {
        Lang::Cs => match n {
            1 => "Soubor s tímto názvem už existuje.".into(),
            2..=4 => format!("{n} soubory s těmito názvy už existují."),
            _ => format!("{n} souborů s těmito názvy už existuje."),
        },
        Lang::En => {
            if n == 1 {
                "A file with this name exists already.".into()
            } else {
                format!("{n} files with these names exist already.")
            }
        }
    }
}

pub fn enlarge(lang: Lang, width: u16, height: u16) -> String {
    match lang {
        Lang::Cs => format!("Terminál je příliš malý ({width} × {height}). Zvětšete ho prosím."),
        Lang::En => {
            format!("The terminal is too small ({width} × {height}). Please make it larger.")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_choose_the_czech_form() {
        assert_eq!(count(Lang::Cs, 1, CS.recordings), "1 nahrávka");
        assert_eq!(count(Lang::Cs, 3, CS.recordings), "3 nahrávky");
        assert_eq!(count(Lang::Cs, 12, CS.recordings), "12 nahrávek");
        assert_eq!(count(Lang::En, 1, EN.blocks), "1 block");
    }

    #[test]
    fn the_offer_is_the_window_question() {
        assert_eq!(
            offer(Lang::Cs, "en"),
            "V nahrávce zní také anglicky. Chcete doplnit přepis?"
        );
    }

    #[test]
    fn speed_and_time_read_naturally() {
        assert_eq!(
            speed(Lang::Cs, 2292.0, 192.0),
            "38:12 záznamu přepsáno za 3:12, 12× rychleji, než nahrávka trvá"
        );
        assert_eq!(time_left(Lang::Cs, 100.0), "Zbývá asi 2 minuty");
        assert_eq!(time_left(Lang::Cs, 30.0), "Zbývá méně než minuta");
    }

    #[test]
    fn a_stored_date_reads_as_a_card_says_it() {
        assert_eq!(when(Lang::Cs, "2020-03-09T10:00:00"), "9. 3. 2020");
        assert_eq!(when(Lang::En, "2020-03-09T10:00:00"), "9 Mar 2020");
    }
}
