"""Position sizing & pip value maths, incl. JPY pairs and cross conversions."""

from __future__ import annotations

import math

import numpy as np
import pytest
from pydantic import ValidationError

from aai_fx.config import RiskConfig
from aai_fx.instruments import ConversionError, conversion_rate, get_instrument
from aai_fx.risk.pip import pip_value_per_lot
from aai_fx.risk.sizing import position_size

RATES = {"EURUSD": 1.10, "GBPUSD": 1.25, "USDJPY": 150.0, "USDCHF": 0.90, "AUDUSD": 0.65, "USDCAD": 1.35,
         "NZDUSD": 0.60}


@pytest.mark.parametrize("pair,expected", [
    ("EURUSD", 10.0), ("GBPUSD", 10.0), ("AUDUSD", 10.0), ("NZDUSD", 10.0),   # USD quote: fixed $10
    ("USDJPY", 1000.0 / 150.0),                                                # JPY quote: 1000 JPY / USDJPY
    ("USDCHF", 10.0 / 0.90), ("USDCAD", 10.0 / 1.35),                          # USD base: 10 quote / price
])
def test_pip_value_majors_usd_account(pair: str, expected: float) -> None:
    assert pip_value_per_lot(pair, "USD", RATES) == pytest.approx(expected, rel=1e-12)


def test_pip_sizes() -> None:
    assert get_instrument("USDJPY").pip_size == 0.01
    assert get_instrument("EURJPY").pip_size == 0.01
    assert get_instrument("EURUSD").pip_size == 0.0001
    assert get_instrument("USD/JPY").price_to_pips(0.35) == pytest.approx(35.0)
    assert get_instrument("EURUSD=X").price_to_pips(0.0035) == pytest.approx(35.0)


@pytest.mark.parametrize("pair,expected", [
    ("EURGBP", 10.0 * 1.25),           # GBP quote -> USD via GBPUSD
    ("EURJPY", 1000.0 / 150.0),        # JPY quote -> USD via USDJPY
    ("GBPJPY", 1000.0 / 150.0),
    ("EURCHF", 10.0 / 0.90),           # CHF quote -> USD via USDCHF (inverse)
    ("AUDJPY", 1000.0 / 150.0),
    ("EURAUD", 10.0 * 0.65),
])
def test_pip_value_crosses_usd_account(pair: str, expected: float) -> None:
    assert pip_value_per_lot(pair, "USD", RATES) == pytest.approx(expected, rel=1e-12)


def test_pip_value_non_usd_account() -> None:
    # EUR account trading EURUSD: 10 USD -> EUR = 10 / 1.10
    assert pip_value_per_lot("EURUSD", "EUR", RATES) == pytest.approx(10 / 1.10)
    # EUR account trading USDJPY: 1000 JPY -> EUR via USD: 1000/150/1.10
    assert pip_value_per_lot("USDJPY", "EUR", RATES) == pytest.approx(1000 / 150 / 1.10)
    # JPY account trading USDJPY: pip value is simply 1000 JPY
    assert pip_value_per_lot("USDJPY", "JPY", RATES) == pytest.approx(1000.0)
    # GBP account trading EURUSD: 10 USD / GBPUSD
    assert pip_value_per_lot("EURUSD", "GBP", RATES) == pytest.approx(10 / 1.25)


def test_conversion_missing_rate_raises() -> None:
    with pytest.raises(ConversionError):
        conversion_rate("JPY", "USD", {"EURUSD": 1.1})


def test_sizing_eurusd_1pct() -> None:
    r = position_size("EURUSD", 10_000, 1.0, entry=1.1000, stop=1.0980, account_ccy="USD", rates=RATES)
    assert r.stop_pips == pytest.approx(20.0)
    assert r.lots == pytest.approx(0.50)
    assert r.risk_amount_actual == pytest.approx(100.0)


