#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Metrics {
    pub events_processed: u64,
    pub transfers_completed: u64,
    pub total_transferred: i64,
}

impl Metrics {
    pub fn record_transfer(&mut self, amount: i64) {
        self.events_processed += 1;
        self.transfers_completed += 1;
        self.total_transferred += amount;
    }
}
