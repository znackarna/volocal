//! Downloads and installs tools and models without requiring helper scripts.
//!
//! Destinations follow the configured program and model directories. The
//! default is LOCALAPPDATA; portable mode uses directories beside the
//! executable and does not require administrator privileges.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::tools;
use crate::user_message::UserMessage;

/// Result of anything that can end up in front of the user.
type Reported<T> = std::result::Result<T, UserMessage>;

// ---------------------------------------------------------- the catalogue

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadComponent {
    pub id: String,
    /// Dictionary key for the name shown in the wizard and in Modules.
    pub name_code: String,
    /// Dictionary key for the sentence under the name.
    pub description_code: String,
    pub megabytes: u64,
    /// program | model | speech | editor
    ///
    /// `speech` holds the two models that decide something about the sound
    /// rather than about the words: where somebody is speaking, and whose
    /// voice it is. They were in `model` and `speakers`, one heading each, and
    /// the owner asked for one — the by-hand list is read down its headings,
    /// and a heading over a single 2 MB row is a heading about nothing.
    pub group: String,
    /// Without it there is no transcription at all.
    pub required: bool,
    /// Recommended for this particular computer.
    pub recommended: bool,
    /// Already downloaded.
    pub complete: bool,
    /// Whether the bin may be drawn on this row. Answered here so a row shows
    /// no bin rather than a bin that refuses — see `removal_plan` for what
    /// deleting a component means, and `component_is_busy` for the lock.
    pub removable: bool,
    /// Why not, when the component is installed and the bin is still not
    /// drawn. `busy` — something is using it this moment; `unlisted` — it was
    /// installed before file lists were recorded and nothing says which files
    /// in the shared programs folder are its own. The row draws a lock and the
    /// tooltip says which of the two it is: an absent control explains
    /// nothing, and the two have different answers — one is waited out, the
    /// other is fixed by fetching the component again.
    ///
    /// `None` on a row with a bin, and on a row with nothing installed to
    /// delete: there the empty column is not a puzzle.
    pub remove_block: Option<String>,
    /// Whether this component may be fetched again over itself. False while it
    /// is working: the installer renames a fresh file into place, and doing
    /// that under a running whisper is the one way to lose a model mid-run.
    ///
    /// **Not the same question as `removable`**, which is why it is a second
    /// flag rather than a reuse. A component whose files were never recorded
    /// cannot be deleted — nothing says which of the files in the shared `bin`
    /// root are its own — but replacing it is exactly what `install_component`
    /// does anyway, so it is replaceable and not removable. Nothing is the
    /// other way round.
    pub replaceable: bool,
    /// This is the model `settings.model` or `editor_model` names right now.
    ///
    /// Not a lock — that was the old rule and the owner turned it down: *měl by
    /// být všude a zámek jen u těch, které se aktuálně používají*. Deleting the
    /// chosen model while nothing runs is allowed. It is here so the
    /// confirmation can read differently, because removing the one that works
    /// is a different act from removing a spare.
    pub configured: bool,
    /// Which component the setting would name instead, if this one went now.
    /// `None` means nothing installed can take over and the setting would be
    /// cleared. Read by the confirmation and, after the deletion, by
    /// `settings_after_removal` — one answer, so the sentence and the value
    /// written cannot disagree.
    pub replaced_by: Option<String>,
    /// There is a record that this machine checked where the file came from.
    /// `complete` says a file is there; this says somebody vouched for it.
    pub origin_verified: bool,
    /// File whose presence means this component is complete (relative to root)
    verification_path: String,
    source: Source,
    destination: Destination,
}

/// One artefact, named exactly.
///
/// There used to be a second variant that searched recent GitHub releases for a
/// file matching a pattern, because asset names carry the version and therefore
/// change. It is gone: what it downloaded depended on what the project had
/// published that morning, every machine could receive a different build, and
/// no digest could ever be written down for it. A version is now chosen
/// deliberately in `components.json`, and moving to a newer one is a pull
/// request somebody reads — proposed weekly by `scripts/update-components.mjs`.
#[derive(Serialize, Deserialize, Clone, Debug)]
enum Source {
    Url(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
enum Destination {
    /// Unpack the archive and gather every .exe and .dll into one folder.
    ProgramsInto(String),
    /// Save the downloaded file under the given name.
    AsFile(String),
}

/// Where every component comes from and what it must hash to, read from
/// `components.json` beside this crate.
///
/// It is data rather than Rust because `scripts/update-components.mjs` rewrites
/// it every week and opens a pull request. A script editing Rust source with a
/// regular expression is the shape that has already silently replaced the wrong
/// thing in this repository once.
///
/// A digest is a promise about one exact artefact, so it may only be written
/// down once somebody has read it from the publisher — never computed from
/// whatever this machine received, which would attest that a file matches
/// itself and nothing more. Hugging Face serves it as an LFS object id, GitHub
/// as a release asset `digest`. Every component is on one of those two today;
/// ffmpeg was on gyan.dev's own site, which serves an `.sha256` beside the
/// archive and deletes the archive when the next version replaces it.
/// Where a publisher offers none, the entry has none and the component records
/// itself `origin unverified`.
#[derive(serde::Deserialize)]
struct Pin {
    url: String,
    sha256: Option<String>,
}

fn pins() -> &'static std::collections::BTreeMap<String, Pin> {
    static PINS: std::sync::OnceLock<std::collections::BTreeMap<String, Pin>> =
        std::sync::OnceLock::new();
    PINS.get_or_init(|| {
        // Embedded at compile time, so a missing or malformed file is a build
        // problem rather than something a user meets. `every_component_is_pinned`
        // is what turns that promise into a checked one.
        let raw: std::collections::BTreeMap<String, serde_json::Value> =
            serde_json::from_str(include_str!("../components.json"))
                .expect("components.json is not valid JSON");
        raw.into_iter()
            // `$comment` documents the file for whoever opens it; it is prose,
            // not a component.
            .filter(|(key, _)| !key.starts_with('$'))
            .map(|(key, value)| {
                let pin = serde_json::from_value(value)
                    .unwrap_or_else(|error| panic!("components.json: {key}: {error}"));
                (key, pin)
            })
            .collect()
    })
}

fn pin(id: &str) -> &'static Pin {
    pins()
        .get(id)
        .unwrap_or_else(|| panic!("components.json has no entry for {id}"))
}

fn expected_hash(id: &str) -> Option<&'static str> {
    pins().get(id).and_then(|entry| entry.sha256.as_deref())
}

/// Names and descriptions are not written here. The window shows them in the
/// active language, so the catalogue only says which dictionary entry belongs
/// to each item; the identifier is the key both sides agree on.
fn raw_catalog() -> Vec<DownloadComponent> {
    // The address is not written here any more: it comes from
    // `components.json`, keyed by this same id, so the robot that proposes a
    // newer version edits one file and never this list.
    let k = |id: &str,
             mb: u64,
             group: &str,
             required: bool,
             verification_path: &str,
             destination: Destination| DownloadComponent {
        source: Source::Url(pin(id).url.clone()),
        id: id.into(),
        name_code: format!("catalog.{id}.name"),
        description_code: format!("catalog.{id}.description"),
        megabytes: mb,
        group: group.into(),
        required,
        recommended: false,
        complete: false,
        origin_verified: false,
        removable: false,
        remove_block: None,
        replaceable: false,
        configured: false,
        replaced_by: None,
        verification_path: verification_path.into(),
        destination,
    };

    vec![
        // ---------------------------------------------------------- programs
        k(
            "whisper-vulkan",
            18,
            "program",
            false,
            "bin/vulkan/whisper-cli.exe",
            Destination::ProgramsInto("bin/vulkan".into()),
        ),
        k(
            "whisper-cpu",
            17,
            "program",
            false,
            "bin/cpu/whisper-cli.exe",
            Destination::ProgramsInto("bin/cpu".into()),
        ),
        k(
            "whisper-cuda",
            457,
            "program",
            false,
            "bin/cuda/whisper-cli.exe",
            Destination::ProgramsInto("bin/cuda".into()),
        ),
        k(
            // 106 rather than 85: the number is what the wizard totals up and
            // shows before anybody agrees to a download, and it had been the
            // size of an older build for long enough to be wrong by a quarter.
            "ffmpeg",
            106,
            "program",
            true,
            "bin/ffmpeg.exe",
            Destination::ProgramsInto("bin".into()),
        ),
        k(
            "yt-dlp",
            18,
            "program",
            false,
            "bin/yt-dlp.exe",
            Destination::AsFile("bin/yt-dlp.exe".into()),
        ),
        k(
            "deno",
            38,
            "program",
            false,
            "bin/deno.exe",
            Destination::ProgramsInto("bin".into()),
        ),
        // ---------------------------------------------------------- models
        k(
            "vad",
            2,
            "speech",
            true,
            "models/ggml-silero-v6.2.0.bin",
            Destination::AsFile("models/ggml-silero-v6.2.0.bin".into()),
        ),
        k(
            "model-turbo",
            575,
            "model",
            false,
            "models/ggml-large-v3-turbo-q5_0.bin",
            Destination::AsFile("models/ggml-large-v3-turbo-q5_0.bin".into()),
        ),
        k(
            "model-large-q5",
            1080,
            "model",
            false,
            "models/ggml-large-v3-q5_0.bin",
            Destination::AsFile("models/ggml-large-v3-q5_0.bin".into()),
        ),
        k(
            "model-large",
            3095,
            "model",
            false,
            "models/ggml-large-v3.bin",
            Destination::AsFile("models/ggml-large-v3.bin".into()),
        ),
        // ---------------------------------------------------- language editing
        k(
            "editor-vulkan",
            150,
            "editor",
            false,
            "bin/editor-vulkan/llama-cli.exe",
            Destination::ProgramsInto("bin/editor-vulkan".into()),
        ),
        k(
            "editor-cpu",
            45,
            "editor",
            false,
            "bin/editor-cpu/llama-cli.exe",
            Destination::ProgramsInto("bin/editor-cpu".into()),
        ),
        k(
            "editor-model-light",
            3350,
            "editor",
            false,
            "models/editor/gemma-4-e2b-q4.gguf",
            Destination::AsFile("models/editor/gemma-4-e2b-q4.gguf".into()),
        ),
        k(
            "editor-model-balanced",
            5150,
            "editor",
            false,
            "models/editor/gemma-4-e4b-q4.gguf",
            Destination::AsFile("models/editor/gemma-4-e4b-q4.gguf".into()),
        ),
        k(
            "editor-model-best",
            6980,
            "editor",
            false,
            "models/editor/gemma-4-12b-q4.gguf",
            Destination::AsFile("models/editor/gemma-4-12b-q4.gguf".into()),
        ),
        // -------------------------------------------------------- speakers
        // The history of this line, so that nobody walks it back:
        //
        // 1. First it was 3dspeaker ... sv_zh-cn ..., trained on Chinese only.
        //    It told Czech voices apart badly.
        // 2. Then CAM++ from VoxCeleb, trained on a wide mix of languages.
        // 3. Now CAM++ "zh_en common advanced", trained on both zh and en and
        //    on an order of magnitude more speakers. It shares nothing with
        //    point 1 but the family name — that one was single-language, this
        //    one is not.
        //
        // Measured on the owner's own recordings rather than estimated. The
        // full comparison is in docs/history/; in short, with two speakers
        // forced, VoxCeleb gave 65 handovers and a 55/45 split of the voices
        // while this one gives 17 and 94/6 — the same on the English and the
        // Czech version of one conversation. It is also a megabyte smaller and
        // just as fast.
        k(
            "model-hlasy",
            28,
            "speech",
            false,
            "models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
            Destination::AsFile(
                "models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx".into(),
            ),
        ),
    ]
}

