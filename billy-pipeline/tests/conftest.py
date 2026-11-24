from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from billy.config import PathsCfg, Settings
from billy.market.data import MarketData, add_atr
from billy.models import Post

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def real_posts() -> dict[str, Post]:
    out = {}
    for line in (FIX / "real_posts.jsonl").read_text().splitlines():
        r = json.loads(line)
        out[r["id"]] = Post(id=r["id"], created_at=r["created_at"], text=r["text"], url=r["url"], source="fixture")
    return out


@pytest.fixture
def settings(tmp_path) -> Settings:
    s = Settings(paths=PathsCfg(root=tmp_path, seed_posts=[]))
    s.paths = s.paths.resolve()
    s.paths.events_file = Path(__file__).resolve().parents[1] / "config" / "events.yaml"
    return s


def frame_from_closes(closes, start="2026-06-01", freq="1h", spread=0.001) -> pd.DataFrame:
    closes = np.asarray(closes, dtype=float)
    idx = pd.date_range(start, periods=len(closes), freq=freq, tz="UTC")
    opens = np.concatenate([[closes[0]], closes[:-1]])
    high = np.maximum(opens, closes) * (1 + spread)
    low = np.minimum(opens, closes) * (1 - spread)
    df = pd.DataFrame({"open": opens, "high": high, "low": low, "close": closes, "volume": 1.0}, index=idx)
    df["open_time"] = (idx.asi8 // 1_000_000).astype("int64")
    return df


def make_md(h1_closes: dict[str, list[float]], start="2026-06-01") -> MarketData:
    h1, d1 = {}, {}
    for a, c in h1_closes.items():
        f = add_atr(frame_from_closes(c, start), 14)
        h1[a] = f
        agg = f.resample("1D").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        agg["open_time"] = (agg.index.asi8 // 1_000_000).astype("int64")
        d1[a] = agg
    return MarketData(h1=h1, d1=d1)


@pytest.fixture
def mk_md():
    return make_md


@pytest.fixture
def mk_frame():
    return frame_from_closes
