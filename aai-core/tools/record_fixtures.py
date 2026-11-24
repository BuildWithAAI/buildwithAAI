"""Record live replay fixtures for the offline tests (run manually; needs network).

  .venv/bin/python tools/record_fixtures.py
Writes tests/fixtures/<name>.replay.json.gz with every HTTP response (and recorded failures, e.g. the
Bybit geo-block) that one `assess` touched, plus the `now` used, so tests replay it bit-for-bit.
"""
import json, os, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aai_core.config import Settings
from aai_core.data.registry import Market
from aai_core.infra.cache import DiskCache
from aai_core.infra.replay import save_fixture
from aai_core.hub.assess import assess

CASES = {
    "btc_perp": dict(asset_class="crypto_perp", symbol="BTCUSDT", side="long", bankroll=10000, risk_pct=1),
    "eurusd": dict(asset_class="forex", symbol="EURUSD", side="short", bankroll=10000, risk_pct=1),
    "spy": dict(asset_class="equity", symbol="SPY", side="long", bankroll=50000, risk_pct=1),
    "btc_perp_book": dict(asset_class="crypto_perp", symbol="BTCUSDT", side="long", bankroll=10000, risk_pct=2,
                          book_path=os.path.join(os.path.dirname(__file__), "..", "samples", "book.example.json")),
}

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures")
    os.makedirs(out, exist_ok=True)
    for name, kw in CASES.items():
        tmp = tempfile.mkdtemp()
        st = Settings(home=tmp)
        cache = DiskCache(os.path.join(tmp, "c.db"), "readwrite")
        cache.recorder = {}
        now = time.time()
        d = assess(settings=st, market=Market(st, cache), now=now, **kw)
        expected = {k: d[k] for k in ("decision", "score", "max_size_pct", "confidence", "hard_flags", "line")}
        expected["suggested_size"] = d["suggested_size"]
        save_fixture(cache.recorder, os.path.join(out, f"{name}.replay.json.gz"),
                     {"now": now, "kwargs": {k: v for k, v in kw.items() if k != "book_path"}, "book": bool(kw.get("book_path")), "expected": expected})
        print(name, d["line"], len(cache.recorder), "entries")