/// Fills in what is already done, what suits this particular computer, and what
/// may be done to each row while the application is doing whatever it is doing.
pub fn catalog(settings: &crate::db::Settings, busy: Busy) -> Vec<DownloadComponent> {
    let has_nvidia = tools::has_nvidia();
    let has_vulkan = tools::has_vulkan();
    // Read once rather than per row: the file is one map of every installation
    // this machine has made, and fifteen rows would otherwise open it fifteen
    // times to ask about one key each.
    let records = read_records(&record_path(settings));

    raw_catalog()
        .into_iter()
        .map(|mut k| {
            k.complete = tools::component_path(settings, &k.verification_path).exists();
            k.origin_verified = records.get(&k.id).map(|r| r.verified).unwrap_or(false);
            let working = component_is_busy(settings, &k.id, busy);
            let deletable = removal_plan(settings, &k, records.get(&k.id)).is_some();
            k.removable = k.complete && deletable && !working;
            // Busy wins where both are true, because it is the answer to *why
            // is there no bin right now* — and the moment the work ends the row
            // explains itself the other way without anybody doing anything.
            k.remove_block = (k.complete && !k.removable)
                .then(|| if working { "busy" } else { "unlisted" }.to_string());
            k.replaceable = !working;
            k.configured = component_is_configured(settings, &k.id);
            k.replaced_by = k
                .configured
                .then(|| replacement_component(settings, &k.id))
                .flatten();
            k.recommended = match k.id.as_str() {
                "ffmpeg" | "vad" => true,
                // Which model depends on whether there is anything to compute
                // with, and these two are the pair the wizard asks about.
                //
                // It used to recommend `model-large-q5` on a machine with a
                // graphics card — the middle model, which the wizard stopped
                // offering on 13 August and which nothing offers now. The
                // badge said one thing and the wizard's own card said another,
                // and worse: `Spravovat modely` ticks every recommended
                // component that is not on the disk, so opening the list to
                // look would have queued a gigabyte of a model no screen
                // mentions.
                "model-large" => has_nvidia || has_vulkan,
                "model-turbo" => !(has_nvidia || has_vulkan),
                "whisper-cuda" => has_nvidia,
                "whisper-vulkan" => has_vulkan && !has_nvidia,
                // The processor build comes down on every machine, beside the
                // graphics one where there is a graphics one. 17 MB against
                // about 1.2 GB, for two things neither of which is optional.
                //
                // It is the floor. A graphics build stops working the moment
                // its driver does — a Windows update, a card swapped out, a
                // laptop on its integrated chip — and without this the
                // application has nothing left to run at all.
                //
                // And since 14 August 2026 `Kde přepis běží` lets somebody
                // choose the processor. A position on a switch that points at a
                // build which is not on the disk is not a choice: it would be
                // honoured by `choose_compute` finding nothing, falling through
                // to the card, and the panel having to explain that the answer
                // was no — which is the silent substitution that whole card was
                // built to stop happening in the first place.
                "whisper-cpu" => true,
                "editor-vulkan" => has_vulkan,
                // The same floor as `whisper-cpu`, for the same two reasons and
                // for 45 MB: whatever the reader can end up pointed at has to
                // exist on the disk, and a graphics build is useless the moment
                // its driver stops loading.
                //
                // This is the runtime, not a model. `editor-vulkan` is 150 MB
                // and stays on demand — it comes down with the Gemma model that
                // runs on it, on a machine that can use it, at the moment
                // somebody first wants a document. The fast path can wait for
                // the thing it makes fast; the floor cannot.
                "editor-cpu" => true,
                _ => false,
            };
            k
        })
        .collect()
}

// ---------------------------------------------------- what this machine has

/// How much disk the tools and models take, in megabytes.
///
/// **Measured off the disk rather than added up from the catalogue.** The
/// `megabytes` on each component is a hand-written constant and they have been
/// wrong: ffmpeg was 85 in the list against 106 on the disk for months
/// (`docs/history/2026-08-13.md`). A figure labelled *space taken* that is a sum
/// of stale guesses is worse than no figure, because somebody will go looking
/// for the difference.
///
/// It is the size of the programs and models folders, which is the honest
/// answer to *what is this costing me* and includes anything else somebody has
/// put in them. Attributing bytes to components could only be done for
/// installations that recorded a file list, and a total that changed meaning
/// depending on when each component was fetched is not a total.
///
/// How many components are installed is deliberately **not** answered here. The
/// window already holds the catalogue with a `complete` on every row, and it is
/// the window that knows which components it offers — so the fraction on the
/// card is counted from the same rows the reader can see and count for
/// themselves in the listing.
pub fn installed_megabytes(settings: &crate::db::Settings) -> f64 {
    let mut roots = vec![
        tools::expand(&settings.bin_directory),
        tools::expand(&settings.models_directory),
    ];
    // One folder inside the other is a supported arrangement — both default
    // under the same parent and either may be pointed anywhere — and measuring
    // both would count the inner one twice.
    roots.dedup();
    let outer: Vec<PathBuf> = roots
        .iter()
        .filter(|root| {
            !roots
                .iter()
                .any(|other| other != *root && root.starts_with(other))
        })
        .cloned()
        .collect();
    let bytes: u64 = outer.iter().map(|root| directory_size(root)).sum();
    bytes as f64 / 1_048_576.0
}

/// Bytes in a folder and everything under it. Metadata only — no file is
/// opened — so several gigabytes of models cost a few dozen directory reads.
/// A folder that is not there is nothing rather than an error: it is what a
/// machine that has downloaded nothing has.
fn directory_size(root: &Path) -> u64 {
    let mut total = 0;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(items) = std::fs::read_dir(&directory) else {
            continue;
        };
        for item in items.filter_map(|entry| entry.ok()) {
            match item.file_type() {
                Ok(kind) if kind.is_dir() => pending.push(item.path()),
                // A symbolic link is followed by nobody here: its target is
                // either inside these folders and counted where it lies, or
                // outside them and not this application's disk usage.
                Ok(kind) if kind.is_file() => {
                    total += item.metadata().map(|data| data.len()).unwrap_or(0)
                }
                _ => {}
            }
        }
    }
    total
}

// ------------------------------------------------------------------ events

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
    /// The stored value, in Czech like the others:
    /// stahuji | rozbaluji | hotovo | chyba | zruseno
    pub phase: String,
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub percent: u32,
    /// Absent while only the numbers matter.
    pub message: Option<UserMessage>,
}

fn emit_progress(app: &AppHandle, p: DownloadProgress) {
    let _ = app.emit("download:progress", p);
}

// ---------------------------------------------------------------- downloads

/// What is bounded here, and what deliberately is not.
///
/// **No overall `timeout`.** The largest model is three gigabytes, which on a
/// slow line legitimately takes an hour, and reqwest's blocking client applies
/// `timeout` as one deadline over the request *and* the reading of its body —
/// so any value large enough not to abandon a download that is going perfectly
/// well is too large to be a limit at all.
///
/// **A connect timeout**, because a name that does not resolve or a host that
/// does not answer used to hold the thread with nothing at all having started.
/// 15 seconds is generous for a lookup and a TLS handshake even on a phone
/// tethered over a poor signal, and it is the whole wait before `Zrušit` is
/// answered.
///
/// **Keepalive instead of a read timeout**, and this is the compromise worth
/// knowing about: the blocking client exposes no per-read limit — `read_timeout`
/// exists only on the asynchronous one. Without something, a peer that vanishes
/// without closing the connection (a laptop suspended, a router dropping the
/// flow, a VPN going down) leaves the reader blocked in `read` for as long as
/// the operating system's own default allows, which on Windows is two hours.
/// Cancelling cannot reach it: the flag is read between chunks, and no further
/// chunk is coming. Probing after 30 seconds of silence, every 10, giving up
/// after 6 tries, turns those two hours into about a minute and a half — after
/// which the read fails, the loop ends, and the cancellation is honoured.
///
/// The limit it does not impose: a peer that is alive and answers probes while
/// sending nothing still stalls. That needs a per-read deadline, and it is not
/// simply an unused builder method: `read_timeout` is on the asynchronous
/// `ClientBuilder` and not on the blocking one — tried here on 0.12.28 and it
/// does not compile. Getting it means the asynchronous client and a rewritten
/// download loop. Recorded rather than pretended away, and now measured.
///
/// **With one worker taking a queue, that stall is no longer one download.**
/// Everything behind it waits too. It has not happened; if it ever does, this
/// paragraph is where the work starts.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const KEEPALIVE_IDLE: std::time::Duration = std::time::Duration::from_secs(30);
const KEEPALIVE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);
const KEEPALIVE_RETRIES: u32 = 6;

fn client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .user_agent("Volocal")
        .timeout(None)
        .connect_timeout(CONNECT_TIMEOUT)
        .tcp_keepalive(KEEPALIVE_IDLE)
        .tcp_keepalive_interval(KEEPALIVE_INTERVAL)
        .tcp_keepalive_retries(KEEPALIVE_RETRIES)
        .build()?)
}

fn resolve_url(source: &Source) -> String {
    match source {
        Source::Url(url) => url.clone(),
    }
}

