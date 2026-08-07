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

use std::{env, error::Error, path::PathBuf, time::Instant};

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
    let mut want_dml = true;

    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--cpu" => want_dml = false,
            "--dml" => want_dml = true,
            "--runs" => runs = args.next().ok_or("--runs chce číslo")?.parse()?,
            "--frames" => frames = args.next().ok_or("--frames chce číslo")?.parse()?,
            other => model_path = Some(PathBuf::from(other)),
        }
    }

    let model_path = model_path
        .or_else(default_model)
        .ok_or("model nenalezen; předej cestu k .onnx jako argument")?;
    if !model_path.exists() {
        return Err(format!(
            "{} neexistuje — stáhni model v Nastavení, nebo předej cestu jako argument",
            model_path.display()
        )
        .into());
    }
    println!("model: {}", model_path.display());
    println!("režim: {}\n", if want_dml { "DirectML" } else { "procesor" });

    // ---------------------------------------------------------------- providery
    let mut providers = Vec::new();
    let mut dml_requested = false;

    #[cfg(windows)]
    if want_dml {
        use ort::ep::{DirectML, ExecutionProvider};
        let dml = DirectML::default();
        // Pozor: tohle říká jen to, jestli je DirectML zakompilované, ne jestli
        // se na téhle mašině povede spustit. Skutečnou odpověď dají až časy dole.
        println!("DirectML je v tomhle buildu ONNX Runtime: {:?}", dml.is_available());
        providers.push(dml.build());
        dml_requested = true;
    }
    #[cfg(not(windows))]
    if want_dml {
        eprintln!("nejsme na Windows, DirectML není; poběží procesor");
    }

    // Poslední v řadě. Když se DirectML nezaregistruje, ONNX Runtime tiše
    // propadne sem — proto se na hlášky nedá spolehnout a měří se čas.
    providers.push(CPU::default().build());

    // ---------------------------------------------------------------- sezení
    let mut builder = Session::builder()?.with_optimization_level(GraphOptimizationLevel::Level3)?;
    if dml_requested {
        // Není to ladění, ale podmínka: DirectML odmítne vzniknout, pokud je
        // zapnutá optimalizace paměťových vzorů, a ta je ve výchozím stavu
        // zapnutá. Bez tohohle řádku sezení rovnou skončí chybou.
        builder = builder.with_memory_pattern(false)?;
    }
    let mut session = builder
        .with_execution_providers(providers)?
        .commit_from_file(&model_path)?;

    println!("\n-- vstupy --");
    for (i, o) in session.inputs().iter().enumerate() {
        println!("  [{i}] {:<28} {}", o.name(), popis(o));
    }
    println!("-- výstupy --");
    for (i, o) in session.outputs().iter().enumerate() {
        println!("  [{i}] {:<28} {}", o.name(), popis(o));
    }

    // ---------------------------------------------------------------- vstup
    let input_name = session.inputs()[0].name().to_owned();
    let ValueType::Tensor { ty, shape, .. } = session.inputs()[0].dtype() else {
        return Err("vstup 0 není tenzor".into());
    };
    if *ty != TensorElementType::Float32 {
        return Err(format!("vstup 0 je {ty:?}, tenhle program umí vyrobit jen f32").into());
    }

    // Neznámý rozměr je -1. Nultý je dávka, ta je jedna; každý další neznámý
    // je počet rámců.
    let dims: Vec<i64> = shape
        .iter()
        .enumerate()
        .map(|(i, d)| {
            if *d >= 0 {
                *d
            } else if i == 0 {
                1
            } else {
                frames
            }
        })
        .collect();
    let count: usize = dims.iter().product::<i64>() as usize;
    println!("\nkrmím `{input_name}` tvarem {dims:?}, tedy {count} čísel");

    // Něco, co vypadá jako řeč aspoň rozsahem. Na rychlosti násobení nezáleží,
    // co se do matic nasype, ale samé nuly umí některé optimalizace zkratkovat.
    let data: Vec<f32> = (0..count)
        .map(|i| ((i % 97) as f32 - 48.0) / 48.0)
        .collect();

    // ---------------------------------------------------------------- měření
    if runs == 0 {
        return Ok(());
    }
    let mut out_shape: Vec<i64> = Vec::new();
    let mut times = Vec::with_capacity(runs);

    for n in 0..=runs {
        let tensor = TensorRef::from_array_view((dims.clone(), data.as_slice()))?;
        let start = Instant::now();
        let outputs = session.run(ort::inputs![input_name.as_str() => tensor])?;
        let took = start.elapsed();

        if n == 0 {
            // První běh nese s sebou probuzení ovladače a překlad grafu, takže
            // do průměru nepatří — ale stojí za vypsání, protože u DirectML
            // bývá řádově delší než ty další.
            let (s, d) = outputs[0].try_extract_tensor::<f32>()?;
            out_shape = s.to_vec();
            println!(
                "zahřívací běh (v něm je i start ovladače): {:.1} ms, výstup {} čísel",
                took.as_secs_f64() * 1e3,
                d.len()
            );
        } else {
            times.push(took);
        }
    }

    times.sort_unstable();
    let mean = times.iter().sum::<std::time::Duration>().as_secs_f64() / times.len() as f64;

    println!("\nvýstup {out_shape:?}");
    println!(
        "{} běhů: průměr {:.2} ms | medián {:.2} ms | nejrychlejší {:.2} ms | nejpomalejší {:.2} ms",
        times.len(),
        mean * 1e3,
        times[times.len() / 2].as_secs_f64() * 1e3,
        times[0].as_secs_f64() * 1e3,
        times[times.len() - 1].as_secs_f64() * 1e3
    );
    Ok(())
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
