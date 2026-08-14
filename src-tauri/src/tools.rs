//! Finding and running the external tools: ffmpeg and whisper-cli.
//!
//! Deliberately without linking any of them in — each is a process of its own.
//! That is what lets any one of them be swapped or rebuilt without touching the
//! application.
//!
//! Portable mode: when a `bin` folder sits beside the program, the application
//! switches to everything-on-the-stick — relative paths, the archive next to the
//! program, and nothing written into the system.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::user_message::UserMessage;

/// Without it, every process started here flashes a black console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW

pub fn command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Runs a program on somebody's behalf, so that it can be killed while it works.
///
/// The preparation programs used to be run with `Command::output`, which owns
/// its child and hands it to nobody: `Zrušit` during `Připravuji přesné
/// přehrávání` set the cancel flag, found no process to kill, and the ffmpeg
/// encoding a 34-minute MP3 carried on to the end. A job passes its own
/// implementation, which registers the child before waiting on it.
pub trait CommandRunner {
    /// Runs to completion and returns the exit status with whatever the
    /// program wrote to stderr. `None` means it was killed rather than
    /// finished, and the caller must not judge its output.
    fn run(&self, command: Command) -> std::io::Result<Option<(std::process::ExitStatus, String)>>;
}

/// For the places where no job owns the program and nothing can cancel it —
/// preparing playback on demand when a finished transcript is opened.
pub struct PlainRunner;

impl CommandRunner for PlainRunner {
    fn run(
        &self,
        mut command: Command,
    ) -> std::io::Result<Option<(std::process::ExitStatus, String)>> {
        let output = command
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()?;
        Ok(Some((
            output.status,
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        )))
    }
}

// ---------------------------------------------------------------- portability

/// The folder the application's executable sits in.
pub fn app_directory() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Portable mode is recognised by the marker file a portable copy writes, and
/// by nothing else.
///
/// It used to count a `bin` folder beside the executable as well. That folder
/// is created by this application's own downloader, and the installer's
/// default directory is `%LOCALAPPDATA%\Whisp` — precisely what `tools_root`
/// computes for an ordinary installation. So running the setup wizard made an
/// installed copy look portable from the next launch onward, and the archive
/// silently moved from the user profile to an empty file beside the program.
/// Portability is a decision somebody makes, not a side effect of downloading
/// a model.
pub fn is_portable() -> bool {
    app_directory().join("prenosna.txt").is_file()
}

/// The folder holding the tools and the models, under `%LOCALAPPDATA%`.
///
/// The identifier, the same one the archive's folder uses in the roaming
/// profile — not `Volocal`, which is where the installer puts the program and
/// the uninstaller. Twenty gigabytes of models in a folder an uninstaller owns
/// is a folder an uninstall can empty.
pub const TOOLS_FOLDER: &str = "cz.znackarna.volocal";

/// And what it was called while the application was still Whisp.
pub const TOOLS_FOLDER_BEFORE_THE_RENAME: &str = "Whisp";

/// Where `%LOCALAPPDATA%` is, or the program's own folder if Windows will not
/// say.
pub fn local_data() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(app_directory)
}

/// Where the tools and models are downloaded to.
///
/// Beside the program in portable mode. Otherwise into the user's profile —
/// not Program Files, where an application without administrator rights could
/// write nothing at all.
/// Whether a folder is one of ours rather than one that merely exists.
///
/// `%LOCALAPPDATA%\cz.znackarna.volocal` is not ours alone: WebView2 keeps its
/// profile there, in `EBWebView`, named after the same identifier, and it puts
/// it there the first time the window opens. So the folder existing says
/// nothing at all — 1.0.8 asked only that and pointed the whole application at
/// a folder holding a quarter of a gigabyte of browser cache and none of its
/// tools, which is every model reported missing.
///
/// What makes a folder ours is that our things are in it.
fn holds_the_tools(folder: &Path) -> bool {
    folder.join("bin").is_dir() || folder.join("models").is_dir()
}

pub fn tools_root() -> PathBuf {
    if is_portable() {
        return app_directory();
    }
    let local = local_data();
    let root = local.join(TOOLS_FOLDER);
    if holds_the_tools(&root) {
        return root;
    }
    // The old name is still answered for, so a move that could not happen —
    // a tool running out of `bin` holds the folder open — means the models are
    // found where they are rather than reported missing.
    let before = local.join(TOOLS_FOLDER_BEFORE_THE_RENAME);
    if holds_the_tools(&before) {
        return before;
    }
    root
}

