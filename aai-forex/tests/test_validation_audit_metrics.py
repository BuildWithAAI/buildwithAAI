from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from aai_fx.backtest.metrics import compute_metrics
from aai_fx.data.base import Timeframe
from aai_fx.data.store import ParquetStore
from aai_fx.data.validation import resample_ohlcv, validate_ohlcv
from aai_fx.execution.models import ClosedTrade
from aai_fx.reporting.audit import AuditLog, verify_audit_log


def _bars(idx) -> pd.DataFrame:  # type: ignore[no-untyped-def]
    n = len(idx)
    c = np.linspace(1.10, 1.11, n)
    return pd.DataFrame({"Open": c, "High": c + 0.0005, "Low": c - 0.0005, "Close": c, "Volume": 0}, index=idx)


def test_tz_normalisation_dedupe_and_sort() -> None:
    idx = pd.Index(["2024-03-05 10:00+01:00", "2024-03-05 08:00+00:00", "2024-03-05 09:00+00:00",
                    "2024-03-05 09:00+00:00"])  # mixed offsets, as from a DST-aware source
    df = _bars(idx)
    out, rep = validate_ohlcv(df, "EURUSD", Timeframe.H1, now=pd.Timestamp("2025-01-01", tz="UTC"))
    assert str(out.index.tz) == "UTC"
    assert list(out.index.hour) == [8, 9]  # 10:00+01:00 == 09:00Z, deduped
    assert rep.duplicates_removed == 2


def test_naive_index_assumed_utc() -> None:
    df = _bars(pd.date_range("2024-03-05", periods=3, freq="1h"))
    out, _ = validate_ohlcv(df, "EURUSD", Timeframe.H1, now=pd.Timestamp("2025-01-01", tz="UTC"))
    assert out.index[0] == pd.Timestamp("2024-03-05 00:00", tz="UTC")


def test_weekend_and_incomplete_bar_removed() -> None:
    idx = pd.date_range("2024-03-08 20:00", "2024-03-11 01:00", freq="1h", tz="UTC")  # Fri 20:00 -> Mon 01:00
    df = _bars(idx)
    now = pd.Timestamp("2024-03-11 00:30", tz="UTC")  # Monday 00:00 bar still forming
    out, rep = validate_ohlcv(df, "EURUSD", Timeframe.H1, now=now)
    assert not (out.index.dayofweek == 5).any()
    assert rep.weekend_removed > 0
    assert rep.incomplete_removed == 2  # 00:00 (forming) and 01:00 (future)
    assert out.index[-1] == pd.Timestamp("2024-03-10 23:00", tz="UTC")


def test_daily_weekend_labels_dropped() -> None:
    idx = pd.date_range("2024-03-04", "2024-03-17", freq="1D", tz="UTC")
    out, rep = validate_ohlcv(_bars(idx), "EURUSD", Timeframe.D1, now=pd.Timestamp("2025-01-01", tz="UTC"))
    assert (out.index.dayofweek < 5).all() and rep.weekend_removed == 4


def test_ohlc_repair_and_nan_drop_and_gaps() -> None:
    idx = pd.date_range("2024-03-05 00:00", periods=10, freq="1h", tz="UTC")
    df = _bars(idx)
    df.iloc[3, df.columns.get_loc("High")] = 1.0  # high below close
    df.iloc[5, df.columns.get_loc("Close")] = np.nan
    df = df.drop(idx[7])
    out, rep = validate_ohlcv(df, "EURUSD", Timeframe.H1, now=pd.Timestamp("2025-01-01", tz="UTC"))
    assert rep.ohlc_repaired == 1 and (out["high"] >= out[["open", "close"]].max(axis=1)).all()
    assert rep.nan_or_nonpositive_removed == 1
    assert rep.missing_bars == 2  # NaN row + dropped row


