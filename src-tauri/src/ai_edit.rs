//! Local, optional language editing for finished transcripts.
//!
//! The timed transcript is never rewritten. A separate document is generated
//! in chunks and cached with a hash of the exact source text it was based on.

use crate::user_message::UserMessage;
use crate::{db, export, tools};
use anyhow::Result;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const CHUNK_TARGET_CHARS: usize = 6_000;

/// Result of anything that can end up in front of the user.
type Reported<T> = std::result::Result<T, UserMessage>;

#[derive(Serialize, Clone)]
pub struct AiEditProgress {
    pub recording_id: String,
    pub phase: String,
    pub percent: f64,
    /// What is happening right now, or what went wrong. The window turns the
    /// code into a sentence in the language it is running in.
    pub description: UserMessage,
}

#[derive(Clone, Default)]
pub struct AiEditTask {
    running: Arc<Mutex<Option<String>>>,
    cancellation: Arc<AtomicBool>,
    progress: Arc<Mutex<Option<AiEditProgress>>>,
    /// The language server, so somebody other than its own worker thread can
    /// stop it. `EditorServer` kills on `Drop`, which is enough when the
    /// thread unwinds and no use at all when the window closes and the process
    /// simply ends — leaving `llama-server` behind with a seven-gigabyte model
    /// resident.
    server: Arc<Mutex<Option<Child>>>,
}

impl AiEditTask {
    /// Stops the language server if one is running. Called when the window is
    /// closing; says whether there was anything to stop, which is what the
    /// test asserts on.
    pub fn kill_server(&self) -> bool {
        stop_child(&self.server)
    }

    pub fn start(
        &self,
        app: AppHandle,
        db_path: PathBuf,
        settings: db::Settings,
        recording_id: String,
        mode: String,
    ) -> Reported<()> {
        {
            let mut running = self.running.lock().unwrap();
            if let Some(id) = running.as_ref() {
                return Err(UserMessage::new(if id == &recording_id {
                    "ai.already_running_here"
                } else {
                    "ai.already_running_elsewhere"
                }));
            }
            *running = Some(recording_id.clone());
        }
        self.cancellation.store(false, Ordering::Relaxed);
        let initial_progress = AiEditProgress {
            recording_id: recording_id.clone(),
            phase: "preparing".into(),
            percent: 2.0,
            description: UserMessage::new("ai.preparing_model"),
        };
        *self.progress.lock().unwrap() = Some(initial_progress.clone());
        let _ = app.emit("ai-edit:progress", initial_progress);

        let running = self.running.clone();
        let cancellation = self.cancellation.clone();
        let progress = self.progress.clone();
        let server = self.server.clone();
        std::thread::spawn(move || {
            let reporter = Reporter {
                app: &app,
                recording_id: &recording_id,
                state: &progress,
            };
            if let Err(error) = generate_document(
                &reporter,
                &db_path,
                &settings,
                &mode,
                &cancellation,
                &server,
            ) {
                let cancelled = cancellation.load(Ordering::Relaxed);
                reporter.say(
                    if cancelled { "cancelled" } else { "error" },
                    0.0,
                    if cancelled {
                        UserMessage::new("ai.cancelled")
                    } else {
                        error
                    },
                );
            }
            *running.lock().unwrap() = None;
        });
        Ok(())
    }

    pub fn cancel(&self, recording_id: &str) {
        if self.running.lock().unwrap().as_deref() == Some(recording_id) {
            self.cancellation.store(true, Ordering::Relaxed);
        }
    }

    pub fn start_output(
        &self,
        app: AppHandle,
        db_path: PathBuf,
        settings: db::Settings,
        recording_id: String,
        kind: String,
        variant: String,
    ) -> Reported<()> {
        {
            let mut running = self.running.lock().unwrap();
            if let Some(id) = running.as_ref() {
                return Err(UserMessage::new(if id == &recording_id {
                    "ai.already_running_here"
                } else {
                    "ai.already_running_elsewhere"
                }));
            }
            *running = Some(recording_id.clone());
        }
        self.cancellation.store(false, Ordering::Relaxed);
        let initial_progress = AiEditProgress {
            recording_id: recording_id.clone(),
            phase: "preparing".into(),
            percent: 2.0,
            description: UserMessage::new(if kind == "summary" {
                "ai.preparing_summary"
            } else {
                "ai.preparing_translation"
            }),
        };
        *self.progress.lock().unwrap() = Some(initial_progress.clone());
        let _ = app.emit("ai-edit:progress", initial_progress);

        let running = self.running.clone();
        let cancellation = self.cancellation.clone();
        let progress = self.progress.clone();
        let server = self.server.clone();
        std::thread::spawn(move || {
            let reporter = Reporter {
                app: &app,
                recording_id: &recording_id,
                state: &progress,
            };
            if let Err(error) = generate_output(
                &reporter,
                &db_path,
                &settings,
                &kind,
                &variant,
                &cancellation,
                &server,
            ) {
                let cancelled = cancellation.load(Ordering::Relaxed);
                reporter.say(
                    if cancelled { "cancelled" } else { "error" },
                    0.0,
                    if cancelled {
                        UserMessage::new("ai.cancelled")
                    } else {
                        error
                    },
                );
            }
            *running.lock().unwrap() = None;
        });
        Ok(())
    }

