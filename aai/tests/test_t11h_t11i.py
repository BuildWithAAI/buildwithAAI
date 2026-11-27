"""T11i spoken Shares 1Y line is split-adjusted (NVDA 10:1 real replay; never '+893%'), and T11h P/S sparkline new-filing
marks (multiples_history.period_marks + psMarks tick in panel 18, textContent only). Pure or tmp DBs only."""
from __future__ import annotations
from pathlib import Path

import pytest

from aai.intel import multiples_history as mh
from aai.intel.adapters import xbrl, yahoo
from tests.test_multiples_history import ts as mts, val
from tests.test_split_adjust import FX, facts_as_of

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def nvq():
    return yahoo.parse_watch("NVDA", FX["chart"])


def nv_row(**kw):
    sh = xbrl.shares(facts_as_of("2024-08-28"))
    return {"ticker": "NVDA", "period_end": "2024-07-28", "form": "10-Q", "revenue_ttm": 96.3e9, "fcf_ttm": 50e9,
            "flags": [], **sh, **kw}


def test_spoken_shares_line_is_split_adjusted_with_quotes(nvq):
    p = {"rows": [nv_row()]}
    raw = xbrl.text(p)
    assert "share count +893% in a year" in raw                       # no split data: the reported change, as before
    adj = xbrl.text(p, quotes={"rows": [nvq]})
    assert "+893%" not in adj and "share count" not in adj           # -0.7% after the 10:1 is taken out: below the 2% floor


def test_spoken_shares_line_adjusted_big_change_and_unknown(nvq):
    r = nv_row()
    big = {**r, "shares": r["shares"] * 1.2, "shares_yoy": r["shares"] * 1.2 / r["shares_prior"] - 1}
    t = xbrl.text({"rows": [big]}, quotes={"rows": [nvq]})
    assert "share count +19% in a year, split-adjusted" in t
    old = {k: v for k, v in r.items() if k not in ("shares_prior", "shares_prior_end")}
    t2 = xbrl.text({"rows": [old]}, quotes={"rows": [nvq]})
    assert "share count change not comparable across a split" in t2 and "+893%" not in t2
    # malformed quotes payloads never break the answer
    assert "NVDA" in xbrl.text({"rows": [r]}, quotes={"rows": "junk"}) and "NVDA" in xbrl.text({"rows": [r]}, quotes=[1])


def test_service_fundamentals_voice_passes_quotes(monkeypatch, nvq):
    from aai.intel.service import Intel
    src = (ROOT / "aai/intel/service.py").read_text()
    body = src[src.index("def fundamentals_text"):src.index("def brief_text")]
    assert 'xbrl.text(p, quotes=self._p("watch_quotes"))' in body


def test_period_marks_on_first_session_of_new_filing(store):
    base = mts("2026-11-02T21:00:00")
    pes = ["2026-06-30", "2026-06-30", "2026-09-30", "2026-09-30", None, "2026-09-30"]
    for i, pe in enumerate(pes):
        mh.record(store, val(base + i * 86400, AAA=10 + i, BBB=5.0), {"rows": [{"ticker": "AAA", "period_end": pe}, {"ticker": "BBB", "period_end": "2026-09-30"}]},
                  now=base + i * 86400)
    s = mh.series(store, now=base + 7 * 86400)
    a, b = s["tickers"]["AAA"], s["tickers"]["BBB"]
    assert a["period_marks"] == [{"session": "2026-11-04", "period_end": "2026-09-30", "prev_period_end": "2026-06-30"}]
    assert b["period_marks"] == [] and b["period_changed"] is False and "_pe" not in a
    t = mh.text(s)
    assert "AAA's sales figure changed with a new filing inside that window, from the 2026-11-04 session." in t


def test_hud_draws_period_tick_textcontent_only():
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    assert "function psMarks(hd, hpts)" in js and "'spk-period'" in js
    body = js[js.index("function renderFundamentals"):js.index("// Earnings cadence (T9b)")]
    assert "psMarks(hd, hpts)" in body and "innerHTML" not in body
    helper = js[js.index("function psMarks"):js.index("function spark(")]
    assert "at.get(k.session) > 0" in helper and "innerHTML" not in helper
    assert ".spk-period{" in (ROOT / "aai/static/zoora/zoora.css").read_text()
