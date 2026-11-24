"""Forward collector for pump.fun graduations (PumpSwap pools).

GeckoTerminal's free new_pools feed only reaches back ~5 minutes (10 pages x 20
pools), so graduations can't be sampled after the fact from it. Run this every
session to append newly seen PumpSwap pools to a JSONL pool that later sessions
can label (24 h after the first $30k crossing) for a paper-matched filter set.
Token names are never stored; only addresses, times and numbers.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

URL = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page={page}"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "backtest", "work", "graduations.jsonl")


def parse_pools(doc: dict) -> list[dict]:
    rows = []
    for p in doc.get("data") or []:
        try:
            dex = p["relationships"]["dex"]["data"]["id"]
            if dex != "pumpswap":
                continue
            a = p["attributes"]
            base = p["relationships"]["base_token"]["data"]["id"]
            rows.append({
                "pool": str(a.get("address", ""))[:64],
                "mint": base.split("_", 1)[-1][:64],
                "pool_created_at": str(a.get("pool_created_at", ""))[:32],
                "fdv_usd": float(a["fdv_usd"]) if a.get("fdv_usd") is not None else None,
                "reserve_usd": float(a["reserve_in_usd"]) if a.get("reserve_in_usd") is not None else None,
            })
        except (KeyError, TypeError, ValueError):
            continue
    return rows


def load_seen(path: str) -> set[str]:
    seen = set()
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                try:
                    seen.add(json.loads(line)["pool"])
                except (ValueError, KeyError):
                    pass
    return seen


def main(pages: int = 10, out: str = OUT) -> int:
    seen = load_seen(out)
    new = []
    for page in range(1, pages + 1):
        req = urllib.request.Request(URL.format(page=page), headers={"accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                doc = json.load(r)
        except Exception as e:  # network/rate limit: stop quietly, keep what we have
            print(f"page {page}: {type(e).__name__}", file=sys.stderr)
            break
        for row in parse_pools(doc):
            if row["pool"] and row["pool"] not in seen:
                seen.add(row["pool"])
                row["seen_at"] = int(time.time())
                new.append(row)
        time.sleep(2.2)  # stay under the free 30 calls/min limit
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "a") as f:
        for row in new:
            f.write(json.dumps(row) + "\n")
    print(json.dumps({"new": len(new), "total": len(seen)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
