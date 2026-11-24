import numpy as np
import pandas as pd
import pytest

from billy.backtest import buy_and_hold, run_backtest, summarize
from billy.backtest.metrics import breakdown, max_drawdown_pct, sharpe_sortino, spearman, trade_stats
from billy.backtest.validation import grid_configs, validate
from billy.models import Scenario, Signal
from billy.strategy import EventCalendar, build_setups

FLAT = 99.0


def path(pre, post):
    return list(pre) + list(post)


def run(settings, md, sigs, **cfg):
    settings.assets = list(md.h1)
    settings.costs.fee_bps = 0
    settings.costs.slippage_bps = 0
    strat = settings.strategy.model_copy(update=dict(max_chase_pct=50, btc_filter=False, **cfg))
    setups = build_setups(sigs, strat, md.h1, md.d1["BTC"])
    return run_backtest(setups, md, settings, strategy=strat)


def long_sig(ts, level=100.0, target=None, kind="breakout"):
    return Signal(post_id="1", asset="ETH", post_ts=ts, url="u", close_label="bullish", bias=1,
                  parse_status="actionable",
                  scenarios=[Scenario(side="long", cond="above", level=level, target=target, kind=kind, explicit=True)])


def test_breakout_long_hits_target_after_post(settings, mk_md):
    eth = path([FLAT] * 30, [101, 101.5, 102, 103, 104, 106, 108, 112, 112, 112] + [112] * 20)
    md = mk_md({"BTC": [100.0] * len(eth), "ETH": eth})
    post = md.h1["ETH"].index[30]  # first breakout bar opens exactly at post time
    r = run(settings, md, [long_sig(post, target=110.0)], n_hold=2, partial_fraction=0.0)
    assert len(r.trades) == 1
    t = r.trades[0]
    # two closes above 100 (bars 30,31) -> fill at bar 32 open (=101.5, previous close)
    assert pd.Timestamp(t.entry_ts) == md.h1["ETH"].index[32] and t.entry == pytest.approx(101.5)
    assert t.exit_reason == "target" and t.exit_price == pytest.approx(110.0) and t.r_multiple > 1
    assert pd.Timestamp(t.entry_ts) > post


def test_no_lookahead_pre_post_bars_ignored(settings, mk_md):
    eth = path([FLAT] * 20, [105] * 10 + [FLAT] * 30)  # breakout happened BEFORE the post
    md = mk_md({"BTC": [100.0] * len(eth), "ETH": eth})
    post = md.h1["ETH"].index[31]
    r = run(settings, md, [long_sig(post)])
    assert r.trades == [] and r.rejections.get("expired_untriggered") == 1


def test_stop_assumed_before_target_same_bar(settings, mk_md, mk_frame):
    eth = path([FLAT] * 30, [101, 102, 102] + [102] * 20)
    md = mk_md({"BTC": [100.0] * len(eth), "ETH": eth})
    f = md.h1["ETH"]
    i = 33
    f.iloc[i, f.columns.get_loc("high")] = 200.0
    f.iloc[i, f.columns.get_loc("low")] = 50.0
    r = run(settings, md, [long_sig(f.index[30], target=110.0)], n_hold=2)
    assert r.trades[0].exit_reason == "stop" and r.trades[0].r_multiple == pytest.approx(-1.0, abs=0.05)


def test_partial_then_breakeven(settings, mk_md):
    eth = path([FLAT] * 30, [101, 101.5, 102, 103.5, 104, 101.6, 101] + [101] * 10)
    md = mk_md({"BTC": [100.0] * len(eth), "ETH": eth})
    r = run(settings, md, [long_sig(md.h1["ETH"].index[30], target=130.0)], n_hold=2, stop_atr_mult=0.5)
    t = r.trades[0]
    assert t.partial_taken and t.exit_reason == "breakeven"
    assert t.pnl_usd > 0 and 0 < t.r_multiple < 1


def test_retest_reversal(settings, mk_md):
    eth = path([103.0] * 30, [102, 100.1, 100.2, 101.5, 102.5, 103, 104] + [104] * 10)
    md = mk_md({"BTC": [100.0] * len(eth), "ETH": eth})
    r = run(settings, md, [long_sig(md.h1["ETH"].index[30], kind="retest")], retest_tol_pct=0.3)
    assert len(r.trades) == 1 and r.trades[0].rule == "R2_retest_reversal"


def test_costs_reduce_pnl(settings, mk_md):
    eth = path([FLAT] * 30, [101, 101.5, 102, 103, 104, 106, 108, 112] + [112] * 20)
    md = mk_md({"BTC": [100.0] * len(eth), "ETH": eth})
    sigs = [long_sig(md.h1["ETH"].index[30], target=110.0)]
    gross = run(settings, md, sigs).trades[0].pnl_usd
    settings.costs.fee_bps, settings.costs.slippage_bps = 10, 5
    strat = settings.strategy.model_copy(update=dict(max_chase_pct=50, btc_filter=False))
    net = run_backtest(build_setups(sigs, strat, md.h1, md.d1["BTC"]), md, settings, strategy=strat).trades[0]
    assert net.pnl_usd < gross and net.fees_usd > 0


