"""Parsers are tested against payloads shaped exactly like the official docs (Blofin + Bybit V5).
The Bybit adapter is NOT verified against the live API from this environment (geo-blocked)."""

import pytest

from perps.data.adapters.blofin import BlofinAdapter
from perps.data.adapters.bybit import BybitAdapter
from perps.data.http import ExchangeUnavailable, PublicHttpClient


class FakeResp:
    def __init__(self, status, payload=None, text="", headers=None):
        self.status_code, self._p, self.text, self.headers = status, payload, text, headers or {}

    def json(self):
        if self._p is None:
            raise ValueError("no json")
        return self._p


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls, self.headers = list(responses), [], {}

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        return self.responses.pop(0)


def _client(responses, base="https://x"):
    return PublicHttpClient(base, rate_per_sec=1000, burst=1000, session=FakeSession(responses), sleep=lambda s: None)


def test_blofin_candles_drop_unconfirmed_and_sort():
    rows = [["1700000120000", "3", "4", "2", "3.5", "10", "0.01", "35", "0"],   # still forming
            ["1700000060000", "2", "3", "1", "2.5", "10", "0.01", "25", "1"],
            ["1700000000000", "1", "2", "0.5", "1.5", "10", "0.01", "15", "1"]]
    df = BlofinAdapter.parse_candles(rows)
    assert list(df.ts) == [1700000000000, 1700000060000]
    assert df.volume.iloc[0] == 0.01 and df.quote_volume.iloc[0] == 15


def test_blofin_api_error_code_raises():
    ad = BlofinAdapter(client=_client([FakeResp(200, {"code": "152001", "msg": "bad", "data": []})]))
    with pytest.raises(Exception, match="blofin"):
        ad.fetch_candles_page("BTC-USDT", "1H", None, 10)


def test_blofin_instrument_parse():
    r = {"instId": "BTC-USDT", "baseCurrency": "BTC", "quoteCurrency": "USDT", "contractValue": "0.001",
         "minSize": "0.1", "lotSize": "0.1", "tickSize": "0.1", "maxLeverage": "150", "maxMarketSize": "8000",
         "state": "live", "instType": "SWAP", "contractType": "linear"}
    s = BlofinAdapter._parse_instrument(r)
    assert s.contract_value == 0.001 and s.lot_size == 0.1 and s.max_market_size == 8000
    assert s.round_price(50000.06) == pytest.approx(50000.1)


def test_bybit_kline_parse_drops_forming_bar():
    step = 3_600_000
    now = 1_700_000_000_000 + 2 * step + 10
    rows = [[str(1_700_000_000_000 + 2 * step), "3", "4", "2", "3.5", "100", "350"],
            [str(1_700_000_000_000 + step), "2", "3", "1", "2.5", "100", "250"],
            [str(1_700_000_000_000), "1", "2", "0.5", "1.5", "100", "150"]]
    df = BybitAdapter.parse_klines(rows, "1H", now=now)
    assert len(df) == 2 and df.ts.is_monotonic_increasing and df.quote_volume.iloc[-1] == 250


def test_bybit_instrument_and_funding_parse():
    r = {"symbol": "BTCUSDT", "contractType": "LinearPerpetual", "status": "Trading", "baseCoin": "BTC",
         "quoteCoin": "USDT", "fundingInterval": 480, "leverageFilter": {"maxLeverage": "100.00"},
         "priceFilter": {"tickSize": "0.10"},
         "lotSizeFilter": {"maxOrderQty": "1190.000", "minOrderQty": "0.001", "qtyStep": "0.001",
                           "maxMktOrderQty": "500.000", "minNotionalValue": "5"}}
    s = BybitAdapter.parse_instrument(r)
    assert s.symbol == "BTC-USDT" and s.min_size == 0.001 and s.min_notional == 5 and s.funding_interval_hours == 8
    f = BybitAdapter.parse_funding([{"symbol": "BTCUSDT", "fundingRate": "0.0001", "fundingRateTimestamp": "1700028800000"},
                                    {"symbol": "BTCUSDT", "fundingRate": "-0.0002", "fundingRateTimestamp": "1700000000000"}])
    assert list(f.funding_rate) == [-0.0002, 0.0001]


def test_bybit_geoblock_fails_gracefully():
    body = "<HTML>403 ERROR The request could not be satisfied. CloudFront ... from your country</HTML>"
    ad = BybitAdapter(client=_client([FakeResp(403, None, body)], "https://api.bybit.com"))
    with pytest.raises(ExchangeUnavailable):
        ad.fetch_instrument("BTC-USDT")


def test_bybit_retcode_error():
    ad = BybitAdapter(client=_client([FakeResp(200, {"retCode": 10001, "retMsg": "params error", "result": {}})]))
    with pytest.raises(Exception, match="bybit"):
        ad.fetch_funding_page("BTC-USDT", None, 10)


def test_http_retries_429_then_succeeds():
    c = _client([FakeResp(429, None, "slow down", {"Retry-After": "1"}), FakeResp(200, None, "<html>challenge"),
                 FakeResp(200, {"code": "0", "data": []})])
    assert c.get("/x") == {"code": "0", "data": []}
    assert c.request_count == 3


def test_pagination_walks_backwards_and_dedupes():
    class Paged(BlofinAdapter):
        def __init__(self):
            self.client = _client([])
            self.pages = 0

        def fetch_candles_page(self, symbol, timeframe, end_ms, limit):
            import pandas as pd
            self.pages += 1
            end = end_ms or 10 * 3_600_000
            ts = [end - k * 3_600_000 for k in range(1, 4)]
            return pd.DataFrame({"ts": ts, "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1.0,
                                 "quote_volume": 1.0}).sort_values("ts")

    ad = Paged()
    df = ad.fetch_candles("X", "1H", start_ms=2 * 3_600_000, end_ms=10 * 3_600_000)
    assert list(df.ts) == [k * 3_600_000 for k in range(2, 10)]
    assert df.ts.is_unique
