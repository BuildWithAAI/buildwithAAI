"""T11c: watchlist runway under 12 months / 1Y share growth of 10%+ -> silent INFO (aai/intel/alarms.fundamentals_alarms):
id per ticker + kind + period end, history wording only from an older period, junk-safe, capped, wired live-only.
Pure functions + recorded fixtures + tmp DB only (never data/aai.db)."""
from __future__ import annotations

import inspect

import pytest

from aai import guard
from aai.intel import alarms
from aai.intel.feeds import registry
from aai.intel.service import Intel
from tests.intel_replay import ReplayFetcher

W = {"intel": {"watchlist": ["AAPL", "TSLA", "MSTR"]}}


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    import time
    monkeypatch.setattr(time, "sleep", lambda s: None)


def _r(tk, end="2026-09-30", runway=None, yoy=None, flags=None, ocf=-40e6, fcf=-50e6, liq=30e6, form="10-Q", basis="cover page"):
    return {"ticker": tk, "period_end": end, "form": form, "runway_months": runway, "shares_yoy": yoy,
            "flags": flags if flags is not None else [], "ocf_ttm": ocf, "fcf_ttm": fcf, "liquidity": liq,
            "shares_basis": basis}


def test_runway_and_dilution_alarms_worded_and_ordered():
    p = {"rows": [_r("BBB", runway=9.4, yoy=0.25), _r("AAA", runway=3.0), _r("CCC", yoy=0.41, fcf=5e6, ocf=9e6),
                  _r("OK1", runway=30.0, yoy=0.02)]}
    a = alarms.fundamentals_alarms(p)
    assert [(x["ticker"], x["kind"]) for x in a] == [("AAA", "runway"), ("BBB", "runway"), ("CCC", "dilution"), ("BBB", "dilution")]
    r = a[0]
    assert r["id"] == "intel_fund_runway_AAA_2026-09-30" and r["sev"] == "info" and r["chime"] is False
    assert r["title"] == "AAA runway about 3 months (10-Q 09-30)"
    assert "FCF TTM -$50M" in r["detail"] and "$30M cash" in r["detail"] and "not a signal" in r["detail"]
    d = a[2]
    assert d["id"] == "intel_fund_dilution_CCC_2026-09-30" and d["title"] == "CCC share count +41% in a year (10-Q 09-30)"
    assert "at least 10%" in d["detail"] and "basis cover page;" in d["detail"]
    # what the HUD shows survives the agent_guard sanitiser intact
    for x in a:
        assert guard.clean(x["title"], 200) == x["title"] and guard.clean(x["detail"], 200) == x["detail"]


def test_thresholds_skips_and_cap():
    rows = [_r("EDGE", runway=12.0, yoy=0.0999),                     # exactly 12 months / just under 10%: no alarm
            _r("PROF", runway=5.0, ocf=10e6, fcf=-2e6),              # capex > OCF: not an operating burn
            _r("STAL", runway=2.0, yoy=0.5, flags=["STALE PERIOD"]),
            _r("BNK", yoy=0.3, flags=["BANK"]),
            _r("NOP", end=None, runway=2.0), _r("BADD", end="x", runway=2.0),
            {"ticker": 5}, "junk", _r("NAN", runway=float("nan"), yoy=True)]
    assert alarms.fundamentals_alarms({"rows": rows}) == []
    many = {"rows": [_r(f"T{i}", runway=float(i + 1)) for i in range(7)]}
    a = alarms.fundamentals_alarms(many)
    assert len(a) == alarms.FUND_ALARM_MAX == 4 and [x["ticker"] for x in a] == ["T0", "T1", "T2", "T3"]
    for bad in (None, {}, {"rows": "x"}, []):
        assert alarms.fundamentals_alarms(bad) == []


def test_new_period_retires_the_id_and_history_only_from_an_older_period():
    old = {"rows": [_r("AAA", end="2026-06-30", runway=20.0), _r("BBB", end="2026-06-30", yoy=0.3)]}
    cur = {"rows": [_r("AAA", runway=8.0), _r("BBB", yoy=0.2)]}
    a = {x["ticker"]: x for x in alarms.fundamentals_alarms(cur, old)}
    assert "new this period (not in 2026-06-30)" in a["AAA"]["detail"]
    assert "also in the period ending 2026-06-30" in a["BBB"]["detail"]
    # same period in prev (the usual 6 h refresh) or junk prev: no history wording, same alarms
    for prev in (cur, {"rows": "x"}, "junk", {"rows": [_r("AAA", end="bad", runway=1.0)]}):
        b = alarms.fundamentals_alarms(cur, prev)
        assert [x["id"] for x in b] == [x["id"] for x in alarms.fundamentals_alarms(cur)]
        assert not any("this period" in x["detail"] or "also in" in x["detail"] for x in b)
    nxt = alarms.fundamentals_alarms({"rows": [_r("AAA", end="2026-12-31", runway=7.0)]})
    assert nxt[0]["id"] == "intel_fund_runway_AAA_2026-12-31"


def test_ticker_is_id_safe():
    a = alarms.fundamentals_alarms({"rows": [_r("<b>X</b>", runway=2.0)]})
    assert a and "<" not in a[0]["id"] and "<" not in a[0]["title"]


def test_wired_from_live_fundamentals_only():
    src = inspect.getsource(Intel.alerts)
    i = src.index("fundamentals_alarms")
    assert 'uv.get("status") == "live"' in src[i - 400:i]


def test_service_raises_dilution_alarms_from_replayed_feed(cfg, store):
    it = Intel(W | cfg, store, fetcher=ReplayFetcher(), feeds={"fundamentals": registry()["fundamentals"]})
    assert not [x for x in it.alerts() if x["id"].startswith("intel_fund_")]
    assert it.refresh(force=True)[0]["ok"] is True
    got = {x["ticker"]: x for x in it.alerts() if x["id"].startswith("intel_fund_")}
    assert set(got) == {"TSLA", "MSTR"} and all(x["kind"] == "dilution" for x in got.values())
    assert got["MSTR"]["shares_yoy"] > got["TSLA"]["shares_yoy"] >= 0.10


def test_spoken_answer_names_flags_past_the_first_four_rows(cfg, store):
    it = Intel(W | cfg, store, fetcher=ReplayFetcher(), feeds={"fundamentals": registry()["fundamentals"]})
    assert it.refresh(force=True)[0]["ok"] is True
    t = it.fundamentals_text()
    assert "Flagged this period: MSTR share count +" in t and "TSLA share count +" in t
    assert t.index("MSTR share count") < t.index("TSLA share count", t.index("Flagged"))
