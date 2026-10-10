//! Standalone, read-only HTML export. Verification happens in Rust before any output is written.
use crate::{
    allocation::AllocationReport, direct::DirectReport, experiments::ExperimentSuite, ReviewReport,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use zoora_agent_economy_simulator::SimulationError;
#[derive(Serialize)]
struct Viewer {
    schema_version: u32,
    classification: &'static str,
    verification: &'static str,
    source_model: String,
    source_fingerprint: String,
    reports: Vec<View>,
}
#[derive(Serialize)]
struct View {
    direct_summary: Option<DirectSummary>,
    label: String,
    description: String,
    policy: String,
    source_fingerprint: String,
    processed_events: u64,
    rejected_commands: u64,
    capacity_rejections: u64,
    decisions: u64,
    largest_operator_share_bps: Option<u64>,
    distribution: Vec<Distribution>,
    ledger: Ledger,
    cases: Vec<Case>,
}
#[derive(Serialize)]
struct Distribution {
    operator: String,
    decisions: u64,
}
#[derive(Serialize)]
struct DirectSummary { requests: u64, unresolved_requests: u64, declined: u64, overdue: u64 }
#[derive(Serialize)]
struct Ledger {
    mode: String,
    funded: String,
    paid: String,
    fees: Option<String>,
    refunded: String,
    supply: Option<String>,
}
#[derive(Serialize)]
struct Case {
    paid: String,
    returned: String,
    refund_remaining: String,
    overdue: bool,
    id: String,
    title: String,
    status: String,
    client: String,
    worker: String,
    primary: String,
    primary_operator: String,
    appeal: String,
    reward: String,
    artifact_digest: String,
    criteria_digest: String,
    primary_verdict: String,
    appeal_verdict: String,
}
fn view(
    label: String,
    description: String,
    report: &ReviewReport,
    capacity: u64,
    source: String,
) -> View {
    let mut distribution = BTreeMap::<u64, u64>::new();
    let mut cases = Vec::new();
    let tasks: BTreeMap<_, _> = report
        .market
        .final_state
        .tasks
        .iter()
        .map(|t| (t.id, t))
        .collect();
    for case in &report.cases {
        for decision in [
            case.primary_decision.as_ref(),
            case.appeal_decision.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(op) = report.config.operator(decision.reviewer) {
                *distribution.entry(op).or_default() += 1;
            }
        }
        if let Some(task) = tasks.get(&case.task_id) {
            cases.push(Case {
                paid: "—".into(), returned: "—".into(), refund_remaining: "—".into(),
                overdue: false,
                id: case.task_id.to_string(),
                title: task.title.clone(),
                status: format!("{:?}", case.status),
                client: task.client.to_string(),
                worker: task
                    .worker
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "—".into()),
                primary: case.primary_reviewer.to_string(),
                primary_operator: report
                    .config
                    .operator(case.primary_reviewer)
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "—".into()),
                appeal: case
                    .appeal
                    .as_ref()
                    .map(|a| a.reviewer.to_string())
                    .unwrap_or_else(|| "—".into()),
                reward: task.reward.to_string(),
                artifact_digest: task.artifact_digest.clone().unwrap_or_else(|| "—".into()),
                criteria_digest: task.acceptance_digest.clone(),
                primary_verdict: case
                    .primary_decision
                    .as_ref()
                    .map(|d| format!("{:?}", d.verdict))
                    .unwrap_or_else(|| "—".into()),
                appeal_verdict: case
                    .appeal_decision
                    .as_ref()
                    .map(|d| format!("{:?}", d.verdict))
                    .unwrap_or_else(|| "—".into()),
            });
        }
    }
    let decisions: u64 = distribution.values().sum();
    let share = if decisions == 0 {
        None
    } else {
        distribution.values().max().map(|n| n * 10000 / decisions)
    };
    let m = &report.market.metrics;
    View {
        direct_summary: None,        label,
        description,
        policy: report.policy.clone(),
        source_fingerprint: source,
        processed_events: report.metrics.processed_events,
        rejected_commands: report.metrics.rejected_commands,
        capacity_rejections: capacity,
        decisions,
        largest_operator_share_bps: share,
        distribution: distribution
            .into_iter()
            .map(|(operator, decisions)| Distribution {
                operator: operator.to_string(),
                decisions,
            })
            .collect(),
        ledger: Ledger {
            mode: "SYNTHETIC_ESCROW_RESEARCH".into(),
            funded: m.escrow_funded.to_string(),
            paid: m.worker_payments.to_string(),
            fees: Some(m.fees_collected.to_string()),
            refunded: m.client_refunds.to_string(),
            supply: Some(
                ((report.config.market.agent_count as u128)
                    * (report.config.market.starting_balance as u128))
                    .to_string(),
            ),
        },
        cases,
    }
}
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = *chunk.get(1).unwrap_or(&0);
        let c = *chunk.get(2).unwrap_or(&0);
        out.push(ALPHABET[(a >> 2) as usize] as char);
        out.push(ALPHABET[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
pub fn export(text: &str) -> Result<String, SimulationError> {
    if text.len() > 128 * 1024 * 1024 {
        return Err(SimulationError::Capacity("viewer input exceeds size limit"));
    }
    let identity: serde_json::Value =
        serde_json::from_str(text).map_err(|_| SimulationError::Replay("invalid viewer input"))?;
    let mut payload = Viewer {
        schema_version: 1,
        classification: "SYNTHETIC",
        verification: "REPLAY_VERIFIED_AT_EXPORT",
        source_model: String::new(),
        source_fingerprint: String::new(),
        reports: Vec::new(),
    };
    match identity.get("model").and_then(|v| v.as_str()) {
        Some("zoora-direct-workflow/0.1.0") => {
            let report: DirectReport = serde_json::from_str(text)
                .map_err(|_| SimulationError::Replay("invalid direct viewer input"))?;
            report.verify()?;
            payload.source_model = report.model;
            payload.source_fingerprint = report.fingerprint.clone();
            payload.reports.push(View {
                direct_summary: Some(DirectSummary { requests: report.metrics.refund_requests, unresolved_requests: report.metrics.unresolved_refund_requests, declined: report.metrics.declined_refunds, overdue: report.metrics.overdue_deliveries }), label: "Direct payment / user-controlled agent wallets".into(),
                description: "Payments are direct. Disputes, refund requests, recipient refusal and missed deadlines do not move money. Only a separate voluntary return receipt counts as a refund. These receipt fixtures are SYNTHETIC; no chain transaction is verified.".into(),
                policy: report.payment_mode, source_fingerprint: report.fingerprint,
                processed_events: report.journal.len() as u64, rejected_commands: report.metrics.rejected_commands,
                capacity_rejections: 0, decisions: 0, largest_operator_share_bps: None, distribution: Vec::new(),
                ledger: Ledger { mode: "DIRECT_USER_WALLET".into(), funded: report.metrics.payments_recorded.to_string(),
                    paid: report.metrics.net_transferred.to_string(), refunded: report.metrics.voluntary_refunds_recorded.to_string(), fees: None, supply: None },
                cases: report.agreements.into_iter().map(|a| Case { paid: a.payments_received.to_string(), returned: a.voluntary_refunds_received.to_string(), refund_remaining: a.refund_request_remaining.map(|n| n.to_string()).unwrap_or_else(|| "—".into()), overdue: a.delivery_overdue, id: a.terms.agreement_id.to_string(), title: a.terms.title,
                    status: format!("{:?}", a.status), client: a.terms.client.to_string(), worker: a.terms.provider.to_string(), primary: "—".into(), primary_operator: "—".into(),
                    appeal: "—".into(), reward: a.terms.amount.to_string(), artifact_digest: a.delivery_digest.unwrap_or_else(|| "—".into()), criteria_digest: a.terms.criteria_digest,
                    primary_verdict: if a.recipient_declined_refund { "Recipient declined refund".into() } else { "No platform reversal authority".into() },
                    appeal_verdict: format!("Voluntary return received: {}", a.voluntary_refunds_received) }).collect() });
        }
        Some("zoora-review-experiments/0.1.0") => {
            let suite: ExperimentSuite = serde_json::from_str(text)
                .map_err(|_| SimulationError::Replay("invalid experiment viewer input"))?;
            suite.verify()?;
            payload.source_model = suite.model;
            payload.source_fingerprint = suite.fingerprint;
            for experiment in suite.experiments {
                payload.reports.push(view(
                    format!("{} / baseline", experiment.name),
                    experiment.description.clone(),
                    &experiment.baseline,
                    0,
                    experiment.baseline.fingerprint.clone(),
                ));
                payload.reports.push(view(
                    format!("{} / allocated", experiment.name),
                    experiment.description,
                    &experiment.allocated.review,
                    experiment.allocated.metrics.capacity_rejections,
                    experiment.allocated.fingerprint,
                ));
            }
        }
        Some("zoora-review-allocation/0.1.0") => {
            let report: AllocationReport = serde_json::from_str(text)
                .map_err(|_| SimulationError::Replay("invalid allocation viewer input"))?;
            report.verify()?;
            payload.source_model = report.model.clone();
            payload.source_fingerprint = report.fingerprint.clone();
            payload.reports.push(view(
                "Allocated review".into(),
                "Declared identities and evidence digests are synthetic inputs.".into(),
                &report.review,
                report.metrics.capacity_rejections,
                report.fingerprint,
            ));
        }
        Some("zoora-review-market/0.1.0") => {
            let report: ReviewReport = serde_json::from_str(text)
                .map_err(|_| SimulationError::Replay("invalid review viewer input"))?;
            report.verify()?;
            payload.source_model = report.model.clone();
            payload.source_fingerprint = report.fingerprint.clone();
            payload.reports.push(view(
                "Legacy review".into(),
                "Lowest eligible account IDs; no allocation capacity policy.".into(),
                &report,
                0,
                report.fingerprint.clone(),
            ));
        }
        _ => {
            return Err(SimulationError::Replay(
                "unsupported viewer report identity",
            ))
        }
    }
    let data = serde_json::to_string(&payload)
        .map_err(|_| SimulationError::Integrity("viewer payload encoding failed"))?
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let css = include_str!("../viewer/style.css").replace("\r\n", "\n").replace('\r', "\n");
    let js = include_str!("../viewer/app.js").replace("\r\n", "\n").replace('\r', "\n");
    let csp = format!("default-src 'none'; script-src 'sha256-{}'; style-src 'sha256-{}'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'", base64(&Sha256::digest(js.as_bytes())), base64(&Sha256::digest(css.as_bytes())));
    let html = include_str!("../viewer/index.html").replace("\r\n", "\n").replace('\r', "\n")
        .replace("{{CSP}}", &csp)
        .replace("{{STYLE}}", &css)
        .replace("{{SCRIPT}}", &js)
        .replace("{{DATA}}", &data);
    if html.len() > 128 * 1024 * 1024 {
        return Err(SimulationError::Capacity(
            "viewer output exceeds size limit",
        ));
    }
    Ok(html)
}
