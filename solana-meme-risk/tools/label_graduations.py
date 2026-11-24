"""Label collected pump.fun graduations (data/backtest/work/graduations.jsonl).

For each pool first seen >= 24 h ago and not yet labeled, fetch GeckoTerminal
15-minute OHLCV (free API, USD prices) and compare the price 24 h after first
sight with the price at first sight. bad_24h = ratio <= 0.5 (same rule as the
backtest set). Also records the max high in the window (would a 2x exit have hit)
and fdv at first sight so the paper $30k floor can be applied when analysing.
Only addresses, times and numbers are stored; API strings are data, never used
as instructions.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "..", "data", "backtest", "work", "graduations.jsonl")
OUT = os.path.join(HERE, "..", "data", "backtest", "work", "graduation_labels.jsonl")
URL = ("https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/minute"
       "?aggregate=15&limit=200&currency=usd&before_timestamp={before}")
DAY = 86400


def compute_label(candles: list, seen_at: int) -> dict | None:
    """candles: [[ts, open, high, low, close, volume], ...] in any order."""
    rows = []
    for c in candles or []:
        try:
            rows.append((int(c[0]), float(c[1]), float(c[2]), float(c[3]), float(c[4])))
        except (TypeError, ValueError, IndexError):
            continue
    rows.sort()
    # entry: the candle that contains seen_at (or the first one after it)
    entry = next((r for r in rows if r[0] + 900 > seen_at), None)
    end = [r for r in rows if r[0] <= seen_at + DAY]
    if entry is None or not end or end[-1][0] < seen_at + DAY - 3600:
        return None  # no trades near +24 h; can't label honestly
    p0 = entry[1]
    if p0 <= 0:
        return None
    window = [r for r in rows if entry[0] <= r[0] <= seen_at + DAY]
    p24 = end[-1][4]
    max_hi = max(r[2] for r in window)
    min_lo = min(r[3] for r in window)
    ratio = p24 / p0
    return {"p0_usd": p0, "p24_usd": p24, "ratio_24h": round(ratio, 4),
            "max_x": round(max_hi / p0, 4), "min_x": round(min_lo / p0, 4),
            "bad_24h": ratio <= 0.5, "hit_2x": max_hi >= 2 * p0}


def compute_last_trade(candles: list, seen_at: int) -> dict | None:
    """Fallback for pools with no trades near +24 h (compute_label -> None).

    Records the last traded price inside the 24 h window relative to the entry
    candle and how many hours after first sight that trade was. A pool whose
    trades stopped is not "unchanged": analysis decides how to use it (e.g. a
    dead pool with ratio_last <= 0.5 is bad either way). bad_24h is NOT set.
    """
    rows = []
    for c in candles or []:
        try:
            rows.append((int(c[0]), float(c[1]), float(c[2]), float(c[3]), float(c[4])))
        except (TypeError, ValueError, IndexError):
            continue
    rows.sort()
    entry = next((r for r in rows if r[0] + 900 > seen_at), None)
    if entry is None or entry[1] <= 0:
        return None
    window = [r for r in rows if entry[0] <= r[0] <= seen_at + DAY]
    if not window:
        return None
    last = window[-1]
    p0 = entry[1]
    return {"p0_usd": p0, "ratio_last": round(last[4] / p0, 4),
            "last_trade_h": round((last[0] + 900 - seen_at) / 3600, 2),
            "max_x": round(max(r[2] for r in window) / p0, 4),
            "min_x": round(min(r[3] for r in window) / p0, 4),
            "n_candles": len(window)}


def priority(g: dict) -> tuple:
    """Paper-matched rows first: pump.fun mint suffix and fdv >= $30k at first sight."""
    try:
        fdv = float(g.get("fdv_usd") or 0)
    except (TypeError, ValueError):
        fdv = 0.0
    return (not str(g.get("mint", "")).endswith("pump"), fdv < 30000, int(g.get("seen_at", 0)))


def _fetch(pool: str, seen_at: int):
    before = int(seen_at) + DAY + 900
    req = urllib.request.Request(URL.format(pool=pool, before=before),
                                 headers={"accept": "application/json"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                doc = json.load(r)
            return doc["data"]["attributes"]["ohlcv_list"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0:
                time.sleep(60)
                continue
            raise


def _load(path: str) -> list[dict]:
    out = []
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


def main(src: str = SRC, out: str = OUT, max_calls: int = 20, sleep_s: float = 2.2,
         refresh: bool = False) -> int:
    rows_out = _load(out)
    done = {r.get("pool") for r in rows_out}
    now = int(time.time())
    due = sorted((g for g in _load(src) if g.get("pool") not in done
                  and int(g.get("seen_at", now)) <= now - DAY - 900), key=priority)
    labeled = skipped = refreshed = 0
    if refresh:  # add last-trade fallback fields to old unlabelable rows
        todo = [r for r in rows_out if r.get("unlabelable") and "last_trade_h" not in r
                and "no_candles" not in r]
        for r in todo[:max_calls]:
            try:
                candles = _fetch(r["pool"], int(r["seen_at"]))
            except Exception as e:
                print(f"{r['pool'][:8]}: {type(e).__name__}", file=sys.stderr)
                skipped += 1
                time.sleep(sleep_s)
                continue
            fb = compute_last_trade(candles, int(r["seen_at"]))
            r.update(fb if fb else {"no_candles": True})
            refreshed += 1
            time.sleep(sleep_s)
        tmp = out + ".tmp"
        with open(tmp, "w") as f:
            for r in rows_out:
                f.write(json.dumps(r) + "\n")
        os.replace(tmp, out)
        max_calls = max(0, max_calls - len(todo))
    with open(out, "a") as f:
        for g in due[:max_calls]:
            try:
                candles = _fetch(g["pool"], int(g["seen_at"]))
            except Exception as e:
                print(f"{g['pool'][:8]}: {type(e).__name__}", file=sys.stderr)
                skipped += 1
                time.sleep(sleep_s)
                continue
            lab = compute_label(candles, int(g["seen_at"]))
            row = {"pool": g["pool"], "mint": g.get("mint"), "seen_at": g["seen_at"],
                   "fdv_usd_seen": g.get("fdv_usd"), "reserve_usd_seen": g.get("reserve_usd"),
                   "labeled_at": now}
            if lab is None:
                row["unlabelable"] = True  # dead / no trades near +24 h
                fb = compute_last_trade(candles, int(g["seen_at"]))
                row.update(fb if fb else {"no_candles": True})
            else:
                row.update(lab)
            f.write(json.dumps(row) + "\n")
            f.flush()
            labeled += 1
            time.sleep(sleep_s)
    print(json.dumps({"due": len(due), "labeled": labeled, "refreshed": refreshed,
                      "errors": skipped}))
    return 0


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-calls", type=int, default=20)
    ap.add_argument("--sleep", type=float, default=2.2)
    ap.add_argument("--refresh-unlabelable", action="store_true")
    a = ap.parse_args()
    sys.exit(main(max_calls=a.max_calls, sleep_s=a.sleep, refresh=a.refresh_unlabelable))