/// Renames the tools folder to the application's own name, once.
///
/// Twenty gigabytes do not move: each of `bin` and `models` is a directory
/// rename on one volume, instant, with nothing copied and nothing at risk of
/// being half-copied.
///
/// It can fail, and the ordinary reason is benign — a tool still running out of
/// `bin` holds the folder open. Then nothing happens, `tools_root` answers for
/// the old name as it always has, and the next start tries again.
///
/// The folder to work in is passed rather than read, so a test can give it one
/// that is not the machine's — `LOCALAPPDATA` is process-wide and these tests
/// run beside each other in one process.
///
/// The stored paths are the caller's problem, not this function's: the defaults
/// are relative (`bin`, `models`) and travel with the root by themselves. Only
/// an absolute path somebody chose needs looking at, and only the database
/// knows what those are.
pub fn rename_tools_root(local: &Path) -> Option<(PathBuf, PathBuf)> {
    if is_portable() {
        return None;
    }
    let before = local.join(TOOLS_FOLDER_BEFORE_THE_RENAME);
    let root = local.join(TOOLS_FOLDER);
    if !holds_the_tools(&before) || holds_the_tools(&root) {
        return None;
    }

    // `bin` and `models`, not the folder around them. The folder cannot be
    // renamed onto a name WebView2 is already using, and these two are the
    // whole of what is ours. Each is a directory rename on one volume: instant,
    // and twenty gigabytes stay where they are on the disk.
    let _ = std::fs::create_dir_all(&root);
    let mut moved = 0;
    for name in ["bin", "models"] {
        let from = before.join(name);
        if !from.is_dir() {
            continue;
        }
        match std::fs::rename(&from, root.join(name)) {
            Ok(()) => moved += 1,
            Err(error) => {
                crate::note!("tools: {} could not be moved ({error})", from.display());
            }
        }
    }
    if moved == 0 {
        return None;
    }
    // Only if it is empty. Anything else in there is somebody else's.
    let _ = std::fs::remove_dir(&before);
    crate::note!(
        "tools: moved {moved} folder(s) from {} to {}",
        before.display(),
        root.display()
    );
    Some((before, root))
}

/// Where a file the catalogue describes as "bin/something" or "models/something"
/// belongs.
///
/// It has to go through the settings rather than a hard-coded root. Otherwise
/// the download lands somewhere the application does not then look — and after
/// a download that succeeded, the reader is told the file is missing.
pub fn component_path(settings: &crate::db::Settings, rel: &str) -> PathBuf {
    let (first, remainder) = rel.split_once('/').unwrap_or((rel, ""));
    let root = match first {
        "bin" => expand(&settings.bin_directory),
        "models" => expand(&settings.models_directory),
        other => tools_root().join(other),
    };
    if remainder.is_empty() {
        root
    } else {
        root.join(remainder)
    }
}

/// Relative paths are read against the root folder, so it does not matter what
/// drive letter the stick is given on somebody else's computer.
pub fn expand(path: &str) -> PathBuf {
    let p = Path::new(path);
    if path.is_empty() || p.is_absolute() {
        p.to_path_buf()
    } else {
        tools_root().join(p)
    }
}

/// Where the archive belongs: beside the program in portable mode, otherwise
/// in the user's profile.
pub fn data_directory(fallback: PathBuf) -> PathBuf {
    if is_portable() {
        app_directory().join("data")
    } else {
        fallback
    }
}

/// Points WebView2 at the copy carried on the stick, if there is one. Without
/// it, a computer with no WebView2 of its own opens no window at all.
pub fn set_webview2() -> Option<PathBuf> {
    let root = app_directory().join("webview2");
    if !root.is_dir() {
        return None;
    }
    // The unpacked CAB has a folder named after the version inside it.
    let holds_the_program = |d: &Path| d.join("msedgewebview2.exe").is_file();

    let target = if holds_the_program(&root) {
        Some(root.clone())
    } else {
        std::fs::read_dir(&root).ok().and_then(|it| {
            it.filter_map(|e| e.ok())
                .map(|e| e.path())
                .find(|p| p.is_dir() && holds_the_program(p))
        })
    }?;

    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &target);
    Some(target)
}

// ---------------------------------------------------------------- finding

