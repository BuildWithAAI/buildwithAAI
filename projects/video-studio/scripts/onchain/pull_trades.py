"""Fetch a wallet's transactions from a saved signature list and parse trades.

Python 3 stdlib only; holds no case data. Usage:

  python3 pull_trades.py --cache <private rpc cache dir> --sigs <sigs.json> \
      --wallet <address> --role side --label S1 [--from 2026-09-22T00:00:00Z] \
      [--to 2026-10-12T00:00:00Z] [--every N] --out <private trades.json>

<sigs.json> is a list of getSignaturesForAddress rows. Failed transactions
(row["err"]) are skipped without fetching. --every N keeps every N-th
successful signature (a documented systematic sample) when a wallet has too
many. Output: {"trades": [...], "sol_transfers": [...], "meta": {...}}.
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
from txfetch import get_tx  # noqa: E402


def iso(s):
    return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--sigs", required=True)
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--role", default=None)
    ap.add_argument("--label", default=None)
    ap.add_argument("--from", dest="t_from", default=None)
    ap.add_argument("--to", dest="t_to", default=None)
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    rows = json.load(open(a.sigs))
    t0 = iso(a.t_from) if a.t_from else -1
    t1 = iso(a.t_to) if a.t_to else 1 << 62
    ok = [r for r in rows if not r.get("err") and r.get("blockTime") and t0 <= r["blockTime"] < t1]
    ok.sort(key=lambda r: (r["slot"], r["signature"]))
    sample = ok[::a.every]
    rpc = RPC(a.cache)
    out_trades, out_xfers = [], []
    for n, r in enumerate(sample, 1):
        tx = get_tx(rpc, r["signature"])
        for row in trades.parse_wallet_trades(tx, a.wallet):
            row["wallet_role"] = a.role
            row["wallet_label"] = a.label
            out_trades.append(row)
        for x in trades.system_transfers(tx):
            if a.wallet in (x.get("source"), x.get("destination")):
                x.update({"signature": r["signature"], "blockTime": r["blockTime"], "slot": r["slot"]})
                out_xfers.append(x)
        if n % 100 == 0:
            print(f"[{a.label}] {n}/{len(sample)} {rpc.stats}", flush=True)
    meta = {"wallet_label": a.label, "role": a.role, "sigs_in_file": len(rows),
            "ok_in_range": len(ok), "fetched": len(sample), "every": a.every,
            "from": a.t_from, "to": a.t_to, "rpc": rpc.stats}
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"trades": out_trades, "sol_transfers": out_xfers, "meta": meta}, f)
    os.replace(tmp, a.out)
    print("done", meta, flush=True)


if __name__ == "__main__":
    main()
