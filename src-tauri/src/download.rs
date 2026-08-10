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

// ---------------------------------------------------------------- katalog

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadComponent {
    pub id: String,
    /// Dictionary key for the name shown in the wizard and in Modules.
    pub name_code: String,
    /// Dictionary key for the sentence under the name.
    pub description_code: String,
    pub megabytes: u64,
    /// program | model | speakers | editor
    pub group: String,
    /// Bez ni prepis vubec nepobezi
    pub required: bool,
    /// Doporuceno prave pro tenhle pocitac
    pub recommended: bool,
    /// Uz je stazena
    pub complete: bool,
    /// There is a record that this machine checked where the file came from.
    /// `complete` says a file is there; this says somebody vouched for it.
    pub origin_verified: bool,
    /// File whose presence means this component is complete (relative to root)
    verification_path: String,
    source: Source,
    destination: Destination,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
enum Source {
    /// Pevna adresa
    Url(String),
    /// Soubor se hleda v nedavnych vydanich na GitHubu podle vzoru v nazvu.
    /// Prochazi se vic vydani zpatky - projektum obcas spadne sestaveni pro
    /// jednu platformu a v poslednim vydani pak ten soubor proste neni.
    Github {
        repo: String,
        pattern: String,
        exclude: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
enum Destination {
    /// Rozbalit archiv a vsechny .exe a .dll slozit do jedne slozky
    ProgramsInto(String),
    /// Ulozit stazeny soubor pod danym jmenem
    AsFile(String),
}

/// SHA-256 of the exact file each component downloads, checked before anything
/// is unpacked or moved into place.
///
/// Empty is not an oversight. A hash here is a promise about one exact
/// artefact, so it may only be written down once somebody has read it from the
/// project's own release — not computed from whatever this machine happened to
/// receive, which would attest that the file matches itself. Until an entry
/// exists, `install_record` marks the component `origin unverified` rather than
/// pretending otherwise.
///
/// A component still fetched by matching a pattern against live releases can
/// never have one: every machine may receive a different build.
const EXPECTED_HASHES: &[(&str, &str)] = &[];

fn expected_hash(id: &str) -> Option<&'static str> {
    EXPECTED_HASHES
        .iter()
        .find(|(component, _)| *component == id)
        .map(|(_, hash)| *hash)
}

/// Names and descriptions are not written here. The window shows them in the
/// active language, so the catalogue only says which dictionary entry belongs
/// to each item; the identifier is the key both sides agree on.
fn raw_catalog() -> Vec<DownloadComponent> {
    let k = |id: &str,
             mb: u64,
             group: &str,
             required: bool,
             verification_path: &str,
             source: Source,
             destination: Destination| DownloadComponent {
        id: id.into(),
        name_code: format!("catalog.{id}.name"),
        description_code: format!("catalog.{id}.description"),
        megabytes: mb,
        group: group.into(),
        required,
        recommended: false,
        complete: false,
        origin_verified: false,
        verification_path: verification_path.into(),
        source,
        destination,
    };

    vec![
        // ---------------------------------------------------------- programy
        k(
            "whisper-vulkan",
            18,
            "program",
            false,
            "bin/vulkan/whisper-cli.exe",
            Source::Url("https://github.com/jerryshell/whisper.cpp-windows-vulkan-bin/releases/download/v1.0.0/whisper.cpp-windows-vulkan.zip".into()),
            Destination::ProgramsInto("bin/vulkan".into()),
        ),
        k(
            "whisper-cpu",
            17,
            "program",
            false,
            "bin/cpu/whisper-cli.exe",
            Source::Github {
                repo: "ggml-org/whisper.cpp".into(),
                pattern: "^whisper-(blas-)?bin-x64\\.zip$".into(),
                exclude: "".into(),
            },
            Destination::ProgramsInto("bin/cpu".into()),
        ),
        k(
            "whisper-cuda",
            457,
            "program",
            false,
            "bin/cuda/whisper-cli.exe",
            Source::Github {
                repo: "ggml-org/whisper.cpp".into(),
                pattern: "cublas-12.*bin-x64\\.zip$".into(),
                exclude: "".into(),
            },
            Destination::ProgramsInto("bin/cuda".into()),
        ),
        k(
            "ffmpeg",
            85,
            "program",
            true,
            "bin/ffmpeg.exe",
            Source::Url("https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip".into()),
            Destination::ProgramsInto("bin".into()),
        ),
        k(
            "yt-dlp",
            18,
            "program",
            false,
            "bin/yt-dlp.exe",
            Source::Url(
                "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe".into(),
            ),
            Destination::AsFile("bin/yt-dlp.exe".into()),
        ),
        k(
            "deno",
            38,
            "program",
            false,
            "bin/deno.exe",
            Source::Github {
                repo: "denoland/deno".into(),
                pattern: "^deno-x86_64-pc-windows-msvc\\.zip$".into(),
                exclude: "aarch64|denort|sha256".into(),
            },
            Destination::ProgramsInto("bin".into()),
        ),
        // ---------------------------------------------------------- modely
        k(
            "vad",
            2,
            "model",
            true,
            "models/ggml-silero-v6.2.0.bin",
            Source::Url("https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin".into()),
            Destination::AsFile("models/ggml-silero-v6.2.0.bin".into()),
        ),
        k(
            "model-turbo",
            575,
            "model",
            false,
            "models/ggml-large-v3-turbo-q5_0.bin",
            Source::Url("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".into()),
            Destination::AsFile("models/ggml-large-v3-turbo-q5_0.bin".into()),
        ),
        k(
            "model-large-q5",
            1080,
            "model",
            false,
            "models/ggml-large-v3-q5_0.bin",
            Source::Url("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin".into()),
            Destination::AsFile("models/ggml-large-v3-q5_0.bin".into()),
        ),
        k(
            "model-large",
            3095,
            "model",
            false,
            "models/ggml-large-v3.bin",
            Source::Url("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".into()),
            Destination::AsFile("models/ggml-large-v3.bin".into()),
        ),
        // ---------------------------------------------------- language editing
        k(
            "editor-vulkan",
            150,
            "editor",
            false,
            "bin/editor-vulkan/llama-cli.exe",
            Source::Github {
                repo: "ggml-org/llama.cpp".into(),
                pattern: "^llama-.*-bin-win-vulkan-x64\\.zip$".into(),
                exclude: "".into(),
            },
            Destination::ProgramsInto("bin/editor-vulkan".into()),
        ),
        k(
            "editor-cpu",
            45,
            "editor",
            false,
            "bin/editor-cpu/llama-cli.exe",
            Source::Github {
                repo: "ggml-org/llama.cpp".into(),
                pattern: "^llama-.*-bin-win-cpu-x64\\.zip$".into(),
                exclude: "".into(),
            },
            Destination::ProgramsInto("bin/editor-cpu".into()),
        ),
        k(
            "editor-model-light",
            3350,
            "editor",
            false,
            "models/editor/gemma-4-e2b-q4.gguf",
            Source::Url("https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf".into()),
            Destination::AsFile("models/editor/gemma-4-e2b-q4.gguf".into()),
        ),
        k(
            "editor-model-balanced",
            5150,
            "editor",
            false,
            "models/editor/gemma-4-e4b-q4.gguf",
            Source::Url("https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf".into()),
            Destination::AsFile("models/editor/gemma-4-e4b-q4.gguf".into()),
        ),
        k(
            "editor-model-best",
            6980,
            "editor",
            false,
            "models/editor/gemma-4-12b-q4.gguf",
            Source::Url("https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/main/gemma-4-12b-it-qat-q4_0.gguf".into()),
            Destination::AsFile("models/editor/gemma-4-12b-q4.gguf".into()),
        ),
        // ---------------------------------------------------------- mluvci
        // Historie tohohle radku, aby ho nikdo nevracel dozadu:
        //
        // 1. Nejdriv tu byl 3dspeaker ... sv_zh-cn ..., natrenovany jen na
        //    cinstine. Hlasy v cestine rozlisoval spatne.
        // 2. Pak CAM++ z VoxCelebu, trenovany na siroke smesi jazyku.
        // 3. Ted CAM++ „zh_en common advanced“, trenovany na zh i en a na
        //    radove vetsim poctu mluvcich. Nema s bodem 1 spolecneho nic nez
        //    jmeno rodiny — ten byl jednojazycny, tenhle neni.
        //
        // Zmereno na skutecnych nahravkach uzivatele, ne odhadnuto. Cely
        // rozbor je v CLAUDE.md; ve zkratce, pri vynucenych dvou mluvcich
        // dal VoxCeleb 65 prepnuti a pomer hlasu 55/45, zatimco tenhle 17
        // prepnuti a 94/6 — a to same na anglicke i ceske verzi tehoz
        // rozhovoru. Je pritom o megabajt mensi a stejne rychly.
        k(
            "model-hlasy",
            28,
            "speakers",
            false,
            "models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
            Source::Url("https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx".into()),
            Destination::AsFile(
                "models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx".into(),
            ),
        ),
    ]
}

/// Doplni, co uz je hotove, a co se pro tenhle konkretni pocitac hodi.
pub fn catalog(settings: &crate::db::Settings) -> Vec<DownloadComponent> {
    let has_nvidia = tools::has_nvidia();
    let has_vulkan = tools::has_vulkan();

    raw_catalog()
        .into_iter()
        .map(|mut k| {
            k.complete = tools::component_path(settings, &k.verification_path).exists();
            k.origin_verified = origin_verified(settings, &k.id);
            k.recommended = match k.id.as_str() {
                "ffmpeg" | "vad" => true,
                // Model se vybira podle toho, jestli je cim pocitat
                "model-large-q5" => has_nvidia || has_vulkan,
                "model-turbo" => !(has_nvidia || has_vulkan),
                "whisper-cuda" => has_nvidia,
                "whisper-vulkan" => has_vulkan && !has_nvidia,
                // bez ovladacu grafiky zbyva procesor
                "whisper-cpu" => !has_nvidia && !has_vulkan,
                "editor-vulkan" => has_vulkan,
                "editor-cpu" => !has_vulkan,
                _ => false,
            };
            k
        })
        .collect()
}

// ---------------------------------------------------------------- udalosti

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
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

// ---------------------------------------------------------------- stahovani

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
/// sending nothing still stalls. That needs a per-read deadline, and getting one
/// means the asynchronous client and a rewrite of the download loop. Recorded
/// rather than pretended away.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const KEEPALIVE_IDLE: std::time::Duration = std::time::Duration::from_secs(30);
const KEEPALIVE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);
const KEEPALIVE_RETRIES: u32 = 6;
/// Applies to the release listings only — see the call site.
const METADATA_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

fn client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .user_agent("Slobot")
        .timeout(None)
        .connect_timeout(CONNECT_TIMEOUT)
        .tcp_keepalive(KEEPALIVE_IDLE)
        .tcp_keepalive_interval(KEEPALIVE_INTERVAL)
        .tcp_keepalive_retries(KEEPALIVE_RETRIES)
        .build()?)
}

