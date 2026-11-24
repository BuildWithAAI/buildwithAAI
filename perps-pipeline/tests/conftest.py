from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from perps.config import Settings
from perps.data.models import InstrumentSpec


@pytest.fixture(autouse=True)
def _isolate_agent_guard_kill(tmp_path, monkeypatch):
    """Keep tests hermetic: point the box-wide agent-guard kill file at a temp path (absent by default)."""
    monkeypatch.setenv("AGENT_GUARD_KILL_FILE", str(tmp_path / "agent_guard_KILL_SWITCH"))


@pytest.fixture
def spec() -> InstrumentSpec:
    # mirrors Blofin BTC-USDT metadata shape (contract = 0.001 BTC, lot 0.1 contract)
    return InstrumentSpec(exchange="blofin", symbol="TEST-USDT", exchange_symbol="TEST-USDT", base="TEST",
                          quote="USDT", contract_value=0.001, min_size=0.1, lot_size=0.1, tick_size=0.1,
                          max_leverage=100)


@pytest.fixture
def unit_spec() -> InstrumentSpec:
    return InstrumentSpec(exchange="blofin", symbol="UNIT-USDT", exchange_symbol="UNIT-USDT", base="UNIT",
                          quote="USDT", contract_value=1.0, min_size=0.001, lot_size=0.001, tick_size=0.01,
                          max_leverage=100)


@pytest.fixture
def settings(tmp_path) -> Settings:
    s = Settings()
    s.project.data_dir = tmp_path / "data"
    s.project.state_dir = tmp_path / "state"
    s.project.reports_dir = tmp_path / "reports"
    s.risk.kill_switch_file = None
    return s


def make_bars(closes, start="2025-01-01", freq="1h", spread=0.002, seed=0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    c = np.asarray(closes, dtype=float)
    o = np.r_[c[0], c[:-1]]
    h = np.maximum(o, c) * (1 + spread * rng.random(len(c)))
    lo = np.minimum(o, c) * (1 - spread * rng.random(len(c)))
    idx = pd.date_range(start, periods=len(c), freq=freq, tz="UTC")
    return pd.DataFrame({"ts": idx.asi8 // 1_000_000, "open": o, "high": h, "low": lo, "close": c,
                         "volume": rng.uniform(100, 200, len(c)), "quote_volume": np.nan}, index=idx)


def random_walk(n=3000, seed=1, vol=0.01, start=100.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    closes = start * np.exp(np.cumsum(rng.normal(0, vol, n)))
    return make_bars(closes, seed=seed)
