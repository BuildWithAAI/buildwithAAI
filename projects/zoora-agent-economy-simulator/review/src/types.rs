use serde::{Deserialize,Serialize};
use zoora_task_market::{Outcome as MarketOutcome,TaskStatus};
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
pub enum Verdict {Approve,Refund}
impl Verdict {pub fn flipped(self)->Self{match self{Self::Approve=>Self::Refund,Self::Refund=>Self::Approve}}}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
pub enum CaseStatus {Open,Accepted,Submitted,Disputed,Provisional,Appealed,Completed,Refunded,Cancelled,Failed,Expired,SettlementBlocked}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {pub reviewer:u64,pub verdict:Verdict,pub artifact_digest:String,pub criteria_digest:String,pub reason_digest:String,pub simulation_tick:u64}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Dispute {pub actor:u64,pub reason_digest:String,pub simulation_tick:u64}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Appeal {pub actor:u64,pub reviewer:u64,pub reason_digest:String,pub simulation_tick:u64}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewCase {pub task_id:u64,pub primary_reviewer:u64,pub status:CaseStatus,pub dispute:Option<Dispute>,pub primary_decision:Option<Decision>,pub appeal:Option<Appeal>,pub appeal_decision:Option<Decision>,pub appeal_closes_at:Option<u64>}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(tag="type",rename_all="SCREAMING_SNAKE_CASE",deny_unknown_fields)]
pub enum Command {
    Post{task_id:u64,client:u64,reviewer:u64,title:String,criteria_digest:String,reward:i64,deadline_tick:u64},
    Accept{task_id:u64,worker:u64},
    Submit{task_id:u64,worker:u64,artifact_digest:String},
    Fail{task_id:u64,worker:u64},
    Cancel{task_id:u64,client:u64},
    Dispute{task_id:u64,client:u64,reason_digest:String},
    Review{task_id:u64,reviewer:u64,verdict:Verdict,artifact_digest:String,criteria_digest:String,reason_digest:String},
    Appeal{task_id:u64,actor:u64,reason_digest:String},
    AppealDecision{task_id:u64,reviewer:u64,verdict:Verdict,artifact_digest:String,criteria_digest:String,reason_digest:String},
    CloseReview{task_id:u64},
    Deadline{task_id:u64},
}
impl Command {
    pub fn task_id(&self)->u64{match self{Self::Post{task_id,..}|Self::Accept{task_id,..}|Self::Submit{task_id,..}|Self::Fail{task_id,..}|Self::Cancel{task_id,..}|Self::Dispute{task_id,..}|Self::Review{task_id,..}|Self::Appeal{task_id,..}|Self::AppealDecision{task_id,..}|Self::CloseReview{task_id}|Self::Deadline{task_id}=>*task_id}}
    pub fn is_timer(&self)->bool{matches!(self,Self::CloseReview{..}|Self::Deadline{..})}
    pub fn needs_timer(&self)->bool{matches!(self,Self::Post{..}|Self::Review{..})}
    pub fn within_bounds(&self)->bool{match self{
        Self::Post{title,criteria_digest,..}=>title.len()<=128 && criteria_digest.len()<=64,
        Self::Submit{artifact_digest,..}=>artifact_digest.len()<=64,
        Self::Dispute{reason_digest,..}|Self::Appeal{reason_digest,..}=>reason_digest.len()<=64,
        Self::Review{artifact_digest,criteria_digest,reason_digest,..}|Self::AppealDecision{artifact_digest,criteria_digest,reason_digest,..}=>artifact_digest.len()<=64 && criteria_digest.len()<=64 && reason_digest.len()<=64,
        _=>true
    }}
}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
pub enum Rejection {InvalidActor,OperatorConflict,UnknownTask,WrongState,UnauthorizedActor,InvalidEvidence,EvidenceMismatch,NoIndependentReviewer,WindowOutsideDeadline}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(tag="status",rename_all="SCREAMING_SNAKE_CASE",deny_unknown_fields)]
pub enum Outcome {
    Forwarded{market_event_id:u64,market_outcome:MarketOutcome},
    Disputed{},
    Provisional{reviewer:u64,closes_at:u64},
    Appealed{reviewer:u64},
    Settled{verdict:Verdict,market_event_id:u64,market_outcome:MarketOutcome},
    Deadline{market_event_id:u64,market_status:TaskStatus},
    Rejected{reason:Rejection},
    TimerNoop{},
}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {pub event_id:u64,pub simulation_tick:u64,pub priority:u32,pub command:Command}
impl Event {pub fn key(&self)->(u64,u32,u64){(self.simulation_tick,self.priority,self.event_id)}}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {pub processed_index:u64,pub event:Event,pub outcome:Outcome}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(tag="operation",rename_all="SCREAMING_SNAKE_CASE",deny_unknown_fields)]
pub enum Operation {Schedule{event_id:u64,tick:u64,command:Command},Advance{tick:u64},Run{}}
