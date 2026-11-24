"""Read-only: measure candidate paper gates on the labeled graduation pool.

Pool = data/backtest/work/graduation_labels.jsonl rows whose mint has the pump.fun
"pump" suffix (non-suffix PumpSwap pools are mostly spam with absurd prices), with
fdv >= $30k and reserve >= $1k at first sight. Outcome = price 24 h after first
sight vs first sight: the label's ratio_24h, else the last trade inside the 24 h
window (ratio_last; a pool with no later trades is still at that price at +24 h).
bad = ratio <= 0.5 (same rule as the backtest). Also reports hit_2x (max_x >= 2).

Gates measured (owner's candidate list, Next F1):
  liq_mcap_lt_0.3  reserve/fdv < 0.3 at first sight          -> REDUCED
  entry_ge_20x     fdv >= 20 x launch fdv (launch fdv ~ $2.65k) -> SKIP
Creator-holding (gate c) is not measurable here (no creator data in the pool).
Only numbers and addresses are read; nothing is called.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(__file__)
LAB = os.path.join(HERE, "..", "data", "backtest", "work", "graduation_labels.jsonl")
LAUNCH_FDV_USD = 2650.0  # median paper launch mcap Nov 3-5 (entry_mcap / price_vs_launch)


def outcome(r: dict):
    if r.get("ratio_24h") is not None:
        return float(r["ratio_24h"]), "24h"
    if r.get("ratio_last") is not None:
        return float(r["ratio_last"]), "last_trade"
    return None, None


def pool_rows(rows: list[dict], min_fdv: float = 30000, min_reserve: float = 1000) -> list[dict]:
    out = []
    for r in rows:
        if not str(r.get("mint", "")).endswith("pump"):
            continue
        try:
            fdv = float(r.get("fdv_usd_seen") or 0)
            res = float(r.get("reserve_usd_seen") or 0)
        except (TypeError, ValueError):
            continue
        ratio, src = outcome(r)
        if fdv < min_fdv or res < min_reserve or ratio is None:
            continue
        out.append({"mint": r["mint"], "fdv": fdv, "liq_mcap": res / fdv, "x_launch": fdv / LAUNCH_FDV_USD,
                    "ratio": ratio, "src": src, "bad": ratio <= 0.5, "hit_2x": float(r.get("max_x") or 0) >= 2})
    return out


def split(rows, pred):
    def s(sub):
        n = len(sub); b = sum(x["bad"] for x in sub)
        return {"n": n, "bad": b, "good": n - b, "bad_rate": round(b / n, 3) if n else None,
                "hit_2x": sum(x["hit_2x"] for x in sub)}
    return {"flagged": s([x for x in rows if pred(x)]), "passed": s([x for x in rows if not pred(x)])}


GATES = {"liq_mcap_lt_0.3": lambda x: x["liq_mcap"] < 0.3,
         "entry_ge_20x": lambda x: x["x_launch"] >= 20}


def main(path: str = LAB) -> dict:
    rows = []
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    pool = pool_rows(rows)
    rep = {"labeled_rows": len(rows), "pool": len(pool), "bad": sum(x["bad"] for x in pool),
           "by_source": {s: sum(x["src"] == s for x in pool) for s in ("24h", "last_trade")},
           "gates": {k: split(pool, g) for k, g in GATES.items()}}
    return rep


if __name__ == "__main__":
    print(json.dumps(main(*sys.argv[1:2]), indent=1))
