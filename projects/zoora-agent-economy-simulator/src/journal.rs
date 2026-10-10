use crate::{config::MAX_EVENTS, error::SimulationError, event::EventRecord};
use serde::{
    de::{IgnoredAny, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use std::{collections::HashSet, fmt};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventJournal {
    #[serde(deserialize_with = "deserialize_records")]
    entries: Vec<EventRecord>,
}

fn deserialize_records<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<EventRecord>, D::Error> {
    struct Records;
    impl<'de> Visitor<'de> for Records {
        type Value = Vec<EventRecord>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "at most {MAX_EVENTS} event records")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut records = Vec::new();
            while records.len() < MAX_EVENTS {
                match seq.next_element()? {
                    Some(record) => records.push(record),
                    None => return Ok(records),
                }
            }
            if seq.next_element::<IgnoredAny>()?.is_some() {
                return Err(serde::de::Error::custom("event record limit exceeded"));
            }
            Ok(records)
        }
    }
    deserializer.deserialize_seq(Records)
}

impl EventJournal {
    pub fn from_records(entries: Vec<EventRecord>) -> Result<Self, SimulationError> {
        let journal = Self { entries };
        journal.validate()?;
        Ok(journal)
    }
    pub(crate) fn append(&mut self, record: EventRecord) {
        self.entries.push(record);
    }
    pub fn entries(&self) -> &[EventRecord] {
        &self.entries
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn validate(&self) -> Result<(), SimulationError> {
        if self.entries.len() > MAX_EVENTS {
            return Err(SimulationError::Capacity("journal exceeds event limit"));
        }
        let mut ids = HashSet::new();
        let mut sequences = HashSet::new();
        let mut previous = None;
        for (index, record) in self.entries.iter().enumerate() {
            if record.processed_index != index as u64 {
                return Err(SimulationError::Integrity("non-contiguous processed index"));
            }
            if !ids.insert(record.event.event_id) {
                return Err(SimulationError::Integrity("duplicate event ID"));
            }
            if !sequences.insert(record.event.sequence) {
                return Err(SimulationError::Integrity("duplicate scheduling sequence"));
            }
            let key = record.event.order_key();
            if previous.is_some_and(|last| last >= key) {
                return Err(SimulationError::Integrity(
                    "journal is not in execution order",
                ));
            }
            previous = Some(key);
        }
        Ok(())
    }
}