def test_store_roundtrip_and_merge(tmp_path) -> None:  # type: ignore[no-untyped-def]
    st = ParquetStore(tmp_path)
    a, _ = validate_ohlcv(_bars(pd.date_range("2024-03-05", periods=5, freq="1h", tz="UTC")), "EURUSD",
                          Timeframe.H1, now=pd.Timestamp("2025-01-01", tz="UTC"))
    b, _ = validate_ohlcv(_bars(pd.date_range("2024-03-05 03:00", periods=5, freq="1h", tz="UTC")), "EURUSD",
                          Timeframe.H1, now=pd.Timestamp("2025-01-01", tz="UTC"))
    st.write(a, "yf", Timeframe.H1, "EURUSD", meta={"x": 1})
    m = st.write(b, "yf", Timeframe.H1, "EURUSD")
    assert len(m) == 8 and m.index.is_monotonic_increasing and not m.index.duplicated().any()
    assert st.read("yf", Timeframe.H1, "EURUSD").equals(m)


def test_resample_h4() -> None:
    idx = pd.date_range("2024-03-05", periods=8, freq="1h", tz="UTC")
    df = _bars(idx).rename(columns=str.lower)
    h4 = resample_ohlcv(df, Timeframe.H4, Timeframe.H1)
    assert len(h4) == 2 and h4["high"].iloc[0] == df["high"].iloc[:4].max()


def test_audit_chain_and_tamper_detection(tmp_path) -> None:  # type: ignore[no-untyped-def]
    p = tmp_path / "audit.jsonl"
    with AuditLog(p, "r1") as a:
        for i in range(5):
            a.append("signal", {"i": i, "px": 1.1 + i / 1e4})
    with AuditLog(p, "r2") as a:  # reopen continues the chain
        a.append("order", {"id": "P1"})
    assert verify_audit_log(p) == (True, 6, "ok")
    lines = p.read_text().splitlines()
    rec = json.loads(lines[2])
    rec["payload"]["px"] = 9.99
    lines[2] = json.dumps(rec, sort_keys=True, separators=(",", ":"))
    p.write_text("\n".join(lines) + "\n")
    ok, n, msg = verify_audit_log(p)
    assert not ok and "seq 3" in msg
    p.write_text("\n".join([l for i, l in enumerate(p.read_text().splitlines()) if i != 1]) + "\n")
    assert not verify_audit_log(p)[0]


def _trade(net: float, risk: float = 100.0) -> ClosedTrade:
    t = pd.Timestamp("2024-01-02", tz="UTC")
    return ClosedTrade("EURUSD", 1, 0.1, t, t, 1.1, 1.1, "EXIT", net, 0.0, net, risk, net / risk, 1)


def test_metrics_known_values() -> None:
    idx = pd.date_range("2024-01-01", periods=366, freq="1D", tz="UTC")
    eq = pd.Series(np.linspace(10_000, 11_000, 366), index=idx)
    eq.iloc[100] = 9_000  # single drawdown point
    m = compute_metrics(eq, [_trade(200), _trade(-100), _trade(100), _trade(-50)], 10_000)
    assert m["trade_count"] == 4
    assert m["win_rate_pct"] == pytest.approx(50.0)
    assert m["profit_factor"] == pytest.approx(300 / 150)
    assert m["expectancy_r"] == pytest.approx((2 - 1 + 1 - 0.5) / 4)
    assert m["total_return_pct"] == pytest.approx(10.0)
    assert m["cagr_pct"] == pytest.approx(100 * (1.1 ** (365.25 / 365) - 1))
    peak = eq.iloc[:100].max()
    assert m["max_drawdown_pct"] == pytest.approx(100 * (1 - 9_000 / peak))
    assert m["sharpe"] is not None and m["sortino"] is not None


def test_metrics_no_losses_pf_none() -> None:
    idx = pd.date_range("2024-01-01", periods=10, freq="1D", tz="UTC")
    m = compute_metrics(pd.Series(np.linspace(1e4, 1.1e4, 10), index=idx), [_trade(10)], 10_000)
    assert m["profit_factor"] is None and m["max_drawdown_pct"] == 0.0
