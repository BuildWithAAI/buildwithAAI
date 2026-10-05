use std::cmp::Ordering;
use std::collections::BinaryHeap;

use crate::event::Event;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ScheduledEvent(Event);

impl Ord for ScheduledEvent {
    fn cmp(&self, other: &Self) -> Ordering {
        other.0.simulation_tick.cmp(&self.0.simulation_tick)
            .then_with(|| other.0.priority.cmp(&self.0.priority))
            .then_with(|| other.0.sequence.cmp(&self.0.sequence))
    }
}

impl PartialOrd for ScheduledEvent {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, Default)]
pub struct EventScheduler {
    queue: BinaryHeap<ScheduledEvent>,
}

impl EventScheduler {
    pub fn schedule(&mut self, event: Event) {
        self.queue.push(ScheduledEvent(event));
    }

    pub fn pop_next(&mut self) -> Option<Event> {
        self.queue.pop().map(|scheduled| scheduled.0)
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}
