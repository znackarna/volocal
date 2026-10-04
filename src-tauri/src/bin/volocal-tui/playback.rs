//! A transcript's sound, played where the terminal is the computer's own.
//!
//! **Played from PCM, never from the original.** A seek inside a long VBR MP3
//! lands where its 100-entry table says, which was 8 s from the word in the
//! reproduction `CLAUDE.md` describes. So ffmpeg turns the recording into a
//! 16-bit mono WAV once, and a seek is then a multiplication: the sample a
//! time falls on is the sample played. The stored word times are not touched.
//!
//! **Cached beside the archive**, in the window's `playback-cache`, named the
//! way the window names its own copies: the recording's id, then a
//! fingerprint of the source's path, size and modification time. A replaced
//! or moved source gets a new name, so a stale copy is never played; the
//! window's tidying of `<id>-*` when a recording is deleted or moved takes
//! these with its own. Only the three newest are kept, since an hour is
//! about 345 MB.
//!
//! **Not over SSH.** The sound would come out of the remote computer, so
//! playback is not offered there at all.

use crate::words::Words;
use rodio::{ChannelCount, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate, Source};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::num::NonZero;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Duration;
use volocal_lib::db::{Recording, Settings};
use volocal_lib::tools;

/// How far `,` and `.` move.
pub const SKIP: f64 = 5.0;

/// The rate and layout of the cached copy: enough for speech and music both,
/// and one channel, because what is checked against a transcript is words.
const RATE: u32 = 48_000;

/// How many recordings keep their copy in the cache.
const KEEP: usize = 3;

/// What the preparing thread hands back.
pub struct Prepared {
    pub id: String,
    pub result: Result<Pcm, String>,
}

/// Whether the sound would come out of this computer: not when the terminal is
/// at the other end of SSH, which says so in one of these three.
pub fn here(var: impl Fn(&str) -> Option<String>) -> bool {
    ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]
        .iter()
        .all(|name| var(name).is_none_or(|value| value.is_empty()))
}

/// A WAV of 16-bit samples, as ffmpeg wrote it: where its samples begin and
/// how many frames follow.
#[derive(Clone, Debug)]
pub struct Pcm {
    pub path: PathBuf,
    pub rate: u32,
    pub channels: u16,
    pub data: u64,
    pub frames: u64,
}

impl Pcm {
    /// Reads the header: the `fmt ` chunk for the layout, the `data` chunk for
    /// where the samples are. Anything but 16-bit PCM is refused.
    pub fn open(path: &Path) -> std::io::Result<Pcm> {
        let invalid =
            |what: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, what.to_string());
        let mut file = BufReader::new(File::open(path)?);
        let mut riff = [0u8; 12];
        file.read_exact(&mut riff)?;
        if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
            return Err(invalid("not a WAV"));
        }
        let length = path.metadata()?.len();
        let mut at = 12u64;
        let mut layout = None;
        loop {
            let mut head = [0u8; 8];
            file.read_exact(&mut head)?;
            let size = u64::from(u32::from_le_bytes([head[4], head[5], head[6], head[7]]));
            at += 8;
            match &head[0..4] {
                b"fmt " => {
                    let mut fmt = [0u8; 16];
                    file.read_exact(&mut fmt)?;
                    let format = u16::from_le_bytes([fmt[0], fmt[1]]);
                    let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
                    let rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
                    let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
                    // 1 is PCM; 0xFFFE is the extensible header, which ffmpeg
                    // writes for more than two channels and is still PCM here.
                    if !matches!(format, 1 | 0xfffe) || bits != 16 || channels == 0 || rate == 0 {
                        return Err(invalid("not 16-bit PCM"));
                    }
                    layout = Some((rate, channels));
                    file.seek(SeekFrom::Current(size as i64 - 16 + (size % 2) as i64))?;
                }
                b"data" => {
                    let (rate, channels) = layout.ok_or_else(|| invalid("data before fmt"))?;
                    // A header that says more than the file holds is believed
                    // only as far as the file goes.
                    let bytes = size.min(length.saturating_sub(at));
                    return Ok(Pcm {
                        path: path.to_path_buf(),
                        rate,
                        channels,
                        data: at,
                        frames: bytes / (2 * u64::from(channels)),
                    });
                }
                _ => {
                    file.seek(SeekFrom::Current((size + size % 2) as i64))?;
                }
            }
            at += size + size % 2;
        }
    }

    pub fn seconds(&self) -> f64 {
        self.frames as f64 / f64::from(self.rate)
    }

    /// The frame a time falls on, inside the recording.
    pub fn frame(&self, seconds: f64) -> u64 {
        ((seconds.max(0.0) * f64::from(self.rate)).round() as u64).min(self.frames)
    }
}

