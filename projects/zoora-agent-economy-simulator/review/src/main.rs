use std::{
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    time::Instant,
};
use zoora_review_market::{
    allocation::AllocationReport,
    community::CommunityReport,
    community_export,
    community_scenarios::{
        BatchConfig, BatchReport, RunReport, Scenario as CommunityScenario, WorkloadConfig,
    },
    direct::DirectReport,
    economy::{AdmissionPolicy, EconomyCampaign, EconomyConfig, EconomyRun, StressScenario},
    economy_export,
    experiments::{ExperimentConfig, ExperimentSuite},
    viewer, ReviewConfig, ReviewEngine, ReviewReport,
};
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
        [mode, config, output] if mode == "economy-campaign" => {
            let config = EconomyConfig::from_toml(&read(Path::new(config), 4 * 1024 * 1024)?).map_err(|e| e.to_string())?;
            let report = EconomyCampaign::generate(config).map_err(|e| e.to_string())?;
            report.verify().map_err(|e| e.to_string())?;
            write(Path::new(output), &serde_json::to_vec_pretty(&report).map_err(|_| "economy campaign encoding failed")?)?;
            format!("SYNTHETIC economy campaign: {} matched runs verified; {}", report.runs.len(), report.fingerprint)
        },
        [mode, config, seed, scenario, policy, output] if mode == "economy-run" => {
            let config = EconomyConfig::from_toml(&read(Path::new(config), 4 * 1024 * 1024)?).map_err(|e| e.to_string())?;
            let seed = seed.parse::<u64>().map_err(|_| "seed must be an unsigned integer")?;
            let scenario = StressScenario::parse(scenario).ok_or("unknown economy scenario")?;
            let policy = AdmissionPolicy::parse(policy).ok_or("unknown admission policy")?;
            let report = EconomyRun::generate(config, seed, scenario, policy).map_err(|e| e.to_string())?;
            report.verify().map_err(|e| e.to_string())?;
            write(Path::new(output), &serde_json::to_vec_pretty(&report).map_err(|_| "economy run encoding failed")?)?;
            format!("SYNTHETIC economy run and ledger verified: {}", report.fingerprint)
        },
        [mode, input] if mode == "replay-economy" => {
            let report: EconomyRun = serde_json::from_str(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|_| "invalid economy run")?;
            report.verify().map_err(|e| e.to_string())?;
            "SYNTHETIC economy run regenerated; balances, fees, admissions and community verified".into()
        },
        [mode, input] if mode == "replay-economy-campaign" => {
            let report: EconomyCampaign = serde_json::from_str(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|_| "invalid economy campaign")?;
            report.verify().map_err(|e| e.to_string())?;
            "SYNTHETIC economy campaign regenerated and verified".into()
        },
        [mode, input, output] if mode == "economy-csv" || mode == "economy-viewer" => {
            let report: EconomyCampaign = serde_json::from_str(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|_| "invalid economy campaign")?;
            let content = if mode == "economy-csv" { economy_export::csv(&report) } else { economy_export::html(&report) }.map_err(|e| e.to_string())?;
            write(Path::new(output), content.as_bytes())?;
            "SYNTHETIC economy export created after campaign regeneration".into()
        },
        [mode, config, scenario, output] if mode == "community-run" => {
            let config = WorkloadConfig::from_toml(&read(Path::new(config), 4 * 1024 * 1024)?).map_err(|e|e.to_string())?;
            let scenario=match scenario.as_str(){"BALANCED"=>CommunityScenario::Balanced,"SPAM_RESERVATIONS"=>CommunityScenario::SpamReservations,"PROVIDER_OFFLINE"=>CommunityScenario::ProviderOffline,_=>return Err("unknown community scenario".into())};
            let report=RunReport::generate(config,scenario).map_err(|e|e.to_string())?;report.verify().map_err(|e|e.to_string())?;
            write(Path::new(output),&serde_json::to_vec_pretty(&report).map_err(|_|"community report encoding failed")?)?;
            format!("SYNTHETIC scripted community run verified: {}",report.fingerprint)
        },
        [mode, config, output] if mode == "community-batch" => {
            let config=BatchConfig::from_toml(&read(Path::new(config),4*1024*1024)?).map_err(|e|e.to_string())?;
            let report=BatchReport::generate(config).map_err(|e|e.to_string())?;report.verify().map_err(|e|e.to_string())?;
            write(Path::new(output),&serde_json::to_vec_pretty(&report).map_err(|_|"community batch encoding failed")?)?;
            format!("SYNTHETIC community batch verified: {}",report.fingerprint)
        },
        [mode,input] if mode=="replay-community" => {
            let text=read(Path::new(input),128*1024*1024)?;
            let identity:serde_json::Value=serde_json::from_str(&text).map_err(|_|"invalid community report")?;
            match identity.get("model").and_then(|v|v.as_str()){
                Some("zoora-community-run/0.1.0")=>{let report:RunReport=serde_json::from_str(&text).map_err(|_|"invalid scripted community report")?;report.verify().map_err(|e|e.to_string())?;},
                Some("zoora-agent-community/0.1.0")=>{let report:CommunityReport=serde_json::from_str(&text).map_err(|_|"invalid community report")?;report.verify().map_err(|e|e.to_string())?;},
                _=>return Err("unsupported community replay identity".into()),
            }
            "SYNTHETIC community replay verified; no identity or chain authentication".into()
        },
        [mode,input] if mode=="replay-community-batch" => {
            let report:BatchReport=serde_json::from_str(&read(Path::new(input),128*1024*1024)?).map_err(|_|"invalid community batch")?;
            report.verify().map_err(|e|e.to_string())?;"SYNTHETIC community batch regenerated and verified".into()
        },
        [mode,input,output] if mode=="community-csv" => {
            let csv=community_export::csv(&read(Path::new(input),128*1024*1024)?).map_err(|e|e.to_string())?;
            write(Path::new(output),csv.as_bytes())?;"SYNTHETIC community CSV exported from verified report".into()
        },
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
        [mode, config, output] if mode == "experiments" => {
            let config = ExperimentConfig::from_toml(&read(Path::new(config), 4 * 1024 * 1024)?).map_err(|e| e.to_string())?;
            let report = ExperimentSuite::generate(config).map_err(|e| e.to_string())?;
            report.verify().map_err(|e| e.to_string())?;
            write(Path::new(output), &serde_json::to_vec_pretty(&report).map_err(|_| "experiment encoding failed")?)?;
            format!("SYNTHETIC matched experiments verified: {}", report.fingerprint)
        },
        [mode, input] if mode == "replay-experiments" => {
            let report: ExperimentSuite = serde_json::from_str(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|_| "invalid experiment report")?;
            report.verify().map_err(|e| e.to_string())?;
            format!("SYNTHETIC experiment replay verified: {}", report.fingerprint)
        },
        [mode, input] if mode == "replay-allocated" => {
            let report: AllocationReport = serde_json::from_str(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|_| "invalid allocation report")?;
            report.verify().map_err(|e| e.to_string())?;
            format!("SYNTHETIC allocation replay verified: {}", report.fingerprint)
        },
        [mode, output] if mode == "benchmark-allocated" => {
            let mut results = Vec::new();
            for agents in [100, 1000, 10000] {
                let config = ReviewConfig { market: zoora_task_market::MarketConfig { agent_count: agents, starting_balance: 1_000_000,
                    ticks: 10, max_tasks: 5000, max_active_tasks_per_worker: 5000, scenario_tasks: 0, ..zoora_task_market::MarketConfig::default() },
                    operators: (0..agents as u64).collect(), ..ReviewConfig::default() };
                let policy = zoora_review_market::allocation::AllocationConfig { reviewer_accounts: (2..agents as u64).collect(), max_active_per_operator: 5000 };
                let workload: Vec<_> = (0..5000).map(|task_id| zoora_review_market::experiments::Intent { task_id, client: 0, worker: 1,
                    missing_review: false, verdict: zoora_review_market::Verdict::Approve, appeal: false, missing_appeal: false,
                    appeal_verdict: zoora_review_market::Verdict::Approve, injected_attacks: false }).collect();
                let start = Instant::now(); let mut engine = ReviewEngine::with_allocation(config, policy).map_err(|e| e.to_string())?;
                zoora_review_market::experiments::run_workload(&mut engine, &workload).map_err(|e| e.to_string())?;
                let run_microseconds = start.elapsed().as_micros().to_string(); let report = AllocationReport::from_engine(&engine).map_err(|e| e.to_string())?;
                let start = Instant::now(); report.verify().map_err(|e| e.to_string())?;
                results.push(serde_json::json!({"classification":"SYNTHETIC", "agents":agents, "tasks":report.review.cases.len(),
                    "review_events":report.review.journal.len(), "allocation_events":report.allocation_journal.len(), "run_microseconds":run_microseconds,
                    "verify_microseconds":start.elapsed().as_micros().to_string(), "fingerprint":report.fingerprint, "metrics":report.metrics, "market_metrics":report.review.market.metrics}));
            }
            write(Path::new(output), &serde_json::to_vec_pretty(&results).map_err(|_| "allocation benchmark encoding failed")?)?;
            "SYNTHETIC allocation scaling verified".into()
        },
        [mode, output] if mode == "direct-demo" => {
            let report = DirectReport::demo().map_err(|e| e.to_string())?;
            report.verify().map_err(|e| e.to_string())?;
            write(Path::new(output), &serde_json::to_vec_pretty(&report).map_err(|_| "direct report encoding failed")?)?;
            format!("SYNTHETIC direct workflow verified; no chain verification: {}", report.fingerprint)
        },
        [mode, input] if mode == "replay-direct" => {
            let report: DirectReport = serde_json::from_str(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|_| "invalid direct report")?;
            report.verify().map_err(|e| e.to_string())?;
            format!("SYNTHETIC direct replay verified; no chain verification: {}", report.fingerprint)
        },
        [mode, input, output] if mode == "viewer" => {
            let html = viewer::export(&read(Path::new(input), 128 * 1024 * 1024)?).map_err(|e| e.to_string())?;
            write(Path::new(output), html.as_bytes())?;
            "SYNTHETIC viewer exported after full replay verification".into()
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
        _ => return Err("usage: zoora-review-market run CONFIG.toml NEW_REPORT.json | replay REPORT.json | benchmark NEW_RESULTS.json | experiments CONFIG.toml NEW_SUITE.json | replay-experiments SUITE.json | replay-allocated REPORT.json | benchmark-allocated NEW_RESULTS.json | direct-demo NEW_DIRECT.json | replay-direct DIRECT.json | community-run CONFIG.toml SCENARIO NEW_REPORT.json | community-batch CONFIG.toml NEW_BATCH.json | replay-community REPORT.json | replay-community-batch BATCH.json | community-csv REPORT.json NEW_DATA.csv | viewer REPORT.json NEW_VIEWER.html | economy-campaign CONFIG.toml NEW_CAMPAIGN.json | economy-run CONFIG.toml SEED SCENARIO POLICY NEW_RUN.json | replay-economy RUN.json | replay-economy-campaign CAMPAIGN.json | economy-csv CAMPAIGN.json NEW_DATA.csv | economy-viewer CAMPAIGN.json NEW_VIEWER.html".into()),
    };
    println!("{result}");
    Ok(())
}
fn main() {
    if let Err(message) = execute() {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
