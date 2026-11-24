"""SOL/USD reference from a liquid on-chain SOL-USDC pool (stdlib only, no case data).

  python3 sol_usd.py --cache <rpc cache> --times 1791560751 1790000000 ... --out refs.json

For each unix time t, finds the last swap at or before t in the Orca Whirlpool
SOL-USDC pool (Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE) and reads the
price from the pool's own balance changes in that transaction:
|USDC change| / |wSOL change| (pool fee, ~0.04%, not removed).
Each reference records the signature and its blockTime so it can be re-checked.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402

POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
WSOL = "So11111111111111111111111111111111111111112"


def sol_usd_at(rpc, t, max_tx=12):
    cur = txfetch.cursor_at_time(rpc, t)
    page = rpc.call("getSignaturesForAddress", [POOL, {"limit": 40, "before": cur[0], "commitment": "finalized"}],
                    cache_null=True) or []
    tried = 0
    for r in page:
        if r.get("err"):
            continue
        tx = txfetch.get_tx(rpc, r["signature"])
        tried += 1
        d = trades.token_deltas_by_owner(tx).get(POOL, {})
        if USDC in d and WSOL in d and d[WSOL][0] != 0:
            u = d[USDC][0] / 10 ** d[USDC][1]
            s = d[WSOL][0] / 10 ** d[WSOL][1]
            if (u > 0) != (s > 0):
                return {"t_target": t, "blockTime": tx["blockTime"], "slot": tx["slot"], "signature": r["signature"],
                        "sol_usd": abs(u / s), "usdc": abs(u), "sol": abs(s), "pool": POOL}
        if tried >= max_tx:
            break
    return {"t_target": t, "sol_usd": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--times", type=int, nargs="+", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rpc = RPC(a.cache)
    refs = []
    for t in a.times:
        refs.append(sol_usd_at(rpc, t))
        print(refs[-1], flush=True)
    json.dump(refs, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
