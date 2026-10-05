use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

pub const RNG_ALGORITHM: &str = "ChaCha8Rng";

#[derive(Debug, Clone)]
pub struct DeterministicRng {
    inner: ChaCha8Rng,
}

impl DeterministicRng {
    pub fn from_seed(seed: u64) -> Self {
        Self { inner: ChaCha8Rng::seed_from_u64(seed) }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.inner.next_u64()
    }
}
