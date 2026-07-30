//! Hledani a spousteni externich nastroju: ffmpeg, whisper-cli, sherpa-onnx.
//!
//! Zamerne bez vazani knihoven - kazdy nastroj je samostatny proces. Diky tomu
//! jde kterykoliv z nich vymenit nebo prelozit znovu bez zasahu do aplikace.
//!
//! Prenosny rezim: kdyz vedle programu lezi slozka `bin`, aplikace se prepne
//! do rezimu "vsechno na flasce" - relativni cesty, databaze vedle programu,
//! zadny zapis do systemu.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Na Windows by kazdy spusteny proces jinak blikl cernym oknem konzole.
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

// ---------------------------------------------------------------- prenosnost

/// Slozka, ve ktere lezi spustitelny soubor aplikace.
pub fn app_directory() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Portable mode is recognised by a `bin` folder or a marker file sitting
/// next to the executable.
pub fn is_portable() -> bool {
    let s = app_directory();
    s.join("prenosna.txt").is_file() || s.join("bin").is_dir()
}

/// Kam se stahuji nastroje a modely.
///
/// V prenosnem rezimu vedle programu. Jinak do profilu uzivatele - nikoliv do
/// Program Files, protoze tam by aplikace bez prav spravce nic nezapsala.
pub fn tools_root() -> PathBuf {
    if is_portable() {
        return app_directory();
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| app_directory())
        .join("Whisp")
}

/// Kam patri soubor, ktery katalog popisuje jako "bin/neco" nebo "models/neco".
///
/// Musi to jit pres nastaveni, ne pres zakladni slozku napevno. Jinak by se
/// stahovalo jinam, nez kam se pak aplikace diva - a uzivatel by po uspesnem
/// stazeni videl hlasku, ze soubor chybi.
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

/// Relativni cesty se vztahuji k zakladni slozce - diky tomu je jedno,
/// jake pismeno dostane flaska na cizim pocitaci.
pub fn expand(path: &str) -> PathBuf {
    let p = Path::new(path);
    if path.is_empty() || p.is_absolute() {
        p.to_path_buf()
    } else {
        tools_root().join(p)
    }
}

/// Kde ma byt databaze. V prenosnem rezimu vedle programu, jinak v profilu.
pub fn data_directory(fallback: PathBuf) -> PathBuf {
    if is_portable() {
        app_directory().join("data")
    } else {
        fallback
    }
}

/// Nastavi WebView2 na verzi prilozenou na flasce, pokud tam je.
/// Bez toho by aplikace na cizim pocitaci bez WebView2 vubec neotevrela okno.
pub fn set_webview2() -> Option<PathBuf> {
    let root = app_directory().join("webview2");
    if !root.is_dir() {
        return None;
    }
    // Rozbaleny CAB ma uvnitr jeste slozku s cislem verze
    let s_programem = |d: &Path| d.join("msedgewebview2.exe").is_file();

    let target = if s_programem(&root) {
        Some(root.clone())
    } else {
        std::fs::read_dir(&root).ok().and_then(|it| {
            it.filter_map(|e| e.ok())
                .map(|e| e.path())
                .find(|p| p.is_dir() && s_programem(p))
        })
    }?;

    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &target);
    Some(target)
}

// ---------------------------------------------------------------- hledani

