#![forbid(unsafe_code)]
use serde::Serialize;
use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Instant,
};
use zoora_agent_economy_simulator::{RunReport, SimulationConfig, SimulationEngine};

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_REPORT_BYTES: u64 = 64 * 1024 * 1024;
const USAGE: &str = "Zoora offline simulator (SYNTHETIC simulated units)\n  run --config CONFIG.toml --output REPORT.json\n  replay --input REPORT.json\n  benchmark --output SCALING.json\n  --help\nOutputs must be new files. No wallets, transactions, or network operations.";

fn bounded_read(path: &Path, limit: u64) -> Result<String, String> {
    let info = fs::symlink_metadata(path).map_err(|_| "cannot inspect input file")?;
    if !info.is_file() || info.file_type().is_symlink() {
        return Err("input must be a regular file, not a symbolic link".into());
    }
    if info.len() > limit {
        return Err("input exceeds size limit".into());
    }
    let file = File::open(path).map_err(|_| "cannot open input file")?;
    if !file
        .metadata()
        .map_err(|_| "cannot inspect opened input")?
        .is_file()
    {
        return Err("opened input is not a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "cannot read input file")?;
    if bytes.len() as u64 > limit {
        return Err("input exceeds size limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "input must be UTF-8".into())
}

fn write_new<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    // Serialize before creating any output; create_new also refuses existing symlinks.
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|_| "cannot serialize output")?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        return Err("output exceeds size limit".into());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "cannot create output; use a new file in an existing directory")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "cannot finish output; partial file must be removed before retrying")?;
    Ok(())
}

fn option(args: &[String], name: &str) -> Result<PathBuf, String> {
    let mut value = None;
    for pair in args.as_chunks::<2>().0 {
        if pair[0] == name {
            if value.is_some() || pair[1].starts_with("--") {
                return Err("duplicate or missing option value".into());
            }
            value = Some(PathBuf::from(&pair[1]));
        }
    }
    value.ok_or_else(|| format!("required option: {name}"))
}
fn validate_options(args: &[String], allowed: &[&str]) -> Result<(), String> {
    if !args.len().is_multiple_of(2) {
        return Err("options require values".into());
    }
    for pair in args.as_chunks::<2>().0 {
        if !allowed.contains(&pair[0].as_str()) {
            return Err("unknown option".into());
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct ScalingCase {
    agent_count: usize,
    ticks: u64,
    seed: u64,
    elapsed_microseconds: String,
    completed_transfers: u64,
    rejected_transfers: u64,
    conservation_passed: bool,
    replay_verified: bool,
    run_hash: String,
}
#[derive(Serialize)]
struct ScalingReport {
    schema_version: u32,
    kind: &'static str,
    data_classification: &'static str,
    simulator_version: &'static str,
    timing_note: &'static str,
    cases: Vec<ScalingCase>,
}

fn execute(args: Vec<String>) -> Result<(), String> {
    if args == ["--help"] || args == ["-h"] {
        println!("{USAGE}");
        return Ok(());
    }
    let (command, options) = args.split_first().ok_or(USAGE)?;
    match command.as_str() {
        "run" => {
            validate_options(options, &["--config", "--output"])?;
            let config_path = option(options, "--config")?;
            let output_path = option(options, "--output")?;
            let config =
                SimulationConfig::from_toml(&bounded_read(&config_path, MAX_CONFIG_BYTES)?)
                    .map_err(|error| error.to_string())?;
            let mut engine =
                SimulationEngine::try_new(config).map_err(|error| error.to_string())?;
            engine.run().map_err(|error| error.to_string())?;
            let report = RunReport::from_engine(&engine).map_err(|error| error.to_string())?;
            write_new(&output_path, &report)?;
            println!(
                "SYNTHETIC run: {} completed, {} rejected; conserved={}\nrun_hash={}",
                report.summary.completed_transfers,
                report.summary.rejected_transfers,
                report.summary.conservation_passed,
                report.fingerprint.run_hash
            );
        }
        "replay" => {
            validate_options(options, &["--input"])?;
            let input = option(options, "--input")?;
            let report: RunReport = serde_json::from_str(&bounded_read(&input, MAX_REPORT_BYTES)?)
                .map_err(|_| "invalid JSON report")?;
            report.verify().map_err(|error| error.to_string())?;
            println!(
                "VERIFIED SYNTHETIC replay: {} requests; run_hash={}",
                report.summary.processed_requests, report.fingerprint.run_hash
            );
        }
        "benchmark" => {
            validate_options(options, &["--output"])?;
            let output = option(options, "--output")?;
            let mut cases = Vec::new();
            for count in [100, 1_000, 10_000] {
                let config = SimulationConfig {
                    agent_count: count,
                    starting_balance: 100,
                    ticks: 10_000,
                    seed: 42,
                };
                let mut engine =
                    SimulationEngine::try_new(config.clone()).map_err(|error| error.to_string())?;
                let start = Instant::now();
                engine.run().map_err(|error| error.to_string())?;
                let elapsed = start.elapsed().as_micros().to_string();
                let report = RunReport::from_engine(&engine).map_err(|error| error.to_string())?;
                report.verify().map_err(|error| error.to_string())?;
                cases.push(ScalingCase {
                    agent_count: count,
                    ticks: config.ticks,
                    seed: config.seed,
                    elapsed_microseconds: elapsed,
                    completed_transfers: report.summary.completed_transfers,
                    rejected_transfers: report.summary.rejected_transfers,
                    conservation_passed: report.summary.conservation_passed,
                    replay_verified: true,
                    run_hash: report.fingerprint.run_hash,
                });
            }
            write_new(&output, &ScalingReport {
                schema_version: 1, kind: "MEASURED_OFFLINE_SCALING", data_classification: "SYNTHETIC", simulator_version: env!("CARGO_PKG_VERSION"),
                timing_note: "Wall-clock measurements cover engine.run including its audit; exclude setup, report creation, and replay. Hardware/build dependent; not a throughput guarantee. Timings are excluded from run fingerprints.", cases,
            })?;
            println!("Measured 3 SYNTHETIC scaling cases; conservation and replay passed");
        }
        _ => return Err("unknown command; use --help".into()),
    }
    Ok(())
}
fn main() {
    if let Err(error) = execute(env::args().skip(1).collect()) {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