/// Finds an executable: in the given folders first, then on the system PATH.
pub fn find_program_in(directories: &[PathBuf], title: &str) -> Option<PathBuf> {
    for s in directories {
        for k in [format!("{title}.exe"), title.to_string()] {
            let p = s.join(&k);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let path_variable = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_variable) {
        for k in [format!("{title}.exe"), title.to_string()] {
            let p = directory.join(&k);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub fn find_file(directory: &Path, names: &[&str]) -> Option<PathBuf> {
    for n in names {
        let p = directory.join(n);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

// ---------------------------------------------------------------- compute

/// Which whisper.cpp builds are on the disk.
/// The subfolders bin\cuda, bin\vulkan, bin\cpu, or bin\ itself.
pub fn available_compute_backends(bin: &Path) -> Vec<String> {
    let mut v = Vec::new();
    for name in ["cuda", "vulkan", "cpu"] {
        let p = bin.join(name);
        if p.join("whisper-cli.exe").is_file() || p.join("main.exe").is_file() {
            v.push(name.to_string());
        }
    }
    if v.is_empty() && (bin.join("whisper-cli.exe").is_file() || bin.join("main.exe").is_file()) {
        v.push("vychozi".into());
    }
    v
}

/// Decided by the drivers the system has installed.
/// nvcuda.dll is the NVIDIA driver, vulkan-1.dll the Vulkan runtime.
fn system_library_exists(title: &str) -> bool {
    let system = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    system.join(title).is_file()
}

pub fn has_nvidia() -> bool {
    system_library_exists("nvcuda.dll")
}

pub fn has_vulkan() -> bool {
    system_library_exists("vulkan-1.dll")
}

/// Can this computer run that build at all?
///
/// `cpu` and `vychozi` always work; for the rest the system's driver decides.
/// Those two names are stored settings and folder names on disk, so they stay.
///
/// `gpu` is deliberately not answered here. It is not a build — it is the
/// reader's word for "the card, whichever build is right" — and whether it can
/// be honoured depends on which builds are on the disk, which this function is
/// not told. `choose_compute` decides it, because it knows both.
pub fn usable_compute(backend: &str) -> bool {
    match backend {
        "cuda" => has_nvidia(),
        "vulkan" => has_vulkan(),
        _ => true,
    }
}

/// The graphics builds, fastest first.
///
/// CUDA before Vulkan is the same order `choose_compute` has always used when
/// deciding by itself, and it is the reason the reader is never asked which of
/// the two: on an NVIDIA card CUDA is the faster of the builds we ship, and on
/// anything else it cannot run at all. That is a fact about the drivers, not a
/// preference, so it is read off the machine rather than put on the screen.
const GRAPHICS_BUILDS: [&str; 2] = ["cuda", "vulkan"];

/// Picks the compute build. "auto" decides by what the machine has.
///
/// The stored choice is one of four things: `auto`, `cpu`, `gpu`, or — on a
/// machine set up before 14 August 2026 — one of the build names `cuda` and
/// `vulkan`. All four still load and all four are still honoured here; what
/// changed is that `Nástroje` now offers only the first three, because which
/// graphics build is right for a card is not a question a reader can answer
/// better than the drivers can.
///
/// The substitution below is silent by design — a transcription must run — but
/// it must not be silent on screen. `ToolCheck::compute` is this function's
/// answer, not the stored setting, and that is what `Nástroje` shows: when the
/// two differ, the card says which was asked for, what ran instead, and why.
pub fn choose_compute(bin: &Path, choice: &str) -> String {
    let available = available_compute_backends(bin);
    if available.is_empty() {
        return "vychozi".into();
    }
    // Downloaded and runnable are two different questions, and both have to be
    // asked. A `bin\cuda` folder used to be enough for a stored `cuda` to be
    // honoured, so anybody with an AMD card got a CUDA build that found no
    // device and transcribed on the processor — while the screen went on saying
    // it ran on the graphics card. The hardware check lived only in the
    // automatic branch, which is exactly where it is not needed.
    let runnable = |name: &str| available.iter().any(|x| x == name) && usable_compute(name);
    // The fastest graphics build this machine can actually run, if any. It is
    // both what `gpu` means and what automatic prefers, which is why it is one
    // expression: the reader chooses the processor or the card, and the drivers
    // choose which card build. If neither can run, `gpu` falls through to the
    // same order automatic uses and ends on the processor — a transcription
    // must run — and the card on `Nástroje` says so instead of hiding it.
    let graphics = || GRAPHICS_BUILDS.iter().find(|name| runnable(name)).copied();
    if choice == "gpu" {
        if let Some(build) = graphics() {
            return build.to_string();
        }
    } else if choice != "auto" && runnable(choice) {
        return choice.to_string();
    }
    if let Some(build) = graphics() {
        return build.to_string();
    }
    if available.iter().any(|x| x == "cpu") {
        return "cpu".into();
    }
    available[0].clone()
}

pub fn compute_directory(bin: &Path, compute: &str) -> PathBuf {
    if compute == "vychozi" {
        bin.to_path_buf()
    } else {
        bin.join(compute)
    }
}

// --------------------------------------------------------------- state

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ToolCheck {
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub whisper_cli: Option<String>,
    pub model_whisper: Option<String>,
    pub model_vad: Option<String>,
    pub embedding_model: Option<String>,
    pub editor_cli: Option<String>,
    pub editor_server: Option<String>,
    pub editor_model: Option<String>,
    /// Model id actually resolved on disk. It may differ from an obsolete
    /// setting after a different quality was downloaded.
    pub editor_model_id: Option<String>,

    pub portable: bool,
    pub app_directory: String,
    pub webview2_bundled: bool,
    /// The build the next transcription will use.
    pub compute: String,
    pub available_compute_backends: Vec<String>,
    pub nvidia_driver: bool,
    pub vulkan_driver: bool,
    /// The models found in the models folder, without the ggml- prefix.
    pub found_models: Vec<String>,

    pub issues: Vec<UserMessage>,
    pub issues_diarization: Vec<UserMessage>,
    pub issues_editor: Vec<UserMessage>,
}

pub fn check(n: &crate::db::Settings) -> ToolCheck {
    let mut k = ToolCheck::default();
    let na_text = |p: &Option<PathBuf>| p.as_ref().map(|x| x.to_string_lossy().to_string());

    let bin = expand(&n.bin_directory);
    let models = expand(&n.models_directory);

    k.portable = is_portable();
    k.app_directory = app_directory().to_string_lossy().to_string();
    k.webview2_bundled = app_directory().join("webview2").is_dir();
    k.nvidia_driver = has_nvidia();
    k.vulkan_driver = has_vulkan();
    k.available_compute_backends = available_compute_backends(&bin);
    k.compute = choose_compute(&bin, &n.compute);

    let bin_compute = compute_directory(&bin, &k.compute);
    let find_v = vec![bin_compute.clone(), bin.clone()];

    let ffmpeg = find_program_in(&find_v, "ffmpeg");
    let ffprobe = find_program_in(&find_v, "ffprobe");
    let whisper = find_program_in(&[bin_compute], "whisper-cli")
        .or_else(|| find_program_in(&find_v, "whisper-cli"))
        .or_else(|| find_program_in(&find_v, "main"));
    let editor_vulkan = bin.join("editor-vulkan");
    let editor_cpu = bin.join("editor-cpu");
    let editor = if k.vulkan_driver {
        find_program_in(std::slice::from_ref(&editor_vulkan), "llama-cli")
            .or_else(|| find_program_in(std::slice::from_ref(&editor_cpu), "llama-cli"))
    } else {
        find_program_in(std::slice::from_ref(&editor_cpu), "llama-cli")
            .or_else(|| find_program_in(std::slice::from_ref(&editor_vulkan), "llama-cli"))
    };

    k.ffmpeg = na_text(&ffmpeg);
    k.ffprobe = na_text(&ffprobe);
    k.whisper_cli = na_text(&whisper);
    k.editor_cli = na_text(&editor);
    k.editor_server = editor.as_ref().and_then(|cli| {
        let server = cli.with_file_name("llama-server.exe");
        server
            .is_file()
            .then(|| server.to_string_lossy().to_string())
    });

    k.model_whisper = na_text(&find_file(&models, &[&format!("ggml-{}.bin", n.model)]));
    k.model_vad = na_text(&find_file(
        &models,
        &["ggml-silero-v6.2.0.bin", "ggml-silero-v5.1.2.bin"],
    ));
    // The order is deliberate and it is quality, not alphabet. Somebody who
    // already has an older model need not replace it — it is used until a newer
    // one arrives — but once the newer one is on the disk it takes precedence.
    // The Chinese single-language model stays last of all; it is here only so
    // that an old installation is not broken by its disappearance.
    k.embedding_model = na_text(&find_file(
        &models,
        &[
            "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
            "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
            "wespeaker_en_voxceleb_resnet34_LM.onnx",
            "nemo_en_titanet_small.onnx",
            "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            "embedding.onnx",
        ],
    ));
    if !n.editor_model.is_empty() {
        if let Some((id, path)) = resolve_editor_model(n) {
            k.editor_model_id = Some(id);
            k.editor_model = Some(path.to_string_lossy().to_string());
        }
    }
    k.found_models = list_models(&models);

    // For missing programs we also print the folder that was searched.
    // Without it there is no telling "not downloaded" from "downloaded
    // elsewhere" — and the latter is the common case, because the programs
    // folder can be changed in settings.
    let position = bin.to_string_lossy().to_string();

    if k.ffmpeg.is_none() {
        k.issues
            .push(UserMessage::new("tools.ffmpeg_missing_in").with("directory", &position));
    }
    if k.ffprobe.is_none() {
        k.issues
            .push(UserMessage::new("tools.ffprobe_missing_in").with("directory", &position));
    }
    if k.whisper_cli.is_none() {
        k.issues
            .push(UserMessage::new("tools.whisper_missing_in").with("directory", &position));
    }
    if k.model_whisper.is_none() {
        k.issues
            .push(UserMessage::new("tools.whisper_model_missing").with("model", &n.model));
    }
    if k.model_vad.is_none() {
        k.issues.push(UserMessage::new("tools.vad_model_missing"));
    }

    // Speaker recognition needs one model and no program. Until 2026-08-07 it
    // also required `sherpa-onnx-offline-speaker-diarization.exe` and the
    // pyannote segmentation model; both went, because finding where speech is
    // was work the transcript had already done.
    //
    // They were still looked for and still listed in diagnostics after that —
    // two green ticks beside things nothing runs, which is a panel answering
    // "is it there" about files whose answer does not matter. Now they are not
    // looked for at all. Anybody who installed before that date still has them
    // on disk, a few hundred megabytes doing nothing; the application does not
    // delete files it did not put there without being asked.
    if k.embedding_model.is_none() {
        k.issues_diarization
            .push(UserMessage::new("tools.embedding_model_missing"));
    }

    if !n.editor_model.is_empty() {
        if k.editor_cli.is_none() {
            k.issues_editor
                .push(UserMessage::new("tools.editor_program_missing"));
        }
        if k.editor_server.is_none() {
            k.issues_editor
                .push(UserMessage::new("tools.editor_server_missing"));
        }
        if k.editor_model.is_none() {
            k.issues_editor.push(
                UserMessage::new("tools.editor_model_missing").with("model", &n.editor_model),
            );
        }
    }

    k
}

/// Resolves the configured editor model and repairs a stale selection by
/// falling back to another quality that is already installed. This matters
/// when module management downloaded Best while an older dialog left Balanced
/// in settings: asking for another multi-gigabyte download would create a loop.
pub fn resolve_editor_model(n: &crate::db::Settings) -> Option<(String, PathBuf)> {
    let models = expand(&n.models_directory);
    let known = ["gemma-4-12b-q4", "gemma-4-e4b-q4", "gemma-4-e2b-q4"];
    std::iter::once(n.editor_model.as_str())
        .chain(known)
        .filter(|id| !id.is_empty())
        .find_map(|id| {
            let path = models.join("editor").join(format!("{id}.gguf"));
            path.is_file().then(|| (id.to_string(), path))
        })
}

/// Lists the transcription models actually on the disk, so the menu does not
/// offer choices this copy did not bring with it.
pub fn list_models(models: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(models)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let without = name.strip_prefix("ggml-")?.strip_suffix(".bin")?;
            if without.starts_with("silero") {
                None
            } else {
                Some(without.to_string())
            }
        })
        .collect();
    v.sort();
    v
}

// ---------------------------------------------------------------- audio

pub fn audio_duration(ffprobe: &Path, file: &Path) -> Result<f64> {
    let output = command(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
        ])
        .arg(file)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim()
        .parse::<f64>()
        .map_err(|_| anyhow!("Nepodařilo se zjistit délku nahrávky"))
}

/// Both whisper.cpp and sherpa-onnx work exclusively with 16 kHz mono PCM.
///
/// Compressing this would be tempting — an hour comes to roughly 115 MB — but
/// pointless: neither program can read anything but an uncompressed WAV, so a
/// compressed file would have to be unpacked back to exactly this before use.
/// The size is dealt with by deleting the file, not by shrinking it; see
/// `clear_leftover_temporary`.
pub fn convert_to_wav(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    runner: &dyn CommandRunner,
) -> std::result::Result<(), UserMessage> {
    let mut program = command(ffmpeg);
    program
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(input)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(output);
    let Some((status, stderr)) = runner.run(program)? else {
        // Killed. The worker reads its own cancel flag before this message.
        return Err(UserMessage::new("transcription.cancelled"));
    };
    if !status.success() {
        return Err(
            UserMessage::new("transcription.audio_conversion_failed").with("reason", stderr)
        );
    }
    Ok(())
}

// ------------------------------------------------------ precise playback

/// Browser media engines seek some long variable-bitrate MP3 files through
/// the coarse 100-entry Xing table. A requested word can consequently land at
/// the next table entry several seconds later even though the transcript time
/// is correct. MP4 carries a sample table instead, so keep a private AAC/M4A
/// copy for playback and leave the user's source file untouched.
pub fn playback_cache_directory(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("playback-cache")
}

fn safe_cache_key(recording_id: &str) -> String {
    let key: String = recording_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .collect();
    if key.is_empty() {
        "recording".into()
    } else {
        key
    }
}

fn source_fingerprint(source: &Path) -> Result<u64> {
    use std::hash::{DefaultHasher, Hash, Hasher};

    let metadata = source.metadata()?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    Ok(hasher.finish())
}

fn playback_proxy_path(db_path: &Path, recording_id: &str, source: &Path) -> Result<PathBuf> {
    let fingerprint = source_fingerprint(source)?;
    Ok(playback_cache_directory(db_path).join(format!(
        "{}-{fingerprint:016x}.m4a",
        safe_cache_key(recording_id)
    )))
}

/// The cached playback copy of a recording whose source has gone, if one is
/// still sitting there.
///
/// Found by prefix rather than by fingerprint: the fingerprint is computed
/// from the source's own metadata and there is no source left to ask. At most
/// one proxy per recording survives — `remove_playback_proxies` runs whenever
/// the path changes — so the first match is the only match.
pub fn existing_playback_proxy(db_path: &Path, recording_id: &str) -> Option<PathBuf> {
    let prefix = format!("{}-", safe_cache_key(recording_id));
    std::fs::read_dir(playback_cache_directory(db_path))
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            let named = path
                .file_name()
                .map(|name| name.to_string_lossy().starts_with(&prefix))
                .unwrap_or(false);
            named && path.metadata().is_ok_and(|metadata| metadata.len() > 0)
        })
}

/// Removes every cached playback copy belonging to one recording.
pub fn remove_playback_proxies(db_path: &Path, recording_id: &str) {
    let directory = playback_cache_directory(db_path);
    let prefix = format!("{}-", safe_cache_key(recording_id));
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Returns a source whose media timeline supports precise word-level seeking.
///
/// Formats with their own accurate sample/index tables are played directly.
/// MP3 is converted once to AAC in an M4A container and cached beside the
/// database. The filename fingerprints the source path, size and modification
/// time, so replacing or moving the original can never reuse a stale proxy.
pub fn ensure_seekable_playback(
    ffmpeg: &Path,
    db_path: &Path,
    recording_id: &str,
    source: &Path,
    runner: &dyn CommandRunner,
) -> std::result::Result<PathBuf, UserMessage> {
    if !source.is_file() {
        return Err(UserMessage::new("playback.source_missing"));
    }
    let is_mp3 = source
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"));
    if !is_mp3 {
        return Ok(source.to_path_buf());
    }

    let destination = playback_proxy_path(db_path, recording_id, source)?;
    if destination
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 0)
    {
        return Ok(destination);
    }

    let directory = playback_cache_directory(db_path);
    std::fs::create_dir_all(&directory)?;
    let temporary = directory.join(format!(
        ".{}-{}.part.m4a",
        safe_cache_key(recording_id),
        uuid::Uuid::new_v4()
    ));
    let mut program = command(ffmpeg);
    program
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(source)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
        ])
        .arg(&temporary);
    let outcome = runner.run(program)?;
    let Some((status, stderr)) = outcome else {
        // Killed mid-encode: the half-written temporary is ours alone, and
        // leaving it behind would be a growing pile of dead .part files.
        let _ = std::fs::remove_file(&temporary);
        return Err(UserMessage::new("transcription.cancelled"));
    };
    if !status.success() {
        let _ = std::fs::remove_file(&temporary);
        return Err(UserMessage::new("playback.conversion_failed").with("reason", stderr));
    }

    // Another request may have finished while this one was encoding. Keep the
    // complete file that won the race and discard only our private temporary.
    if destination.is_file() {
        let _ = std::fs::remove_file(&temporary);
    } else {
        std::fs::rename(&temporary, &destination)?;
    }

    // A changed source gets a new fingerprint. Once the replacement is ready,
    // old copies for the same recording serve no purpose.
    let keep = destination.file_name();
    let prefix = format!("{}-", safe_cache_key(recording_id));
    if let Ok(entries) = std::fs::read_dir(&directory) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with(&prefix) && Some(name.as_os_str()) != keep {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(destination)
}

