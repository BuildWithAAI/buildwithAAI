"""A wallet's own Pump.fun / PumpSwap trades, read through its volume-accumulator PDAs.

Python 3 stdlib only; holds no case data.

  python3 venue_history.py --cache <private rpc cache> --wallet <address> \
      --from 2026-11-08T00:00:00Z --to 2026-11-09T16:05:26Z --out <private trades.json>

Why: a wallet that many people copy can appear in thousands of failed transactions
per minute sent by copy-trading bots that list it as a read-only account. Paging
its own signature list is then hopeless (1,000 signatures can cover a few seconds).
Both venues keep a per-user "user_volume_accumulator" account, a program-derived
address with seeds ["user_volume_accumulator", user] under the Pump.fun
bonding-curve program and under the PumpSwap AMM program, and pass it to the
program in that user's trades. Its signature history therefore holds that user's
venue trades only (plus their own failed attempts), which is small.

Caveats, check them per case:
  * a trade that does not pass the account (an older program version or a route
    that omits it) is missing from this list; compare with the wallet's token
    accounts for one token (solkeys.get_ata) if completeness matters;
  * only trades on these two venues are covered, not other DEXes or transfers.

Output: {"meta": {...}, "trades": [...]} with trades from trades.parse_wallet_trades
(tx_index from the signature listing's transactionIndex), each tagged with the
PDA ("via") that listed it. Failed transactions are skipped without fetching.
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import solkeys  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402

PROGRAMS = {"pumpfun": trades.PUMP_BONDING_CURVE, "pumpswap": trades.PUMPSWAP_AMM}


def iso(s):
    return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


def volume_pdas(wallet):
    """{venue: PDA address} of the wallet's user_volume_accumulator accounts."""
    w = solkeys.b58decode(wallet)
    return {v: solkeys.find_program_address([b"user_volume_accumulator", w], p)[0]
            for v, p in PROGRAMS.items()}


def pda_signatures(rpc, pda, t0, t1, log=None):
    """All signatures of `pda` with t0 <= blockTime < t1, paging back from t1."""
    cur = txfetch.cursor_at_time(rpc, t1 + 5)
    rows, meta = rpc.signatures_in_window(pda, t0, t1, start_before=cur[0], log=log)
    return rows, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--from", dest="t_from", required=True)
    ap.add_argument("--to", dest="t_to", required=True)
    ap.add_argument("--venues", default="pumpfun,pumpswap")
    ap.add_argument("--every", type=int, default=1,
                    help="keep every N-th successful signature (documented systematic sample)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rpc = RPC(a.cache)
    t0, t1 = iso(a.t_from), iso(a.t_to)
    pdas = volume_pdas(a.wallet)
    out, meta = [], {"from": a.t_from, "to": a.t_to, "every": a.every, "venues": {}}
    seen = set()
    for venue in a.venues.split(","):
        pda = pdas[venue]
        rows, pm = pda_signatures(rpc, pda, t0, t1, log=lambda m: print(m, flush=True))
        ok = sorted((r for r in rows if not r.get("err")), key=lambda r: (r["slot"], r.get("transactionIndex") or 0))
        sample = ok[::a.every]
        meta["venues"][venue] = {"sigs": len(rows), "ok": len(ok), "fetched": len(sample), "paging": pm}
        for n, r in enumerate(sample, 1):
            if r["signature"] in seen:
                continue
            seen.add(r["signature"])
            tx = txfetch.get_tx(rpc, r["signature"])
            for row in trades.parse_wallet_trades(tx, a.wallet, r["signature"], r.get("transactionIndex")):
                row["via"] = venue
                out.append(row)
            if n % 50 == 0:
                print(f"[{venue}] {n}/{len(sample)} trades={len(out)} rpc={rpc.stats}", flush=True)
            if n % 100 == 0:
                _save(a.out, meta, out, partial=True)
    meta["rpc"] = rpc.stats
    _save(a.out, meta, out, partial=False)
    print("done", json.dumps(meta)[:400], flush=True)


def _save(path, meta, rows, partial):
    m = dict(meta, partial=partial, n_trades=len(rows))
    with open(path + ".tmp", "w") as f:
        json.dump({"meta": m, "trades": rows}, f)
    os.replace(path + ".tmp", path)


if __name__ == "__main__":
    main()
