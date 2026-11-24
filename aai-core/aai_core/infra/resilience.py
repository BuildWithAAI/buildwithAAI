"""Rate limiting, retries with exponential backoff + jitter, and per-source circuit breakers.

Extracted from smr (solana-meme-risk) smr/resilience.py; behaviour is identical."""
from __future__ import annotations
import random, threading, time
from dataclasses import dataclass, field


class TokenBucket:
    """Thread-safe token bucket: sustained `rps`, short bursts up to `burst`."""
    def __init__(self, rps: float, burst: int = 1, clock=time.monotonic, sleep=time.sleep):
        self.rps, self.burst = float(rps), max(1, int(burst))
        self._tokens, self._last = float(self.burst), clock()
        self._lock = threading.Lock()
        self._clock, self._sleep = clock, sleep
        self.penalty_until = 0.0

    def acquire(self) -> float:
        waited = 0.0
        while True:
            with self._lock:
                now = self._clock()
                if now < self.penalty_until:
                    wait = self.penalty_until - now
                else:
                    self._tokens = min(self.burst, self._tokens + (now - self._last) * self.rps)
                    self._last = now
                    if self._tokens >= 1 - 1e-9:   # tolerate float rounding
                        self._tokens = max(0.0, self._tokens - 1)
                        return waited
                    wait = (1 - self._tokens) / self.rps
            self._sleep(wait); waited += wait

    def penalize(self, seconds: float) -> None:
        """Called on HTTP 429: pause the whole source, not just the calling thread."""
        with self._lock:
            self.penalty_until = max(self.penalty_until, self._clock() + seconds)
            self._tokens = 0


class CircuitOpen(Exception):
    pass


@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = 6
    reset_timeout_s: float = 30.0
    clock: object = time.monotonic
    state: str = "closed"
    failures: int = 0
    opened_at: float = 0.0
    trips: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def allow(self) -> bool:
        with self._lock:
            if self.state == "open":
                if self.clock() - self.opened_at >= self.reset_timeout_s:
                    self.state = "half_open"
                    return True
                return False
            return True

    def success(self) -> None:
        with self._lock:
            self.failures = 0; self.state = "closed"

    def failure(self) -> None:
        with self._lock:
            self.failures += 1
            if self.state == "half_open" or self.failures >= self.failure_threshold:
                if self.state != "open":
                    self.trips += 1
                self.state, self.opened_at = "open", self.clock()

    def snapshot(self) -> dict:
        return {"state": self.state, "failures": self.failures, "trips": self.trips}


class RetryableError(Exception):
    def __init__(self, msg, retry_after: float | None = None, rate_limited: bool = False):
        super().__init__(msg); self.retry_after = retry_after; self.rate_limited = rate_limited


def backoff_delays(attempts: int, base: float = 0.5, cap: float = 20.0, rng=random.random):
    """Full-jitter exponential backoff (AWS architecture blog)."""
    for i in range(attempts):
        yield rng() * min(cap, base * (2 ** i))