/// Najde spustitelny soubor: nejdriv v zadanych slozkach, pak v systemove PATH.
pub fn find_program_in(directories: &[PathBuf], title: &str) -> Option<PathBuf> {
    for s in directories {
        for k in [format!("{title}.exe"), title.to_string()] {
            let p = s.join(&k);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let promenna = std::env::var_os("PATH")?;
    for adr in std::env::split_paths(&promenna) {
        for k in [format!("{title}.exe"), title.to_string()] {
            let p = adr.join(&k);
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

// ---------------------------------------------------------------- vypocet

/// Ktere varianty whisper.cpp jsou na disku k dispozici.
/// Podslozky bin\cuda, bin\vulkan, bin\cpu; pripadne primo bin\.
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

/// Rozhodne se podle ovladacu, ktere jsou v systemu nainstalovane.
/// nvcuda.dll = ovladac NVIDIA, vulkan-1.dll = Vulkan runtime.
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

/// Vybere variantu vypoctu. "auto" se rozhodne podle toho, co je na stroji.
pub fn choose_compute(bin: &Path, choice: &str) -> String {
    let k_dispozici = available_compute_backends(bin);
    if k_dispozici.is_empty() {
        return "vychozi".into();
    }
    if choice != "auto" && k_dispozici.iter().any(|x| x == choice) {
        return choice.to_string();
    }
    if k_dispozici.iter().any(|x| x == "cuda") && has_nvidia() {
        return "cuda".into();
    }
    if k_dispozici.iter().any(|x| x == "vulkan") && has_vulkan() {
        return "vulkan".into();
    }
    if k_dispozici.iter().any(|x| x == "cpu") {
        return "cpu".into();
    }
    k_dispozici[0].clone()
}

pub fn compute_directory(bin: &Path, compute: &str) -> PathBuf {
    if compute == "vychozi" {
        bin.to_path_buf()
    } else {
        bin.join(compute)
    }
}

// ---------------------------------------------------------------- stav

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ToolCheck {
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub whisper_cli: Option<String>,
    pub model_whisper: Option<String>,
    pub model_vad: Option<String>,
    pub sherpa_diarization: Option<String>,
    pub segmentation_model: Option<String>,
    pub embedding_model: Option<String>,

    pub portable: bool,
    pub app_directory: String,
    pub webview2_bundled: bool,
    /// Ktera varianta se pouzije pri pristim prepisu
    pub compute: String,
    pub available_compute_backends: Vec<String>,
    pub nvidia_driver: bool,
    pub vulkan_driver: bool,
    /// Modely nalezene ve slozce modelu (bez pripony ggml-)
    pub found_models: Vec<String>,

    pub issues: Vec<String>,
    pub issues_diarization: Vec<String>,
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
    let sherpa = find_program_in(&find_v, "sherpa-onnx-offline-speaker-diarization");

    k.ffmpeg = na_text(&ffmpeg);
    k.ffprobe = na_text(&ffprobe);
    k.whisper_cli = na_text(&whisper);
    k.sherpa_diarization = na_text(&sherpa);

    k.model_whisper = na_text(&find_file(&models, &[&format!("ggml-{}.bin", n.model)]));
    k.model_vad = na_text(&find_file(
        &models,
        &["ggml-silero-v6.2.0.bin", "ggml-silero-v5.1.2.bin"],
    ));
    k.segmentation_model = na_text(&find_file(
        &models,
        &[
            "sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
            "segmentace.onnx",
        ],
    ));
    // Poradi je zamerne: CAM++ z VoxCelebu zvlada cestinu, cinsky model
    // z 3D-Speakeru ne. Ten druhy tu zustava jen jako zaloha pro instalace,
    // kde uz je stazeny a novy jeste nedorazil.
    k.embedding_model = na_text(&find_file(
        &models,
        &[
            "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
            "wespeaker_en_voxceleb_resnet34_LM.onnx",
            "nemo_en_titanet_small.onnx",
            "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            "embedding.onnx",
        ],
    ));
    k.found_models = list_models(&models);

    // For missing programs we also print the folder that was searched.
    // Without it there is no telling "not downloaded" from "downloaded
    // elsewhere" — and the latter is the common case, because the programs
    // folder can be changed in settings.
    let position = bin.to_string_lossy().to_string();

    if k.ffmpeg.is_none() {
        k.issues
            .push(format!("Ve složce programů ({position}) chybí ffmpeg."));
    }
    if k.ffprobe.is_none() {
        k.issues.push(format!(
            "Ve složce programů ({position}) chybí ffprobe, který chodí s ffmpegem."
        ));
    }
    if k.whisper_cli.is_none() {
        k.issues.push(format!(
            "Ve složce programů ({position}) chybí whisper-cli.exe."
        ));
    }
    if k.model_whisper.is_none() {
        k.issues.push(format!(
            "Chybí model ggml-{}.bin ve složce modelů.",
            n.model
        ));
    }
    if k.model_vad.is_none() {
        k.issues
            .push("Chybí Silero VAD model. Bez něj Whisper na tichu halucinuje.".into());
    }

    if k.sherpa_diarization.is_none() {
        k.issues_diarization.push(format!(
            "Ve složce programů ({position}) není sherpa-onnx-offline-speaker-diarization.exe. \
                 Doplň ho v Modulech, nebo v nastavení přepni složku programů tam, kde už je."
        ));
    }
    if k.segmentation_model.is_none() {
        k.issues_diarization
            .push("Chybí model pro rozpoznání střídání mluvčích.".into());
    }
    if k.embedding_model.is_none() {
        k.issues_diarization
            .push("Chybí model pro rozpoznání hlasů.".into());
    }

    k
}

/// Vypise, jake prepisovaci modely na disku skutecne jsou - aby uzivatel
/// v nabidce nevidel volby, ktere si s sebou nevzal.
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

/// Whisper i sherpa-onnx pracuji vyhradne s 16 kHz mono PCM.
pub fn convert_to_wav(ffmpeg: &Path, input: &Path, output: &Path) -> Result<()> {
    let status = command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(input)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()?;
    if !status.status.success() {
        return Err(anyhow!(
            "ffmpeg selhal: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        ));
    }
    Ok(())
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

/// Vyrez z nahravky - pouziva se pri zkousce vykonu.
pub fn clip(ffmpeg: &Path, input: &Path, output: &Path, seconds: f64) -> Result<()> {
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
        return Err(anyhow!("ffmpeg nezvládl vyříznout ukázku"));
    }
    Ok(())
}
