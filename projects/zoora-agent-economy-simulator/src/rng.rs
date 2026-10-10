use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

pub const RNG_ALGORITHM: &str = "ChaCha8Rng/rand_chacha-0.3.1/rand_core-0.6.4/seed_from_u64";

#[derive(Debug, Clone)]
pub struct DeterministicRng { inner: ChaCha8Rng }
impl DeterministicRng {
    pub fn from_seed(seed: u64) -> Self { Self { inner: ChaCha8Rng::seed_from_u64(seed) } }
    pub fn next_u64(&mut self) -> u64 { self.inner.next_u64() }
    /// Rejection sampling avoids modulo bias. A zero bound has no valid draw.
    pub fn below(&mut self, bound: u64) -> Option<u64> {
        if bound == 0 { return None; }
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let value = self.next_u64();
            if value >= threshold { return Some(value % bound); }
        }
    }
}
