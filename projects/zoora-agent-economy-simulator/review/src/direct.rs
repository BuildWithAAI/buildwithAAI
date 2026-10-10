//! Noncustodial workflow transcript. It never signs, holds balances, reverses transfers, or freezes wallets.
//! Only explicit synthetic receipt fixtures are accepted until a read-only chain-verification adapter exists.
use crate::allocation::fingerprint;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zoora_agent_economy_simulator::SimulationError;
use zoora_task_market::{metrics::decimal, types::valid_digest};
type Result<T> = std::result::Result<T, SimulationError>;
const MAX_EVENTS: usize = 50_000;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectConfig { pub agents: u64, pub ticks: u64, pub max_agreements: usize }
impl DirectConfig {
    fn validate(&self) -> Result<()> {
        if !(2..=100_000).contains(&self.agents) || !(2..=100_000).contains(&self.ticks) || !(1..=5000).contains(&self.max_agreements) {
            return Err(SimulationError::Configuration("invalid direct-workflow dimensions"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Terms { pub agreement_id: u64, pub client: u64, pub provider: u64, pub title: String,
    pub asset: String, pub amount: u64, pub delivery_deadline: u64, pub criteria_digest: String }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt { pub agreement_id: u64, pub transaction_ref: String, pub sender: u64, pub recipient: u64,
    pub asset: String, pub amount: u64, pub simulation_tick: u64, pub availability_tick: u64,
    pub source: String, pub classification: String, pub slot: Option<u64>, pub commitment: String, pub transformation_version: u32 }
impl Receipt {
    pub fn synthetic(id: u64, reference: u64, sender: u64, recipient: u64, amount: u64, tick: u64) -> Self {
        Self { agreement_id: id, transaction_ref: fingerprint(b"ZOORA_AE004_DIRECT_FIXTURE_V1\0", &(id,reference,sender,recipient,amount,tick)).expect("fixed fixture serialization"),
            sender, recipient, asset: "SYNTHETIC_UNIT".into(), amount, simulation_tick: tick, availability_tick: tick,
            source: "OFFLINE_FIXTURE_V1".into(), classification: "SYNTHETIC".into(), slot: None,
            commitment: "SIMULATED_FINAL".into(), transformation_version: 1 }
    }
    fn valid(&self, tick: u64) -> bool { valid_digest(&self.transaction_ref) && self.asset == "SYNTHETIC_UNIT" && self.amount > 0
        && self.simulation_tick <= self.availability_tick && self.availability_tick == tick && self.classification == "SYNTHETIC"
        && self.source == "OFFLINE_FIXTURE_V1" && self.slot.is_none() && self.commitment == "SIMULATED_FINAL" && self.transformation_version == 1 }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
pub enum DirectStatus { AwaitingPayment, PartiallyPaid, Paid, Delivered, Accepted, Disputed, RefundRequested, PartiallyRefunded, Refunded }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Agreement {
    pub terms: Terms,
    #[serde(with="decimal")] pub payments_received: u128,
    #[serde(with="decimal")] pub voluntary_refunds_received: u128,
    pub delivery_digest: Option<String>, pub dispute_digest: Option<String>, pub refund_request_digest: Option<String>,
    pub refund_requested_amount: Option<u64>, pub recipient_declined_refund: bool, pub delivery_acknowledged: bool,
    pub delivery_overdue: bool, pub status: DirectStatus,
}
impl Agreement {
    fn status(&self) -> DirectStatus {
        if self.payments_received > 0 && self.voluntary_refunds_received == self.payments_received { DirectStatus::Refunded }
        else if self.voluntary_refunds_received > 0 { DirectStatus::PartiallyRefunded }
        else if self.refund_request_digest.is_some() { DirectStatus::RefundRequested }
        else if self.dispute_digest.is_some() { DirectStatus::Disputed }
        else if self.delivery_acknowledged { DirectStatus::Accepted }
        else if self.delivery_digest.is_some() { DirectStatus::Delivered }
        else if self.payments_received == u128::from(self.terms.amount) { DirectStatus::Paid }
        else if self.payments_received > 0 { DirectStatus::PartiallyPaid }
        else { DirectStatus::AwaitingPayment }
    }
    pub fn net_transferred(&self) -> u128 { self.payments_received - self.voluntary_refunds_received }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="type", rename_all="SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum DirectCommand {
    Agree { terms: Terms }, PaymentReceipt { receipt: Receipt }, VoluntaryRefundReceipt { receipt: Receipt },
    Deliver { agreement_id: u64, provider: u64, artifact_digest: String },
    Acknowledge { agreement_id: u64, client: u64 }, Dispute { agreement_id: u64, client: u64, reason_digest: String },
    RequestRefund { agreement_id: u64, client: u64, amount: u64, reason_digest: String },
    DeclineRefund { agreement_id: u64, provider: u64 }, Finish {},
}
impl DirectCommand {
    fn id(&self) -> Option<u64> { match self { Self::Agree{terms}=>Some(terms.agreement_id), Self::PaymentReceipt{receipt}|Self::VoluntaryRefundReceipt{receipt}=>Some(receipt.agreement_id),
        Self::Deliver{agreement_id,..}|Self::Acknowledge{agreement_id,..}|Self::Dispute{agreement_id,..}|Self::RequestRefund{agreement_id,..}|Self::DeclineRefund{agreement_id,..}=>Some(*agreement_id), Self::Finish{}=>None } }
    fn bounded(&self) -> bool { match self { Self::Agree{terms}=>terms.title.len()<=128 && terms.asset.len()<=64 && terms.criteria_digest.len()<=64,
        Self::PaymentReceipt{receipt}|Self::VoluntaryRefundReceipt{receipt}=>receipt.transaction_ref.len()<=64 && receipt.asset.len()<=64 && receipt.source.len()<=64 && receipt.classification.len()<=16 && receipt.commitment.len()<=32,
        Self::Deliver{artifact_digest,..}=>artifact_digest.len()<=64,Self::Dispute{reason_digest,..}|Self::RequestRefund{reason_digest,..}=>reason_digest.len()<=64,_=>true } }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
pub enum DirectRejection { InvalidTerms, UnknownAgreement, WrongParty, WrongState, InvalidReceipt, DuplicateTransaction, InvalidAmount, InvalidEvidence, Capacity }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="status", rename_all="SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum DirectOutcome { Recorded {}, Rejected { reason: DirectRejection } }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectRecord { pub event_id: u64, pub simulation_tick: u64, pub command: DirectCommand, pub outcome: DirectOutcome }
pub struct DirectEngine { config: DirectConfig, agreements: BTreeMap<u64,Agreement>, seen: BTreeMap<String,u64>, journal: Vec<DirectRecord>, clock: u64, finished: bool }
impl DirectEngine {
    pub fn new(config: DirectConfig) -> Result<Self> { config.validate()?; Ok(Self{config,agreements:BTreeMap::new(),seen:BTreeMap::new(),journal:Vec::new(),clock:0,finished:false}) }
    pub fn agreement(&self,id:u64)->Option<&Agreement>{self.agreements.get(&id)}
    pub fn record(&mut self,tick:u64,command:DirectCommand)->Result<()> {
        if self.finished || tick<self.clock || tick>=self.config.ticks || matches!(command,DirectCommand::Finish{}) {return Err(SimulationError::Integrity("direct workflow closed, past, or invalid command"));}
        if self.journal.len()>=MAX_EVENTS-1 || !command.bounded(){return Err(SimulationError::Capacity("direct event or input budget exhausted"));}
        self.append(tick,command)
    }
    fn append(&mut self,tick:u64,command:DirectCommand)->Result<()> {
        self.clock=tick;self.expire(); let outcome=match self.apply(&command,tick){Ok(())=>DirectOutcome::Recorded{},Err(reason)=>DirectOutcome::Rejected{reason}};
        self.journal.push(DirectRecord{event_id:self.journal.len() as u64,simulation_tick:tick,command,outcome});self.expire();Ok(())
    }
    fn apply(&mut self,command:&DirectCommand,tick:u64)->std::result::Result<(),DirectRejection> {
        use DirectRejection::*;
        if let DirectCommand::Agree{terms}=command {
            if terms.client>=self.config.agents || terms.provider>=self.config.agents || terms.client==terms.provider || terms.amount==0
                || terms.asset!="SYNTHETIC_UNIT" || terms.title.trim().is_empty() || !valid_digest(&terms.criteria_digest)
                || terms.delivery_deadline<=tick || terms.delivery_deadline>=self.config.ticks {return Err(InvalidTerms);}
            if self.agreements.contains_key(&terms.agreement_id){return Err(WrongState);}if self.agreements.len()>=self.config.max_agreements{return Err(Capacity);}
            self.agreements.insert(terms.agreement_id,Agreement{terms:terms.clone(),payments_received:0,voluntary_refunds_received:0,delivery_digest:None,dispute_digest:None,
                refund_request_digest:None,refund_requested_amount:None,recipient_declined_refund:false,delivery_acknowledged:false,delivery_overdue:false,status:DirectStatus::AwaitingPayment});return Ok(());
        }
        let Some(id)=command.id() else {return Ok(());};let mut agreement=self.agreements.get(&id).cloned().ok_or(UnknownAgreement)?;
        let mut reference=None;
        match command {
            DirectCommand::PaymentReceipt{receipt}|DirectCommand::VoluntaryRefundReceipt{receipt}=>{
                if !receipt.valid(tick) || receipt.asset!=agreement.terms.asset {return Err(InvalidReceipt);}if self.seen.contains_key(&receipt.transaction_ref){return Err(DuplicateTransaction);}
                let refund=matches!(command,DirectCommand::VoluntaryRefundReceipt{..});
                let (sender,recipient)=if refund{(agreement.terms.provider,agreement.terms.client)}else{(agreement.terms.client,agreement.terms.provider)};
                if receipt.sender!=sender || receipt.recipient!=recipient{return Err(WrongParty);}
                if refund { let next=agreement.voluntary_refunds_received+u128::from(receipt.amount);if next>agreement.payments_received{return Err(InvalidAmount);}agreement.voluntary_refunds_received=next; }
                else {if agreement.voluntary_refunds_received>0{return Err(WrongState);}let next=agreement.payments_received+u128::from(receipt.amount);if next>u128::from(agreement.terms.amount){return Err(InvalidAmount);}agreement.payments_received=next;}
                reference=Some(receipt.transaction_ref.clone());
            }
            DirectCommand::Deliver{provider,artifact_digest,..}=>{
                if *provider!=agreement.terms.provider{return Err(WrongParty);}if !valid_digest(artifact_digest){return Err(InvalidEvidence);}
                if agreement.payments_received!=u128::from(agreement.terms.amount) || agreement.delivery_digest.is_some() || agreement.net_transferred()==0{return Err(WrongState);}
                agreement.delivery_digest=Some(artifact_digest.clone());if tick>=agreement.terms.delivery_deadline{agreement.delivery_overdue=true;}
            }
            DirectCommand::Acknowledge{client,..}=>{
                if *client!=agreement.terms.client{return Err(WrongParty);}if agreement.delivery_digest.is_none() || agreement.delivery_acknowledged || agreement.dispute_digest.is_some() || agreement.refund_request_digest.is_some(){return Err(WrongState);}agreement.delivery_acknowledged=true;
            }
            DirectCommand::Dispute{client,reason_digest,..}=>{
                if *client!=agreement.terms.client{return Err(WrongParty);}if !valid_digest(reason_digest){return Err(InvalidEvidence);}if agreement.payments_received==0 || agreement.dispute_digest.is_some(){return Err(WrongState);}agreement.dispute_digest=Some(reason_digest.clone());
            }
            DirectCommand::RequestRefund{client,amount,reason_digest,..}=>{
                if *client!=agreement.terms.client{return Err(WrongParty);}if !valid_digest(reason_digest){return Err(InvalidEvidence);}
                if *amount==0 || u128::from(*amount)>agreement.net_transferred(){return Err(InvalidAmount);}if agreement.refund_request_digest.is_some(){return Err(WrongState);}
                agreement.refund_request_digest=Some(reason_digest.clone());agreement.refund_requested_amount=Some(*amount);
            }
            DirectCommand::DeclineRefund{provider,..}=>{
                if *provider!=agreement.terms.provider{return Err(WrongParty);}if agreement.refund_request_digest.is_none() || agreement.recipient_declined_refund || agreement.net_transferred()==0{return Err(WrongState);}agreement.recipient_declined_refund=true;
            }
            DirectCommand::Agree{..}|DirectCommand::Finish{}=>unreachable!(),
        }
        agreement.status=agreement.status();self.agreements.insert(id,agreement);if let Some(reference)=reference{self.seen.insert(reference,id);}Ok(())
    }
    fn expire(&mut self){for a in self.agreements.values_mut(){if self.clock>=a.terms.delivery_deadline && a.payments_received>0 && a.delivery_digest.is_none(){a.delivery_overdue=true;}}}
    pub fn finish(&mut self)->Result<()>{if self.finished{return Err(SimulationError::Integrity("direct workflow already closed"));}self.append(self.config.ticks-1,DirectCommand::Finish{})?;self.finished=true;Ok(())}
}
#[derive(Debug,Clone,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WalletBoundary {pub holds_customer_funds:bool,pub has_signing_keys:bool,pub can_freeze_wallets:bool,pub can_reverse_payments:bool,pub can_force_refunds:bool,pub chain_receipts_verified:bool,pub network_enabled:bool}
#[derive(Debug,Clone,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectMetrics{
    #[serde(with="decimal")]pub payments_recorded:u128,#[serde(with="decimal")]pub voluntary_refunds_recorded:u128,#[serde(with="decimal")]pub net_transferred:u128,
    pub refund_requests:u64,pub declined_refunds:u64,pub overdue_deliveries:u64,pub unresolved_disputes:u64,pub rejected_commands:u64,
}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectReport{pub schema_version:u32,pub model:String,pub classification:String,pub payment_mode:String,pub config:DirectConfig,pub wallet_boundary:WalletBoundary,
    #[serde(deserialize_with="bounded_agreements")]pub agreements:Vec<Agreement>,pub metrics:DirectMetrics,
    #[serde(deserialize_with="bounded_journal")]pub journal:Vec<DirectRecord>,pub fingerprint:String}
fn bounded_agreements<'de,D:serde::de::Deserializer<'de>>(d:D)->std::result::Result<Vec<Agreement>,D::Error>{crate::bounded::vec::<D,Agreement,5000>(d)}
fn bounded_journal<'de,D:serde::de::Deserializer<'de>>(d:D)->std::result::Result<Vec<DirectRecord>,D::Error>{crate::bounded::vec::<D,DirectRecord,MAX_EVENTS>(d)}
impl DirectReport{
    pub fn hash(&self)->Result<String>{fingerprint(b"ZOORA_AE004_DIRECT_V1\0",&(self.schema_version,&self.model,&self.classification,&self.payment_mode,&self.config,&self.wallet_boundary,&self.agreements,&self.metrics,&self.journal))}
    pub fn from_engine(engine:&DirectEngine)->Result<Self>{
        if !engine.finished{return Err(SimulationError::Integrity("direct report requires finished transcript"));}
        let agreements:Vec<_>=engine.agreements.values().cloned().collect();let mut metrics=DirectMetrics::default();
        for a in &agreements{metrics.payments_recorded+=a.payments_received;metrics.voluntary_refunds_recorded+=a.voluntary_refunds_received;metrics.net_transferred+=a.net_transferred();
            metrics.refund_requests+=u64::from(a.refund_request_digest.is_some());metrics.declined_refunds+=u64::from(a.recipient_declined_refund);metrics.overdue_deliveries+=u64::from(a.delivery_overdue);
            metrics.unresolved_disputes+=u64::from(a.dispute_digest.is_some()&&a.net_transferred()>0);}
        metrics.rejected_commands=engine.journal.iter().filter(|r|matches!(r.outcome,DirectOutcome::Rejected{..})).count() as u64;
        let mut r=Self{schema_version:1,model:"zoora-direct-workflow/0.1.0".into(),classification:"SYNTHETIC".into(),payment_mode:"DIRECT_USER_WALLET".into(),config:engine.config.clone(),wallet_boundary:WalletBoundary::default(),agreements,metrics,journal:engine.journal.clone(),fingerprint:String::new()};r.fingerprint=r.hash()?;Ok(r)
    }
    pub fn verify(&self)->Result<()>{
        self.config.validate()?;if self.schema_version!=1||self.model!="zoora-direct-workflow/0.1.0"||self.classification!="SYNTHETIC"||self.payment_mode!="DIRECT_USER_WALLET"||self.wallet_boundary!=WalletBoundary::default()
            ||self.agreements.len()>self.config.max_agreements||self.journal.len()>MAX_EVENTS||self.fingerprint!=self.hash()?{return Err(SimulationError::Replay("direct identity, boundary or fingerprint differs"));}
        let mut e=DirectEngine::new(self.config.clone())?;for r in &self.journal{
            if matches!(r.command,DirectCommand::Finish{}){if r.simulation_tick!=self.config.ticks-1{return Err(SimulationError::Replay("direct finish tick differs"));}e.finish()?;}
            else{e.record(r.simulation_tick,r.command.clone())?;}
            if e.journal.last()!=Some(r){return Err(SimulationError::Replay("direct record replay differs"));}
        }
        if Self::from_engine(&e)?!=*self{return Err(SimulationError::Replay("direct transcript replay differs"));}Ok(())
    }
    pub fn demo()->Result<Self>{
        let mut e=DirectEngine::new(DirectConfig{agents:2,ticks:10,max_agreements:5})?;
        for id in 0..5{e.record(0,DirectCommand::Agree{terms:Terms{agreement_id:id,client:0,provider:1,title:["Accepted delivery","Refund declined","Voluntary full refund","No delivery / no refund","Partial voluntary refund"][id as usize].into(),asset:"SYNTHETIC_UNIT".into(),amount:100,delivery_deadline:8,criteria_digest:"c".repeat(64)}})?;}
        for id in 0..5{e.record(1,DirectCommand::PaymentReceipt{receipt:Receipt::synthetic(id,0,0,1,100,1)})?;}
        e.record(3,DirectCommand::Deliver{agreement_id:0,provider:1,artifact_digest:"a".repeat(64)})?;e.record(4,DirectCommand::Acknowledge{agreement_id:0,client:0})?;
        for id in [1,2,4]{e.record(4,DirectCommand::Dispute{agreement_id:id,client:0,reason_digest:"d".repeat(64)})?;}
        for id in [1,2,4]{e.record(5,DirectCommand::RequestRefund{agreement_id:id,client:0,amount:100,reason_digest:"f".repeat(64)})?;}
        e.record(6,DirectCommand::DeclineRefund{agreement_id:1,provider:1})?;
        e.record(6,DirectCommand::VoluntaryRefundReceipt{receipt:Receipt::synthetic(2,1,1,0,40,6)})?;e.record(6,DirectCommand::VoluntaryRefundReceipt{receipt:Receipt::synthetic(4,1,1,0,50,6)})?;
        e.record(7,DirectCommand::VoluntaryRefundReceipt{receipt:Receipt::synthetic(2,2,1,0,60,7)})?;e.finish()?;Self::from_engine(&e)
    }
}