    pub fn is_running(&self, recording_id: &str) -> bool {
        self.running.lock().unwrap().as_deref() == Some(recording_id)
    }

    pub fn current_progress(&self, recording_id: &str) -> Option<AiEditProgress> {
        self.progress
            .lock()
            .unwrap()
            .as_ref()
            .filter(|progress| progress.recording_id == recording_id)
            .cloned()
    }
}

pub fn source_hash(text: &str) -> String {
    // Deterministic FNV-1a. A cryptographic hash would add a dependency without
    // improving this cache-invalidation use case.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

/// Cache key for derived documents. Summary prompts changed from direct Czech
/// summarisation to source-language-first, so that pipeline needs its own
/// versioned key. Translations keep their original key and remain reusable.
pub fn output_source_hash(source: &str, kind: &str, source_language: &str) -> String {
    if kind == "summary" {
        source_hash(&format!(
            "summary-source-first-v1\0{source_language}\0{source}"
        ))
    } else {
        source_hash(source)
    }
}

pub fn effective_language(recording: &db::Recording) -> String {
    let detected = recording.language.trim();
    let requested = recording.language_choice.trim();
    if !detected.is_empty() && detected != "auto" {
        detected.to_ascii_lowercase()
    } else {
        requested.to_ascii_lowercase()
    }
}

pub fn transcript_source(connection: &rusqlite::Connection, recording_id: &str) -> Result<String> {
    let segments = db::segments(connection, recording_id)?;
    let speakers = db::speakers(connection, recording_id)?;
    Ok(export::txt(&segments, &speakers).trim().to_string())
}

/// Who to tell about progress, for one run.
///
/// These three travel together everywhere in this file and never vary within a
/// run: a caption with no window to reach and no state for the status poll to
/// read is not a report. Grouping them is what keeps the functions below under
/// the parameter count — and it is a real group, not a bag of whatever each one
/// happened to need.
struct Reporter<'a> {
    app: &'a AppHandle,
    recording_id: &'a str,
    state: &'a Arc<Mutex<Option<AiEditProgress>>>,
}

impl Reporter<'_> {
    fn say(&self, phase: &str, percent: f64, description: UserMessage) {
        let progress = AiEditProgress {
            recording_id: self.recording_id.into(),
            phase: phase.into(),
            percent,
            description,
        };
        *self.state.lock().unwrap() = Some(progress.clone());
        let _ = self.app.emit("ai-edit:progress", progress);
    }

    /// Announce a step at its own starting point, then run it. Every request in
    /// this file is preceded by exactly this announcement; keeping the two
    /// together is what stops one of them being changed without the other.
    fn run_step(
        &self,
        step: Step,
        chunk: &str,
        instruction: &str,
        max_tokens: u32,
        cancellation: &AtomicBool,
        server: &mut EditorServer,
    ) -> Reported<String> {
        self.say("processing", step.from, step.caption.clone());
        request_chunk(
            self,
            &step,
            chunk,
            instruction,
            max_tokens,
            cancellation,
            server,
        )
    }
}

/// The slice of the whole bar one chunk owns, and what to call it while it
/// runs. Three numbers that mean nothing apart: a caption with no band would
/// not know where to draw, and a band with no caption would not know what to
/// say.
struct Step {
    from: f64,
    to: f64,
    caption: UserMessage,
}

/// Caption for work done chunk by chunk: which piece out of how many.
fn chunk_step(code: &str, index: usize, total: usize) -> UserMessage {
    UserMessage::new(code)
        .with("index", index + 1)
        .with("total", total)
}

