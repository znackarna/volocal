//! Turning a piece of speech into the numbers a voice model expects.
//!
//! This is the first half of recognising who is speaking without spawning
//! `sherpa-onnx.exe`. The second half is CAM++ itself; this file only prepares
//! its input, and it is deliberately dependency-free — a mel filterbank and a
//! 512-point transform are less code than the crate that would provide them.
//!
//! Every constant here was measured rather than chosen, against the real model
//! and a real recording; the numbers are in `CLAUDE.md` under *The numbers that
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
            let mean: f64 = (0..f.frames).map(|i| f.data[i * BANDS + b] as f64).sum::<f64>()
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
        close(w.iter().sum::<f64>() as f32, 212.146_985, 1e-2, "window sum");
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
}
