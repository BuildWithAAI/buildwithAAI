import math

import pytest
from pydantic import ValidationError

from perps.config import RiskCfg
from perps.risk.sizing import liquidation_price, size_position


def _size(spec, **kw):
    base = dict(equity=100.0, risk_fraction=0.015, entry_price=50_000.0, stop_price=49_500.0, side=1, spec=spec,
                taker_fee=0.0, stop_slippage_bps=0.0, max_leverage=10, margin_leverage=10, mmr=0.005)
    base.update(kw)
    return size_position(**base)


def test_size_equals_risk_over_stop_distance_no_costs(unit_spec):
    r = _size(unit_spec)
    # risk $1.50 / $500 stop distance = 0.003 units
    assert r.ok
    assert math.isclose(r.qty, 0.003, rel_tol=1e-9)
    assert math.isclose(r.notional, 150.0, rel_tol=1e-9)
    assert math.isclose(r.implied_leverage, 1.5, rel_tol=1e-9)
    assert math.isclose(r.expected_loss_at_stop, 1.5, rel_tol=1e-9)


def test_fees_and_slippage_reduce_size_so_loss_stays_at_budget(unit_spec):
    r = _size(unit_spec, taker_fee=0.0006, stop_slippage_bps=5)
    assert r.ok and r.qty < 0.003
    assert r.expected_loss_at_stop <= 1.5 + 1e-9
    stop_fill = 49_500 * (1 - 5 / 1e4)
    loss = r.qty * (50_000 - stop_fill) + r.qty * 50_000 * 0.0006 + r.qty * stop_fill * 0.0006
    assert math.isclose(loss, r.expected_loss_at_stop, rel_tol=1e-9)


def test_lot_rounding_floors_to_lot_size(spec):
    # BTC-like: 0.001 BTC/contract, lot 0.1 contract => 0.0001 BTC increments
    r = _size(spec, stop_price=49_000.0)  # $1.5 / $1000 = 0.0015 BTC = 1.5 contracts
    assert r.ok and math.isclose(r.contracts, 1.5) and math.isclose(r.qty, 0.0015)
    r2 = _size(spec, stop_price=48_700.0)  # 0.0011538 BTC -> 1.1538 contracts -> 1.1
    assert math.isclose(r2.contracts, 1.1)
    assert r2.expected_loss_at_stop < 1.5


def test_below_min_size_is_rejected(spec):
    r = _size(spec, equity=1.0, stop_price=40_000.0)
    assert not r.ok and "min size" in r.reason


def test_short_side_and_wrong_side_stop(unit_spec):
    r = _size(unit_spec, side=-1, stop_price=50_500.0)
    assert r.ok and r.side == -1 and math.isclose(r.qty, 0.003)
    bad = _size(unit_spec, side=-1, stop_price=49_500.0)
    assert not bad.ok and "wrong side" in bad.reason


def test_max_leverage_cap(unit_spec):
    r = _size(unit_spec, stop_price=49_990.0, max_leverage=3)  # tight stop would need 150x
    assert r.ok and "capped" in r.reason
    assert r.implied_leverage <= 3 + 1e-9


def test_stop_beyond_liquidation_rejected(unit_spec):
    r = _size(unit_spec, equity=10_000.0, stop_price=44_000.0, margin_leverage=10)  # 12% stop vs ~9.5% liq distance
    assert not r.ok and "liquidation" in r.reason


def test_liquidation_price_formula():
    assert math.isclose(liquidation_price(100, 1, 10, 0.005), 90.5)
    assert math.isclose(liquidation_price(100, -1, 10, 0.005), 109.5)


def test_available_margin_cap(unit_spec):
    r = _size(unit_spec, available_margin=5.0, margin_leverage=10)  # only $50 notional allowed
    assert r.ok and r.notional <= 50 + 1e-9


def test_risk_config_caps():
    assert RiskCfg().risk_per_trade == 0.015
    with pytest.raises(ValidationError):
        RiskCfg(risk_per_trade=0.05)  # above 3% hard cap without explicit override
    assert RiskCfg(risk_per_trade=0.05, allow_above_hard_cap=True).risk_per_trade == 0.05
    with pytest.raises(ValidationError):
        RiskCfg(risk_per_trade=0.13, allow_above_hard_cap=True)  # absolute max 12%
    with pytest.raises(ValidationError):
        RiskCfg(absolute_max=0.2)
