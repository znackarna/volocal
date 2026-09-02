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

// A root of one test's own, in place of the machine's.
//
// `tools_root()` is not derived from the settings — `bin` and `models` are, but
// everything beside them is not, and `installed.json` is the one that matters
// here. So a test that built a scratch folder and pointed both settings at it
// still wrote its installation records into
// `%LOCALAPPDATA%\cz.znackarna.volocal\installed.json`: the real one, on the
// machine running the tests. Four of them did, and because
// `record_installation` reads the whole map, edits it and writes it back, two
// running side by side each dropped the other's entry — which is the
// intermittent `no entry found for key`. The same runs were also editing the
// record of the developer's own installation.
//
// It is a thread-local and not an environment variable because `LOCALAPPDATA`
// is process-wide and `cargo test` runs these beside each other in one process
// — the reason `rename_tools_root` takes its folder as an argument. `cargo
// test` gives each test a thread of its own and the work it calls happens on
// that thread, so a root set here belongs to exactly one test.
#[cfg(test)]
thread_local! {
    static TEST_ROOT: std::cell::RefCell<Option<PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

/// Points everything under `tools_root()` at this test's own folder, for the
/// rest of this test. Call it once, with a directory nothing else uses.
#[cfg(test)]
pub fn use_tools_root_for_this_test(root: &Path) {
    TEST_ROOT.with(|slot| *slot.borrow_mut() = Some(root.to_path_buf()));
}

pub fn tools_root() -> PathBuf {
    #[cfg(test)]
    if let Some(root) = TEST_ROOT.with(|slot| slot.borrow().clone()) {
        return root;
    }
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

// ---------------------------------------------------------------- memory

/// How much memory this computer has, in whole gigabytes, or nothing.
///
/// The drivers and the graphics card have been read off this machine since the
/// wizard was written; memory never was, and the first-run question now names
/// what it found. **`None` is a real answer and the screen must be able to draw
/// it** — on a platform this cannot ask, or a call that fails, the sentence
/// says what it does know and stops, rather than printing a guess that a reader
/// can check against their own machine in ten seconds and find wrong.
pub fn total_memory_gb() -> Option<u32> {
    installed_memory_bytes().and_then(memory_gigabytes)
}

/// Bytes to the number a reader would use for the same machine.
///
/// Rounded rather than truncated, and that is the whole of the arithmetic worth
/// explaining: Windows reports what the operating system may use, which on a
/// 16 GB machine is about 15.8 GiB because the firmware and the graphics chip
/// hold some of it back. Truncating prints `15 GB` on a box that says 16, which
/// is exactly the kind of number somebody goes looking for the missing part of.
///
/// Below half a gigabyte nothing is reported. No computer that could run this
/// application has that little, so such an answer is a failed reading rather
/// than a small machine, and a failed reading must not reach the screen.
fn memory_gigabytes(bytes: u64) -> Option<u32> {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    if bytes < 512 * 1024 * 1024 {
        return None;
    }
    Some((bytes as f64 / GIB).round().max(1.0) as u32)
}

#[cfg(windows)]
fn installed_memory_bytes() -> Option<u64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        // The call reads this to know which version of the struct it was given.
        // Left at zero it fails, which is the one way this can be got wrong.
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // Safe: `status` is a live, correctly sized struct on this stack, and the
    // call writes only into it. `GetPhysicallyInstalledSystemMemory` was the
    // other candidate — it reads the memory modules out of SMBIOS and would
    // give the number on the box exactly — but it fails outright on firmware
    // whose tables it dislikes, and a fact the screen may not get at all is
    // worse than one it has to round.
    unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
    (status.ullTotalPhys > 0).then_some(status.ullTotalPhys)
}

#[cfg(not(windows))]
fn installed_memory_bytes() -> Option<u64> {
    // The application ships for Windows. Everything else builds and reports
    // nothing, which is a state the screen already has to draw.
    None
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
    /// Which model that turned out to be. It differs from `settings.model`
    /// exactly when the setting could not be honoured, and a screen showing the
    /// chosen card has to draw this one instead - otherwise it names a model
    /// that is not the one transcribing.
    pub model_whisper_id: Option<String>,
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
    /// Whole gigabytes of memory, or `None` where it could not be read. The
    /// first-run question names it; nothing decides anything by it, because
    /// nothing here has ever measured what a model needs.
    pub memory_gb: Option<u32>,
    /// The models found in the models folder, without the ggml- prefix.
    pub found_models: Vec<String>,

    pub issues: Vec<UserMessage>,
    pub issues_diarization: Vec<UserMessage>,
    pub issues_editor: Vec<UserMessage>,
    /// The components that would answer `issues`, by id.
    ///
    /// **`issues` says what is wrong and this says what to press.** The
    /// catalogue's own `required` flag cannot: it is true of `ffmpeg` and
    /// `vad` and of nothing else, because no single transcription model and no
    /// single whisper build is required — any one of several will do, and a
    /// static flag has no way to say *one of these*. So a model deleted by hand
    /// raised the card's warning and marked no row in the listing it sent the
    /// reader to, which is a screen saying *something is missing* and refusing
    /// to say what.
    ///
    /// Filled from the same reads that filled `issues`, so the two cannot
    /// disagree about what is on the disk.
    pub needed: Vec<String>,
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
    k.memory_gb = total_memory_gb();
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

    if let Some((id, path)) = resolve_transcription_model(n) {
        k.model_whisper_id = Some(id);
        k.model_whisper = Some(path.to_string_lossy().to_string());
    }
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
        /* Named by the model that would answer it, not by `settings.model`.
        That field is empty on a machine where a model was chosen and never
        landed, and the sentence then read *Chybí model `ggml-.bin`* - a file
        name with nothing in it, shown to the one reader least able to guess
        what it meant. `wanted_model` is the same order `needed` uses below, so
        the sentence and the row that answers it name the same thing. */
        k.issues
            .push(UserMessage::new("tools.whisper_model_missing").with("model", wanted_model(n)));
    }
    if k.model_vad.is_none() {
        k.issues.push(UserMessage::new("tools.vad_model_missing"));
    }

    /* What to press, for each of those. ffprobe ships inside the ffmpeg
    archive, so two issues have one answer; the whisper build and the model are
    chosen the way the catalogue recommends them, from the drivers, because
    that is the row the reader would be told to take anyway.

    The model the setting names comes first: somebody who deleted
    `ggml-large-v3.bin` is being offered the file they had, not the one this
    machine would have been sold. Only if that name matches no component at
    all — a model put in the folder by hand and then removed — does the
    machine's own pair answer instead. */
    if k.ffmpeg.is_none() || k.ffprobe.is_none() {
        k.needed.push("ffmpeg".into());
    }
    if k.whisper_cli.is_none() {
        k.needed.push(
            if k.nvidia_driver {
                "whisper-cuda"
            } else if k.vulkan_driver {
                "whisper-vulkan"
            } else {
                "whisper-cpu"
            }
            .into(),
        );
    }
    if k.model_whisper.is_none() {
        /* Three answers, in the order of how much each knows about this reader.

        The setting names a model: that is the file the transcription will look
        for, and offering anything else would be offering something that does
        not fix it.

        It can name nothing, and does on any machine where a model was chosen
        but never landed - `settings.model` is written when a download finishes
        and is empty until then. **`quality_choice` is the answer to the
        question that was actually asked**, and it survives the model being
        empty. Reported on 20 August: `model` empty, `quality_choice` `fast`,
        the fast model deleted by hand - and the row marked as necessary was
        the accurate one, three gigabytes, because this fell straight through
        to the machine. The right model for the graphics card and the wrong
        answer to the person, who had said *fast* and could see they had.

        The drivers are last, being a guess about the computer made where there
        is nothing else at all to go on. */
        let by_machine = if k.nvidia_driver || k.vulkan_driver {
            MODEL_ACCURATE
        } else {
            MODEL_FAST
        };
        let model = wanted_model(n);
        k.needed.push(
            crate::download::component_for_model(&model)
                .or_else(|| crate::download::component_for_model(by_machine))
                .unwrap_or_else(|| "model-turbo".into()),
        );
    }
    if k.model_vad.is_none() {
        k.needed.push("vad".into());
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

/// Which model this reader is owed, when none is on the disk.
///
/// The same order `resolve_transcription_model` searches in, minus the disk:
/// what the setting names, then what the recorded choice implies. Empty when
/// neither says anything, which is a machine nobody has ever asked.
///
/// One function so that the sentence saying what is missing and the row offered
/// to fix it cannot name two different models - they did, and the sentence was
/// naming nothing at all.
fn wanted_model(n: &crate::db::Settings) -> String {
    if !n.model.is_empty() {
        return n.model.clone();
    }
    match n.quality_choice.as_str() {
        "fast" => MODEL_FAST.into(),
        "accurate" => MODEL_ACCURATE.into(),
        _ => String::new(),
    }
}

/// Resolves the transcription model, repairing a setting that names a file
/// which is not there.
///
/// **The disk decides, and it is the only thing that does.** Until 20 August
/// this application kept three separate notes saying *this is the one I asked
/// for* - a `localStorage` record honoured by `App.tsx`, another one in
/// Settings, and a set inside the wizard - each with its own lifetime, none of
/// them asking whether the file had arrived. Every paradox found in that flow
/// was one of those notes outliving what it described: a setting naming a
/// deleted model, a card saying *stahuje se...* for ever, a first run that
/// congratulated itself while the banner behind it still asked for a model.
///
/// A note may say what somebody wanted. Whether it arrived is a question for
/// the disk, and this is where it is asked.
///
/// The order is the same shape as `resolve_editor_model` below, and for the
/// same reason: asking for another multi-gigabyte download because a chosen
/// file is missing, when a perfectly good one is sitting beside it, is a loop.
///
/// 1. what the setting names - the answer, when there is one;
/// 2. what `quality_choice` implies, which survives `model` being empty and is
///    empty only on a machine where nobody has ever been asked;
/// 3. any offered model that is actually here, best first.
///
/// `check` reports which of the three answered, so a screen can say the model
/// in force rather than the model on record.
pub fn resolve_transcription_model(n: &crate::db::Settings) -> Option<(String, PathBuf)> {
    let models = expand(&n.models_directory);
    let by_choice = match n.quality_choice.as_str() {
        "fast" => Some(MODEL_FAST),
        "accurate" => Some(MODEL_ACCURATE),
        _ => None,
    };
    std::iter::once(n.model.as_str())
        .chain(by_choice)
        .chain(OFFERED_MODELS)
        .filter(|id| !id.is_empty())
        .find_map(|id| {
            let path = models.join(format!("ggml-{id}.bin"));
            path.is_file().then(|| (id.to_string(), path))
        })
}

/// The two the cards ask about, and the middle one nothing offers any more but
/// a machine set up before 14 August 2026 may still be running on.
///
/// Written here rather than derived from the catalogue because the neighbour
/// below does the same with its own three, and a test holds this list to the
/// catalogue so the two cannot drift.
const MODEL_ACCURATE: &str = "large-v3";
const MODEL_FAST: &str = "large-v3-turbo-q5_0";
const OFFERED_MODELS: [&str; 3] = [MODEL_ACCURATE, "large-v3-q5_0", MODEL_FAST];

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
    let ask = |arguments: &[&str]| -> Result<String> {
        let output = command(ffprobe)
            .args(arguments)
            .arg(file)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    };

    let stated = ask(&[
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
    ])?;
    if let Ok(seconds) = stated.parse::<f64>() {
        return Ok(seconds);
    }

    /* **A file recorded live has no length written in it.** `MediaRecorder`
    streams its container out as it goes and never returns to fill the header
    in, so `format=duration` answers `N/A` - on a take rescued after a crash,
    and on any WebM that arrived the same way. The archive card then said 0:00
    about twelve seconds of somebody talking.

    The timestamps are still there, so the last packet's is the length. It
    reads packet headers rather than audio: 56 ms over a twelve-second take on
    the machine this was found on, and it grows with the number of packets
    rather than with the sound in them.

    Tried second and not first, because where a header states the length that
    is both cheaper and what every other tool would answer. */
    let timestamps = ask(&[
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "packet=pts_time",
        "-of",
        "csv=p=0",
    ])?;
    timestamps
        .lines()
        .rev()
        .find_map(|line| line.trim().parse::<f64>().ok())
        .ok_or_else(|| anyhow!("Nepodařilo se zjistit délku nahrávky"))
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

/// The ffmpeg arguments that cut one stretch of audio out of a recording.
///
/// **Two things here are not preferences, and the reproduction in `CLAUDE.md`
/// is why.**
///
/// `-ss` and `-to` come *after* `-i`, which makes them output options: ffmpeg
/// then decodes from the beginning and starts writing at the requested
/// instant. Put before `-i` they are an input seek, which lands on the nearest
/// index entry — the same coarse landing that once made a click on `když` play
/// `zavané` eight seconds later.
///
/// And the audio is always re-encoded. A stream copy can only cut on a frame
/// boundary, so it moves the start by up to a frame's worth and writes the
/// wrong first syllable. A clip is seconds of work; correctness is worth more
/// than the copy.
///
/// Returned as a list so a test can hold them to it. A comment saying "do not
/// use -c copy" is not a check.
pub fn cut_arguments(input: &Path, output: &Path, from: f64, to: f64) -> Vec<String> {
    let at = |t: f64| format!("{:.3}", t.max(0.0));
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-ss".into(),
        at(from),
        "-to".into(),
        at(to),
        // Audio only: the source may be a video, and a clip is for listening.
        "-vn".into(),
        output.to_string_lossy().into_owned(),
    ]
}

/// Cuts one stretch of audio into `output`, which the caller has chosen the
/// extension of — ffmpeg picks the encoder from it.
pub fn cut_audio(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    from: f64,
    to: f64,
    runner: &dyn CommandRunner,
) -> std::result::Result<(), UserMessage> {
    let mut program = command(ffmpeg);
    program.args(cut_arguments(input, output, from, to));
    let Some((status, stderr)) = runner.run(program)? else {
        return Err(UserMessage::new("transcription.cancelled"));
    };
    if !status.success() {
        return Err(UserMessage::new("clip.audio_failed").with("reason", stderr));
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

/// How many playback copies are being encoded right now.
///
/// It exists for one question, asked by the module listing: may ffmpeg be
/// deleted? Every other program this application runs is owned by a registry
/// that already answers it — `TranscriptionTask`, `AiEditTask`,
/// `OnlineImportTask`, the waveform jobs — and this one is owned by nobody, as
/// the comment at its only caller has said since it was written: it is prepared
/// on demand when a finished transcript is opened.
///
/// A count rather than a flag, because two recordings can be prepared at once,
/// and raised and lowered by a guard rather than by a line at the end — the same
/// shape as `WaveformJob` and `INSTALLING`, and for the same reason: a panic in
/// between would otherwise leave ffmpeg locked for the life of the process.
static PLAYBACK_CONVERSIONS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub fn playback_conversion_running() -> bool {
    PLAYBACK_CONVERSIONS.load(std::sync::atomic::Ordering::Relaxed) > 0
}

struct PlaybackConversion;

impl PlaybackConversion {
    fn begin() -> Self {
        PLAYBACK_CONVERSIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Self
    }
}

impl Drop for PlaybackConversion {
    fn drop(&mut self) {
        PLAYBACK_CONVERSIONS.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
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
    // From here until this function returns, ffmpeg is working.
    let _conversion = PlaybackConversion::begin();
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

/// Throws away the working folders an interrupted online import left behind.
///
/// **These do not live in the temp directory**, and that is why they needed a
/// sweep of their own. `online_import` works inside `.download-<uuid>` beside
/// the recordings, because the finished file is moved into that same folder and
/// a move within one filesystem is a rename rather than a copy of a gigabyte.
/// Its own comment says it is removed when the work ends — and it is, on the
/// paths the code walks out through. A crash, a forced quit, or the job object
/// closing the window takes none of those paths, and what stays behind is a
/// hidden folder holding a full-size video in the one folder somebody browses.
///
/// Same rule as `clear_leftover_temporary`: startup only, before anything has
/// been started, when nothing can be inside one of them.
pub fn clear_leftover_imports(recordings: &Path) -> u64 {
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

    let Ok(entries) = std::fs::read_dir(recordings) else {
        return 0;
    };
    let mut reclaimed = 0;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        // The prefix is the whole test, and it is ours: nothing else in this
        // application or out of it writes a folder called `.download-…` here.
        let ours = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(".download-"));
        if !ours || !path.is_dir() {
            continue;
        }
        let size = size_of(&path);
        if std::fs::remove_dir_all(&path).is_ok() {
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
    /// **The one test that stands between a clip and the fault in `CLAUDE.md`.**
    ///
    /// `-ss` after `-i` is a decoded seek and lands on the instant asked for;
    /// before `-i` it lands on the nearest index entry, which is how a click on
    /// one word came to play a sentence eight seconds later. And a stream copy
    /// cuts only on frame boundaries. Both are one flag away at any time, so
    /// they are held here as a list rather than described in a comment.
    #[test]
    fn a_clip_is_cut_by_decoding_and_never_by_copying() {
        let arguments =
            super::cut_arguments(Path::new("in.mp3"), Path::new("out.mp3"), 724.0, 871.25);
        let at = |flag: &str| arguments.iter().position(|a| a == flag);

        let input = at("-i").expect("the source is given");
        assert!(
            at("-ss").expect("a start") > input,
            "-ss must follow -i: {arguments:?}"
        );
        assert!(
            at("-to").expect("an end") > input,
            "-to must follow -i: {arguments:?}"
        );
        assert!(
            !arguments.iter().any(|a| a == "copy"),
            "a clip is re-encoded, never stream-copied: {arguments:?}"
        );
        assert_eq!(arguments[at("-ss").unwrap() + 1], "724.000");
        assert_eq!(arguments[at("-to").unwrap() + 1], "871.250");
    }

    /// A clip asked for from before the beginning starts at the beginning.
    #[test]
    fn a_clip_never_starts_before_the_recording_does() {
        let arguments = super::cut_arguments(Path::new("in.wav"), Path::new("out.wav"), -3.0, 12.0);
        let start = arguments.iter().position(|a| a == "-ss").unwrap();
        assert_eq!(arguments[start + 1], "0.000");
    }

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

#[cfg(test)]
mod memory_tests {
    use super::*;

    /// Windows reports what the operating system may use, not what is in the
    /// slots. A 16 GB machine answers about 15.8 GiB, and the screen has to say
    /// 16 — that is the number the reader can check against their own computer.
    #[test]
    fn the_reading_is_rounded_to_the_number_on_the_box() {
        assert_eq!(memory_gigabytes(17_179_869_184), Some(16), "a clean 16 GiB");
        assert_eq!(
            memory_gigabytes(17_005_137_920),
            Some(16),
            "16 GB with the firmware's share taken out"
        );
        assert_eq!(memory_gigabytes(8_465_104_896), Some(8));
        assert_eq!(memory_gigabytes(34_284_924_928), Some(32));
    }

    /// A reading that cannot be true is not a small machine; it is a failed
    /// call. Nothing goes on screen for it.
    #[test]
    fn an_unbelievable_reading_is_not_reported() {
        assert_eq!(memory_gigabytes(0), None);
        assert_eq!(memory_gigabytes(64 * 1024 * 1024), None);
    }

    /// The reading itself, on the machine running the tests. It is the half
    /// that no arithmetic can check: whether the call is wired up at all.
    #[cfg(windows)]
    #[test]
    fn this_machine_says_how_much_memory_it_has() {
        let gigabytes = total_memory_gb().expect("Windows must be able to answer this");
        assert!(
            (1..=4096).contains(&gigabytes),
            "implausible reading: {gigabytes} GB"
        );
    }
}

#[cfg(test)]
mod needed_tests {
    use super::*;

    /// A machine with nothing installed, in a folder of this test's own.
    ///
    /// `use_tools_root_for_this_test` matters as much as the two directories:
    /// settings name `bin` and `models`, and everything else `check` looks at
    /// hangs off the tools root, which without this is the real one.
    fn bare_machine(name: &str, model: &str) -> crate::db::Settings {
        let directory = std::env::temp_dir().join(format!("volocal-check-{name}"));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(directory.join("bin")).expect("scratch");
        std::fs::create_dir_all(directory.join("models")).expect("scratch");
        use_tools_root_for_this_test(&directory);
        crate::db::Settings {
            bin_directory: directory.join("bin").to_string_lossy().to_string(),
            models_directory: directory.join("models").to_string_lossy().to_string(),
            model: model.into(),
            editor_model: String::new(),
            ..Default::default()
        }
    }

    /// **The invariant the report of 20 August broke.** A model deleted by hand
    /// raised the card's warning and marked no row in the listing that warning
    /// sent the reader to: complaints on one screen, nothing to press on the
    /// other.
    ///
    /// Nothing here asserts on ffmpeg or on the whisper build, and that is not
    /// laziness: `find_program_in` falls back to `PATH`, so on a machine with
    /// ffmpeg installed for other reasons neither is missing and neither is
    /// asked for. The models have no such fallback, and the pairing itself has
    /// none either — which is what is checked.
    #[test]
    fn every_complaint_leaves_something_to_press() {
        let settings = bare_machine("needed", "large-v3");
        let found = check(&settings);

        assert!(
            !found.issues.is_empty(),
            "a folder with nothing in it must raise complaints"
        );
        assert_eq!(
            found.issues.is_empty(),
            found.needed.is_empty(),
            "complaints and answers appear and vanish together: {:?} against {:?}",
            found.issues.iter().map(|i| &i.code).collect::<Vec<_>>(),
            found.needed
        );
        assert!(
            found.needed.contains(&"vad".to_string()),
            "speech detection is missing: {:?}",
            found.needed
        );
        assert!(
            found.needed.contains(&"model-large".to_string()),
            "the model to offer is the one the setting names, not the one this              machine would be sold: {:?}",
            found.needed
        );
    }

    /// A model put in the folder by hand belongs to no component, and the
    /// answer then has to be one this machine can actually download rather
    /// than nothing at all — which is what the reader would otherwise get.
    /// The three names above are written out by hand, the way the editor's
    /// three are. This is what stops them drifting from the catalogue that
    /// actually downloads the files: every one of them has to be a component,
    /// and every offered component's model has to be in the list.
    #[test]
    fn the_models_named_here_are_the_ones_the_catalogue_delivers() {
        for id in OFFERED_MODELS {
            assert!(
                crate::download::component_for_model(id).is_some(),
                "{id} is named here but no component writes it"
            );
        }
        for component in ["model-turbo", "model-large-q5", "model-large"] {
            let model = crate::download::model_for_component(component)
                .unwrap_or_else(|| panic!("{component} is not in the catalogue"));
            assert!(
                OFFERED_MODELS.contains(&model.as_str()),
                "the catalogue delivers {model} and this list does not know it"
            );
        }
        assert_eq!(
            crate::download::component_for_model(MODEL_FAST).as_deref(),
            Some("model-turbo")
        );
        assert_eq!(
            crate::download::component_for_model(MODEL_ACCURATE).as_deref(),
            Some("model-large")
        );
    }

    /// **A setting that cannot be honoured falls back to what is here.** The
    /// reported machine had `model` empty, `quality_choice` `fast`, and no
    /// model at all; the same machine with the fast model back on the disk must
    /// transcribe rather than go on asking for one.
    #[test]
    fn a_model_that_cannot_be_honoured_gives_way_to_one_that_is_here() {
        let mut settings = bare_machine("resolve-choice", "");
        settings.quality_choice = "fast".into();
        std::fs::write(
            std::path::Path::new(&settings.models_directory).join("ggml-large-v3-turbo-q5_0.bin"),
            b"a file with the right name",
        )
        .expect("model");

        let found = check(&settings);

        assert_eq!(
            found.model_whisper_id.as_deref(),
            Some("large-v3-turbo-q5_0")
        );
        assert!(
            !found
                .issues
                .iter()
                .any(|issue| issue.code == "tools.whisper_model_missing"),
            "nothing is missing: a model is here and it is the one that was chosen"
        );
        assert!(
            !found.needed.iter().any(|id| id.starts_with("model-")),
            "and nothing is asked for: {:?}",
            found.needed
        );
    }

    /// **The reported state of 31 August, and what the recording must record.**
    /// An uninstall keeps the archive, so the settings survived naming
    /// `large-v3` while the reinstalled copy had only the fast model on disk.
    /// The transcription ran on the fast one — correctly, it has to run — and
    /// the card over it said `Přesný`, because the wish was written down
    /// instead of the answer.
    ///
    /// This pins the value `transcription::run` now stores: the id `check`
    /// resolved, which is a model that exists, and never `settings.model`.
    #[test]
    fn the_answer_and_not_the_wish_is_what_a_recording_can_be_labelled_with() {
        let settings = bare_machine("resolve-stale-wish", "large-v3");
        std::fs::write(
            std::path::Path::new(&settings.models_directory).join("ggml-large-v3-turbo-q5_0.bin"),
            b"a file with the right name",
        )
        .expect("model");

        let found = check(&settings);

        assert_eq!(
            found.model_whisper_id.as_deref(),
            Some("large-v3-turbo-q5_0"),
            "the wish names a model that is not here, so the one that is answers"
        );
        assert_ne!(
            found.model_whisper_id.as_deref(),
            Some(settings.model.as_str()),
            "and the two differ, which is the whole case being pinned"
        );
    }

    /// The setting still wins where it can be honoured, which is the whole
    /// point of it. A machine holding both models transcribes with the chosen
    /// one and not with whichever the fallback would have reached first.
    #[test]
    fn the_setting_wins_wherever_it_can_be_honoured() {
        let mut settings = bare_machine("resolve-honoured", "large-v3-turbo-q5_0");
        settings.quality_choice = "accurate".into();
        for name in ["ggml-large-v3.bin", "ggml-large-v3-turbo-q5_0.bin"] {
            std::fs::write(
                std::path::Path::new(&settings.models_directory).join(name),
                b"a file with the right name",
            )
            .expect("model");
        }

        assert_eq!(
            check(&settings).model_whisper_id.as_deref(),
            Some("large-v3-turbo-q5_0"),
            "the setting names a model that is here, so nothing falls back"
        );
    }

    /// **The reported state, and the reason the wrong row was marked.** A
    /// machine where a model was chosen and never landed has `model` empty --
    /// it is written when a download finishes -- while `quality_choice` still
    /// holds the answer that was given. Falling through to the drivers there
    /// marked the accurate model and three gigabytes at a reader who had
    /// chosen the fast one and could see they had.
    ///
    /// Both choices are asserted in one test on purpose: the machine's own
    /// fallback agrees with one of them, and which one depends on whether the
    /// computer running this has a graphics card. Together they always tell
    /// the answer apart from the guess.
    #[test]
    fn an_unwritten_model_falls_back_to_the_choice_and_not_to_the_drivers() {
        let mut settings = bare_machine("needed-choice-fast", "");
        settings.quality_choice = "fast".into();
        assert!(
            check(&settings).needed.contains(&"model-turbo".to_string()),
            "the reader asked for the fast one"
        );

        let mut settings = bare_machine("needed-choice-accurate", "");
        settings.quality_choice = "accurate".into();
        assert!(
            check(&settings).needed.contains(&"model-large".to_string()),
            "and here for the accurate one"
        );
    }

    #[test]
    fn a_model_no_component_delivers_still_leaves_something_to_press() {
        let settings = bare_machine("needed-unknown", "small.en");
        let found = check(&settings);

        assert!(
            found
                .needed
                .iter()
                .any(|id| id == "model-large" || id == "model-turbo"),
            "one of the offered pair has to stand in: {:?}",
            found.needed
        );
    }

    /// The list is not everything this application could install; it is the
    /// answer to one warning. Put the model back and it stops being asked for.
    #[test]
    fn a_model_that_is_there_is_not_asked_for_again() {
        let settings = bare_machine("needed-have-model", "large-v3");
        std::fs::write(
            std::path::Path::new(&settings.models_directory).join("ggml-large-v3.bin"),
            b"not a model, but a file with the right name",
        )
        .expect("model");

        let found = check(&settings);

        assert!(
            !found.needed.contains(&"model-large".to_string()),
            "the model is on the disk: {:?}",
            found.needed
        );
        assert!(
            !found
                .issues
                .iter()
                .any(|issue| issue.code == "tools.whisper_model_missing"),
            "and nothing complains about it either"
        );
    }
}
