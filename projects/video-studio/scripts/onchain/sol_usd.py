"""SOL/USD reference from a liquid on-chain SOL-USDC pool (stdlib only, no case data).

  python3 sol_usd.py --cache <rpc cache> --times 1790000000 1790086400 ... --out refs.json
  python3 sol_usd.py --cache <rpc cache> --times ... --pool <pool or vault owner> --base-mint <token> \
      [--quote-mint <USDC>] --out refs.json     (any token priced in USDC from one pool)

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


def price_at(rpc, t, pool=POOL, base_mint=WSOL, quote_mint=USDC, min_quote=10.0, max_tx=30, legs_wanted=3):
    """Median of the last `legs_wanted` base/quote swap legs at or before t, among
    transactions that touched `pool` (any account the pool's swaps pass: the pool
    state, or the owner of its vaults). A leg is an account whose quote and base
    balances moved in opposite directions (that pool, or another pool for the same
    pair the transaction routed through), at least `min_quote` quote units. The
    largest leg per transaction is used. All legs are returned for checking.
    Price = quote per base (USDC per token with the defaults' quote)."""
    cur = txfetch.cursor_at_time(rpc, t)
    page = rpc.call("getSignaturesForAddress", [pool, {"limit": 60, "before": cur[0], "commitment": "finalized"}],
                    cache_null=True) or []
    tried, legs = 0, []
    for r in page:
        if r.get("err"):
            continue
        tx = txfetch.get_tx(rpc, r["signature"])
        tried += 1
        if not tx or not tx.get("meta"):
            continue  # transient null from the node; not cached, skipped
        best = None
        for owner, d in trades.token_deltas_by_owner(tx).items():
            if quote_mint in d and base_mint in d and d[base_mint][0] != 0:
                u = d[quote_mint][0] / 10 ** d[quote_mint][1]
                s = d[base_mint][0] / 10 ** d[base_mint][1]
                if (u > 0) != (s > 0) and abs(u) >= min_quote:
                    if best is None or abs(u) > best[1]:
                        best = (owner, abs(u), abs(s))
        if best:
            legs.append({"blockTime": tx["blockTime"], "slot": tx["slot"], "signature": r["signature"],
                         "price": best[1] / best[2], "quote": best[1], "base": best[2],
                         "leg_owner_is_reference_pool": best[0] == pool})
        if len(legs) >= legs_wanted or tried >= max_tx:
            break
    if not legs:
        return {"t_target": t, "price": None}
    px = sorted(l["price"] for l in legs)
    return {"t_target": t, "price": px[len(px) // 2], "n_legs": len(legs), "legs": legs}


def sol_usd_at(rpc, t, max_tx=30, legs_wanted=3):
    """SOL/USD from the Orca SOL-USDC reference pool (see price_at). Field names kept
    as before: sol_usd per result, and sol_usd / usdc / sol per leg."""
    r = price_at(rpc, t, POOL, WSOL, USDC, 10.0, max_tx, legs_wanted)
    if r.get("price") is None:
        return {"t_target": t, "sol_usd": None}
    legs = [{"blockTime": l["blockTime"], "slot": l["slot"], "signature": l["signature"],
             "sol_usd": l["price"], "usdc": l["quote"], "sol": l["base"],
             "leg_owner_is_reference_pool": l["leg_owner_is_reference_pool"]} for l in r["legs"]]
    return {"t_target": t, "sol_usd": r["price"], "n_legs": r["n_legs"], "legs": legs}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--times", type=int, nargs="+", required=True)
    ap.add_argument("--pool", default=None, help="pool account for another pair (default: Orca SOL-USDC)")
    ap.add_argument("--base-mint", default=WSOL)
    ap.add_argument("--quote-mint", default=USDC)
    ap.add_argument("--min-quote", type=float, default=10.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rpc = RPC(a.cache)
    refs = []
    for t in a.times:
        if a.pool is None:
            refs.append(sol_usd_at(rpc, t))
        else:
            refs.append(price_at(rpc, t, a.pool, a.base_mint, a.quote_mint, a.min_quote))
        print(refs[-1], flush=True)
    json.dump(refs, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
