from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from aai_fx.config import AppConfig, StrategyConfig
from aai_fx.data.validation import in_fx_session


def synth_ohlc(n: int, freq: str = "15min", start: str = "2024-01-01 00:00", p0: float = 1.10,
               vol: float = 0.0008, seed: int = 0, session_only: bool = True) -> pd.DataFrame:
    """Deterministic random-walk OHLC for TESTS ONLY (never used for reported results)."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=int(n * 1.6) + 10, freq=freq, tz="UTC")
    if session_only and freq != "1D":
        idx = idx[in_fx_session(idx, lenient=False)]
    elif freq == "1D":
        idx = idx[idx.dayofweek < 5]
    idx = idx[:n]
    rets = rng.normal(0, vol, len(idx)) + 0.3 * vol * np.sin(np.arange(len(idx)) / 40.0)
    close = p0 * np.exp(np.cumsum(rets))
    open_ = np.r_[p0, close[:-1]]
    spread = np.abs(rng.normal(0, vol, len(idx))) * close
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": 0.0}, index=idx)


@pytest.fixture
def cfg() -> AppConfig:
    c = AppConfig()
    c.strategies = {
        "trend_swing": StrategyConfig(timeframe="D1", params={"ema_fast": 10, "ema_slow": 30, "entry_lookback": 10,
                                                               "exit_lookback": 5}),
        "trend_swing_h4": StrategyConfig(impl="trend_swing", timeframe="H4",
                                         params={"ema_fast": 5, "ema_slow": 20, "entry_lookback": 10}),
        "session_breakout": StrategyConfig(timeframe="M15", params={}),
    }
    return c