fn download_file(
    app: &AppHandle,
    id: &str,
    url: &str,
    target: &Path,
    expected: Option<&str>,
    cancellation: &Arc<AtomicBool>,
) -> Reported<String> {
    // What is already on disk from an interrupted attempt. Downloads used to
    // begin again from zero every time, which on a three-gigabyte model is the
    // difference between a nuisance and an evening.
    //
    // **Only resumed where a digest is known.** Fifteen of the sixteen
    // components are checked against a SHA-256 the publisher stated, and that
    // check is what catches a partial file joined to the wrong bytes — a stale
    // `.cast` from a URL that has since moved, a truncated write, a half-flushed
    // sector. The sixteenth has no digest, so nothing would notice a bad join:
    // for that one the leftover is discarded and the download starts clean.
    let partial = target.with_extension("cast");
    let resume_from = if expected.is_some() {
        std::fs::metadata(&partial)
            .map(|meta| meta.len())
            .unwrap_or(0)
    } else {
        let _ = std::fs::remove_file(&partial);
        0
    };

    let mut request = client()?.get(url);
    if resume_from > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
    }
    let mut response = request
        .send()
        .map_err(|error| {
            UserMessage::new("download.connection_failed")
                .with("url", url)
                .detail(error)
        })?
        .error_for_status()
        .map_err(|error| UserMessage::new("download.rejected").detail(error))?;

    // A server that honours the range answers 206 and sends the rest. One that
    // does not answers 200 and sends the whole file — so the answer decides,
    // not the request: taking 200 for a continuation would append a second copy
    // of the file to the first.
    let resumed = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let already = if resumed { resume_from } else { 0 };
    let total = response.content_length().unwrap_or(0) + already;
    let total_mb = total as f64 / 1_048_576.0;

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut digest = Sha256::new();
    // Downloaded into .cast, so an unfinished file never sits at the target.
    let mut file = if resumed {
        // The digest is taken from the bytes as they are written, so a resumed
        // download has to read back what an earlier attempt wrote before it can
        // carry on hashing. It is one pass over a local file and it is what
        // keeps the final check describing the whole thing rather than the tail.
        let mut existing = std::fs::File::open(&partial)?;
        let mut seed = vec![0u8; 262_144];
        loop {
            let read = existing.read(&mut seed)?;
            if read == 0 {
                break;
            }
            digest.update(&seed[..read]);
        }
        std::fs::OpenOptions::new().append(true).open(&partial)?
    } else {
        std::fs::File::create(&partial)?
    };

    let mut downloaded: u64 = already;
    let mut last_update = std::time::Instant::now();
    let mut buffer = vec![0u8; 262_144];

    loop {
        if cancellation.load(Ordering::Relaxed) {
            // Flushed and left where it is. Removing it here is what made every
            // interrupted download start again from the beginning; what is on
            // disk is bytes that arrived and were verified as they arrived, and
            // the next attempt asks the server to continue past them.
            let _ = file.flush();
            drop(file);
            return Err(UserMessage::new("download.cancelled"));
        }
        let bytes_read = response.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])?;
        digest.update(&buffer[..bytes_read]);
        downloaded += bytes_read as u64;

        // Reporting every 200 ms is enough; more would flood the window.
        if last_update.elapsed().as_millis() > 200 {
            last_update = std::time::Instant::now();
            emit_progress(
                app,
                DownloadProgress {
                    id: id.into(),
                    phase: "downloading".into(),
                    downloaded_mb: downloaded as f64 / 1_048_576.0,
                    total_mb,
                    percent: if total > 0 {
                        ((downloaded as f64 / total as f64) * 100.0) as u32
                    } else {
                        0
                    },
                    message: None,
                },
            );
        }
    }

    file.flush()?;
    drop(file);
    place_verified(&partial, target, hex::encode(digest.finalize()), expected)
}

/// The last gate before a downloaded file becomes the installed one.
///
/// The digest was taken from the bytes as they were written, so it describes
/// what actually arrived rather than what the file says about itself later. On
/// a mismatch nothing is unpacked, nothing is moved, and — the part that
/// matters — the previous working installation is still sitting at `target`
/// untouched, because that file is only removed on the line before the rename.
fn place_verified(
    partial: &Path,
    target: &Path,
    actual: String,
    expected: Option<&str>,
) -> Reported<String> {
    if let Some(expected) = expected {
        if !expected.eq_ignore_ascii_case(&actual) {
            let _ = std::fs::remove_file(partial);
            return Err(UserMessage::new("download.hash_mismatch")
                .with(
                    "file",
                    target.file_name().unwrap_or_default().to_string_lossy(),
                )
                .detail(format!("expected {expected}, got {actual}")));
        }
    }
    if target.exists() {
        let _ = std::fs::remove_file(target);
    }
    std::fs::rename(partial, target)?;
    Ok(actual)
}

// ---------------------------------------------------------------- unpacking

fn extract_zip(archive: &Path, destination: &Path) -> Reported<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file)?;
    for i in 0..zip.len() {
        let mut item = zip.by_index(i)?;
        // `enclosed_name` is None exactly when the entry would land outside the
        // destination: `..`, an absolute path, a drive prefix. Skipping it in
        // silence would unpack the rest of the archive and call it a success;
        // an archive that tries this is not one to install any part of.
        let Some(relative_path) = item.enclosed_name() else {
            return Err(UserMessage::new("download.unsafe_archive_path")
                .with(
                    "archive",
                    archive.file_name().unwrap_or_default().to_string_lossy(),
                )
                .detail(item.name().to_string()));
        };
        let target = destination.join(relative_path);
        if item.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output = std::fs::File::create(&target)?;
        std::io::copy(&mut item, &mut output)?;
    }
    Ok(())
}

/// .tar.bz2 is unpacked by tar.exe, which ships with Windows 10 and later.
fn extract_tar(archive: &Path, destination: &Path) -> Reported<()> {
    std::fs::create_dir_all(destination)?;
    let status = tools::command("tar")
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(destination)
        .status()
        .map_err(|error| UserMessage::new("download.tar_launch_failed").detail(error))?;
    if !status.success() {
        return Err(UserMessage::new("download.extract_failed"));
    }
    Ok(())
}

fn extract(archive: &Path, destination: &Path) -> Reported<()> {
    let name = archive
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if name.ends_with(".zip") {
        extract_zip(archive, destination)
    } else {
        extract_tar(archive, destination)
    }
}

/// Lists file names inside an unpacked archive, for error messages.
fn list_tree(root: &Path, limit: usize) -> Vec<String> {
    let mut output = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(items) = std::fs::read_dir(&directory) else {
            continue;
        };
        for p in items.filter_map(|e| e.ok()) {
            let path = p.path();
            if path.is_dir() {
                pending.push(path);
            } else if output.len() < limit {
                output.push(p.file_name().to_string_lossy().to_string());
            }
        }
    }
    output.sort();
    output
}