fn split_chunks(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in text.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        let projected = current.chars().count() + paragraph.chars().count() + 2;
        if !current.is_empty() && projected > CHUNK_TARGET_CHARS {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(paragraph);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Kolik slov predlohy musi v odpovedi zustat, aby to jeste byla uprava.
///
/// Oprava prepisu nechava skoro kazde slovo tam, kde bylo: posune se
/// interpunkce, zmeni se par prekliknutych slov. Preklad nenechá skoro nic —
/// jmena a cisla. Ty dva vysledky jsou od sebe tak daleko, ze je jedno cislo
/// bezpecne oddeli, a prave proto se tim da hlidat, ze model neodpovedel v
/// jazyce pokynu misto v jazyce vstupu.
const MIN_KEPT_WORDING: f64 = 0.45;

/// Pod tolik slov uz predloha neunese statistiku a nesoudi se.
const MIN_WORDS_TO_JUDGE: usize = 20;

/// Podil slov predlohy, ktera se objevila i v odpovedi.
fn kept_wording(source: &str, edited: &str) -> f64 {
    fn words(text: &str) -> Vec<String> {
        text.split(|c: char| !c.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .map(str::to_lowercase)
            .collect()
    }
    let source_words = words(source);
    if source_words.is_empty() {
        return 1.0;
    }
    let edited_words: std::collections::HashSet<String> = words(edited).into_iter().collect();
    let kept = source_words
        .iter()
        .filter(|word| edited_words.contains(*word))
        .count();
    kept as f64 / source_words.len() as f64
}

/// Je odpoved upravou predlohy, nebo necim uplne jinym?
fn is_an_edit_of(source: &str, edited: &str) -> bool {
    source.split_whitespace().count() < MIN_WORDS_TO_JUDGE
        || kept_wording(source, edited) >= MIN_KEPT_WORDING
}

/// Jazyk prepisu pojmenovany v pokynu.
///
/// Abstraktni pravidlo „odpovidej ve stejnem jazyce“ model v pozdejsich
/// castech dokumentu poustel ze zretele a prepinal se do jazyka, ve kterem je
/// napsany zbytek pokynu. Konkretni jmeno jazyka drzi mnohem lip.
fn language_note(code: &str) -> Option<String> {
    let name = match code
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "cs" => "češtině",
        "en" => "angličtině",
        "sk" => "slovenštině",
        "de" => "němčině",
        "pl" => "polštině",
        "uk" => "ukrajinštině",
        "ru" => "ruštině",
        "fr" => "francouzštině",
        "es" => "španělštině",
        "it" => "italštině",
        _ => return None,
    };
    Some(format!(
        "\n\nVstupní text je v {name}. Odpověz v {name}, i kdyby byly tyto pokyny v jiném jazyce."
    ))
}

fn system_prompt(mode: &str) -> String {
    let mode_instruction = if mode == "clean" {
        "Odstraň navíc zjevná opakování, přeřeknutí a slovní vatu, ale zachovej všechny informace, jména, čísla a pořadí myšlenek."
    } else {
        "Buď přísně věrný: nic nevynechávej, nezkracuj a neměň způsob vyjadřování. Oprav pouze interpunkci, velká písmena, odstavce a jednoznačné chyby rozpoznávání řeči."
    };
    // These instructions are written in Czech because they were tuned against
    // Czech transcripts, but the transcript itself may be in any language. A
    // model reading a Czech instruction over English input will answer in
    // Czech unless told otherwise, so the rule against translating opens and
    // closes the prompt — the two places a model weighs most.
    format!(
        "Odpovídej vždy ve stejném jazyce, v jakém je vstupní text. Nikdy nepřekládej,          ani když je vstup v jiném jazyce než tyto pokyny. Anglický přepis zůstane anglicky,          německý německy.\n\n         Jsi pečlivý editor doslovného přepisu. {mode_instruction}\n         Nikdy text neshrnuj, nevymýšlej informace ani nenahrazuj nejisté jméno jiným.          Oprav také foneticky blízká slova, chybné koncovky a chybné rozdělení či spojení slov,          pokud je původní podoba v bezprostředním kontextu gramaticky nebo významově nesmyslná          a správná podoba je jednoznačná. Například `má to jako součas DNA svého života` oprav na          `má to jako součást DNA svého života`. Nezaměňuj však správná slova jen za stylistická synonyma.          Zachovej osobu, číslo, čas a způsob sloves, pokud je původní tvar možný; například ve větě          `Mně se líbí, když se setkáte s lidmi` musí zůstat `setkáte`, nikoli `setkám`.          Popisky mluvčích na samostatném řádku zachovej. Vrať pouze upravený text,          bez komentáře, úvodu a bez Markdownového bloku, a ve stejném jazyce jako vstup."
    )
}

fn translation_language(code: &str) -> Option<&'static str> {
    match code {
        "cs" => Some("češtiny"),
        "en" => Some("angličtiny"),
        "de" => Some("němčiny"),
        "sk" => Some("slovenštiny"),
        "pl" => Some("polštiny"),
        "fr" => Some("francouzštiny"),
        "es" => Some("španělštiny"),
        "it" => Some("italštiny"),
        "uk" => Some("ukrajinštiny"),
        _ => None,
    }
}

fn translation_prompt(code: &str, language: &str) -> String {
    let czech_editorial_pass = if code == "cs" {
        " Překlad musí znít, jako by od začátku vznikl česky. Nepřebírej anglický slovosled, \
         větné kostry ani ustálené kalky. Upřednostni konkrétní česká slovesa, činný rod a \
         přirozené české vazby. Zejména nepoužívej `adresovat problém`, `v rámci`, `je to o tom, že`, \
         `dochází k`, `realizujeme`, `provádíme` ani `nabízíme možnost`, pokud lze tutéž věc říct \
         přímo a přirozeně. Omez podstatná jména v instrumentálu, pasivní mlhu a zbytečné infinitivy. \
         Abstraktní anglická podstatná jména převáděj na přirozená česká slovesa: `create impact for \
         stakeholders` není `vytvářet dopad pro zainteresované strany`, ale podle kontextu například \
         `skutečně pomoci lidem, kterých se věc týká`; `delivery of services` není `poskytování služeb`, \
         ale například `pomáháme rodinám svými službami`; `offers the possibility to participate` \
         přelož jako `lidé se mohou zapojit`, ne `nabízí možnost účasti`. Nepoužívej slova `dopad`, \
         `stakeholder` ani `zainteresovaná strana`, když význam přesněji vyjádří konkrétní české slovo. \
         Anglické `impact on people` nebo `affect people` vyjádři podle významu jako `týká se lidí` \
         nebo `ovlivňuje lidi`, nikdy jako `zasahuje na lidi` či `lidé, na které to zasahuje`. \
         Každou větu si potichu přečti jako rodilý Čech a oprav vše, co zní přeloženě. Zachovej však \
         autorův význam, tón i neobvyklé, ale srozumitelné obraty; nic nepřikrášluj ani nezkracuj. \
         Nakonec zkontroluj českou gramatiku, pády a slovesné vazby; nevracej větu, kterou rodilý Čech \
         nemůže přirozeně vyslovit."
    } else {
        ""
    };
    format!(
        "Jsi profesionální překladatel. Přelož následující upravený přepis do {language}. \
         Zachovej přesně význam, jména, čísla, pořadí myšlenek, odstavce a popisky mluvčích. \
         Nic neshrnuj, nevynechávej ani nepřidávej. Přirozené formulace v cílovém jazyce jsou \
         žádoucí, ale fakta nesmíš měnit.{czech_editorial_pass} \
         Vrať pouze překlad bez úvodu a komentáře."
    )
}

fn czech_review_prompt() -> &'static str {
    "Jsi pečlivý český korektor. Oprav pouze gramatiku, pády, slovesné vazby, nepřirozený \
     slovosled a zbylé překladové kalky. Zachovej beze změny všechny informace, jména, čísla, \
     tón, pořadí vět, odstavce a popisky mluvčích. Nic neshrnuj, nevynechávej, nepřidávej ani \
     stylisticky nepřikrášluj. Věta `lidem, které se věc týká` musí být `lidem, kterých se věc \
     týká`. Vazbu `lidé, na které to zasahuje` nahraď podle významu jako `lidé, kterých se to \
     týká` nebo `ovlivnění lidé`. Vrať pouze opravený český text."
}

