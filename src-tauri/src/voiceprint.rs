//! Turning a piece of speech into the numbers a voice model expects.
//!
//! This is the first half of recognising who is speaking without spawning
//! `sherpa-onnx.exe`. The second half is CAM++ itself; this file only prepares
//! its input, and it is deliberately dependency-free — a mel filterbank and a
//! 512-point transform are less code than the crate that would provide them.
//!
//! Every constant here was measured rather than chosen, against the real model
//! and a real recording; the numbers are in `docs/history/2026-08-07.md` under *The numbers that
//! settle the design*. Two of them are load-bearing:
//!
//! * **Cepstral mean normalisation is not optional.** Without it the same
//!   speaker scores higher (0.506 against 0.386) and so does a *different* one
//!   (0.401 against 0.080), so the gap that decides anything collapses from
//!   0.306 to 0.105. It is what removes the microphone and the room, and
//!   dropping it looks like an improvement right up to the point where nothing
//!   can be told apart.
//! * **The window wants to be about two seconds.** One second reads 80 %
//!   correct, one and a half to three read 86 %, and twelve read 79 % — a long
//!   window collects more than one speaker. Two seconds is also, conveniently,
//!   about the size of a transcript block.

// Nothing calls this yet: the model that consumes these features arrives in the
// next step, and the tests below are what keeps this half honest until it does.
// The exception goes when the embedder lands; if it is still here after that,
// something was built and then abandoned.
#![allow(dead_code)]

/// What the model was trained at, and what ffmpeg already gives us.
pub const SAMPLE_RATE: u32 = 16_000;

/// 25 ms at 16 kHz.
const FRAME: usize = 400;
/// 10 ms.
const SHIFT: usize = 160;
const FFT: usize = 512;
const BINS: usize = FFT / 2 + 1;
/// The model's own input width: `x` is `[batch, frames, 80]`.
pub const BANDS: usize = 80;
const LOW_HZ: f64 = 20.0;
const HIGH_HZ: f64 = 8000.0;
/// f32's epsilon, which is what Kaldi floors the log at.
const LOG_FLOOR: f64 = 1.192_092_9e-7;
/// Kaldi works in the integer range, and the model was trained on features
/// produced that way. After CMN it makes no difference — a constant factor on
/// the waveform is a constant offset in the log, which the mean subtraction
/// removes — but it costs nothing to match, and it keeps the values comparable
/// with anything computed the ordinary way.
const KALDI_SCALE: f64 = 32768.0;

/// Log-mel energies, row-major: `frames` rows of [`BANDS`] each.
pub struct Features {
    pub data: Vec<f32>,
    pub frames: usize,
}

/// Povey window: a Hann raised to 0.85. Kaldi's default, and the model was
/// trained through it.
fn window() -> [f64; FRAME] {
    let mut w = [0.0; FRAME];
    for (i, v) in w.iter_mut().enumerate() {
        let hann = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / (FRAME - 1) as f64).cos();
        *v = hann.powf(0.85);
    }
    w
}

fn to_mel(hz: f64) -> f64 {
    1127.0 * (1.0 + hz / 700.0).ln()
}

/// Triangles evenly spaced on the mel scale, each one climbing from its left
/// neighbour's centre to its own and back down to its right neighbour's.
fn mel_banks() -> Vec<f64> {
    let mut banks = vec![0.0; BANDS * BINS];
    let bin_hz = SAMPLE_RATE as f64 / FFT as f64;
    let (low, high) = (to_mel(LOW_HZ), to_mel(HIGH_HZ));
    let step = (high - low) / (BANDS + 1) as f64;
    for b in 0..BANDS {
        let (left, centre, right) = (
            low + b as f64 * step,
            low + (b + 1) as f64 * step,
            low + (b + 2) as f64 * step,
        );
        for k in 0..BINS {
            let mel = to_mel(bin_hz * k as f64);
            if mel > left && mel < right {
                banks[b * BINS + k] = if mel <= centre {
                    (mel - left) / (centre - left)
                } else {
                    (right - mel) / (right - centre)
                };
            }
        }
    }
    banks
}

