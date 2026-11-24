import pandas as pd

from perps.data.quality import check_ohlcv, find_gaps
from perps.data.store import ParquetStore


def _bars(ts):
    return pd.DataFrame({"ts": ts, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 1.0,
                         "quote_volume": 1.0})


H = 3_600_000


def test_upsert_dedupes_and_keeps_latest(tmp_path):
    st = ParquetStore(tmp_path)
    st.upsert_ohlcv("blofin", "BTC-USDT", "1H", _bars([0, H, 2 * H]))
    newer = _bars([2 * H, 3 * H])
    newer["close"] = 2.0
    st.upsert_ohlcv("blofin", "BTC-USDT", "1H", newer)
    df = st.load_ohlcv("blofin", "BTC-USDT", "1H")
    assert len(df) == 4 and df["ts"].is_unique and df["close"].iloc[2] == 2.0
    assert str(df.index.tz) == "UTC"


def test_gap_detection():
    gaps = find_gaps(pd.Series([0, H, 4 * H, 5 * H]), "1H")
    assert len(gaps) == 1 and gaps[0].missing_bars == 2


def test_quality_flags_bad_ohlc():
    df = _bars([0, H, 2 * H])
    df.loc[1, "high"] = 0.5  # high below close
    df.index = pd.to_datetime(df.ts, unit="ms", utc=True)
    r = check_ohlcv(df, "X", "1H")
    assert r.ohlc_violations == 1 and not r.passed
