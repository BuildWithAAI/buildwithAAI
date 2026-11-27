"""Sector breadth: share above 20D crossing 50% after 5+ sessions on the other side -> above_history.cross,
INFO alarm (soft chime, once per session/direction, live feed only), voice sentence and HUD chip. Pure / tmp only."""
from __future__ import annotations

import inspect
from pathlib import Path

from aai.intel import alarms, breadth
from aai.intel.adapters import yahoo
from tests.test_breadth_above_hist import _rows

ROOT = Path(__file__).resolve().parents[1]
SYMS = [s[1] for s in yahoo.SECTORS]


def _paths(n_above_by_session):
    """Bars so that session k (after a 20-bar warmup) has exactly n_above_by_session[k] of 11 sectors above their
    close 20 bars earlier: sector i rises 1%/bar while i < n, otherwise falls, using a 20-bar flat warmup."""
    paths = {s: [100.0] * 20 for s in SYMS}
    for n in n_above_by_session:
        for i, s in enumerate(SYMS):
            prev20 = paths[s][-20]
            paths[s].append(prev20 * (1.01 if i < n else 0.99))
    return paths


def test_cross_up_after_5_sessions_below():
    ah = breadth.above_history(_rows(_paths([3] * 6 + [8])))
    assert [p["above"] for p in ah["points"]] == [3] * 6 + [8]
    assert ah["side"] == "above_half" and ah["side_since"]["sessions"] == 1
    assert ah["prev_side"]["side"] == "below_half" and ah["prev_side"]["sessions"] == 6 and ah["prev_side"]["whole_window"]
    cr = ah["cross"]
    assert cr["to"] == "above_half" and cr["prev_sessions"] == 6 and cr["day"] == ah["points"][-1]["day"]
    a = alarms.breadth_above_cross_alarms(ah, "OK")
    assert len(a) == 1 and a[0]["sev"] == "info" and a[0]["chime"] is True
    assert a[0]["id"] == f"intel_breadth_above20_{cr['day']}_up"
    assert "crossed above 50%: 73% above 20D" in a[0]["title"]
    assert "8 of 11 sectors" in a[0]["detail"] and "at least 6 sessions below half" in a[0]["detail"]
    assert "not a signal" in a[0]["detail"]


def test_cross_down_and_no_cross_cases():
    ah = breadth.above_history(_rows(_paths([2] * 3 + [9] * 5 + [4])))
    assert ah["cross"]["to"] == "below_half" and ah["cross"]["prev_sessions"] == 5 and not ah["cross"]["prev_whole_window"]
    a = alarms.breadth_above_cross_alarms(ah, "OK")
    assert a[0]["id"].endswith("_down") and "crossed below 50%" in a[0]["title"] and "5 sessions above half" in a[0]["detail"]
    # only 4 sessions on the other side: no cross
    assert breadth.above_history(_rows(_paths([3] * 4 + [8])))["cross"] is None
    # second session on the new side: not a fresh cross any more
    assert breadth.above_history(_rows(_paths([3] * 6 + [8, 8])))["cross"] is None
    # never crossed
    ah = breadth.above_history(_rows(_paths([3] * 8)))
    assert ah["cross"] is None and ah["prev_side"] is None
    assert alarms.breadth_above_cross_alarms(ah, "OK") == []


def test_at_half_is_not_a_cross():
    # 10 sectors so 5/10 = exactly 50%: below -> at half is not a cross; at half -> above follows a 1-session run
    paths = {s: v for s, v in _paths([2] * 6 + [5] + [8]).items() if s != SYMS[-1]}
    pts_paths = {s: v for s, v in _paths([2] * 6 + [5]).items() if s != SYMS[-1]}
    ah = breadth.above_history(_rows(pts_paths))
    assert ah["side"] == "at_half" and ah["cross"] is None
    ah2 = breadth.above_history(_rows(paths))
    assert ah2["prev_side"]["side"] == "at_half" and ah2["cross"] is None


def test_alarm_guards_stale_junk_and_old_day():
    ah = breadth.above_history(_rows(_paths([3] * 6 + [8])))
    assert alarms.breadth_above_cross_alarms(ah, "STALE") == []
    assert alarms.breadth_above_cross_alarms(None) == [] and alarms.breadth_above_cross_alarms({"cross": "x"}) == []
    bad = dict(ah, cross=dict(ah["cross"], pct=True))
    assert alarms.breadth_above_cross_alarms(bad) == []
    bad = dict(ah, cross=dict(ah["cross"], to="sideways"))
    assert alarms.breadth_above_cross_alarms(bad) == []
    old = dict(ah, cross=dict(ah["cross"], day="2020-01-02"))  # not the latest session -> silent
    assert alarms.breadth_above_cross_alarms(old) == []


def _live(rows):
    for r in rows:
        r["chg"], r["chg_20d"] = 0.01, 0.01
    return rows


def test_voice_speaks_cross_once_on_the_day():
    rows = _live(_rows(_paths([3] * 6 + [8])))
    b = breadth.compute(rows)
    b["above_hist"] = breadth.above_history(rows)
    t = breadth.text(b)
    assert "That is a cross above half today after at least 6 sessions below it." in t
    rows = _live(_rows(_paths([3] * 6 + [8, 8])))
    b = breadth.compute(rows)
    b["above_hist"] = breadth.above_history(rows)
    t = breadth.text(b)  # no longer "today's cross"; the follow-up (recent_cross, closed sessions) says it held
    assert "That is a cross" not in t and "cross above half has held at 2 closes so far." in t


def test_service_wires_cross_alarm_from_live_sectors_and_js_chip_is_safe():
    from aai.intel.service import Intel
    src = inspect.getsource(Intel.alerts)
    assert "breadth_above_cross_alarms" in src and 'status") == "live"' in src
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    i = js.index("function renderBreadthAbove")
    body = js[i:js.index("\n}\n", i)]
    assert "h.cross" in body and "sb-ab-x" in body and "innerHTML" not in body