/// In-place radix-2, decimation in time. 512 points, so the recursion is a
/// clean power of two and there is nothing to pad.
fn fft(re: &mut [f64; FFT], im: &mut [f64; FFT]) {
    let mut j = 0usize;
    for i in 1..FFT {
        let mut bit = FFT >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2usize;
    while len <= FFT {
        let angle = -std::f64::consts::TAU / len as f64;
        let (wr, wi) = (angle.cos(), angle.sin());
        let half = len / 2;
        let mut base = 0usize;
        while base < FFT {
            let (mut cr, mut ci) = (1.0f64, 0.0f64);
            for k in 0..half {
                let (ur, ui) = (re[base + k], im[base + k]);
                let (xr, xi) = (re[base + k + half], im[base + k + half]);
                let (vr, vi) = (xr * cr - xi * ci, xr * ci + xi * cr);
                re[base + k] = ur + vr;
                im[base + k] = ui + vi;
                re[base + k + half] = ur - vr;
                im[base + k + half] = ui - vi;
                let next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = next;
            }
            base += len;
        }
        len <<= 1;
    }
}

/// Mono 16 kHz samples in −1..1 to log-mel energies with the per-band mean
/// removed. Returns `None` for anything too short to hold a single frame.
pub fn features(samples: &[f32]) -> Option<Features> {
    if samples.len() < FRAME {
        return None;
    }
    let frames = 1 + (samples.len() - FRAME) / SHIFT;
    let window = window();
    let banks = mel_banks();
    let mut data = vec![0.0f32; frames * BANDS];

    let mut re = [0.0f64; FFT];
    let mut im = [0.0f64; FFT];
    for f in 0..frames {
        let start = f * SHIFT;
        let mut frame = [0.0f64; FRAME];
        let mut sum = 0.0;
        for (i, slot) in frame.iter_mut().enumerate() {
            *slot = samples[start + i] as f64 * KALDI_SCALE;
            sum += *slot;
        }
        // Remove the offset before pre-emphasis, or the DC lands in the first
        // difference and puts energy in the lowest band that is not there.
        let mean = sum / FRAME as f64;
        for slot in frame.iter_mut() {
            *slot -= mean;
        }

        re.fill(0.0);
        im.fill(0.0);
        // Pre-emphasis 0.97, in place across the frame, then windowed.
        let mut previous = frame[0];
        re[0] = frame[0] * (1.0 - 0.97) * window[0];
        for i in 1..FRAME {
            let value = frame[i] - 0.97 * previous;
            previous = frame[i];
            re[i] = value * window[i];
        }
        fft(&mut re, &mut im);

        for b in 0..BANDS {
            let mut energy = 0.0f64;
            for k in 0..BINS {
                let weight = banks[b * BINS + k];
                if weight != 0.0 {
                    energy += weight * (re[k] * re[k] + im[k] * im[k]);
                }
            }
            data[f * BANDS + b] = energy.max(LOG_FLOOR).ln() as f32;
        }
    }

    // Cepstral mean normalisation, per band over the whole window. See the note
    // at the top of the file: this is the line that makes the rest work.
    for b in 0..BANDS {
        let mut sum = 0.0f64;
        for f in 0..frames {
            sum += data[f * BANDS + b] as f64;
        }
        let mean = (sum / frames as f64) as f32;
        for f in 0..frames {
            data[f * BANDS + b] -= mean;
        }
    }

    Some(Features { data, frames })
}

/// A stretch of one recording that is worth asking the model about.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub start: f64,
    pub end: f64,
    /// Which transcript block it came from, so an answer can be given back to
    /// the right piece of text.
    pub segment: usize,
}

/// About two seconds, which is where the measurement put the sweet spot.
const WINDOW: f64 = 2.0;
/// Windows overlap, so a handover inside a block still leaves whole windows on
/// both sides of it rather than one straddling window and nothing else.
const HOP: f64 = 1.0;
/// Under this there is not enough voice to describe. One second reads 80 %
/// against two seconds' 86 %, so a short block is worth asking about — but only
/// just, and anything shorter is noise.
const SHORTEST: f64 = 0.8;

/// Where to look, taken from the transcript rather than from a second model.
///
/// This is the step that lets `sherpa-onnx.exe` and its pyannote segmentation
/// go. Their job was to find where speech is; the transcript already knows,
/// because Whisper timestamped every word. Doing it again cost most of the 95
/// seconds a ten-minute recording used to spend.
///
/// Blocks are the unit rather than words: a word is a fifth of a second, far
/// too little to recognise a voice from, and block boundaries are where the
/// application already believes a thought ends. A long block is cut into
/// overlapping windows so that two people inside one block are not averaged
/// into a single answer.
pub fn windows(blocks: &[(f64, f64)]) -> Vec<Window> {
    let mut out = Vec::new();
    for (index, (start, end)) in blocks.iter().enumerate() {
        let length = end - start;
        if length < SHORTEST {
            continue;
        }
        if length <= WINDOW {
            out.push(Window {
                start: *start,
                end: *end,
                segment: index,
            });
            continue;
        }
        let mut from = *start;
        let mut reached = *start;
        while from + WINDOW <= *end {
            out.push(Window {
                start: from,
                end: from + WINDOW,
                segment: index,
            });
            reached = from + WINDOW;
            from += HOP;
        }
        // Whatever the last whole window did not reach. Somebody taking the
        // floor for the final second is exactly the case this exists for, so
        // the end is always covered — by a full-length window reaching back
        // into the one before it. The quarter second is only to avoid a window
        // that would be a near-duplicate of its predecessor.
        if *end - reached > 0.25 {
            out.push(Window {
                start: (*end - WINDOW).max(*start),
                end: *end,
                segment: index,
            });
        }
    }
    out
}

// ------------------------------------------------------------------- model

/// CAM++ returns this many numbers per voice.
pub const EMBEDDING: usize = 192;

/// How many windows go to the card at once.
///
/// Measured, not guessed: one at a time the card is 1.5x the processor and most
/// of that time is spent moving data across the bus; at 256 it is 8.9x and the
/// per-window cost is still falling — 5.571 ms each at a batch of one against
/// 0.607 ms at 256. The ceiling is memory, and 256 windows of two seconds is
/// about 16 MB, which is nothing.
const BATCH: usize = 256;

