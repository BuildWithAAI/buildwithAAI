"""T9b earnings cadence: next earnings estimated from each watchlist ticker's 8-K item 2.02 history (already in the
EDGAR submissions JSON; no extra request). Estimates only, irregular cadences are not guessed. Replay / pure only."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from aai.intel.adapters import edgar
from aai.intel.feeds import registry
from tests.intel_replay import ReplayFetcher

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 11, 25, tzinfo=timezone.utc).timestamp()


def _sub(rows):
    return {"filings": {"recent": {"form": [r[0] for r in rows], "filingDate": [r[1] for r in rows], "items": [r[2] for r in rows]}}}


def test_quarterly_cadence_estimate():
    s = _sub([("8-K", "2026-10-30", "2.02,9.01"), ("4", "2026-10-29", ""), ("8-K", "2026-08-01", "2.02,9.01"),
              ("8-K", "2026-07-31", "2.02"), ("8-K", "2026-05-01", "2.02"), ("8-K", "2026-03-10", "5.02"),
              ("8-K", "2026-01-30", "2.02,7.01"), ("8-K", "2024-10-30", "2.02")])  # 2024 is outside 400 days
    e = edgar.earnings_history(s, now_ts=NOW)
    # 07-31 + 08-01 is one release (cluster keeps its first day); 2024 is outside 400 days
    assert e["reports"] == ["2026-10-30", "2026-07-31", "2026-05-01", "2026-01-30"]
    assert e["n"] == 4 and e["cadence"] == "quarterly" and e["median_gap_days"] == 91
    assert e["est_next"] == "2027-01-29" and e["est_in_days"] == 65 and e["overdue"] is False
    assert "not a confirmed date" in e["note"]


def test_irregular_insufficient_and_overdue():
    irr = edgar.earnings_history(_sub([("8-K", d, "2.02") for d in ("2026-10-21", "2026-10-02", "2026-07-22", "2026-07-02")]), now_ts=NOW)
    assert irr["cadence"] == "irregular" and irr["est_next"] is None
    one = edgar.earnings_history(_sub([("8-K", "2026-10-29", "2.02")]), now_ts=NOW)
    assert one["cadence"] == "insufficient" and one["est_next"] is None and one["n"] == 1
    late = edgar.earnings_history(_sub([("8-K", "2026-07-01", "2.02"), ("8-K", "2026-04-01", "2.02")]), now_ts=NOW)
    assert late["est_next"] == "2026-09-30" and late["est_in_days"] < -14 and late["overdue"] is True
    assert edgar.earnings_history({}, now_ts=NOW)["n"] == 0
    bad = _sub([("8-K", "not-a-date", "2.02"), ("8-K", None, "2.02")])
    assert edgar.earnings_history(bad, now_ts=NOW)["n"] == 0


def test_filings_feed_carries_earnings_on_fixtures(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda s: None)
    monkeypatch.setattr(edgar, "_clock", lambda: NOW)
    p = registry()["filings"].fn(ReplayFetcher(), {"intel": {"watchlist": ["AAPL", "TSLA", "MSTR"]}}, None)
    assert set(p["earnings"]) == {"AAPL", "TSLA", "MSTR"}
    assert p["earnings"]["AAPL"]["cadence"] == "quarterly" and p["earnings"]["AAPL"]["company"]
    assert p["earnings"]["TSLA"]["cadence"] == "irregular"  # delivery reports also carry 2.02: not guessed
    assert [e["ticker"] for e in p["earnings_next"]] == ["AAPL"] and "estimate" in p["earnings_note"]


def test_filings_voice_names_estimates(monkeypatch, store, cfg):
    from aai.intel.service import Intel
    from aai.intel.cache import IntelCache
    monkeypatch.setattr("time.sleep", lambda s: None)
    monkeypatch.setattr(edgar, "_clock", lambda: NOW)
    p = registry()["filings"].fn(ReplayFetcher(), {"intel": {"watchlist": ["AAPL", "TSLA", "MSTR"]}}, None)
    IntelCache(store).record("filings", "SEC EDGAR", True, payload=p, latency_ms=5)
    t = Intel(cfg, store).filings_text()
    assert "Next earnings by 8-K cadence, estimates only: AAPL around" in t


def test_js_earnings_row_textcontent_only():
    js = (ROOT / "aai" / "static" / "zoora" / "zoora.js").read_text()
    i = js.index("function renderEarningsCadence(")
    seg = js[i:js.index("function renderIntel(", i)]
    assert "innerHTML" not in seg and "EARNINGS EST." in seg and "not a confirmed date" in seg
    assert "renderEarningsCadence(p)" in js
