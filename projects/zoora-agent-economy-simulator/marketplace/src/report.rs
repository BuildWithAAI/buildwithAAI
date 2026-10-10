use std::{fmt, io::{self,Write},marker::PhantomData};
use serde::{Deserialize, Serialize, de::{self,SeqAccess,Visitor}};
use sha2::{Digest,Sha256};
use zoora_agent_economy_simulator::{SimulationError,RNG_ALGORITHM};
use crate::{config::{MarketConfig,MAX_EVENTS},engine::{MarketEngine,MarketState,Scenario},metrics::MarketMetrics,types::Record};
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketReport {
    pub schema_version:u32,
    pub model:String,
    pub classification:String,
    pub units:String,
    pub rng:String,
    pub scenario:Scenario,
    pub config:MarketConfig,
    pub final_state:MarketState,
    pub metrics:MarketMetrics,
    #[serde(deserialize_with="bounded_records")]
    pub journal:Vec<Record>,
    pub fingerprint:String,
}
struct HashWriter(Sha256);
impl Write for HashWriter {
    fn write(&mut self,bytes:&[u8])->io::Result<usize>{self.0.update(bytes);Ok(bytes.len())}
    fn flush(&mut self)->io::Result<()>{Ok(())}
}
fn hash_payload(report:&MarketReport)->Result<String,SimulationError>{
    let mut writer=HashWriter(Sha256::new());
    writer.0.update(b"ZOORA_AE002_JSON_FINGERPRINT_V1\0");
    // Schema-owned tuple order and compact UTF-8 JSON; no floating-point numbers or map ambiguity.
    serde_json::to_writer(&mut writer,&(report.schema_version,&report.model,&report.classification,&report.units,&report.rng,report.scenario,&report.config,&report.final_state,&report.metrics,&report.journal)).map_err(|_|SimulationError::Integrity("fingerprint encoding failed"))?;
    Ok(format!("{:x}",writer.0.finalize()))
}
fn bounded_records<'de,D:de::Deserializer<'de>>(deserializer:D)->Result<Vec<Record>,D::Error>{
    bounded_vec::<D,Record,MAX_EVENTS>(deserializer)
}
pub(crate) fn bounded_vec<'de,D,T,const LIMIT:usize>(deserializer:D)->Result<Vec<T>,D::Error>
where D:de::Deserializer<'de>,T:Deserialize<'de>{
    struct Bounded<T,const N:usize>(PhantomData<T>);
    impl<'de,T:Deserialize<'de>,const N:usize> Visitor<'de> for Bounded<T,N>{
        type Value=Vec<T>;
        fn expecting(&self,f:&mut fmt::Formatter)->fmt::Result{write!(f,"an array with at most {N} entries")}
        fn visit_seq<A:SeqAccess<'de>>(self,mut seq:A)->Result<Vec<T>,A::Error>{
            let mut values=Vec::new();
            while let Some(value)=seq.next_element()?{if values.len()==N{return Err(de::Error::custom("array capacity exceeded"));}values.push(value);}
            Ok(values)
        }
    }
    deserializer.deserialize_seq(Bounded::<T,LIMIT>(PhantomData))
}
impl MarketReport {
    pub fn from_engine(engine:&MarketEngine)->Result<Self,SimulationError>{
        if !engine.is_finished(){return Err(SimulationError::Integrity("report requires a completed healthy engine"));}
        engine.audit()?;
        let mut report=Self{schema_version:1,model:format!("zoora-task-market/{}",env!("CARGO_PKG_VERSION")),classification:"SYNTHETIC".into(),units:"SIMULATED_UNITS".into(),rng:RNG_ALGORITHM.into(),scenario:engine.scenario(),config:engine.config().clone(),final_state:engine.state(),metrics:engine.metrics().clone(),journal:engine.journal().to_vec(),fingerprint:String::new()};
        report.fingerprint=hash_payload(&report)?;Ok(report)
    }
    pub fn verify(&self)->Result<(),SimulationError>{
        self.config.validate()?;
        if self.schema_version!=1 || self.model!=format!("zoora-task-market/{}",env!("CARGO_PKG_VERSION")) || self.classification!="SYNTHETIC" || self.units!="SIMULATED_UNITS" || self.rng!=RNG_ALGORITHM {return Err(SimulationError::Replay("unsupported report identity"));}
        if self.final_state.accounts.len()!=self.config.agent_count || self.final_state.tasks.len()>self.config.max_tasks || hash_payload(self)?!=self.fingerprint {return Err(SimulationError::Replay("report fingerprint or dimensions differ"));}
        let replay=MarketEngine::replay(self.config.clone(),self.scenario,&self.journal)?;
        if Self::from_engine(&replay)?!=*self {return Err(SimulationError::Replay("replayed report differs"));}
        if self.scenario==Scenario::NormalTaskMarketV1 {
            let mut normal=MarketEngine::new(self.config.clone())?;normal.run_scenario()?;
            if Self::from_engine(&normal)?!=*self {return Err(SimulationError::Replay("seeded scenario differs"));}
        }
        Ok(())
    }
}