/// The speaker model, held open for the length of one recording.
///
/// It replaces `sherpa-onnx-offline-speaker-diarization.exe`: same model file,
/// but in this process, so the embeddings themselves are available rather than
/// only the groups sherpa decided on. That is what lets somebody name two
/// voices and have the rest assigned by similarity — the executable's stdout
/// could never give us the numbers.
pub struct Voices {
    session: ort::session::Session,
    input: String,
    /// Kept so the model can be opened a second time on the processor if the
    /// graphics card turns out not to be able to run it.
    model: std::path::PathBuf,
    on_card: bool,
}

impl Voices {
    /// Opens the model that the installer already downloads.
    pub fn open(model: &std::path::Path) -> anyhow::Result<Self> {
        Self::open_on(model, cfg!(windows))
    }

    fn open_on(model: &std::path::Path, on_card: bool) -> anyhow::Result<Self> {
        let session = match build(model, on_card) {
            Ok(session) => session,
            // Only the text crosses over. See `build` below for why the error
            // itself cannot.
            Err(error) => anyhow::bail!("speaker model: {error}"),
        };

        // Read the name rather than writing `x` here: it is the model's to
        // choose, and it is one less thing to be quietly wrong.
        let input = session
            .inputs()
            .first()
            .ok_or_else(|| anyhow::anyhow!("the speaker model declares no input"))?
            .name()
            .to_owned();

        Ok(Voices {
            session,
            input,
            model: model.to_path_buf(),
            on_card,
        })
    }

    /// A unit-length voiceprint per window, in the order the windows came in.
    ///
    /// Windows of different lengths cannot share one batch — the model's middle
    /// dimension is the frame count and a batch has one of it — so they are
    /// grouped by length first. In practice almost every window is the full two
    /// seconds, so the groups are large and the batching is worth having.
    ///
    /// If the graphics card refuses — and it does refuse some shapes, see the
    /// note on [`run`] — the model is opened again on the processor and the
    /// whole thing is done a second time. Slower is better than nothing, and
    /// the reader never learns that anything happened.
    pub fn embed(&mut self, windows: &[Features]) -> anyhow::Result<Vec<Vec<f32>>> {
        match self.run(windows) {
            Ok(prints) => Ok(prints),
            Err(error) if self.on_card => {
                crate::note!("speaker model fell back to the processor: {error:#}");
                *self = Self::open_on(&self.model.clone(), false)?;
                self.run(windows)
            }
            Err(error) => Err(error),
        }
    }

    /// One pass over every window with whatever provider this session holds.
    ///
    /// **DirectML will not run every shape.** On the first real recording it
    /// refused `cam_layer/AveragePool` with `E_INVALIDARG` — a pooling window
    /// wider than the input it was given, which happens when the audio handed
    /// over is short. The caller keeps every window the same length for that
    /// reason; this is the net under it.
    fn run(&mut self, windows: &[Features]) -> anyhow::Result<Vec<Vec<f32>>> {
        let mut out = vec![Vec::new(); windows.len()];
        for (frames, group) in by_length(windows) {
            for chunk in group.chunks(BATCH) {
                let mut data = Vec::with_capacity(chunk.len() * frames * BANDS);
                for &index in chunk {
                    data.extend_from_slice(&windows[index].data);
                }
                let shape = vec![chunk.len() as i64, frames as i64, BANDS as i64];
                let tensor = ort::value::TensorRef::from_array_view((shape, data.as_slice()))?;
                let result = self
                    .session
                    .run(ort::inputs![self.input.as_str() => tensor])?;
                let (_, values) = result[0].try_extract_tensor::<f32>()?;
                if values.len() != chunk.len() * EMBEDDING {
                    anyhow::bail!(
                        "the speaker model returned {} numbers for {} windows, expected {}",
                        values.len(),
                        chunk.len(),
                        chunk.len() * EMBEDDING
                    );
                }
                for (row, &index) in chunk.iter().enumerate() {
                    out[index] = unit(&values[row * EMBEDDING..(row + 1) * EMBEDDING]);
                }
            }
        }
        Ok(out)
    }
}

/// Building the session, kept apart from [`Voices::open`] for one reason worth
/// knowing before anybody inlines it back.
///
/// `SessionBuilder` reports failure as `ort::Error<SessionBuilder>` — the error
/// hands the builder back so a caller can recover and try something else. That
/// builder is neither `Send` nor `Sync`, and `anyhow::Error` demands both, so
/// `?` straight into an `anyhow::Result` does not compile: it produces two
/// dozen complaints about `NonNull` and `dyn Any` that have nothing to do with
/// this code. Inside a function returning ort's own error the conversion is to
/// `Error<()>`, which carries no builder and is therefore ordinary.
fn build(model: &std::path::Path, on_card: bool) -> Result<ort::session::Session, ort::Error> {
    use ort::session::{builder::GraphOptimizationLevel, Session};

    let mut providers = Vec::new();
    #[cfg(windows)]
    if on_card {
        providers.push(ort::ep::DirectML::default().build());
    }
    // Last in line, and reached silently: when a provider cannot be registered
    // ONNX Runtime falls through to the next one and logs at a level nobody
    // subscribes to. So nothing here reports which one ran — only the clock
    // can, which is what the probe in `probe/ort-dml` is for.
    providers.push(ort::ep::CPU::default().build());

    let mut builder =
        Session::builder()?.with_optimization_level(GraphOptimizationLevel::Level3)?;
    // Not tuning but a condition: DirectML refuses to create a session while
    // memory-pattern optimisation is on, and it is on by default.
    if on_card {
        builder = builder.with_memory_pattern(false)?;
    }

    builder
        .with_execution_providers(providers)?
        .commit_from_file(model)
}

