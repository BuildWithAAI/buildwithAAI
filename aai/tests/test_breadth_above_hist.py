"""Sector breadth "% above 20D" over time: 3mo sectors range, per-ETF 20-bar lookback, never interpolated,
voice sentence, /api/stocks carries it, JS row is SVG/textContent only. Replayed fixtures / tmp DB only."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from aai.adapters.registry import build
from aai.hud import create_app
from aai.intel import breadth
from aai.intel.adapters import yahoo
from aai.intel.feeds import registry
from tests.intel_replay import ReplayFetcher
from tests.test_sector_breadth import _seed

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo("America/New_York")
SYMS = [s[1] for s in yahoo.SECTORS]


def _days(n):
    d, out = date(2026, 8, 3), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(datetime(d.year, d.month, d.day, 9, 30, tzinfo=NY).timestamp())
        d += timedelta(days=1)
    return out


def _rows(paths):
    ts = _days(max(len(v) for v in paths.values()))
    return [{"symbol": s, "name": s, "spark": [[t, c] for t, c in zip(ts, cl)]} for s, cl in paths.items()]


def test_sectors_fetch_uses_3mo_and_keeps_64_bars_markets_unchanged():
    f = ReplayFetcher()
    p = yahoo.fetch_sectors(f, {})
    assert {c[1]["range"] for c in f.calls} == {"3mo"} and len(f.calls) == 11
    assert all(len(r["spark"]) > 40 for r in p["rows"])
    m = ReplayFetcher()
    yahoo.fetch(m, {}, symbols=yahoo.SYMBOLS[:2])
    assert {c[1]["range"] for c in m.calls} == {"2mo"}


def test_above_history_matches_todays_count_on_fixtures():
    rows = registry()["sectors"].fn(ReplayFetcher(), {}, None)["rows"]
    b = breadth.compute(rows)
    ah = breadth.above_history(rows)
    assert ah["sessions"] == 20 and ah["lookback"] == 20
    last = ah["points"][-1]
    assert last["n"] == b["n_with_20d"] == 11 and last["above"] == b["above_20d"]  # same 20-bar rule as chg_20d
    assert all(0 <= p["pct"] <= 1 for p in ah["points"])
    days = [p["day"] for p in ah["points"]]
    assert days == sorted(days) and len(set(days)) == 20


def test_above_history_counts_change_and_side():
    # 30 bars: first 6 sectors rise every bar, last 5 fall -> 6/11 above; then on the final 3 bars 3 more turn up hard
    paths = {}
    for i, s in enumerate(SYMS):
        cl, c = [], 100.0
        for k in range(30):
            c *= 1.01 if i < 6 else 0.99
            if i in (6, 7, 8) and k >= 27:
                c *= 1.5
            cl.append(c)
        paths[s] = cl
    ah = breadth.above_history(_rows(paths), sessions=20)
    assert ah["sessions"] == 10  # 30 bars - 20 lookback
    assert [p["above"] for p in ah["points"]][:7] == [6] * 7 and ah["points"][-1]["above"] == 9
    assert ah["change_5s"] == round(9 / 11 - 6 / 11, 4)
    assert ah["side"] == "above_half" and ah["side_since"]["whole_window"] is True and ah["side_since"]["sessions"] == 10


def test_above_history_needs_6_sectors_and_never_interpolates():
    paths = {s: [100.0 + k for k in range(25)] for s in SYMS[:5]}
    assert breadth.above_history(_rows(paths))["sessions"] == 0
    rows = _rows({s: [100.0 + k for k in range(25)] for s in SYMS})
    gap = rows[0]["spark"][22][0]
    for r in rows[:6]:  # 6 ETFs miss one day: that session has 5 sectors -> skipped, not filled in
        r["spark"] = [p for p in r["spark"] if p[0] != gap]
    ah = breadth.above_history(rows)
    assert breadth._session_day(gap) not in [p["day"] for p in ah["points"]]
    assert breadth.above_history([{"symbol": "X", "spark": [["bad", None], [1, "x"]]}])["points"] == []
    assert breadth.above_history(None)["sessions"] == 0


def test_voice_sentence_and_api_carry_above_hist(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    rows = registry()["sectors"].fn(ReplayFetcher(), {}, None)["rows"]
    b = breadth.compute(rows)
    b["above_hist"] = breadth.above_history(rows)
    t = breadth.text(b)
    assert "share above their 20-session level is" in t and "five sessions ago" in t and t.endswith("not a signal.")
    b["above_hist"] = {"sessions": 3, "points": [], "change_5s": None}
    assert "20-session level" not in breadth.text(b)  # too short: silent, not guessed
    app = create_app(cfg, store, build(cfg, store), heavy=False)
    c = app.test_client()
    _seed(store, rows)
    ah = c.get("/api/stocks").json["sectors"]["breadth"]["above_hist"]
    assert ah["sessions"] == 20 and ah["points"][-1]["n"] == 11
    r = c.post("/api/zoora", json={"text": "sector breadth"}).json
    assert r["intent"] == "sectors" and "20-session level" in r["reply"]


def test_js_above_row_svg_textcontent_only():
    js = (ROOT / "aai" / "static" / "zoora" / "zoora.js").read_text()
    i = js.index("function renderBreadthAbove(")
    seg = js[i:js.index("const TABS = [", i)]
    assert "innerHTML" not in seg and "textContent" in seg and ">20D" in seg
    assert "renderBreadthAbove(b.above_hist, read)" in js  # + shared keyboard readout
    css = (ROOT / "aai" / "static" / "zoora" / "zoora.css").read_text()
    assert ".sb-ab-line" in css