fn summary_notes_prompt() -> &'static str {
    "Z následující části upraveného přepisu vytvoř podklady pro celkové shrnutí. \
     Piš ve stejném jazyce jako přepis; v této fázi nic nepřekládej. \
     Zachovej všechna důležitá fakta, jména, čísla, postoje a souvislosti. Nevymýšlej nic, \
     co v textu není. Vrať nejvýše osm stručných bodů bez úvodu."
}

fn summary_prompt(variant: &str) -> Option<&'static str> {
    match variant {
        "short" => Some(
            "Z podkladů vytvoř stručné shrnutí celého rozhovoru v 5 až 7 bodech, \
             nejvýše 140 slov. Zachovej nejdůležitější jména, fakta a závěry. Nic nepřidávej. \
             Piš ve stejném jazyce jako podklady a nic nepřekládej. Vrať pouze shrnutí.",
        ),
        "standard" => Some(
            "Z podkladů vytvoř přehledné shrnutí celého rozhovoru ve 3 až 6 kratších \
             odstavcích. Zachovej hlavní myšlenky, důležité souvislosti, jména, fakta a závěry. \
             Piš ve stejném jazyce jako podklady a nic nepřekládej. Nic nepřidávej. \
             Vrať pouze shrnutí.",
        ),
        "detailed" => Some(
            "Z podkladů vytvoř podrobné, dobře členěné shrnutí celého rozhovoru. \
             Pokryj všechny hlavní tematické okruhy, argumenty, důležité souvislosti, jména, \
             fakta a závěry. Piš ve stejném jazyce jako podklady a nic nepřekládej. Použij \
             krátké nadpisy a odstavce, nic nevymýšlej a vrať pouze shrnutí.",
        ),
        _ => None,
    }
}

fn czech_summary_translation_prompt() -> &'static str {
    "Teď přelož hotové shrnutí do přirozené češtiny. Už ho znovu neshrnuj. Zachovej všechny \
     body, fakta, jména, čísla, závěry, pořadí a členění. Nic nevynechávej ani nepřidávej. \
     Překlad musí znít, jako by od začátku vznikl česky: nepřebírej cizí slovosled, větné \
     kostry ani kalky. Používej konkrétní česká slovesa a činný rod. Pokud je vstup už česky, \
     zachovej ho věcně beze změny. Vrať pouze přeložené shrnutí bez úvodu a komentáře."
}

fn clean_output(output: &str) -> String {
    let without_ansi = regex::Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
        .map(|pattern| pattern.replace_all(output, "").into_owned())
        .unwrap_or_else(|_| output.to_string());
    without_ansi
        .trim()
        .trim_start_matches("UPRAVENÝ TEXT:")
        .trim()
        .trim_matches('`')
        .trim()
        .to_string()
}

/// The running language server.
///
/// The child itself lives in the shared registry rather than in this struct,
/// so the application can stop it from outside — closing the window ends the
/// process without unwinding this worker's thread, and `Drop` never runs.
/// One owner behind one lock, reached by both.
struct EditorServer {
    registry: Arc<Mutex<Option<Child>>>,
    base_url: String,
}

impl EditorServer {
    /// Has the server exited on its own? `Ok(None)` means it is still running.
    fn exited(&self) -> std::io::Result<Option<std::process::ExitStatus>> {
        match self.registry.lock().unwrap().as_mut() {
            Some(child) => child.try_wait(),
            None => Ok(None),
        }
    }
    fn stop(&mut self) {
        stop_child(&self.registry);
    }
}

