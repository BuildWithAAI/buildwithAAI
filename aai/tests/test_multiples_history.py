"""T11f multiples history: one P/S point per ticker per NY session from the valuation join, settling on the close;
earlier sessions never rewritten; 90-day series with own-range position; voice quiet until 5 sessions. Tmp DBs only."""
from __future__ import annotations
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from aai.intel import multiples_history as mh
from aai.intel.feeds import registry
from aai.intel.service import Intel
from tests.intel_replay import ReplayFetcher

ROOT = Path(__file__).resolve().parents[1]


def ts(d):
    return datetime.fromisoformat(d).replace(tzinfo=timezone.utc).timestamp()


def val(qts, **ps):
    return {"rows": {t: {"ticker": t, "price": 10.0, "price_ts": qts, "mcap": p * 1e9, "ev": None, "ps": p, "fcf_yield": 0.02,
                         "split_adj": None} for t, p in ps.items()}}


def test_one_point_per_session_settles_on_the_close_and_never_rewrites_old_sessions(store):
    d1_open, d1_close = ts("2026-11-23T15:00:00"), ts("2026-11-23T21:00:00")      # NY 10:00 and 16:00
    assert mh.record(store, val(d1_open, AAA=10.0), now=d1_open + 60) == 1
    assert mh.record(store, val(d1_close, AAA=11.0), now=d1_close + 60) == 1     # later quote, same session: moves
    assert mh.record(store, val(d1_open, AAA=99.0), now=d1_close + 120) == 0     # older quote: ignored
    d2 = ts("2026-11-24T21:00:00")
    mh.record(store, val(d2, AAA=12.0, BBB=3.0), now=d2 + 60)
    s = mh.series(store, now=d2 + 60)
    assert s["sessions"] == 2 and s["tickers"]["AAA"]["points"] == [["2026-11-23", 11.0, 11e9, 0.02], ["2026-11-24", 12.0, 12e9, 0.02]]
    assert s["tickers"]["BBB"]["n"] == 1 and s["tickers"]["AAA"]["ps_pos"] is None                 # < 5 sessions: no range
    assert store.one("SELECT COUNT(*) c FROM multiples_daily")["c"] == 3


def test_withheld_future_and_bad_rows_store_nothing(store):
    now = ts("2026-11-24T21:00:00")
    v = val(now, AAA=5.0)
    v["rows"]["WHY"] = {"ticker": "WHY", "mcap": None, "price_ts": now, "withheld": "no share count"}
    v["rows"]["FUT"] = {"ticker": "FUT", "mcap": 1e9, "ps": 1.0, "price_ts": now + 86400}
    v["rows"]["BAD"] = "nope"
    assert mh.record(store, v, now=now) == 1 and mh.record(store, None) == 0 and mh.record(store, {"rows": None}) == 0
    assert list(mh.series(store, now=now)["tickers"]) == ["AAA"]


def test_range_position_window_and_spoken_line(store):
    base = ts("2026-08-03T21:00:00")
    for i, (a, b) in enumerate([(10, 5), (12, 5.5), (14, 6), (13, 7), (11, 8), (10.5, 9)]):
        mh.record(store, val(base + i * 86400, AAA=a, BBB=b), now=base + i * 86400)
    old = ts("2026-05-01T21:00:00")
    mh.record(store, val(old, AAA=1.0), now=old)                                      # >90 days before: out of window
    now = base + 6 * 86400
    s = mh.series(store, now=now)
    a, b = s["tickers"]["AAA"], s["tickers"]["BBB"]
    assert a["n"] == 6 and a["ps_lo"] == 10 and a["ps_hi"] == 14 and a["ps_pos"] == pytest.approx(0.5 / 4)
    assert b["ps_pos"] == 1.0
    t = mh.text(s)
    assert t.startswith("Cheapest versus its own 6-session range: AAA at 10.5 times sales (range 10.0 to 14.0).")
    assert "Richest versus its range: BBB at 9.0" in t and "buy" not in t.lower() and "sell" not in t.lower()
    assert mh.text({"tickers": {"AAA": {"ps_pos": None}}, "sessions": 2}) == "Multiples history: 2 sessions logged; a range needs 5."
    assert mh.text(None) == "" and mh.series(store, now=now, days=10**6)["days"] == 365


def test_period_change_is_flagged(store):
    base = ts("2026-11-02T21:00:00")
    for i in range(5):
        mh.record(store, val(base + i * 86400, AAA=10 + i), {"rows": [{"ticker": "AAA", "period_end": "2026-06-30" if i < 3 else "2026-09-30"}]},
                  now=base + i * 86400)
    d = mh.series(store, now=base + 5 * 86400)["tickers"]["AAA"]
    assert d["period_changed"] is True and "sales figure changed" in mh.text(mh.series(store, now=base + 5 * 86400))


def test_service_records_on_new_quotes_and_serves_history(cfg, store, monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)
    reg = registry()
    W = {"intel": {"watchlist": ["AAPL", "TSLA", "MSTR"]}}
    it = Intel(W | cfg, store, fetcher=ReplayFetcher(), feeds={n: reg[n] for n in ("fundamentals", "watch_quotes")})
    assert it.all(max_age=0)["valuation"]["history"]["tickers"] == {}
    assert all(r["ok"] for r in it.refresh(force=True))
    v = it.all(max_age=0)["valuation"]
    h = v["history"]
    assert v["priced"] >= 1 and h["sessions"] == 1 and set(h["tickers"]) == {t for t, m in v["rows"].items() if m["mcap"]}
    n = store.one("SELECT COUNT(*) c FROM multiples_daily")["c"]
    it.all(max_age=0)                                                                 # same quotes: no new write
    assert store.one("SELECT COUNT(*) c FROM multiples_daily")["c"] == n
    assert "range needs 5" in it.fundamentals_text()


def test_hud_wiring_textcontent_only():
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    body = js[js.index("function renderFundamentals"):js.index("// Earnings cadence (T9b)")]
    assert "va.history" in body and "P/S HISTORY " in body and "CHEAPEST VS " in body and "psHist(hd, hpts" in body
    assert "spark(ys" in js[js.index("function psHist"):js.index("function spark(")]  # T11g: the sparkline moved into psHist
    assert "innerHTML" not in body and "insertAdjacentHTML" not in body
