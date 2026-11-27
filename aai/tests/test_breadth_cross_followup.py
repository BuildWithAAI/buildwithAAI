"""Breadth >20D 50%-cross follow-up: is today's bar live (NY session open), recent_cross HELD / UNWOUND judged on
closed sessions, silent INFO follow-up alarms (held the session after, unwound on the session it went back), voice
and the JS chip (SVG/textContent only). Pure functions on synthetic bars; no DB, no network."""
from __future__ import annotations

import inspect
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from aai.intel import alarms, breadth
from tests.test_breadth_above_cross import _live, _paths
from tests.test_breadth_above_hist import _rows

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo("America/New_York")


def _at(day: str, hh: int, mm: int = 0) -> float:
    y, m, d = map(int, day.split("-"))
    return datetime(y, m, d, hh, mm, tzinfo=NY).timestamp()


def test_session_live_only_today_before_the_close_on_weekdays():
    assert breadth.session_live("2026-11-25", _at("2026-11-25", 11)) is True
    assert breadth.session_live("2026-11-25", _at("2026-11-25", 15, 59)) is True
    assert breadth.session_live("2026-11-25", _at("2026-11-25", 16, 0)) is False  # closed
    assert breadth.session_live("2026-11-24", _at("2026-11-25", 11)) is False  # earlier day
    assert breadth.session_live("2026-11-28", _at("2026-11-28", 11)) is False  # Saturday
    assert breadth.session_live(None) is False and breadth.session_live("2026-11-25", "x") is False


def test_cross_today_live_vs_held_at_close():
    rows = _rows(_paths([3] * 6 + [8]))
    day = breadth.above_history(rows)["points"][-1]["day"]
    ah = breadth.above_history(rows, now=_at(day, 12))
    assert ah["last_live"] is True and ah["cross"]["live"] is True
    rc = ah["recent_cross"]
    assert rc["status"] == "live" and rc["closed_sessions"] == 0 and rc["sessions_since"] == 0
    a = alarms.breadth_above_cross_alarms(ah, "OK")[0]
    assert "(live while the session is open)" in a["detail"] and a["live"] is True
    assert alarms.breadth_above_cross_followup_alarms(ah, "OK") == []  # nothing to follow up yet
    b = breadth.compute(_live(rows)); b["above_hist"] = ah
    assert "can undo itself before the close" in breadth.text(b)

    ah = breadth.above_history(rows, now=_at(day, 16, 30))
    assert ah["last_live"] is False and ah["cross"]["live"] is False
    assert ah["recent_cross"]["status"] == "held" and ah["recent_cross"]["closed_sessions"] == 1
    a = alarms.breadth_above_cross_alarms(ah, "OK")[0]
    assert "(held at the close)" in a["detail"] and a["live"] is False and a["chime"] is True
    assert alarms.breadth_above_cross_followup_alarms(ah, "OK") == []  # the cross alarm itself says it held
    b["above_hist"] = ah
    assert "It held at the close." in breadth.text(b)


def test_held_next_session_raises_silent_info_once_then_stops():
    rows = _rows(_paths([3] * 6 + [8, 7]))
    day = breadth.above_history(rows)["points"][-1]["day"]
    ah = breadth.above_history(rows, now=_at(day, 11))  # next session, still live
    assert ah["cross"] is None
    rc = ah["recent_cross"]
    assert rc["status"] == "held" and rc["held_sessions"] == 2 and rc["closed_sessions"] == 1 and rc["sessions_since"] == 1
    a = alarms.breadth_above_cross_followup_alarms(ah, "OK")
    assert len(a) == 1 and a[0]["sev"] == "info" and a[0]["chime"] is False
    assert a[0]["id"] == f"intel_breadth_above20_held_{rc['day']}_up"
    assert "held at the close" in a[0]["title"] and "64% now, still above" in a[0]["detail"] and "not a signal" in a[0]["detail"]
    b = breadth.compute(_live(rows)); b["above_hist"] = ah
    assert f"The {rc['day'][5:]} cross above half has held at 1 close so far." in breadth.text(b)
    # two sessions later: still held (chip/voice) but the follow-up alarm is done
    ah3 = breadth.above_history(_rows(_paths([3] * 6 + [8, 7, 9])))
    assert ah3["recent_cross"]["status"] == "held" and ah3["recent_cross"]["closed_sessions"] == 3
    assert alarms.breadth_above_cross_followup_alarms(ah3, "OK") == []


def test_unwound_on_the_session_it_went_back_with_live_note():
    rows = _rows(_paths([9] * 6 + [3, 2, 7]))
    day = breadth.above_history(rows)["points"][-1]["day"]
    ah = breadth.above_history(rows, now=_at(day, 10))
    rc = ah["recent_cross"]
    assert rc["to"] == "below_half" and rc["status"] == "unwound" and rc["held_sessions"] == 2
    assert rc["unwound_day"] == day and rc["unwind_live"] is True
    a = alarms.breadth_above_cross_followup_alarms(ah, "OK")
    assert len(a) == 1 and a[0]["id"] == f"intel_breadth_above20_unwound_{rc['day']}_down" and a[0]["chime"] is False
    assert "back above 50%" in a[0]["title"] and "lasted 2 sessions" in a[0]["detail"] and "may still re-cross" in a[0]["detail"]
    b = breadth.compute(_live(rows)); b["above_hist"] = ah
    assert "unwound on" in breadth.text(b) and "still live" in breadth.text(b)
    # a session later the unwind is old news: chip only, no alarm
    ah2 = breadth.above_history(_rows(_paths([9] * 6 + [3, 2, 7, 8])))
    assert ah2["recent_cross"]["status"] == "unwound" and ah2["recent_cross"]["unwind_live"] is False
    assert alarms.breadth_above_cross_followup_alarms(ah2, "OK") == []


def test_short_runs_and_half_never_count_and_guards():
    # only 4 sessions below before going above: not a cross, so nothing to follow
    assert breadth.above_history(_rows(_paths([3] * 4 + [8, 8])))["recent_cross"] is None
    ah = breadth.above_history(_rows(_paths([3] * 8)))
    assert ah["recent_cross"] is None and alarms.breadth_above_cross_followup_alarms(ah) == []
    ah = breadth.above_history(_rows(_paths([3] * 6 + [8, 7])))
    assert alarms.breadth_above_cross_followup_alarms(ah, "STALE") == []
    assert alarms.breadth_above_cross_followup_alarms(None) == []
    assert alarms.breadth_above_cross_followup_alarms({"recent_cross": "x"}) == []
    bad = dict(ah, recent_cross=dict(ah["recent_cross"], pct=True))
    assert alarms.breadth_above_cross_followup_alarms(bad) == []
    bad = dict(ah, recent_cross=dict(ah["recent_cross"], sessions_since=-1))
    assert alarms.breadth_above_cross_followup_alarms(bad) == []


def test_wired_live_only_and_js_chip_safe():
    from aai.intel.service import Intel
    src = inspect.getsource(Intel.alerts)
    assert "breadth_above_cross_followup_alarms" in src and 'status") == "live"' in src
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    i = js.index("function renderBreadthAbove")
    body = js[i:js.index("\n}\n", i)]
    assert "h.recent_cross" in body and "UNWOUND" in body and "HELD" in body and "h.last_live" in body
    assert "innerHTML" not in body
