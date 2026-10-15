//! Replay-required, self-contained output for the AE-013 timing study.
use crate::{economy_export::exact_numbers, payments::PaymentCampaign, viewer::base64};
use sha2::{Digest, Sha256};
use zoora_agent_economy_simulator::SimulationError;
pub fn csv(report: &PaymentCampaign) -> Result<String, SimulationError> {
    report.verify()?;
    let mut lines=vec!["classification,unit,seed,scenario,policy,intended_work,quoted_work,paid_work,started_work,acknowledged_work,attack_requests,quoted_attacks,paid_attacks,started_attacks,work_capacity_rejections,work_metadata_rejections,insufficient_budget,unbacked_claims,duplicate_observations,adapter_rejections,late_transfer_observations,late_evidence_observations,paid_work_not_started,peak_provider_slots,peak_provider_paid_queue,opening_units,final_wallet_units,payments_sent,voluntary_returns_sent,adapter_payments_recorded,observed_unapplied_payment_units,paid_not_started_net_units,unacknowledged_net_units,intentions_fingerprint,run_fingerprint,campaign_fingerprint".to_string()];
    for r in &report.runs {
        let c = &r.metrics.counts;
        let a = &r.metrics.amounts;
        let values = vec![
            report.classification.clone(),
            report.unit.clone(),
            r.seed.to_string(),
            r.scenario.label().into(),
            r.policy.label().into(),
            c.intended_work.to_string(),
            c.quoted_work.to_string(),
            c.paid_work.to_string(),
            c.started_work.to_string(),
            c.acknowledged_work.to_string(),
            c.attack_requests.to_string(),
            c.quoted_attacks.to_string(),
            c.paid_attacks.to_string(),
            c.started_attacks.to_string(),
            c.work_capacity_rejections.to_string(),
            c.work_metadata_rejections.to_string(),
            c.insufficient_budget.to_string(),
            c.unbacked_claims.to_string(),
            c.duplicate_observations.to_string(),
            c.adapter_rejections.to_string(),
            c.late_transfer_observations.to_string(),
            c.late_evidence_observations.to_string(),
            c.paid_work_not_started.to_string(),
            c.peak_occupied_slots.to_string(),
            c.peak_paid_queue.to_string(),
            a.opening_units.to_string(),
            a.final_wallet_units.to_string(),
            a.payments_sent.to_string(),
            a.voluntary_returns_sent.to_string(),
            a.adapter_payments_recorded.to_string(),
            a.observed_unapplied_payment_units.to_string(),
            a.paid_not_started_net_units.to_string(),
            a.unacknowledged_net_units.to_string(),
            r.intentions_fingerprint.clone(),
            r.run_fingerprint.clone(),
            report.fingerprint.clone(),
        ];
        lines.push(
            values
                .iter()
                .map(|v| format!("\"{v}\""))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    Ok(lines.join("\n") + "\n")
}
pub fn html(report: &PaymentCampaign) -> Result<String, SimulationError> {
    report.verify()?;
    let mut data = serde_json::to_value(report)
        .map_err(|_| SimulationError::Integrity("payment viewer encoding failed"))?;
    exact_numbers(&mut data);
    let data = serde_json::to_string(&data)
        .map_err(|_| SimulationError::Integrity("payment viewer encoding failed"))?
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let css = include_str!("../economy-viewer/style.css")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let js = include_str!("../payment-viewer/app.js")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let csp=format!("default-src 'none'; script-src 'sha256-{}'; style-src 'sha256-{}'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'",base64(&Sha256::digest(js.as_bytes())),base64(&Sha256::digest(css.as_bytes())));
    Ok(include_str!("../payment-viewer/index.html")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace("{{CSP}}", &csp)
        .replace("{{STYLE}}", &css)
        .replace("{{SCRIPT}}", &js)
        .replace("{{DATA}}", &data))
}