def test_blackout_blocks_entry(settings, mk_md):
    n = 60
    eth = path([FLAT] * 30, [101, 101.5, 102, 103] + [103] * (n - 34))
    md = mk_md({"BTC": [100.0] * n, "ETH": eth}, start="2026-10-27T00:00:00")
    settings.assets = ["BTC", "ETH"]
    cal = EventCalendar.from_yaml(settings.paths.events_file)
    strat = settings.strategy.model_copy(update=dict(max_chase_pct=50, btc_filter=False,
                                                     event_blackout_before_h=48, event_blackout_after_h=48))
    setups = build_setups([long_sig(md.h1["ETH"].index[30])], strat, md.h1, md.d1["BTC"])
    r = run_backtest(setups, md, settings, strategy=strat, calendar=cal)
    assert r.trades == [] and r.rejections.get("blackout_FOMC") == 1


def test_total_risk_never_exceeds_cap(settings, mk_md):
    rng = np.random.default_rng(0)
    n = 24 * 20
    md = mk_md({a: list(100 * np.cumprod(1 + rng.normal(0, 0.004, n))) for a in ["BTC", "ETH", "XRP", "LTC", "LINK"]})
    sigs = []
    for k, a in enumerate(["BTC", "ETH", "XRP", "LTC", "LINK"] * 6):
        ts = md.h1[a].index[24 + k * 12]
        lvl = float(md.h1[a].close.iloc[24 + k * 12])
        sigs.append(Signal(post_id=str(k), asset=a, post_ts=ts, url="u", close_label="bullish", bias=1,
                           parse_status="actionable",
                           scenarios=[Scenario(side="long", cond="above", level=lvl, kind="breakout", explicit=True)]))
    settings.assets = list(md.h1)
    strat = settings.strategy.model_copy(update=dict(max_chase_pct=50, btc_filter=False, n_hold=1))
    r = run_backtest(build_setups(sigs, strat, md.h1, md.d1["BTC"]), md, settings, strategy=strat)
    df = r.trades_df()
    assert len(df) > 3 and df.risk_pct.max() <= 3.0
    ev = []
    for t in r.trades:
        ev += [(pd.Timestamp(t.entry_ts), t.risk_pct), (pd.Timestamp(t.exit_ts), -t.risk_pct)]
    run_sum, peak = 0.0, 0.0
    for _, x in sorted(ev, key=lambda e: (e[0], e[1])):
        run_sum += x
        peak = max(peak, run_sum)
    assert peak <= 3.0 + 1e-6  # initial-risk view (conservative: ignores breakeven release)


def test_metrics_basic():
    idx = pd.date_range("2026-01-01", periods=10, freq="1D", tz="UTC")
    eq = pd.Series([100, 110, 99, 120, 118, 125, 130, 128, 140, 150], index=idx, dtype=float)
    assert max_drawdown_pct(eq) == pytest.approx(-10.0)
    sh, so = sharpe_sortino(eq)
    assert sh > 0 and so > 0
    df = pd.DataFrame({"pnl_usd": [10, -5, 20], "r_multiple": [1, -0.5, 2], "fees_usd": [1, 1, 1],
                       "entry_ts": [str(idx[0])] * 3, "exit_ts": [str(idx[1])] * 3, "rule": ["a", "a", "b"]})
    st = trade_stats(df)
    assert st["trades"] == 3 and st["profit_factor"] == 6.0 and st["win_rate_pct"] == pytest.approx(66.7)
    assert set(breakdown(df, "rule")) == {"a", "b"} and trade_stats(df.iloc[:0])["trades"] == 0
    m = summarize(df, eq, 100)
    assert m["return_pct"] == 50.0
    bh = buy_and_hold({"BTC": eq}, idx[0], idx[-1], 1000)
    assert bh["BTC"]["return_pct"] == 50.0 and "EW_basket" in bh
    assert spearman([1, 2, 3], [1, 2, 3]) == pytest.approx(1.0) and spearman([1], [1]) is None


def test_validate_small(settings, mk_md):
    rng = np.random.default_rng(1)
    n = 24 * 100
    md = mk_md({a: list(100 * np.cumprod(1 + rng.normal(0, 0.004, n))) for a in ["BTC", "ETH"]})
    settings.assets = ["BTC", "ETH"]
    settings.backtest.grid = {"n_hold": [1, 2], "stop_atr_mult": [0.5, 1.0]}
    settings.backtest.min_trades_for_selection = 1
    sigs = []
    for k in range(60):
        a = "ETH"
        i = 30 + k * 36
        lvl = float(md.h1[a].close.iloc[i])
        sigs.append(Signal(post_id=str(k), asset=a, post_ts=md.h1[a].index[i], url="u", close_label="bullish",
                           bias=1, parse_status="actionable",
                           scenarios=[Scenario(side="long", cond="above", level=lvl, kind="breakout", explicit=True)]))
    settings.strategy = settings.strategy.model_copy(update=dict(max_chase_pct=50, btc_filter=False))
    cal = EventCalendar.from_yaml(settings.paths.events_file)
    v = validate(sigs, md, settings, cal, md.h1["BTC"].index[0], md.h1["BTC"].index[-1])
    assert len(v.grid) == 4 and v.walk_forward and v.wf_oos_metrics is not None
    assert v.is_metrics["trades"] + v.oos_metrics["trades"] > 0
    assert any("grid configs" in f for f in v.flags)
    assert len(grid_configs(settings.strategy, settings.backtest.grid)) == 4