/// The samples of a `Pcm` from one frame on, counting in `heard` the frame
/// the sound card has taken last.
struct Samples {
    file: BufReader<File>,
    channels: ChannelCount,
    rate: SampleRate,
    left: u64,
    in_frame: u16,
    heard: Arc<AtomicU64>,
}

impl Samples {
    fn open(pcm: &Pcm, from: u64, heard: Arc<AtomicU64>) -> std::io::Result<Samples> {
        let mut file = BufReader::with_capacity(1 << 16, File::open(&pcm.path)?);
        file.seek(SeekFrom::Start(
            pcm.data + from * 2 * u64::from(pcm.channels),
        ))?;
        heard.store(from, Ordering::Relaxed);
        Ok(Samples {
            file,
            channels: NonZero::new(pcm.channels).unwrap_or(NonZero::<u16>::MIN),
            rate: NonZero::new(pcm.rate).unwrap_or(NonZero::<u32>::MIN),
            left: (pcm.frames - from.min(pcm.frames)) * u64::from(pcm.channels),
            in_frame: 0,
            heard,
        })
    }
}

impl Iterator for Samples {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.left == 0 {
            return None;
        }
        let mut sample = [0u8; 2];
        self.file.read_exact(&mut sample).ok()?;
        self.left -= 1;
        self.in_frame += 1;
        if self.in_frame == self.channels.get() {
            self.in_frame = 0;
            self.heard.fetch_add(1, Ordering::Relaxed);
        }
        Some(f32::from(i16::from_le_bytes(sample)) / 32768.0)
    }
}

