use zoora_agent_economy_simulator::DeterministicRng;

#[test]
fn same_seed_produces_same_stream() {
    let mut first = DeterministicRng::from_seed(42);
    let mut second = DeterministicRng::from_seed(42);

    let a: Vec<u64> = (0..16).map(|_| first.next_u64()).collect();
    let b: Vec<u64> = (0..16).map(|_| second.next_u64()).collect();

    assert_eq!(a, b);
}

#[test]
fn different_seeds_produce_different_streams() {
    let mut first = DeterministicRng::from_seed(42);
    let mut second = DeterministicRng::from_seed(43);

    let a: Vec<u64> = (0..16).map(|_| first.next_u64()).collect();
    let b: Vec<u64> = (0..16).map(|_| second.next_u64()).collect();

    assert_ne!(a, b);
}
