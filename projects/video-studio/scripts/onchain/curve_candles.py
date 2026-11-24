"""Build OHLCV candles from every trade on a Pump.fun bonding curve (or a pool).

Python 3 stdlib only; holds no case data.

  python3 curve_candles.py --cache <private rpc cache> --mint <mint> \
      --t-ref <unix seconds> [--venue-account <curve or pool address>] \
      [--before 600] [--after 1800] [--bucket 5] [--dense-min 3] --out <private raw.json>

Without --venue-account the bonding-curve account is derived
(PDA of ["bonding-curve", mint] under the Pump.fun program).

Every successful transaction that touched the venue account in
[t_ref - before, t_ref + after] is read. Slots holding --dense-min or more of
them are read once with getBlock (accounts mode, which also gives the index of
each transaction in its block); the rest with getTransaction. Each trade's price
is the venue-side price: |SOL change of the curve/pool| / |token change| (fees
paid to third parties excluded). Trades are ordered by (slot, tx index); for
transactions fetched one by one the index comes from the signature listing's
transactionIndex (when the node returns it; otherwise they sort last in the slot
and are flagged indexed=false).

Output: {"trades": [...], "candles": [...], "meta": {...}}; candles come from
candles.build_candles (t = bucket start in unix seconds, OHLC in SOL per token,
volume in SOL, empty buckets flat at the previous close) and pass
candles.validate.
"""

import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
import solkeys  # noqa: E402
import txfetch  # noqa: E402
import candles as candles_mod  # noqa: E402

PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


def bonding_curve(mint):
    return solkeys.find_program_address([b"bonding-curve", solkeys.b58decode(mint)], PUMP)[0]


def collect(rpc, mint, venue, t_ref, before, after, dense_min=3):
    cur = txfetch.cursor_at_time(rpc, t_ref + after + 30)
    rows, meta = rpc.signatures_in_window(venue, t_ref - before, t_ref + after + 1, start_before=cur[0])
    ok = [r for r in rows if not r.get("err")]
    per_slot = collections.Counter(r["slot"] for r in ok)

    def tx_cached(sig):
        for v in (1, 0):
            p = [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": v, "commitment": "finalized"}]
            if os.path.exists(rpc._path("getTransaction", p)):
                return True
        return False

    def block_cached(slot):
        p = [slot, {"encoding": "jsonParsed", "transactionDetails": "accounts", "rewards": False,
                    "maxSupportedTransactionVersion": 1, "commitment": "finalized"}]
        return os.path.exists(rpc._path("getBlock", p) + ".gz")

    # A slot is read with getBlock when it holds >= dense_min of these transactions,
    # unless all of them are already cached one by one (then the block is not needed).
    uncached = collections.Counter(r["slot"] for r in ok if not tx_cached(r["signature"]))
    dense = {s for s, c in per_slot.items() if c >= dense_min and (uncached[s] > 0 or block_cached(s))}
    out = []
    creations = []
    blocks = {}
    for r in ok:
        s = r["slot"]
        if s in dense:
            if s not in blocks:
                blk = txfetch.block_accounts(rpc, s)
                blocks[s] = (blk, {t["transaction"]["signatures"][0]: i for i, t in enumerate(blk["transactions"])})
            blk, idx = blocks[s]
            i = idx.get(r["signature"])
            if i is None:
                continue
            tx = txfetch.block_tx_as_tx(blk, i, s)
        else:
            tx = txfetch.get_tx(rpc, r["signature"])
            i = r.get("transactionIndex")
        pt = trades.pool_trades(tx, venue, mint, signature=r["signature"], tx_index=i)
        if not pt:
            continue
        # The token-creation transaction fills the curve's token account from
        # nothing: its "price" is not a trade price. Keep it as an event only.
        pre = [tb for tb in (tx["meta"].get("preTokenBalances") or [])
               if tb.get("owner") == venue and tb.get("mint") == mint]
        if not pre:
            creations.append({"blockTime": tx.get("blockTime"), "slot": tx.get("slot"), "tx_index": i,
                              "signature": r["signature"]})
            continue
        # trades.pool_trades has used two field layouts; keep SOL-named fields.
        if "price_sol_per_token" not in pt:
            if pt.get("quote", "SOL") != "SOL":
                continue  # stablecoin-quoted pool: not comparable, skip
            pt["price_sol_per_token"] = pt.get("price_quote_per_token")
            pt["sol_amount"] = pt.get("quote_amount")
        pt["indexed"] = i is not None
        pt["signers"] = [k["pubkey"] if isinstance(k, dict) else k
                         for k in tx["transaction"]["message"]["accountKeys"]
                         if isinstance(k, dict) and k.get("signer")]
        pt.pop("traders", None)
        out.append(pt)
    out.sort(key=lambda t: (t["slot"], 0 if t["indexed"] else 1, t["tx_index"] if t["tx_index"] is not None else 0))
    return out, {"sigs": len(rows), "ok": len(ok), "dense_slots": len(dense), "paging": meta,
                 "creation_events": creations,
                 "ok_without_curve_flow": len(ok) - len(out) - len(creations)}


def to_candles(trs, t_ref, before, after, bucket):
    """5-s (or --bucket) OHLCV via candles.build_candles (shared with other cases)."""
    rows = [{"blockTime": t["blockTime"], "slot": t["slot"], "tx_index": t.get("tx_index"),
             "price": t.get("price_sol_per_token"), "volume": t["sol_amount"], "side": t["side"]} for t in trs]
    cs = candles_mod.build_candles(rows, t_ref - before, t_ref + after + 1, step=bucket)
    candles_mod.validate(cs)
    return cs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--mint", required=True)
    ap.add_argument("--venue-account", default=None)
    ap.add_argument("--t-ref", type=int, required=True)
    ap.add_argument("--before", type=int, default=600)
    ap.add_argument("--after", type=int, default=1800)
    ap.add_argument("--bucket", type=int, default=5)
    ap.add_argument("--dense-min", type=int, default=3)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rpc = RPC(a.cache)
    venue = a.venue_account or bonding_curve(a.mint)
    trs, meta = collect(rpc, a.mint, venue, a.t_ref, a.before, a.after, a.dense_min)
    cs = to_candles(trs, a.t_ref, a.before, a.after, a.bucket)
    meta.update({"mint": a.mint, "venue_account": venue, "t_ref": a.t_ref, "before": a.before,
                 "after": a.after, "bucket": a.bucket, "n_trades": len(trs), "rpc": rpc.stats})
    with open(a.out + ".tmp", "w") as f:
        json.dump({"meta": meta, "trades": trs, "candles": cs}, f)
    os.replace(a.out + ".tmp", a.out)
    print(json.dumps({k: v for k, v in meta.items() if k not in ("mint", "venue_account")}))


if __name__ == "__main__":
    main()
