import pandas as pd
import pytest

from billy.market import BinanceKlinesClient, KlineCache, gap_report, update_cache
from billy.market.binance import INTERVAL_MS
from billy.market.data import MarketData, add_atr


def kl(t, c=100.0):
    return [t, str(c), str(c + 1), str(c - 1), str(c), "10", t + INTERVAL_MS["1h"] - 1]


class FakeResp:
    def __init__(self, status, data):
        self.status_code, self._d = status, data

    def json(self):
        return self._d

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeSession:
    def __init__(self, pages):
        self.pages, self.calls = list(pages), []

    def get(self, url, params, timeout):
        self.calls.append((url, dict(params)))
        return self.pages.pop(0)


def test_client_paginates_and_backs_off():
    h = INTERVAL_MS["1h"]
    page1 = [kl(i * h) for i in range(1000)]
    page2 = [kl((1000 + i) * h) for i in range(5)]
    sess = FakeSession([FakeResp(429, None), FakeResp(200, page1), FakeResp(200, page2)])
    c = BinanceKlinesClient("https://data-api.binance.vision", session=sess, sleep=lambda s: None)
    rows = c.fetch("BTCUSDT", "1h", 0)
    assert len(rows) == 1005
    assert all(u.endswith("/api/v3/klines") for u, _ in sess.calls)
    assert sess.calls[-1][1]["startTime"] == 1000 * h


def test_client_gives_up():
    sess = FakeSession([FakeResp(500, None)] * 5)
    c = BinanceKlinesClient("https://x", session=sess, sleep=lambda s: None)
    with pytest.raises(RuntimeError):
        c.fetch("BTCUSDT", "1h", 0)


def test_cache_drops_unclosed_and_gap_report(tmp_path):
    h = INTERVAL_MS["1h"]
    cache = KlineCache(tmp_path / "c.sqlite")
    rows = [kl(0), kl(h), kl(3 * h), kl(4 * h)]  # bar 2 missing; bar 4 still open
    n = cache.upsert("BTCUSDT", "1h", rows, now_ms=4 * h + 10)
    assert n == 3 and cache.last_open_time("BTCUSDT", "1h") == 3 * h
    df = cache.load("BTCUSDT", "1h")
    g = gap_report(df, "1h")
    assert g["rows"] == 3 and g["gaps"] == 1 and g["missing_bars"] == 1
    assert gap_report(df.iloc[:0], "1h")["rows"] == 0
    cache.upsert("BTCUSDT", "1h", [kl(0, 200.0)])  # idempotent upsert
    assert len(cache.load("BTCUSDT", "1h")) == 3


def test_update_cache_incremental(settings):
    settings.assets = ["BTC"]
    settings.market.intervals = ["1h"]
    h = INTERVAL_MS["1h"]

    class C:
        def __init__(self):
            self.starts = []

        def fetch(self, sym, iv, start):
            self.starts.append(start)
            return [kl(start), kl(start + h)]

    c = C()
    update_cache(settings, client=c, now_ms=10**15)
    update_cache(settings, client=c, now_ms=10**15)
    assert c.starts[1] == c.starts[0] + 2 * h
    md = MarketData.from_cache(settings)
    assert len(md.h1["BTC"]) == 4 and "atr" in md.h1["BTC"]
    assert "BTC:1h" in md.gap_reports()


def test_atr(mk_frame):
    df = add_atr(mk_frame([100 + i for i in range(30)]), 14)
    assert df["atr"].iloc[:13].isna().all() and df["atr"].iloc[-1] > 0
    assert add_atr(df.iloc[:0].drop(columns="atr"), 14).empty
