use zoora_agent_economy_simulator::{Event, EventScheduler};

#[test]
fn scheduler_orders_by_tick_priority_then_sequence() {
    let mut scheduler = EventScheduler::default();

    scheduler.schedule(Event::transfer_with_priority(1, 5, 20, 1, 0, 1, 1)).unwrap();
    scheduler.schedule(Event::transfer_with_priority(2, 4, 99, 2, 0, 1, 1)).unwrap();
    scheduler.schedule(Event::transfer_with_priority(3, 5, 10, 3, 0, 1, 1)).unwrap();
    scheduler.schedule(Event::transfer_with_priority(4, 5, 10, 0, 0, 1, 1)).unwrap();

    let order: Vec<u64> = std::iter::from_fn(|| scheduler.pop_next())
        .map(|event| event.event_id)
        .collect();

    assert_eq!(order, vec![2, 4, 3, 1]);
}