impl Source for Samples {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> ChannelCount {
        self.channels
    }
    fn sample_rate(&self) -> SampleRate {
        self.rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// Where the sound goes. The sound card in the program; something that only
/// remembers what it was told in the tests.
pub trait Speaker {
    fn play(&mut self, pcm: &Pcm, from: u64, heard: Arc<AtomicU64>) -> Result<(), String>;
    fn pause(&mut self);
    fn resume(&mut self);
}

/// The default output device, opened at the first play.
struct Card {
    device: MixerDeviceSink,
    player: Option<Player>,
}

/// A stream error on the audio thread would otherwise be printed over the
/// screen; the position simply stops moving instead.
fn quietly(_: rodio::cpal::StreamError) {}

impl Card {
    fn open(w: &Words) -> Result<Card, String> {
        let mut device = DeviceSinkBuilder::from_default_device()
            .and_then(|builder| builder.with_error_callback(quietly).open_stream())
            .map_err(|_| w.no_sound_device.to_string())?;
        // Its farewell would also go to the terminal.
        device.log_on_drop(false);
        Ok(Card {
            device,
            player: None,
        })
    }
}

impl Speaker for Card {
    fn play(&mut self, pcm: &Pcm, from: u64, heard: Arc<AtomicU64>) -> Result<(), String> {
        let samples = Samples::open(pcm, from, heard).map_err(|e| e.to_string())?;
        // A new player for every start: dropping the old one stops it at once,
        // where emptying it would wait for the audio thread.
        let player = Player::connect_new(self.device.mixer());
        player.append(samples);
        player.play();
        self.player = Some(player);
        Ok(())
    }
    fn pause(&mut self) {
        if let Some(player) = &self.player {
            player.pause();
        }
    }
    fn resume(&mut self) {
        if let Some(player) = &self.player {
            player.play();
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Stopped,
    Playing,
    Paused,
}

type Open = fn(&Words) -> Result<Box<dyn Speaker>, String>;

fn open_card(w: &Words) -> Result<Box<dyn Speaker>, String> {
    Card::open(w).map(|card| Box::new(card) as Box<dyn Speaker>)
}

/// The sound of the transcript that is open: preparing it, playing, pausing,
/// skipping, and where it is.
pub struct Playback {
    id: String,
    source: PathBuf,
    pcm: Option<Pcm>,
    preparing: bool,
    /// Where to start once the copy is ready; the latest request wins.
    wanted: Option<f64>,
    speaker: Option<Box<dyn Speaker>>,
    open: Open,
    heard: Arc<AtomicU64>,
    state: State,
    /// A skip while paused: the resume starts there.
    moved: bool,
    /// Why it cannot play. Once set, playback is no longer offered.
    failed: Option<String>,
}

impl Playback {
    pub fn new(recording: &Recording) -> Playback {
        Playback::with_speaker(recording, open_card)
    }

    pub fn with_speaker(recording: &Recording, open: Open) -> Playback {
        Playback {
            id: recording.id.clone(),
            source: PathBuf::from(&recording.path),
            pcm: None,
            preparing: false,
            wanted: None,
            speaker: None,
            open,
            heard: Arc::new(AtomicU64::new(0)),
            state: State::Stopped,
            moved: false,
            failed: None,
        }
    }

    /// Whether its keys are shown: not after it has said it cannot play.
    pub fn offered(&self) -> bool {
        self.failed.is_none()
    }

    pub fn preparing(&self) -> bool {
        self.preparing
    }

    pub fn state(&self) -> State {
        self.state
    }

    /// Where the sound is, while it plays or is paused.
    pub fn position(&self) -> Option<f64> {
        let pcm = self.pcm.as_ref()?;
        (self.state != State::Stopped)
            .then(|| self.heard.load(Ordering::Relaxed) as f64 / f64::from(pcm.rate))
    }

    /// The space bar, over a block from `block.0` to `block.1`: pauses what
    /// plays, resumes what is paused in this block, and otherwise starts at
    /// the block. Returns a sentence when it cannot.
    pub fn toggle(&mut self, block: (f64, f64), job: &Job) -> Option<String> {
        if !self.offered() {
            return None;
        }
        match self.state {
            State::Playing => {
                if let Some(speaker) = &mut self.speaker {
                    speaker.pause();
                }
                self.state = State::Paused;
                None
            }
            State::Paused
                if self
                    .position()
                    .is_some_and(|at| at >= block.0 - 0.01 && at < block.1) =>
            {
                if self.moved {
                    let at = self.position().unwrap_or(block.0);
                    return self.start(at, job);
                }
                if let Some(speaker) = &mut self.speaker {
                    speaker.resume();
                }
                self.state = State::Playing;
                None
            }
            _ => self.start(block.0, job),
        }
    }

    /// `,` and `.`: five seconds either way, kept inside the recording.
    pub fn skip(&mut self, by: f64, job: &Job) -> Option<String> {
        let (Some(pcm), Some(at)) = (self.pcm.as_ref(), self.position()) else {
            return None;
        };
        let to = (at + by).clamp(0.0, pcm.seconds());
        match self.state {
            State::Playing => self.start(to, job),
            State::Paused => {
                self.heard.store(pcm.frame(to), Ordering::Relaxed);
                self.moved = true;
                None
            }
            State::Stopped => None,
        }
    }

    fn start(&mut self, at: f64, job: &Job) -> Option<String> {
        let Some(pcm) = &self.pcm else {
            self.wanted = Some(at);
            if !self.preparing {
                self.preparing = true;
                prepare(job, self.id.clone(), self.source.clone());
            }
            return None;
        };
        if self.speaker.is_none() {
            match (self.open)(job.words) {
                Ok(speaker) => self.speaker = Some(speaker),
                Err(text) => return self.fail(text),
            }
        }
        let from = pcm.frame(at);
        let pcm = pcm.clone();
        let heard = self.heard.clone();
        if let Some(speaker) = &mut self.speaker {
            if let Err(e) = speaker.play(&pcm, from, heard) {
                return self.fail(format!("{} {e}", job.words.sound_failed));
            }
        }
        self.state = State::Playing;
        self.moved = false;
        None
    }

    fn fail(&mut self, text: String) -> Option<String> {
        self.state = State::Stopped;
        self.speaker = None;
        self.failed = Some(text.clone());
        Some(text)
    }

    /// The copy is ready, or could not be made. Plays from where it was asked
    /// to, if that was this recording.
    pub fn prepared(&mut self, done: Prepared, job: &Job) -> Option<String> {
        if done.id != self.id {
            return None;
        }
        self.preparing = false;
        match done.result {
            Ok(pcm) => {
                self.pcm = Some(pcm);
                let at = self.wanted.take()?;
                self.start(at, job)
            }
            Err(text) => self.fail(text),
        }
    }

    /// The end of the recording stops it.
    pub fn tick(&mut self) {
        if let Some(pcm) = &self.pcm {
            if self.state == State::Playing && self.heard.load(Ordering::Relaxed) >= pcm.frames {
                self.state = State::Stopped;
            }
        }
    }
}

/// What preparing needs from the screen: where to say it is done, the
/// archive and settings it reads, and the words to fail in.
pub struct Job {
    pub tx: Sender<crate::app::Msg>,
    pub archive: PathBuf,
    pub settings: Settings,
    pub words: &'static Words,
}

/// Makes the copy on a thread of its own, or finds it made already.
fn prepare(job: &Job, id: String, source: PathBuf) {
    let tx = job.tx.clone();
    let (archive, settings, w) = (job.archive.clone(), job.settings.clone(), job.words);
    std::thread::spawn(move || {
        let result = copy_for_playback(&archive, &settings, &id, &source, w);
        let _ = tx.send(crate::app::Msg::Playback(Prepared { id, result }));
    });
}

fn safe_key(id: &str) -> String {
    let key: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .collect();
    if key.is_empty() {
        "recording".into()
    } else {
        key
    }
}

/// `<id>-<fingerprint>.wav`: the fingerprint of the source's path, size and
/// modification time, computed as the window computes its own.
pub fn cache_name(id: &str, source: &Path) -> std::io::Result<String> {
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
    Ok(format!("{}-{:016x}.wav", safe_key(id), hasher.finish()))
}

fn copy_for_playback(
    archive: &Path,
    settings: &Settings,
    id: &str,
    source: &Path,
    w: &Words,
) -> Result<Pcm, String> {
    if !source.is_file() {
        return Err(w.source_missing.to_string());
    }
    let failed = |reason: &dyn std::fmt::Display| {
        format!("{} {reason}", w.sound_failed)
            .trim_end()
            .to_string()
    };
    let directory = tools::playback_cache_directory(archive);
    let name = cache_name(id, source).map_err(|e| failed(&e))?;
    let destination = directory.join(&name);
    if let Ok(pcm) = Pcm::open(&destination) {
        // Played again: it counts as new when the cache is tidied.
        let _ = File::options()
            .write(true)
            .open(&destination)
            .and_then(|file| file.set_modified(std::time::SystemTime::now()));
        return Ok(pcm);
    }
    let ffmpeg = tools::check(settings)
        .ffmpeg
        .ok_or_else(|| w.sound_no_ffmpeg.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| failed(&e))?;
    let temporary = directory.join(format!(
        ".{}-{}.part.wav",
        safe_key(id),
        uuid::Uuid::new_v4()
    ));
    let output = tools::command(&ffmpeg)
        // ffmpeg reads keys from its input; this terminal's keys are ours.
        .stdin(std::process::Stdio::null())
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(source)
        .args(["-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar"])
        .arg(RATE.to_string())
        .args(["-c:a", "pcm_s16le", "-f", "wav"])
        .arg(&temporary)
        .output();
    match output {
        Ok(output) if output.status.success() => {}
        Ok(output) => {
            let _ = std::fs::remove_file(&temporary);
            let said = String::from_utf8_lossy(&output.stderr);
            return Err(failed(&said.lines().next().unwrap_or_default().trim()));
        }
        Err(e) => return Err(failed(&e)),
    }
    // Another program may have made the same copy meanwhile; either is right.
    if destination.is_file() {
        let _ = std::fs::remove_file(&temporary);
    } else {
        std::fs::rename(&temporary, &destination).map_err(|e| failed(&e))?;
    }
    tidy(&directory, id, &name);
    Pcm::open(&destination).map_err(|e| failed(&e))
}

/// This recording's older copies go, and of the others only the newest few
/// stay. Only `.wav`: the window's own copies are its business.
fn tidy(directory: &Path, id: &str, keep: &str) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let prefix = format!("{}-", safe_key(id));
    let mut others = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".wav") || name.starts_with('.') || name == keep {
            continue;
        }
        if name.starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        } else if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
            others.push((modified, entry.path()));
        }
    }
    others.sort_by_key(|other| std::cmp::Reverse(other.0));
    for (_, path) in others.into_iter().skip(KEEP - 1) {
        let _ = std::fs::remove_file(path);
    }
}

