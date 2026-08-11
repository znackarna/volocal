//! Does DirectML actually get this graphics card under load?
//!
//! Everything about replacing the external `sherpa-onnx.exe` with in-process
//! inference hangs on that one number, and nothing else can be decided before
//! it is known. Speaker embedding runs on ONNX Runtime, which has no Vulkan
//! provider and never has — but its Windows build does have DirectML, which is
//! vendor-neutral and reaches an AMD card through DirectX 12.
//!
//! The model is the one the application already downloads: CAM++, about 28 MB.
//! It is fed synthetic input of whatever shape it declares, because the
//! question is how fast the card multiplies, not what it says about the audio.
//!
//! Run it twice and compare:
//!
//! ```text
//! cargo run --release -- --dml
//! cargo run --release -- --cpu
//! ```
//!
//! …or `--sweep`, which is the question that actually matters. One segment at a
//! time is a crumb: the first measurement gave DirectML 5.64 ms against the
//! processor's 9.22, and most of those 5.64 went on moving data across the bus
//! rather than on arithmetic. Diarization computes an embedding for hundreds of
//! segments in a row, so what decides this is how the two scale when the
//! segments are handed over in batches.

use std::{
    env,
    error::Error,
    path::{Path, PathBuf},
    time::Instant,
};

use ort::{
    ep::CPU,
    session::{builder::GraphOptimizationLevel, Session},
    value::{Outlet, TensorElementType, TensorRef, ValueType},
};

/// Where the installer puts it. Overridable, because a portable copy keeps its
/// models beside the executable instead.
fn default_model() -> Option<PathBuf> {
    let local = env::var_os("LOCALAPPDATA")?;
    Some(
        PathBuf::from(local)
            .join("Whisp")
            .join("models")
            .join("3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"),
    )
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut model_path: Option<PathBuf> = None;
    let mut runs: usize = 20;
    // Frames of audio to pretend to have. CAM++ takes a variable number; two
    // hundred frames is two seconds, which is about one speech segment.
    let mut frames: i64 = 200;
    let mut batch: i64 = 1;
    let mut want_dml = true;
    let mut sweep = false;

    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--cpu" => want_dml = false,
            "--dml" => want_dml = true,
            "--sweep" => sweep = true,
            "--runs" => runs = args.next().ok_or("--runs wants a number")?.parse()?,
            "--frames" => frames = args.next().ok_or("--frames wants a number")?.parse()?,
            "--batch" => batch = args.next().ok_or("--batch wants a number")?.parse()?,
            other => model_path = Some(PathBuf::from(other)),
        }
    }

    let model_path = model_path
        .or_else(default_model)
        .ok_or("no model found; pass the path to an .onnx as an argument")?;
    if !model_path.exists() {
        return Err(format!(
            "{} does not exist — download the model in Settings, or pass a path",
            model_path.display()
        )
        .into());
    }
    println!("model: {}", model_path.display());

    if sweep {
        return run_through(&model_path, runs, frames);
    }

    println!("mode: {}\n", if want_dml { "DirectML" } else { "processor" });
    let mut session = session_for(&model_path, want_dml)?;

    println!("\n-- vstupy --");
    for (i, o) in session.inputs().iter().enumerate() {
        println!("  [{i}] {:<28} {}", o.name(), popis(o));
    }
    println!("-- outputs --");
    for (i, o) in session.outputs().iter().enumerate() {
        println!("  [{i}] {:<28} {}", o.name(), popis(o));
    }

    let (name, dims) = input_shape(&session, batch, frames)?;
    println!(
        "\nfeeding `{name}` a shape of {dims:?}, which is {} numbers",
        dims.iter().product::<i64>()
    );

    if runs == 0 {
        return Ok(());
    }
    let m = measure(&mut session, &name, &dims, runs, true)?;
    println!(
        "\n{} runs: mean {:.2} ms | median {:.2} ms | fastest {:.2} ms | slowest {:.2} ms",
        runs,
        m.prumer * 1e3,
        m.median * 1e3,
        m.nej * 1e3,
        m.nejhorsi * 1e3
    );
    Ok(())
}

/// How many passages at once. One is what sherpa does today; sixty-four is what
/// a graphics card would want.
const BATCHES: [i64; 5] = [1, 4, 16, 64, 256];

/// Both paths, several batch sizes, one table. No single row is interesting —
/// what matters is how far apart the two columns drift.
fn run_through(model: &Path, runs: usize, frames: i64) -> Result<(), Box<dyn Error>> {
    println!("\nseconds of audio per passage: {:.1}", frames as f64 / 100.0);
    println!(
        "\n{:>7}  {:>12}  {:>12}  {:>9}  {:>14}",
        "batch", "DirectML", "processor", "ratio", "DML per passage"
    );
    println!("{}", "-".repeat(62));

    // A session is made once per path: compiling the graph is expensive and
    // does not belong in a measurement of batches.
    let mut dml = match session_for(model, true) {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("the DirectML session was not created: {e}");
            None
        }
    };
    let mut cpu = session_for(model, false)?;

    for batch in BATCHES {
        let (name, dims) = input_shape(&cpu, batch, frames)?;

        let t_cpu = measure(&mut cpu, &name, &dims, runs, false)?.median;
        let t_dml = match dml.as_mut() {
            Some(s) => measure(s, &name, &dims, runs, false)?.median,
            None => f64::NAN,
        };

        println!(
            "{batch:>7}  {:>10.2} ms  {:>10.2} ms  {:>8.2}x  {:>11.3} ms",
            t_dml * 1e3,
            t_cpu * 1e3,
            t_cpu / t_dml,
            t_dml * 1e3 / batch as f64
        );
    }

    println!(
        "\nThe last column is the one that matters: what a single passage costs\n\
         when several are sent at once. If it falls as the batch grows, the\n\
         card was idling and only needs to be fed in bigger mouthfuls."
    );
    Ok(())
}

