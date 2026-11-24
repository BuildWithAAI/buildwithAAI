"""When did each wallet first appear on chain, and who sent it its first SOL or tokens?

Python 3 stdlib only; holds no case data.

  python3 wallet_origin.py --cache <private rpc cache> --wallets <wallets.json> \
      [--max-pages 3] [--first-txs 3] [--ref-time <unix>] --out <private out.json>

wallets.json: ["<address>", ...] or [{"address": ..., "label": ...}, ...]

For each wallet, its signature history is paged back from the newest entry (at most
--max-pages pages of 1,000). If the start of the history is reached, the oldest
--first-txs successful transactions are fetched and every incoming value transfer is
recorded:
  * SOL: parsed System Program transfers / account creations whose destination is the
    wallet (source = the funder);
  * tokens: any mint whose balance owned by the wallet went up in a transaction where
    another owner's balance of that mint went down (source = that owner), when the
    wallet did not trade it on a venue (no SOL or stablecoin leg going out).
It also records the fee payer of those transactions (a wallet whose fees are paid by
another account is linked to that account).

Output per wallet: n_signatures (or ">= N" when the history is longer than the pages
read), first_seen (blockTime of the oldest signature), age_at_ref_s (ref_time -
first_seen, when --ref-time is given), and funders [{source, kind, amount, mint,
signature, blockTime}].

Detection only: a shared funder links wallets; it does not prove one person controls
them (exchanges, payment apps and launch tools also fund many wallets).
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402


def history(rpc, address, max_pages=3):
    rows, before, complete = [], None, False
    for _ in range(max_pages):
        opts = {"limit": 1000, "commitment": "finalized"}
        if before:
            opts["before"] = before
        page = rpc.call("getSignaturesForAddress", [address, opts], cache_null=True) or []
        rows += page
        if len(page) < 1000:
            complete = True
            break
        before = page[-1]["signature"]
    return rows, complete


def incoming(tx, wallet):
    """Incoming SOL and token transfers to `wallet` in one transaction."""
    out = []
    for x in trades.system_transfers(tx):
        if x.get("destination") == wallet and x.get("source") != wallet:
            out.append({"source": x["source"], "kind": "SOL", "amount": x["lamports"] / trades.LAMPORTS,
                        "mint": None})
    tok = trades.token_deltas_by_owner(tx)
    mine = tok.get(wallet, {})
    sol = trades.sol_delta(tx, wallet, tok) / trades.LAMPORTS
    usd, _ = trades.stable_delta(tok, wallet)
    for mint, (d, dec) in mine.items():
        if d <= 0 or mint == trades.WSOL_MINT:
            continue
        others = [(o, ms[mint][0]) for o, ms in tok.items() if o != wallet and mint in ms and ms[mint][0] < 0]
        if not others:
            continue
        # a buy pays SOL or stablecoins out (or another token: then it is a swap, not funding)
        paid_other = any(v < 0 for m, (v, _) in mine.items() if m != mint)
        if sol < -trades.TRANSFER_SOL_EPS or usd < -trades.STABLE_EPS or paid_other:
            continue
        src = min(others, key=lambda x: x[1])[0]
        out.append({"source": src, "kind": "token", "amount": d / 10 ** dec, "mint": mint})
    return out


def origin(rpc, address, max_pages=3, first_txs=3, ref_time=None):
    rows, complete = history(rpc, address, max_pages)
    res = {"address": address, "n_signatures": len(rows) if complete else f">={len(rows)}",
           "history_complete": complete, "first_seen": None, "funders": [], "first_fee_payers": []}
    if not rows:
        return res
    oldest = sorted(rows, key=lambda r: (r["slot"], r.get("transactionIndex") or 0))
    res["first_seen"] = oldest[0].get("blockTime") if complete else None
    if ref_time and res["first_seen"]:
        res["age_at_ref_s"] = ref_time - res["first_seen"]
    if not complete:
        return res
    n = 0
    for r in oldest:
        if r.get("err"):
            continue
        tx = txfetch.get_tx(rpc, r["signature"])
        if not tx or not tx.get("meta"):
            continue
        n += 1
        payer = trades.fee_payer(tx)
        res["first_fee_payers"].append(payer)
        for f in incoming(tx, address):
            f.update({"signature": r["signature"], "blockTime": r.get("blockTime"), "slot": r["slot"]})
            res["funders"].append(f)
        if n >= first_txs:
            break
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--wallets", required=True)
    ap.add_argument("--max-pages", type=int, default=3)
    ap.add_argument("--first-txs", type=int, default=3)
    ap.add_argument("--ref-time", type=int, default=None)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rpc = RPC(a.cache)
    ws = json.load(open(a.wallets))
    ws = [w if isinstance(w, dict) else {"address": w} for w in ws]
    done = {}
    if os.path.exists(a.out):
        done = {r["address"]: r for r in json.load(open(a.out)).get("wallets", [])}
    for i, w in enumerate(ws, 1):
        if w["address"] in done:
            continue
        r = origin(rpc, w["address"], a.max_pages, a.first_txs, a.ref_time)
        r["label"] = w.get("label")
        done[w["address"]] = r
        print(f"[{i}/{len(ws)}] sigs={r['n_signatures']} first_seen={r['first_seen']} "
              f"funders={len(r['funders'])} rpc={rpc.stats}", flush=True)
        with open(a.out + ".tmp", "w") as f:
            json.dump({"params": vars(a), "wallets": list(done.values())}, f)
        os.replace(a.out + ".tmp", a.out)
    print("done", rpc.stats, flush=True)


if __name__ == "__main__":
    main()
