"""Small-account ($100) research harness: margin model, min-lot forcing, stop-out."""

from __future__ import annotations

import pandas as pd
import pytest

from aai_fx.config import AppConfig, CostConfig, PairCost
from aai_fx.execution.models import Position
from aai_fx.research.small_account import MarginPaperBroker, SmallAccountRisk, margin_required


def _costs() -> CostConfig:
    return CostConfig(commission_per_lot_side=0.0, default=PairCost(spread_pips=0, slippage_pips=0, stop_slippage_pips=0),
                      per_pair={"XAUUSD": PairCost(spread_pips=0, slippage_pips=0, stop_slippage_pips=0)})


def test_margin_required_retail_lots() -> None:
    assert margin_required("XAUUSD", 0.01, 2000.0) == pytest.approx(20.0)   # 1 oz * 2000 / 100
    assert margin_required("AUDUSD", 0.01, 0.65) == pytest.approx(6.5)      # 1,000 AUD * 0.65 / 100


def _cfg(equity: float = 100.0) -> AppConfig:
    cfg = AppConfig()
    return cfg.model_copy(update={"account": cfg.account.model_copy(update={"starting_equity": equity})})


def test_strict_skips_and_minlot_forces() -> None:
    cfg = _cfg(100.0)
    rates = {"XAUUSD": 2000.0}
    for mode, approved in (("strict", False), ("minlot", True)):
        b = MarginPaperBroker(100.0, "USD", _costs())
        r = SmallAccountRisk(cfg, mode, 1.0, [b])
        # $10 stop on 0.01 lot = $10 = 10 % of $100  -> strict 1 % must skip, minlot trades 0.01
        d = r.evaluate("XAUUSD", 1, 2000.0, 1990.0, 100.0, [], rates, cost_pips=0.0)
        assert d.approved is approved
        if approved:
            assert d.lots == 0.01 and d.risk_pct == pytest.approx(10.0)
            assert r.evals[-1]["forced_min_lot"] is True
        else:
            assert "min lot" in d.reasons[-1]


def test_minlot_refused_without_margin() -> None:
    b = MarginPaperBroker(15.0, "USD", _costs())
    r = SmallAccountRisk(_cfg(15.0), "minlot", 1.0, [b])
    d = r.evaluate("XAUUSD", 1, 2000.0, 1990.0, 15.0, [], {"XAUUSD": 2000.0})
    assert not d.approved and "not enough margin" in d.reasons[-1]   # needs $20 margin


def test_margin_stop_out_before_strategy_stop() -> None:
    b = MarginPaperBroker(30.0, "USD", _costs())
    ts0 = pd.Timestamp("2024-01-02 00:00", tz="UTC")
    b.positions["XAUUSD"] = Position("XAUUSD", 1, 0.01, 2000.0, ts0, 1950.0, None, 50.0, 0.0, "t")
    rates = {"XAUUSD": 2000.0}
    # margin at the bar open 1999 = 19.99 -> stop-out at equity 9.995 -> exit px 2000 + (9.995 - 30) = 1979.995
    b.process_bar("XAUUSD", ts0 + pd.Timedelta(hours=1), 1999.0, 2001.0, 1975.0, 1990.0, rates)
    assert "XAUUSD" not in b.positions
    t = b.trades[-1]
    assert t.exit_kind == "STOP_OUT" and t.exit_price == pytest.approx(1979.995)
    assert b.cash == pytest.approx(9.995)
    assert len(b.stop_outs) == 1


def test_strategy_stop_first_when_nearer() -> None:
    b = MarginPaperBroker(100.0, "USD", _costs())
    ts0 = pd.Timestamp("2024-01-02 00:00", tz="UTC")
    b.positions["XAUUSD"] = Position("XAUUSD", 1, 0.01, 2000.0, ts0, 1990.0, None, 10.0, 0.0, "t")
    b.process_bar("XAUUSD", ts0 + pd.Timedelta(hours=1), 1999.0, 2001.0, 1900.0, 1950.0, {"XAUUSD": 2000.0})
    t = b.trades[-1]
    assert t.exit_kind == "STOP" and t.exit_price == pytest.approx(1990.0)   # stop-out level was 1910
    assert b.stop_outs == []


def test_stop_out_on_entry_bar() -> None:
    b = MarginPaperBroker(12.0, "USD", _costs())
    ts0 = pd.Timestamp("2024-01-02 00:00", tz="UTC")
    b.submit_market("XAUUSD", 1, 0.01, ts0, stop=1980.0, risk_amount=20.0)
    # fills at 2000; margin 20 -> stop-out at equity 10 -> px 1998, nearer than the 1980 stop
    b.process_bar("XAUUSD", ts0 + pd.Timedelta(hours=1), 2000.0, 2001.0, 1985.0, 1990.0, {"XAUUSD": 2000.0})
    t = b.trades[-1]
    assert t.exit_kind == "STOP_OUT" and t.exit_price == pytest.approx(1998.0)
    assert t.initial_risk == pytest.approx(20.0)        # R still measured against the strategy stop
    assert b.cash == pytest.approx(10.0)
