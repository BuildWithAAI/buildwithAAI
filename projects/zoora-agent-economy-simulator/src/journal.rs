use std::collections::HashSet;

use crate::event::Event;

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct EventJournal {
    entries: Vec<Event>,
}

impl EventJournal {
    pub fn append(&mut self, event: Event) {
        self.entries.push(event);
    }

    pub fn entries(&self) -> &[Event] {
        &self.entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn validate(&self) -> Result<(), String> {
        let mut ids = HashSet::new();
        let mut previous_sequence = None;

        for event in &self.entries {
            if !ids.insert(event.event_id) {
                return Err("duplicate event_id in journal".into());
            }
            if let Some(previous) = previous_sequence {
                if event.sequence <= previous {
                    return Err("journal sequence must be strictly increasing".into());
                }
            }
            previous_sequence = Some(event.sequence);
        }
        Ok(())
    }
}
