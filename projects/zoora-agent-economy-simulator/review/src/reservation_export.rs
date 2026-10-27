//! Verified offline AE-015 exports. No external assets or signing capability.
use crate::{economy_export::exact_numbers, reservations::ReservationCampaign, viewer::base64};
use sha2::{Digest, Sha256};
use zoora_agent_economy_simulator::SimulationError;
pub fn csv(report: &ReservationCampaign) -> Result<String, SimulationError> {
    report.verify()?;
    let mut lines = vec![];
    for (index, row) in report.runs.iter().enumerate() {
        let mut data = serde_json::to_value(serde_json::json!({"counts":&row.metrics.counts,"amounts":&row.metrics.amounts,"controls":&row.controls}))
            .map_err(|_| SimulationError::Integrity("reservation CSV encoding failed"))?;
        exact_numbers(&mut data);
        let mut names = vec![
            "classification".to_string(),
            "unit".into(),
            "seed".into(),
            "scenario".into(),
            "policy".into(),
        ];
        let mut values = vec![
            report.classification.clone(),
            report.unit.clone(),
            row.seed.to_string(),
            row.scenario.label().into(),
            row.policy.label().into(),
        ];
        for group in ["counts", "amounts", "controls"] {
            for (key, value) in data[group].as_object().expect("metrics object") {
                names.push(key.clone());
                values.push(value.as_str().expect("exact number").into());
            }
        }
        names.extend([
            "intentions_fingerprint".into(),
            "run_fingerprint".into(),
            "campaign_fingerprint".into(),
        ]);
        values.extend([
            row.intentions_fingerprint.clone(),
            row.run_fingerprint.clone(),
            report.fingerprint.clone(),
        ]);
        if index == 0 {
            lines.push(names.join(","));
        }
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
pub fn html(report: &ReservationCampaign) -> Result<String, SimulationError> {
    report.verify()?;
    let mut data = serde_json::to_value(report)
        .map_err(|_| SimulationError::Integrity("reservation HTML encoding failed"))?;
    exact_numbers(&mut data);
    let data = serde_json::to_string(&data)
        .map_err(|_| SimulationError::Integrity("reservation HTML encoding failed"))?
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let css = include_str!("../economy-viewer/style.css")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let js = include_str!("../reservation-viewer/app.js")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let csp=format!("default-src 'none'; script-src 'sha256-{}'; style-src 'sha256-{}'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'",base64(&Sha256::digest(js.as_bytes())),base64(&Sha256::digest(css.as_bytes())));
    Ok(include_str!("../reservation-viewer/index.html")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace("{{CSP}}", &csp)
        .replace("{{STYLE}}", &css)
        .replace("{{SCRIPT}}", &js)
        .replace("{{DATA}}", &data))
}