/// Kills whatever the registry holds and empties it. Idempotent on purpose:
/// the worker's `Drop` and the application's exit hook both call it, and which
/// arrives first is a race nobody should have to think about.
fn stop_child(registry: &Arc<Mutex<Option<Child>>>) -> bool {
    let Some(mut child) = registry.lock().unwrap().take() else {
        return false;
    };
    let running = child.try_wait().ok().flatten().is_none();
    let _ = child.kill();
    let _ = child.wait();
    running
}

impl Drop for EditorServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn start_server(
    server: &Path,
    model: &Path,
    uses_vulkan: bool,
    cancellation: &AtomicBool,
    registry: &Arc<Mutex<Option<Child>>>,
) -> Reported<EditorServer> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);

    let mut command = tools::command(server);
    command
        .arg("--model")
        .arg(model)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--ctx-size",
            "8192",
            "--parallel",
            "1",
            // Transcript correction needs the edited document, not a hidden
            // chain of thought. Gemma otherwise spends the whole output budget
            // in `reasoning_content` and can return an empty `content` field.
            "--reasoning",
            "off",
            "--no-warmup",
            "--log-disable",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if uses_vulkan {
        command.args(["--gpu-layers", "99"]);
    }
    let child = command
        .spawn()
        .map_err(|error| UserMessage::new("ai.server_launch_failed").detail(error))?;
    // Handed over before the readiness wait below: the model can take a minute
    // to load, and closing the window during that minute is exactly when the
    // orphan is most expensive.
    *registry.lock().unwrap() = Some(child);
    let process = EditorServer {
        registry: registry.clone(),
        base_url: format!("http://127.0.0.1:{port}"),
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()?;

    for _ in 0..1_500 {
        if cancellation.load(Ordering::Relaxed) {
            return Err(UserMessage::new("ai.cancelled"));
        }
        if let Some(status) = process.exited()? {
            return Err(UserMessage::new("ai.server_exited_while_loading").with("status", status));
        }
        if client
            .get(format!("{}/health", process.base_url))
            .send()
            .is_ok_and(|response| response.status().is_success())
        {
            return Ok(process);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(UserMessage::new("ai.model_load_timeout"))
}

fn request_chunk(
    reporter: &Reporter,
    step: &Step,
    chunk: &str,
    instruction: &str,
    max_tokens: u32,
    cancellation: &AtomicBool,
    server: &mut EditorServer,
) -> Reported<String> {
    // Taken here rather than passed in: the caller was cloning it off the very
    // server it also handed over, so it was the same value twice.
    let base_url = server.base_url.clone();
    let body = serde_json::json!({
        "messages": [
            { "role": "system", "content": instruction },
            { "role": "user", "content": chunk }
        ],
        "temperature": 0.1,
        "top_p": 0.9,
        "max_tokens": max_tokens,
        "stream": true
    })
    .to_string();

    enum StreamMessage {
        Delta(String),
        Complete,
        Error(String),
    }
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let result: std::result::Result<(), String> = (|| {
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(900))
                .build()
                .map_err(|error| error.to_string())?;
            let response = client
                .post(format!("{base_url}/v1/chat/completions"))
                .header("content-type", "application/json")
                .body(body)
                .send()
                .and_then(reqwest::blocking::Response::error_for_status)
                .map_err(|error| error.to_string())?;

            for line in BufReader::new(response).lines() {
                let line = line.map_err(|error| error.to_string())?;
                let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                    continue;
                };
                if data == "[DONE]" {
                    break;
                }
                let value: serde_json::Value =
                    serde_json::from_str(data).map_err(|error| error.to_string())?;
                if let Some(delta) = value["choices"][0]["delta"]["content"].as_str() {
                    if !delta.is_empty()
                        && sender
                            .send(StreamMessage::Delta(delta.to_string()))
                            .is_err()
                    {
                        return Ok(());
                    }
                }
            }
            Ok(())
        })();
        let _ = sender.send(match result {
            Ok(()) => StreamMessage::Complete,
            Err(error) => StreamMessage::Error(error),
        });
    });

    let expected_chars = chunk.chars().count().max(1) as f64;
    let mut output = String::new();
    let mut generated_chars = 0usize;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    loop {
        if cancellation.load(Ordering::Relaxed) {
            server.stop();
            return Err(UserMessage::new("ai.cancelled"));
        }
        match receiver.recv_timeout(Duration::from_millis(120)) {
            Ok(StreamMessage::Delta(delta)) => {
                generated_chars += delta.chars().count();
                output.push_str(&delta);
                if last_emit.elapsed() >= Duration::from_millis(250) {
                    let ratio = (generated_chars as f64 / expected_chars).min(0.98);
                    reporter.say(
                        "processing",
                        step.from + (step.to - step.from) * ratio,
                        step.caption.clone(),
                    );
                    last_emit = Instant::now();
                }
            }
            Ok(StreamMessage::Complete) => {
                let output = clean_output(&output);
                if output.is_empty() {
                    return Err(UserMessage::new("ai.empty_response"));
                }
                return Ok(output);
            }
            Ok(StreamMessage::Error(error)) => {
                return Err(UserMessage::new("ai.server_failed").with("reason", error));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(UserMessage::new("ai.server_disconnected"));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(status) = server.exited()? {
                    return Err(UserMessage::new("ai.server_exited").with("status", status));
                }
            }
        }
    }
}

