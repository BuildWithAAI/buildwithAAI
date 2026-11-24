"""Pick a documented sample of tokens a wallet group traded together.

Python 3 stdlib only; holds no case data.

  python3 joint_slot_tokens.py --config <private config.json> --sigs-dir <dir> \
      --from <ISO> --to <ISO> --min-side 3 --every 10 [--offset 0] --out <mints.json>

A "joint slot" is a slot in which at least --min-side distinct side wallets have
a successful transaction (from their saved signature lists, sigs_<label>.json).
Sorted by slot, every --every-th joint slot is read with getBlock (accounts
mode). The token(s) that two or more group wallets bought or sold in that slot
are recorded. Output is a mint list for cotrade_tokens.py, with the slot that
revealed each mint and the rule used.
"""

import argparse
import collections
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402


def iso(s):
    return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--sigs-dir", required=True)
    ap.add_argument("--from", dest="t_from", required=True)
    ap.add_argument("--to", dest="t_to", required=True)
    ap.add_argument("--min-side", type=int, default=3)
    ap.add_argument("--every", type=int, default=10)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    rpc = RPC(cfg["cache_dir"])
    by_addr = {w["address"]: w for w in cfg["wallets"]}
    t0, t1 = iso(a.t_from), iso(a.t_to)
    slot_w = collections.defaultdict(set)
    for w in cfg["wallets"]:
        if w["role"] != "side":
            continue
        for r in json.load(open(os.path.join(a.sigs_dir, f"sigs_{w['label']}.json"))):
            if not r.get("err") and r.get("blockTime") and t0 <= r["blockTime"] < t1:
                slot_w[r["slot"]].add(w["label"])
    joint = sorted(s for s, ws in slot_w.items() if len(ws) >= a.min_side)
    sample = joint[a.offset::a.every]
    out, seen = [], set()
    for n, slot in enumerate(sample, 1):
        blk = txfetch.block_accounts(rpc, slot)
        per_mint = collections.defaultdict(set)
        progs = {}
        for i, t in enumerate(blk["transactions"]):
            if t["meta"]["err"] is not None:
                continue
            signers = [k["pubkey"] for k in t["transaction"]["accountKeys"] if k.get("signer")]
            for s in signers:
                if s not in by_addr:
                    continue
                tx = txfetch.block_tx_as_tx(blk, i, slot)
                for r in trades.parse_wallet_trades(tx, s, tx_index=i):
                    if r["side"] in ("buy", "sell"):
                        per_mint[r["token"]].add((by_addr[s]["label"], r["side"]))
            for tb in (t["meta"].get("postTokenBalances") or []) + (t["meta"].get("preTokenBalances") or []):
                progs.setdefault(tb["mint"], tb.get("programId"))
        found = []
        for m, ws in per_mint.items():
            if len({w for w, _ in ws}) >= 2 and m not in seen:
                seen.add(m)
                found.append(m)
                out.append({"mint": m, "token_program": progs.get(m), "found_in_slot": slot,
                            "blockTime": blk.get("blockTime"), "group_actions": sorted(ws)})
        print(f"[{n}/{len(sample)}] slot {slot}: {len(found)} new mint(s) rpc={rpc.stats}", flush=True)
        json.dump({"rule": {"min_side": a.min_side, "every": a.every, "offset": a.offset, "from": a.t_from,
                            "to": a.t_to, "joint_slots": len(joint), "sampled": len(sample)},
                   "mints": out}, open(a.out, "w"), indent=1)
    print("done", len(out), rpc.stats, flush=True)


if __name__ == "__main__":
    main()