/// Names of the temporary folders the app works in, under the system temp dir.
const TEMPORARY_FOLDERS: [&str; 4] = [
    "whisp",
    "whisp-speakers",
    "whisp-downloads",
    "whisp-benchmark",
];

/// Throws away temporary files left behind by a previous run.
///
/// Every one of these folders is deleted at the end of the work that created
/// it. What stays behind is what a crash or a forced quit interrupted — and
/// a converted hour of audio is around 115 MB, so it adds up.
///
/// Safe to call only at startup, before anything has been started: at that
/// moment nothing can be using these folders. Returns the bytes reclaimed.
pub fn clear_leftover_temporary() -> u64 {
    fn size_of(path: &Path) -> u64 {
        let Ok(entries) = std::fs::read_dir(path) else {
            return 0;
        };
        entries
            .filter_map(|e| e.ok())
            .map(|e| match e.file_type() {
                Ok(t) if t.is_dir() => size_of(&e.path()),
                _ => e.metadata().map(|m| m.len()).unwrap_or(0),
            })
            .sum()
    }

    let mut reclaimed = 0;
    for name in TEMPORARY_FOLDERS {
        let folder = std::env::temp_dir().join(name);
        if !folder.is_dir() {
            continue;
        }
        let size = size_of(&folder);
        if std::fs::remove_dir_all(&folder).is_ok() {
            reclaimed += size;
        }
    }
    reclaimed
}