def test_sizing_usdjpy_2pct() -> None:
    # 2% of 10k = $200; 30 pip stop; pip value 6.6667 -> 1.00 lot
    r = position_size("USDJPY", 10_000, 2.0, entry=150.00, stop=149.70, account_ccy="USD", rates=RATES)
    assert r.stop_pips == pytest.approx(30.0)
    assert r.pip_value_per_lot == pytest.approx(1000 / 150)
    assert r.lots == pytest.approx(1.00)
    assert r.risk_amount_actual <= 200.0 + 1e-9


def test_sizing_usdjpy_uses_current_price_for_conversion() -> None:
    rates = dict(RATES, USDJPY=100.0)
    r = position_size("USDJPY", 10_000, 1.0, entry=100.00, stop=99.80, account_ccy="USD", rates=rates)
    # pip value 10 USD at 100.00 -> $100 / (20 * 10) = 0.5 lots
    assert r.lots == pytest.approx(0.50)


def test_sizing_usdcad_and_cross() -> None:
    r = position_size("USDCAD", 50_000, 3.0, entry=1.3500, stop=1.3450, account_ccy="USD", rates=RATES)
    # $1500 / (50 pips * 7.4074) = 4.05 lots
    assert r.lots == pytest.approx(math.floor(1500 / (50 * 10 / 1.35) * 100) / 100)
    r2 = position_size("EURJPY", 10_000, 1.0, entry=165.00, stop=164.50, account_ccy="USD", rates=RATES)
    # $100 / (50 pips * 6.667) = 0.30 lots
    assert r2.lots == pytest.approx(0.30)


def test_sizing_rounds_down_never_over_risks() -> None:
    rng = np.random.default_rng(42)
    pairs = list(RATES) + ["EURGBP", "EURJPY", "GBPJPY"]
    for _ in range(2000):
        pair = pairs[rng.integers(len(pairs))]
        inst = get_instrument(pair)
        entry = {"EURGBP": 0.88, "EURJPY": 165.0, "GBPJPY": 187.5}.get(pair, RATES.get(pair, 1.0))
        stop_pips = float(rng.uniform(3, 300))
        side = 1 if rng.random() < 0.5 else -1
        stop = entry - side * stop_pips * inst.pip_size
        eq = float(rng.uniform(1_000, 1_000_000))
        rp = float(rng.uniform(1, 3))
        cost = float(rng.uniform(0, 3))
        r = position_size(pair, eq, rp, entry, stop, "USD", RATES, cost_pips=cost)
        assert r.risk_amount_actual <= eq * rp / 100 + 1e-6
        if r.lots > 0:
            assert r.lots >= inst.min_lot
            assert abs(round(r.lots / inst.lot_step) * inst.lot_step - r.lots) < 1e-9


def test_sizing_rejects_below_min_lot() -> None:
    r = position_size("EURUSD", 500, 1.0, entry=1.10, stop=1.05, account_ccy="USD", rates=RATES)
    assert r.lots == 0.0 and r.rejected_reason


def test_cost_pips_reduce_size() -> None:
    a = position_size("EURUSD", 10_000, 1.0, 1.1000, 1.0990, "USD", RATES)
    b = position_size("EURUSD", 10_000, 1.0, 1.1000, 1.0990, "USD", RATES, cost_pips=2.0)
    assert b.lots < a.lots


def test_zero_stop_raises() -> None:
    with pytest.raises(ValueError):
        position_size("EURUSD", 10_000, 1.0, 1.1, 1.1, "USD", RATES)


def test_config_enforces_risk_bounds() -> None:
    RiskConfig(risk_per_trade_pct=3.0)
    with pytest.raises(ValidationError):
        RiskConfig(risk_per_trade_pct=3.5)
    with pytest.raises(ValidationError):
        RiskConfig(max_risk_pct=5.0, risk_per_trade_pct=4.0)
    with pytest.raises(ValidationError):
        RiskConfig(risk_per_trade_pct=0.5)  # below user's 1% floor


def test_usd_direction() -> None:
    assert get_instrument("EURUSD").usd_direction(+1) == -1  # long EURUSD = short USD
    assert get_instrument("USDJPY").usd_direction(+1) == +1
    assert get_instrument("USDJPY").usd_direction(-1) == -1
    assert get_instrument("EURGBP").usd_direction(+1) == 0
