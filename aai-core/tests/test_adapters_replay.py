"""Offline replays of real recorded responses (tools/record_fixtures.py) + doc-shaped Bybit parsing."""
import glob, json, os
import pytest
from aai_core.config import Settings
from aai_core.data.registry import Market
from aai_core.data import crypto as C
from aai_core.data.forex import parse_pair
from aai_core.data.equity import parse_ticker
from aai_core.infra.cache import DiskCache, make_key
from aai_core.infra.replay import replay_cache
from aai_core.hub.assess import assess
from aai_core.risk import decision as D

FX = os.path.join(os.path.dirname(__file__), "fixtures")
BOOK = os.path.join(os.path.dirname(__file__), "..", "samples", "book.example.json")


@pytest.mark.parametrize("path", sorted(glob.glob(os.path.join(FX, "*.replay.json.gz"))), ids=os.path.basename)
def test_replay_assess(path, tmp_path):
    cache, meta = replay_cache(path, str(tmp_path))
    st = Settings(home=str(tmp_path))
    kw = dict(meta["kwargs"])
    if meta.get("book"):
        kw["book_path"] = BOOK
    d = assess(settings=st, market=Market(st, cache), now=meta["now"], **kw)
    assert D.validate(d) == []
    for k, v in meta["expected"].items():
        assert d[k] == v, k
    s = d["suggested_size"]
    if s:
        assert s["risk_pct"] <= 3 and s["risk_amount"] == pytest.approx(s["bankroll"] * s["risk_pct"] / 100, rel=1e-6)
        assert s["stop"] < s["entry"] if d["side"] == "long" else s["stop"] > s["entry"]


def test_perp_failover_skips_blocked_venue(tmp_path):
    cache, meta = replay_cache(os.path.join(FX, "btc_perp.replay.json.gz"), str(tmp_path))
    f = Market(Settings(home=str(tmp_path)), cache).feed("crypto_perp")
    s = f.candles("BTCUSDT", "1h", 200, now=meta["now"])
    q = f.quote("BTCUSDT")
    assert s.venue == q.venue == "blofin" and "bybit" in f.blocked
    assert [a["venue"] for a in f.attempts] == ["bybit", "blofin", "blofin"]   # bybit not retried for quote
    ts = [c[0] for c in s.candles]
    assert ts == sorted(ts) and len(set(ts)) == len(ts) and all(c[2] >= max(c[1], c[4]) >= min(c[1], c[4]) >= c[3] for c in s.candles)
    assert q.spread_bps is not None and q.perp["funding_interval_h"] == 8.0 and q.depth["levels"] == 20


BYBIT_DOC = {   # response shapes from https://bybit-exchange.github.io/docs/v5/market/* (not verifiable from this box)
    "/v5/market/kline": {"retCode": 0, "result": {"list": [["1700003600000", "101", "103", "100", "102", "5", "510"], ["1700000000000", "100", "102", "99", "101", "4", "404"]]}},
    "/v5/market/tickers": {"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT", "lastPrice": "102", "bid1Price": "101.9", "ask1Price": "102.1",
                                                              "fundingRate": "0.0001", "nextFundingTime": "1700006400000", "openInterest": "10", "openInterestValue": "1020", "turnover24h": "5000"}]}},
    "/v5/market/orderbook": {"retCode": 0, "result": {"b": [["101.9", "2"]], "a": [["102.1", "3"]]}},
    "/v5/market/instruments-info": {"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT", "fundingInterval": 480}]}},
}


def test_bybit_parsing_doc_shapes(tmp_path):
    cache = DiskCache(str(tmp_path / "c.db"))
    b = C.Bybit(cache, 100)

    class S:
        headers = {}
        def get(self, url, params=None, timeout=None):
            path = url.replace("https://api.bybit.com", "")
            class R:
                status_code, headers, text = 200, {}, ""
                def json(_): return BYBIT_DOC[path]
                def raise_for_status(_): pass
            return R()
    b.h.s = S()
    rows = b.candles("BTC", "USDT", "1h", 2)
    assert rows[0][0] == 1700003600 and rows[1][4] == "101"
    q = b.quote("BTC", "USDT")
    assert q.mid == pytest.approx(102) and q.perp["funding_interval_h"] == 8 and q.perp["open_interest_usd"] == 1020
    assert q.depth == {"levels": 1, "bid_notional": pytest.approx(203.8), "ask_notional": pytest.approx(306.3)}


@pytest.mark.parametrize("raw,exp", [("BTC", ("BTC", "USDT")), ("btcusdt", ("BTC", "USDT")), ("ETH-USDT-SWAP", ("ETH", "USDT")),
                                     ("SOL/USDC", ("SOL", "USDC")), ("XRPUSDT.P", ("XRP", "USDT"))])
def test_parse_symbol(raw, exp):
    assert C.parse_symbol(raw) == exp


def test_parse_pair_and_ticker():
    assert parse_pair("eur/usd") == ("EUR", "USD") and parse_pair("GBPJPY=X") == ("GBP", "JPY")
    assert parse_ticker("brk.b") == "BRK-B"
    with pytest.raises(ValueError):
        parse_pair("EURO")
