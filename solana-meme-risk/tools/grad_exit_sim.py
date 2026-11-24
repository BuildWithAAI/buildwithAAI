"""Paper-exit simulation on the graduation pool (read-only research tool).

For each labeled, paper-matched graduation (tools/grad_gate_check.pool_rows: pump
suffix, fdv >= $30k, reserve >= $1k at first sight) fetch GeckoTerminal 15-min
candles once (cached in data/backtest/work/grad_candles.jsonl; numbers only) and
simulate the paper strategy exit from first sight: +100% take profit, -50% stop,
24 h time exit. Entry = open of the candle containing first sight. A candle that
touches both 2x and 0.5x counts as the stop (conservative). If trades stop before
24 h the time exit uses the last trade. Costs from smr.paper.costs for a $20
(2% of $1,000) position against the first-sight reserve.
Then splits mean PnL / win rate by the candidate gates.
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from smr.paper import costs as C  # noqa: E402
from tools import label_graduations as L  # noqa: E402
from tools.grad_gate_check import GATES, LAB, pool_rows  # noqa: E402

CACHE = os.path.join(os.path.dirname(__file__), "..", "data", "backtest", "work", "grad_candles.jsonl")
DAY = 86400


def simulate(candles: list, seen_at: int, reserve_usd: float, size_usd: float = 20.0) -> dict | None:
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
    p0 = entry[1]
    window = [r for r in rows if entry[0] <= r[0] <= seen_at + DAY]
    reason, px, at = "time", window[-1][4], window[-1][0]
    for r in window:
        if r[3] <= 0.5 * p0:
            reason, px, at = "stop", min(0.5 * p0, r[1]) if r[1] < 0.5 * p0 else 0.5 * p0, r[0]
            break
        if r[2] >= 2 * p0:
            reason, px, at = "take_profit", 2 * p0, r[0]
            break
    ec = C.side_cost(size_usd, reserve_usd)
    tokens = size_usd * (1 - ec) / p0
    value = tokens * px
    xc = C.exit_cost(value, reserve_usd * px / p0 if reserve_usd else None, ec)
    pnl = tokens * px * (1 - xc) - size_usd
    return {"reason": reason, "exit_x": round(px / p0, 4), "hold_h": round((at + 900 - seen_at) / 3600, 2),
            "pnl_pct": round(100 * pnl / size_usd, 2)}


def _load(path):
    out = []
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


def fetch_missing(pool_mints: set, labels: list, cache: str = CACHE, sleep_s: float = 5.0, max_calls: int = 400) -> int:
    have = {r["pool"] for r in _load(cache)}
    todo = [r for r in labels if r.get("mint") in pool_mints and r["pool"] not in have]
    n = 0
    with open(cache, "a") as f:
        for r in todo[:max_calls]:
            try:
                candles = L._fetch(r["pool"], int(r["seen_at"]))
            except Exception as e:
                print(f"{r['pool'][:8]}: {type(e).__name__}", file=sys.stderr)
                time.sleep(sleep_s)
                continue
            clean = []
            for c in candles or []:
                try:
                    clean.append([int(c[0])] + [float(v) for v in c[1:6]])
                except (TypeError, ValueError, IndexError):
                    continue
            f.write(json.dumps({"pool": r["pool"], "seen_at": r["seen_at"], "candles": clean}) + "\n")
            f.flush()
            n += 1
            time.sleep(sleep_s)
    return n


def summarize(sims: list) -> dict:
    n = len(sims)
    if not n:
        return {"n": 0}
    wins = sum(s["pnl_pct"] > 0 for s in sims)
    return {"n": n, "wins": wins, "win_rate": round(wins / n, 3),
            "mean_pnl_pct": round(sum(s["pnl_pct"] for s in sims) / n, 2),
            "exits": {k: sum(s["reason"] == k for s in sims) for k in ("take_profit", "stop", "time")}}


def main(fetch: bool = False) -> dict:
    labels = _load(LAB)
    pool = pool_rows(labels)
    by_mint = {r["mint"]: r for r in labels}
    if fetch:
        fetch_missing({x["mint"] for x in pool}, labels)
    cand = {r["pool"]: r for r in _load(CACHE)}
    sims = []
    for x in pool:
        lab = by_mint[x["mint"]]
        c = cand.get(lab["pool"])
        if not c:
            continue
        s = simulate(c["candles"], int(lab["seen_at"]), float(lab.get("reserve_usd_seen") or 0))
        if s:
            sims.append({**x, **s})
    rep = {"pool": len(pool), "simulated": len(sims), "all": summarize(sims), "gates": {}}
    for k, g in GATES.items():
        rep["gates"][k] = {"flagged": summarize([s for s in sims if g(s)]),
                           "passed": summarize([s for s in sims if not g(s)])}
    return rep


if __name__ == "__main__":
    print(json.dumps(main(fetch="--fetch" in sys.argv), indent=1))