/// Which samples to hand the model for a window, in `start..end`.
///
/// The window says where to *look*; this says how much to actually cut, and the
/// two are not the same thing. A block can be shorter than the window — the
/// transcript is full of one-second remarks — and the model does not take
/// kindly to a short input: on the first real recording DirectML refused
/// `cam_layer/AveragePool` with "invalid parameter", which is a pooling window
/// wider than what it was given. The processor tolerates it, the graphics card
/// does not.
///
/// So a short window is grown to the full length by reaching into the audio
/// around it, centred on what was asked for and clamped to the recording. That
/// removes the failure, and it has a second benefit worth having: every window
/// ends up the same length, so they all travel in one batch, and DirectML is
/// measurably happier when the shape does not keep changing.
pub fn enough_audio(start: f64, end: f64, rate: f64, total: usize) -> (usize, usize) {
    let need = (WINDOW * rate) as usize;
    let mut from = (start * rate).max(0.0) as usize;
    let mut to = ((end * rate) as usize).min(total);
    if total <= need {
        // The whole recording is shorter than one window; there is nothing to
        // reach into, so hand over what there is.
        return (0, total);
    }
    while to - from < need {
        // Backwards first: a block's own beginning is more likely to be the
        // speaker than whatever follows it.
        if from > 0 {
            from -= 1;
        } else if to < total {
            to += 1;
        } else {
            break;
        }
        if to - from < need && to < total {
            to += 1;
        }
    }
    (from, to.min(total))
}

/// A stretch of time credited to one voice.
#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    pub start: f64,
    pub end: f64,
    pub voice: usize,
}

/// Windows overlap by design, so neighbours that agree are the same turn said
/// twice. This joins them back into one.
///
/// A gap closes a turn even when the voice is the same: two windows either side
/// of a silence are two turns, and the transcript's own blocks are what put the
/// silence there. Without that, one person's whole recording would come back as
/// a single turn covering the other speakers' pauses as well.
pub fn turns(windows: &[Window], labels: &[usize]) -> Vec<Turn> {
    let mut out: Vec<Turn> = Vec::new();
    for (window, voice) in windows.iter().zip(labels) {
        match out.last_mut() {
            // Touching or overlapping, and the same voice: one turn.
            Some(open) if open.voice == *voice && window.start <= open.end + 1e-6 => {
                open.end = open.end.max(window.end);
            }
            _ => out.push(Turn {
                start: window.start,
                end: window.end,
                voice: *voice,
            }),
        }
    }
    out
}

/// Above this, two windows are taken for the same person.
///
/// Measured on 381 pairs of one speaker and 400 pairs of two, drawn from a real
/// interview: the same person averages 0.393, two people 0.076. Accuracy peaks
/// at 0.22 with 84.9 % and the curve is flat from 0.20 to 0.25, so the rule
/// does not balance on this number.
///
/// It sits at the top of that plateau on purpose, because **the two mistakes do
/// not cost the same**. At 0.25 one person is split in two about a quarter of
/// the time and two people are merged 6.5 % of the time; at 0.22 it is 21 % and
/// 10 %. A split is repaired by the reader typing one name twice — the panel
/// has merged by name since it was built. A merge cannot be repaired at all.
const SAME_VOICE: f32 = 0.25;

/// Groups voiceprints by who is speaking. Returns a group number per print.
///
/// `wanted` is how many people there are, when somebody has said so. It is
/// worth asking for: told the count, this is measurably reliable; left to guess
/// it is the weakest part of the whole feature.
///
/// Deterministic, and that is deliberate rather than incidental — the same
/// recording must group the same way twice, so the seeds are chosen by distance
/// and never at random.
pub fn group(prints: &[Vec<f32>], wanted: Option<usize>) -> Vec<usize> {
    if prints.is_empty() {
        return Vec::new();
    }
    match wanted {
        Some(k) if k >= 1 && k < prints.len() => into_k(prints, k),
        Some(_) => vec![0; prints.len()],
        None => by_threshold(prints),
    }
}

