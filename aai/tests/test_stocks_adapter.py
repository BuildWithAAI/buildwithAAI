"""Stocks desk: read-only Yahoo equity quotes via intel markets cache + 390 px iframe harness."""
from __future__ import annotations

import json
import time

import pytest

from aai.adapters.registry import build
from aai.adapters.stocks import EQUITY_SYMBOLS, StocksAdapter
from aai.hud import create_app
from aai.intel.cache import IntelCache


@pytest.fixture
def client(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    return create_app(cfg, store, build(cfg, store), heavy=False).test_client()



def _seed_markets(store, *, age=10.0, symbols=None):
    symbols = symbols or list(EQUITY_SYMBOLS)
    rows = []
    for i, sym in enumerate(symbols):
        rows.append({
            "symbol": sym, "yahoo": sym, "name": f"{sym} ETF", "class": "equity",
            "last": 100.0 + i, "prev_close": 99.0 + i, "chg": 0.01, "chg_20d": 0.02,
            "ts": time.time() - age, "currency": "USD",
            "spark": [[time.time() - 86400 * k, 90 + k] for k in range(5)],
        })
    # also a non-equity row that must be ignored by the stocks desk
    rows.append({"symbol": "BTCUSD", "yahoo": "BTC-USD", "name": "Bitcoin", "class": "crypto",
                 "last": 90000.0, "prev_close": 89000.0, "chg": 0.01, "chg_20d": 0.05,
                 "ts": time.time(), "currency": "USD", "spark": []})
    IntelCache(store).record("markets", "Yahoo Finance", True, payload={"rows": rows, "errors": {}},
                             latency_ms=12, ts=time.time() - age)
    return rows


def test_stocks_adapter_quotes_and_health(cfg, store):
    ad = StocksAdapter(cfg, store)
    miss = ad.quotes()
    assert miss["state"] == "MISSING" and miss["quotes"] == [] and ad.ideas() == []
    assert ad.health()["ok"] is False and ad.health()["status"] == "missing"

    _seed_markets(store, age=5)
    q = ad.quotes()
    assert q["state"] == "OK" and [x["symbol"] for x in q["quotes"]] == list(EQUITY_SYMBOLS)
    assert all("spark" in x for x in q["quotes"])
    assert "BTC" not in "".join(x["symbol"] for x in q["quotes"])
    h = ad.health()
    assert h["ok"] is True and h["status"] == "pass" and h["n_quotes"] == 3


def test_stocks_adapter_stale(cfg, store):
    """A markets snapshot older than the feed budget is STALE (still shows quotes, never invented)."""
    ad = StocksAdapter(cfg, store)
    _seed_markets(store, age=30 * 60)
    st = ad.quotes()
    assert st["state"] == "STALE" and len(st["quotes"]) == 3
    assert ad.health()["ok"] is False and ad.health()["status"] == "stale"


def test_registry_uses_stocks_adapter(cfg, store):
    ad = build(cfg, store)
    assert isinstance(ad["stocks"], StocksAdapter) and ad["stocks"].placeholder is False


def test_stocks_api_and_overview(client, store):
    r = client.get("/api/stocks")
    assert r.status_code == 200 and r.json["ok"] and r.json["state"] == "MISSING"
    _seed_markets(store, age=8)
    # overview caches for ~2s; hit stocks endpoint directly and overview after bust by new request cycle
    s = client.get("/api/stocks").json
    assert s["state"] == "OK" and [q["symbol"] for q in s["quotes"]] == list(EQUITY_SYMBOLS)
    ov = client.get("/api/zoora/overview").json
    pipe = next(p for p in ov["pipelines"] if p["id"] == "stocks")
    assert pipe["state"] == "OK" and "Yahoo" in pipe["detail"]
    assert ov["stocks"]["state"] == "OK" and len(ov["stocks"]["quotes"]) == 3
    # ideas intent names quotes, never invents
    d = client.post("/api/zoora", json={"text": "stock ideas", "source": "test"}).json
    assert d["ok"] and "no stock ideas" in d["reply"].lower() and "spy" in d["reply"].lower()


def test_narrow_harness_and_embed_csp(client):
    """True 390 px harness: same-origin iframe page + embed=1 relaxes frame-ancestors to 'self' only."""
    n = client.get("/zoora/narrow")
    assert n.status_code == 200
    assert b"390" in n.data and b'iframe' in n.data and b"embed=1" in n.data
    assert b"<script>" not in n.data  # harness itself is script-free
    assert b"<style>" not in n.data  # styles are external (CSP style-src 'self')
    assert b"narrow.css" in n.data
    assert "frame-ancestors 'none'" in n.headers.get("Content-Security-Policy", "")

    plain = client.get("/zoora")
    assert "frame-ancestors 'none'" in plain.headers["Content-Security-Policy"]
    assert plain.headers.get("X-Frame-Options") == "DENY"

    emb = client.get("/zoora?nosse=1&noboot=1&embed=1")
    assert emb.status_code == 200
    csp = emb.headers["Content-Security-Policy"]
    assert "frame-ancestors 'self'" in csp and "frame-ancestors 'none'" not in csp
    assert emb.headers.get("X-Frame-Options") == "SAMEORIGIN"


def test_stocks_quotes_strip_static():
    js = open("aai/static/zoora/zoora.js").read()
    css = open("aai/static/zoora/zoora.css").read()
    assert "stock-quotes" in js and "ov.stocks" in js and "no idea agent" in js.lower()
    assert ".stock-quotes" in css and "sq-row" in css
    assert "Stocks adapter is NOT BUILT" not in js
