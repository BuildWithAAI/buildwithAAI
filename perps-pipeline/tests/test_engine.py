import math

import pandas as pd
import pytest

from perps.backtest.engine import BacktestEngine, SymbolData
from perps.core.costs import CostModel
from perps.core.position import Position, check_intrabar, update_after_close

from .helpers import Scripted, ohlc_frame


def _engine(settings, fees=(0.0, 0.0), slip=(0.0, 0.0)):
    settings.fees["blofin"].maker, settings.fees["blofin"].taker = fees
    settings.slippage.market_bps, settings.slippage.stop_bps = slip
    settings.risk.daily_loss_limit = 0.99
    return BacktestEngine(settings, "blofin")


FLAT = (100, 100.5, 99.5, 100)


def test_entry_fills_at_next_bar_open(settings, unit_spec):
    rows = [FLAT, FLAT, (101, 101.2, 100.8, 101), (101, 101.2, 100.8, 101), FLAT]
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 1.0, "take_profit_r": 0})
    res = _engine(settings).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)])
    t = res.trades.iloc[0]
    assert t.entry_price == 101  # open of bar 2, NOT close of signal bar 1 (100)
    assert t.entry_time == str(ohlc_frame(rows).index[2])


def test_stop_loss_costs_one_r(settings, unit_spec):
    rows = [FLAT, FLAT, (100, 100.2, 99.8, 100), (100, 100.1, 98.0, 98.5), FLAT]
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 1.0, "take_profit_r": 0})
    res = _engine(settings).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)])
    t = res.trades.iloc[0]
    assert t.exit_reason == "stop" and t.exit_price == 99.0
    assert math.isclose(t.net_pnl, -1.5, rel_tol=1e-6)  # 1.5% of $100
    assert math.isclose(t.r_multiple, -1.0, rel_tol=1e-6)


def test_take_profit_and_fees(settings, unit_spec):
    rows = [FLAT, FLAT, (100, 100.2, 99.8, 100), (100, 102.5, 99.9, 102.2), FLAT]
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 1.0, "take_profit_r": 2.0})
    res = _engine(settings, fees=(0.0002, 0.0006)).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)])
    t = res.trades.iloc[0]
    assert t.exit_reason == "take_profit" and t.exit_price == 102.0
    exp_fees = t.qty * 100 * 0.0006 + t.qty * 102 * 0.0006  # taker both sides (conservative default)
    assert math.isclose(t.fees, exp_fees, rel_tol=1e-9)
    assert math.isclose(t.net_pnl, t.qty * 2.0 - exp_fees, rel_tol=1e-9)
    assert math.isclose(res.equity.iloc[-1], 100 + t.net_pnl, rel_tol=1e-9)


def test_stop_first_when_both_touched(settings, unit_spec):
    rows = [FLAT, FLAT, (100, 100.2, 99.8, 100), (100, 103, 98, 101), FLAT]
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 1.0, "take_profit_r": 2.0})
    t = _engine(settings).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)]).trades.iloc[0]
    assert t.exit_reason == "stop"


def test_gap_through_stop_fills_at_open(settings, unit_spec):
    rows = [FLAT, FLAT, (100, 100.2, 99.8, 100), (97, 97.5, 96.5, 97), FLAT]
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 1.0, "take_profit_r": 0})
    t = _engine(settings).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)]).trades.iloc[0]
    assert t.exit_reason == "stop" and t.exit_price == 97.0
    assert t.r_multiple < -2.9  # gap loss exceeds 1R, as it would live


def test_short_slippage_and_signal_exit_next_open(settings, unit_spec):
    rows = [FLAT, FLAT, (100, 100.3, 99.7, 100), (99, 99.4, 98.8, 99), (98, 98.2, 97.9, 98), FLAT]
    strat = Scripted("1H", {"signals": {1: -1}, "stop_dist": 1.0, "take_profit_r": 0, "exits": [3]})
    t = _engine(settings, slip=(10.0, 0.0)).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)]).trades.iloc[0]
    assert math.isclose(t.entry_price, 100 * (1 - 0.001))  # sell fills below the open
    assert t.exit_reason == "signal" and math.isclose(t.exit_price, 98 * 1.001)  # bar-4 open, buy above


def test_funding_charged_only_while_open(settings, unit_spec):
    rows = [FLAT] * 12
    idx = ohlc_frame(rows).index
    fund = pd.DataFrame({"funding_rate": [0.01, 0.01, 0.01]}, index=[idx[1], idx[4], idx[10]])
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 1.0, "take_profit_r": 0, "exits": [6]})
    res = _engine(settings).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec, fund)])
    t = res.trades.iloc[0]  # open bar2..exit bar7 open -> only the idx[4] settlement applies
    assert math.isclose(t.funding, -t.qty * 100 * 0.01, rel_tol=1e-9)
    assert math.isclose(res.equity.iloc[-1], 100 + t.net_pnl, rel_tol=1e-9)


def test_liquidation_loss_capped_at_margin(settings, unit_spec):
    settings.risk.margin_leverage = 10
    settings.risk.liquidation_buffer = 0.0
    rows = [FLAT, FLAT, (100, 100.2, 99.8, 100), (80, 80, 79, 79.5), FLAT]
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 9.0, "take_profit_r": 0})
    t = _engine(settings).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)]).trades.iloc[0]
    assert t.exit_reason == "liquidation"
    assert t.gross_pnl >= -t.notional / 10 - 1e-9


def test_trailing_stop_ratchets_and_never_loosens():
    p = Position("X", 1, 1.0, 1.0, "t", 100, 95, 95, None, 50, 10, 5, 0, 100, 1, best_price=100)
    update_after_close(p, h=110, l=104, c=108, atr=2.0, trail_atr_mult=2.0)
    assert p.stop_price == 106
    update_after_close(p, h=107, l=100, c=101, atr=2.0, trail_atr_mult=2.0)
    assert p.stop_price == 106  # never loosens
    assert check_intrabar(p, 101, 102, 100, CostModel(0, 0, 0, 0)).reason == "trail_stop"


def test_signals_outside_window_do_not_trade(settings, unit_spec):
    rows = [FLAT] * 10
    df = ohlc_frame(rows)
    strat = Scripted("1H", {"signals": {1: 1, 6: 1}, "stop_dist": 1.0, "take_profit_r": 0})
    res = _engine(settings).run(strat, [SymbolData("UNIT-USDT", df, unit_spec)], trade_start=df.index[5])
    assert len(res.trades) == 1 and res.trades.iloc[0].entry_time == str(df.index[7])
    res2 = _engine(settings).run(strat, [SymbolData("UNIT-USDT", df, unit_spec)], trade_end=df.index[4])
    assert len(res2.trades) == 1 and res2.trades.iloc[0].exit_reason == "end"
    assert pd.Timestamp(res2.trades.iloc[0].exit_time) < df.index[4]


@pytest.mark.parametrize("risk", [0.01, 0.015, 0.03])
def test_risk_fraction_scales_loss(settings, unit_spec, risk):
    settings.risk.risk_per_trade = risk
    rows = [FLAT, FLAT, (100, 100.2, 99.8, 100), (100, 100.1, 98.0, 98.5), FLAT]
    strat = Scripted("1H", {"signals": {1: 1}, "stop_dist": 1.0, "take_profit_r": 0})
    t = _engine(settings).run(strat, [SymbolData("UNIT-USDT", ohlc_frame(rows), unit_spec)]).trades.iloc[0]
    assert math.isclose(t.net_pnl, -100 * risk, rel_tol=1e-6)