fn generate_document(
    reporter: &Reporter,
    db_path: &Path,
    settings: &db::Settings,
    mode: &str,
    cancellation: &AtomicBool,
    registry: &Arc<Mutex<Option<Child>>>,
) -> Reported<()> {
    let recording_id = reporter.recording_id;
    if settings.editor_model.is_empty() {
        return Err(UserMessage::new("ai.no_model_selected"));
    }
    reporter.say("preparing", 2.0, UserMessage::new("ai.preparing_model"));

    let connection = db::open(db_path)?;
    let source = transcript_source(&connection, recording_id)?;
    if source.is_empty() {
        return Err(UserMessage::new("ai.transcript_empty"));
    }
    let source_hash = source_hash(&source);
    let check = tools::check(settings);
    let server_path = check
        .editor_server
        .map(PathBuf::from)
        .ok_or_else(|| UserMessage::new("ai.server_missing"))?;
    let resolved_model_id = check
        .editor_model_id
        .ok_or_else(|| UserMessage::new("ai.model_missing"))?;
    let model = check
        .editor_model
        .map(PathBuf::from)
        .ok_or_else(|| UserMessage::new("ai.model_missing"))?;
    let chunks = split_chunks(&source);
    let mut output = Vec::with_capacity(chunks.len());
    reporter.say("preparing", 3.0, UserMessage::new("ai.loading_model"));
    let uses_vulkan = server_path
        .parent()
        .is_some_and(|parent| parent.ends_with("editor-vulkan"));
    let mut server = start_server(&server_path, &model, uses_vulkan, cancellation, registry)?;
    let mut instruction = system_prompt(mode);
    // Name the language of this recording. The rule against translating is in
    // the prompt already, but it is abstract, and on a long English document
    // the model let go of it somewhere in the middle and carried on in Czech —
    // the language the rest of the instructions are written in.
    if let Ok(recording) = db::recording(&connection, recording_id) {
        if let Some(note) = language_note(&effective_language(&recording)) {
            instruction.push_str(&note);
        }
    }
    // And when it happens anyway, say so instead of asking again the same way.
    let insist = format!(
        "{instruction}\n\nPŘEDCHOZÍ POKUS BYL ŠPATNĚ: vrátil jsi text přeložený nebo \
         přepsaný od základu. Vrať tentýž text, stejnými slovy a ve stejném jazyce, \
         jen s opravenou interpunkcí, odstavci a zjevnými chybami přepisu."
    );

    for (index, chunk) in chunks.iter().enumerate() {
        if cancellation.load(Ordering::Relaxed) {
            return Err(UserMessage::new("ai.cancelled"));
        }
        let step = Step {
            from: 5.0 + (index as f64 / chunks.len() as f64) * 90.0,
            to: 5.0 + ((index + 1) as f64 / chunks.len() as f64) * 90.0,
            caption: chunk_step("ai.editing_chunk", index, chunks.len()),
        };
        reporter.say("processing", step.from, step.caption.clone());
        let mut edited = request_chunk(
            reporter,
            &step,
            chunk,
            &instruction,
            4096,
            cancellation,
            &mut server,
        )?;

        // An answer that keeps none of the wording is not an edit of this
        // chunk — it is a translation, a summary, or the model replying to the
        // instructions instead of applying them. Ask once more, plainly; if it
        // comes back wrong again, this chunk keeps its original text. A part of
        // the transcript left uncorrected is a far smaller loss than a part
        // silently replaced by something the speaker never said.
        if !is_an_edit_of(chunk, &edited) {
            edited = request_chunk(
                reporter,
                &step,
                chunk,
                &insist,
                4096,
                cancellation,
                &mut server,
            )?;
            if !is_an_edit_of(chunk, &edited) {
                edited = chunk.to_string();
            }
        }
        output.push(edited);
    }

    let document = db::AiDocument {
        recording_id: recording_id.into(),
        source_hash,
        model: resolved_model_id,
        mode: mode.into(),
        text: output.join("\n\n"),
        updated_at: chrono::Local::now().to_rfc3339(),
        stale: false,
    };
    db::save_ai_document(&connection, &document)?;
    reporter.say("complete", 100.0, UserMessage::new("ai.document_ready"));
    Ok(())
}

