use std::{collections::BTreeMap,io::{self,Write}};
use serde::{Deserialize,Serialize};
use sha2::{Sha256,Digest};
use zoora_agent_economy_simulator::{SimulationError,RNG_ALGORITHM};
use zoora_task_market::{MarketReport,Outcome as MarketOutcome};
use crate::{ReviewConfig,ReviewEngine,Scenario,config::{MAX_EVENTS,MAX_OPERATIONS,MAX_TASKS},types::*};
#[derive(Debug,Clone,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewMetrics {
    pub processed_events:u64,
    pub rejected_commands:u64,
    pub disputes:u64,
    pub primary_verdicts:u64,
    pub appeals:u64,
    pub appeal_verdicts:u64,
    pub overturned_verdicts:u64,
    pub successful_settlements:u64,
    pub blocked_settlements:u64,
    pub deadline_refunds:u64,
    pub decisions_by_reviewer:BTreeMap<u64,u64>,
}
impl ReviewMetrics {
    fn compute(records:&[Record],cases:&[ReviewCase])->Self{
        let mut metrics=Self{processed_events:records.len() as u64,..Self::default()};
        for record in records{match &record.outcome{
            Outcome::Rejected{..}|Outcome::Forwarded{market_outcome:MarketOutcome::Rejected{..},..}=>metrics.rejected_commands+=1,
            Outcome::Disputed{}=>metrics.disputes+=1,
            Outcome::Provisional{reviewer,..}=>{metrics.primary_verdicts+=1;*metrics.decisions_by_reviewer.entry(*reviewer).or_default()+=1;},
            Outcome::Appealed{..}=>metrics.appeals+=1,
            Outcome::Settled{market_outcome,..}=>{
                if let Command::AppealDecision{reviewer,..}=&record.event.command{metrics.appeal_verdicts+=1;*metrics.decisions_by_reviewer.entry(*reviewer).or_default()+=1;}
                if matches!(market_outcome,MarketOutcome::Applied{..}){metrics.successful_settlements+=1;}else{metrics.blocked_settlements+=1;}
            },
            Outcome::Deadline{..}=>metrics.deadline_refunds+=1,
            _=>{}
        }}
        metrics.overturned_verdicts=cases.iter().filter(|case|case.primary_decision.as_ref().zip(case.appeal_decision.as_ref()).is_some_and(|(a,b)|a.verdict!=b.verdict)).count() as u64;
        metrics
    }
}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewReport {
    pub schema_version:u32,
    pub model:String,
    pub classification:String,
    pub policy:String,
    pub rng:String,
    pub scenario:Scenario,
    pub config:ReviewConfig,
    pub market:MarketReport,
    #[serde(deserialize_with="bounded_cases")]
    pub cases:Vec<ReviewCase>,
    pub metrics:ReviewMetrics,
    #[serde(deserialize_with="bounded_operations")]
    pub operations:Vec<Operation>,
    #[serde(deserialize_with="bounded_journal")]
    pub journal:Vec<Record>,
    pub fingerprint:String,
}
fn bounded_cases<'de,D:serde::de::Deserializer<'de>>(d:D)->Result<Vec<ReviewCase>,D::Error>{crate::bounded::vec::<D,ReviewCase,MAX_TASKS>(d)}
fn bounded_operations<'de,D:serde::de::Deserializer<'de>>(d:D)->Result<Vec<Operation>,D::Error>{crate::bounded::vec::<D,Operation,MAX_OPERATIONS>(d)}
fn bounded_journal<'de,D:serde::de::Deserializer<'de>>(d:D)->Result<Vec<Record>,D::Error>{crate::bounded::vec::<D,Record,MAX_EVENTS>(d)}
struct HashWriter(Sha256);
impl Write for HashWriter{fn write(&mut self,bytes:&[u8])->io::Result<usize>{self.0.update(bytes);Ok(bytes.len())}fn flush(&mut self)->io::Result<()>{Ok(())}}
impl ReviewReport {
    fn hash(&self)->Result<String,SimulationError>{
        let mut writer=HashWriter(Sha256::new());writer.0.update(b"ZOORA_AE003_JSON_FINGERPRINT_V1\0");
        serde_json::to_writer(&mut writer,&(self.schema_version,&self.model,&self.classification,&self.policy,&self.rng,self.scenario,&self.config,&self.market,&self.cases,&self.metrics,&self.operations,&self.journal)).map_err(|_|SimulationError::Integrity("review fingerprint encoding failed"))?;Ok(format!("{:x}",writer.0.finalize()))
    }
    pub fn from_engine(engine:&ReviewEngine)->Result<Self,SimulationError>{
        if !engine.is_finished(){return Err(SimulationError::Integrity("review report requires completed healthy engine"));}engine.audit()?;
        let cases=engine.cases();let journal=engine.journal().to_vec();let metrics=ReviewMetrics::compute(&journal,&cases);
        let mut report=Self{schema_version:1,model:format!("zoora-review-market/{}",env!("CARGO_PKG_VERSION")),classification:"SYNTHETIC".into(),policy:"DECLARED_OPERATOR_REVIEW_ONE_APPEAL_V1".into(),rng:RNG_ALGORITHM.into(),scenario:engine.scenario(),config:engine.config().clone(),market:engine.market_report()?,cases,metrics,operations:engine.operations().to_vec(),journal,fingerprint:String::new()};report.fingerprint=report.hash()?;Ok(report)
    }
    pub fn verify(&self)->Result<(),SimulationError>{
        self.config.validate()?;
        if self.schema_version!=1 || self.model!=format!("zoora-review-market/{}",env!("CARGO_PKG_VERSION")) || self.classification!="SYNTHETIC" || self.policy!="DECLARED_OPERATOR_REVIEW_ONE_APPEAL_V1" || self.rng!=RNG_ALGORITHM{return Err(SimulationError::Replay("unsupported review identity"));}
        if self.cases.len()>self.config.market.max_tasks || self.operations.len()>MAX_OPERATIONS || self.journal.len()>MAX_EVENTS || self.fingerprint!=self.hash()?{return Err(SimulationError::Replay("review dimensions or fingerprint differ"));}
        self.market.verify()?;
        let engine=ReviewEngine::from_operations(self.config.clone(),self.scenario,&self.operations)?;
        if Self::from_engine(&engine)?!=*self{return Err(SimulationError::Replay("review operation replay differs"));}
        if self.scenario==Scenario::ReviewMarketV1{let mut normal=ReviewEngine::new(self.config.clone())?;normal.run_scenario()?;if Self::from_engine(&normal)?!=*self{return Err(SimulationError::Replay("seeded review scenario differs"));}}
        Ok(())
    }
}
