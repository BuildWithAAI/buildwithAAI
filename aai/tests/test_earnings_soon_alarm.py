"""Watchlist earnings estimated within 7 days -> silent INFO (aai/intel/alarms.earnings_soon_alarms): quarterly
cadence only, days from today's New York date at render time, capped/sorted, junk-safe, wired live-filings only.
Pure functions; no DB, no network."""
from __future__ import annotations

import inspect
from datetime import datetime
from zoneinfo import ZoneInfo

from aai.intel import alarms

NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 11, 25, 17, 30, tzinfo=NY).timestamp()


def _e(est, cadence="quarterly", last="2026-09-02", gap=91):
    return {"cadence": cadence, "est_next": est, "reports": [last], "median_gap_days": gap}


def test_within_window_sorted_and_worded_as_estimate():
    earn = {"AVGO": _e("2026-12-02"), "JPM": _e("2027-01-12"), "ORCL": _e("2026-11-26", gap=90.5), "XYZ": _e("2026-11-25")}
    a = alarms.earnings_soon_alarms(earn, NOW)
    assert [x["ticker"] for x in a] == ["XYZ", "ORCL", "AVGO"]
    assert [x["in_days"] for x in a] == [0, 1, 7]
    assert a[0]["title"] == "XYZ earnings est. ~11-25 (today)" and a[1]["title"].endswith("(tomorrow)")
    av = a[2]
    assert av["id"] == "intel_earn_est_AVGO_2026-12-02" and av["sev"] == "info" and av["chime"] is False
    assert av["title"] == "AVGO earnings est. ~12-02 (in 7 days)"
    assert "8-K item 2.02" in av["detail"] and "last 2026-09-02" in av["detail"] and "~91 days" in av["detail"]
    assert "not a confirmed date" in av["detail"] and "not a signal" in av["detail"]
    assert "~90.5 days" in a[1]["detail"]


def test_outside_window_past_irregular_and_cap():
    earn = {"A": _e("2026-12-03"), "B": _e("2026-11-24"), "C": _e("2026-11-27", cadence="irregular"),
            "D": _e(None), "E": _e("bad-date"), "F": "junk"}
    assert alarms.earnings_soon_alarms(earn, NOW) == []
    many = {f"T{i}": _e("2026-11-30") for i in range(6)}
    assert len(alarms.earnings_soon_alarms(many, NOW)) == alarms.EARN_SOON_MAX == 3
    assert alarms.earnings_soon_alarms(None, NOW) == [] and alarms.earnings_soon_alarms({}, "x") == []


def test_days_follow_the_clock_not_the_fetch():
    earn = {"AVGO": _e("2026-12-02")}
    later = datetime(2026, 12, 1, 9, 0, tzinfo=NY).timestamp()
    assert alarms.earnings_soon_alarms(earn, later)[0]["title"].endswith("(tomorrow)")
    after = datetime(2026, 12, 3, 9, 0, tzinfo=NY).timestamp()
    assert alarms.earnings_soon_alarms(earn, after) == []


def test_ticker_is_id_safe():
    a = alarms.earnings_soon_alarms({"<b>X</b>": _e("2026-11-28")}, NOW)
    assert a and "<" not in a[0]["id"] and "<" not in a[0]["title"]


def test_wired_from_live_filings_only():
    from aai.intel.service import Intel
    src = inspect.getsource(Intel.alerts)
    assert "earnings_soon_alarms" in src
    i = src.index("earnings_soon_alarms")
    assert 'fv.get("status") == "live"' in src[i - 300:i]
