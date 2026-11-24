"""Settings from environment variables. No secrets are required; none are read for trading.

AAI_HOME         data dir (cache, state)              default: <repo>/data
AAI_CACHE_MODE   readwrite | replay | off             default: readwrite
AAI_<SRC>_RPS    per-source rate override, e.g. AAI_BYBIT_RPS=5
AAI_PERP_VENUES  failover order for crypto_perp       default: bybit,blofin,okx
SMR_HOME         solana-meme-risk checkout            default: /workspace/solana-meme-risk
SMR_PYTHON       interpreter for smr                  default: $SMR_HOME/.venv/bin/python
"""
from __future__ import annotations
import os
from dataclasses import dataclass, field

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Conservative public-endpoint budgets (well under documented limits).
DEFAULT_RPS = {
    "bybit": 5.0,        # documented 600 req / 5 s per IP
    "blofin": 4.0,       # public market endpoints, documented ~500 req / min per IP
    "okx": 4.0,          # documented 20 req / 2 s per endpoint
    "yahoo": 1.0,        # unofficial; keep low
    "frankfurter": 2.0,  # free ECB reference rates, no documented limit
}


def _rps(name: str) -> float:
    return float(os.environ.get(f"AAI_{name.upper()}_RPS", DEFAULT_RPS[name]))


@dataclass
class Settings:
    home: str = field(default_factory=lambda: os.environ.get("AAI_HOME", os.path.join(REPO, "data")))
    cache_mode: str = field(default_factory=lambda: os.environ.get("AAI_CACHE_MODE", "readwrite"))
    perp_venues: list = field(default_factory=lambda: os.environ.get("AAI_PERP_VENUES", "bybit,blofin,okx").split(","))
    smr_home: str = field(default_factory=lambda: os.environ.get("SMR_HOME", "/workspace/solana-meme-risk"))
    smr_python: str = ""
    smr_timeout_s: float = field(default_factory=lambda: float(os.environ.get("SMR_TIMEOUT_S", "600")))
    rps: dict = field(default_factory=lambda: {k: _rps(k) for k in DEFAULT_RPS})

    def __post_init__(self):
        os.makedirs(self.home, exist_ok=True)
        if not self.smr_python:
            self.smr_python = os.environ.get("SMR_PYTHON") or os.path.join(self.smr_home, ".venv", "bin", "python")

    @property
    def cache_path(self) -> str:
        return os.path.join(self.home, "cache.db")
