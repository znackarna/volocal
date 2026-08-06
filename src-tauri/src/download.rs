//! Downloads and installs tools and models without requiring helper scripts.
//!
//! Destinations follow the configured program and model directories. The
//! default is LOCALAPPDATA; portable mode uses directories beside the
//! executable and does not require administrator privileges.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
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
    /// Rozbalit archiv i s podslozkami
    ExtractInto(String),
    /// Ulozit stazeny soubor pod danym jmenem
    AsFile(String),
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
        k(
            "sherpa",
            35,
            "speakers",
            false,
            "bin/sherpa-onnx-offline-speaker-diarization.exe",
            Source::Github {
                repo: "k2-fsa/sherpa-onnx".into(),
                pattern: "win.*x64.*\\.(tar\\.bz2|zip)$".into(),
                // -lib archives hold libraries without the executables;
                // static and cuda builds are unusable here
                exclude: "cuda|jni|jar|static|sha256|-lib\\.|_lib\\.".into(),
            },
            Destination::ProgramsInto("bin".into()),
        ),
        k(
            "model-segmentace",
            6,
            "speakers",
            false,
            "models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
            Source::Url("https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2".into()),
            Destination::ExtractInto("models".into()),
        ),
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

fn client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .user_agent("Slobot")
        .timeout(None)
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
                let body = client()?.get(&url).send()?.error_for_status()?.text()?;
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
    cancellation: &Arc<AtomicBool>,
) -> Reported<()> {
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
    if target.exists() {
        let _ = std::fs::remove_file(target);
    }
    std::fs::rename(&partial, target)?;
    Ok(())
}

// ---------------------------------------------------------------- rozbaleni

fn extract_zip(archive: &Path, destination: &Path) -> Reported<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file)?;
    for i in 0..zip.len() {
        let mut item = zip.by_index(i)?;
        let Some(relative_path) = item.enclosed_name() else {
            continue;
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

    match &component.destination {
        Destination::AsFile(rel) => {
            download_file(app, id, &url, &destination(rel), &cancellation)?;
        }
        Destination::ProgramsInto(rel) | Destination::ExtractInto(rel) => {
            let temporary_directory = std::env::temp_dir().join("whisp-downloads");
            std::fs::create_dir_all(&temporary_directory)?;

            // File name taken from the URL. It shows up in errors; without
            // it there is no telling whether the right build was picked.
            let name = url.rsplit('/').next().unwrap_or("archiv.zip");
            let archive = temporary_directory.join(name);
            download_file(app, id, &url, &archive, &cancellation)?;

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

            match &component.destination {
                Destination::ProgramsInto(_) => {
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
                }
                _ => {
                    extract(&archive, &destination(rel))?;
                }
            }
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
pub fn install_bundle(
    app: AppHandle,
    settings: crate::db::Settings,
    ids: Vec<String>,
    cancellation: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        for id in ids {
            if cancellation.load(Ordering::Relaxed) {
                emit_progress(
                    &app,
                    DownloadProgress {
                        id: id.clone(),
                        phase: "cancelled".into(),
                        downloaded_mb: 0.0,
                        total_mb: 0.0,
                        percent: 0,
                        message: Some(UserMessage::new("download.cancelled")),
                    },
                );
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
            }
        }
        let _ = app.emit("download:complete", ());
    });
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

    let program = std::env::current_exe()?;
    std::fs::copy(&program, destination.join("Whisp.exe"))?;

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
        "Podle tohoto souboru Whisp pozná, že má všechno hledat u sebe\r\n\
         a nic nezapisovat do počítače. Nemazat.\r\n",
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
