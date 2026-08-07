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
            "--runs" => runs = args.next().ok_or("--runs chce číslo")?.parse()?,
            "--frames" => frames = args.next().ok_or("--frames chce číslo")?.parse()?,
            "--batch" => batch = args.next().ok_or("--batch chce číslo")?.parse()?,
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

    if sweep {
        return projed(&model_path, runs, frames);
    }

    println!("režim: {}\n", if want_dml { "DirectML" } else { "procesor" });
    let mut session = sezeni(&model_path, want_dml)?;

    println!("\n-- vstupy --");
    for (i, o) in session.inputs().iter().enumerate() {
        println!("  [{i}] {:<28} {}", o.name(), popis(o));
    }
    println!("-- výstupy --");
    for (i, o) in session.outputs().iter().enumerate() {
        println!("  [{i}] {:<28} {}", o.name(), popis(o));
    }

    let (jmeno, dims) = tvar_vstupu(&session, batch, frames)?;
    println!(
        "\nkrmím `{jmeno}` tvarem {dims:?}, tedy {} čísel",
        dims.iter().product::<i64>()
    );

    if runs == 0 {
        return Ok(());
    }
    let m = zmer(&mut session, &jmeno, &dims, runs, true)?;
    println!(
        "\n{} běhů: průměr {:.2} ms | medián {:.2} ms | nejrychlejší {:.2} ms | nejpomalejší {:.2} ms",
        runs,
        m.prumer * 1e3,
        m.median * 1e3,
        m.nej * 1e3,
        m.nejhorsi * 1e3
    );
    Ok(())
}

/// Kolik úseků najednou. Jeden je to, co dělá sherpa dnes; šedesát čtyři je to,
/// co by grafická karta chtěla.
const DAVKY: [i64; 5] = [1, 4, 16, 64, 256];

/// Obě cesty, několik velikostí dávky, jedna tabulka. Zajímavý není žádný
/// jednotlivý řádek, ale to, jak se ty dva sloupce od sebe vzdalují.
fn projed(model: &Path, runs: usize, frames: i64) -> Result<(), Box<dyn Error>> {
    println!("\nvteřin zvuku na úsek: {:.1}", frames as f64 / 100.0);
    println!(
        "\n{:>7}  {:>12}  {:>12}  {:>9}  {:>14}",
        "dávka", "DirectML", "procesor", "poměr", "DML na úsek"
    );
    println!("{}", "-".repeat(62));

    // Sezení vzniká jednou pro každou cestu; překlad grafu je drahý a do měření
    // dávek nepatří.
    let mut dml = match sezeni(model, true) {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("DirectML sezení nevzniklo: {e}");
            None
        }
    };
    let mut cpu = sezeni(model, false)?;

    for davka in DAVKY {
        let (jmeno, dims) = tvar_vstupu(&cpu, davka, frames)?;

        let t_cpu = zmer(&mut cpu, &jmeno, &dims, runs, false)?.median;
        let t_dml = match dml.as_mut() {
            Some(s) => zmer(s, &jmeno, &dims, runs, false)?.median,
            None => f64::NAN,
        };

        println!(
            "{davka:>7}  {:>10.2} ms  {:>10.2} ms  {:>8.2}x  {:>11.3} ms",
            t_dml * 1e3,
            t_cpu * 1e3,
            t_cpu / t_dml,
            t_dml * 1e3 / davka as f64
        );
    }

    println!(
        "\nPoslední sloupec je to, na čem záleží: kolik stojí jeden úsek, když\n\
         se jich posílá víc najednou. Když s rostoucí dávkou klesá, karta se\n\
         nudila a stačí ji krmit po větších soustech."
    );
    Ok(())
}

fn sezeni(model: &Path, want_dml: bool) -> Result<Session, Box<dyn Error>> {
    let mut providers = Vec::new();

    #[cfg(windows)]
    if want_dml {
        use ort::ep::DirectML;
        providers.push(DirectML::default().build());
    }
    #[cfg(not(windows))]
    if want_dml {
        eprintln!("nejsme na Windows, DirectML není; poběží procesor");
    }

    // Poslední v řadě. Když se DirectML nezaregistruje, ONNX Runtime tiše
    // propadne sem — proto se na hlášky nedá spolehnout a měří se čas.
    providers.push(CPU::default().build());

    let mut builder = Session::builder()?.with_optimization_level(GraphOptimizationLevel::Level3)?;
    if want_dml {
        // Není to ladění, ale podmínka: DirectML odmítne vzniknout, pokud je
        // zapnutá optimalizace paměťových vzorů, a ta je ve výchozím stavu
        // zapnutá. Bez tohohle řádku sezení rovnou skončí chybou.
        builder = builder.with_memory_pattern(false)?;
    }
    Ok(builder
        .with_execution_providers(providers)?
        .commit_from_file(model)?)
}

/// Jméno prvního vstupu a tvar, kterým se dá nakrmit. Neznámý rozměr je -1;
/// nultý je dávka, každý další je počet rámců.
fn tvar_vstupu(
    session: &Session,
    batch: i64,
    frames: i64,
) -> Result<(String, Vec<i64>), Box<dyn Error>> {
    let jmeno = session.inputs()[0].name().to_owned();
    let ValueType::Tensor { ty, shape, .. } = session.inputs()[0].dtype() else {
        return Err("vstup 0 není tenzor".into());
    };
    if *ty != TensorElementType::Float32 {
        return Err(format!("vstup 0 je {ty:?}, tenhle program umí vyrobit jen f32").into());
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
    Ok((jmeno, dims))
}

struct Mereni {
    prumer: f64,
    median: f64,
    nej: f64,
    nejhorsi: f64,
}

fn zmer(
    session: &mut Session,
    jmeno: &str,
    dims: &[i64],
    runs: usize,
    hlasite: bool,
) -> Result<Mereni, Box<dyn Error>> {
    let count: usize = dims.iter().product::<i64>() as usize;
    // Něco, co vypadá jako řeč aspoň rozsahem. Na rychlosti násobení nezáleží,
    // co se do matic nasype, ale samé nuly umí některé optimalizace zkratkovat.
    let data: Vec<f32> = (0..count)
        .map(|i| ((i % 97) as f32 - 48.0) / 48.0)
        .collect();

    let mut times = Vec::with_capacity(runs);
    for n in 0..=runs {
        let tensor = TensorRef::from_array_view((dims.to_vec(), data.as_slice()))?;
        let start = Instant::now();
        let outputs = session.run(ort::inputs![jmeno => tensor])?;
        let took = start.elapsed();

        if n == 0 {
            // První běh nese probuzení ovladače a překlad grafu, takže do
            // průměru nepatří — u DirectML bývá řádově delší než ty další.
            let (s, d) = outputs[0].try_extract_tensor::<f32>()?;
            if hlasite {
                println!(
                    "zahřívací běh (v něm je i start ovladače): {:.1} ms, výstup {:?}, {} čísel",
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