/// U GitHubu se nazvy souboru mezi verzemi meni, proto je hledame v seznamu
/// vydani misto hadani adresy. Prochazime vic vydani zpatky - projektum obcas
/// spadne sestaveni pro jednu platformu a v poslednim vydani ten soubor chybi.
fn resolve_url(source: &Source) -> Reported<String> {
    match source {
        Source::Url(url) => Ok(url.clone()),
        Source::Github {
            repo,
            pattern,
            exclude,
        } => {
            // reqwest has default features off (for size), so we parse the
            // response ourselves instead of the convenient .json()
            let download = |url: String| -> Reported<serde_json::Value> {
                // A whole-request deadline is safe here and only here: this is
                // a page of JSON, not a model, so there is no legitimate reason
                // for it to take half a minute. It is what keeps a stalled
                // GitHub connection from hanging the very first step of a
                // download, where the file-body keepalive has nothing to say
                // yet.
                let body = client()?
                    .get(&url)
                    .timeout(METADATA_TIMEOUT)
                    .send()?
                    .error_for_status()?
                    .text()?;
                serde_json::from_str(&body)
                    .map_err(|error| UserMessage::new("download.github_unreadable").detail(error))
            };

            // Ask for "latest" first. Some projects (sherpa-onnx) publish
            // dozens of model-only releases, so a date-ordered list is flooded
            // with them and the actual program release never makes the cut.
            let mut releases: Vec<serde_json::Value> = Vec::new();
            if let Ok(v) = download(format!(
                "https://api.github.com/repos/{repo}/releases/latest"
            )) {
                releases.push(v);
            }
            let list = download(format!(
                "https://api.github.com/repos/{repo}/releases?per_page=30"
            ))?;
            releases.extend(list.as_array().cloned().unwrap_or_default());

            let empty = vec![];

            let requested = regex::Regex::new(pattern).map_err(|_| {
                UserMessage::new("download.invalid_pattern").with("pattern", pattern)
            })?;
            let excluded = if exclude.is_empty() {
                None
            } else {
                regex::Regex::new(exclude).ok()
            };

            // When nothing matches, report what was actually seen — without
            // that, this failure is debugged blind.
            let mut seen: Vec<String> = Vec::new();
            let mut found: Option<String> = None;

            'search: for release in &releases {
                for asset in release["assets"].as_array().unwrap_or(&empty) {
                    let Some(name) = asset["name"].as_str() else {
                        continue;
                    };
                    if !requested.is_match(name) {
                        continue;
                    }
                    if let Some(excluded) = &excluded {
                        if excluded.is_match(name) {
                            if seen.len() < 6 {
                                seen.push(name.to_string());
                            }
                            continue;
                        }
                    }
                    if let Some(download_url) = asset["browser_download_url"].as_str() {
                        found = Some(download_url.to_string());
                        break 'search;
                    }
                }
            }

            found.ok_or_else(|| {
                let message = if seen.is_empty() {
                    UserMessage::new("download.asset_not_found")
                } else {
                    UserMessage::new("download.asset_not_found_with_excluded")
                        .with("excluded", seen.join(", "))
                };
                message.with("repository", repo).with("pattern", pattern)
            })
        }
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
    let mut response = client()?
        .get(url)
        .send()
        .map_err(|error| {
            UserMessage::new("download.connection_failed")
                .with("url", url)
                .detail(error)
        })?
        .error_for_status()
        .map_err(|error| UserMessage::new("download.rejected").detail(error))?;

    let total = response.content_length().unwrap_or(0);
    let total_mb = total as f64 / 1_048_576.0;

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // stahujeme do .cast, at v cili nikdy nelezi nedodelany soubor
    let partial = target.with_extension("cast");
    let mut file = std::fs::File::create(&partial)?;
    let mut digest = Sha256::new();

    let mut downloaded: u64 = 0;
    let mut last_update = std::time::Instant::now();
    let mut buffer = vec![0u8; 262_144];

    loop {
        if cancellation.load(Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(&partial);
            return Err(UserMessage::new("download.cancelled"));
        }
        let bytes_read = response.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])?;
        digest.update(&buffer[..bytes_read]);
        downloaded += bytes_read as u64;

        // hlasit kazdych 200 ms staci, jinak by se okno zahltilo
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
                .with("file", target.file_name().unwrap_or_default().to_string_lossy())
                .detail(format!("expected {expected}, got {actual}")));
        }
    }
    if target.exists() {
        let _ = std::fs::remove_file(target);
    }
    std::fs::rename(partial, target)?;
    Ok(actual)
}

