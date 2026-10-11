//! Exports verified synthetic observations. CSV missingness and spreadsheet text guards are explicit.
use crate::{community::CommunityReport,community_scenarios::{BatchReport,RunReport,Scenario}};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::collections::BTreeMap;
use zoora_agent_economy_simulator::SimulationError;
type Result<T>=std::result::Result<T,SimulationError>;
fn identity(text:&str)->Result<Value>{
    if text.len()>128*1024*1024{return Err(SimulationError::Capacity("community export input too large"))}
    serde_json::from_str(text).map_err(|_|SimulationError::Replay("invalid community export input"))
}
fn parse(text:&str)->Result<(CommunityReport,Option<(u64,Scenario)>,String)>{
    match identity(text)?.get("model").and_then(|v|v.as_str()) {
        Some("zoora-community-run/0.1.0")=>{
            let r:RunReport=serde_json::from_str(text).map_err(|_|SimulationError::Replay("invalid seeded community report"))?;r.verify()?;
            Ok((r.community,Some((r.config.seed,r.scenario)),r.fingerprint))
        }
        Some("zoora-agent-community/0.1.0")=>{
            let r:CommunityReport=serde_json::from_str(text).map_err(|_|SimulationError::Replay("invalid community report"))?;r.verify()?;
            let fingerprint=r.fingerprint.clone();Ok((r,None,fingerprint))
        }
        _=>Err(SimulationError::Replay("unsupported community report identity")),
    }
}
fn csv_row(fields:&[String],out:&mut String){
    for (index,value) in fields.iter().enumerate(){
        if index>0{out.push(',')}
        out.push('"');
        // CSV quoting alone does not prevent spreadsheet formula execution.
        if value.trim_start().chars().next().is_some_and(|c|matches!(c,'='|'+'|'-'|'@')){out.push('\'')}
        out.push_str(&value.replace('"',"\"\""));out.push('"');
    }
    out.push('\n');
}
pub fn csv(text:&str)->Result<String>{
    let mut output=String::new();
    if identity(text)?.get("model").and_then(|v|v.as_str())==Some("zoora-community-batch/0.1.0") {
        let batch:BatchReport=serde_json::from_str(text).map_err(|_|SimulationError::Replay("invalid community batch"))?;batch.verify()?;
        csv_row(&["classification","source","time_basis","slot","commitment","transformation_version","seed","scenario","intended_tasks","all_order_requests","accepted_orders","acknowledged_deliveries","acknowledged_bps_of_all_accepted_orders","unpaid_at_finish","paid_without_delivery","capacity_rejections","post_rate_rejections","payments_recorded","voluntary_returns","net_transferred","unresolved_return_requests","intentions_fingerprint","run_fingerprint","community_fingerprint","batch_fingerprint","quality_flags"].map(str::to_string),&mut output);
        for r in &batch.runs {
            let m=&r.metrics;let d=&r.direct_metrics;
            csv_row(&["SYNTHETIC".into(),"SEEDED_COMMUNITY_WORKLOAD_V1".into(),"SIMULATION_TICKS".into(),"UNAVAILABLE".into(),"SIMULATED_FINAL".into(),"1".into(),r.seed.to_string(),format!("{:?}",r.scenario),batch.config.workload.tasks.to_string(),m.accepted_order_requests.to_string(),m.accepted_orders.to_string(),m.acknowledged_deliveries.to_string(),r.acknowledged_delivery_bps.map(|n|n.to_string()).unwrap_or_else(||"UNAVAILABLE".into()),m.unpaid_at_finish.to_string(),m.pending_deliveries_at_finish.to_string(),m.provider_capacity_rejections.to_string(),m.post_rate_rejections.to_string(),d.payments_recorded.to_string(),d.voluntary_refunds_recorded.to_string(),d.net_transferred.to_string(),d.unresolved_refund_requests.to_string(),r.intentions_fingerprint.clone(),r.report_fingerprint.clone(),r.community_fingerprint.clone(),batch.fingerprint.clone(),"SYNTHETIC_INPUTS|DECLARED_IDENTITIES|NO_CHAIN_OR_WALL_CLOCK_PROOF|DELIVERY_QUALITY_UNVERIFIED|CSV_TEXT_GUARD_V1".into()],&mut output);
        }
    }else{
        let (report,run,source_hash)=parse(text)?;
        let agreements:BTreeMap<_,_>=report.direct.agreements.iter().map(|a|(a.terms.agreement_id,a)).collect();
        csv_row(&["classification","source","time_basis","observed_at","available_at","slot","commitment","transformation_version","seed","scenario","agreement_id","offer_id","project_id","client","provider","related_declared_operator","accepted_tick","deadline_tick","deadline_elapsed","quoted_units","payments_recorded","voluntary_returns","net_transferred","return_request_remaining","delivery_acknowledged","delivery_overdue","status","title","community_fingerprint","source_fingerprint","quality_flags"].map(str::to_string),&mut output);
        for order in &report.orders {
            let a=agreements.get(&order.agreement_id).ok_or(SimulationError::Integrity("verified order lacks agreement"))?;
            csv_row(&[report.classification.clone(),report.provenance.source.clone(),report.provenance.time_basis.clone(),"UNAVAILABLE".into(),"UNAVAILABLE".into(),"UNAVAILABLE".into(),report.provenance.commitment.clone(),report.provenance.transformation_version.to_string(),run.map(|r|r.0.to_string()).unwrap_or_else(||"UNAVAILABLE".into()),run.map(|r|format!("{:?}",r.1)).unwrap_or_else(||"Manual".into()),order.agreement_id.to_string(),order.offer_id.to_string(),order.project_id.to_string(),order.client.to_string(),order.provider.to_string(),order.related_operator.to_string(),order.accepted_tick.to_string(),a.terms.delivery_deadline.to_string(),(report.config.ticks>a.terms.delivery_deadline).to_string(),a.terms.amount.to_string(),a.payments_received.to_string(),a.voluntary_refunds_received.to_string(),a.net_transferred().to_string(),a.refund_request_remaining.map(|n|n.to_string()).unwrap_or_else(||"UNAVAILABLE".into()),a.delivery_acknowledged.to_string(),a.delivery_overdue.to_string(),format!("{:?}",a.status),a.terms.title.clone(),report.fingerprint.clone(),source_hash.clone(),format!("{}|CSV_TEXT_GUARD_V1",report.provenance.quality_flags.join("|"))],&mut output);
        }
    }
    Ok(output)
}
fn base64(bytes:&[u8])->String {
    const A:&[u8]=b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let mut out=String::new();
    for c in bytes.chunks(3){let a=c[0];let b=*c.get(1).unwrap_or(&0);let d=*c.get(2).unwrap_or(&0);
        out.push(A[(a>>2) as usize] as char);out.push(A[(((a&3)<<4)|(b>>4)) as usize] as char);
        out.push(if c.len()>1{A[(((b&15)<<2)|(d>>6)) as usize] as char}else{'='});out.push(if c.len()>2{A[(d&63) as usize] as char}else{'='});}
    out
}
pub fn viewer(text:&str)->Result<String>{
    let (r,run,source_hash)=parse(text)?;
    let mut payload=json!({"schema_version":1,"classification":"SYNTHETIC","verification":"REPLAY_VERIFIED_AT_EXPORT","model":r.model,
        "source_fingerprint":source_hash,"community_fingerprint":r.fingerprint,"seed":run.map(|v|v.0),"scenario":run.map(|v|v.1),
        "provenance":r.provenance,"metrics":r.metrics,"agents":r.agents,"projects":r.projects,"posts":r.posts,"offers":r.offers,"orders":r.orders,
        "direct":{"agreements":r.direct.agreements,"metrics":r.direct.metrics,"wallet_boundary":r.direct.wallet_boundary}});
    // JSON numbers above 2^53 lose precision in browsers. Preserve arbitrary IDs and quoted/requested amounts as strings.
    for key in ["projects","posts","offers","orders"] {
        for value in payload[key].as_array_mut().expect("serialized collection") {
            for field in ["project_id","post_id","reply_to","offer_id","agreement_id","amount"] {
                if let Some(n)=value.get(field).and_then(Value::as_u64){value[field]=Value::String(n.to_string());}
            }
        }
    }
    for value in payload["direct"]["agreements"].as_array_mut().expect("agreements") {
        for field in ["agreement_id","amount"] {
            let n=value["terms"][field].as_u64().expect("serialized u64");value["terms"][field]=Value::String(n.to_string());
        }
        for field in ["refund_requested_amount","refund_request_remaining"] {
            if let Some(n)=value[field].as_u64(){value[field]=Value::String(n.to_string());}
        }
    }
    let data=payload.to_string()
        .replace('&',"\\u0026").replace('<',"\\u003c").replace('>',"\\u003e").replace('\u{2028}',"\\u2028").replace('\u{2029}',"\\u2029");
    let css=include_str!("../viewer/style.css").replace("\r\n","\n").replace('\r',"\n");
    let js=include_str!("../community-viewer/app.js").replace("\r\n","\n").replace('\r',"\n");
    let csp=format!("default-src 'none'; script-src 'sha256-{}'; style-src 'sha256-{}'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'",base64(&Sha256::digest(js.as_bytes())),base64(&Sha256::digest(css.as_bytes())));
    let html=include_str!("../community-viewer/index.html").replace("\r\n","\n").replace('\r',"\n").replace("{{CSP}}",&csp).replace("{{STYLE}}",&css).replace("{{SCRIPT}}",&js).replace("{{DATA}}",&data);
    if html.len()>128*1024*1024{return Err(SimulationError::Capacity("community viewer too large"))}Ok(html)
}