fn session_for(model: &Path, want_dml: bool) -> Result<Session, Box<dyn Error>> {
    let mut providers = Vec::new();

    #[cfg(windows)]
    if want_dml {
        use ort::ep::DirectML;
        providers.push(DirectML::default().build());
    }
    #[cfg(not(windows))]
    if want_dml {
        eprintln!("not on Windows, so no DirectML; the processor will run it");
    }

    // Last in line. When DirectML does not register, ONNX Runtime quietly
    // falls through to here — which is why the messages cannot be trusted and
    // the time is what gets measured.
    providers.push(CPU::default().build());

    let mut builder = Session::builder()?.with_optimization_level(GraphOptimizationLevel::Level3)?;
    if want_dml {
        // Not a tuning knob but a condition: DirectML refuses to be created
        // while memory pattern optimisation is on, and it is on by default.
        // Without this line the session fails outright.
        builder = builder.with_memory_pattern(false)?;
    }
    Ok(builder
        .with_execution_providers(providers)?
        .commit_from_file(model)?)
}

/// The first input's name and a shape it can be fed with. An unknown dimension
/// is -1; the zeroth is the batch, every other one the frame count.
fn input_shape(
    session: &Session,
    batch: i64,
    frames: i64,
) -> Result<(String, Vec<i64>), Box<dyn Error>> {
    let name = session.inputs()[0].name().to_owned();
    let ValueType::Tensor { ty, shape, .. } = session.inputs()[0].dtype() else {
        return Err("input 0 is not a tensor".into());
    };
    if *ty != TensorElementType::Float32 {
        return Err(format!("input 0 is {ty:?}, and this program can only make f32").into());
    }
    let dims = shape
        .iter()
        .enumerate()
        .map(|(i, d)| {
            if *d >= 0 {
                *d
            } else if i == 0 {
                batch
            } else {
                frames
            }
        })
        .collect();
    Ok((name, dims))
}

struct Mereni {
    prumer: f64,
    median: f64,
    nej: f64,
    nejhorsi: f64,
}

fn measure(
    session: &mut Session,
    name: &str,
    dims: &[i64],
    runs: usize,
    hlasite: bool,
) -> Result<Mereni, Box<dyn Error>> {
    let count: usize = dims.iter().product::<i64>() as usize;
    // Something that at least resembles speech in range. What goes into the
    // matrices does not change the speed of the multiplication, but all zeroes
    // can be short-circuited by some optimisations.
    let data: Vec<f32> = (0..count)
        .map(|i| ((i % 97) as f32 - 48.0) / 48.0)
        .collect();

    let mut times = Vec::with_capacity(runs);
    for n in 0..=runs {
        let tensor = TensorRef::from_array_view((dims.to_vec(), data.as_slice()))?;
        let start = Instant::now();
        let outputs = session.run(ort::inputs![name => tensor])?;
        let took = start.elapsed();

        if n == 0 {
            // The first run carries waking the driver and compiling the graph,
            // so it stays out of the average — under DirectML it tends to be an
            // order of magnitude longer than the rest.
            let (s, d) = outputs[0].try_extract_tensor::<f32>()?;
            if hlasite {
                println!(
                    "warm-up run, driver start included: {:.1} ms, output {:?}, {} numbers",
                    took.as_secs_f64() * 1e3,
                    &**s,
                    d.len()
                );
            }
        } else {
            times.push(took);
        }
    }

    times.sort_unstable();
    Ok(Mereni {
        prumer: times.iter().sum::<std::time::Duration>().as_secs_f64() / times.len() as f64,
        median: times[times.len() / 2].as_secs_f64(),
        nej: times[0].as_secs_f64(),
        nejhorsi: times[times.len() - 1].as_secs_f64(),
    })
}

fn popis(o: &Outlet) -> String {
    match o.dtype() {
        ValueType::Tensor {
            ty,
            shape,
            dimension_symbols,
        } => {
            let dims: Vec<String> = shape
                .iter()
                .zip(dimension_symbols.iter())
                .map(|(d, sym)| {
                    if *d >= 0 {
                        d.to_string()
                    } else if !sym.is_empty() {
                        format!("{sym}=?")
                    } else {
                        "?".to_owned()
                    }
                })
                .collect();
            format!("tensor<{ty:?}>[{}]", dims.join(", "))
        }
        other => format!("{other:?}"),
    }
}