fn generate_output(
    reporter: &Reporter,
    db_path: &Path,
    settings: &db::Settings,
    kind: &str,
    variant: &str,
    cancellation: &AtomicBool,
    registry: &Arc<Mutex<Option<Child>>>,
) -> Reported<()> {
    let recording_id = reporter.recording_id;
    if settings.editor_model.is_empty() {
        return Err(UserMessage::new("ai.no_model_selected"));
    }
    let summary_instruction = if kind == "summary" {
        Some(summary_prompt(variant).ok_or_else(|| UserMessage::new("ai.unknown_summary_length"))?)
    } else {
        None
    };
    let translation = if kind == "translation" {
        Some(
            translation_language(variant)
                .ok_or_else(|| UserMessage::new("ai.unknown_translation_language"))?,
        )
    } else {
        None
    };
    if summary_instruction.is_none() && translation.is_none() {
        return Err(UserMessage::new("ai.unknown_output_kind"));
    }

    let connection = db::open(db_path)?;
    let document = db::ai_document(&connection, recording_id)?
        .ok_or_else(|| UserMessage::new("ai.document_required"))?;
    let source = document.text.trim().to_string();
    if source.is_empty() {
        return Err(UserMessage::new("ai.document_empty"));
    }
    let recording = db::recording(&connection, recording_id)?;
    let source_language = effective_language(&recording);
    let output_source_hash = output_source_hash(&source, kind, &source_language);
    let check = tools::check(settings);
    let server_path = check
        .editor_server
        .map(PathBuf::from)
        .ok_or_else(|| UserMessage::new("ai.server_missing"))?;
    let resolved_model_id = check
        .editor_model_id
        .ok_or_else(|| UserMessage::new("ai.model_missing"))?;
    let model = check
        .editor_model
        .map(PathBuf::from)
        .ok_or_else(|| UserMessage::new("ai.model_missing"))?;

    reporter.say("preparing", 3.0, UserMessage::new("ai.loading_model"));
    let uses_vulkan = server_path
        .parent()
        .is_some_and(|parent| parent.ends_with("editor-vulkan"));
    let mut server = start_server(&server_path, &model, uses_vulkan, cancellation, registry)?;
    let chunks = split_chunks(&source);

    let text = if let Some(language) = translation {
        let instruction = translation_prompt(variant, language);
        let translation_end = if variant == "cs" { 68.0 } else { 95.0 };
        let mut translated = Vec::with_capacity(chunks.len());
        for (index, chunk) in chunks.iter().enumerate() {
            if cancellation.load(Ordering::Relaxed) {
                return Err(UserMessage::new("ai.cancelled"));
            }
            let step = Step {
                from: 5.0 + (index as f64 / chunks.len() as f64) * (translation_end - 5.0),
                to: 5.0 + ((index + 1) as f64 / chunks.len() as f64) * (translation_end - 5.0),
                caption: chunk_step("ai.translating_chunk", index, chunks.len()),
            };
            translated.push(reporter.run_step(
                step,
                chunk,
                &instruction,
                4096,
                cancellation,
                &mut server,
            )?);
        }
        if variant == "cs" {
            let mut reviewed = Vec::with_capacity(translated.len());
            for (index, chunk) in translated.iter().enumerate() {
                if cancellation.load(Ordering::Relaxed) {
                    return Err(UserMessage::new("ai.cancelled"));
                }
                let step = Step {
                    from: 70.0 + (index as f64 / translated.len() as f64) * 25.0,
                    to: 70.0 + ((index + 1) as f64 / translated.len() as f64) * 25.0,
                    caption: chunk_step("ai.reviewing_chunk", index, translated.len()),
                };
                reviewed.push(reporter.run_step(
                    step,
                    chunk,
                    czech_review_prompt(),
                    4096,
                    cancellation,
                    &mut server,
                )?);
            }
            reviewed.join("\n\n")
        } else {
            translated.join("\n\n")
        }
    } else {
        let translate_summary = source_language != "cs";
        let notes_end = if translate_summary { 54.0 } else { 70.0 };
        let mut notes = Vec::with_capacity(chunks.len());
        for (index, chunk) in chunks.iter().enumerate() {
            if cancellation.load(Ordering::Relaxed) {
                return Err(UserMessage::new("ai.cancelled"));
            }
            let step = Step {
                from: 5.0 + (index as f64 / chunks.len() as f64) * (notes_end - 5.0),
                to: 5.0 + ((index + 1) as f64 / chunks.len() as f64) * (notes_end - 5.0),
                caption: chunk_step("ai.reading_chunk", index, chunks.len()),
            };
            notes.push(reporter.run_step(
                step,
                chunk,
                summary_notes_prompt(),
                768,
                cancellation,
                &mut server,
            )?);
        }
        let combined = notes
            .iter()
            .enumerate()
            .map(|(index, note)| format!("ČÁST {}:\n{}", index + 1, note))
            .collect::<Vec<_>>()
            .join("\n\n");
        let step = Step {
            from: if translate_summary { 57.0 } else { 78.0 },
            to: if translate_summary { 70.0 } else { 95.0 },
            caption: UserMessage::new(if translate_summary {
                "ai.summarizing_source"
            } else {
                "ai.summarizing"
            }),
        };
        let max_tokens = match variant {
            "short" => 512,
            "standard" => 1024,
            _ => 2048,
        };
        let source_summary = reporter.run_step(
            step,
            &combined,
            summary_instruction.unwrap(),
            max_tokens,
            cancellation,
            &mut server,
        )?;

        if translate_summary {
            let translated = reporter.run_step(
                Step {
                    from: 73.0,
                    to: 85.0,
                    caption: UserMessage::new("ai.translating_summary"),
                },
                &source_summary,
                czech_summary_translation_prompt(),
                max_tokens,
                cancellation,
                &mut server,
            )?;

            reporter.run_step(
                Step {
                    from: 87.0,
                    to: 95.0,
                    caption: UserMessage::new("ai.reviewing_summary"),
                },
                &translated,
                czech_review_prompt(),
                max_tokens,
                cancellation,
                &mut server,
            )?
        } else {
            source_summary
        }
    };

    db::save_ai_output(
        &connection,
        &db::AiOutput {
            recording_id: recording_id.into(),
            kind: kind.into(),
            variant: variant.into(),
            source_hash: output_source_hash,
            model: resolved_model_id,
            text,
            updated_at: chrono::Local::now().to_rfc3339(),
        },
    )?;
    reporter.say(
        "complete",
        100.0,
        UserMessage::new(if kind == "summary" {
            "ai.summary_ready"
        } else {
            "ai.translation_ready"
        }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_only_between_paragraphs() {
        let first = "a".repeat(4_000);
        let second = "b".repeat(3_000);
        let chunks = split_chunks(&format!("{first}\n\n{second}"));
        assert_eq!(chunks, vec![first, second]);
    }

    #[test]
    fn source_hash_is_stable_and_sensitive() {
        assert_eq!(source_hash("stejný text"), source_hash("stejný text"));
        assert_ne!(source_hash("stejný text"), source_hash("jiný text"));
    }

    #[test]
    fn czech_translation_gets_an_explicit_anti_calque_pass() {
        let prompt = translation_prompt("cs", translation_language("cs").unwrap());
        assert!(prompt.contains("vznikl česky"));
        assert!(prompt.contains("adresovat problém"));
        assert!(prompt.contains("anglický slovosled"));
        assert!(czech_review_prompt().contains("lidem, kterých se věc týká"));
    }

    /// The reported defect, in the exact place it happened: `So I'm quite
    /// practical. I used to be a builder.` came back as Czech, in the middle of
    /// an otherwise English document.
    #[test]
    fn a_translated_chunk_is_not_an_edit() {
        let source = "So I'm quite practical. I used to be a builder. You've got to imagine that \
                      whatever you're giving to your congregation on Sunday is putting tools into \
                      what they carry into their Monday.";
        let translated = "Takže jsem poměrně praktický. Dřív jsem byl stavební. Musíte si \
                          představit, že cokoli, co dáte své sboru v neděli, to je dávání nástrojů \
                          do toho, co si berou do svého pondělí.";

        assert!(!is_an_edit_of(source, translated));
        assert!(kept_wording(source, translated) < 0.2);
    }

    /// The guard must not fire on what the feature is actually for. Faithful
    /// editing repunctuates and fixes misheard words; the wording stays.
    #[test]
    fn a_real_correction_passes_the_guard() {
        let source = "so i'm quite practical i used to be a builder you've got to imagine that \
                      whatever you're giving to your congregation on sunday is putting tools into \
                      what they carry into their monday";
        let edited = "So I'm quite practical. I used to be a builder. You've got to imagine that \
                      whatever you're giving to your congregation on Sunday is putting tools into \
                      what they carry into their Monday.";

        assert!(is_an_edit_of(source, edited));
    }

    /// Cleaner editing removes repetitions and filler, so it keeps less. It
    /// still has to stay clearly on the edit side of the line.
    #[test]
    fn a_cleaned_chunk_still_passes_the_guard() {
        let source = "And the whole idea, the whole idea, which is, so by the way, it's what I've \
                      been doing with you guys, which is my role is to plant an unusual thought \
                      that's almost so subtle nobody notices it, you know, but over time it \
                      becomes something.";
        let cleaned = "The whole idea is what I've been doing with you guys: my role is to plant \
                       an unusual thought that's almost so subtle nobody notices it, but over \
                       time it becomes something.";

        assert!(is_an_edit_of(source, cleaned));
    }

    /// Too short to judge: a two-word chunk shares too little to measure, so it
    /// is let through rather than being thrown away on a coincidence.
    #[test]
    fn a_very_short_chunk_is_not_judged() {
        assert!(is_an_edit_of("Díky moc.", "Thanks a lot."));
    }

    #[test]
    fn the_language_of_the_recording_reaches_the_prompt() {
        assert!(language_note("en").unwrap().contains("angličtině"));
        assert!(language_note("cs").unwrap().contains("češtině"));
        // A code nobody mapped must not invent a language for the model.
        assert!(language_note("auto").is_none());
        assert!(language_note("").is_none());
    }

    #[test]
    fn editing_never_translates_the_transcript() {
        // The instructions are Czech, so without this rule an English
        // transcript came back translated instead of edited.
        for mode in ["faithful", "clean"] {
            let prompt = system_prompt(mode);
            assert!(prompt.contains("Nikdy nepřekládej"));
            assert!(prompt.starts_with("Odpovídej vždy ve stejném jazyce"));
            assert!(prompt.trim_end().ends_with("ve stejném jazyce jako vstup."));
            assert!(!prompt.contains("český editor"));
        }

        let english = translation_prompt("en", translation_language("en").unwrap());
        assert!(!english.contains("adresovat problém"));
    }

    #[test]
    fn summary_is_written_in_the_source_language_before_translation() {
        assert!(summary_notes_prompt().contains("stejném jazyce jako přepis"));
        assert!(summary_prompt("standard")
            .unwrap()
            .contains("nic nepřekládej"));
        assert!(czech_summary_translation_prompt().contains("hotové shrnutí"));
        assert!(czech_summary_translation_prompt().contains("Už ho znovu neshrnuj"));
        assert_ne!(
            output_source_hash("Source", "summary", "en"),
            source_hash("Source")
        );
        assert_eq!(
            output_source_hash("Source", "translation", "en"),
            source_hash("Source")
        );
    }
}