/// Loudness envelope of a recording — `count` values in the range 0–1.
///
/// Web Audio in the window cannot be used for this: Tauri serves files from a
/// different origin than the window, the track is treated as cross-origin, and
/// wiring it into an analyser silences it. So ffmpeg computes it once up front.
pub fn waveform_amplitude(ffmpeg: &Path, input: &Path, count: usize) -> Result<Vec<u8>> {
    // 4 kHz mono is plenty: this is a loudness envelope, not listening. An
    // hour of audio comes to 28 MB, which goes through a pipe and is dropped.
    let output = command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(input)
        .args(["-ac", "1", "-ar", "4000", "-f", "s16le", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;
    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg selhal: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let sample_count = output.stdout.len() / 2;
    if sample_count == 0 || count == 0 {
        return Ok(Vec::new());
    }
    let samples_per_bucket = (sample_count / count).max(1);

    let mut points: Vec<f32> = Vec::with_capacity(count);
    for k in 0..count {
        let from = k * samples_per_bucket;
        let to = ((k + 1) * samples_per_bucket).min(sample_count);
        if from >= to {
            points.push(0.0);
            continue;
        }
        // RMS rather than peak: peaks would turn every click into a
        // full-height bar and the envelope would lose its shape.
        let mut sum = 0.0f64;
        for i in from..to {
            let v = i16::from_le_bytes([output.stdout[i * 2], output.stdout[i * 2 + 1]]);
            let x = v as f64 / 32768.0;
            sum += x * x;
        }
        points.push((sum / (to - from) as f64).sqrt() as f32);
    }

    // Normalise against the loudest point, otherwise a quiet recording is flat.
    let peak = points.iter().cloned().fold(0.0f32, f32::max);
    if peak <= 0.0 {
        return Ok(vec![0; points.len()]);
    }

    // A square root spreads out the quiet passages: in speech most values sit
    // low and a linear scale would flatten them into a straight line.
    Ok(points
        .iter()
        .map(|point| ((point / peak).sqrt() * 255.0).round().clamp(0.0, 255.0) as u8)
        .collect())
}

/// Real frequency-band peaks sampled over time.
///
/// `showfreqs` performs the FFT inside ffmpeg. Each video frame is a tiny
/// grayscale bar chart; this function reduces it to one byte per frequency
/// band so the UI can animate a stationary equalizer without decoding audio.
pub fn equalizer_peaks(
    ffmpeg: &Path,
    input: &Path,
    band_count: usize,
    frames_per_second: usize,
) -> Result<Vec<u8>> {
    const FRAME_HEIGHT: usize = 32;
    if band_count == 0 || frames_per_second == 0 {
        return Ok(Vec::new());
    }

    let filter = format!(
        "showfreqs=s={}x{}:rate={}:mode=bar:ascale=sqrt:fscale=log:colors=white,format=gray",
        band_count, FRAME_HEIGHT, frames_per_second
    );
    let output = command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(input)
        .args(["-filter_complex", &filter, "-an", "-f", "rawvideo", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;
    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg spectrum analysis failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let frame_size = band_count * FRAME_HEIGHT;
    let frame_count = output.stdout.len() / frame_size;
    let mut peaks = Vec::with_capacity(frame_count * band_count);
    for frame in output.stdout.chunks_exact(frame_size) {
        for band in 0..band_count {
            let active_pixels = (0..FRAME_HEIGHT)
                .filter(|row| frame[row * band_count + band] > 8)
                .count();
            peaks.push(
                ((active_pixels as f64 / FRAME_HEIGHT as f64) * 255.0)
                    .round()
                    .clamp(0.0, 255.0) as u8,
            );
        }
    }
    Ok(peaks)
}

/// A slice of a recording, used by the performance benchmark.
pub fn clip(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    seconds: f64,
) -> std::result::Result<(), UserMessage> {
    let status = command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(input)
        .args([
            "-t",
            &seconds.to_string(),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
        ])
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if !status.success() {
        return Err(UserMessage::new("benchmark.clip_failed"));
    }
    Ok(())
}

#[cfg(test)]
mod compute_choice_tests {
    use super::*;

    /// A throwaway `bin` folder holding only the named builds. No test
    /// dependency: one counter keeps the directories from colliding.
    fn machine_with(backends: &[&str]) -> PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "whisp-compute-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        for name in backends {
            let sub = dir.join(name);
            std::fs::create_dir_all(&sub).unwrap();
            std::fs::write(sub.join("whisper-cli.exe"), b"").unwrap();
        }
        dir
    }

    /// The reported machine: an AMD card, `bin\cuda` downloaded, and `cuda`
    /// stored in settings. The folder exists, the hardware cannot use it, and
    /// the old code returned it anyway — so the CUDA build ran, found no
    /// device, and quietly transcribed on the processor.
    #[test]
    fn a_stored_choice_the_machine_cannot_run_is_not_honoured() {
        let bin = machine_with(&["cuda", "vulkan", "cpu"]);
        let chosen = choose_compute(&bin, "cuda");
        if has_nvidia() {
            assert_eq!(chosen, "cuda", "with an NVIDIA driver the choice stands");
        } else {
            assert_ne!(
                chosen, "cuda",
                "without an NVIDIA driver it must not be chosen"
            );
        }
    }

    /// The predicate itself, independent of any machine: cpu always runs, and
    /// the accelerated builds are gated on their driver.
    #[test]
    fn only_accelerated_builds_are_gated_on_a_driver() {
        assert!(usable_compute("cpu"));
        assert!(usable_compute("vychozi"));
        assert_eq!(usable_compute("cuda"), has_nvidia());
        assert_eq!(usable_compute("vulkan"), has_vulkan());
    }

    /// Nothing accelerated available: the processor build is the answer, and
    /// it must never be refused.
    #[test]
    fn the_processor_build_is_always_acceptable() {
        let bin = machine_with(&["cpu"]);
        assert_eq!(choose_compute(&bin, "cpu"), "cpu");
        assert_eq!(choose_compute(&bin, "auto"), "cpu");
        assert_eq!(choose_compute(&bin, "cuda"), "cpu");
        assert_eq!(choose_compute(&bin, "gpu"), "cpu");
    }

    /// `gpu` is the reader's word for the card and never names a build. It
    /// resolves to whichever graphics build this machine can run, and to the
    /// processor when it can run neither — which is the state `Nástroje` has
    /// to report rather than hide.
    #[test]
    fn the_card_is_chosen_as_a_family_not_as_a_build() {
        let bin = machine_with(&["cuda", "vulkan", "cpu"]);
        let chosen = choose_compute(&bin, "gpu");
        if has_nvidia() {
            assert_eq!(chosen, "cuda", "CUDA is the faster build on an NVIDIA card");
        } else if has_vulkan() {
            assert_eq!(chosen, "vulkan", "no NVIDIA driver leaves Vulkan");
        } else {
            assert_eq!(
                chosen, "cpu",
                "no graphics driver at all: it must still run"
            );
        }
    }

    /// Asking for the processor is honoured even where a card would be faster.
    /// Automatic is the state that prefers the card; a pick is a pick.
    #[test]
    fn the_processor_can_be_asked_for_over_a_usable_card() {
        let bin = machine_with(&["cuda", "vulkan", "cpu"]);
        assert_eq!(choose_compute(&bin, "cpu"), "cpu");
    }

    /// Automatic takes the fastest build the machine can run, which is the
    /// whole promise of the resting state.
    #[test]
    fn automatic_prefers_the_card_over_the_processor() {
        let bin = machine_with(&["vulkan", "cpu"]);
        let expected = if has_vulkan() { "vulkan" } else { "cpu" };
        assert_eq!(choose_compute(&bin, "auto"), expected);
    }

    /// A build that is not downloaded cannot be chosen, however it was asked
    /// for. The processor pick on a machine that only downloaded the graphics
    /// build is the reported case: it runs on the card, and the screen has to
    /// say that it did.
    #[test]
    fn a_build_that_is_not_downloaded_is_not_chosen() {
        let bin = machine_with(&["vulkan"]);
        // Vulkan either because the driver is there, or as the only build on
        // the disk when it is not. Both are the same answer to this test: the
        // processor was asked for and is not what will run.
        assert_eq!(choose_compute(&bin, "cpu"), "vulkan");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_editor_quality_repairs_a_stale_selection() {
        let directory =
            std::env::temp_dir().join(format!("whisp-editor-model-test-{}", uuid::Uuid::new_v4()));
        let editor_directory = directory.join("editor");
        std::fs::create_dir_all(&editor_directory).unwrap();
        std::fs::write(editor_directory.join("gemma-4-12b-q4.gguf"), b"model").unwrap();

        let settings = crate::db::Settings {
            models_directory: directory.to_string_lossy().to_string(),
            editor_model: "gemma-4-e4b-q4".into(),
            ..Default::default()
        };

        let resolved = resolve_editor_model(&settings).unwrap();
        assert_eq!(resolved.0, "gemma-4-12b-q4");
        assert!(resolved.1.ends_with("gemma-4-12b-q4.gguf"));

        // The path is a UUID-named child of the system temp directory created
        // by this test, never a shared model or application directory.
        std::fs::remove_dir_all(directory).unwrap();
    }
}
