"""T11 fundamentals: SEC XBRL company facts -> per-ticker burn / runway / dilution snapshot (aai/intel/adapters/xbrl.py),
'fundamentals' intel feed, voice intent and HUD panel 18. Pure functions + recorded fixtures + tmp DB only."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from aai.intel.adapters import xbrl
from aai.intel.cache import IntelCache
from aai.intel.feeds import registry
from aai.intel.service import Intel
from aai.zoora import classify
from tests.intel_replay import ReplayFetcher

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 11, 25, tzinfo=timezone.utc).timestamp()
W = {"intel": {"watchlist": ["AAPL", "TSLA", "MSTR"]}}


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    import time
    monkeypatch.setattr(time, "sleep", lambda s: None)


def _f(start, end, val, form="10-Q", filed=None):
    x = {"end": end, "val": val, "form": form, "filed": filed or end, "accn": "a-" + end}
    if start:
        x["start"] = start
    return x


def _facts(**concepts):
    g = {k: {"units": {"USD": v}} for k, v in concepts.items() if k != "dei"}
    out = {"us-gaap": g}
    if "dei" in concepts:
        out["dei"] = {xbrl.SHARES: {"units": {"shares": concepts["dei"]}}}
    return out


def _norm(xs):
    return xbrl._rows(_facts(X=xs), ("X",))[1]


def test_ttm_prefers_fiscal_year_then_ytd_bridge_then_quarter_chain():
    from datetime import date
    fy = [_f("2025-01-01", "2025-12-31", 400, "10-K")]
    assert xbrl.ttm(_norm(fy), date(2025, 12, 31)) == 400
    # FY2025 400 + 9M 2026 330 - 9M 2025 300 = 430
    rows = fy + [_f("2026-01-01", "2026-09-30", 330), _f("2025-01-01", "2025-09-30", 300)]
    assert xbrl.ttm(_norm(rows), date(2026, 9, 30)) == 430
    q = [_f("2025-10-01", "2025-12-31", 1), _f("2026-01-01", "2026-03-31", 2), _f("2026-04-01", "2026-06-30", 3),
         _f("2026-07-01", "2026-09-30", 4)]
    assert xbrl.ttm(_norm(q), date(2026, 9, 30)) == 10
    assert xbrl.ttm(_norm(q[1:]), date(2026, 9, 30)) is None          # three quarters is not a TTM: never guessed
    # a restated period keeps the latest filing; 8-K / S-1 facts are ignored
    re = [_f("2025-01-01", "2025-12-31", 400, "10-K", "2026-02-01"), _f("2025-01-01", "2025-12-31", 390, "10-K/A", "2026-04-01"),
          _f("2025-01-01", "2025-12-31", 999, "S-1", "2026-05-01")]
    assert xbrl.ttm(_norm(re), date(2025, 12, 31)) == 390


def test_snapshot_burner_runway_dilution_and_flags():
    facts = _facts(
        RevenueFromContractWithCustomerExcludingAssessedTax=[_f("2024-01-01", "2024-12-31", 7e6, "10-K"),
                                                              _f("2024-01-01", "2024-09-30", 5e6),
                                                              _f("2025-01-01", "2025-12-31", 8e6, "10-K"),
                                                              _f("2026-01-01", "2026-09-30", 3e6), _f("2025-01-01", "2025-09-30", 6e6)],
        NetCashProvidedByUsedInOperatingActivities=[_f("2025-01-01", "2025-12-31", -100e6, "10-K"),
                                                    _f("2026-01-01", "2026-09-30", -90e6), _f("2025-01-01", "2025-09-30", -70e6)],
        PaymentsToAcquirePropertyPlantAndEquipment=[_f("2025-01-01", "2025-12-31", 20e6, "10-K"),
                                                    _f("2026-01-01", "2026-09-30", 15e6), _f("2025-01-01", "2025-09-30", 15e6)],
        CashAndCashEquivalentsAtCarryingValue=[_f(None, "2026-09-30", 100e6), _f(None, "2025-12-31", 150e6, "10-K")],
        MarketableSecuritiesCurrent=[_f(None, "2026-09-30", 20e6)],
        dei=[{"end": "2026-11-05", "val": 150e6, "accn": "n", "form": "10-Q"},
             {"end": "2025-11-04", "val": 100e6, "accn": "o", "form": "10-Q"}])
    s = xbrl.snapshot(facts, now_ts=NOW)
    assert s["period_end"] == "2026-09-30" and s["form"] == "10-Q"
    assert s["revenue_ttm"] == 5e6 and s["revenue_yoy"] == pytest.approx(5 / 8 - 1)   # prior TTM = 7 + 6 - 5 = 8
    assert s["ocf_ttm"] == -120e6 and s["capex_ttm"] == 20e6 and s["fcf_ttm"] == -140e6 and s["fcf_basis"] == "OCF - capex"
    assert s["liquidity"] == 120e6 and s["runway_months"] == pytest.approx(10.3, abs=0.05)
    assert s["shares_yoy"] == pytest.approx(0.5) and s["shares_basis"] == "cover page"
    assert set(s["flags"]) == {"BURN", "RUNWAY_LT_12M", "DILUTION_GT_10PCT"}


def test_snapshot_never_reports_an_old_revenue_tag_as_ttm_and_flags_stale_periods():
    facts = _facts(Revenues=[_f("2023-01-01", "2023-12-31", 9e6, "10-K")],
                   NetCashProvidedByUsedInOperatingActivities=[_f("2025-01-01", "2025-12-31", 5e6, "10-K")],
                   CashAndCashEquivalentsAtCarryingValue=[_f(None, "2025-12-31", 1e6, "10-K")])
    s = xbrl.snapshot(facts, now_ts=NOW)
    assert s["revenue_ttm"] is None and s["revenue_yoy"] is None
    assert s["fcf_ttm"] == 5e6 and s["fcf_basis"].startswith("OCF only") and s["runway_months"] is None
    assert "STALE PERIOD" in s["flags"] and "BURN" not in s["flags"]
    assert xbrl.snapshot({}, now_ts=NOW)["flags"] == ["NO US-GAAP DATA"]


def test_share_count_falls_back_to_weighted_average_quarter():
    q = lambda s, e, v: {"start": s, "end": e, "val": v, "form": "10-Q", "filed": e}
    facts = {"us-gaap": {xbrl.SHARES_FALLBACK: {"units": {"shares": [q("2025-07-01", "2025-09-30", 200.0), q("2026-01-01", "2026-09-30", 260.0),
                                                                    q("2026-07-01", "2026-09-30", 280.0)]}}}}
    s = xbrl.shares(facts)
    assert s["shares"] == 280.0 and s["shares_yoy"] == pytest.approx(0.4) and s["shares_basis"].startswith("weighted avg")


def test_feed_registered_and_replays_recorded_companyfacts():
    f = registry()["fundamentals"]
    assert f.interval == 6 * 3600 and f.budget == 3 * 86400 and f.sector == "equities" and f.url.startswith("https://www.sec.gov/")
    rf = ReplayFetcher()
    p = f.fn(rf, {**W, "intel": {**W["intel"], "sec_contact": "ops@example.com"}}, None)
    assert [r["ticker"] for r in p["rows"]] == ["AAPL", "TSLA", "MSTR"] and not p["errors"]
    assert all("ops@example.com" in (h or {}).get("User-Agent", "") for _, _, h in rf.calls)
    a = {r["ticker"]: r for r in p["rows"]}
    assert a["AAPL"]["form"] == "10-K" and a["AAPL"]["revenue_ttm"] > 1e11 and a["AAPL"]["fcf_ttm"] > 0 and a["AAPL"]["runway_months"] is None
    assert a["MSTR"]["shares_basis"].startswith("weighted avg") and a["MSTR"]["shares_yoy"] is not None
    for r in p["rows"]:
        assert r["url"].startswith("https://www.sec.gov/") and r["period_end"] and r["cash"] is not None
    # second run reuses the CIK map: no company_tickers request
    rf2 = ReplayFetcher()
    f.fn(rf2, W, p)
    assert not any("company_tickers" in u for u, _, _ in rf2.calls)


def test_feed_degrades_per_ticker_and_fails_honestly():
    f = registry()["fundamentals"]
    p = f.fn(ReplayFetcher(fail={"CIK0001318605"}), W, None)   # TSLA facts down
    assert [r["ticker"] for r in p["rows"]] == ["AAPL", "MSTR"] and "TSLA" in p["errors"]
    from aai.intel.core import FetchError
    with pytest.raises(FetchError):
        f.fn(ReplayFetcher(fail={"companyfacts"}), W, None)


def test_spoken_text_orders_burners_first_and_caps_long_runway():
    p = registry()["fundamentals"].fn(ReplayFetcher(), W, None)
    t = xbrl.text(p)
    assert t.startswith("Fundamentals from SEC filings for 3 watchlist names") and "no multiples" in t
    assert t.index("MSTR") < t.index("AAPL") and "over ten years of runway" in t
    assert "buy" not in t.lower() and "sell" not in t.lower()
    assert xbrl.text(None) == "" and xbrl.text({"rows": []}) == ""


@pytest.mark.parametrize("q", ["what's the cash runway", "show me fundamentals", "any dilution on the watchlist",
                               "free cash flow", "how's the balance sheet"])
def test_intent_routes_to_fundamentals(q):
    assert classify(q)[0] == "fundamentals"


def test_insider_filings_still_route_to_filings():
    assert classify("any insider buys")[0] == "filings" and classify("sec filings")[0] == "filings"


def test_service_text_honest_when_missing_then_live(cfg, store):
    it = Intel(W | cfg, store, fetcher=ReplayFetcher(), feeds={"fundamentals": registry()["fundamentals"]})
    assert it.fundamentals_text().startswith("Fundamentals unavailable")
    assert it.refresh(force=True)[0]["ok"] is True
    assert "AAPL" in it.fundamentals_text()
    v = it.view("fundamentals")
    assert v["status"] == "live" and v["payload"]["rows"]
    rows = IntelCache(store).latest_ok("fundamentals")["payload"]["rows"]
    # flags survive the cache's guard.clean_deep sanitiser unchanged (no < > % characters that it strips)
    assert {r["ticker"]: r["flags"] for r in rows}["TSLA"] == ["DILUTION_GT_10PCT"]


def test_hud_panel_wired_textcontent_only():
    html = (ROOT / "aai/static/zoora/index.html").read_text()
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    css = (ROOT / "aai/static/zoora/zoora.css").read_text()
    assert 'id="p-fund"' in html and 'data-feeds="fundamentals,watch_quotes"' in html and 'id="funTable"' in html
    assert "fundamentals: '#p-fund'" in js and "renderFundamentals, renderFxDesk" in js
    body = js[js.index("function renderFundamentals"):js.index("// Earnings cadence (T9b)")]
    assert "innerHTML" not in body and "startsWith('https://www.sec.gov/')" in body
    assert '"fun fun fun"' in css and ".ip-fun{grid-area:fun}" in css


def test_capex_heavy_profitable_company_gets_no_runway_and_banks_skip_fcf():
    base = dict(NetCashProvidedByUsedInOperatingActivities=[_f("2025-01-01", "2025-12-31", 100e6, "10-K")],
                PaymentsToAcquirePropertyPlantAndEquipment=[_f("2025-01-01", "2025-12-31", 150e6, "10-K")],
                CashAndCashEquivalentsAtCarryingValue=[_f(None, "2025-12-31", 80e6, "10-K")])
    s = xbrl.snapshot(_facts(**base), now_ts=NOW)
    assert s["fcf_ttm"] == -50e6 and s["runway_months"] is None and {"BURN", "CAPEX_GT_OCF"} <= set(s["flags"])
    bank = _facts(**base, Deposits=[_f(None, "2025-12-31", 9e9, "10-K")], InterestExpenseDeposits=[_f("2025-01-01", "2025-12-31", 1e8, "10-K")])
    b = xbrl.snapshot(bank, now_ts=NOW)
    assert b["fcf_ttm"] is None and b["runway_months"] is None and "BANK" in b["flags"] and "BURN" not in b["flags"]
    assert b["fcf_basis"].startswith("n/a for a bank") and b["ocf_ttm"] == 100e6
