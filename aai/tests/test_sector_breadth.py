"""Stocks desk sector breadth: 11 SPDR ETFs via the intel `sectors` feed (replayed fixtures / tmp DB only)."""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from aai.adapters.registry import build
from aai.adapters.stocks import StocksAdapter
from aai.hud import create_app
from aai.intel import breadth
from aai.intel.adapters import yahoo
from aai.intel.cache import IntelCache
from aai.intel.feeds import registry
from aai.zoora import classify
from tests.intel_replay import ReplayFetcher

JS = Path(__file__).resolve().parents[1] / "aai" / "static" / "zoora" / "zoora.js"


def _row(sym, chg, c20=0.01, last=50.0):
    return {"symbol": sym, "name": sym + " sector", "class": "sector", "last": last, "chg": chg, "chg_20d": c20, "ts": time.time()}


def test_sectors_feed_registered_and_replays():
    f = registry()["sectors"]
    assert f.interval == 300 and f.budget == 1800 and f.sector == "equities" and f.url.startswith("https://")
    p = f.fn(ReplayFetcher(), {}, None)
    syms = [r["symbol"] for r in p["rows"]]
    assert syms == [s[1] for s in yahoo.SECTORS] and len(syms) == 11 and p["errors"] == {}
    assert all(isinstance(r["last"], float) and r["class"] == "sector" for r in p["rows"])
    # markets feed did not grow: sector ETFs live in their own feed
    assert not {s[1] for s in yahoo.SECTORS} & {s[1] for s in yahoo.SYMBOLS}


def test_sectors_feed_partial_and_total_failure():
    p = registry()["sectors"].fn(ReplayFetcher(fail={"/XLE", "/XLU"}), {}, None)
    assert len(p["rows"]) == 9 and set(p["errors"]) == {"XLE", "XLU"}
    from aai.intel.core import FetchError
    with pytest.raises(FetchError):
        registry()["sectors"].fn(ReplayFetcher(fail={"finance.yahoo.com"}), {}, None)


def test_breadth_counts_labels_and_relative():
    rows = [_row("A", 0.02, 0.05), _row("B", 0.01, -0.01), _row("C", 0.003), _row("D", 0.0002), _row("E", -0.004, -0.02),
            _row("F", -0.03, -0.1), _row("G", 0.006)]
    b = breadth.compute(rows, {"chg": 0.004, "chg_20d": 0.01})
    assert (b["up"], b["down"], b["flat"], b["n_with_chg"]) == (4, 2, 1, 7)
    assert b["above_20d"] == 4 and b["n_with_20d"] == 7
    assert b["leaders"] == ["A", "B", "G"] and b["laggards"] == ["F", "E", "D"]
    assert b["label"] == "MIXED, LEANING UP" and "not a signal" in b["disclaimer"]
    assert b["spread"] == pytest.approx(0.05) and b["ew_vs_spy"] == pytest.approx(b["ew_chg"] - 0.004, abs=1e-5)
    a = next(c for c in b["cells"] if c["symbol"] == "A")
    assert a["rel_spy"] == pytest.approx(0.016) and a["rel_spy_20d"] == pytest.approx(0.04)
    assert breadth.compute([_row(s, 0.01) for s in "ABCDEFGHIJK"])["label"] == "BROAD ADVANCE"
    assert breadth.compute([_row(s, -0.01) for s in "ABCDEFGHIJK"])["label"] == "BROAD DECLINE"


def test_breadth_never_invents():
    assert breadth.compute([])["label"] == "INSUFFICIENT DATA"
    b = breadth.compute([_row("A", None), _row("B", 0.01), {"bad": 1}, None, _row("C", float("nan"))])
    assert b["n"] == 3 and b["n_with_chg"] == 1 and b["down"] == 0 and b["label"] == "INSUFFICIENT DATA"
    assert b["ew_vs_spy"] is None and b["cells"][0]["rel_spy"] is None
    assert "won't guess" in breadth.text({})


def test_breadth_text_spoken():
    rows = [_row(s, 0.01 * (i - 3)) for i, s in enumerate("ABCDEFGHIJK")]
    t = breadth.text(breadth.compute(rows, {"chg": 0.002}), "STALE", "2h")
    assert "7 of 11 sectors up" in t and "versus SPY +0.20%" in t and "stale (2h old)" in t and t.endswith("not a signal.")


def _seed(store, rows, age=10.0, errors=None):
    IntelCache(store).record("sectors", "Yahoo Finance", True, payload={"rows": rows, "errors": errors or {}},
                             latency_ms=9, ts=time.time() - age)


def test_adapter_sectors_states(cfg, store):
    ad = StocksAdapter(cfg, store)
    s = ad.sectors()
    assert s["state"] == "MISSING" and s["breadth"] is None
    assert ad.quotes()["sectors"]["state"] == "MISSING"           # nested even with no markets snapshot
    _seed(store, [_row(x, -0.01) for x in "ABCDEFGH"], age=31 * 60)    # last good snapshot is old: shown STALE
    s = ad.sectors()
    assert s["state"] == "STALE" and s["breadth"]["down"] == 8 and "budget 1800s" in s["detail"]
    IntelCache(store).record("sectors", "Yahoo Finance", False, error="HTTP 503", ts=time.time())   # a failure keeps it stale
    assert ad.sectors()["state"] == "STALE"
    _seed(store, [_row(x, 0.01) for x in "ABCDEFGH"], errors={"XLRE": "HTTP 503"})
    s = ad.sectors(spy={"chg": 0.005})
    assert s["state"] == "OK" and s["breadth"]["up"] == 8 and s["missing"] == ["XLRE"] and "missing XLRE" in s["detail"]
    assert s["breadth"]["ew_vs_spy"] == pytest.approx(0.005)


def test_api_stocks_and_voice_intent(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    app = create_app(cfg, store, build(cfg, store), heavy=False)
    c = app.test_client()
    r = c.post("/api/zoora", json={"text": "sector breadth"}).json
    assert r["intent"] == "sectors" and "isn't available" in r["reply"]
    rows = registry()["sectors"].fn(ReplayFetcher(), {}, None)["rows"]
    _seed(store, rows)
    d = c.get("/api/stocks").json
    sec = d["sectors"]
    assert sec["state"] == "OK" and len(sec["breadth"]["cells"]) == 11 and sec["breadth"]["n_with_chg"] == 11
    r = c.post("/api/zoora", json={"text": "how are the sectors doing"}).json
    assert r["intent"] == "sectors" and "of 11 sectors up" in r["reply"] and "not a signal" in r["reply"]
    assert r["data"]["state"] == "OK" and r["data"]["breadth"]["n_with_chg"] == 11
    one = c.get("/api/intel/sectors").json
    assert one["feed"] == "sectors" and one["payload"]["rows"]


def test_classify_sectors_does_not_steal_ideas():
    for t in ("sector breadth", "which sectors are leading", "market breadth", "sectors", "hey zoora, sector rotation"):
        assert classify(t)[0] == "sectors", t
    assert classify("show me ideas by sector")[0] == "ideas"
    assert classify("stock ideas")[0] == "ideas"


def test_js_breadth_strip_textcontent_only():
    js = JS.read_text()
    i = js.index("function renderSectorBreadth")
    body = js[i:js.index("const TABS", i)]
    assert "innerHTML" not in body and "not a signal" in body and "renderSectorBreadth(sq.sectors)" in js
