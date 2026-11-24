from __future__ import annotations

import pandas as pd
import pytest

from aai_fx.config import CostConfig, PairCost
from aai_fx.execution.paper import PaperBroker

T = pd.Timestamp("2024-03-04", tz="UTC")
D = pd.Timedelta(days=1)
COSTS = CostConfig(commission_per_lot_side=3.5, default=PairCost(spread_pips=1.0, slippage_pips=0.0,
                                                                 stop_slippage_pips=0.0))


def _b() -> PaperBroker:
    return PaperBroker(10_000, "USD", COSTS)


def test_entry_next_open_with_spread_and_commission() -> None:
    b = _b()
    rates = {"EURUSD": 1.1}
    b.submit_market("EURUSD", 1, 1.0, T, stop=1.0900, target=1.1200)
    b.process_bar("EURUSD", T + D, 1.1000, 1.1010, 1.0990, 1.1005, rates)
    p = b.positions["EURUSD"]
    assert p.entry_price == pytest.approx(1.10005)
    assert b.cash == pytest.approx(10_000 - 3.5)
    assert p.initial_risk == pytest.approx((1.10005 - 1.09) * 100_000)


def test_stop_first_when_both_hit_same_bar() -> None:
    b = _b()
    rates = {"EURUSD": 1.1}
    b.submit_market("EURUSD", 1, 1.0, T, stop=1.0950, target=1.1050)
    b.process_bar("EURUSD", T + D, 1.1000, 1.1000, 1.0999, 1.1000, rates)
    (t,) = b.process_bar("EURUSD", T + 2 * D, 1.1000, 1.1100, 1.0900, 1.1000, rates)
    assert t.exit_kind == "STOP" and t.exit_price == pytest.approx(1.0950)
    assert t.r_multiple == pytest.approx(t.net_pnl / t.initial_risk)
    assert t.r_multiple < -1.0  # commission makes it worse than -1R


def test_gap_through_stop_fills_at_open() -> None:
    b = _b()
    rates = {"EURUSD": 1.1}
    b.submit_market("EURUSD", 1, 1.0, T, stop=1.0950)
    b.process_bar("EURUSD", T + D, 1.1000, 1.1000, 1.0999, 1.1000, rates)
    (t,) = b.process_bar("EURUSD", T + 2 * D, 1.0900, 1.0920, 1.0880, 1.0910, rates)
    assert t.exit_price == pytest.approx(1.0900 - 0.00005)  # bid at the gapped open, worse than stop


def test_usdjpy_pnl_converted_to_usd() -> None:
    b = _b()
    rates = {"USDJPY": 150.0}
    b.submit_market("USDJPY", -1, 1.0, T, stop=151.0, target=149.0)
    b.process_bar("USDJPY", T + D, 150.00, 150.00, 149.995, 150.00, rates)
    (t,) = b.process_bar("USDJPY", T + 2 * D, 149.50, 149.60, 148.90, 149.10, rates)
    assert t.exit_kind == "TARGET"
    entry = 150.00 - 0.005
    gross_jpy = (entry - 149.0) * 100_000
    # converted at the bar close rate after exit (rates updated to close)
    assert t.gross_pnl == pytest.approx(gross_jpy / 149.10, rel=1e-9)
    assert t.commission == pytest.approx(7.0)


def test_snapshot_restore_roundtrip() -> None:
    b = _b()
    rates = {"EURUSD": 1.1}
    b.submit_market("EURUSD", 1, 0.5, T, stop=1.09)
    b.process_bar("EURUSD", T + D, 1.1, 1.1, 1.1, 1.1, rates)
    b.submit_market("GBPUSD", -1, 0.2, T + D, stop=1.3)
    b2 = PaperBroker.restore(b.snapshot(), account_ccy="USD", costs=COSTS)
    assert b2.positions["EURUSD"].lots == 0.5 and b2.pending[0].pair == "GBPUSD"
    assert b2.cash == b.cash
