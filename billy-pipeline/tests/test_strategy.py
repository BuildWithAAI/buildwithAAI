from datetime import datetime, timezone

import pandas as pd

from billy.models import Scenario, Signal, StatedPosition
from billy.strategy import EventCalendar, FilterContext, btc_bias_at, build_setups, position_mismatch


def sig(asset="ETH", ts="2026-06-02T00:30:00Z", bias=1, scen=None, status="actionable", **kw):
    scen = scen if scen is not None else [Scenario(side="long", cond="above", level=100.0, target=110.0,
                                                   kind="breakout", explicit=True)]
    return Signal(post_id=kw.pop("pid", "1"), asset=asset, post_ts=ts, url="u", close_label="bullish", bias=bias,
                  parse_status=status, scenarios=scen, **kw)


def test_event_calendar_fomc_utc(settings):
    cal = EventCalendar.from_yaml(settings.paths.events_file)
    fomc = datetime(2026, 10, 28, 18, 0, tzinfo=timezone.utc)  # 14:00 EDT
    assert cal.blackout(fomc, 2, 2) == "FOMC"
    assert cal.blackout(fomc.replace(hour=15), 2, 2) is None
    assert cal.blackout(fomc.replace(hour=19, minute=59), 2, 2) == "FOMC"
    assert cal.known_gaps
    assert any(n == "CPI" for _, n in cal.upcoming(datetime(2026, 11, 9, tzinfo=timezone.utc), 48))


def test_btc_bias_no_lookahead(mk_md):
    md = mk_md({"BTC": [100 + i for i in range(72)]})
    t = datetime(2026, 6, 2, 12, tzinfo=timezone.utc)
    future = sig("BTC", ts="2026-06-02T13:00:00Z", bias=-2)
    assert btc_bias_at(t, [future], md.d1["BTC"]) == 1  # falls back to last closed daily candle (up)
    past = sig("BTC", ts="2026-06-02T01:00:00Z", bias=-1)
    assert btc_bias_at(t, [past, future], md.d1["BTC"]) == -1
    assert btc_bias_at(datetime(2026, 6, 1, 5, tzinfo=timezone.utc), [], md.d1["BTC"]) == 0


def test_position_mismatch():
    s = sig(stated_positions=[StatedPosition(relation="above", level=100)])
    assert position_mismatch(s, 98.0, 1.0) and not position_mismatch(s, 99.5, 1.0)
    s = sig(stated_positions=[StatedPosition(relation="below", level=100)])
    assert position_mismatch(s, 102.0, 1.0)


def test_build_setups_filters(settings, mk_md):
    md = mk_md({"BTC": [100.0] * 72, "ETH": [99.0] * 72})
    cfg = settings.strategy
    ctx = FilterContext()
    sigs = [
        sig(pid="1"),
        sig(pid="2", bias=-1),  # bias opposes long
        sig(pid="3", status="no_trade", scen=[]),
        sig(pid="4", scen=[Scenario(side="long", cond="above", level=500.0, kind="breakout")]),  # too far
        sig(pid="5", scen=[Scenario(side="flat", cond="above", level=100.0, kind="sideways")]),
    ]
    out = build_setups(sigs, cfg, md.h1, md.d1["BTC"], ctx)
    assert [u.signal.post_id for u in out] == ["1"]
    assert ctx.rejections["bias_opposes"] == 1 and ctx.rejections["parse_no_trade"] == 1
    assert ctx.rejections["level_too_far"] == 1
    u = out[0]
    assert u.rule == "R1_bias_then_trigger" and u.valid_from == sigs[0].post_ts
    assert u.confirmed  # bias +, BTC flat (not opposing), explicit
    cfg2 = cfg.model_copy(update={"scenario_strength": "explicit", "skip_indecisive": True})
    out2 = build_setups([sig(pid="6", bias=0), sig(pid="7", scen=[Scenario(side="long", cond="above", level=100.0)])],
                        cfg2, md.h1, md.d1["BTC"], ctx)
    assert out2 == [] and ctx.rejections["indecisive_close"] == 1 and ctx.rejections["not_explicit"] == 1


def test_btc_filter_blocks_alt(settings, mk_md):
    md = mk_md({"BTC": [100.0] * 72, "ETH": [99.0] * 72})
    btc_bear = sig("BTC", pid="b", ts="2026-06-02T00:00:00Z", bias=-2,
                   scen=[Scenario(side="short", cond="below", level=99.0, kind="breakout")])
    eth = sig("ETH", pid="e", ts="2026-06-02T00:30:00Z", bias=0)
    ctx = FilterContext()
    out = build_setups([btc_bear, eth], settings.strategy, md.h1, md.d1["BTC"], ctx)
    assert [u.asset for u in out] == ["BTC"] and ctx.rejections["btc_opposes"] == 1


def test_ttl_ends_at_next_post(settings, mk_md):
    md = mk_md({"BTC": [100.0] * 72, "ETH": [99.0] * 72})
    a = sig(pid="1", ts="2026-06-02T00:30:00Z")
    b = sig(pid="2", ts="2026-06-02T05:30:00Z")
    out = build_setups([a, b], settings.strategy, md.h1, md.d1["BTC"])
    assert out[0].valid_until == b.post_ts
    assert out[1].valid_until == pd.Timestamp("2026-06-03T05:30:00Z")
