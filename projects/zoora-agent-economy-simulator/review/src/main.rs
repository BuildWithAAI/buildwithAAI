use std::{
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    time::Instant,
};
use zoora_review_market::{ReviewConfig, ReviewEngine, ReviewReport};
fn read(path: &Path, limit: u64) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "input cannot be inspected")?;
    if !meta.is_file() || meta.len() > limit {
        return Err("input must be a bounded regular file".into());
    }
    let file = fs::File::open(path).map_err(|_| "input cannot be opened")?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "input cannot be read")?;
    if bytes.len() as u64 > limit {
        return Err("input exceeds size limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "input is not UTF-8".into())
}
fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 128 * 1024 * 1024 {
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
        .map_err(|_| "output must be a new writable file")?;
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        return Err("output write failed; discard incomplete file".into());
    }
    Ok(())
}
fn execute() -> Result<(), String> {
    let args: Vec<_> = env::args().skip(1).collect();
    let result = match args.as_slice() {
        [mode, config, output] if mode == "run" => {
            let config = ReviewConfig::from_toml(&read(Path::new(config), 4 * 1024 * 1024)?).map_err(|e| e.to_string())?;
            let mut engine = ReviewEngine::new(config).map_err(|e| e.to_string())?;
            engine.run_scenario().map_err(|e| e.to_string())?;
            let report = ReviewReport::from_engine(&engine).map_err(|e| e.to_string())?;
            report.verify().map_err(|e| e.to_string())?;
            write(Path::new(output), &serde_json::to_vec_pretty(&report).map_err(|_| "review report encoding failed")?)?;
            format!("SYNTHETIC review market verified: {}", report.fingerprint)
        },
        [mode, input] if mode == "replay" => {
            let report: ReviewReport = serde_json::from_str(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|_| "invalid review report")?;
            report.verify().map_err(|e| e.to_string())?;
            format!("SYNTHETIC review replay verified: {}", report.fingerprint)
        },
        [mode, output] if mode == "benchmark" => {
            let mut results = Vec::new();
            for agents in [100, 1000, 10000] {
                let config = ReviewConfig {market: zoora_task_market::MarketConfig {agent_count: agents, starting_balance: 100_000, ticks: 10, max_tasks: 5000, max_active_tasks_per_worker: 5000, scenario_tasks: 5000, ..zoora_task_market::MarketConfig::default()}, operators: (0..agents as u64).collect(), ..ReviewConfig::default()};
                let start = Instant::now();
                let mut engine = ReviewEngine::new(config).map_err(|e| e.to_string())?;
                engine.run_scenario().map_err(|e| e.to_string())?;
                let run_microseconds = start.elapsed().as_micros().to_string();
                let report = ReviewReport::from_engine(&engine).map_err(|e| e.to_string())?;
                let start = Instant::now(); report.verify().map_err(|e| e.to_string())?;
                results.push(serde_json::json!({"classification":"SYNTHETIC", "agents": agents, "tasks": report.cases.len(), "review_events": report.journal.len(), "market_events": report.market.journal.len(), "run_microseconds": run_microseconds, "verify_microseconds": start.elapsed().as_micros().to_string(), "review_metrics": report.metrics, "market_metrics": report.market.metrics, "fingerprint": report.fingerprint}));
            }
            write(Path::new(output), &serde_json::to_vec_pretty(&results).map_err(|_| "benchmark encoding failed")?)?;
            "SYNTHETIC review scaling verified".into()
        },
        _ => return Err("usage: zoora-review-market run CONFIG.toml NEW_REPORT.json | replay REPORT.json | benchmark NEW_RESULTS.json".into()),
    }; println!("{result}"); Ok(())
}
fn main() {if let Err(message) = execute() {eprintln!("{message}"); std::process::exit(1);}}