/// Lloyd's algorithm on the cosine, seeded by taking the point least like
/// everything chosen so far. No randomness: two runs over one recording must
/// not disagree.
fn into_k(prints: &[Vec<f32>], k: usize) -> Vec<usize> {
    let mut centres: Vec<Vec<f32>> = Vec::with_capacity(k);
    // The first seed is the print least like the average of them all, which is
    // the far end of the widest spread there is.
    let middle = average(prints, &(0..prints.len()).collect::<Vec<_>>());
    let first = (0..prints.len())
        .min_by(|a, b| {
            let x = alike(&prints[*a], &middle);
            let y = alike(&prints[*b], &middle);
            x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(0);
    centres.push(prints[first].clone());
    while centres.len() < k {
        let next = (0..prints.len())
            .max_by(|a, b| {
                let x = nearest(&prints[*a], &centres).1;
                let y = nearest(&prints[*b], &centres).1;
                y.partial_cmp(&x).unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or(0);
        centres.push(prints[next].clone());
    }

    let mut labels = vec![0usize; prints.len()];
    for _ in 0..30 {
        let mut moved = false;
        for (i, print) in prints.iter().enumerate() {
            let best = nearest(print, &centres).0;
            if labels[i] != best {
                labels[i] = best;
                moved = true;
            }
        }
        for c in 0..centres.len() {
            let members: Vec<usize> = (0..prints.len()).filter(|i| labels[*i] == c).collect();
            if !members.is_empty() {
                centres[c] = average(prints, &members);
            }
        }
        if !moved {
            break;
        }
    }
    labels
}

/// Nobody said how many people there are, so the threshold decides. Windows are
/// visited in the order they occur, which keeps the result reproducible and
/// tends to open a group at the moment a new voice first speaks.
fn by_threshold(prints: &[Vec<f32>]) -> Vec<usize> {
    let mut centres: Vec<Vec<f32>> = Vec::new();
    let mut labels = vec![0usize; prints.len()];
    for (i, print) in prints.iter().enumerate() {
        let (best, score) = nearest(print, &centres);
        if !centres.is_empty() && score >= SAME_VOICE {
            labels[i] = best;
        } else {
            labels[i] = centres.len();
            centres.push(print.clone());
        }
        let members: Vec<usize> = (0..=i).filter(|j| labels[*j] == labels[i]).collect();
        let c = labels[i];
        centres[c] = average(prints, &members);
    }

    // One voice can open two groups when it is heard differently early on, so
    // groups that ended up alike are joined. Repeated, because joining two can
    // bring a third within reach.
    loop {
        let mut join: Option<(usize, usize)> = None;
        'search: for a in 0..centres.len() {
            for b in (a + 1)..centres.len() {
                if alike(&centres[a], &centres[b]) >= SAME_VOICE {
                    join = Some((a, b));
                    break 'search;
                }
            }
        }
        let Some((a, b)) = join else { break };
        for label in labels.iter_mut() {
            if *label == b {
                *label = a;
            } else if *label > b {
                *label -= 1;
            }
        }
        centres.remove(b);
        let members: Vec<usize> = (0..labels.len()).filter(|j| labels[*j] == a).collect();
        centres[a] = average(prints, &members);
    }
    labels
}

/// Which centre a print belongs to, and how much. `(0, -1.0)` when there are
/// none yet.
fn nearest(print: &[f32], centres: &[Vec<f32>]) -> (usize, f32) {
    let mut best = (0usize, -1.0f32);
    for (i, centre) in centres.iter().enumerate() {
        let score = alike(print, centre);
        if score > best.1 {
            best = (i, score);
        }
    }
    best
}

/// The middle of a group, scaled back to length one so it can be compared like
/// any other voiceprint.
fn average(prints: &[Vec<f32>], members: &[usize]) -> Vec<f32> {
    let width = prints.first().map(|p| p.len()).unwrap_or(0);
    let mut sum = vec![0.0f32; width];
    for &i in members {
        for (slot, value) in sum.iter_mut().zip(&prints[i]) {
            *slot += value;
        }
    }
    unit(&sum)
}

/// Indices grouped by frame count, so each group can go in one batch.
fn by_length(windows: &[Features]) -> Vec<(usize, Vec<usize>)> {
    let mut groups: Vec<(usize, Vec<usize>)> = Vec::new();
    for (index, w) in windows.iter().enumerate() {
        match groups.iter_mut().find(|(frames, _)| *frames == w.frames) {
            Some((_, list)) => list.push(index),
            None => groups.push((w.frames, vec![index])),
        }
    }
    groups
}

/// Scaled to length one, because everything downstream compares by cosine and
/// a comparison against vectors of different lengths measures loudness as much
/// as voice.
fn unit(values: &[f32]) -> Vec<f32> {
    let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return values.to_vec();
    }
    values.iter().map(|v| v / norm).collect()
}

/// How alike two voiceprints are, between -1 and 1. Both are unit length, so
/// this is the dot product and nothing else.
///
/// For scale, measured on two-second windows of a real interview: the same
/// person averages 0.36 and two different people 0.06.
pub fn alike(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same deterministic signal the reference implementation was run on —
    /// no generator, no seed, so it can be reproduced anywhere. The expected
    /// values below come from that run, which is the one that was measured
    /// against the real CAM++ and scored 100 % on five named examples.
    fn reference_signal() -> Vec<f32> {
        let sr = SAMPLE_RATE as f64;
        (0..8000)
            .map(|i| {
                let t = i as f64;
                (0.5 * (std::f64::consts::TAU * 220.0 * t / sr).sin()
                    + 0.2 * (std::f64::consts::TAU * 3000.0 * t / sr).sin()
                    + 0.05 * (std::f64::consts::TAU * 77.0 * t / sr).sin()) as f32
            })
            .collect()
    }

    fn close(a: f32, b: f32, tolerance: f32, what: &str) {
        assert!(
            (a - b).abs() <= tolerance,
            "{what}: expected {b}, got {a}, difference {}",
            (a - b).abs()
        );
    }

    #[test]
    fn half_a_second_of_audio_gives_forty_eight_frames() {
        let f = features(&reference_signal()).expect("half a second is plenty");
        assert_eq!(f.frames, 48);
        assert_eq!(f.data.len(), 48 * BANDS);
    }

    /// Not a property of this signal but of the normalisation: after it, every
    /// band averages zero over the window. If this fails, CMN is not running.
    #[test]
    fn every_band_averages_zero_after_normalisation() {
        let f = features(&reference_signal()).unwrap();
        for b in 0..BANDS {
            let mean: f64 = (0..f.frames)
                .map(|i| f.data[i * BANDS + b] as f64)
                .sum::<f64>()
                / f.frames as f64;
            assert!(mean.abs() < 1e-4, "band {b} averages {mean}, not zero");
        }
    }

    #[test]
    fn the_reference_values_still_come_out() {
        let f = features(&reference_signal()).unwrap();

        let first = [
            -0.188_102_7_f32,
            -0.209_892_3,
            0.346_250_5,
            -0.200_822_8,
            -0.096_927_64,
        ];
        for (i, expected) in first.iter().enumerate() {
            close(f.data[i], *expected, 2e-3, &format!("frame 0, band {i}"));
        }

        let tenth = [0.745_166_8_f32, 0.144_165, 0.263_214_1, -0.246_889_1];
        for (i, expected) in tenth.iter().enumerate() {
            close(
                f.data[10 * BANDS + i],
                *expected,
                2e-3,
                &format!("frame 10, band {i}"),
            );
        }

        let last = [0.461_996_f32, 0.102_724, 0.400_927, -0.410_664];
        for (i, expected) in last.iter().enumerate() {
            close(
                f.data[(f.frames - 1) * BANDS + i],
                *expected,
                2e-3,
                &format!("last frame, band {i}"),
            );
        }
    }

    /// Where the loudest and quietest bands land is a property of the whole
    /// pipeline — the window, the transform and the filterbank together — so
    /// one wrong constant anywhere moves them.
    #[test]
    fn the_extremes_are_where_the_reference_put_them() {
        let f = features(&reference_signal()).unwrap();
        let (mut hi, mut lo) = (0usize, 0usize);
        for i in 1..f.data.len() {
            if f.data[i] > f.data[hi] {
                hi = i;
            }
            if f.data[i] < f.data[lo] {
                lo = i;
            }
        }
        assert_eq!((hi / BANDS, hi % BANDS), (5, 30), "loudest band moved");
        assert_eq!((lo / BANDS, lo % BANDS), (32, 0), "quietest band moved");
        close(f.data[hi], 0.855_252, 2e-3, "loudest value");
        close(f.data[lo], -0.804_564, 2e-3, "quietest value");
    }

    /// Cheap guards on the two tables the rest is built from, so a wrong
    /// constant is caught here rather than as a bad transcript later.
    #[test]
    fn the_filterbank_and_the_window_match_the_reference() {
        let w = window();
        close(
            w.iter().sum::<f64>() as f32,
            212.146_985,
            1e-2,
            "window sum",
        );
        close(w[0] as f32, 0.0, 1e-9, "window starts at zero");
        close(w[200] as f32, 0.999_987, 1e-5, "window peaks near one");

        let banks = mel_banks();
        close(
            banks.iter().sum::<f64>() as f32,
            250.750_824,
            1e-2,
            "filterbank sum",
        );
        close(
            banks[..BINS].iter().sum::<f64>() as f32,
            0.639_707,
            1e-3,
            "first band sum",
        );
        close(
            banks[79 * BINS..].iter().sum::<f64>() as f32,
            8.290_835,
            1e-3,
            "last band sum",
        );
    }

    #[test]
    fn a_fragment_shorter_than_one_frame_has_no_features() {
        assert!(features(&vec![0.0; FRAME - 1]).is_none());
        assert!(features(&vec![0.0; FRAME]).is_some());
    }

    // ------------------------------------------------------------- windows

    /// The ordinary block: one question, one answer.
    #[test]
    fn a_block_about_the_right_length_is_asked_about_once() {
        let w = windows(&[(1.0, 2.8)]);
        assert_eq!(w.len(), 1);
        assert_eq!(
            w[0],
            Window {
                start: 1.0,
                end: 2.8,
                segment: 0
            }
        );
    }

    /// Too little voice to describe. The measurement gives one second 80 %
    /// against two seconds' 86 %; below that it is not worth an answer.
    #[test]
    fn a_block_too_short_to_recognise_is_skipped() {
        assert!(windows(&[(0.0, 0.5)]).is_empty());
        assert_eq!(windows(&[(0.0, 0.9)]).len(), 1);
    }

    /// A long block is where two people hide, so it is cut into overlapping
    /// windows rather than averaged into one answer.
    #[test]
    fn a_long_block_is_cut_into_overlapping_windows() {
        let w = windows(&[(0.0, 6.0)]);
        assert!(
            w.len() >= 4,
            "six seconds should give several windows, got {}",
            w.len()
        );
        for pair in w.windows(2) {
            assert!(
                pair[1].start > pair[0].start,
                "windows must advance: {pair:?}"
            );
            assert!(
                pair[1].start < pair[0].end,
                "and overlap, or a handover falls between them: {pair:?}"
            );
        }
        assert!(w.iter().all(|x| x.segment == 0));
        assert!(
            w.iter().all(|x| x.start >= 0.0 && x.end <= 6.0),
            "no window may leave its block"
        );
    }

    /// The end of a long block must be covered too — a speaker who takes over
    /// for the last second and a half is exactly the case this is for.
    #[test]
    fn the_end_of_a_long_block_is_not_left_out() {
        let w = windows(&[(0.0, 5.5)]);
        let last = w.last().expect("there are windows");
        assert!(
            (last.end - 5.5).abs() < 1e-9,
            "the last window should end with the block, got {last:?}"
        );
    }

    #[test]
    fn every_window_says_which_block_it_came_from() {
        let w = windows(&[(0.0, 2.0), (10.0, 16.0), (20.0, 21.0)]);
        assert!(w.iter().any(|x| x.segment == 0));
        assert!(w.iter().any(|x| x.segment == 1));
        assert!(w.iter().any(|x| x.segment == 2));
        assert!(w.iter().all(|x| x.end > x.start));
    }

    // --------------------------------------------------------------- model

    fn dummy(frames: usize) -> Features {
        Features {
            data: vec![0.0; frames * BANDS],
            frames,
        }
    }

    /// The model's middle dimension is the frame count, so a batch has one of
    /// it. Windows of different lengths therefore cannot travel together, and
    /// the grouping is what makes batching possible at all.
    #[test]
    fn windows_of_one_length_travel_together() {
        let w = [dummy(198), dummy(80), dummy(198), dummy(198), dummy(80)];
        let mut groups = by_length(&w);
        groups.sort_by_key(|(frames, _)| *frames);

        assert_eq!(groups.len(), 2, "two lengths, two groups");
        assert_eq!(groups[0], (80, vec![1, 4]));
        assert_eq!(groups[1], (198, vec![0, 2, 3]));
    }

    /// Every window must come back, and in its own place — the caller matches
    /// answers to blocks by index.
    #[test]
    fn the_grouping_loses_nothing_and_reorders_nothing() {
        let w: Vec<Features> = (0..50).map(|i| dummy(100 + i % 3)).collect();
        let groups = by_length(&w);
        let mut seen: Vec<usize> = groups.iter().flat_map(|(_, list)| list.clone()).collect();
        seen.sort_unstable();
        assert_eq!(seen, (0..50).collect::<Vec<_>>());
        for (frames, list) in &groups {
            for &i in list {
                assert_eq!(w[i].frames, *frames);
            }
            assert!(
                list.windows(2).all(|p| p[0] < p[1]),
                "order kept inside a group"
            );
        }
    }

    #[test]
    fn a_voiceprint_is_scaled_to_length_one() {
        let v = unit(&[3.0, 4.0]);
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
        assert!(
            (alike(&v, &v) - 1.0).abs() < 1e-6,
            "a voice is identical to itself"
        );
    }

    /// Nothing to divide by, and nothing to say about it either — but it must
    /// not become a vector of NaN that quietly poisons every comparison.
    #[test]
    fn silence_does_not_become_nonsense() {
        let v = unit(&[0.0; EMBEDDING]);
        assert_eq!(v.len(), EMBEDDING);
        assert!(v.iter().all(|x| x.is_finite()));
    }

    // ------------------------------------------------------------ grouping

    /// Three directions far enough apart to be three people, plus a little
    /// wobble so they are not identical copies of themselves.
    fn three_voices() -> Vec<Vec<f32>> {
        let mut out = Vec::new();
        for (a, b, c) in [(1.0, 0.05, 0.0), (0.0, 1.0, 0.05), (0.05, 0.0, 1.0)] {
            for wobble in [0.0, 0.02, -0.02] {
                out.push(unit(&[a + wobble, b, c]));
            }
        }
        out
    }

    fn how_many(labels: &[usize]) -> usize {
        let mut seen = labels.to_vec();
        seen.sort_unstable();
        seen.dedup();
        seen.len()
    }

    #[test]
    fn three_voices_become_three_groups() {
        let labels = group(&three_voices(), None);
        assert_eq!(how_many(&labels), 3, "got {labels:?}");
        // Each run of three came from one voice, so each must share a group.
        for start in [0, 3, 6] {
            assert_eq!(labels[start], labels[start + 1]);
            assert_eq!(labels[start], labels[start + 2]);
        }
    }

    #[test]
    fn one_voice_stays_one_group() {
        let same: Vec<Vec<f32>> = (0..8).map(|i| unit(&[1.0, 0.01 * i as f32, 0.0])).collect();
        assert_eq!(how_many(&group(&same, None)), 1);
    }

    /// Told the count, it must produce exactly that many — this is the path
    /// the speaker-count question feeds, and the one that measures well.
    #[test]
    fn a_known_count_is_honoured() {
        let labels = group(&three_voices(), Some(3));
        assert_eq!(how_many(&labels), 3);
        for start in [0, 3, 6] {
            assert_eq!(labels[start], labels[start + 1]);
            assert_eq!(labels[start], labels[start + 2]);
        }
    }

    /// The same recording must not group differently on a second run, so
    /// nothing in here may be seeded at random.
    #[test]
    fn grouping_is_the_same_every_time() {
        let voices = three_voices();
        assert_eq!(group(&voices, None), group(&voices, None));
        assert_eq!(group(&voices, Some(2)), group(&voices, Some(2)));
    }

    #[test]
    fn nothing_to_group_is_not_a_crash() {
        assert!(group(&[], None).is_empty());
        assert!(group(&[], Some(3)).is_empty());
        // More people asked for than windows heard: everything is one group
        // rather than an empty answer or a panic.
        let one = vec![unit(&[1.0, 0.0])];
        assert_eq!(group(&one, Some(5)), vec![0]);
    }

    // ---------------------------------------------------------- enough audio

    const RATE: f64 = SAMPLE_RATE as f64;
    /// What a full window is worth in samples: two seconds at 16 kHz.
    const FULL: usize = 32_000;

    #[test]
    fn a_window_of_the_right_length_is_taken_as_it_is() {
        let (from, to) = enough_audio(10.0, 12.0, RATE, 16_000 * 60);
        assert_eq!((from, to), (160_000, 192_000));
        assert_eq!(to - from, FULL);
    }

    /// The case that broke it: a one-second block. The graphics card refuses a
    /// short input, so the cut reaches into the audio around it.
    #[test]
    fn a_short_block_borrows_from_around_it() {
        let (from, to) = enough_audio(10.0, 11.0, RATE, 16_000 * 60);
        assert_eq!(to - from, FULL, "must be a full window, got {}", to - from);
        assert!(from <= 160_000 && to >= 176_000, "still covers the block");
    }

    #[test]
    fn a_block_at_the_very_start_grows_forwards() {
        let (from, to) = enough_audio(0.0, 0.9, RATE, 16_000 * 60);
        assert_eq!(from, 0);
        assert_eq!(to - from, FULL);
    }

    #[test]
    fn a_block_at_the_very_end_grows_backwards() {
        let total = 16_000 * 60;
        let (from, to) = enough_audio(59.1, 60.0, RATE, total);
        assert_eq!(to, total);
        assert_eq!(to - from, FULL);
    }

    /// A recording shorter than one window has nothing to reach into, and must
    /// not loop forever looking for it.
    #[test]
    fn a_recording_shorter_than_a_window_hands_over_what_there_is() {
        let total = 16_000;
        assert_eq!(enough_audio(0.0, 1.0, RATE, total), (0, total));
    }

    // --------------------------------------------------------------- turns

    fn win(start: f64, end: f64) -> Window {
        Window {
            start,
            end,
            segment: 0,
        }
    }

    /// The ordinary case: one person talking, heard through five overlapping
    /// windows, is one turn — not five.
    #[test]
    fn overlapping_windows_of_one_voice_become_one_turn() {
        let w: Vec<Window> = (0..5).map(|i| win(i as f64, i as f64 + 2.0)).collect();
        let t = turns(&w, &[0, 0, 0, 0, 0]);
        assert_eq!(t.len(), 1);
        assert_eq!(
            t[0],
            Turn {
                start: 0.0,
                end: 6.0,
                voice: 0
            }
        );
    }

    #[test]
    fn a_change_of_voice_closes_the_turn() {
        let w = vec![win(0.0, 2.0), win(1.0, 3.0), win(2.0, 4.0)];
        let t = turns(&w, &[0, 1, 1]);
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].voice, 0);
        assert_eq!(t[1].voice, 1);
        assert_eq!(t[1].start, 1.0);
    }

    /// Silence between two blocks closes a turn even for one voice. Otherwise
    /// somebody's first and last word would claim the whole recording between
    /// them, including everybody else's turns.
    #[test]
    fn a_gap_closes_the_turn_even_for_one_voice() {
        let w = vec![win(0.0, 2.0), win(40.0, 42.0)];
        let t = turns(&w, &[0, 0]);
        assert_eq!(t.len(), 2, "a silence is not part of anybody's turn");
        assert_eq!(t[0].end, 2.0);
        assert_eq!(t[1].start, 40.0);
    }

    #[test]
    fn nothing_heard_is_no_turns() {
        assert!(turns(&[], &[]).is_empty());
    }

    #[test]
    fn opposite_voices_are_told_apart() {
        let a = unit(&[1.0, 0.0, 0.0]);
        let b = unit(&[0.0, 1.0, 0.0]);
        assert!(
            alike(&a, &b).abs() < 1e-6,
            "unrelated directions score zero"
        );
        assert!(alike(&a, &unit(&[-1.0, 0.0, 0.0])) < -0.99);
    }
}