/// A playback that is ready and plays nowhere, for the screen's tests.
#[cfg(test)]
pub fn for_tests(recording: &Recording, pcm: Pcm) -> Playback {
    let mut playback = Playback::with_speaker(recording, tests::ears);
    playback.pcm = Some(pcm);
    playback
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn playback_is_not_offered_over_ssh() {
        assert!(here(|_| None));
        assert!(here(|_| Some(String::new())));
        for name in ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"] {
            assert!(
                !here(|n| (n == name).then(|| "10.0.0.2 22".to_string())),
                "{name}"
            );
        }
    }

    pub(crate) fn wav(path: &Path, rate: u32, channels: u16, frames: u32) {
        let bytes = frames * u32::from(channels) * 2;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + 26 + bytes).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * u32::from(channels) * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        // ffmpeg writes a LIST chunk before the samples.
        out.extend_from_slice(b"LIST");
        out.extend_from_slice(&18u32.to_le_bytes());
        out.extend_from_slice(&[0u8; 18]);
        out.extend_from_slice(b"data");
        out.extend_from_slice(&bytes.to_le_bytes());
        for i in 0..frames * u32::from(channels) {
            out.extend_from_slice(&(i as i16).to_le_bytes());
        }
        std::fs::write(path, out).unwrap();
    }

    fn folder(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("volocal-sound-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_time_is_the_sample_it_falls_on() {
        let dir = folder("pcm");
        let path = dir.join("a.wav");
        wav(&path, 1000, 1, 5000);
        let pcm = Pcm::open(&path).unwrap();
        assert_eq!((pcm.rate, pcm.channels, pcm.frames), (1000, 1, 5000));
        assert_eq!(pcm.data, 12 + 24 + 26 + 8);
        assert_eq!(pcm.frame(2.3474), 2347);
        assert_eq!(pcm.frame(99.0), 5000);
        // Read from that frame, the samples are the ones written there.
        let heard = Arc::new(AtomicU64::new(0));
        let mut samples = Samples::open(&pcm, 2347, heard.clone()).unwrap();
        assert_eq!(samples.next(), Some(2347.0 / 32768.0));
        assert_eq!(heard.load(Ordering::Relaxed), 2348);
        assert_eq!(samples.count(), 5000 - 2348);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_changed_source_gets_a_new_name() {
        let dir = folder("name");
        let source = dir.join("Porada.mp3");
        std::fs::write(&source, b"one").unwrap();
        let first = cache_name("3f9c2a17-1", &source).unwrap();
        assert!(first.starts_with("3f9c2a17-1-") && first.ends_with(".wav"));
        std::fs::write(&source, b"longer").unwrap();
        assert_ne!(cache_name("3f9c2a17-1", &source).unwrap(), first);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tidying_keeps_the_window_copies_and_the_newest_few() {
        let dir = folder("tidy");
        for name in [
            "a-1.wav",
            "a-2.m4a",
            "b-1.wav",
            "c-1.wav",
            "d-1.wav",
            ".a-x.part.wav",
        ] {
            std::fs::write(dir.join(name), b"x").unwrap();
            std::thread::sleep(Duration::from_millis(20));
        }
        std::fs::write(dir.join("a-3.wav"), b"x").unwrap();
        tidy(&dir, "a", "a-3.wav");
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [".a-x.part.wav", "a-2.m4a", "a-3.wav", "c-1.wav", "d-1.wav"]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    std::thread_local! {
        /// What a test hears: every call, in order. Each test has its own
        /// thread, and the speaker is called on it.
        static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    }

    fn note(call: impl Into<String>) {
        CALLS.with(|c| c.borrow_mut().push(call.into()));
    }

    struct Ears;
    impl Speaker for Ears {
        fn play(&mut self, _: &Pcm, from: u64, heard: Arc<AtomicU64>) -> Result<(), String> {
            heard.store(from, Ordering::Relaxed);
            note(format!("play {from}"));
            Ok(())
        }
        fn pause(&mut self) {
            note("pause");
        }
        fn resume(&mut self) {
            note("resume");
        }
    }

    pub(crate) fn ears(_: &Words) -> Result<Box<dyn Speaker>, String> {
        Ok(Box::new(Ears))
    }

    fn deaf(w: &Words) -> Result<Box<dyn Speaker>, String> {
        Err(w.no_sound_device.to_string())
    }

    fn job() -> (Job, std::sync::mpsc::Receiver<crate::app::Msg>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let job = Job {
            tx,
            archive: std::env::temp_dir()
                .join("volocal-sound-unused")
                .join("volocal.db"),
            settings: Settings::default(),
            words: crate::words::of(crate::words::Lang::Cs),
        };
        (job, rx)
    }

    fn recording() -> Recording {
        serde_json::from_value(serde_json::json!({
            "id": "r1", "path": "", "title": "Porada", "duration": 10.0, "created_at": "",
            "status": "done", "model": "", "language": "cs", "language_choice": "",
            "second_language_choice": "", "second_language_by_reader": false,
            "error": null, "segment_count": 0,
        }))
        .unwrap()
    }

    fn ready(open: Open) -> (Playback, Job) {
        let dir = folder("ready");
        let path = dir.join("r1.wav");
        wav(&path, 1000, 1, 10_000);
        let mut playback = Playback::with_speaker(&recording(), open);
        let (job, _rx) = job();
        playback.pcm = Some(Pcm::open(&path).unwrap());
        (playback, job)
    }

    #[test]
    fn space_plays_pauses_and_resumes_in_the_block() {
        let (mut playback, job) = ready(ears);
        assert_eq!(playback.toggle((2.0, 4.0), &job), None);
        assert_eq!(playback.state(), State::Playing);
        assert_eq!(playback.position(), Some(2.0));
        playback.toggle((2.0, 4.0), &job);
        assert_eq!(playback.state(), State::Paused);
        playback.toggle((2.0, 4.0), &job);
        assert_eq!(playback.state(), State::Playing);
        // Paused, then the cursor moved on: the next space starts there.
        playback.toggle((2.0, 4.0), &job);
        playback.toggle((6.0, 8.0), &job);
        assert_eq!(playback.position(), Some(6.0));
        let calls = CALLS.with(|c| c.borrow().clone());
        assert_eq!(
            calls,
            ["play 2000", "pause", "resume", "pause", "play 6000"]
        );
    }

    #[test]
    fn a_skip_stays_inside_the_recording() {
        let (mut playback, job) = ready(ears);
        playback.toggle((1.0, 2.0), &job);
        playback.skip(-SKIP, &job);
        assert_eq!(playback.position(), Some(0.0));
        playback.skip(SKIP, &job);
        playback.skip(SKIP, &job);
        playback.skip(SKIP, &job);
        assert_eq!(playback.position(), Some(10.0));
        playback.tick();
        assert_eq!(playback.state(), State::Stopped, "the end stops it");
        // Paused, a skip moves where the resume starts.
        playback.toggle((3.0, 6.0), &job);
        playback.toggle((3.0, 6.0), &job);
        playback.skip(SKIP, &job);
        assert_eq!(playback.position(), Some(8.0));
        assert_eq!(playback.state(), State::Paused);
    }

    #[test]
    fn no_sound_device_is_said_once_and_playback_is_no_longer_offered() {
        let (mut playback, job) = ready(deaf);
        let said = playback.toggle((0.0, 1.0), &job);
        assert_eq!(said.as_deref(), Some(job.words.no_sound_device));
        assert!(!playback.offered());
        assert_eq!(playback.toggle((0.0, 1.0), &job), None);
        assert_eq!(playback.state(), State::Stopped);
    }

    #[test]
    fn a_failed_copy_is_said_and_the_latest_request_waits_for_a_good_one() {
        let mut playback = Playback::with_speaker(&recording(), ears);
        let (job, _rx) = job();
        // The source is not there: the thread says so.
        playback.toggle((3.0, 4.0), &job);
        assert!(playback.preparing());
        let said = playback.prepared(
            Prepared {
                id: "r1".into(),
                result: Err(job.words.source_missing.into()),
            },
            &job,
        );
        assert_eq!(said.as_deref(), Some(job.words.source_missing));
        assert!(!playback.offered());

        let (mut playback, job) = ready(ears);
        let pcm = playback.pcm.take();
        playback.toggle((3.0, 4.0), &job);
        playback.toggle((5.0, 6.0), &job);
        // Another recording's copy is not this one's.
        let other = Prepared {
            id: "r2".into(),
            result: Err("x".into()),
        };
        assert_eq!(playback.prepared(other, &job), None);
        assert!(playback.preparing());
        playback.prepared(
            Prepared {
                id: "r1".into(),
                result: Ok(pcm.unwrap()),
            },
            &job,
        );
        assert_eq!(playback.position(), Some(5.0));
        assert_eq!(playback.state(), State::Playing);
    }
}