// ---------------------------------------------------------------- rozbaleni

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
                .with("archive", archive.file_name().unwrap_or_default().to_string_lossy())
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

/// .tar.bz2 umi rozbalit tar.exe, ktery je soucasti Windows 10 a novejsich.
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
/// Archivy maji ruzne hluboke struktury, tohle je zplosti.
fn collect_programs(source: &Path, destination: &Path) -> Reported<usize> {
    std::fs::create_dir_all(destination)?;
    let mut count = 0;
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
                        count += 1;
                    }
                }
            }
        }
    }
    Ok(count)
}

// ---------------------------------------------------------------- hlavni beh

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

/// Whether this machine has a record that the component's origin was checked.
/// A file sitting in the right place is not that record, which is the mistake
/// this exists to correct.
pub fn origin_verified(settings: &crate::db::Settings, id: &str) -> bool {
    read_records(&record_path(settings))
        .get(id)
        .map(|record| record.verified)
        .unwrap_or(false)
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

    let url = resolve_url(&component.source)?;
    let expected = expected_hash(&component.id);
    // The digest of what actually arrived, whether or not anything was
    // expected. It goes into the record so that a later version, once the
    // catalogue names a hash, can tell what this machine already has.
    let installed: String;

    match &component.destination {
        Destination::AsFile(rel) => {
            installed = download_file(app, id, &url, &destination(rel), expected, &cancellation)?;
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
            let count = collect_programs(&extracted, &destination(rel))?;
            if count == 0 {
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

    // Starsi buildy whisper.cpp maji main.exe misto whisper-cli.exe
    if let Destination::ProgramsInto(rel) = &component.destination {
        let directory = destination(rel);
        let cli = directory.join("whisper-cli.exe");
        let main = directory.join("main.exe");
        if !cli.exists() && main.exists() {
            let _ = std::fs::copy(&main, &cli);
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

/// Nainstaluje seznam soucasti za sebou. Bezi ve vlastnim vlakne.
/// Whether a bundle is being installed right now.
///
/// One flag for the whole application, because the thing being protected is
/// the destination on disk, not a screen: two runs fetching the same component
/// write to the same file and both report progress for the same id, which is
/// what made the progress jump between two values. The second call is refused
/// rather than queued — the first one is already fetching exactly this.
static INSTALLING: AtomicBool = AtomicBool::new(false);

pub fn is_installing() -> bool {
    INSTALLING.load(Ordering::Relaxed)
}

/// Returns whether this call took the work. `false` means one was already
/// running and nothing was started.
pub fn install_bundle(
    app: AppHandle,
    settings: crate::db::Settings,
    ids: Vec<String>,
    cancellation: Arc<AtomicBool>,
) -> bool {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return false;
    }
    std::thread::spawn(move || {
        // Whatever happens below, the flag comes down — including on a panic,
        // which is why it is a guard and not a line at the end.
        struct Done;
        impl Drop for Done {
            fn drop(&mut self) {
                INSTALLING.store(false, Ordering::SeqCst);
            }
        }
        let _done = Done;

        // What did not land. `download:complete` carries it, because the
        // window cannot work it out for itself: the batch stops on a
        // cancellation, and a component that was never attempted has no
        // phase at all — indistinguishable from one that is still going.
        let mut unfinished: Vec<String> = Vec::new();
        let mut queue = ids.into_iter();
        while let Some(id) = queue.next() {
            if cancellation.load(Ordering::Relaxed) {
                // Cancelling stops the whole batch, so everything still in it
                // is unfinished — not only the component that was interrupted.
                for pending in std::iter::once(id).chain(queue.by_ref()) {
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
    true
}

// ---------------------------------------------------------------- prenosna kopie

/// Zkopiruje program, nastroje i modely do zvolene slozky a oznaci ji jako
/// prenosnou. Nahrazuje sestavovaci skript - uzivatel jen vybere flashku.
pub fn create_portable_copy(
    app: &AppHandle,
    settings: &crate::db::Settings,
    destination: &Path,
) -> Result<u64> {
    std::fs::create_dir_all(destination)?;

    // The name follows productName, so a later rename of the application
    // cannot leave the portable copy running under the previous one — which
    // is exactly what happened when Whisp became Slobot.
    let executable = format!("{}.exe", app.package_info().name);
    let program = std::env::current_exe()?;
    std::fs::copy(&program, destination.join(&executable))?;

    // WebView2, pokud ho tenhle stroj ma prilozeny
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

    /// The reported defect: starting a download, leaving Settings and coming
    /// back started a second one. Two runs then fetched the same component
    /// into the same file and both reported progress for it, so the bar jumped
    /// between two values.
    ///
    /// The flag is what the command asks before it clears the cancellation —
    /// which is the other half of the defect: the second call used to wipe the
    /// stop request the first run was watching.
    #[test]
    fn a_second_install_is_refused_while_one_is_running() {
        assert!(!is_installing(), "nothing running to begin with");

        // What `install_bundle` does on the way in, without needing a window.
        assert!(
            !INSTALLING.swap(true, Ordering::SeqCst),
            "this call takes it"
        );
        assert!(is_installing());
        assert!(
            INSTALLING.swap(true, Ordering::SeqCst),
            "a second call finds it taken and must not start"
        );

        INSTALLING.store(false, Ordering::SeqCst);
        assert!(!is_installing(), "the flag comes down when the run ends");
        assert!(
            !INSTALLING.swap(true, Ordering::SeqCst),
            "and the next download is allowed again"
        );
        INSTALLING.store(false, Ordering::SeqCst);
    }

    /// A scratch directory of this test's own, removed on the way in so a
    /// previous run cannot decide the result.
    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("slobot-test-{name}"));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("scratch");
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
    /// what tells a 0.9.0 installation apart from a verified one.
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
            },
        );

        let records = read_records(&path);
        assert_eq!(records.len(), 2, "the second entry did not replace the first");
        assert!(records["vad"].verified);
        assert!(
            !records["ffmpeg"].verified,
            "arriving over HTTPS is not the same as being checked"
        );
        assert!(
            !path.with_extension("json.psani").exists(),
            "the temporary name does not survive the write"
        );
    }

    /// The migration question, as a test: an installation made by 0.9.0 has the
    /// file but no record, and must not be treated as checked.
    #[test]
    fn a_file_without_a_record_is_not_verified() {
        let directory = scratch("record-missing");
        let path = directory.join("installed.json");
        std::fs::write(directory.join("ffmpeg.exe"), b"a program from before").unwrap();

        let records = read_records(&path);

        assert!(
            records.get("ffmpeg").is_none(),
            "the presence of a file says nothing about where it came from"
        );
    }

    /// The catalogue may not carry a hash somebody guessed. Every entry must be
    /// 64 hex characters, because that is the only shape a SHA-256 has.
    #[test]
    fn every_expected_hash_has_the_shape_of_one() {
        for (id, hash) in EXPECTED_HASHES {
            assert_eq!(hash.len(), 64, "{id}");
            assert!(
                hash.chars().all(|c| c.is_ascii_hexdigit()),
                "{id} is not hexadecimal"
            );
            assert_eq!(expected_hash(id), Some(*hash));
        }
        assert_eq!(expected_hash("a component that does not exist"), None);
    }
}
