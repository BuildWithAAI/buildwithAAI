//! Matched synthetic workloads. Injected attack intents are labels, not wallet accusations.
use crate::{allocation::{fingerprint, AllocationConfig, AllocationReport}, types::*, ReviewConfig, ReviewEngine, ReviewReport};
use serde::{Deserialize, Serialize};
use zoora_agent_economy_simulator::{DeterministicRng, SimulationError, RNG_ALGORITHM};
use zoora_task_market::MarketConfig;
type Result<T> = std::result::Result<T, SimulationError>;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentConfig { pub seed: u64, pub tasks: usize }
impl ExperimentConfig {
    pub fn validate(&self) -> Result<()> {
        if self.tasks == 0 || self.tasks > 500 { return Err(SimulationError::Configuration("experiment tasks must be 1..=500")); }
        Ok(())
    }
    pub fn from_toml(text: &str) -> Result<Self> {
        let config: Self = toml::from_str(text).map_err(|_| SimulationError::Configuration("invalid experiment TOML"))?;
        config.validate()?; Ok(config)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Intent {
    pub task_id: u64,
    pub client: u64,
    pub worker: u64,
    pub missing_review: bool,
    pub verdict: Verdict,
    pub appeal: bool,
    pub missing_appeal: bool,
    pub appeal_verdict: Verdict,
    pub injected_attacks: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Experiment {
    pub name: String,
    pub description: String,
    pub workload_fingerprint: String,
    #[serde(deserialize_with = "bounded_intents")]
    pub intents: Vec<Intent>,
    pub baseline: ReviewReport,
    pub allocated: AllocationReport,
}
fn bounded_intents<'de, D: serde::de::Deserializer<'de>>(d: D) -> std::result::Result<Vec<Intent>, D::Error> {
    crate::bounded::vec::<D, Intent, 524>(d)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentSuite {
    pub schema_version: u32,
    pub model: String,
    pub classification: String,
    pub rng: String,
    pub config: ExperimentConfig,
    #[serde(deserialize_with = "bounded_experiments")]
    pub experiments: Vec<Experiment>,
    pub fingerprint: String,
}
fn bounded_experiments<'de, D: serde::de::Deserializer<'de>>(d: D) -> std::result::Result<Vec<Experiment>, D::Error> {
    crate::bounded::vec::<D, Experiment, 5>(d)
}
fn sample(rng: &mut DeterministicRng, bps: u64) -> bool { rng.below(10000).unwrap_or(10000) < bps }
fn intents(config: &ExperimentConfig, attacks: bool, spam: bool) -> Vec<Intent> {
    let mut rng = DeterministicRng::from_seed(config.seed);
    let extra = if spam { 24 } else { 0 };
    let mut result = Vec::new();
    for id in 0..extra { result.push(Intent { task_id: id, client: 0, worker: 1, missing_review: true,
        verdict: Verdict::Approve, appeal: false, missing_appeal: false, appeal_verdict: Verdict::Approve, injected_attacks: false }); }
    for n in 0..config.tasks as u64 {
        let verdict = if sample(&mut rng, 2500) { Verdict::Refund } else { Verdict::Approve };
        result.push(Intent { task_id: n + extra, client: 0, worker: 1,
            missing_review: sample(&mut rng, 1000), verdict, appeal: sample(&mut rng, 3500),
            missing_appeal: sample(&mut rng, 1500), appeal_verdict: if sample(&mut rng, 5000) { verdict.flipped() } else { verdict },
            injected_attacks: attacks });
    }
    result
}
fn decision(id: u64, reviewer: u64, verdict: Verdict, appeal: bool) -> Command {
    if appeal { Command::AppealDecision { task_id: id, reviewer, verdict, artifact_digest: "a".repeat(64),
        criteria_digest: "c".repeat(64), reason_digest: "b".repeat(64) } }
    else { Command::Review { task_id: id, reviewer, verdict, artifact_digest: "a".repeat(64),
        criteria_digest: "c".repeat(64), reason_digest: "e".repeat(64) } }
}
/// Run common intentions with each policy's actual selected reviewers. Missing assignments do not fabricate decisions.
pub fn run_workload(engine: &mut ReviewEngine, workload: &[Intent]) -> Result<()> {
    if workload.len() > 5000 || !engine.operations().is_empty() { return Err(SimulationError::Configuration("workload requires fresh bounded engine")); }
    let allocated = engine.allocation_config().is_some();
    for intent in workload {
        let command = if allocated { Command::PostAllocated { task_id: intent.task_id, client: intent.client,
            title: format!("synthetic-work-{}", intent.task_id), criteria_digest: "c".repeat(64), reward: 100, deadline_tick: 9 } }
        else { Command::Post { task_id: intent.task_id, client: intent.client, reviewer: 2,
            title: format!("synthetic-work-{}", intent.task_id), criteria_digest: "c".repeat(64), reward: 100, deadline_tick: 9 } };
        engine.schedule(0, command)?;
    }
    engine.advance_to(0)?;
    for intent in workload {
        let Some(case) = engine.case(intent.task_id) else { continue; };
        if intent.injected_attacks {
            // Attempt to make the primary reviewer also accept the worker role.
            engine.schedule(1, Command::Accept { task_id: intent.task_id, worker: case.primary_reviewer })?;
        }
        engine.schedule(1, Command::Accept { task_id: intent.task_id, worker: intent.worker })?;
    }
    engine.advance_to(1)?;
    for intent in workload {
        if engine.case(intent.task_id).is_some() {
            engine.schedule(2, Command::Submit { task_id: intent.task_id, worker: intent.worker, artifact_digest: "a".repeat(64) })?;
        }
    }
    engine.advance_to(2)?;
    for intent in workload {
        let Some(case) = engine.case(intent.task_id) else { continue; };
        let reviewer = case.primary_reviewer;
        if intent.injected_attacks { engine.schedule(3, decision(intent.task_id, intent.client, Verdict::Approve, false))?; }
        if !intent.missing_review { engine.schedule(3, decision(intent.task_id, reviewer, intent.verdict, false))?; }
    }
    engine.advance_to(3)?;
    for intent in workload {
        if intent.appeal && engine.case(intent.task_id).is_some_and(|case| case.status == CaseStatus::Provisional) {
            engine.schedule(4, Command::Appeal { task_id: intent.task_id, actor: intent.worker, reason_digest: "f".repeat(64) })?;
        }
    }
    engine.advance_to(4)?;
    for intent in workload {
        let Some(case) = engine.case(intent.task_id) else { continue; };
        let primary = case.primary_reviewer;
        let appeal = case.appeal.as_ref().map(|appeal| appeal.reviewer);
        if let Some(reviewer) = appeal {
            if intent.injected_attacks { engine.schedule(6, decision(intent.task_id, primary, Verdict::Approve, true))?; }
            if !intent.missing_appeal { engine.schedule(6, decision(intent.task_id, reviewer, intent.appeal_verdict, true))?; }
        }
    }
    engine.run()
}
impl ExperimentSuite {
    pub fn hash(&self) -> Result<String> {
        fingerprint(b"ZOORA_AE004_EXPERIMENTS_V1\0", &(self.schema_version, &self.model, &self.classification,
            &self.rng, &self.config, &self.experiments))
    }
    pub fn generate(config: ExperimentConfig) -> Result<Self> {
        config.validate()?;
        let mut suite = Self { schema_version: 1, model: "zoora-review-experiments/0.1.0".into(), classification: "SYNTHETIC".into(),
            rng: RNG_ALGORITHM.into(), config, experiments: Vec::new(), fingerprint: String::new() };
        for name in ["balanced", "declared_aliases", "capacity_stress", "collusion_attempts", "spam_missing_reviews"] {
            let aliases = name == "declared_aliases";
            let spam = name == "spam_missing_reviews";
            let workload = intents(&suite.config, name == "collusion_attempts", spam);
            let operators = if aliases { let mut ops = vec![0, 1]; ops.extend(std::iter::repeat_n(2, 9)); ops.extend(3..10); ops }
                else { (0..10).collect::<Vec<u64>>() };
            let review = ReviewConfig { market: MarketConfig { agent_count: operators.len(), starting_balance: 100_000,
                ticks: 10, seed: suite.config.seed, max_tasks: 1000, scenario_tasks: 0, max_active_tasks_per_worker: 1000,
                ..MarketConfig::default() }, operators, ..ReviewConfig::default() };
            let policy = AllocationConfig { reviewer_accounts: (2..review.market.agent_count as u64).collect(),
                max_active_per_operator: match name { "capacity_stress" => 2, "spam_missing_reviews" => 4, _ => 5000 } };
            let mut baseline = ReviewEngine::new(review.clone())?;
            run_workload(&mut baseline, &workload)?;
            let mut allocated = ReviewEngine::with_allocation(review, policy)?;
            run_workload(&mut allocated, &workload)?;
            suite.experiments.push(Experiment { name: name.into(), description: match name {
                "balanced" => "Matched review intentions; compare lowest-ID allocation with least-loaded declared operators.",
                "declared_aliases" => "Nine reviewer accounts declare the same operator; extra accounts do not increase that operator's allocation weight.",
                "capacity_stress" => "Two simultaneous pending assignments per declared operator; unavailable primary capacity rejects before escrow funding.",
                "collusion_attempts" => "Injected conflicting worker roles and unauthorized primary/appellate verdicts must be rejected. Distinct declared operators can still secretly collude.",
                _ => "Twenty-four nonresponsive tasks arrive first and occupy capacity until deadline. This exposes remaining starvation; it does not claim spam immunity.",
            }.into(), workload_fingerprint: fingerprint(b"ZOORA_AE004_INTENTIONS_V1\0", &workload)?, intents: workload,
                baseline: ReviewReport::from_engine(&baseline)?, allocated: AllocationReport::from_engine(&allocated)? });
        }
        suite.fingerprint = suite.hash()?; Ok(suite)
    }
    pub fn verify(&self) -> Result<()> {
        self.config.validate()?;
        if self.schema_version != 1 || self.model != "zoora-review-experiments/0.1.0" || self.classification != "SYNTHETIC"
            || self.rng != RNG_ALGORITHM || self.experiments.len() != 5 || self.fingerprint != self.hash()? {
            return Err(SimulationError::Replay("experiment identity or fingerprint differs"));
        }
        for experiment in &self.experiments {
            if experiment.workload_fingerprint != fingerprint(b"ZOORA_AE004_INTENTIONS_V1\0", &experiment.intents)? {
                return Err(SimulationError::Replay("workload fingerprint differs"));
            }
            experiment.baseline.verify()?; experiment.allocated.verify()?;
        }
        if Self::generate(self.config.clone())? != *self { return Err(SimulationError::Replay("matched experiment regeneration differs")); }
        Ok(())
    }
}
