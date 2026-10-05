use crate::event::Event;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
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
}
