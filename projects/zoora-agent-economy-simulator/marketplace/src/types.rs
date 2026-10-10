use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub id: u64,
    pub balance: i64,
    pub refundable_escrow: i64,
    pub active_tasks: usize,
    pub completed_services: u64,
    pub failed_services: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskStatus {
    Open,
    Accepted,
    Submitted,
    Completed,
    Failed,
    Cancelled,
    Expired,
}
impl TaskStatus {
    pub fn holds_escrow(self) -> bool {
        matches!(self, Self::Open | Self::Accepted | Self::Submitted)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub id: u64,
    pub client: u64,
    pub worker: Option<u64>,
    pub title: String,
    pub acceptance_digest: String,
    pub artifact_digest: Option<String>,
    pub reward: i64,
    pub posted_tick: u64,
    pub deadline_tick: u64,
    pub status: TaskStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Command {
    PostTask {
        task_id: u64,
        client: u64,
        title: String,
        acceptance_digest: String,
        reward: i64,
        deadline_tick: u64,
    },
    AcceptTask {
        task_id: u64,
        worker: u64,
    },
    SubmitTask {
        task_id: u64,
        worker: u64,
        artifact_digest: String,
    },
    ApproveTask {
        task_id: u64,
        client: u64,
    },
    FailTask {
        task_id: u64,
        worker: u64,
    },
    CancelTask {
        task_id: u64,
        client: u64,
    },
    ExpireTask {
        task_id: u64,
    },
}
impl Command {
    pub fn is_timer(&self) -> bool {
        matches!(self, Self::ExpireTask { .. })
    }
    pub fn task_id(&self) -> u64 {
        match self {
            Self::PostTask { task_id, .. }
            | Self::AcceptTask { task_id, .. }
            | Self::SubmitTask { task_id, .. }
            | Self::ApproveTask { task_id, .. }
            | Self::FailTask { task_id, .. }
            | Self::CancelTask { task_id, .. }
            | Self::ExpireTask { task_id } => *task_id,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketEvent {
    pub event_id: u64,
    pub simulation_tick: u64,
    pub priority: u32,
    pub sequence: u64,
    pub command: Command,
}
impl MarketEvent {
    pub fn order_key(&self) -> (u64, u32, u64) {
        (self.simulation_tick, self.priority, self.sequence)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Rejection {
    InvalidActor,
    InvalidTerms,
    InvalidReward,
    InvalidDeadline,
    DuplicateTask,
    TaskCapacity,
    InsufficientFunds,
    UnknownTask,
    WrongState,
    UnauthorizedActor,
    SelfAssignment,
    WorkerCapacity,
    InvalidArtifact,
    RecipientCapacity,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Transition {
    Posted,
    Accepted,
    Submitted,
    Completed,
    Failed,
    Cancelled,
    Expired,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum Outcome {
    Applied {
        transition: Transition,
        escrow_funded: i64,
        worker_payment: i64,
        fee: i64,
        client_refund: i64,
    },
    Rejected {
        reason: Rejection,
    },
    TimerNoop {},
}
impl Outcome {
    pub fn applied(transition: Transition) -> Self {
        Self::Applied {
            transition,
            escrow_funded: 0,
            worker_payment: 0,
            fee: 0,
            client_refund: 0,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub processed_index: u64,
    pub event: MarketEvent,
    pub outcome: Outcome,
}

pub fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