/// Picks only the executables and libraries out of the unpacked pile.
/// Archives nest to different depths; this flattens them.
///
/// Returns the file names it wrote, which is what `installed.json` records and
/// the only thing that makes a component sharing the programs root deletable.
/// Names rather than paths: everything lands directly in `destination`, and the
/// record wants them relative to the programs folder anyway.
fn collect_programs(source: &Path, destination: &Path) -> Reported<Vec<String>> {
    std::fs::create_dir_all(destination)?;
    let mut written = Vec::new();
    let mut pending = vec![source.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for item in std::fs::read_dir(&directory)?.filter_map(|e| e.ok()) {
            let path = item.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let extension = path
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if extension == "exe" || extension == "dll" {
                    if let Some(name) = path.file_name() {
                        std::fs::copy(&path, destination.join(name))?;
                        written.push(name.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    // Two archives could hold the same library at two depths, and the second
    // copy would then be recorded twice and deleted twice — the second time
    // through the "already gone is fine" branch, but a record that lists a file
    // twice is a record somebody will one day read as two files.
    written.sort();
    written.dedup();
    Ok(written)
}

// -------------------------------------------------------------- the main run

/// What is known about one installed component.
///
/// `verified` is the honest half: true only when the catalogue named a hash
/// and the download matched it. False means the file arrived over HTTPS from
/// the address the catalogue gave and nothing further was checked — which is
/// what every installation made before this existed is, and why they are not
/// silently promoted.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstallRecord {
    pub url: String,
    pub sha256: String,
    pub verified: bool,
    pub when: String,
    /// Every file this installation wrote, relative to the programs or models
    /// directory exactly as the catalogue writes a path — `bin/ffmpeg.exe`,
    /// `models/ggml-large-v3.bin` — so `tools::component_path` reads them back.
    ///
    /// **This is what makes the shared programs folder deletable.** ffmpeg and
    /// Deno unpack into `bin` beside `yt-dlp.exe` and the build folders;
    /// removing the folder would take every other program with it and removing
    /// only `verification_path` would leave the libraries behind. Neither is
    /// removal, so until this existed neither was offered.
    ///
    /// `None` is not an empty installation — it is an installation made before
    /// the list was written, which is every machine in the world today. Those
    /// records keep loading and the component stays undeletable until it is
    /// fetched again; guessing at the files would be the wrong thing done
    /// confidently.
    #[serde(default)]
    pub files: Option<Vec<String>>,
}

fn record_path(settings: &crate::db::Settings) -> PathBuf {
    tools::component_path(settings, "installed.json")
}

fn read_records(path: &Path) -> std::collections::BTreeMap<String, InstallRecord> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Adds one entry and rewrites the file through a temporary name, so a crash
/// mid-write cannot leave a truncated record that reads as "nothing is
/// installed". A failure to write is deliberately not fatal: the component is
/// installed either way, and refusing the whole download because a note could
/// not be filed would be the worse outcome.
fn record_installation(path: &Path, id: &str, record: InstallRecord) {
    let mut records = read_records(path);
    records.insert(id.to_string(), record);
    let Ok(text) = serde_json::to_string_pretty(&records) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let temporary = path.with_extension("json.psani");
    if std::fs::write(&temporary, text).is_ok() {
        let _ = std::fs::rename(&temporary, path);
    }
}

/* `origin_verified` stood here — one lookup answering whether this machine had
a record that a component's origin was checked. `catalog()` was its only
caller and now reads the whole map once for every row instead of opening the
file fifteen times, so the accessor had nobody left. What it said is still
true and is said by `InstallRecord::verified`: a file sitting in the right
place is not a record of where it came from. */

/// Drops one entry and rewrites the file the way `record_installation` writes
/// it — through a temporary name, so a crash mid-write cannot leave a truncated
/// record that reads as "nothing is installed". Absent is the right state for a
/// component whose files have gone: `origin_verified` then says false, which is
/// what an uninstalled thing is.
fn forget_installation(path: &Path, id: &str) {
    let mut records = read_records(path);
    if records.remove(id).is_none() {
        return;
    }
    let Ok(text) = serde_json::to_string_pretty(&records) else {
        return;
    };
    let temporary = path.with_extension("json.psani");
    if std::fs::write(&temporary, text).is_ok() {
        let _ = std::fs::rename(&temporary, path);
    }
}

/// Exactly what removing a component would delete, or nothing where that
/// cannot be said exactly.
///
/// Three shapes, and the third is the one this used to have no answer for:
///
/// - `AsFile(p)` is one file and always removable;
/// - `ProgramsInto(dir)` unpacks an archive's executables into `dir`. Where
///   that folder is the component's own — `bin/vulkan`, `bin/cuda`, `bin/cpu`,
///   `bin/editor-vulkan`, `bin/editor-cpu` — removing the folder removes
///   exactly what arrived, dlls included, **and the recorded list is
///   deliberately not used for it.** `install_component` copies `main.exe` to
///   `whisper-cli.exe` after the unpacking on older builds, and a list written
///   from what the archive held would miss that copy. The folder cannot;
/// - `ProgramsInto("bin")` — ffmpeg and Deno, which unpack into the shared
///   programs root beside `yt-dlp.exe` and the build folders. Here the
///   destination says nothing about ownership and the **recorded file list is
///   the only answer**. Without one there is none: the folder would take every
///   other program with it and `verification_path` alone would leave the
///   libraries behind, and doing either would be worse than saying no.
///
/// Every path is checked before any of them is deleted, and one bad entry
/// refuses the whole operation. Half a removal is not a removal.
fn removal_plan(
    settings: &crate::db::Settings,
    component: &DownloadComponent,
    record: Option<&InstallRecord>,
) -> Option<Vec<PathBuf>> {
    let relative: Vec<String> = match &component.destination {
        Destination::AsFile(path) => vec![path.clone()],
        Destination::ProgramsInto(directory) if directory != "bin" => vec![directory.clone()],
        // An empty list is treated as no list. Nothing writes one — a component
        // whose archive held no program never reaches `record_installation` —
        // so it could only mean a record edited by hand into meaning nothing.
        Destination::ProgramsInto(_) => match record?.files.as_deref() {
            Some([]) | None => return None,
            Some(files) => files.to_vec(),
        },
    };
    relative
        .iter()
        .map(|path| inside_the_roots(settings, path))
        .collect()
}

/// One path a removal wants to delete, resolved and checked, or `None`.
///
/// The same reasoning as the archive unpacker's `..` refusal, and the same
/// answer: a path that resolves outside the two folders this application owns
/// is not somewhere it may delete from. `components.json` is data a weekly
/// script rewrites and `installed.json` is a file on somebody's disk, so this
/// is a guard about a wrong record rather than a hostile one.
///
/// `..` is refused before anything else, and that order is the point.
/// `Path::starts_with` compares component by component without resolving
/// anything, so `bin/../../outside.exe` starts with `bin` as far as it is
/// concerned and the prefix check alone would wave it through — which is
/// exactly what `a_destination_that_reaches_outside_the_roots_is_refused`
/// caught while it was being written. Nothing here needs `..`, so the honest
/// rule is that a path carrying one is malformed.
fn inside_the_roots(settings: &crate::db::Settings, relative: &str) -> Option<PathBuf> {
    if Path::new(relative)
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return None;
    }
    let resolved = tools::component_path(settings, relative);
    let roots = [
        tools::expand(&settings.bin_directory),
        tools::expand(&settings.models_directory),
    ];
    let inside = roots
        .iter()
        .any(|root| resolved.starts_with(root) && resolved != *root);
    inside.then_some(resolved)
}

/* `can_remove(settings, id)` stood here, answering for one component what
`catalog()` answers for every row. It has moved into the tests, which were
its only caller once the catalogue started reading `installed.json` once for
the whole list instead of once per row. The question it asked is `catalog`'s
`deletable`. */

// ------------------------------------------------------------ what is working

/// What the application is doing this moment, in the only terms this module can
/// act on.
///
/// **The lock asks whether a component is working, not whether it is chosen.**
/// It used to ask the second question — a model named in settings could never
/// be deleted at all — and the owner turned that down: *měl by být všude a
/// zámek jen u těch, které se aktuálně používají. Například když běží převod
/// nebo přepis.* Choosing a model is not using it; a transcription is.
///
/// Each field is read from the registry that already knows, rather than from a
/// second list kept in step by hand: `TranscriptionTask` in
/// `transcription/jobs.rs`, `AiEditTask`, `OnlineImportTask`, the waveform jobs
/// in `main.rs` and the playback conversions in `tools.rs`. `commands/downloads.rs`
/// is where they are gathered, because that is where the app state is.
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Busy {
    /// A recording has a live worker. It may be at any stage — ffmpeg
    /// preparing the sound, whisper decoding it, sherpa comparing voices —
    /// because one worker runs all three in turn and the stage is not recorded.
    pub transcribing: bool,
    /// A document is being written: llama.cpp and the model it loaded.
    pub editing: bool,
    /// Audio is being fetched from the web: yt-dlp, its JavaScript, and ffmpeg
    /// after them.
    pub importing: bool,
    /// ffmpeg on its own — a waveform being measured, or a seekable playback
    /// copy being made. Neither belongs to a transcription.
    pub converting: bool,
}

/// The whisper builds. All of them, deliberately: `choose_compute` picks one
/// when a run starts and the run does not write down which, so the honest
/// answer while a transcription is happening is that any of them might be the
/// one with a file open. They are 17 to 457 MB, and nobody frees a build's
/// worth of disk in the middle of a transcription.
const TRANSCRIPTION_PROGRAMS: [&str; 5] = [
    "whisper-cuda",
    "whisper-vulkan",
    "whisper-cpu",
    "vad",
    "model-hlasy",
];

/// Is this component working right now?
///
/// Windows would answer part of this by itself — a running `.exe` cannot be
/// deleted — but as a refusal partway through a list of files, after some of
/// them have gone. That is not a guard, it is a mess with an error message.
pub fn component_is_busy(settings: &crate::db::Settings, id: &str, busy: Busy) -> bool {
    // Every kind of work in this application passes through ffmpeg: it prepares
    // the sound for whisper, it pulls the audio out of what yt-dlp fetched, it
    // draws the waveform and it makes the seekable playback copy.
    if id == "ffmpeg" && (busy.transcribing || busy.importing || busy.converting) {
        return true;
    }
    if busy.importing && matches!(id, "yt-dlp" | "deno") {
        return true;
    }
    if busy.transcribing {
        if TRANSCRIPTION_PROGRAMS.contains(&id) {
            return true;
        }
        // The model the run resolved. A transcription that started under an
        // older setting is not covered by this and cannot be: nothing records
        // which file a running whisper opened. It is the same file in every
        // case that is not somebody changing the model mid-run.
        if !settings.model.is_empty()
            && installs(id, &format!("models/ggml-{}.bin", settings.model))
        {
            return true;
        }
    }
    if busy.editing {
        if matches!(id, "editor-vulkan" | "editor-cpu") {
            return true;
        }
        // `resolve_editor_model` rather than the stored name, because that is
        // the function which decides what llama.cpp actually loaded — it falls
        // back through the installed qualities when the stored one is not there.
        if let Some((resolved, _)) = tools::resolve_editor_model(settings) {
            if installs(id, &format!("models/editor/{resolved}.gguf")) {
                return true;
            }
        }
    }
    false
}

/// Does this component install exactly that file? Answered on the catalogue's
/// own `AsFile` destination, which is how `check` and `resolve_editor_model`
/// look for these files in the first place.
fn installs(id: &str, relative: &str) -> bool {
    raw_catalog().into_iter().any(|component| {
        component.id == id
            && matches!(&component.destination, Destination::AsFile(path) if path == relative)
    })
}

// ------------------------------------------- the settings after a deletion

/// The model this component installs, in the form the settings hold it:
/// `models/ggml-{name}.bin` → `name`, `models/editor/{id}.gguf` → `id`.
fn model_name(component: &DownloadComponent) -> Option<(&'static str, String)> {
    let Destination::AsFile(path) = &component.destination else {
        return None;
    };
    if let Some(name) = path
        .strip_prefix("models/ggml-")
        .and_then(|rest| rest.strip_suffix(".bin"))
    {
        // Speech detection is a model in a folder of models and is not one the
        // reader ever chooses; `settings.model` never names it.
        if component.group == "model" {
            return Some(("model", name.to_string()));
        }
    }
    path.strip_prefix("models/editor/")
        .and_then(|rest| rest.strip_suffix(".gguf"))
        .map(|name| ("editor", name.to_string()))
}

/// Is this component the model `settings.model` or `editor_model` names?
///
/// It was `component_is_in_use` and it was the lock; it is a sentence in a
/// confirmation now. Being chosen is not being busy — see `Busy`.
pub fn component_is_configured(settings: &crate::db::Settings, id: &str) -> bool {
    let Some(component) = raw_catalog().into_iter().find(|x| x.id == id) else {
        return false;
    };
    match model_name(&component) {
        Some(("model", name)) => !settings.model.is_empty() && settings.model == name,
        Some((_, name)) => !settings.editor_model.is_empty() && settings.editor_model == name,
        None => false,
    }
}

/// Transcription models in the order the setting should fall back through,
/// with the first-run answer first. `accurate` is the order for an empty
/// answer as well: that is what `Settings::default` names.
const ACCURATE_FIRST: [&str; 3] = ["model-large", "model-large-q5", "model-turbo"];
const FAST_FIRST: [&str; 3] = ["model-turbo", "model-large-q5", "model-large"];
/// The language-editing models in the order `resolve_editor_model` falls
/// through, so the setting and the resolver cannot end up naming different
/// files.
const EDITOR_ORDER: [&str; 3] = [
    "editor-model-best",
    "editor-model-balanced",
    "editor-model-light",
];

/// Which component the setting would name instead of `id`.
///
/// `id` is skipped whether or not its files are still on the disk, so the
/// answer is the same asked before the deletion — for the confirmation — and
/// after it, when the setting is written. One question, one answer.
pub fn replacement_component(settings: &crate::db::Settings, id: &str) -> Option<String> {
    let component = raw_catalog().into_iter().find(|x| x.id == id)?;
    let order: &[&str] = match model_name(&component)? {
        ("model", _) if settings.quality_choice == "fast" => &FAST_FIRST,
        ("model", _) => &ACCURATE_FIRST,
        _ => &EDITOR_ORDER,
    };
    let installed = |candidate: &str| {
        raw_catalog()
            .into_iter()
            .find(|x| x.id == candidate)
            .is_some_and(|x| tools::component_path(settings, &x.verification_path).exists())
    };
    order
        .iter()
        .find(|candidate| **candidate != id && installed(candidate))
        .map(|candidate| candidate.to_string())
}

/// The settings record as it must read once `id` has gone, or `None` when
/// nothing it says is affected.
///
/// **A deletion must not leave a setting naming a file that is not there.**
/// `tools.rs` resolves `settings.model` strictly as `ggml-{model}.bin` with no
/// fallback, so a stale name is a transcription that refuses to start — the
/// same failure this branch fixed from the other direction the morning a model
/// was written into settings before it had landed. So the setting either names
/// another installed model or is cleared, and an empty `model` is a state the
/// application already handles: it asks for one.
///
/// `editor_model` is the same question with a softer answer — `resolve_editor_model`
/// already falls back to any installed quality — but it is written for the same
/// reason: a stored name nobody can see and nothing uses is a value that will
/// mislead the next reader of the record.
pub fn settings_after_removal(
    settings: &crate::db::Settings,
    id: &str,
) -> Option<crate::db::Settings> {
    if !component_is_configured(settings, id) {
        return None;
    }
    let component = raw_catalog().into_iter().find(|x| x.id == id)?;
    let replacement = replacement_component(settings, id)
        .and_then(|next| raw_catalog().into_iter().find(|x| x.id == next))
        .and_then(|next| model_name(&next).map(|(_, name)| name))
        .unwrap_or_default();
    let mut repaired = settings.clone();
    match model_name(&component)? {
        ("model", _) => repaired.model = replacement,
        _ => repaired.editor_model = replacement,
    }
    Some(repaired)
}

/// Removes one installed component and forgets its record.
///
/// Deliberately not "delete the folder it lives in" — see `removal_plan`. A
/// component that is already gone is a success rather than an error: the caller
/// asked for it not to be there, and it is not there.
pub fn remove_component(settings: &crate::db::Settings, id: &str) -> Reported<()> {
    let component = raw_catalog()
        .into_iter()
        .find(|x| x.id == id)
        .ok_or_else(|| UserMessage::new("download.unknown_component").with("component", id))?;

    let records = read_records(&record_path(settings));
    let paths = removal_plan(settings, &component, records.get(id))
        .ok_or_else(|| UserMessage::new("download.cannot_remove").with("component", id))?;

    for path in paths {
        let outcome = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else if path.is_file() {
            std::fs::remove_file(&path)
        } else {
            Ok(())
        };
        outcome.map_err(|e| {
            UserMessage::new("download.remove_failed")
                .with("component", id)
                .with("detail", e.to_string())
        })?;
    }

    forget_installation(&record_path(settings), id);
    Ok(())
}

pub fn install_component(
    app: &AppHandle,
    settings: &crate::db::Settings,
    id: &str,
    cancellation: Arc<AtomicBool>,
) -> Reported<()> {
    let component = raw_catalog()
        .into_iter()
        .find(|x| x.id == id)
        .ok_or_else(|| UserMessage::new("download.unknown_component").with("component", id))?;

    // The destination follows the settings rather than a fixed folder;
    // otherwise downloads would land somewhere the app never looks.
    let destination = |rel: &str| tools::component_path(settings, rel);

    emit_progress(
        app,
        DownloadProgress {
            id: id.into(),
            phase: "downloading".into(),
            downloaded_mb: 0.0,
            total_mb: component.megabytes as f64,
            percent: 0,
            message: Some(UserMessage::new("download.connecting")),
        },
    );

    let url = resolve_url(&component.source);
    let expected = expected_hash(&component.id);
    // The digest of what actually arrived, whether or not anything was
    // expected. It goes into the record so that a later version, once the
    // catalogue names a hash, can tell what this machine already has.
    let installed: String;
    // And what it wrote, relative to the programs or models folder. Gathered
    // here rather than worked out later from the destination, because for a
    // component unpacking into the shared programs root this is the only thing
    // that will ever be able to say which files are its own.
    let mut files: Vec<String>;

    match &component.destination {
        Destination::AsFile(rel) => {
            installed = download_file(app, id, &url, &destination(rel), expected, &cancellation)?;
            files = vec![rel.clone()];
        }
        Destination::ProgramsInto(rel) => {
            let temporary_directory = std::env::temp_dir().join("whisp-downloads");
            std::fs::create_dir_all(&temporary_directory)?;

            // File name taken from the URL. It shows up in errors; without
            // it there is no telling whether the right build was picked.
            let name = url.rsplit('/').next().unwrap_or("archiv.zip");
            let archive = temporary_directory.join(name);
            installed = download_file(app, id, &url, &archive, expected, &cancellation)?;

            emit_progress(
                app,
                DownloadProgress {
                    id: id.into(),
                    phase: "extracting".into(),
                    downloaded_mb: component.megabytes as f64,
                    total_mb: component.megabytes as f64,
                    percent: 100,
                    message: Some(UserMessage::new("download.extracting")),
                },
            );

            let extracted = temporary_directory.join(format!("{id}-vybaleno"));
            let _ = std::fs::remove_dir_all(&extracted);
            extract(&archive, &extracted)?;
            let names = collect_programs(&extracted, &destination(rel))?;
            files = names.iter().map(|name| format!("{rel}/{name}")).collect();
            if names.is_empty() {
                let contents = list_tree(&extracted, 12);
                let _ = std::fs::remove_dir_all(&extracted);
                let message = if contents.is_empty() {
                    UserMessage::new("download.archive_without_programs_empty")
                } else {
                    UserMessage::new("download.archive_without_programs")
                        .with("contents", contents.join(", "))
                };
                return Err(message.with("archive", name));
            }
            let _ = std::fs::remove_dir_all(&extracted);
            let _ = std::fs::remove_file(&archive);
        }
    }

    // Older whisper.cpp builds have main.exe instead of whisper-cli.exe.
    if let Destination::ProgramsInto(rel) = &component.destination {
        let directory = destination(rel);
        let cli = directory.join("whisper-cli.exe");
        let main = directory.join("main.exe");
        // Written after the unpacking, so it is not in what the archive held —
        // and a file list that misses a file this installation wrote is a
        // removal that leaves something behind.
        if !cli.exists() && main.exists() && std::fs::copy(&main, &cli).is_ok() {
            files.push(format!("{rel}/whisper-cli.exe"));
        }
    }

    if !destination(&component.verification_path).exists() {
        // Report what the archive actually held. Without it this failure is
        // debugged blind and costs a needless round of questions.
        let position = destination(&component.verification_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| destination(""));

        let mut found: Vec<String> = std::fs::read_dir(&position)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.to_lowercase().ends_with(".exe"))
            .collect();
        found.sort();

        let message = if found.is_empty() {
            UserMessage::new("download.file_not_in_archive_empty")
        } else {
            UserMessage::new("download.file_not_in_archive").with("programs", found.join(", "))
        };
        return Err(message.with("file", &component.verification_path));
    }

    // Written only here, after the file is verified, unpacked and found where
    // it belongs. A half-finished install therefore leaves no record, which is
    // the whole point: the presence of a file says a file is present, and this
    // says who vouched for it.
    record_installation(
        &record_path(settings),
        &component.id,
        InstallRecord {
            url: url.clone(),
            sha256: installed,
            verified: expected.is_some(),
            when: chrono::Local::now().to_rfc3339(),
            files: Some(files),
        },
    );

    emit_progress(
        app,
        DownloadProgress {
            id: id.into(),
            phase: "complete".into(),
            downloaded_mb: component.megabytes as f64,
            total_mb: component.megabytes as f64,
            percent: 100,
            message: None,
        },
    );
    Ok(())
}

/// What is being fetched this moment, and what follows it.
///
/// **One worker, a shared queue, and nothing is refused.** Until 2026-08-17
/// this was a single `AtomicBool` and a second call was an error —
/// *Stahování už probíhá, počkejte na jeho dokončení*, in red, for the ordinary
/// act of pressing a second row while the first one is still coming down.
///
/// The flag was right about the danger it named: two threads fetching the same
/// component write the same file and both report progress for the same id,
/// which is what made the bar jump between two values. But that danger is about
/// the destination, and a queue answers it as completely as a refusal does —
/// while also answering what the reader was asking for. An id that is already
/// `current` or already in `queue` is dropped rather than added, so the
/// protection is kept exactly; anything else joins the end.
///
/// One worker rather than several on purpose: these are gigabytes over one
/// connection, and two of them at once finish at the same moment rather than
/// sooner, with neither progress bar meaning anything on the way.
struct Work {
    /// A worker thread is alive and taking from `queue`.
    running: bool,
    /// Which worker this state belongs to, counted up once per worker started.
    ///
    /// Only the panic guard reads it, and it is the difference between a guard
    /// and a hazard: a worker finishes by lowering `running`, which lets the
    /// next call start a worker immediately — and the finishing thread's
    /// clean-up then runs *after* that, with the queue of a run it has nothing
    /// to do with in front of it.
    generation: u64,
    /// What that thread has in hand, `None` between two components.
    current: Option<String>,
    /// What it will take next, in the order asked for.
    queue: std::collections::VecDeque<String>,
}

static WORK: std::sync::Mutex<Work> = std::sync::Mutex::new(Work {
    running: false,
    generation: 0,
    current: None,
    queue: std::collections::VecDeque::new(),
});

/// Whether anything is being fetched right now.
///
/// `remove_component` asks it: the installer writes through temporary names and
/// renames into place, and deleting underneath that is the one way to get a
/// half-installed component that still records itself as complete.
pub fn is_installing() -> bool {
    WORK.lock().unwrap().running
}

/// What happened to the ids handed in.
#[derive(Debug, PartialEq, Eq)]
pub enum Queued {
    /// Nothing was running; a worker was started for them.
    Started,
    /// A run was already going and they joined the end of it.
    Appended,
    /// Every one of them is already in hand or already waiting. Not a failure:
    /// the errand being asked for is under way.
    Nothing,
}

/// Puts a list of components in line to be installed, starting a worker if none
/// is running.
///
/// **The cancellation flag is cleared here rather than by the caller**, and only
/// on the branch that starts a worker. Clearing it on the way in to every call
/// is the older defect from the other side: pressing Stop and then asking for
/// something else wiped the stop request the running worker was watching.
///
/// The worker keeps the `settings` of the call that started it, so components
/// appended later land in the folders named when the run began. Those are the
/// program and model directories, which a person changes by moving their whole
/// installation — not something done between two clicks of a download.
pub fn install_bundle(
    app: AppHandle,
    settings: crate::db::Settings,
    ids: Vec<String>,
    cancellation: Arc<AtomicBool>,
) -> Queued {
    let (outcome, accepted, generation) = {
        let mut work = WORK.lock().unwrap();
        let mut accepted: Vec<String> = Vec::new();
        for id in ids {
            let known = work.current.as_deref() == Some(id.as_str()) || work.queue.contains(&id);
            if !known {
                work.queue.push_back(id.clone());
                accepted.push(id);
            }
        }
        if accepted.is_empty() {
            return Queued::Nothing;
        }
        if work.running {
            (Queued::Appended, accepted, work.generation)
        } else {
            work.running = true;
            work.generation += 1;
            cancellation.store(false, Ordering::SeqCst);
            (Queued::Started, accepted, work.generation)
        }
    };

    // Said for every one of them, including the one about to start: a row that
    // reports nothing after being pressed reads as a press that missed, and
    // that is what the refusal used to be covering up with a red bar.
    for id in accepted {
        emit_progress(
            &app,
            DownloadProgress {
                id,
                phase: "waiting".into(),
                downloaded_mb: 0.0,
                total_mb: 0.0,
                percent: 0,
                message: None,
            },
        );
    }

    if outcome == Queued::Appended {
        return outcome;
    }

    std::thread::spawn(move || {
        // Whatever happens below, the run ends — including on a panic, which is
        // why it is a guard and not a line at the end. It empties the queue as
        // well as lowering the flag: a worker that died holding work would
        // otherwise leave that work behind for a later run to inherit silently.
        struct Done(u64);
        impl Drop for Done {
            fn drop(&mut self) {
                let mut work = WORK.lock().unwrap();
                if work.generation != self.0 {
                    return;
                }
                work.running = false;
                work.current = None;
                work.queue.clear();
            }
        }
        let _done = Done(generation);

        // What did not land. `download:complete` carries it, because the
        // window cannot work it out for itself: the batch stops on a
        // cancellation, and a component that was never attempted has no
        // phase at all — indistinguishable from one that is still going.
        let mut unfinished: Vec<String> = Vec::new();
        loop {
            // Taking the next one and finding there is no next one are the same
            // decision and are made under one lock. Split in two they are a
            // race: a call arriving between them would see `running` still true,
            // add to a queue nobody is reading any more, and be fetched by
            // nothing.
            let next = {
                let mut work = WORK.lock().unwrap();
                let taken = work.queue.pop_front();
                if taken.is_none() {
                    work.running = false;
                }
                work.current = taken.clone();
                taken
            };
            let Some(id) = next else { break };

            if cancellation.load(Ordering::Relaxed) {
                // Cancelling stops the whole run, so everything still waiting is
                // unfinished — not only the component that was interrupted.
                let rest: Vec<String> = {
                    let mut work = WORK.lock().unwrap();
                    work.running = false;
                    work.current = None;
                    work.queue.drain(..).collect()
                };
                for pending in std::iter::once(id).chain(rest) {
                    emit_progress(
                        &app,
                        DownloadProgress {
                            id: pending.clone(),
                            phase: "cancelled".into(),
                            downloaded_mb: 0.0,
                            total_mb: 0.0,
                            percent: 0,
                            message: Some(UserMessage::new("download.cancelled")),
                        },
                    );
                    unfinished.push(pending);
                }
                break;
            }
            if let Err(e) = install_component(&app, &settings, &id, cancellation.clone()) {
                emit_progress(
                    &app,
                    DownloadProgress {
                        id: id.clone(),
                        phase: if cancellation.load(Ordering::Relaxed) {
                            "cancelled"
                        } else {
                            "error"
                        }
                        .into(),
                        downloaded_mb: 0.0,
                        total_mb: 0.0,
                        percent: 0,
                        message: Some(e),
                    },
                );
                unfinished.push(id);
            }
        }
        let _ = app.emit("download:complete", unfinished);
    });
    outcome
}

// ---------------------------------------------------------------- portable copy

/// Copies the program, the tools and the models into a chosen folder and marks
/// it portable. This replaces a build script — the reader only picks the stick.
pub fn create_portable_copy(
    app: &AppHandle,
    settings: &crate::db::Settings,
    destination: &Path,
) -> Result<u64> {
    std::fs::create_dir_all(destination)?;

    // The name follows productName, so a later rename of the application
    // cannot leave the portable copy running under the previous one — which
    // is exactly what happened when Whisp became Volocal.
    let executable = format!("{}.exe", app.package_info().name);
    let program = std::env::current_exe()?;
    std::fs::copy(&program, destination.join(&executable))?;

    // WebView2, if this machine carries a copy of it.
    let wv = tools::app_directory().join("webview2");
    if wv.is_dir() {
        copy_tree(app, &wv, &destination.join("webview2"))?;
    }

    let mut bytes_copied = 0;
    for directory in ["bin", "models"] {
        // the source follows the settings; the destination is always bin\
        // and models\ next to the executable, because portable mode relies
        // on relative paths
        let source = tools::component_path(settings, directory);
        if source.is_dir() {
            bytes_copied += copy_tree(app, &source, &destination.join(directory))?;
        }
    }

    std::fs::create_dir_all(destination.join("data"))?;
    std::fs::write(
        destination.join("prenosna.txt"),
        format!(
            "Podle tohoto souboru {} pozná, že má všechno hledat u sebe\r\n\
             a nic nezapisovat do počítače. Nemazat.\r\n",
            app.package_info().name
        ),
    )?;

    Ok(bytes_copied)
}

fn copy_tree(app: &AppHandle, source: &Path, destination: &Path) -> Result<u64> {
    std::fs::create_dir_all(destination)?;
    let mut bytes_copied = 0u64;
    for item in std::fs::read_dir(source)?.filter_map(|e| e.ok()) {
        let source = item.path();
        let target = destination.join(item.file_name());
        if source.is_dir() {
            bytes_copied += copy_tree(app, &source, &target)?;
        } else {
            let _ = app.emit("copy:file", item.file_name().to_string_lossy().to_string());
            bytes_copied += std::fs::copy(&source, &target)?;
        }
    }
    Ok(bytes_copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The decision `install_bundle` makes before it touches a thread: what is
    /// new, what is already in hand, and whether a worker has to be started.
    ///
    /// Written against `WORK` directly because the rest of that function needs
    /// an `AppHandle` and a network. What is being pinned is the part that
    /// answers the reported defect — *nejde to prostě jen přidat do fronty?* —
    /// and the part that must survive it: one component is never taken twice.
    /// `WORK` is one static for the whole process and these two tests write it,
    /// so they take turns. Always this lock first and `WORK` second.
    static ORDER: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Back to nothing running, so neither test inherits the other's state.
    fn idle() {
        let mut work = WORK.lock().unwrap();
        work.running = false;
        work.current = None;
        work.queue.clear();
    }

    fn admit(ids: &[&str]) -> (Queued, Vec<String>) {
        let mut work = WORK.lock().unwrap();
        let mut accepted = Vec::new();
        for id in ids {
            let id = (*id).to_string();
            if work.current.as_deref() == Some(id.as_str()) || work.queue.contains(&id) {
                continue;
            }
            work.queue.push_back(id.clone());
            accepted.push(id);
        }
        if accepted.is_empty() {
            return (Queued::Nothing, accepted);
        }
        if work.running {
            (Queued::Appended, accepted)
        } else {
            work.running = true;
            work.generation += 1;
            (Queued::Started, accepted)
        }
    }

    /// The reported defect: pressing a second row while the first was coming
    /// down produced *Stahování už probíhá, počkejte na jeho dokončení* in red.
    /// It is a queue now, and only genuine duplicates are dropped.
    #[test]
    fn a_second_ask_joins_the_queue_and_only_duplicates_are_dropped() {
        let _order = ORDER.lock().unwrap_or_else(|e| e.into_inner());
        idle();
        assert!(!is_installing(), "nothing running to begin with");

        let (first, accepted) = admit(&["model-turbo"]);
        assert_eq!(
            first,
            Queued::Started,
            "nothing was running, so this starts"
        );
        assert_eq!(accepted, vec!["model-turbo".to_string()]);
        assert!(is_installing());

        let (second, accepted) = admit(&["editor-model-small"]);
        assert_eq!(
            second,
            Queued::Appended,
            "a different component waits its turn"
        );
        assert_eq!(accepted, vec!["editor-model-small".to_string()]);

        // The whole reason the refusal existed: one component, one fetch.
        assert_eq!(admit(&["editor-model-small"]).0, Queued::Nothing);

        // And that holds for the one in hand as well as the ones still waiting.
        {
            let mut work = WORK.lock().unwrap();
            let taken = work.queue.pop_front();
            work.current = taken;
        }
        assert_eq!(
            admit(&["model-turbo"]).0,
            Queued::Nothing,
            "in hand, not new"
        );
        let (mixed, accepted) = admit(&["model-turbo", "vad"]);
        assert_eq!(mixed, Queued::Appended, "one known, one new");
        assert_eq!(accepted, vec!["vad".to_string()], "and only the new one");

        idle();
        assert!(!is_installing(), "the flag comes down when the run ends");
        assert_eq!(admit(&["model-turbo"]).0, Queued::Started);
        idle();
    }

    /// A worker lowers `running` before its own clean-up runs, so the next call
    /// may start a worker in between. The clean-up must then leave that run
    /// alone — without the generation it emptied a queue it had never seen.
    #[test]
    fn a_finished_workers_cleanup_leaves_the_run_that_replaced_it_alone() {
        let _order = ORDER.lock().unwrap_or_else(|e| e.into_inner());
        idle();
        let mine = {
            let (_, _) = admit(&["vad"]);
            WORK.lock().unwrap().generation
        };
        // The first worker reaches the end of its queue.
        idle();
        // A second call gets in before the first worker's guard has run.
        assert_eq!(admit(&["model-large"]).0, Queued::Started);

        // Now the guard: same code, one generation behind.
        {
            let mut work = WORK.lock().unwrap();
            if work.generation == mine {
                work.running = false;
                work.queue.clear();
            }
        }
        let work = WORK.lock().unwrap();
        assert!(work.running, "the newer run is still running");
        assert_eq!(
            work.queue.len(),
            1,
            "and still holds what it was asked to fetch"
        );
        drop(work);
        idle();
    }

    /// A scratch directory of this test's own, removed on the way in so a
    /// previous run cannot decide the result.
    ///
    /// It is also the tools root for the rest of this test, which is what makes
    /// `installed.json` this test's own. Settings name `bin` and `models` and
    /// nothing else, so before this the records went to the machine's real root
    /// however carefully the settings were built — see
    /// `tools::use_tools_root_for_this_test`.
    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("volocal-test-{name}"));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("scratch");
        crate::tools::use_tools_root_for_this_test(&directory);
        directory
    }

    fn sha256_of(bytes: &[u8]) -> String {
        let mut digest = Sha256::new();
        digest.update(bytes);
        hex::encode(digest.finalize())
    }

    /// The published vector for the empty input. If this fails, the digest is
    /// not SHA-256 and nothing else in this file means anything.
    #[test]
    fn the_digest_is_sha256() {
        assert_eq!(
            sha256_of(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_of(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_matching_hash_lets_the_file_through() {
        let directory = scratch("hash-ok");
        let partial = directory.join("model.bin.cast");
        let target = directory.join("model.bin");
        std::fs::write(&partial, b"abc").unwrap();

        let expected = sha256_of(b"abc");
        let hash = place_verified(&partial, &target, sha256_of(b"abc"), Some(&expected))
            .expect("a file that matches is installed");

        assert_eq!(hash, sha256_of(b"abc"));
        assert!(target.exists(), "it is in its place");
        assert!(!partial.exists(), "and the temporary name is gone");
    }

    /// One byte. The whole point of the check.
    #[test]
    fn a_single_changed_byte_stops_the_installation() {
        let directory = scratch("hash-bad");
        let partial = directory.join("model.bin.cast");
        let target = directory.join("model.bin");
        std::fs::write(&partial, b"abd").unwrap();

        let expected = sha256_of(b"abc");
        let refusal = place_verified(&partial, &target, sha256_of(b"abd"), Some(&expected));

        assert!(refusal.is_err(), "a file that does not match is refused");
        assert!(!target.exists(), "and never reaches its place");
        assert!(!partial.exists(), "the download is thrown away");
    }

    /// The failure that matters more than refusing the bad file: somebody with
    /// a working installation must not be left without one.
    #[test]
    fn a_mismatch_keeps_the_previous_working_file() {
        let directory = scratch("hash-keeps");
        let partial = directory.join("model.bin.cast");
        let target = directory.join("model.bin");
        std::fs::write(&target, b"the model that works").unwrap();
        std::fs::write(&partial, b"something else").unwrap();

        let refusal = place_verified(
            &partial,
            &target,
            sha256_of(b"something else"),
            Some(&sha256_of(b"abc")),
        );

        assert!(refusal.is_err());
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"the model that works",
            "the installation that was working is still there"
        );
    }

    /// Nothing expected means nothing checked — but the digest of what arrived
    /// is still reported, so the record can say what this machine has.
    #[test]
    fn with_no_expected_hash_the_file_is_installed_and_still_measured() {
        let directory = scratch("hash-none");
        let partial = directory.join("model.bin.cast");
        let target = directory.join("model.bin");
        std::fs::write(&partial, b"abc").unwrap();

        let hash = place_verified(&partial, &target, sha256_of(b"abc"), None).unwrap();

        assert_eq!(hash, sha256_of(b"abc"));
        assert!(target.exists());
    }

    /// May the bin be offered for this component at all, ignoring what is
    /// running? It is what `catalog()` asks per row, asked here of one
    /// component — the tests are the only caller left since the catalogue
    /// started reading `installed.json` once for the whole list.
    fn can_remove(settings: &crate::db::Settings, id: &str) -> bool {
        let records = read_records(&record_path(settings));
        raw_catalog()
            .iter()
            .find(|x| x.id == id)
            .and_then(|component| removal_plan(settings, component, records.get(id)))
            .is_some()
    }

    /// Settings pointing both roots at a scratch folder, so a test deletes only
    /// inside its own directory and never inside a real installation.
    fn machine_at(directory: &Path) -> crate::db::Settings {
        crate::db::Settings {
            bin_directory: directory.join("bin").to_string_lossy().to_string(),
            models_directory: directory.join("models").to_string_lossy().to_string(),
            model: String::new(),
            editor_model: String::new(),
            ..Default::default()
        }
    }

    /// The ordinary case, and the one worth the most: a multi-gigabyte model is
    /// one file, and removing it takes the file and the record together. A
    /// record left behind would keep `origin_verified` saying this machine
    /// vouched for something that is not there.
    #[test]
    fn removing_a_component_takes_its_file_and_its_record() {
        let directory = scratch("remove-file");
        let settings = machine_at(&directory);
        let model = directory.join("models").join("ggml-large-v3.bin");
        std::fs::create_dir_all(model.parent().unwrap()).unwrap();
        std::fs::write(&model, b"weights").unwrap();

        let records = record_path(&settings);
        record_installation(
            &records,
            "model-large",
            InstallRecord {
                url: "https://example.invalid/large.bin".into(),
                sha256: sha256_of(b"weights"),
                verified: true,
                when: "2026-08-14".into(),
                files: Some(vec!["models/ggml-large-v3.bin".into()]),
            },
        );
        assert!(read_records(&records)["model-large"].verified);

        remove_component(&settings, "model-large").expect("removed");

        assert!(!model.exists(), "the file is gone");
        assert!(
            !read_records(&records).contains_key("model-large"),
            "and so is the record that vouched for it"
        );
    }

    /// A graphics build is a folder of executables and dlls, and removing only
    /// the one file `verification_path` names would leave hundreds of megabytes
    /// of libraries behind — the space somebody pressed the bin to get back.
    #[test]
    fn removing_a_build_takes_the_whole_folder_it_unpacked_into() {
        let directory = scratch("remove-folder");
        let settings = machine_at(&directory);
        let build = directory.join("bin").join("cuda");
        std::fs::create_dir_all(&build).unwrap();
        std::fs::write(build.join("whisper-cli.exe"), b"program").unwrap();
        std::fs::write(build.join("cublas64_12.dll"), b"library").unwrap();

        remove_component(&settings, "whisper-cuda").expect("removed");

        assert!(!build.exists(), "the folder and everything in it");
        assert!(
            directory.join("bin").exists(),
            "and nothing above it: the other builds live beside this one"
        );
    }

    /// Asking for something that is not there is what the caller wanted anyway.
    /// It is a success rather than an error, so a row whose files were deleted
    /// by hand does not leave a bin that reports a failure for ever.
    #[test]
    fn removing_what_is_not_installed_is_not_a_failure() {
        let directory = scratch("remove-absent");
        let settings = machine_at(&directory);

        remove_component(&settings, "model-turbo").expect("nothing to do, and that is fine");

        assert!(!directory
            .join("models")
            .join("ggml-large-v3-turbo-q5_0.bin")
            .exists());
    }

    /// A record made before file lists existed, which is every machine in the
    /// world on the day this shipped. The two programs that unpack into the
    /// shared `bin` root cannot be told apart from their neighbours without
    /// one, so the bin stays off those rows and the row says why.
    #[test]
    fn a_component_sharing_the_programs_root_is_not_removable_without_a_file_list() {
        let directory = scratch("remove-shared");
        let settings = machine_at(&directory);
        let bin = directory.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("ffmpeg.exe"), b"program").unwrap();
        std::fs::write(bin.join("yt-dlp.exe"), b"another component").unwrap();
        // The shape of an older installation: a record with everything except
        // the list of files.
        record_installation(
            &record_path(&settings),
            "ffmpeg",
            InstallRecord {
                url: "https://example.invalid/ffmpeg.zip".into(),
                sha256: sha256_of(b"program"),
                verified: true,
                when: "2026-08-01".into(),
                files: None,
            },
        );

        assert!(!can_remove(&settings, "ffmpeg"), "not offered");
        assert!(
            remove_component(&settings, "ffmpeg").is_err(),
            "and refused"
        );
        assert!(
            bin.join("yt-dlp.exe").exists(),
            "the neighbour that would have gone with the folder is untouched"
        );
        assert!(bin.join("ffmpeg.exe").exists(), "and so is ffmpeg itself");
        assert!(can_remove(&settings, "yt-dlp"), "a single file still is");

        let row = catalog(&settings, Busy::default())
            .into_iter()
            .find(|x| x.id == "ffmpeg")
            .unwrap();
        assert!(row.complete && !row.removable);
        assert_eq!(
            row.remove_block.as_deref(),
            Some("unlisted"),
            "the row shows a lock and says which kind of lock it is"
        );
        assert!(
            row.replaceable,
            "and it may still be fetched again — which is what makes it removable afterwards"
        );
    }

    /// The fix for the row above: fetch it again, and the installation writes
    /// down what it wrote. Only those files go, and the neighbours in the
    /// shared folder stay.
    #[test]
    fn a_recorded_file_list_is_what_makes_the_shared_folder_removable() {
        let directory = scratch("remove-listed");
        let settings = machine_at(&directory);
        let bin = directory.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        for name in ["ffmpeg.exe", "ffprobe.exe", "ffplay.exe"] {
            std::fs::write(bin.join(name), b"ffmpeg's own").unwrap();
        }
        std::fs::write(bin.join("yt-dlp.exe"), b"another component").unwrap();
        std::fs::create_dir_all(bin.join("cpu")).unwrap();
        std::fs::write(bin.join("cpu").join("whisper-cli.exe"), b"a build").unwrap();

        record_installation(
            &record_path(&settings),
            "ffmpeg",
            InstallRecord {
                url: "https://example.invalid/ffmpeg.zip".into(),
                sha256: sha256_of(b"ffmpeg's own"),
                verified: true,
                when: "2026-08-14".into(),
                files: Some(vec![
                    "bin/ffmpeg.exe".into(),
                    "bin/ffprobe.exe".into(),
                    "bin/ffplay.exe".into(),
                ]),
            },
        );

        assert!(can_remove(&settings, "ffmpeg"), "offered now");
        remove_component(&settings, "ffmpeg").expect("removed");

        for name in ["ffmpeg.exe", "ffprobe.exe", "ffplay.exe"] {
            assert!(!bin.join(name).exists(), "{name} was ffmpeg's and is gone");
        }
        assert!(
            bin.join("yt-dlp.exe").exists(),
            "the neighbour in the same folder is untouched"
        );
        assert!(
            bin.join("cpu").join("whisper-cli.exe").exists(),
            "and so is the build folder inside it"
        );
        assert!(
            bin.exists(),
            "the folder itself stays: other components live in it"
        );
    }

    /// The same reasoning as the archive unpacker's `..` refusal: a path that
    /// resolves outside the two folders this application owns is not somewhere
    /// it may delete from. `components.json` is rewritten weekly by a script and
    /// `installed.json` is a file on somebody's disk, so this is a guard about a
    /// wrong record rather than a hostile one.
    #[test]
    fn a_destination_that_reaches_outside_the_roots_is_refused() {
        let directory = scratch("remove-escape");
        let settings = machine_at(&directory);
        let outside = directory.join("outside.exe");
        std::fs::write(&outside, b"not ours").unwrap();

        let escaping = DownloadComponent {
            destination: Destination::AsFile("bin/../../outside.exe".into()),
            ..raw_catalog()
                .into_iter()
                .find(|x| x.id == "yt-dlp")
                .unwrap()
        };

        assert!(
            removal_plan(&settings, &escaping, None).is_none(),
            "the path is refused before anything is deleted"
        );
        assert!(
            outside.exists(),
            "and the file outside the roots is untouched"
        );
    }

    /// The file list is read off the disk, so it is exactly as trustworthy as
    /// the disk. One entry reaching outside refuses the **whole** removal:
    /// deleting the sound ones first and then stopping is not a removal, it is
    /// a mess with an error message.
    #[test]
    fn one_recorded_file_outside_the_roots_refuses_the_whole_removal() {
        let directory = scratch("remove-escape-list");
        let settings = machine_at(&directory);
        let bin = directory.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("ffmpeg.exe"), b"program").unwrap();
        let outside = directory.join("outside.exe");
        std::fs::write(&outside, b"not ours").unwrap();

        record_installation(
            &record_path(&settings),
            "ffmpeg",
            InstallRecord {
                url: "https://example.invalid/ffmpeg.zip".into(),
                sha256: sha256_of(b"program"),
                verified: true,
                when: "2026-08-14".into(),
                files: Some(vec![
                    "bin/ffmpeg.exe".into(),
                    "bin/../../outside.exe".into(),
                ]),
            },
        );

        assert!(!can_remove(&settings, "ffmpeg"));
        assert!(remove_component(&settings, "ffmpeg").is_err());
        assert!(outside.exists(), "nothing outside the roots was touched");
        assert!(
            bin.join("ffmpeg.exe").exists(),
            "and the sound half was not deleted on the way to refusing"
        );
    }

    /// **The lock is about work, not about a setting.** The model named in
    /// settings may be deleted while nothing is running — that is the whole of
    /// what the owner asked for — and the row that says so is the one below.
    #[test]
    fn the_chosen_model_may_go_while_nothing_is_running() {
        let directory = scratch("busy-idle");
        let mut settings = machine_at(&directory);
        settings.model = "large-v3".into();
        settings.editor_model = "gemma-4-12b-q4".into();
        let models = directory.join("models");
        std::fs::create_dir_all(models.join("editor")).unwrap();
        std::fs::write(models.join("ggml-large-v3.bin"), b"weights").unwrap();
        std::fs::write(models.join("editor").join("gemma-4-12b-q4.gguf"), b"w").unwrap();

        let idle = Busy::default();
        assert!(!component_is_busy(&settings, "model-large", idle));
        assert!(!component_is_busy(&settings, "editor-model-best", idle));

        let row = catalog(&settings, idle)
            .into_iter()
            .find(|x| x.id == "model-large")
            .unwrap();
        assert!(row.removable, "the bin is drawn on the model in use");
        assert_eq!(row.remove_block, None);
        assert!(row.configured, "and the confirmation will say so");
    }

    /// And while something is running, everything that run touches is locked —
    /// the model, the builds, speech detection, the voices, and ffmpeg.
    #[test]
    fn a_running_transcription_locks_what_it_is_working_with() {
        let directory = scratch("busy-transcribing");
        let mut settings = machine_at(&directory);
        settings.model = "large-v3".into();
        let busy = Busy {
            transcribing: true,
            ..Busy::default()
        };

        for id in ["model-large", "ffmpeg", "vad", "model-hlasy", "whisper-cpu"] {
            assert!(component_is_busy(&settings, id, busy), "{id} is working");
        }
        assert!(
            !component_is_busy(&settings, "model-turbo", busy),
            "a model this run is not using may still go"
        );
        assert!(
            !component_is_busy(&settings, "yt-dlp", busy),
            "and so may a program no part of a transcription touches"
        );

        let models = directory.join("models");
        std::fs::create_dir_all(&models).unwrap();
        std::fs::write(models.join("ggml-large-v3.bin"), b"weights").unwrap();
        let row = catalog(&settings, busy)
            .into_iter()
            .find(|x| x.id == "model-large")
            .unwrap();
        assert!(!row.removable);
        assert_eq!(row.remove_block.as_deref(), Some("busy"));
        assert!(
            !row.replaceable,
            "and it must not be fetched over itself either: that renames a file whisper has open"
        );
    }

    /// The other three kinds of work, each locking its own tools and nothing
    /// else. A conversion is the case the owner named — *když běží převod* —
    /// and it belongs to ffmpeg alone.
    #[test]
    fn each_kind_of_work_locks_only_its_own_tools() {
        let directory = scratch("busy-others");
        let mut settings = machine_at(&directory);
        settings.editor_model = "gemma-4-12b-q4".into();
        std::fs::create_dir_all(directory.join("models").join("editor")).unwrap();
        std::fs::write(
            directory
                .join("models")
                .join("editor")
                .join("gemma-4-12b-q4.gguf"),
            b"weights",
        )
        .unwrap();

        let converting = Busy {
            converting: true,
            ..Busy::default()
        };
        assert!(component_is_busy(&settings, "ffmpeg", converting));
        assert!(!component_is_busy(&settings, "model-large", converting));

        let importing = Busy {
            importing: true,
            ..Busy::default()
        };
        for id in ["yt-dlp", "deno", "ffmpeg"] {
            assert!(component_is_busy(&settings, id, importing), "{id}");
        }
        assert!(!component_is_busy(&settings, "vad", importing));

        let editing = Busy {
            editing: true,
            ..Busy::default()
        };
        for id in ["editor-cpu", "editor-vulkan", "editor-model-best"] {
            assert!(component_is_busy(&settings, id, editing), "{id}");
        }
        assert!(
            !component_is_busy(&settings, "ffmpeg", editing),
            "language editing reads text and touches no sound"
        );
    }

    /// Deleting the chosen model must leave the settings naming something that
    /// is there. `tools.rs` resolves `ggml-{model}.bin` with no fallback, so a
    /// stale name is a transcription that refuses to start.
    #[test]
    fn deleting_the_chosen_model_points_the_setting_at_one_that_is_installed() {
        let directory = scratch("settings-after");
        let mut settings = machine_at(&directory);
        settings.model = "large-v3".into();
        let models = directory.join("models");
        std::fs::create_dir_all(&models).unwrap();
        std::fs::write(models.join("ggml-large-v3.bin"), b"weights").unwrap();
        std::fs::write(models.join("ggml-large-v3-turbo-q5_0.bin"), b"weights").unwrap();

        assert_eq!(
            replacement_component(&settings, "model-large").as_deref(),
            Some("model-turbo")
        );
        let repaired = settings_after_removal(&settings, "model-large").expect("a value changed");
        assert_eq!(repaired.model, "large-v3-turbo-q5_0");

        assert!(
            settings_after_removal(&settings, "model-turbo").is_none(),
            "deleting a spare changes nothing anybody stored"
        );
    }

    /// And where there is nothing to fall back to, the setting is cleared
    /// rather than left naming a file that has gone. Empty is a state the
    /// application already knows: it asks for a model.
    #[test]
    fn deleting_the_last_model_clears_the_setting() {
        let directory = scratch("settings-after-last");
        let mut settings = machine_at(&directory);
        settings.model = "large-v3".into();
        settings.editor_model = "gemma-4-12b-q4".into();
        let models = directory.join("models");
        std::fs::create_dir_all(models.join("editor")).unwrap();
        std::fs::write(models.join("ggml-large-v3.bin"), b"weights").unwrap();
        std::fs::write(models.join("editor").join("gemma-4-12b-q4.gguf"), b"w").unwrap();

        assert_eq!(replacement_component(&settings, "model-large"), None);
        assert_eq!(
            settings_after_removal(&settings, "model-large")
                .unwrap()
                .model,
            ""
        );
        assert_eq!(
            settings_after_removal(&settings, "editor-model-best")
                .unwrap()
                .editor_model,
            "",
            "the language editor is the same question with a softer answer"
        );
    }

    /// The card's two numbers. The size is **measured**, which is the whole
    /// point of it: the catalogue's `megabytes` are hand-written constants and
    /// ffmpeg's said 85 against an actual 106 for months, so a total added up
    /// from them would be a precise-looking sum of guesses.
    #[test]
    fn the_card_measures_what_the_folders_actually_take() {
        let directory = scratch("summary");
        let settings = machine_at(&directory);

        assert_eq!(
            installed_megabytes(&settings),
            0.0,
            "a machine with nothing on it, and no folders to walk yet"
        );

        let bin = directory.join("bin");
        let models = directory.join("models");
        std::fs::create_dir_all(bin.join("cpu")).unwrap();
        std::fs::create_dir_all(&models).unwrap();
        std::fs::write(bin.join("ffmpeg.exe"), vec![0u8; 1_048_576]).unwrap();
        std::fs::write(
            bin.join("cpu").join("whisper-cli.exe"),
            vec![0u8; 2_097_152],
        )
        .unwrap();
        std::fs::write(models.join("ggml-large-v3.bin"), vec![0u8; 1_048_576]).unwrap();

        let measured = installed_megabytes(&settings);
        assert_eq!(
            measured, 4.0,
            "four megabytes across both folders, subfolders included"
        );
        // The catalogue would have said 106 + 17 + 3095 for those three files.
        assert!(
            measured < 100.0,
            "the number is what is there, not what the catalogue expected"
        );
    }

    /// `..` in an archive is how an unpacker is talked into writing outside the
    /// folder it was pointed at.
    #[test]
    fn an_archive_that_reaches_outside_is_refused_whole() {
        let directory = scratch("zip-escape");
        let archive = directory.join("evil.zip");
        let inside = directory.join("rozbaleno");

        {
            let file = std::fs::File::create(&archive).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("harmless.txt", options).unwrap();
            writer.write_all(b"fine").unwrap();
            writer.start_file("../outside.exe", options).unwrap();
            writer.write_all(b"not fine").unwrap();
            writer.finish().unwrap();
        }

        let refusal = extract_zip(&archive, &inside);

        assert!(refusal.is_err(), "the archive is refused");
        assert!(
            !directory.join("outside.exe").exists(),
            "and nothing was written outside the destination"
        );
    }

    /// A record is written after a success and read back by id. Its absence is
    /// what tells an installation made before records apart from a verified one.
    #[test]
    fn an_installation_leaves_a_record_that_can_be_read_back() {
        let directory = scratch("record");
        let path = directory.join("installed.json");

        assert!(read_records(&path).is_empty(), "nothing is recorded yet");

        record_installation(
            &path,
            "vad",
            InstallRecord {
                url: "https://example.invalid/vad.onnx".into(),
                sha256: sha256_of(b"abc"),
                verified: true,
                when: "2026-08-10T00:00:00+02:00".into(),
                files: Some(vec!["models/ggml-silero-v6.2.0.bin".into()]),
            },
        );
        record_installation(
            &path,
            "ffmpeg",
            InstallRecord {
                url: "https://example.invalid/ffmpeg.zip".into(),
                sha256: sha256_of(b"abd"),
                verified: false,
                when: "2026-08-10T00:00:01+02:00".into(),
                files: Some(vec!["bin/ffmpeg.exe".into(), "bin/ffprobe.exe".into()]),
            },
        );

        let records = read_records(&path);
        assert_eq!(
            records.len(),
            2,
            "the second entry did not replace the first"
        );
        assert!(records["vad"].verified);
        assert!(
            !records["ffmpeg"].verified,
            "arriving over HTTPS is not the same as being checked"
        );
        assert_eq!(
            records["ffmpeg"].files.as_deref(),
            Some(&["bin/ffmpeg.exe".to_string(), "bin/ffprobe.exe".to_string()][..]),
            "what the installation wrote, in the order it wrote it"
        );
        assert!(
            !path.with_extension("json.psani").exists(),
            "the temporary name does not survive the write"
        );
    }

    /// The migration, as a test. A record written before file lists existed has
    /// no `files` key at all, and it must go on loading — every machine in the
    /// world has one. What it must not do is read as an installation that wrote
    /// nothing, which is why the field is an `Option` and not a `Vec`.
    #[test]
    fn a_record_written_before_file_lists_still_loads() {
        let directory = scratch("record-old-shape");
        let path = directory.join("installed.json");
        std::fs::write(
            &path,
            r#"{"ffmpeg":{"url":"https://example.invalid/ffmpeg.zip",
                "sha256":"ab","verified":false,"when":"2026-08-01T10:00:00+02:00"}}"#,
        )
        .unwrap();

        let records = read_records(&path);
        assert_eq!(records.len(), 1, "the record still parses");
        assert!(
            records["ffmpeg"].files.is_none(),
            "and says it does not know, rather than that there were no files"
        );
    }

    /// The migration question, as a test: an installation made before records
    /// existed has the file but no record, and must not be treated as checked.
    #[test]
    fn a_file_without_a_record_is_not_verified() {
        let directory = scratch("record-missing");
        let path = directory.join("installed.json");
        std::fs::write(directory.join("ffmpeg.exe"), b"a program from before").unwrap();

        let records = read_records(&path);

        assert!(
            !records.contains_key("ffmpeg"),
            "the presence of a file says nothing about where it came from"
        );
    }

    /// `components.json` is embedded at compile time and read with `expect`, so
    /// this is the test that makes that safe: it parses, and every entry has the
    /// shape a SHA-256 has — 64 hexadecimal characters, never something somebody
    /// guessed or truncated.
    #[test]
    fn the_pins_parse_and_every_digest_has_the_shape_of_one() {
        assert!(!pins().is_empty(), "components.json parsed to nothing");
        for (id, entry) in pins() {
            let Some(hash) = &entry.sha256 else { continue };
            assert_eq!(hash.len(), 64, "{id}");
            assert!(
                hash.chars().all(|c| c.is_ascii_hexdigit()),
                "{id} is not hexadecimal"
            );
            assert_eq!(expected_hash(id), Some(hash.as_str()));
        }
        assert_eq!(expected_hash("a component that does not exist"), None);
    }

    /// The two files have to name the same set. A pin nothing installs is dead
    /// weight; a component with no pin panics on the first call to `pin`, which
    /// is a build somebody ships rather than a mistake somebody sees.
    #[test]
    fn the_catalogue_and_the_pins_name_the_same_components() {
        let catalogue = raw_catalog();
        for component in &catalogue {
            assert!(
                pins().contains_key(&component.id),
                "{} is in the catalogue with no entry in components.json",
                component.id
            );
        }
        for id in pins().keys() {
            assert!(
                catalogue.iter().any(|component| &component.id == id),
                "{id} is pinned but is not in the catalogue"
            );
        }
    }

    /// A component added without a digest installs whatever arrives, and does
    /// it quietly. The exception is named here rather than left to be noticed:
    /// `model-hlasy` predates GitHub's digest field and there is nowhere to
    /// read one from. Anything else joining that list has to be a decision.
    #[test]
    fn every_component_carries_a_digest_except_the_one_that_cannot() {
        const WITHOUT: &[&str] = &["model-hlasy"];
        for component in raw_catalog() {
            let has = expected_hash(&component.id).is_some();
            let excused = WITHOUT.contains(&component.id.as_str());
            assert_ne!(
                has, excused,
                "{}: digest present = {has}, excused = {excused}",
                component.id
            );
        }
    }

    /// An address that does not name one artefact cannot be hashed, whatever
    /// the catalogue says. `latest` is the shape that reads as fixed and is
    /// not.
    #[test]
    fn no_address_points_at_whatever_is_newest() {
        for component in raw_catalog() {
            let Source::Url(url) = &component.source;
            assert!(
                !url.contains("/releases/latest/"),
                "{} downloads whatever is newest",
                component.id
            );
        }
    }

    /// The two halves of one promise. A hash names one artefact, so the address
    /// beside it has to name that same one — `main` moves, and a revision does
    /// not.
    #[test]
    fn a_hashed_hugging_face_url_is_pinned_to_a_revision() {
        for component in raw_catalog() {
            let Source::Url(url) = &component.source;
            if !url.contains("huggingface.co") || expected_hash(&component.id).is_none() {
                continue;
            }
            assert!(
                !url.contains("/resolve/main/"),
                "{} has a hash but downloads from a branch",
                component.id
            );
        }
    }
}
