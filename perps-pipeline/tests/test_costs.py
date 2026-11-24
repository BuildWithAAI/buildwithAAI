import math

from perps.core.costs import CostModel, funding_payment, gross_pnl


def test_fee_math():
    c = CostModel(maker_fee=0.0002, taker_fee=0.0006)
    assert math.isclose(c.fee(1000), 0.6)
    assert math.isclose(c.fee(1000, maker=True), 0.2)
    assert math.isclose(c.fee(-1000), 0.6)


def test_slippage_is_always_adverse():
    c = CostModel(market_slippage_bps=10, stop_slippage_bps=10)
    assert c.market_fill(100, +1) > 100 and c.market_fill(100, -1) < 100
    assert math.isclose(c.market_fill(100, 1), 100.1)
    assert math.isclose(c.stop_fill(100, -1), 99.8)


def test_funding_sign_convention():
    # positive rate: long pays, short receives
    assert math.isclose(funding_payment(+1, 2.0, 100.0, 0.0001), -0.02)
    assert math.isclose(funding_payment(-1, 2.0, 100.0, 0.0001), 0.02)
    # negative rate: long receives
    assert funding_payment(+1, 2.0, 100.0, -0.0001) > 0


def test_gross_pnl():
    assert gross_pnl(1, 2, 100, 110) == 20
    assert gross_pnl(-1, 2, 100, 110) == -20
