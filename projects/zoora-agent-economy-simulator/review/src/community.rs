//! Bounded offline community records. Actor/operator/wallet labels are declared fixtures, not authentication.
use crate::{allocation::fingerprint, direct::{DirectCommand, DirectConfig, DirectEngine, DirectOutcome, DirectReport, Terms}};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use zoora_agent_economy_simulator::SimulationError;
use zoora_task_market::types::valid_digest;
type Result<T> = std::result::Result<T, SimulationError>;
pub const MAX_EVENTS: usize = 50_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommunityConfig {
    pub agents: usize,
    pub ticks: u64,
    pub max_projects: usize,
    pub max_offers: usize,
    pub max_orders: usize,
    pub max_posts: usize,
    pub max_pending_per_provider: usize,
    pub posts_per_agent_per_tick: usize,
}
impl Default for CommunityConfig {
    fn default() -> Self {
        Self { agents: 32, ticks: 12, max_projects: 1000, max_offers: 1000, max_orders: 5000,
            max_posts: 10_000, max_pending_per_provider: 16, posts_per_agent_per_tick: 3 }
    }
}
impl CommunityConfig {
    pub fn validate(&self) -> Result<()> {
        if !(2..=5000).contains(&self.agents) || !(3..=100_000).contains(&self.ticks)
            || !(1..=1000).contains(&self.max_projects) || !(1..=5000).contains(&self.max_offers)
            || !(1..=5000).contains(&self.max_orders) || !(1..=10_000).contains(&self.max_posts)
            || !(1..=5000).contains(&self.max_pending_per_provider)
            || !(1..=100).contains(&self.posts_per_agent_per_tick) {
            return Err(SimulationError::Configuration("invalid bounded community dimensions"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="type", rename_all="SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Actor { Agent { agent_id: u64 }, Operator { operator_id: u64 }, Simulation {} }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    pub agent_id: u64,
    pub operator_id: u64,
    pub handle: String,
    pub wallet_label: String,
    #[serde(deserialize_with="bounded_tags")]
    pub capabilities: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandleChange { pub handle: String, pub simulation_tick: u64 }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentProfile {
    pub registration: Registration,
    pub active: bool,
    #[serde(deserialize_with="bounded_handles")]
    pub handle_history: Vec<HandleChange>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub project_id: u64, pub owner: u64, pub title: String, pub summary: String,
    #[serde(deserialize_with="bounded_members")]
    pub contributors: Vec<u64>,
    #[serde(deserialize_with="bounded_artifacts")]
    pub artifacts: Vec<Artifact>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artifact { pub agent_id: u64, pub digest: String, pub simulation_tick: u64 }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Post {
    pub post_id: u64, pub author: u64, pub project_id: Option<u64>, pub reply_to: Option<u64>,
    pub body: String, pub simulation_tick: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Offer {
    pub offer_id: u64, pub provider: u64, pub project_id: u64, pub title: String,
    pub criteria_digest: String, pub amount: u64, pub delivery_ticks: u64, pub active: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderLink {
    pub agreement_id: u64, pub offer_id: u64, pub project_id: u64,
    pub client: u64, pub provider: u64, pub accepted_tick: u64, pub related_operator: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="type", rename_all="SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommunityCommand {
    Register { registration: Registration },
    Rename { agent_id: u64, handle: String },
    SetActive { agent_id: u64, active: bool },
    CreateProject { project_id: u64, title: String, summary: String },
    AddContributor { project_id: u64, agent_id: u64 },
    PublishArtifact { project_id: u64, digest: String },
    Post { post_id: u64, project_id: Option<u64>, reply_to: Option<u64>, body: String },
    PublishOffer { offer_id: u64, project_id: u64, title: String, criteria_digest: String, amount: u64, delivery_ticks: u64 },
    WithdrawOffer { offer_id: u64 },
    AcceptOffer { offer_id: u64, agreement_id: u64 },
    Workflow { command: DirectCommand },
    Finish {},
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
pub enum Rejection { InvalidIdentity, DuplicateIdentity, HandleReserved, WalletReserved, UnknownAgent,
    WrongActor, InactiveAgent, InvalidContent, UnknownProject, NotContributor, DuplicateRecord,
    UnknownOffer, OfferUnavailable, InvalidTerms, UnknownOrder, ProviderCapacity, PostRateLimit, Capacity, EngineOwned }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="status", rename_all="SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CommunityOutcome { Applied {}, Rejected { reason: Rejection }, Forwarded { direct_event_id: u64, direct_outcome: DirectOutcome } }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommunityRecord { pub event_id: u64, pub simulation_tick: u64, pub actor: Actor,
    pub command: CommunityCommand, pub outcome: CommunityOutcome }

macro_rules! bounded {
    ($name:ident,$typ:ty,$max:expr) => {
        fn $name<'de,D:serde::de::Deserializer<'de>>(d:D)->std::result::Result<Vec<$typ>,D::Error>{crate::bounded::vec::<D,$typ,$max>(d)}
    };
}
bounded!(bounded_tags,String,8);
bounded!(bounded_handles,HandleChange,32);
bounded!(bounded_members,u64,5000);
bounded!(bounded_artifacts,Artifact,100);
bounded!(bounded_agents,AgentProfile,5000);
bounded!(bounded_projects,Project,1000);
bounded!(bounded_offers,Offer,5000);
bounded!(bounded_orders,OrderLink,5000);
bounded!(bounded_posts,Post,10_000);
bounded!(bounded_journal,CommunityRecord,MAX_EVENTS);

fn handle_valid(value: &str) -> bool {
    (3..=32).contains(&value.len()) && value.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c==b'_')
}
fn content_valid(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len()<=max && !value.chars().any(|c| c.is_control() && c!='\n' && c!='\t')
}
fn fixture_wallet(value: &str) -> bool {
    value.strip_prefix("synthetic-wallet-").is_some_and(|tail| !tail.is_empty() && tail.len()<=20 && tail.bytes().all(|c|c.is_ascii_digit()))
}

pub struct CommunityEngine {
    config: CommunityConfig,
    agents: BTreeMap<u64, AgentProfile>,
    handles: BTreeSet<String>,
    wallets: BTreeSet<String>,
    projects: BTreeMap<u64, Project>,
    posts: BTreeMap<u64, Post>,
    offers: BTreeMap<u64, Offer>,
    orders: BTreeMap<u64, OrderLink>,
    post_counts: BTreeMap<(u64,u64),usize>,
    journal: Vec<CommunityRecord>,
    direct: DirectEngine,
    clock: u64,
    finished: bool,
    faulted: bool,
    peak_pending: BTreeMap<u64,usize>,
}
impl CommunityEngine {
    pub fn new(config: CommunityConfig) -> Result<Self> {
        config.validate()?;
        let direct=DirectEngine::new(DirectConfig { agents:config.agents as u64,ticks:config.ticks,max_agreements:config.max_orders })?;
        Ok(Self { config,agents:BTreeMap::new(),handles:BTreeSet::new(),wallets:BTreeSet::new(),projects:BTreeMap::new(),posts:BTreeMap::new(),
            offers:BTreeMap::new(),orders:BTreeMap::new(),post_counts:BTreeMap::new(),journal:Vec::new(),direct,clock:0,finished:false,faulted:false,peak_pending:BTreeMap::new() })
    }
    pub fn profile(&self,id:u64)->Option<&AgentProfile>{self.agents.get(&id)}
    pub fn agreement(&self,id:u64)->Option<&crate::direct::Agreement>{self.direct.agreement(id)}
    pub fn journal(&self)->&[CommunityRecord]{&self.journal}
    pub fn pending(&self,provider:u64,tick:u64)->usize {
        self.orders.values().filter(|o|o.provider==provider).filter(|o|self.direct.agreement(o.agreement_id).is_some_and(|a|
            a.terms.delivery_deadline>tick && a.delivery_digest.is_none() && (a.payments_received==0 || a.net_transferred()>0))).count()
    }
    fn active_actor(&self,actor:Actor)->std::result::Result<u64,Rejection>{
        let Actor::Agent{agent_id}=actor else{return Err(Rejection::WrongActor)};
        let profile=self.agents.get(&agent_id).ok_or(Rejection::UnknownAgent)?;
        if !profile.active{return Err(Rejection::InactiveAgent)}
        Ok(agent_id)
    }
    fn controls(&self,actor:Actor,id:u64)->bool {
        self.agents.get(&id).is_some_and(|p| match actor {
            Actor::Agent{agent_id}=>agent_id==id && p.active,
            Actor::Operator{operator_id}=>operator_id==p.registration.operator_id,
            Actor::Simulation{}=>false,
        })
    }
    fn forward(&mut self,tick:u64,command:DirectCommand)->Result<CommunityOutcome>{
        self.direct.record(tick,command)?;
        let record=self.direct.journal().last().ok_or(SimulationError::Integrity("missing direct adapter record"))?;
        Ok(CommunityOutcome::Forwarded{direct_event_id:record.event_id,direct_outcome:record.outcome.clone()})
    }
    pub fn record(&mut self,tick:u64,actor:Actor,command:CommunityCommand)->Result<()> {
        if self.finished || self.faulted || tick<self.clock || tick>=self.config.ticks || matches!(actor,Actor::Simulation{}) || matches!(command,CommunityCommand::Finish{}) {
            return Err(SimulationError::Integrity("community closed, past, or engine-owned event"));
        }
        if self.journal.len()>=MAX_EVENTS-1{return Err(SimulationError::Capacity("community event budget exhausted"))}
        // Bound every caller-controlled string/vector before it enters the retained journal.
        if !command.bounded(){return Err(SimulationError::Capacity("community input exceeds bounds"))}
        let outcome=match self.apply(tick,actor,&command){
            Ok(o)=>o,
            Err(error)=>{self.faulted=true;return Err(error)}
        };
        self.clock=tick;
        self.journal.push(CommunityRecord {event_id:self.journal.len() as u64,simulation_tick:tick,actor,command,outcome});
        let mut pending_by_provider=BTreeMap::<u64,usize>::new();
        for order in self.orders.values() {
            if self.direct.agreement(order.agreement_id).is_some_and(|a|a.terms.delivery_deadline>tick && a.delivery_digest.is_none() && (a.payments_received==0 || a.net_transferred()>0)) {
                *pending_by_provider.entry(order.provider).or_default()+=1;
            }
        }
        for (id,pending) in pending_by_provider {
            let peak=self.peak_pending.entry(id).or_default();*peak=(*peak).max(pending);
        }
        Ok(())
    }
    fn apply(&mut self,tick:u64,actor:Actor,command:&CommunityCommand)->Result<CommunityOutcome>{
        use CommunityCommand::*;use Rejection::*;
        let reject=|reason|Ok(CommunityOutcome::Rejected{reason});
        let actor_agent=||self.active_actor(actor);
        match command {
            Register{registration:r}=>{
                if actor!=(Actor::Operator{operator_id:r.operator_id}){return reject(WrongActor)}
                if r.agent_id>=self.config.agents as u64 || r.operator_id>=self.config.agents as u64 || !handle_valid(&r.handle) || !fixture_wallet(&r.wallet_label)
                    || r.capabilities.is_empty() || r.capabilities.len()>8 || r.capabilities.iter().any(|c|!handle_valid(c)) || r.capabilities.iter().collect::<BTreeSet<_>>().len()!=r.capabilities.len(){return reject(InvalidIdentity)}
                if self.agents.contains_key(&r.agent_id){return reject(DuplicateIdentity)}
                if self.handles.contains(&r.handle){return reject(HandleReserved)}
                if self.wallets.contains(&r.wallet_label){return reject(WalletReserved)}
                self.handles.insert(r.handle.clone());self.wallets.insert(r.wallet_label.clone());
                self.agents.insert(r.agent_id,AgentProfile { registration:r.clone(),active:true,handle_history:vec![HandleChange{handle:r.handle.clone(),simulation_tick:tick}] });
            }
            Rename{agent_id,handle}=>{
                if !self.agents.contains_key(agent_id){return reject(UnknownAgent)}
                if !self.controls(actor,*agent_id){return reject(WrongActor)}
                if !handle_valid(handle){return reject(InvalidIdentity)}
                if self.handles.contains(handle){return reject(HandleReserved)}
                let p=self.agents.get_mut(agent_id).expect("profile checked");
                if p.handle_history.len()>=32{return reject(Capacity)}
                p.registration.handle=handle.clone();p.handle_history.push(HandleChange{handle:handle.clone(),simulation_tick:tick});self.handles.insert(handle.clone());
            }
            SetActive{agent_id,active}=>{
                let Some(p)=self.agents.get_mut(agent_id) else{return reject(UnknownAgent)};
                if actor!=(Actor::Operator{operator_id:p.registration.operator_id}){return reject(WrongActor)}
                p.active=*active;
            }
            CreateProject{project_id,title,summary}=>{
                let id=match actor_agent(){Ok(id)=>id,Err(r)=>return reject(r)};
                if !content_valid(title,128) || !content_valid(summary,512){return reject(InvalidContent)}
                if self.projects.contains_key(project_id){return reject(DuplicateRecord)}
                if self.projects.len()>=self.config.max_projects{return reject(Capacity)}
                self.projects.insert(*project_id,Project{project_id:*project_id,owner:id,title:title.clone(),summary:summary.clone(),contributors:vec![id],artifacts:Vec::new()});
            }
            AddContributor{project_id,agent_id}=>{
                let id=match actor_agent(){Ok(id)=>id,Err(r)=>return reject(r)};
                let Some(p)=self.projects.get(project_id) else{return reject(UnknownProject)};
                if p.owner!=id{return reject(WrongActor)}
                if !self.agents.get(agent_id).is_some_and(|a|a.active){return reject(InactiveAgent)}
                if p.contributors.contains(agent_id){return reject(DuplicateRecord)}
                let p=self.projects.get_mut(project_id).expect("project checked");p.contributors.push(*agent_id);p.contributors.sort_unstable();
            }
            PublishArtifact{project_id,digest}=>{
                let id=match actor_agent(){Ok(id)=>id,Err(r)=>return reject(r)};
                let Some(p)=self.projects.get_mut(project_id) else{return reject(UnknownProject)};
                if !p.contributors.contains(&id){return reject(NotContributor)}
                if !valid_digest(digest){return reject(InvalidContent)}
                if p.artifacts.len()>=100{return reject(Capacity)}
                if p.artifacts.iter().any(|a|a.digest==*digest){return reject(DuplicateRecord)}
                p.artifacts.push(Artifact{agent_id:id,digest:digest.clone(),simulation_tick:tick});
            }
            Post{post_id,project_id,reply_to,body}=>{
                let id=match actor_agent(){Ok(id)=>id,Err(r)=>return reject(r)};
                if !content_valid(body,512){return reject(InvalidContent)}
                if self.posts.contains_key(post_id){return reject(DuplicateRecord)}
                if self.posts.len()>=self.config.max_posts{return reject(Capacity)}
                if project_id.is_some_and(|id|!self.projects.contains_key(&id)){return reject(UnknownProject)}
                if let Some(parent)=reply_to {
                    let Some(p)=self.posts.get(parent) else{return reject(DuplicateRecord)};
                    if p.project_id!=*project_id{return reject(InvalidContent)}
                }
                let key=(tick,id);let count=self.post_counts.entry(key).or_default();
                if *count>=self.config.posts_per_agent_per_tick{return reject(PostRateLimit)}
                *count+=1;
                self.posts.insert(*post_id,Post{post_id:*post_id,author:id,project_id:*project_id,reply_to:*reply_to,body:body.clone(),simulation_tick:tick});
            }
            PublishOffer{offer_id,project_id,title,criteria_digest,amount,delivery_ticks}=>{
                let id=match actor_agent(){Ok(id)=>id,Err(r)=>return reject(r)};
                let Some(p)=self.projects.get(project_id) else{return reject(UnknownProject)};
                if !p.contributors.contains(&id){return reject(NotContributor)}
                if !content_valid(title,128) || !valid_digest(criteria_digest) || *amount==0 || *delivery_ticks==0 || *delivery_ticks>=self.config.ticks{return reject(InvalidTerms)}
                if self.offers.contains_key(offer_id){return reject(DuplicateRecord)}
                if self.offers.len()>=self.config.max_offers{return reject(Capacity)}
                self.offers.insert(*offer_id,Offer{offer_id:*offer_id,provider:id,project_id:*project_id,title:title.clone(),criteria_digest:criteria_digest.clone(),amount:*amount,delivery_ticks:*delivery_ticks,active:true});
            }
            WithdrawOffer{offer_id}=>{
                let Some(o)=self.offers.get(offer_id) else{return reject(UnknownOffer)};
                if !self.controls(actor,o.provider){return reject(WrongActor)}
                self.offers.get_mut(offer_id).expect("offer checked").active=false;
            }
            AcceptOffer{offer_id,agreement_id}=>{
                let client=match actor_agent(){Ok(id)=>id,Err(r)=>return reject(r)};
                let Some(o)=self.offers.get(offer_id).cloned() else{return reject(UnknownOffer)};
                if !o.active || !self.agents.get(&o.provider).is_some_and(|p|p.active){return reject(OfferUnavailable)}
                if client==o.provider{return reject(InvalidTerms)}
                if self.orders.contains_key(agreement_id){return reject(DuplicateRecord)}
                if self.orders.len()>=self.config.max_orders{return reject(Capacity)}
                let Some(deadline)=tick.checked_add(o.delivery_ticks).filter(|d|*d<self.config.ticks) else{return reject(InvalidTerms)};
                if self.pending(o.provider,tick)>=self.config.max_pending_per_provider{return reject(ProviderCapacity)}
                let outcome=self.forward(tick,DirectCommand::Agree{terms:Terms{agreement_id:*agreement_id,client,provider:o.provider,title:o.title.clone(),asset:"SYNTHETIC_UNIT".into(),amount:o.amount,delivery_deadline:deadline,criteria_digest:o.criteria_digest.clone()}})?;
                if !matches!(outcome,CommunityOutcome::Forwarded{direct_outcome:DirectOutcome::Recorded{},..}){return Err(SimulationError::Integrity("validated order rejected by direct adapter"))}
                let related_operator=self.agents[&client].registration.operator_id==self.agents[&o.provider].registration.operator_id;
                self.orders.insert(*agreement_id,OrderLink{agreement_id:*agreement_id,offer_id:*offer_id,project_id:o.project_id,client,provider:o.provider,accepted_tick:tick,related_operator});
                return Ok(outcome);
            }
            Workflow{command}=>{
                let (order_id,party,observation)=match command {
                    DirectCommand::PaymentReceipt{receipt}|DirectCommand::VoluntaryRefundReceipt{receipt}=>(receipt.agreement_id,receipt.sender,true),
                    DirectCommand::Deliver{agreement_id,provider,..}|DirectCommand::DeclineRefund{agreement_id,provider}=>(*agreement_id,*provider,false),
                    DirectCommand::Acknowledge{agreement_id,client}|DirectCommand::Dispute{agreement_id,client,..}|DirectCommand::RequestRefund{agreement_id,client,..}=>(*agreement_id,*client,false),
                    DirectCommand::Agree{..}|DirectCommand::Finish{}=>return reject(EngineOwned),
                };
                let Some(order)=self.orders.get(&order_id) else{return reject(UnknownOrder)};
                if party!=order.client && party!=order.provider{return reject(WrongActor)}
                if actor!=(Actor::Agent{agent_id:party}){return reject(WrongActor)}
                // Deactivation is a posting/admission restriction, not a denial of observed transfer facts.
                if !observation && !self.agents[&party].active{return reject(InactiveAgent)}
                return self.forward(tick,command.clone());
            }
            Finish{}=>return reject(EngineOwned),
        }
        Ok(CommunityOutcome::Applied{})
    }
    pub fn finish(&mut self)->Result<()> {
        if self.finished || self.faulted{return Err(SimulationError::Integrity("community already closed or faulted"))}
        if let Err(e)=self.direct.finish(){self.faulted=true;return Err(e)}
        self.clock=self.config.ticks-1;
        self.journal.push(CommunityRecord{event_id:self.journal.len() as u64,simulation_tick:self.clock,actor:Actor::Simulation{},command:CommunityCommand::Finish{},outcome:CommunityOutcome::Applied{}});
        self.finished=true;Ok(())
    }
}
impl CommunityCommand {
    fn bounded(&self)->bool {
        use CommunityCommand::*;
        match self {
            Register{registration:r}=>r.handle.len()<=32 && r.wallet_label.len()<=64 && r.capabilities.len()<=8 && r.capabilities.iter().all(|c|c.len()<=32),
            Rename{handle,..}=>handle.len()<=32,
            CreateProject{title,summary,..}=>title.len()<=128 && summary.len()<=512,
            PublishArtifact{digest,..}=>digest.len()<=64,
            Post{body,..}=>body.len()<=512,
            PublishOffer{title,criteria_digest,..}=>title.len()<=128 && criteria_digest.len()<=64,
            Workflow{command}=>match command {
                DirectCommand::PaymentReceipt{receipt}|DirectCommand::VoluntaryRefundReceipt{receipt}=>receipt.transaction_ref.len()<=64 && receipt.asset.len()<=64 && receipt.source.len()<=64 && receipt.classification.len()<=16 && receipt.commitment.len()<=32,
                DirectCommand::Deliver{artifact_digest,..}=>artifact_digest.len()<=64,
                DirectCommand::Dispute{reason_digest,..}|DirectCommand::RequestRefund{reason_digest,..}=>reason_digest.len()<=64,
                DirectCommand::Agree{terms}=>terms.title.len()<=128 && terms.asset.len()<=64 && terms.criteria_digest.len()<=64,
                _=>true,
            },
            _=>true,
        }
    }
}

#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub source: String, pub time_basis: String, pub observed_at: Option<String>, pub available_at: Option<String>,
    pub slot: Option<u64>, pub commitment: String, pub transformation_version: u32, pub quality_flags: Vec<String>,
}
impl Default for Provenance {
    fn default()->Self{Self{source:"OFFLINE_COMMUNITY_TRANSCRIPT_V1".into(),time_basis:"SIMULATION_TICKS".into(),observed_at:None,available_at:None,slot:None,
        commitment:"SIMULATED_FINAL".into(),transformation_version:1,quality_flags:vec!["SYNTHETIC_INPUTS".into(),"DECLARED_IDENTITIES".into(),"NO_WALL_CLOCK_OR_CHAIN_PROOF".into(),"DELIVERY_QUALITY_UNVERIFIED".into()]}}
}
#[derive(Debug,Clone,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommunityMetrics {
    pub registered_agents:u64, pub active_agents:u64, pub projects:u64, pub artifacts:u64, pub posts:u64, pub offers:u64,
    pub accepted_orders:u64, pub acknowledged_deliveries:u64, pub related_operator_orders:u64,
    pub unpaid_at_finish:u64, pub pending_deliveries_at_finish:u64, pub accepted_order_requests:u64,
    pub rejected_commands:u64, pub provider_capacity_rejections:u64, pub post_rate_rejections:u64,
    pub downstream_rejections:u64, pub peak_pending_by_provider:BTreeMap<u64,usize>,
}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommunityReport {
    pub schema_version:u32,pub model:String,pub classification:String,pub provenance:Provenance,pub config:CommunityConfig,
    #[serde(deserialize_with="bounded_agents")] pub agents:Vec<AgentProfile>,
    #[serde(deserialize_with="bounded_projects")] pub projects:Vec<Project>,
    #[serde(deserialize_with="bounded_posts")] pub posts:Vec<Post>,
    #[serde(deserialize_with="bounded_offers")] pub offers:Vec<Offer>,
    #[serde(deserialize_with="bounded_orders")] pub orders:Vec<OrderLink>,
    pub direct:DirectReport,pub metrics:CommunityMetrics,
    #[serde(deserialize_with="bounded_journal")] pub journal:Vec<CommunityRecord>,pub fingerprint:String,
}
impl CommunityReport {
    pub fn hash(&self)->Result<String>{fingerprint(b"ZOORA_AE005_COMMUNITY_V1\0",&(self.schema_version,&self.model,&self.classification,&self.provenance,&self.config,&self.agents,&self.projects,&self.posts,&self.offers,&self.orders,&self.direct,&self.metrics,&self.journal))}
    pub fn from_engine(e:&CommunityEngine)->Result<Self>{
        if !e.finished || e.faulted{return Err(SimulationError::Integrity("community requires healthy finished transcript"))}
        let direct=DirectReport::from_engine(&e.direct)?;
        let mut metrics=CommunityMetrics { registered_agents:e.agents.len() as u64,active_agents:e.agents.values().filter(|p|p.active).count() as u64,
            projects:e.projects.len() as u64,artifacts:e.projects.values().map(|p|p.artifacts.len() as u64).sum(),posts:e.posts.len() as u64,offers:e.offers.len() as u64,
            accepted_orders:e.orders.len() as u64,related_operator_orders:e.orders.values().filter(|o|o.related_operator).count() as u64,
            acknowledged_deliveries:direct.agreements.iter().filter(|a|a.delivery_acknowledged).count() as u64,
            unpaid_at_finish:direct.agreements.iter().filter(|a|a.payments_received==0).count() as u64,
            pending_deliveries_at_finish:direct.agreements.iter().filter(|a|a.delivery_digest.is_none() && a.net_transferred()>0).count() as u64,
            peak_pending_by_provider:e.peak_pending.clone(),..CommunityMetrics::default() };
        for r in &e.journal {
            if matches!(r.command,CommunityCommand::AcceptOffer{..}){metrics.accepted_order_requests+=1}
            match r.outcome {
                CommunityOutcome::Rejected{reason}=>{metrics.rejected_commands+=1;if reason==Rejection::ProviderCapacity{metrics.provider_capacity_rejections+=1}if reason==Rejection::PostRateLimit{metrics.post_rate_rejections+=1}}
                CommunityOutcome::Forwarded{direct_outcome:DirectOutcome::Rejected{..},..}=>{metrics.rejected_commands+=1;metrics.downstream_rejections+=1}
                _=>{},
            }
        }
        let mut report=Self {schema_version:1,model:"zoora-agent-community/0.1.0".into(),classification:"SYNTHETIC".into(),provenance:Provenance::default(),config:e.config.clone(),
            agents:e.agents.values().cloned().collect(),projects:e.projects.values().cloned().collect(),posts:e.posts.values().cloned().collect(),offers:e.offers.values().cloned().collect(),orders:e.orders.values().cloned().collect(),direct,metrics,journal:e.journal.clone(),fingerprint:String::new()};
        report.fingerprint=report.hash()?;Ok(report)
    }
    pub fn verify(&self)->Result<()> {
        self.config.validate()?;
        if self.schema_version!=1 || self.model!="zoora-agent-community/0.1.0" || self.classification!="SYNTHETIC" || self.provenance!=Provenance::default()
            || self.fingerprint!=self.hash()? {return Err(SimulationError::Replay("community identity, provenance or hash differs"))}
        self.direct.verify()?;
        let mut engine=CommunityEngine::new(self.config.clone())?;
        for r in &self.journal {
            if matches!(r.command,CommunityCommand::Finish{}) {
                if r.actor!=(Actor::Simulation{}) || r.simulation_tick!=self.config.ticks-1{return Err(SimulationError::Replay("community finish differs"))}
                engine.finish()?;
            }else{engine.record(r.simulation_tick,r.actor,r.command.clone())?}
            if engine.journal.last()!=Some(r){return Err(SimulationError::Replay("community record replay differs"))}
        }
        if Self::from_engine(&engine)?!=*self{return Err(SimulationError::Replay("community state replay differs"))}
        Ok(())
    }
}
