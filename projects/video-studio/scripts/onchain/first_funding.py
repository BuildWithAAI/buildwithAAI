"""First appearance and first funding of busy wallets, found by time bisection.

Python 3 stdlib only; holds no case data.

  python3 first_funding.py --cache <private rpc cache> --wallets <wallets.json> \
      [--since 2025-01-01] [--until <unix>] [--first-txs 5] --out <private out.json>

wallets.json: {"label": "<address>", ...}

Paging a wallet with tens of thousands of signatures back to its first one is slow.
Instead, for a time T, getSignaturesForAddress(wallet, before=<a signature from a block
at T>, limit=1) says whether the wallet was active before T (txfetch.cursor_at_time,
memoised, so wallets share probe points). Bisecting on whole days finds the first active
day; the history is then paged back from the end of that day to its first signature, and
the oldest --first-txs successful transactions are read for incoming value
(wallet_origin.incoming: SOL transfers and token transfers into the wallet) and their fee
payers.

Detection only: a shared funder links wallets but does not prove common control
(exchanges and apps fund many wallets). Zero-value transfers from look-alike addresses in
a wallet's first transactions are usually address-poisoning spam, not funding.
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import txfetch  # noqa: E402
from wallet_origin import incoming  # noqa: E402

DAY = 86400


def active_before(rpc, addr, t):
    cur = txfetch.cursor_at_time(rpc, t)
    page = rpc.call("getSignaturesForAddress", [addr, {"limit": 1, "before": cur[0], "commitment": "finalized"}],
                    cache_null=True) or []
    return bool(page)


def first_day_end(rpc, addr, t_lo, t_hi):
    """End of the first UTC day with activity, or None if active before t_lo."""
    lo, hi = t_lo // DAY, t_hi // DAY + 1
    if active_before(rpc, addr, lo * DAY):
        return None
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if active_before(rpc, addr, mid * DAY):
            hi = mid
        else:
            lo = mid
    return hi * DAY


def oldest(rpc, addr, t_end, max_pages=10):
    cur = txfetch.cursor_at_time(rpc, t_end)
    before, rows = cur[0], []
    for _ in range(max_pages):
        page = rpc.call("getSignaturesForAddress", [addr, {"limit": 1000, "before": before, "commitment": "finalized"}],
                        cache_null=True) or []
        rows += page
        if len(page) < 1000:
            return rows, True
        before = page[-1]["signature"]
    return rows, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--wallets", required=True)
    ap.add_argument("--since", default="2025-01-01")
    ap.add_argument("--until", type=int, default=None)
    ap.add_argument("--first-txs", type=int, default=5)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rpc = RPC(a.cache)
    t_lo = int(datetime.datetime.fromisoformat(a.since + "T00:00:00+00:00").timestamp())
    t_hi = a.until or int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 60
    res = json.load(open(a.out)) if os.path.exists(a.out) else {}
    for lab, addr in json.load(open(a.wallets)).items():
        if lab in res:
            continue
        t_end = first_day_end(rpc, addr, t_lo, t_hi)
        if t_end is None:
            res[lab] = {"address": addr, "first_seen": f"before {a.since}"}
            continue
        rows, reached = oldest(rpc, addr, t_end)
        ok = sorted([r for r in rows if not r.get("err")], key=lambda r: (r["slot"], r.get("transactionIndex") or 0))
        inc = []
        for r in ok[:a.first_txs]:
            tx = txfetch.get_tx(rpc, r["signature"])
            signers = [k["pubkey"] for k in tx["transaction"]["message"]["accountKeys"] if k.get("signer")]
            for x in incoming(tx, addr):
                inc.append(dict(x, signature=r["signature"], blockTime=r["blockTime"], slot=r["slot"],
                                fee_payer=signers[0] if signers else None))
        res[lab] = {"address": addr, "first_day_end": t_end, "reached_start": reached,
                    "first_seen": ok[0]["blockTime"] if ok else None, "incoming": inc}
        print(lab, "first_seen", res[lab]["first_seen"], "incoming", len(inc), rpc.stats, flush=True)
        with open(a.out + ".tmp", "w") as f:
            json.dump(res, f, indent=1)
        os.replace(a.out + ".tmp", a.out)
    print("done", rpc.stats, flush=True)


if __name__ == "__main__":
    main()
