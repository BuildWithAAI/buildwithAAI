"""Read-only check of paper entry prices against GeckoTerminal 1-minute candles.

Owner concern (2026-11-03): some recorded entries looked stale (MSTRT about 0.5x
the next candle). For each priced, non-voided launch at or above the $30k floor,
fetch the 1-min candles around `entry_at` and compare the recorded entry price
with the close of the entry minute (what a buyer arriving a few seconds later
would roughly pay). Nothing is written to data/paper.db; results go to a JSON
file. Symbols go through safe_field; API strings are data only. Rate-limited for
the keyless GeckoTerminal API (default one call every 16 s).
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
import urllib.request

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
from smr.paper.sanitize import safe_field  # noqa: E402

DB = os.path.join(HERE, "..", "data", "paper.db")
URL = ("https://api.geckoterminal.com/api/v2/networks/solana/pools/{pair}/ohlcv/minute"
       "?aggregate=1&before_timestamp={before}&limit=6&currency=usd&token=base")


def compare_fill(entry_price: float, entry_at: float, candles: list) -> dict:
    """candles: [[ts, o, h, l, c, v], ...]. -> entry/close ratio for the entry minute, and whether the
    recorded price lies inside that minute's low-high range. Missing candle -> {'candle': False}."""
    m = int(entry_at) // 60 * 60
    cur = None
    for c in candles or []:
        try:
            if int(c[0]) == m:
                cur = [float(x) for x in c[1:5]]
        except (TypeError, ValueError, IndexError):
            continue
    if cur is None or not entry_price or cur[3] <= 0:
        return {"candle": False}
    o, h, lo, cl = cur
    return {"candle": True, "entry_vs_close": round(entry_price / cl, 4),
            "in_range": lo * 0.98 <= entry_price <= h * 1.02, "minute_range_x": round(h / lo, 3) if lo > 0 else None}


def main(argv=None) -> int:
    out_path = (argv or sys.argv[1:] or [os.path.join(HERE, "..", "data", "backtest", "work", "entry_fill_check.json")])[0]
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = c.execute("SELECT symbol, mint, entry_pair, entry_at, entry_price, mayhem FROM launches WHERE entry_mcap >= 30000 "
                     "AND void_reason IS NULL AND entry_pair IS NOT NULL ORDER BY entry_at").fetchall()
    res = []
    for sym, mint, pair, at, ep, mayhem in rows:
        rec = {"symbol": safe_field(sym or "", max_len=24), "mint": mint, "mayhem": mayhem}
        try:
            req = urllib.request.Request(URL.format(pair=pair, before=int(at) + 120),
                                         headers={"Accept": "application/json", "User-Agent": "smr-research"})
            d = json.load(urllib.request.urlopen(req, timeout=20))
            rec.update(compare_fill(ep, at, d["data"]["attributes"]["ohlcv_list"]))
        except Exception as e:  # network / 429 / missing pool: record and move on
            rec["error"] = f"{type(e).__name__}"[:40]
        res.append(rec)
        time.sleep(16)
    with open(out_path, "w") as f:
        json.dump(res, f, indent=1)
    ok = [r for r in res if r.get("candle")]
    print(json.dumps({"checked": len(res), "with_candle": len(ok),
                      "entry_below_0.8x_close": sum(r["entry_vs_close"] < 0.8 for r in ok)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
