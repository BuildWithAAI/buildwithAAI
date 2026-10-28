//! Exports only replay-verified campaign data. No secrets or network dependencies.
use crate::economy::EconomyCampaign;
use serde_json::Value;
use sha2::{Digest, Sha256};
use zoora_agent_economy_simulator::SimulationError;

pub fn csv(campaign: &EconomyCampaign) -> Result<String, SimulationError> {
    campaign.verify()?;
    let header = [
        "classification",
        "unit",
        "seed",
        "scenario",
        "policy",
        "intended_work",
        "admitted_work",
        "acknowledged_work",
        "attack_requests",
        "admitted_attacks",
        "operator_limit_rejections",
        "budget_rejections",
        "work_provider_capacity_rejections",
        "work_unavailable_provider_rejections",
        "other_work_engine_rejections",
        "refused_returns",
        "digest_without_acknowledgment",
        "acknowledged_per_intended_bps",
        "recovery_acknowledged_per_intended_bps",
        "largest_provider_payment_share_bps",
        "payments",
        "voluntary_returns",
        "fees",
        "opening_units",
        "agent_liquid_units",
        "treasury_units",
        "liquidity_budget_units",
        "burned_units",
        "unacknowledged_net_units",
        "undelivered_net_units",
        "intentions_fingerprint",
        "run_fingerprint",
        "community_fingerprint",
        "campaign_fingerprint",
    ];
    let mut rows = vec![header
        .iter()
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(",")];
    let optional = |v: Option<u64>| v.map(|v| v.to_string()).unwrap_or("UNAVAILABLE".into());
    for r in &campaign.runs {
        let m = &r.metrics;
        let c = &m.counts;
        let s = &m.stocks;
        let f = &m.flows;
        let values = vec![
            campaign.classification.clone(),
            campaign.unit.clone(),
            r.seed.to_string(),
            r.scenario.label().into(),
            r.policy.label().into(),
            c.intended_work.to_string(),
            c.admitted_work.to_string(),
            c.acknowledged_work.to_string(),
            c.attack_requests.to_string(),
            c.admitted_attacks.to_string(),
            c.operator_limit_rejections.to_string(),
            c.budget_rejections.to_string(),
            c.provider_capacity_rejections.to_string(),
            c.unavailable_provider_rejections.to_string(),
            c.other_engine_rejections.to_string(),
            c.refused_returns.to_string(),
            c.digest_without_acknowledgment.to_string(),
            optional(m.acknowledged_per_intended_bps),
            optional(m.recovery_acknowledged_per_intended_bps),
            optional(m.largest_provider_payment_share_bps),
            f.payments.to_string(),
            f.voluntary_returns.to_string(),
            f.fees.to_string(),
            s.opening_units.to_string(),
            s.agent_liquid_units.to_string(),
            s.treasury_units.to_string(),
            s.liquidity_budget_units.to_string(),
            s.burned_units.to_string(),
            m.unacknowledged_net_units.to_string(),
            m.undelivered_net_units.to_string(),
            r.intentions_fingerprint.clone(),
            r.run_fingerprint.clone(),
            r.community_fingerprint.clone(),
            campaign.fingerprint.clone(),
        ];
        // Every field is an internally generated enum, nonnegative integer or digest.
        rows.push(
            values
                .iter()
                .map(|v| format!("\"{v}\""))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    Ok(rows.join("\n") + "\n")
}
pub(crate) fn exact_numbers(value: &mut Value) {
    match value {
        Value::Number(n) => *value = Value::String(n.to_string()),
        Value::Array(values) => values.iter_mut().for_each(exact_numbers),
        Value::Object(fields) => fields.values_mut().for_each(exact_numbers),
        _ => {}
    }
}
pub fn html(campaign: &EconomyCampaign) -> Result<String, SimulationError> {
    campaign.verify()?;
    let mut payload = serde_json::to_value(campaign)
        .map_err(|_| SimulationError::Integrity("economy viewer encoding failed"))?;
    exact_numbers(&mut payload);
    let data = serde_json::to_string(&payload)
        .map_err(|_| SimulationError::Integrity("economy viewer encoding failed"))?
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let css = include_str!("../economy-viewer/style.css")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let js = include_str!("../economy-viewer/app.js")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let b64 = crate::viewer::base64;
    let csp = format!("default-src 'none'; script-src 'sha256-{}'; style-src 'sha256-{}'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'",
        b64(&Sha256::digest(js.as_bytes())), b64(&Sha256::digest(css.as_bytes())));
    Ok(include_str!("../economy-viewer/index.html")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace("{{CSP}}", &csp)
        .replace("{{STYLE}}", &css)
        .replace("{{SCRIPT}}", &js)
        .replace("{{DATA}}", &data))
}
