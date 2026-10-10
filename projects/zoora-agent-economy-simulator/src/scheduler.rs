use crate::{config::MAX_EVENTS, error::SimulationError, event::Event};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};

#[derive(Debug, Clone)]
struct ScheduledEvent(Event);
impl PartialEq for ScheduledEvent {
    fn eq(&self, other: &Self) -> bool {
        self.0.order_key() == other.0.order_key()
    }
}
impl Eq for ScheduledEvent {}
impl PartialOrd for ScheduledEvent {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for ScheduledEvent {
    fn cmp(&self, other: &Self) -> Ordering {
        other.0.order_key().cmp(&self.0.order_key())
    }
}

#[derive(Debug, Clone, Default)]
pub struct EventScheduler {
    queue: BinaryHeap<ScheduledEvent>,
    used_ids: HashSet<u64>,
    used_sequences: HashSet<u64>,
}

impl EventScheduler {
    pub fn schedule(&mut self, event: Event) -> Result<(), SimulationError> {
        if self.used_ids.contains(&event.event_id) {
            return Err(SimulationError::Integrity("duplicate event ID"));
        }
        if self.used_sequences.contains(&event.sequence) {
            return Err(SimulationError::Integrity("duplicate scheduling sequence"));
        }
        if self.used_ids.len() >= MAX_EVENTS {
            return Err(SimulationError::Capacity("event admission limit exceeded"));
        }
        self.used_ids.insert(event.event_id);
        self.used_sequences.insert(event.sequence);
        self.queue.push(ScheduledEvent(event));
        Ok(())
    }
    pub fn pop_next(&mut self) -> Option<Event> {
        self.queue.pop().map(|entry| entry.0)
    }
    pub fn len(&self) -> usize {
        self.queue.len()
    }
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}
