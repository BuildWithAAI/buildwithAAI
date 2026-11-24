"""SOL/USD reference from a liquid on-chain SOL-USDC pool (stdlib only, no case data).

  python3 sol_usd.py --cache <rpc cache> --times 1791560751 1790000000 ... --out refs.json

For each unix time t, walks back from t through transactions that touched the
Orca Whirlpool SOL-USDC pool (Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE) and
takes the first one containing a SOL-USDC swap leg: an account whose USDC and
wSOL balances moved in opposite directions (that pool, or another SOL-USDC pool
the transaction routed through). Price = |USDC change| / |wSOL change| of that
leg (pool fee, well under 1%, not removed).
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


def sol_usd_at(rpc, t, max_tx=30, legs_wanted=3):
    """Median of the last `legs_wanted` SOL-USDC swap legs at or before t,
    among transactions that touched the reference pool. A leg is the pool side
    of a swap: an account whose USDC and wSOL balances moved in opposite
    directions (the reference pool itself, or another SOL-USDC pool the same
    transaction routed through), at least 10 USDC. The largest leg per
    transaction is used. All legs are returned for checking."""
    cur = txfetch.cursor_at_time(rpc, t)
    page = rpc.call("getSignaturesForAddress", [POOL, {"limit": 60, "before": cur[0], "commitment": "finalized"}],
                    cache_null=True) or []
    tried, legs = 0, []
    for r in page:
        if r.get("err"):
            continue
        tx = txfetch.get_tx(rpc, r["signature"])
        tried += 1
        best = None
        for owner, d in trades.token_deltas_by_owner(tx).items():
            if USDC in d and WSOL in d and d[WSOL][0] != 0:
                u = d[USDC][0] / 10 ** d[USDC][1]
                s = d[WSOL][0] / 10 ** d[WSOL][1]
                if (u > 0) != (s > 0) and abs(u) >= 10.0:
                    if best is None or abs(u) > best[1]:
                        best = (owner, abs(u), abs(s))
        if best:
            legs.append({"blockTime": tx["blockTime"], "slot": tx["slot"], "signature": r["signature"],
                         "sol_usd": best[1] / best[2], "usdc": best[1], "sol": best[2],
                         "leg_owner_is_reference_pool": best[0] == POOL})
        if len(legs) >= legs_wanted or tried >= max_tx:
            break
    if not legs:
        return {"t_target": t, "sol_usd": None}
    px = sorted(l["sol_usd"] for l in legs)
    return {"t_target": t, "sol_usd": px[len(px) // 2], "n_legs": len(legs), "legs": legs}


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
