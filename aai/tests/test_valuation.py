"""T11d price-based multiples: watch_quotes feed (Yahoo, replayed) x SEC fundamentals -> market cap / EV / P-S / FCF yield.
Tmp DBs only; never estimates a missing input; withholds after a split since the share-count date."""
from __future__ import annotations
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from aai.intel import valuation
from aai.intel.adapters import yahoo
from aai.intel.core import FetchError
from aai.intel.feeds import registry
from aai.intel.service import Intel
from tests.intel_replay import ReplayFetcher

ROOT = Path(__file__).resolve().parents[1]
W = {"intel": {"watchlist": ["AAPL", "TSLA", "MSTR"]}}
NOW = datetime(2026, 11, 26, 18, 0, tzinfo=timezone.utc).timestamp()


@pytest.fixture(autouse=True)
def _nosleep(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)


def ts(d):
    return datetime.fromisoformat(d).replace(tzinfo=timezone.utc).timestamp()


def fr(**k):
    base = {"ticker": "ACME", "shares": 1_000_000_000.0, "shares_end": "2026-10-15", "shares_basis": "cover page",
            "revenue_ttm": 50e9, "fcf_ttm": 5e9, "debt": 20e9, "liquidity": 10e9, "flags": []}
    return {**base, **k}


def q(**k):
    return {"ticker": "ACME", "last": 100.0, "ts": NOW - 600, "currency": "USD", "splits": [], **k}


def test_multiples_arithmetic():
    m = valuation.one(fr(), q(), NOW)
    assert m["mcap"] == 100e9 and m["ev"] == 110e9 and m["ps"] == pytest.approx(2.0)
    assert m["fcf_yield"] == pytest.approx(0.05) and m["ev_fcf"] == pytest.approx(22.0) and m["withheld"] is None


def test_never_estimates_missing_inputs():
    m = valuation.one(fr(debt=None, revenue_ttm=None, fcf_ttm=None), q(), NOW)
    assert m["mcap"] == 100e9 and m["ev"] is None and m["ps"] is None and m["fcf_yield"] is None and m["ev_fcf"] is None
    assert valuation.one(fr(revenue_ttm=0.0), q(), NOW)["ps"] is None            # pre-revenue: no P/S
    assert valuation.one(fr(fcf_ttm=-2e9), q(), NOW)["fcf_yield"] == pytest.approx(-0.02)
    assert valuation.one(fr(fcf_ttm=-2e9), q(), NOW)["ev_fcf"] is None             # EV/FCF only on positive FCF


@pytest.mark.parametrize("f_kw,q_kw,why", [
    ({}, None, "no quote"),
    ({}, {"last": None}, "no price"),
    ({}, {"currency": "EUR"}, "quote in EUR"),
    ({"shares": None}, {}, "no share count"),
    ({"shares_end": "2025-12-31"}, {}, "too old"),
])
def test_withheld_reasons(f_kw, q_kw, why):
    m = valuation.one(fr(**f_kw), None if q_kw is None else q(**q_kw), NOW)
    assert m["mcap"] is None and m["ps"] is None and why in m["withheld"]


def test_split_after_share_count_is_adjusted_but_older_split_is_not():
    # T11e: was withheld in T11d; now the reported count is multiplied by the split ratio (see test_split_adjust.py)
    new = {"ts": ts("2026-11-02T13:30:00"), "ratio": 10.0, "label": "10:1"}
    old = {"ts": ts("2026-06-10T13:30:00"), "ratio": 4.0, "label": "4:1"}
    m = valuation.one(fr(), q(splits=[old, new]), NOW)
    assert m["mcap"] == 1000e9 and "SPLIT_ADJUSTED" in m["flags"] and m["withheld"] is None
    assert m["split_adj"]["splits"] == [{"date": "2026-11-02", "label": "10:1", "ratio": 10.0}]
    assert valuation.one(fr(), q(splits=[old]), NOW)["mcap"] == 100e9


def test_bank_gets_no_ev_or_fcf_yield_and_wavg_flagged():
    m = valuation.one(fr(flags=["BANK"], fcf_ttm=None), q(), NOW)
    assert m["mcap"] == 100e9 and m["ev"] is None and m["fcf_yield"] is None and m["ps"] == pytest.approx(2.0)
    assert "SHARES_WAVG" in valuation.one(fr(shares_basis="weighted avg basic (quarter)"), q(), NOW)["flags"]


