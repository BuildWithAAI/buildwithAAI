import math
import pytest
from aai_core.risk import vol as V, sizing as S, liquidity as LQ, guardrails as G, portfolio as PF


def candles(closes, spread=1.0):
    return [[i * 3600, c, c + spread, c - spread, c, 10] for i, c in enumerate(closes)]


def test_true_range_uses_prev_close():
    c = [[0, 10, 11, 9, 10, 0], [1, 14, 15, 13, 14, 0]]
    assert V.true_ranges(c) == [2, 5]          # max(2, |15-10|, |13-10|)


def test_atr_constant_and_wilder():
    assert V.atr(candles([100] * 20), 14) == pytest.approx(2.0)
    c = candles([100] * 15) + [[99, 100, 110, 100, 100, 0]]      # one TR of 10 after a 14-TR seed of 2
    assert V.atr(c, 14) == pytest.approx((2 * 13 + 10) / 14)
    assert V.atr(candles([1, 2, 3]), 14) is None


def test_realized_vol():
    assert V.realized_vol([100 * 1.01 ** i for i in range(50)], None, 365) == pytest.approx(0, abs=1e-12)
    xs = [100, 110, 100, 110, 100]
    r = math.log(1.1)
    sd = math.sqrt(sum((x) ** 2 for x in [r, -r, r, -r]) / 3)    # mean 0
    assert V.realized_vol(xs, None, 4) == pytest.approx(sd * 2)
    assert V.vol_ratio([100] * 10) is None


def test_sizing_long_short():
    s = S.position_size(10000, 1, 100, 95, "long")
    assert s["qty"] == pytest.approx(20) and s["risk_amount"] == pytest.approx(100) and s["notional"] == pytest.approx(2000)
    assert s["leverage"] == pytest.approx(0.2)
    s = S.position_size(10000, 2, 50, 55, "short")
    assert s["qty"] == pytest.approx(40) and s["risk_pct"] == pytest.approx(2)


@pytest.mark.parametrize("side,entry,stop", [("long", 100, 100), ("long", 100, 101), ("short", 100, 99), ("flat", 1, 2), ("long", -1, -2)])
def test_sizing_rejects_bad_stops(side, entry, stop):
    with pytest.raises(S.SizingError):
        S.position_size(1000, 1, entry, stop, side)


def test_sizing_caps_only_shrink():
    s = S.position_size(10000, 3, 100, 99.9, "long", max_leverage=5)      # uncapped notional 300k
    assert s["leverage"] == pytest.approx(5) and s["risk_pct"] < 3 and "max_leverage 5x" in s["capped_by"]
    s = S.position_size(10000, 1, 100, 90, "long", qty_step=3)
    assert s["qty"] == 9 and s["risk_amount"] <= 100


def test_sizing_fx_conversion_usdjpy():
    # USDJPY 150 -> 149: 1 JPY per unit = 1/150 USD; risk 100 USD -> qty 15000 USD
    s = S.position_size(10000, 1, 150, 149, "long", quote_to_account=1 / 150)
    assert s["qty"] == pytest.approx(15000) and s["risk_amount"] == pytest.approx(100) and s["notional"] == pytest.approx(15000)


def test_clamp_risk_pct():
    assert S.clamp_risk_pct(5)[0] == 3.0 and S.clamp_risk_pct(None)[0] == 1.0
    assert S.clamp_risk_pct(0.5)[1]
    with pytest.raises(S.SizingError):
        S.clamp_risk_pct(0)


def test_liquidity_checks():
    assert LQ.spread_check("crypto_perp", None)[0] == 0
    assert LQ.spread_check("crypto_perp", 1)[0] == 0
    assert LQ.spread_check("crypto_perp", 6)[0] == 10
    assert LQ.spread_check("forex", 12)[0] == 30
    d = {"levels": 20, "bid_notional": 1000, "ask_notional": 100000}
    assert LQ.depth_check(5000, "long", d)[0] == 0
    assert LQ.depth_check(500, "short", d)[0] == 30          # 50% of bid side
    assert LQ.adv_check(1e6, 1e8)[0] == 30 and LQ.adv_check(1e3, 1e8)[0] == 0
    assert LQ.avg_dollar_volume([[0, 1, 1, 1, 10, 5]] * 3) == 50


