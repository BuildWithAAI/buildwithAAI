use serde::{Deserialize,Serialize};
use std::collections::BTreeSet;
use zoora_task_market::MarketConfig;
use zoora_agent_economy_simulator::SimulationError;
pub const MAX_EVENTS:usize=50_000;
pub const MAX_OPERATIONS:usize=100_000;
pub const MAX_TASKS:usize=5_000;
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewConfig {
    pub market:MarketConfig,
    #[serde(deserialize_with="bounded_operators")]
    pub operators:Vec<u64>,
    pub appeal_ticks:u64,
    pub refund_bps:u32,
    pub dispute_bps:u32,
    pub appeal_bps:u32,
    pub overturn_bps:u32,
    pub missing_review_bps:u32,
    pub missing_appeal_bps:u32,
}
fn bounded_operators<'de,D:serde::de::Deserializer<'de>>(d:D)->Result<Vec<u64>,D::Error>{crate::bounded::vec::<D,u64,100_000>(d)}
impl Default for ReviewConfig {
    fn default()->Self{Self{market:MarketConfig{ticks:10,max_tasks:1000,..MarketConfig::default()},operators:(0..100).collect(),appeal_ticks:2,refund_bps:2500,dispute_bps:3000,appeal_bps:4000,overturn_bps:5000,missing_review_bps:1000,missing_appeal_bps:1500}}
}
impl ReviewConfig {
    pub fn validate(&self)->Result<(),SimulationError>{
        self.market.validate()?;
        if self.operators.len()!=self.market.agent_count || self.market.max_tasks>MAX_TASKS || self.appeal_ticks==0 || self.appeal_ticks>=self.market.ticks {return Err(SimulationError::Configuration("invalid review dimensions or appeal window"));}
        if [self.refund_bps,self.dispute_bps,self.appeal_bps,self.overturn_bps,self.missing_review_bps,self.missing_appeal_bps].iter().any(|v|*v>10000) {return Err(SimulationError::Configuration("invalid review basis-point rate"));}
        if self.market.scenario_tasks>0 && (self.market.ticks<10 || self.appeal_ticks!=2 || self.operators.iter().copied().collect::<BTreeSet<_>>().len()<4) {return Err(SimulationError::Configuration("normal scenario needs ten ticks, four operator groups and a two-tick appeal window"));}
        Ok(())
    }
    pub fn from_toml(text:&str)->Result<Self,SimulationError>{let config:Self=toml::from_str(text).map_err(|_|SimulationError::Configuration("invalid review TOML"))?;config.validate()?;Ok(config)}
    pub fn operator(&self,account:u64)->Option<u64>{usize::try_from(account).ok().and_then(|index|self.operators.get(index).copied())}
}
