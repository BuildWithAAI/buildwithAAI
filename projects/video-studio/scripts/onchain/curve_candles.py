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
transactions fetched one by one the index is unknown and they sort after the
indexed ones in the same slot (flagged).

Output: {"trades": [...], "candles": [...], "meta": {...}}; each candle is
{t (bucket start, s from t_ref), open, high, low, close, volume_sol, n_trades};
empty buckets are omitted.
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

PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


def bonding_curve(mint):
    return solkeys.find_program_address([b"bonding-curve", solkeys.b58decode(mint)], PUMP)[0]


def collect(rpc, mint, venue, t_ref, before, after, dense_min=3):
    cur = txfetch.cursor_at_time(rpc, t_ref + after + 30)
    rows, meta = rpc.signatures_in_window(venue, t_ref - before, t_ref + after + 1, start_before=cur[0])
    ok = [r for r in rows if not r.get("err")]
    per_slot = collections.Counter(r["slot"] for r in ok)
    dense = {s for s, c in per_slot.items() if c >= dense_min}
    out = []
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
            i = None
        pt = trades.pool_trades(tx, venue, mint, signature=r["signature"], tx_index=i)
        if not pt:
            continue
        pt["indexed"] = i is not None
        pt["signers"] = [k["pubkey"] if isinstance(k, dict) else k
                         for k in tx["transaction"]["message"]["accountKeys"]
                         if isinstance(k, dict) and k.get("signer")]
        pt.pop("traders", None)
        out.append(pt)
    out.sort(key=lambda t: (t["slot"], 0 if t["indexed"] else 1, t["tx_index"] if t["tx_index"] is not None else 0))
    return out, {"sigs": len(rows), "ok": len(ok), "dense_slots": len(dense), "paging": meta}


def candles(trs, t_ref, bucket):
    c = collections.OrderedDict()
    for t in trs:
        p = t.get("price_sol_per_token")
        if not p:
            continue
        b = ((t["blockTime"] - t_ref) // bucket) * bucket
        k = c.get(b)
        if k is None:
            c[b] = {"t": b, "open": p, "high": p, "low": p, "close": p, "volume_sol": t["sol_amount"], "n_trades": 1}
        else:
            k["high"] = max(k["high"], p)
            k["low"] = min(k["low"], p)
            k["close"] = p
            k["volume_sol"] += t["sol_amount"]
            k["n_trades"] += 1
    return sorted(c.values(), key=lambda k: k["t"])


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
    cs = candles(trs, a.t_ref, a.bucket)
    meta.update({"mint": a.mint, "venue_account": venue, "t_ref": a.t_ref, "before": a.before,
                 "after": a.after, "bucket": a.bucket, "n_trades": len(trs), "rpc": rpc.stats})
    with open(a.out + ".tmp", "w") as f:
        json.dump({"meta": meta, "trades": trs, "candles": cs}, f)
    os.replace(a.out + ".tmp", a.out)
    print(json.dumps({k: v for k, v in meta.items() if k not in ("mint", "venue_account")}))


if __name__ == "__main__":
    main()