def test_compute_join_counts_and_empty_when_a_feed_is_missing():
    p = {"fundamentals": {"rows": [fr(), fr(ticker="ZZZ"), fr(ticker="OLD", shares_end="2024-01-01")]},
         "watch_quotes": {"rows": [q(), q(ticker="OLD")]}}
    v = valuation.compute(p, NOW, {"fundamentals": "live", "watch_quotes": "stale"})
    assert v["n"] == 3 and v["priced"] == 1 and v["missing"] == ["ZZZ"] and v["withheld"] == ["OLD"]
    assert v["quotes_status"] == "stale" and v["quotes_ts"] == NOW - 600
    assert valuation.compute({"fundamentals": p["fundamentals"]}, NOW)["rows"] == {}
    assert valuation.compute({}, NOW)["priced"] == 0


def test_spoken_text_neutral():
    v = valuation.compute({"fundamentals": {"rows": [fr()]}, "watch_quotes": {"rows": [q()]}}, NOW)
    t = valuation.text(v)
    assert t.startswith("Priced 1 of 1") and "100.0 billion dollars market cap" in t and "2.0 times sales" in t and "5.0%" in t
    assert "buy" not in t.lower() and "sell" not in t.lower() and valuation.text(None) == ""


def test_parse_watch_rejects_bad_and_reads_splits():
    j = {"chart": {"result": [{"meta": {"regularMarketPrice": 12.5, "currency": "USD", "regularMarketTime": 1},
                               "events": {"splits": {"1": {"date": 5, "numerator": 3, "denominator": 1}, "2": {"date": 6, "numerator": 0}}}}]}}
    r = yahoo.parse_watch("X", j)
    assert r["last"] == 12.5 and r["splits"] == [{"ts": 5.0, "ratio": 3.0, "label": "3:1"}]
    with pytest.raises(FetchError):
        yahoo.parse_watch("X", {"chart": {"result": None, "error": {"code": "Not Found"}}})
    with pytest.raises(FetchError):
        yahoo.parse_watch("X", {"chart": {"result": [{"meta": {"regularMarketPrice": 0}}]}})


def test_feed_registered_and_replays_recorded_quotes():
    f = registry()["watch_quotes"]
    assert f.sector == "equities" and f.budget >= f.interval and f.url.startswith("https://")
    p = f.fn(ReplayFetcher(), W, None)
    assert [r["ticker"] for r in p["rows"]] == ["AAPL", "TSLA", "MSTR"] and not p["errors"]
    assert all(r["last"] > 0 and r["currency"] == "USD" for r in p["rows"])
    p2 = f.fn(ReplayFetcher(fail={"TSLA"}), W, None)
    assert [r["ticker"] for r in p2["rows"]] == ["AAPL", "MSTR"] and "TSLA" in p2["errors"]
    with pytest.raises(FetchError):
        f.fn(ReplayFetcher(fail={"finance.yahoo.com"}), W, None)


def test_service_valuation_on_replayed_feeds(cfg, store):
    reg = registry()
    it = Intel(W | cfg, store, fetcher=ReplayFetcher(), feeds={n: reg[n] for n in ("fundamentals", "watch_quotes")})
    a = it.all(max_age=0)
    assert a["valuation"]["priced"] == 0 and a["valuation"]["rows"] == {}
    assert "no multiples" in it.fundamentals_text() or it.fundamentals_text().startswith("Fundamentals unavailable")
    assert all(r["ok"] for r in it.refresh(force=True))
    v = it.all(max_age=0)["valuation"]
    assert v["n"] == 3 and v["fundamentals_status"] == "live" and v["quotes_status"] == "live"
    aapl = v["rows"]["AAPL"]
    assert aapl["mcap"] and aapl["mcap"] > 1e11 and aapl["ps"] > 0
    t = it.fundamentals_text()
    if v["priced"]:
        assert "Priced" in t and "no price so no multiples" not in t


def test_hud_columns_wired_textcontent_only():
    html = (ROOT / "aai/static/zoora/index.html").read_text()
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    assert '<th class="n">P/S</th><th class="n">FCF yld</th>' in html and "No price, so no multiples" not in html
    body = js[js.index("function renderFundamentals"):js.index("// Earnings cadence (T9b)")]
    assert "I.d.valuation" in body and "MULTIPLES WITHHELD" in body and "PRICED " in body
    assert "innerHTML" not in body and "insertAdjacentHTML" not in body