def test_guardrails():
    lim = G.limits({"limits": {"daily_loss_limit_pct": 2}})
    r, m = G.account_checks({"equity": 9700, "day_start_equity": 10000, "equity_peak": 10000}, lim)
    assert [x["code"] for x in r] == ["daily_loss_limit"] and r[0]["hard"] and m["day_pnl_pct"] == pytest.approx(-3)
    r, _ = G.account_checks({"equity": 8800, "equity_peak": 10000}, lim)
    assert r[0]["code"] == "drawdown_reduce" and not r[0]["hard"]
    r, _ = G.account_checks({"equity": 7900, "equity_peak": 10000}, lim)
    assert r[0]["code"] == "max_drawdown_halt" and r[0]["hard"]
    assert G.account_checks({}, lim)[1]["note"]


def test_correlation():
    a = [0.01 * ((-1) ** i) * (i % 5 + 1) for i in range(40)]
    assert PF.correlation(a, a) == pytest.approx(1)
    assert PF.correlation(a, [-x for x in a]) == pytest.approx(-1)
    assert PF.correlation(a[:5], a[:5]) is None and PF.correlation([0.0] * 20, a[:20]) is None
    ca = [[d * 86400, 0, 0, 0, 100 + d, 0] for d in range(30)]
    cb = [[d * 86400 + 3600, 0, 0, 0, 50 + d, 0] for d in range(5, 35)]
    ra, rb = PF.aligned_returns(ca, cb)
    assert len(ra) == len(rb) == 24


def test_aggregate_and_horizon():
    book = {"account": {"bankroll": 10000}, "positions": [
        {"agent": "perps", "asset_class": "crypto_perp", "symbol": "ETH", "side": "long", "entry": 3000, "stop": 2900, "qty": 1},
        {"agent": "fx", "asset_class": "forex", "symbol": "EURUSD", "side": "short", "entry": 1.1, "stop": 1.11, "qty": 10000},
        {"agent": "stocks", "asset_class": "equity", "symbol": "VTI", "side": "long", "entry": 300, "qty": 10},
        {"agent": "meme", "asset_class": "solana_meme", "symbol": "M", "side": "long", "notional": 40}]}
    a = PF.aggregate(book)
    assert a["total_risk"] == pytest.approx(100 + 100 + 40)
    assert a["long_term_notional"] == 3000 and a["total_risk_pct"] == pytest.approx(2.4)
    assert a["by_agent"]["fx"]["net"] == pytest.approx(-11000)


def test_correlated_risk_direction_and_assumed():
    pos = [{"asset_class": "crypto_perp", "symbol": "ETH", "side": "long", "entry": 10, "stop": 9, "qty": 10},
           {"asset_class": "crypto_perp", "symbol": "SOL", "side": "short", "entry": 10, "stop": 11, "qty": 10},
           {"asset_class": "solana_meme", "symbol": "M", "side": "long", "notional": 5},
           {"asset_class": "forex", "symbol": "EURUSD", "side": "long", "entry": 1, "stop": 0.9, "qty": 10},
           {"asset_class": "equity", "symbol": "VTI", "side": "long", "entry": 100, "qty": 10}]
    corr = {"ETH": 0.9, "SOL": -0.8, "EURUSD": 0.1}
    r = PF.correlated_risk({"asset_class": "crypto_perp", "side": "long"}, pos, lambda p: corr.get(p["symbol"]))
    syms = {m["symbol"]: m for m in r["members"]}
    assert set(syms) == {"ETH", "SOL", "M"} and syms["M"]["assumed"]       # short SOL with corr -0.8 moves with us
    assert r["existing_correlated_risk"] == pytest.approx(10 + 10 + 5)
